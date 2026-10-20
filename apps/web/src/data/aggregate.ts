/* Agregación con filtros cruzados (tipo crossfilter).
 * Cada dimensión se agrega ignorando su propio filtro, como en un BI.
 * Recorre nEquipos × nDías una vez: ~18 mil celdas, < 2 ms. */
import type { DailyMetrics, Equipment, LiveStatus } from '../api/types';
import type { Dim } from './store';

export interface Series { work: Float32Array; idle: Float32Array; standby: Float32Array; down: Float32Array; fuel: Float32Array }
export interface PerEq { work: number; idle: number; standby: number; down: number; fuel: number; billed: number; potential: number }
export interface Group { key: string; count: number; work: number; standby: number; down: number; billed: number; potential: number }
export interface Kpi {
  count: number; work: number; idle: number; standby: number; down: number; fuel: number; billed: number; potential: number;
  prevWork: number; prevStandby: number; prevBilled: number; prevPotential: number; prevHours: number;
  util: number; prevUtil: number; leak: number; prevLeak: number; states: Record<string, number>;
}
export interface Aggregates {
  per: PerEq[]; visible: Uint8Array; groups: Record<Dim, Map<string, Group>>; kpi: Kpi;
  daily: { work: Float64Array; idle: Float64Array; standby: Float64Array; down: Float64Array; billed: Float64Array };
}

export function toSeries(m: DailyMetrics): Series {
  return { work: Float32Array.from(m.work), idle: Float32Array.from(m.idle), standby: Float32Array.from(m.standby), down: Float32Array.from(m.down), fuel: Float32Array.from(m.fuel) };
}

const DIMS: Dim[] = ['state', 'type', 'site', 'client'];

export function keyOf(eq: Equipment, dim: Dim, live: Record<string, LiveStatus>): string {
  return dim === 'type' ? eq.typeId : dim === 'site' ? eq.siteId : dim === 'client' ? eq.clientId : live[eq.id]?.state ?? 'off';
}

export function aggregate(
  fleet: Equipment[], s: Series, nDays: number, range: { from: number; to: number },
  filters: Record<Dim, string[]>, live: Record<string, LiveStatus>,
): Aggregates {
  const { from, to } = range, len = to - from + 1, pFrom = Math.max(0, from - len), pTo = from - 1;
  const sets = Object.fromEntries(DIMS.map(d => [d, new Set(filters[d])])) as Record<Dim, Set<string>>;
  const passes = (eq: Equipment, except?: Dim) => DIMS.every(d => d === except || !sets[d].size || sets[d].has(keyOf(eq, d, live)));

  const prev: { w: number; s: number; d: number }[] = [];
  const per: PerEq[] = fleet.map((eq, e) => {
    const base = e * nDays;
    let w = 0, i = 0, sb = 0, d = 0, f = 0, pw = 0, ps = 0, pd = 0;
    for (let k = base + from; k <= base + to; k++) { w += s.work[k]; i += s.idle[k]; sb += s.standby[k]; d += s.down[k]; f += s.fuel[k]; }
    for (let k = base + pFrom; k <= base + pTo; k++) { pw += s.work[k]; ps += s.standby[k]; pd += s.down[k]; }
    prev.push({ w: pw, s: ps, d: pd });
    return { work: w, idle: i, standby: sb, down: d, fuel: f, billed: w * eq.rate + sb * eq.rate * eq.standbyFactor, potential: (w + sb + d) * eq.rate };
  });

  const groups = {} as Record<Dim, Map<string, Group>>;
  for (const dim of DIMS) {
    const g = new Map<string, Group>();
    fleet.forEach((eq, e) => {
      if (!passes(eq, dim)) return;
      const key = keyOf(eq, dim, live), p = per[e];
      const row = g.get(key) ?? { key, count: 0, work: 0, standby: 0, down: 0, billed: 0, potential: 0 };
      row.count++; row.work += p.work; row.standby += p.standby; row.down += p.down; row.billed += p.billed; row.potential += p.potential;
      g.set(key, row);
    });
    groups[dim] = g;
  }

  const k: Kpi = { count: 0, work: 0, idle: 0, standby: 0, down: 0, fuel: 0, billed: 0, potential: 0, prevWork: 0, prevStandby: 0, prevBilled: 0, prevPotential: 0, prevHours: 0, util: 0, prevUtil: 0, leak: 0, prevLeak: 0, states: {} };
  const daily = { work: new Float64Array(nDays), idle: new Float64Array(nDays), standby: new Float64Array(nDays), down: new Float64Array(nDays), billed: new Float64Array(nDays) };
  const visible = new Uint8Array(fleet.length);
  fleet.forEach((eq, e) => {
    if (!passes(eq)) return;
    visible[e] = 1;
    const p = per[e], q = prev[e];
    k.count++; k.work += p.work; k.idle += p.idle; k.standby += p.standby; k.down += p.down; k.fuel += p.fuel; k.billed += p.billed; k.potential += p.potential;
    k.prevWork += q.w; k.prevStandby += q.s; k.prevHours += q.w + q.s + q.d;
    k.prevBilled += q.w * eq.rate + q.s * eq.rate * eq.standbyFactor; k.prevPotential += (q.w + q.s + q.d) * eq.rate;
    const st = live[eq.id]?.state ?? 'off'; k.states[st] = (k.states[st] ?? 0) + 1;
    const base = e * nDays, sf = eq.rate * eq.standbyFactor;
    for (let d = 0; d < nDays; d++) {
      const w = s.work[base + d], sb = s.standby[base + d];
      daily.work[d] += w; daily.idle[d] += s.idle[base + d]; daily.standby[d] += sb; daily.down[d] += s.down[base + d];
      daily.billed[d] += w * eq.rate + sb * sf;
    }
  });
  k.util = k.work / Math.max(1e-9, k.work + k.standby + k.down);
  k.prevUtil = k.prevWork / Math.max(1e-9, k.prevHours);
  k.leak = k.potential - k.billed;
  k.prevLeak = k.prevPotential - k.prevBilled;
  return { per, visible, groups, kpi: k, daily };
}
