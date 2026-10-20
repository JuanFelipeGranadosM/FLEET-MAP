/* Modo demo: la misma interfaz que la API FastAPI, pero simulada en el navegador.
 * Se activa con VITE_DEMO=1 (vista previa en un solo HTML, sin servidor). */
import type { Billing, DailyMetrics, Equipment, LatLon, LiveStatus, StateId } from '../api/types';
import { CATALOG, MIX } from './catalog';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FAULTS = ['SPN 110 · Temp. refrigerante alta', 'SPN 100 · Presión aceite baja', 'SPN 190 · Sobrevelocidad motor', 'Filtro hidráulico obstruido', 'Nivel DEF bajo'];
const DAY = 864e5;

function build() {
  const r = rng(20261020), C = CATALOG;
  const near = (p: LatLon, s: { lat: number; lon: number }) => Math.abs(p[0] - s.lat) < 0.02 && Math.abs(p[1] - s.lon) < 0.02;
  const fleet: Equipment[] = [], params: [number, number, number][] = [];
  let n = 0;
  for (const site of C.sites) {
    const touching = C.roads.filter(rd => near(rd[0], site) || near(rd[rd.length - 1], site));
    for (const [typeId, count] of Object.entries(MIX[site.id])) {
      const t = C.types.find(x => x.id === typeId)!;
      for (let k = 0; k < count; k++) {
        n++;
        const model = t.models[Math.floor(r() * t.models.length)], ang = r() * Math.PI * 2, dist = Math.sqrt(r()) * site.radius;
        let route: LatLon[] | null = null;
        if (typeId === 'VOL' && touching.length) { const rd = touching[Math.floor(r() * touching.length)]; route = near(rd[0], site) ? rd : [...rd].reverse(); }
        fleet.push({
          id: `${typeId}-${String(n).padStart(3, '0')}`, pin: 'PIN' + Math.floor(1e7 + r() * 9e7), oem: model.split(' ')[0], model, typeId,
          siteId: site.id, clientId: site.client, lat: site.lat + Math.sin(ang) * dist, lon: site.lon + Math.cos(ang) * dist * 1.1,
          rate: Math.round(t.rate * (0.92 + r() * 0.16)), standbyFactor: C.standbyFactor, year: 2016 + Math.floor(r() * 10),
          hourMeter: Math.round(2000 + r() * 16000), route,
        });
        params.push([0.45 + r() * 0.5, 0.08 + r() * 0.22, t.fuel * (0.9 + r() * 0.2)]);
      }
    }
  }
  const end = Date.parse(C.today + 'T00:00:00Z') / DAY, nDays = C.historyDays + 1, start = end - C.historyDays, N = fleet.length * nDays;
  const m = { work: new Array<number>(N).fill(0), idle: new Array<number>(N).fill(0), standby: new Array<number>(N).fill(0), down: new Array<number>(N).fill(0), fuel: new Array<number>(N).fill(0) };
  const phase = Object.fromEntries(C.sites.map(s => [s.id, r() * 6.28]));
  fleet.forEach((eq, e) => {
    const site = C.sites.find(s => s.id === eq.siteId)!, [prop, idleR, fuelR] = params[e];
    let downLeft = 0;
    for (let d = 0; d < nDays; d++) {
      const dow = (new Date((start + d) * DAY).getUTCDay() + 6) % 7, shift = dow < 5 ? 10 : dow === 5 ? 6 : site.sunday ? 6 : 0, i = e * nDays + d;
      if (downLeft <= 0 && r() < 0.012) downLeft = 1 + Math.floor(r() * 5);
      if (!shift) { downLeft = Math.max(0, downLeft - 1); continue; }
      if (downLeft > 0) { downLeft--; m.down[i] = shift; continue; }
      const act = 0.78 + 0.22 * Math.sin(d / 23 + phase[eq.siteId]), util = Math.min(0.98, Math.max(0, prop * act * (0.75 + r() * 0.5)));
      const w = shift * util, idle = w * idleR * (0.7 + r() * 0.6);
      m.work[i] = w; m.idle[i] = idle; m.standby[i] = shift - w; m.fuel[i] = (w - idle) * fuelR * (0.85 + r() * 0.3) + idle * fuelR * 0.22;
    }
  });
  const now = Date.now();
  const live: Record<string, LiveStatus> = {};
  fleet.forEach((eq, e) => {
    const i = e * nDays + nDays - 1; let state: StateId;
    if (m.down[i] > 0) state = 'down'; else if (r() < 0.04) state = 'off';
    else { const p = m.work[i] / 10, x = r(); state = x < p * 0.85 ? 'op' : x < p ? 'idle' : 'standby'; }
    live[eq.id] = { id: eq.id, state, lat: eq.lat, lon: eq.lon, ts: now - Math.floor(r() * 9e5), fault: state === 'down' ? FAULTS[Math.floor(r() * FAULTS.length)] : null };
  });
  const days = Array.from({ length: nDays }, (_, d) => new Date((start + d) * DAY).toISOString().slice(0, 10));
  return { fleet, m, live, days, nDays };
}

let world: ReturnType<typeof build> | null = null;
const W = () => (world ??= build());
const later = <T,>(v: T) => new Promise<T>(res => setTimeout(() => res(v), 120));

function slice(from?: string, to?: string): DailyMetrics {
  const { fleet, m, days, nDays } = W();
  const a = Math.max(0, from ? days.indexOf(from) : 0), b = to ? days.indexOf(to) : nDays - 1;
  const cut = (src: number[]) => fleet.flatMap((_, e) => src.slice(e * nDays + a, e * nDays + b + 1));
  return { days: days.slice(a, b + 1), equipmentIds: fleet.map(f => f.id), work: cut(m.work), idle: cut(m.idle), standby: cut(m.standby), down: cut(m.down), fuel: cut(m.fuel) };
}

export const demoApi = {
  health: () => later({ ok: true, provider: 'demo' }),
  catalog: () => later(CATALOG),
  fleet: () => later(W().fleet),
  daily: (from?: string, to?: string) => later(slice(from, to)),
  live: () => later(Object.values(W().live).map(s => ({ ...s }))),
  billing(id: string, from: string, to: string): Promise<Billing> {
    const d = slice(from, to), e = d.equipmentIds.indexOf(id), n = d.days.length, eq = W().fleet[e];
    const sum = (k: 'work' | 'standby' | 'down') => d[k].slice(e * n, (e + 1) * n).reduce((x, y) => x + y, 0);
    const w = sum('work'), s = sum('standby'), dn = sum('down');
    const lines = [
      { concept: 'Horas trabajadas', hours: w, rate: eq.rate, factor: 1, amount: w * eq.rate },
      { concept: 'Standby', hours: s, rate: eq.rate, factor: eq.standbyFactor, amount: s * eq.rate * eq.standbyFactor },
    ];
    const total = lines[0].amount + lines[1].amount, potential = (w + s + dn) * eq.rate;
    return later({ equipmentId: id, dateFrom: d.days[0], dateTo: d.days[n - 1], currency: 'USD', lines, total, potential, notBilled: potential - total, utilization: w / (w + s + dn || 1) });
  },
  subscribeLive(cb: (ev: LiveStatus) => void) {
    const r = rng(Date.now() & 0xffff), live = W().live, ids = Object.keys(live);
    const t = setInterval(() => {
      const s = live[ids[Math.floor(r() * ids.length)]], prev = s.state, x = r();
      const next: StateId = prev === 'down' ? (x < 0.4 ? 'standby' : 'down') : prev === 'off' ? 'standby'
        : x < 0.5 ? 'op' : x < 0.68 ? 'idle' : x < 0.95 ? 'standby' : x < 0.985 ? 'down' : 'off';
      if (next === prev) return;
      s.state = next; s.ts = Date.now(); s.fault = next === 'down' ? FAULTS[Math.floor(r() * FAULTS.length)] : null;
      cb({ ...s, prev });
    }, 1800);
    return () => clearInterval(t);
  },
};
