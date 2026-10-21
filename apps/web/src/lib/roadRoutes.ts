/* Ajusta los recorridos de las volquetas a la red vial real de Mapbox (Directions API).
 * El simulador sólo trae un tramo aproximado (Natural Earth, generalizado a cientos de metros);
 * aquí se pide la ruta por carretera entre sus extremos y se cachea en el navegador. */
import { useEffect, useMemo, useState } from 'react';
import type { Equipment, LatLon, Site } from '../api/types';

const CACHE_KEY = 'fleetmap.roads.v1';

function readCache(): Record<string, LatLon[]> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}'); } catch { return {}; }
}
function writeCache(c: Record<string, LatLon[]>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* sin almacenamiento */ }
}

const keyOf = (r: LatLon[]) => [r[0], r[r.length - 1]].map(([la, lo]) => `${la.toFixed(4)},${lo.toFixed(4)}`).join(';');

async function directions(route: LatLon[], token: string, signal: AbortSignal, all = false): Promise<LatLon[] | null> {
  const pts = all ? route.slice(0, 25) : [route[0], route[route.length - 1]];
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${pts.map(([la, lo]) => `${lo},${la}`).join(';')}?geometries=geojson&overview=full&access_token=${token}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const coords = (await res.json()).routes?.[0]?.geometry?.coordinates as [number, number][] | undefined;
  return coords && coords.length > 1 ? coords.map(([lo, la]) => [la, lo] as LatLon) : null;
}

/** Devuelve la flota con `route` ajustada a vías reales (o la original si no hay token o falla). */
export function useRoadSnappedFleet(fleet: Equipment[], token: string): Equipment[] {
  const [snapped, setSnapped] = useState<Record<string, LatLon[]>>(() => (token ? readCache() : {}));

  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController(), cache = readCache();
    const pending = [...new Map(fleet.filter(e => e.route && !cache[keyOf(e.route)]).map(e => [keyOf(e.route!), e.route!])).entries()];
    if (!pending.length) return;
    (async () => {
      for (const [k, r] of pending) {
        try { const g = await directions(r, token, ctrl.signal); if (g) cache[k] = g; } catch { if (ctrl.signal.aborted) return; }
      }
      writeCache(cache); setSnapped({ ...cache });
    })();
    return () => ctrl.abort();
  }, [fleet, token]);

  return useMemo(() => fleet.map(e => {
    const g = e.route && snapped[keyOf(e.route)];
    return g ? { ...e, route: g } : e;
  }), [fleet, snapped]);
}

// --- corredores de proyecto -------------------------------------------------------------
// El servidor ubica los equipos sobre el eje recto entre los puntos del corredor; con Mapbox
// se reemplaza ese eje por la carretera real y cada equipo se lleva a la misma fracción del
// recorrido (y al mismo lado de la vía).

const SITE_KEY = 'fleetmap.corridors.v1';
const siteKey = (p: LatLon[]) => p.map(([la, lo]) => `${la.toFixed(4)},${lo.toFixed(4)}`).join(';');

function measure(path: LatLon[]) {
  const acc = [0];
  for (let i = 1; i < path.length; i++) acc.push(acc[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return acc;
}

/** Fracción a lo largo del recorrido y desplazamiento lateral (grados, + a la izquierda) del punto más cercano. */
function project(path: LatLon[], acc: number[], p: LatLon) {
  let best = { d: Infinity, f: 0, side: 0 };
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]], vx = b[1] - a[1], vy = b[0] - a[0], L2 = vx * vx + vy * vy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[1] - a[1]) * vx + (p[0] - a[0]) * vy) / L2));
    const qx = a[1] + vx * t, qy = a[0] + vy * t, d = Math.hypot(p[1] - qx, p[0] - qy);
    if (d < best.d) best = { d, f: (acc[i - 1] + t * Math.sqrt(L2)) / (acc[acc.length - 1] || 1), side: Math.sign(vx * (p[0] - a[0]) - vy * (p[1] - a[1])) * d };
  }
  return best;
}

function at(path: LatLon[], acc: number[], f: number, side: number): LatLon {
  const d = f * acc[acc.length - 1];
  let i = 1;
  while (i < path.length - 1 && acc[i] < d) i++;
  const [a, b] = [path[i - 1], path[i]], seg = acc[i] - acc[i - 1] || 1e-12, t = (d - acc[i - 1]) / seg;
  const ux = (b[1] - a[1]) / seg, uy = (b[0] - a[0]) / seg;
  return [a[0] + (b[0] - a[0]) * t + ux * side, a[1] + (b[1] - a[1]) * t - uy * side];
}

/** Corredores siguiendo la vía real (Mapbox Directions) y equipos reubicados sobre ellos. */
export function useRoadSnappedSites(sites: Site[], fleet: Equipment[], token: string): { sites: Site[]; fleet: Equipment[] } {
  const [roads, setRoads] = useState<Record<string, LatLon[]>>(() => {
    if (!token) return {};
    try { return JSON.parse(localStorage.getItem(SITE_KEY) ?? '{}'); } catch { return {}; }
  });

  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController(), cache = { ...roads };
    const pending = sites.filter(s => !s.provisional && s.path && s.path.length > 1 && !cache[siteKey(s.path)]);
    if (!pending.length) return;
    (async () => {
      for (const s of pending) {
        try { const g = await directions(s.path!, token, ctrl.signal, true); if (g) cache[siteKey(s.path!)] = g; } catch { if (ctrl.signal.aborted) return; }
      }
      try { localStorage.setItem(SITE_KEY, JSON.stringify(cache)); } catch { /* sin almacenamiento */ }
      setRoads(cache);
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, token]);

  return useMemo(() => {
    const snapped = new Map<string, { from: LatLon[]; fromAcc: number[]; to: LatLon[]; toAcc: number[] }>();
    const outSites = sites.map(s => {
      const road = s.path && roads[siteKey(s.path)];
      if (!road) return s;
      const toAcc = measure(road), [lat, lon] = at(road, toAcc, 0.5, 0);
      snapped.set(s.id, { from: s.path!, fromAcc: measure(s.path!), to: road, toAcc });
      // centro (círculo, arcos y etiqueta) a mitad del recorrido vial, no de la recta
      return { ...s, path: road, lat, lon };
    });
    if (!snapped.size) return { sites, fleet };
    const outFleet = fleet.map(e => {
      const c = snapped.get(e.siteId);
      if (!c) return e;
      const { f, side } = project(c.from, c.fromAcc, [e.lat, e.lon]);
      const [lat, lon] = at(c.to, c.toAcc, f, side);
      return { ...e, lat, lon };
    });
    return { sites: outSites, fleet: outFleet };
  }, [sites, fleet, roads]);
}
