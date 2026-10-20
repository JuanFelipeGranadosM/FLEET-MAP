/* Ajusta los recorridos de las volquetas a la red vial real de Mapbox (Directions API).
 * El simulador sólo trae un tramo aproximado (Natural Earth, generalizado a cientos de metros);
 * aquí se pide la ruta por carretera entre sus extremos y se cachea en el navegador. */
import { useEffect, useMemo, useState } from 'react';
import type { Equipment, LatLon } from '../api/types';

const CACHE_KEY = 'fleetmap.roads.v1';

function readCache(): Record<string, LatLon[]> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}'); } catch { return {}; }
}
function writeCache(c: Record<string, LatLon[]>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* sin almacenamiento */ }
}

const keyOf = (r: LatLon[]) => [r[0], r[r.length - 1]].map(([la, lo]) => `${la.toFixed(4)},${lo.toFixed(4)}`).join(';');

async function directions(route: LatLon[], token: string, signal: AbortSignal): Promise<LatLon[] | null> {
  const [a, b] = [route[0], route[route.length - 1]];
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${a[1]},${a[0]};${b[1]},${b[0]}?geometries=geojson&overview=full&access_token=${token}`;
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
