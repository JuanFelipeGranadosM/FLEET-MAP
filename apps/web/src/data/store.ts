import { create } from 'zustand';
import type { LiveStatus, StateId } from '../api/types';

export type Dim = 'state' | 'type' | 'site' | 'client';
export type Metric = 'work' | 'billed' | 'util';

interface UiState {
  /** índices de día (inclusive) sobre la serie histórica */
  range: { from: number; to: number };
  filters: Record<Dim, string[]>;
  selected: string | null;
  metric: Metric;
  layer: 'state' | 'heat';
  basemap: 'dark' | 'satellite';
  rankBy: 'leak' | 'work';
  live: Record<string, LiveStatus>;
  events: LiveStatus[];
  setRange(from: number, to: number, nDays: number): void;
  toggle(dim: Dim, key: string, additive?: boolean): void;
  clear(dim?: Dim): void;
  select(id: string | null): void;
  set<K extends 'metric' | 'layer' | 'basemap' | 'rankBy'>(k: K, v: UiState[K]): void;
  setLive(all: LiveStatus[]): void;
  pushEvent(ev: LiveStatus): void;
}

const empty = (): Record<Dim, string[]> => ({ state: [], type: [], site: [], client: [] });
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const useUi = create<UiState>((set) => ({
  range: { from: 0, to: 0 },
  filters: empty(),
  selected: null,
  metric: 'work',
  layer: 'state',
  basemap: 'dark',
  rankBy: 'leak',
  live: {},
  events: [],
  setRange: (from, to, nDays) => set(s => {
    const f = clamp(Math.round(from), 0, nDays - 1), t = clamp(Math.round(to), f, nDays - 1);
    return f === s.range.from && t === s.range.to ? s : { range: { from: f, to: t } };
  }),
  toggle: (dim, key, additive = false) => set(s => {
    const cur = s.filters[dim];
    let next: string[];
    if (additive) next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    else next = cur.length === 1 && cur[0] === key ? [] : [key];
    return { filters: { ...s.filters, [dim]: next } };
  }),
  clear: dim => set(s => ({ filters: dim ? { ...s.filters, [dim]: [] } : empty() })),
  select: id => set({ selected: id }),
  set: (k, v) => set({ [k]: v } as Partial<UiState>),
  setLive: all => set({ live: Object.fromEntries(all.map(s => [s.id, s])) }),
  pushEvent: ev => set(s => ({
    live: { ...s.live, [ev.id]: { ...s.live[ev.id], ...ev } },
    events: [ev, ...s.events].slice(0, 40),
  })),
}));

export const stateOf = (live: Record<string, LiveStatus>, id: string): StateId => live[id]?.state ?? 'off';
