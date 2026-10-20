import type { Billing, Catalog, DailyMetrics, Equipment, LiveStatus } from './types';
import { demoApi } from '../demo/mockApi';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
/** VITE_DEMO=1: simulador dentro del navegador (vista previa sin servidor). */
export const DEMO = import.meta.env.VITE_DEMO === '1';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`La API respondió ${res.status} en ${path}`);
  return res.json() as Promise<T>;
}

function socketUrl() {
  const u = new URL(BASE || window.location.origin);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/api/v1/live/ws';
  return u.toString();
}

const httpApi = {
  health: () => get<{ ok: boolean; provider: string }>('/api/v1/health'),
  catalog: () => get<Catalog>('/api/v1/catalog'),
  fleet: () => get<Equipment[]>('/api/v1/fleet'),
  daily: (from?: string, to?: string) => get<DailyMetrics>(`/api/v1/metrics/daily?${new URLSearchParams({ ...(from && { from }), ...(to && { to }) })}`),
  live: () => get<LiveStatus[]>('/api/v1/live'),
  billing: (id: string, from: string, to: string) => get<Billing>(`/api/v1/equipment/${encodeURIComponent(id)}/billing?from=${from}&to=${to}`),
  /** WebSocket con reconexión exponencial. */
  subscribeLive(cb: (ev: LiveStatus) => void) {
    let ws: WebSocket | null = null, retry = 0, stop = false, timer = 0;
    const open = () => {
      ws = new WebSocket(socketUrl());
      ws.onopen = () => { retry = 0; };
      ws.onmessage = e => cb(JSON.parse(e.data) as LiveStatus);
      ws.onclose = () => { if (!stop) timer = window.setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++)); };
    };
    open();
    return () => { stop = true; clearTimeout(timer); ws?.close(); };
  },
};

export const api: typeof httpApi = DEMO ? demoApi : httpApi;
