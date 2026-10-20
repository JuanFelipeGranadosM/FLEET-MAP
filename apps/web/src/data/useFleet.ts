import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { aggregate, toSeries } from './aggregate';
import { useUi } from './store';

/** Carga catálogo, flota e historia completa una vez; los filtros se resuelven en el cliente. */
export function useFleetData() {
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: api.catalog, staleTime: Infinity });
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: api.fleet, staleTime: 5 * 60_000 });
  const daily = useQuery({ queryKey: ['daily'], queryFn: () => api.daily(), staleTime: 5 * 60_000 });
  const live = useQuery({ queryKey: ['live'], queryFn: api.live, staleTime: 60_000 });
  const setLive = useUi(s => s.setLive), setRange = useUi(s => s.setRange);

  const series = useMemo(() => (daily.data ? toSeries(daily.data) : null), [daily.data]);
  const nDays = daily.data?.days.length ?? 0;

  useEffect(() => { if (live.data) setLive(live.data); }, [live.data, setLive]);
  useEffect(() => { if (nDays) setRange(nDays - 30, nDays - 1, nDays); }, [nDays, setRange]);

  return {
    catalog: catalog.data, fleet: fleet.data, days: daily.data?.days, series, nDays,
    error: catalog.error ?? fleet.error ?? daily.error ?? live.error,
    ready: !!(catalog.data && fleet.data && series && live.data),
  };
}

/** Eventos de estado en vivo (WebSocket, o simulados en modo demo). */
export function useLiveSocket(enabled: boolean) {
  const pushEvent = useUi(s => s.pushEvent);
  useEffect(() => (enabled ? api.subscribeLive(pushEvent) : undefined), [enabled, pushEvent]);
}

export function useAggregates(d: ReturnType<typeof useFleetData>) {
  const range = useUi(s => s.range), filters = useUi(s => s.filters), live = useUi(s => s.live);
  return useMemo(
    () => (d.ready && d.fleet && d.series && range.to > 0 ? aggregate(d.fleet, d.series, d.nDays, range, filters, live) : null),
    [d.ready, d.fleet, d.series, d.nDays, range, filters, live],
  );
}
