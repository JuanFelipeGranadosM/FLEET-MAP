/* Mapa base (Mapbox Standard con token, o fondo claro sin red) + capa de equipos deck.gl.
 * Las capas se reconstruyen en un bucle requestAnimationFrame que llama a
 * overlay.setProps() directamente: React no se re-renderiza en cada cuadro. */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import type { MapboxOverlay } from '@deck.gl/mapbox';
import { GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { PickingInfo } from '@deck.gl/core';
import type { Catalog, Equipment, Site, StateId } from '../api/types';
import type { Aggregates } from '../data/aggregate';
import { useUi } from '../data/store';
import { COLORS, fmt, hexToRgb } from '../lib/format';
import { machineIcon, machineIconUrl } from '../lib/machineIcons';
import { useRoadSnappedFleet } from '../lib/roadRoutes';
import type { ViewApi } from './basemap/types';

export const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? '';
const MapboxBase = MAPBOX_TOKEN ? lazy(() => import('./basemap/MapboxBase')) : null;
const MapLibreBase = lazy(() => import('./basemap/MapLibreBase'));

type RGBA = [number, number, number, number];
const STATE_RGB = Object.fromEntries((['op', 'idle', 'standby', 'down', 'off'] as StateId[]).map(s => [s, hexToRgb(COLORS[s])])) as Record<StateId, [number, number, number]>;
const ACCENT = hexToRgb(COLORS.accent);
const INK: [number, number, number] = [20, 32, 46];

interface Moving { eq: Equipment; idx: number; lens?: number[]; total?: number; phase: number; u: number }
interface Dot { m: Moving; pos: [number, number]; state: StateId }
interface Props { catalog: Catalog; fleet: Equipment[]; agg: Aggregates; onHover(h: Hover | null): void }
export type Hover = { x: number; y: number } & ({ kind: 'eq'; eq: Equipment } | { kind: 'site'; site: Site });
type Context = Record<'roads' | 'rivers_lake_centerlines' | 'populated_places_simple' | 'admin_1_states_provinces_lines' | 'urban_areas', GeoJSON.FeatureCollection>;

function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

export function FleetMap({ catalog, fleet, agg, onHover }: Props) {
  const viewRef = useRef<ViewApi | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const basemap = useUi(s => s.basemap), selected = useUi(s => s.selected);
  const reduced = useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const useMapbox = !!MAPBOX_TOKEN;

  // con Mapbox, las volquetas siguen la geometría real de la vía (Directions API)
  const roadFleet = useRoadSnappedFleet(fleet, MAPBOX_TOKEN);
  const moving = useMemo<Moving[]>(() => roadFleet.map((eq, idx) => {
    const h = hash(eq.id), m: Moving = { eq, idx, phase: (h % 1000) / 1000, u: ((h % 1000) / 1000) * 2 };
    if (eq.route) {
      m.lens = [0]; let t = 0;
      for (let i = 1; i < eq.route.length; i++) { t += Math.hypot(eq.route[i][0] - eq.route[i - 1][0], eq.route[i][1] - eq.route[i - 1][1]); m.lens.push(t); }
      m.total = t;
    }
    return m;
  }), [roadFleet]);

  const haul = useMemo(() => roadFleet.filter(e => e.route).map(e => ({ path: e.route!.map(([la, lo]) => [lo, la] as [number, number]) })), [roadFleet]);

  const latest = useRef({ agg, selected, layer: useUi.getState().layer, live: useUi.getState().live, filters: useUi.getState().filters, zoom: 8.5, context: null as Context | null });
  latest.current.agg = agg; latest.current.selected = selected;
  useEffect(() => useUi.subscribe(s => { Object.assign(latest.current, { layer: s.layer, live: s.live, filters: s.filters }); }), []);

  // Sin Mapbox: vías, ríos, límites y ciudades reales (Natural Earth) dibujados por deck.gl.
  useEffect(() => {
    if (useMapbox) return;
    import('../demo/region.json').then(m => { latest.current.context = m.default as unknown as Context; });
  }, [useMapbox]);

  const heatData = useMemo(() => moving.filter(m => agg.visible[m.idx]).map(m => ({ p: [m.eq.lon, m.eq.lat], w: agg.per[m.idx].work })), [moving, agg]);
  const heatRef = useRef(heatData); heatRef.current = heatData;

  const siteArcs = useMemo(() => {
    const out: { path: [number, number][]; color: RGBA }[] = [];
    const live = useUi.getState().live;
    for (const s of catalog.sites) {
      const counts: Record<string, number> = {}; let n = 0;
      moving.forEach(m => { if (m.eq.siteId === s.id && agg.visible[m.idx]) { const st = live[m.eq.id]?.state ?? 'off'; counts[st] = (counts[st] ?? 0) + 1; n++; } });
      let a0 = -Math.PI / 2;
      for (const st of catalog.states) {
        const v = counts[st.id] ?? 0; if (!v) continue;
        const a1 = a0 + (v / n) * Math.PI * 2;
        out.push({ path: arc(s, s.radius * 1.3, a0 + 0.04, a1 - 0.04), color: [...hexToRgb(COLORS[st.id]), 255] });
        a0 = a1;
      }
    }
    return out;
  }, [catalog, moving, agg]);
  const arcsRef = useRef(siteArcs); arcsRef.current = siteArcs;

  useEffect(() => {
    let raf = 0;
    const pos = (m: Moving, st: StateId, dt: number): [number, number] => {
      const eq = m.eq;
      if (eq.route && m.lens && m.total) { // volquetas: siempre sobre su vía; sólo avanzan operando
        if (st === 'op' && !reduced) m.u = (m.u + dt * 0.000012) % 2; // ida y vuelta
        const u = m.u > 1 ? 2 - m.u : m.u;
        const d = u * m.total * 0.92; let k = 1;
        while (k < m.lens.length - 1 && m.lens[k] < d) k++;
        const a = eq.route[k - 1], b = eq.route[k], f = (d - m.lens[k - 1]) / (m.lens[k] - m.lens[k - 1] || 1);
        return [a[1] + (b[1] - a[1]) * f, a[0] + (b[0] - a[0]) * f];
      }
      return [eq.lon, eq.lat];
    };

    // Los arreglos de datos son estables: cada cuadro sólo se mueven posiciones (updateTriggers),
    // así deck.gl no recarga los iconos ni reconstruye atributos que no cambian.
    const dots: Dot[] = moving.map(m => ({ m, state: 'off', pos: [m.eq.lon, m.eq.lat] }));
    let vis: Dot[] = [], ghosts: Dot[] = [], seenAgg: Aggregates | null = null, stateKey = '', tick = 0, last = 0;

    const frame = (t: number) => {
      const o = overlayRef.current, L = latest.current;
      if (o) {
        let key = '';
        const dt = last ? Math.min(t - last, 100) : 0; last = t;
        for (const d of dots) { d.state = L.live[d.m.eq.id]?.state ?? 'off'; d.pos = pos(d.m, d.state, dt); key += d.state; }
        if (L.agg !== seenAgg) { seenAgg = L.agg; vis = dots.filter(d => L.agg.visible[d.m.idx]); ghosts = dots.filter(d => !L.agg.visible[d.m.idx]); }
        stateKey = key;
        tick++;
        const sel = dots.find(d => d.m.eq.id === L.selected);
        const siteSet = new Set(L.filters.site);
        const anyDown = vis.some(d => d.state === 'down') && !reduced;
        const blink = (d: Dot) => (d.state === 'down' && anyDown ? 150 + 105 * (0.5 + 0.5 * Math.sin(t * 0.004)) : 255);
        const sweep = reduced ? 0 : t * 0.0004;
        const sz = L.zoom < 8.8 ? 34 : L.zoom < 10 ? 44 : L.zoom < 12 ? 56 : 68, R = Math.round(sz * 0.3);
        const ring = (t * 0.0012) % 1;
        o.setProps({
          layers: [
            ...(L.context ? contextLayers(L.context, L.zoom) : []),
            new PathLayer({ id: 'haul', data: haul, getPath: d => d.path, getColor: [...ACCENT, 170] as RGBA, widthUnits: 'pixels', getWidth: 3, capRounded: true, jointRounded: true }),
            L.layer === 'heat' && new HeatmapLayer({ id: 'heat', data: heatRef.current, getPosition: d => d.p, getWeight: d => d.w, radiusPixels: 70, intensity: 1.2, threshold: 0.03,
              colorRange: [[255, 237, 160], [254, 217, 118], [254, 178, 76], [253, 141, 60], [240, 59, 32], [189, 0, 38]] }),
            new ScatterplotLayer<Site>({ id: 'site-hit', data: catalog.sites, pickable: true, getPosition: s => [s.lon, s.lat], getRadius: s => s.radius * 1.3 * 111_000, radiusUnits: 'meters',
              getFillColor: s => [ACCENT[0], ACCENT[1], ACCENT[2], siteSet.size && !siteSet.has(s.id) ? 8 : 34], stroked: true, getLineColor: [...ACCENT, 140] as RGBA, lineWidthUnits: 'pixels', getLineWidth: 1,
              updateTriggers: { getFillColor: [...siteSet].join() } }),
            new PathLayer({ id: 'site-arcs', data: arcsRef.current, getPath: d => d.path, getColor: d => d.color, widthUnits: 'pixels', getWidth: 4, capRounded: true }),
            new PathLayer({ id: 'site-sweep', data: catalog.sites, getPath: s => arc(s, s.radius * 1.55, sweep, sweep + 0.9), getColor: [...ACCENT, 220] as RGBA, widthUnits: 'pixels', getWidth: 2, updateTriggers: { getPath: sweep } }),
            new ScatterplotLayer<Dot>({ id: 'ghosts', data: ghosts, getPosition: d => d.pos, getFillColor: [120, 130, 150, 140], radiusUnits: 'pixels', getRadius: 3.5, updateTriggers: { getPosition: tick } }),
            // base de estado bajo cada máquina (sólo parpadea la de avería)
            new ScatterplotLayer<Dot>({ id: 'eq-halo', data: vis, getPosition: d => d.pos, radiusUnits: 'pixels', getRadius: R, getFillColor: d => [...STATE_RGB[d.state], 70] as RGBA,
              stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2.5, getLineColor: d => [...STATE_RGB[d.state], blink(d)] as RGBA,
              updateTriggers: { getPosition: tick, getFillColor: stateKey, getLineColor: anyDown ? tick : stateKey } }),
            new IconLayer<Dot>({ id: 'eq', data: vis, pickable: true, getPosition: d => d.pos, getIcon: d => machineIcon(d.m.eq.typeId), sizeUnits: 'pixels', getSize: sz, alphaCutoff: 0.05,
              updateTriggers: { getPosition: tick } }),
            sel && new ScatterplotLayer<Dot>({ id: 'sel', data: [sel, sel], getPosition: d => d.pos, radiusUnits: 'pixels', filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2.5,
              getRadius: (_, { index }) => (index ? R + 8 + ring * 26 : R + 8), getLineColor: (_, { index }) => [...INK, index ? 255 * (1 - ring) : 255] as RGBA,
              updateTriggers: { getPosition: tick, getRadius: ring, getLineColor: ring } }),
            L.zoom > 10.6 && new TextLayer<Dot>({ id: 'eq-labels', data: vis, getPosition: d => d.pos, getText: d => d.m.eq.id, getSize: 11, getColor: [...INK, 235] as RGBA, getPixelOffset: [sz * 0.45, -4],
              getTextAnchor: 'start', getAlignmentBaseline: 'center', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600, outlineWidth: 3, outlineColor: [255, 255, 255, 255], fontSettings: { sdf: true },
              updateTriggers: { getPosition: tick } }),
            new TextLayer<Site>({ id: 'site-labels', data: catalog.sites, getPosition: s => labelPos(s), getText: s => `${s.short.toUpperCase()}  ${L.agg.groups.site.get(s.id)?.count ?? 0}`,
              getSize: 14, getColor: d => (siteSet.size && !siteSet.has(d.id) ? [...INK, 90] : [...INK, 255]) as RGBA, getTextAnchor: 'start', getAlignmentBaseline: 'bottom',
              fontFamily: '"Barlow Condensed", "Arial Narrow", sans-serif', fontWeight: 700, characterSet: 'auto', background: true, getBackgroundColor: [255, 255, 255, 235],
              getBorderColor: [...ACCENT, 255] as RGBA, getBorderWidth: 1, backgroundPadding: [6, 3, 6, 3],
              updateTriggers: { getText: L.agg, getColor: [...siteSet].join() } }),
          ].filter(Boolean),
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [moving, haul, catalog, reduced]);

  const onOverlay = useCallback((o: MapboxOverlay) => {
    overlayRef.current = o;
    o.setProps({
      onHover: (info: PickingInfo) => {
        const obj = info.object as Dot | Site | undefined;
        if (!obj) { onHover(null); return; }
        if (info.layer?.id === 'eq') onHover({ kind: 'eq', eq: (obj as Dot).m.eq, x: info.x, y: info.y });
        else if (info.layer?.id === 'site-hit') onHover({ kind: 'site', site: obj as Site, x: info.x, y: info.y });
      },
      onClick: (info: PickingInfo) => {
        const ui = useUi.getState();
        if (info.layer?.id === 'eq') ui.select((info.object as Dot).m.eq.id);
        else if (info.layer?.id === 'site-hit') ui.toggle('site', (info.object as Site).id);
        else ui.select(null);
      },
      getCursor: ({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    });
  }, [onHover]);
  const onView = useCallback((v: ViewApi) => { viewRef.current = v; }, []);
  const onZoom = useCallback((z: number) => { latest.current.zoom = z; }, []);

  // volar al equipo seleccionado, dejando espacio para el panel de detalle
  useEffect(() => {
    if (!selected) return;
    const eq = fleet.find(e => e.id === selected), v = viewRef.current; if (!eq || !v) return;
    const wide = window.innerWidth > 860;
    v.flyTo({ center: [eq.lon, eq.lat], zoom: Math.max(v.getZoom(), 12), padding: { right: wide ? 380 : 0, left: 0, top: 0, bottom: wide ? 0 : 260 }, duration: reduced ? 0 : 1600 });
  }, [selected, fleet, reduced]);

  const b = catalog.bbox, bounds: [[number, number], [number, number]] = [[b.lonMin, b.latMin], [b.lonMax, b.latMax]];
  const props = { bounds, kind: basemap === 'satellite' ? 'satellite' as const : 'light' as const, onOverlay, onView, onZoom };
  return (
    <Suspense fallback={null}>
      {MapboxBase ? <MapboxBase {...props} /> : <MapLibreBase {...props} />}
    </Suspense>
  );
}

function arc(s: Site, r: number, a0: number, a1: number): [number, number][] {
  const pts: [number, number][] = [], k = Math.cos((s.lat * Math.PI) / 180), n = Math.max(8, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 72));
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([s.lon + (Math.cos(a) * r) / k, s.lat - Math.sin(a) * r]); }
  return pts;
}
function labelPos(s: Site): [number, number] {
  const r = s.radius * 1.3, k = Math.cos((s.lat * Math.PI) / 180);
  return [s.lon + (r * 0.8) / k, s.lat + r * 0.75];
}

function contextLayers(c: Context, zoom: number) {
  const major = (f: GeoJSON.Feature) => /Major|Expressway/i.test(String(f.properties?.type)) || f.properties?.expressway === 1;
  const cities = c.populated_places_simple.features;
  return [
    new GeoJsonLayer({ id: 'ctx-urban', data: c.urban_areas, filled: true, stroked: false, getFillColor: [214, 204, 186, 150] }),
    new GeoJsonLayer({ id: 'ctx-admin', data: c.admin_1_states_provinces_lines, getLineColor: [150, 140, 170, 140], lineWidthUnits: 'pixels', getLineWidth: 1.2 }),
    new GeoJsonLayer({ id: 'ctx-rivers', data: c.rivers_lake_centerlines, getLineColor: [120, 180, 230, 230], lineWidthUnits: 'pixels', getLineWidth: 2.4, lineCapRounded: true, lineJointRounded: true }),
    new GeoJsonLayer({ id: 'ctx-roads-casing', data: c.roads, getLineColor: [176, 186, 200, 255], lineWidthUnits: 'pixels', getLineWidth: f => (major(f) ? 6 : 4), lineCapRounded: true, lineJointRounded: true }),
    new GeoJsonLayer({ id: 'ctx-roads', data: c.roads, getLineColor: f => (major(f) ? [252, 226, 160, 255] : [255, 255, 255, 255]), lineWidthUnits: 'pixels', getLineWidth: f => (major(f) ? 4 : 2.4), lineCapRounded: true, lineJointRounded: true }),
    new ScatterplotLayer<GeoJSON.Feature>({ id: 'ctx-cities', data: cities, getPosition: f => (f.geometry as GeoJSON.Point).coordinates as [number, number], radiusUnits: 'pixels',
      getRadius: f => (Number(f.properties?.pop_max) > 1e6 ? 4.5 : 3), getFillColor: [...INK, 220] as RGBA, stroked: true, getLineColor: [255, 255, 255, 255], lineWidthUnits: 'pixels', getLineWidth: 1.5 }),
    new TextLayer<GeoJSON.Feature>({ id: 'ctx-city-labels', data: cities.filter(f => zoom > 8.6 || Number(f.properties?.pop_max) > 300000),
      getPosition: f => (f.geometry as GeoJSON.Point).coordinates as [number, number], getText: f => String(f.properties?.name), characterSet: 'auto',
      getSize: f => (Number(f.properties?.pop_max) > 1e6 ? 14 : 12), getColor: [70, 80, 96, 255], getPixelOffset: [7, 0], getTextAnchor: 'start', getAlignmentBaseline: 'center',
      fontFamily: '"IBM Plex Sans", system-ui, sans-serif', fontWeight: 500, outlineWidth: 3, outlineColor: [255, 255, 255, 255], fontSettings: { sdf: true } }),
  ];
}

export function MapTooltip({ hover, agg, catalog, index }: { hover: Hover | null; agg: Aggregates; catalog: Catalog; index: Map<string, number> }) {
  const live = useUi(s => s.live);
  if (!hover) return null;
  const style = { transform: `translate(${hover.x + 16}px, ${hover.y + 16}px)` };
  if (hover.kind === 'eq') {
    const eq = hover.eq, p = agg.per[index.get(eq.id) ?? 0], st = catalog.states.find(s => s.id === (live[eq.id]?.state ?? 'off'))!;
    const site = catalog.sites.find(s => s.id === eq.siteId)!;
    return (
      <div className="map-tip" style={style}>
        <div className="tip-eq"><img src={machineIconUrl(eq.typeId)} alt="" width="44" height="44" /><div><b>{eq.id}</b> <span className="pill" style={{ color: st.color, marginLeft: 6 }}>{st.name}</span>
        <div className="tip-sub">{eq.model} · {site.short}</div></div></div>
        <div className="row"><span>Trabajadas</span><span>{fmt.hours(p.work)}</span></div>
        <div className="row"><span>Standby</span><span>{fmt.hours(p.standby)}</span></div>
        <div className="row"><span>Facturación</span><span>{fmt.money(p.billed)}</span></div>
      </div>
    );
  }
  const g = agg.groups.site.get(hover.site.id);
  return (
    <div className="map-tip" style={style}>
      <b>{hover.site.name}</b>
      <div className="tip-sub">{catalog.clients.find(c => c.id === hover.site.client)?.name}</div>
      <div className="row"><span>Equipos</span><span>{g?.count ?? 0}</span></div>
      <div className="row"><span>Trabajadas</span><span>{fmt.hours(g?.work ?? 0)}</span></div>
      <div className="row"><span>Facturación</span><span>{fmt.money(g?.billed ?? 0)}</span></div>
      <div className="tip-cta">Clic para filtrar la obra</div>
    </div>
  );
}
