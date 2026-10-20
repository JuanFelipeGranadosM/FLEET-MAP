import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api/client';
import { FleetMap, MapTooltip, type Hover } from './components/FleetMap';
import { Header } from './components/Header';
import { Kpis } from './components/Kpis';
import { Sidebar } from './components/Sidebar';
import { Timeline } from './components/Timeline';
import { DetailPanel } from './components/DetailPanel';
import { RightPanel } from './components/RightPanel';
import { useAggregates, useFleetData, useLiveSocket } from './data/useFleet';
import { useUi } from './data/store';

export function App() {
  const data = useFleetData();
  useLiveSocket(data.ready);
  const agg = useAggregates(data);
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: Infinity });
  const [hover, setHover] = useState<Hover | null>(null);
  const filters = useUi(s => s.filters), toggle = useUi(s => s.toggle), layer = useUi(s => s.layer), basemap = useUi(s => s.basemap), set = useUi(s => s.set);
  const selected = useUi(s => s.selected), select = useUi(s => s.select);
  const index = useMemo(() => new Map((data.fleet ?? []).map((e, i) => [e.id, i])), [data.fleet]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') select(null); };
    addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey);
  }, [select]);

  if (data.error) return <div className="splash"><b>No se pudo cargar la flota</b><span>{String((data.error as Error).message)}. Revise que la API esté corriendo en el puerto 8000.</span></div>;
  if (!data.ready || !agg || !data.catalog || !data.fleet || !data.days || !data.series) return <div className="splash"><span className="loader" />Cargando telemetría…</div>;
  const { catalog, fleet, days, series } = data;
  const labelOf: Record<string, (k: string) => string | undefined> = {
    state: k => catalog.states.find(s => s.id === k)?.name, type: k => catalog.types.find(t => t.id === k)?.name,
    site: k => catalog.sites.find(s => s.id === k)?.short, client: k => catalog.clients.find(c => c.id === k)?.name,
  };
  const selIdx = selected ? index.get(selected) : undefined;

  return (
    <div className="app">
      <Header days={days} provider={health.data?.provider ?? 'mock'} />
      <Kpis agg={agg} catalog={catalog} total={fleet.length} />
      <main className="body">
        <Sidebar agg={agg} catalog={catalog} />
        <div className="stage">
          <div className="map-wrap">
            <FleetMap catalog={catalog} fleet={fleet} agg={agg} onHover={setHover} />
            <div className="layers">
              <div className="seg" role="group" aria-label="Capa del mapa">
                <button type="button" aria-pressed={layer === 'state'} onClick={() => set('layer', 'state')}>Estado</button>
                <button type="button" aria-pressed={layer === 'heat'} onClick={() => set('layer', 'heat')}>Calor de horas</button>
              </div>
              <div className="seg" role="group" aria-label="Mapa base">
                <button type="button" aria-pressed={basemap === 'dark'} onClick={() => set('basemap', 'dark')}>Oscuro</button>
                <button type="button" aria-pressed={basemap === 'satellite'} onClick={() => set('basemap', 'satellite')}>Satélite</button>
              </div>
              <div className="active-filters">
                {(Object.keys(filters) as (keyof typeof filters)[]).flatMap(dim => filters[dim].map(k => (
                  <button key={dim + k} type="button" className="af" onClick={() => toggle(dim, k, true)}>
                    <span>{{ state: 'Estado', type: 'Tipo', site: 'Obra', client: 'Cliente' }[dim]}</span>{labelOf[dim](k)} ✕
                  </button>
                )))}
              </div>
            </div>
            <div className="legend">{catalog.states.map(s => <span key={s.id}><i style={{ background: s.color, color: s.color }} />{s.name}</span>)}</div>
            <MapTooltip hover={hover} agg={agg} catalog={catalog} index={index} />
            {selected && selIdx !== undefined && <DetailPanel eq={fleet[selIdx]} idx={selIdx} agg={agg} series={series} days={days} catalog={catalog} />}
          </div>
          <Timeline agg={agg} days={days} />
        </div>
        <RightPanel agg={agg} fleet={fleet} catalog={catalog} />
      </main>
    </div>
  );
}
