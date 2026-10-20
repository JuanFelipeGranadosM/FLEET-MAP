import type { Billing, Catalog, DailyMetrics, Equipment, LiveStatus } from './types';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`La API respondió ${res.status} en ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<{ ok: boolean; provider: string }>('/api/v1/health'),
  catalog: () => get<Catalog>('/api/v1/catalog'),
  fleet: () => get<Equipment[]>('/api/v1/fleet'),
  daily: (from?: string, to?: string) => get<DailyMetrics>(`/api/v1/metrics/daily?${new URLSearchParams({ ...(from && { from }), ...(to && { to }) })}`),
  live: () => get<LiveStatus[]>('/api/v1/live'),
  billing: (id: string, from: string, to: string) => get<Billing>(`/api/v1/equipment/${encodeURIComponent(id)}/billing?from=${from}&to=${to}`),
  liveSocketUrl() {
    const u = new URL(BASE || window.location.origin);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/api/v1/live/ws';
    return u.toString();
  },
};
