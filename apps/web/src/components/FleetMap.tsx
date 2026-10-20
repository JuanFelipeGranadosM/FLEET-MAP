/* Mapa base MapLibre + capa de equipos deck.gl (WebGL).
 * Las capas se reconstruyen en un bucle requestAnimationFrame que llama a
 * overlay.setProps() directamente: React no se re-renderiza en cada cuadro. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Map, useControl, type MapRef } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { PickingInfo } from '@deck.gl/core';
import type { Catalog, Equipment, Site, StateId } from '../api/types';
import type { Aggregates } from '../data/aggregate';
import { useUi } from '../data/store';
import { COLORS, fmt, hexToRgb } from '../lib/format';
import { makeTerrain, type TerrainImage } from '../lib/terrain';
import { DEMO } from '../api/client';

const DARK_STYLE = (import.meta.env.VITE_MAP_STYLE_DARK as string | undefined) || 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const SAT_TILES = (import.meta.env.VITE_MAP_SATELLITE_TILES as string | undefined) || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_STYLE: StyleSpecification = {
  version: 8,
  sources: { sat: { type: 'raster', tiles: [SAT_TILES], tileSize: 256, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics' } },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#060d17' } },
    { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': 0.62, 'raster-saturation': -0.35, 'raster-contrast': 0.1 } },
  ],
};
// Respaldo sin red: relieve generado en el navegador; vías, obras y equipos los dibuja deck.gl.
function offlineStyle(t: TerrainImage): StyleSpecification {
  return {
    version: 8,
    sources: { terrain: { type: 'image', url: t.url, coordinates: t.coordinates } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#060d17' } },
      { id: 'terrain', type: 'raster', source: 'terrain', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
    ],
  };
}

type RGBA = [number, number, number, number];
const STATE_RGB = Object.fromEntries((['op', 'idle', 'standby', 'down', 'off'] as StateId[]).map(s => [s, hexToRgb(COLORS[s])])) as Record<StateId, [number, number, number]>;
const ACCENT = hexToRgb(COLORS.accent);

interface Moving { eq: Equipment; idx: number; lens?: number[]; total?: number; phase: number; wob: number }
interface Dot { m: Moving; pos: [number, number]; state: StateId; visible: boolean }
interface Props { catalog: Catalog; fleet: Equipment[]; agg: Aggregates; onHover(h: Hover | null): void }
export type Hover = { x: number; y: number } & ({ kind: 'eq'; eq: Equipment } | { kind: 'site'; site: Site });

function DeckOverlay({ onReady }: { onReady(o: MapboxOverlay): void }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));
  useEffect(() => onReady(overlay), [overlay, onReady]);
  return null;
}

function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

export function FleetMap({ catalog, fleet, agg, onHover }: Props) {
  const mapRef = useRef<MapRef>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [offline, setOffline] = useState(DEMO);
  const basemap = useUi(s => s.basemap), selected = useUi(s => s.selected);
  const reduced = useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  // datos estáticos por equipo para la animación
  const moving = useMemo<Moving[]>(() => fleet.map((eq, idx) => {
    const h = hash(eq.id), m: Moving = { eq, idx, phase: (h % 1000) / 1000, wob: 0.6 + (h % 97) / 97 };
    if (eq.route) {
      m.lens = [0]; let t = 0;
      for (let i = 1; i < eq.route.length; i++) { t += Math.hypot(eq.route[i][0] - eq.route[i - 1][0], eq.route[i][1] - eq.route[i - 1][1]); m.lens.push(t); }
      m.total = t;
    }
    return m;
  }), [fleet]);

  const roads = useMemo(() => catalog.roads.map(r => ({ path: r.map(([la, lo]) => [lo, la] as [number, number]) })), [catalog]);

  // el bucle de animación lee siempre lo último desde aquí
  const latest = useRef({ agg, selected, layer: useUi.getState().layer, live: useUi.getState().live, filters: useUi.getState().filters, zoom: 8.5 });
  latest.current.agg = agg; latest.current.selected = selected;
  useEffect(() => useUi.subscribe(s => { Object.assign(latest.current, { layer: s.layer, live: s.live, filters: s.filters }); }), []);

  const heatData = useMemo(() => moving.filter(m => agg.visible[m.idx]).map(m => ({ p: [m.eq.lon, m.eq.lat], w: agg.per[m.idx].work })), [moving, agg]);
  const heatRef = useRef(heatData); heatRef.current = heatData;

  // aros de estado por obra
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
        out.push({ path: arc(s, s.radius * 1.3, a0 + 0.04, a1 - 0.04), color: [...hexToRgb(st.color), 255] });
        a0 = a1;
      }
    }
    return out;
  }, [catalog, moving, agg]);
  const arcsRef = useRef(siteArcs); arcsRef.current = siteArcs;

  useEffect(() => {
    let raf = 0;
    const pos = (m: Moving, st: StateId, t: number): [number, number] => {
      const eq = m.eq;
      if (eq.route && m.lens && m.total && (st === 'op' || st === 'idle')) {
        let u = (t * 0.001 * (st === 'op' ? 0.012 : 0) + m.phase) % 2; if (u > 1) u = 2 - u;
        const d = u * m.total * 0.92; let k = 1;
        while (k < m.lens.length - 1 && m.lens[k] < d) k++;
        const a = eq.route[k - 1], b = eq.route[k], f = (d - m.lens[k - 1]) / (m.lens[k] - m.lens[k - 1] || 1);
        return [a[1] + (b[1] - a[1]) * f, a[0] + (b[0] - a[0]) * f];
      }
      if (st === 'op' && !reduced) {
        const w = t * 0.0006 * m.wob + m.phase * 6.28;
        return [eq.lon + Math.cos(w) * 0.0012 * m.wob, eq.lat + Math.sin(w * 1.3) * 0.0009];
      }
      return [eq.lon, eq.lat];
    };

    const frame = (t: number) => {
      const o = overlayRef.current, L = latest.current;
      if (o) {
        const dots: Dot[] = moving.map(m => { const state = L.live[m.eq.id]?.state ?? 'off'; return { m, state, pos: pos(m, state, t), visible: !!L.agg.visible[m.idx] }; });
        const vis = dots.filter(d => d.visible), ghosts = dots.filter(d => !d.visible);
        const sel = vis.find(d => d.m.eq.id === L.selected) ?? dots.find(d => d.m.eq.id === L.selected);
        const siteSet = new Set(L.filters.site);
        const ph = (d: Dot) => (t * 0.0009 + d.m.phase) % 1;
        const blink = (d: Dot) => (d.state === 'down' && !reduced ? 110 + 145 * (0.5 + 0.5 * Math.sin(t * 0.008 + d.m.phase * 6)) : 255);
        const sweep = reduced ? 0 : t * 0.0004;
        o.setProps({
          layers: [
            new PathLayer({ id: 'roads-casing', data: roads, getPath: d => d.path, getColor: [4, 9, 16, 200], widthUnits: 'pixels', getWidth: 6, capRounded: true, jointRounded: true }),
            new PathLayer({ id: 'roads', data: roads, getPath: d => d.path, getColor: [214, 190, 140, 150], widthUnits: 'pixels', getWidth: 2, capRounded: true, jointRounded: true }),
            L.layer === 'heat' && new HeatmapLayer({ id: 'heat', data: heatRef.current, getPosition: d => d.p, getWeight: d => d.w, radiusPixels: 70, intensity: 1.2, threshold: 0.03,
              colorRange: [[60, 20, 10], [140, 40, 20], [220, 80, 30], [255, 140, 50], [255, 190, 80], [255, 230, 160]] }),
            new ScatterplotLayer<Site>({ id: 'site-hit', data: catalog.sites, pickable: true, getPosition: s => [s.lon, s.lat], getRadius: s => s.radius * 1.3 * 111_000, radiusUnits: 'meters',
              getFillColor: s => [ACCENT[0], ACCENT[1], ACCENT[2], siteSet.size && !siteSet.has(s.id) ? 4 : 14], stroked: true, getLineColor: [255, 201, 77, 70], lineWidthUnits: 'pixels', getLineWidth: 1,
              updateTriggers: { getFillColor: [...siteSet].join() } }),
            new PathLayer({ id: 'site-arcs', data: arcsRef.current, getPath: d => d.path, getColor: d => d.color, widthUnits: 'pixels', getWidth: 3.5, capRounded: true }),
            new PathLayer({ id: 'site-sweep', data: catalog.sites, getPath: s => arc(s, s.radius * 1.55, sweep, sweep + 0.9), getColor: [255, 201, 77, 140], widthUnits: 'pixels', getWidth: 1.5, updateTriggers: { getPath: sweep } }),
            new ScatterplotLayer<Dot>({ id: 'ghosts', data: ghosts, getPosition: d => d.pos, getFillColor: [90, 105, 132, 120], radiusUnits: 'pixels', getRadius: 3 }),
            !reduced && new ScatterplotLayer<Dot>({ id: 'pulse', data: vis.filter(d => d.state === 'op'), getPosition: d => d.pos, radiusUnits: 'pixels', getRadius: d => 6 + ph(d) * 22, filled: false, stroked: true,
              lineWidthUnits: 'pixels', getLineWidth: 1.5, getLineColor: d => [...STATE_RGB.op, 150 * (1 - ph(d))] as RGBA }),
            new ScatterplotLayer<Dot>({ id: 'glow', data: vis, getPosition: d => d.pos, radiusUnits: 'pixels', getRadius: 13, getFillColor: d => [...STATE_RGB[d.state], d.state === 'down' ? blink(d) * 0.25 : 55] as RGBA }),
            new ScatterplotLayer<Dot>({ id: 'eq', data: vis, pickable: true, getPosition: d => d.pos, radiusUnits: 'pixels', getRadius: 5.5, getFillColor: d => [...STATE_RGB[d.state], blink(d)] as RGBA,
              stroked: true, lineWidthUnits: 'pixels', getLineWidth: 1.5, getLineColor: [6, 12, 22, 230] }),
            sel && new ScatterplotLayer<Dot>({ id: 'sel', data: [sel, sel], getPosition: d => d.pos, radiusUnits: 'pixels', filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2,
              getRadius: (_, { index }) => (index ? 13 + ((t * 0.002) % 1) * 26 : 13), getLineColor: (_, { index }) => [...ACCENT, index ? 255 * (1 - ((t * 0.002) % 1)) : 255] as RGBA }),
            L.zoom > 10.6 && new TextLayer<Dot>({ id: 'eq-labels', data: vis, getPosition: d => d.pos, getText: d => d.m.eq.id, getSize: 11, getColor: [232, 238, 247, 220], getPixelOffset: [10, 0],
              getTextAnchor: 'start', getAlignmentBaseline: 'center', fontFamily: '"IBM Plex Mono", monospace', fontWeight: 500, outlineWidth: 3, outlineColor: [6, 12, 22, 255], fontSettings: { sdf: true } }),
            new TextLayer<Site>({ id: 'site-labels', data: catalog.sites, getPosition: s => labelPos(s), getText: s => `${s.short.toUpperCase()}  ${L.agg.groups.site.get(s.id)?.count ?? 0}`,
              getSize: 14, getColor: d => (siteSet.size && !siteSet.has(d.id) ? [232, 238, 247, 90] : [232, 238, 247, 255]), getTextAnchor: 'start', getAlignmentBaseline: 'bottom',
              fontFamily: '"Barlow Condensed", "Arial Narrow", sans-serif', fontWeight: 600, characterSet: 'auto', background: true, getBackgroundColor: [6, 12, 22, 200], backgroundPadding: [6, 3, 6, 3],
              updateTriggers: { getText: L.agg, getColor: [...siteSet].join() } }),
          ].filter(Boolean),
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [moving, roads, catalog, reduced]);

  // interacción
  const onOverlay = useMemo(() => (o: MapboxOverlay) => {
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

  // volar al equipo seleccionado, dejando espacio para el panel de detalle
  useEffect(() => {
    if (!selected) return;
    const eq = fleet.find(e => e.id === selected), map = mapRef.current; if (!eq || !map) return;
    const wide = window.innerWidth > 860;
    map.flyTo({ center: [eq.lon, eq.lat], zoom: Math.max(map.getZoom(), 10.4), padding: { right: wide ? 380 : 0, left: 0, top: 0, bottom: wide ? 0 : 260 }, duration: reduced ? 0 : 1400, essential: true });
  }, [selected, fleet, reduced]);

  const b = catalog.bbox;
  const offStyle = useMemo(() => (offline ? offlineStyle(makeTerrain(catalog.bbox)) : null), [offline, catalog.bbox]);
  const mapStyle = offStyle ? offStyle : basemap === 'satellite' ? SAT_STYLE : DARK_STYLE;
  return (
    <Map
      ref={mapRef}
      initialViewState={{ bounds: [[b.lonMin, b.latMin], [b.lonMax, b.latMax]], fitBoundsOptions: { padding: 24 } }}
      mapStyle={mapStyle}
      onMove={e => { latest.current.zoom = e.viewState.zoom; }}
      onError={e => { const msg = String((e as { error?: Error }).error?.message ?? ''); if (!offline && /style|fetch|Failed|NetworkError|AJAXError/i.test(msg)) setOffline(true); }}
      attributionControl={{ compact: true }}
      dragRotate={false}
      maxZoom={16}
      minZoom={6}
      style={{ position: 'absolute', inset: 0 }}
    >
      <DeckOverlay onReady={onOverlay} />
    </Map>
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

export function MapTooltip({ hover, agg, catalog, index }: { hover: Hover | null; agg: Aggregates; catalog: Catalog; index: Map<string, number> }) {
  const live = useUi(s => s.live);
  if (!hover) return null;
  const style = { transform: `translate(${hover.x + 16}px, ${hover.y + 16}px)` };
  if (hover.kind === 'eq') {
    const eq = hover.eq, p = agg.per[index.get(eq.id) ?? 0], st = catalog.states.find(s => s.id === (live[eq.id]?.state ?? 'off'))!;
    const site = catalog.sites.find(s => s.id === eq.siteId)!;
    return (
      <div className="map-tip" style={style}>
        <b>{eq.id}</b> <span className="pill" style={{ color: st.color, marginLeft: 6 }}>{st.name}</span>
        <div className="tip-sub">{eq.model} · {site.short}</div>
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
