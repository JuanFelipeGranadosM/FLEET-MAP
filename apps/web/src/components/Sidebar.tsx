import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { Catalog } from '../api/types';
import type { Aggregates, Group } from '../data/aggregate';
import { useUi, type Dim, type Metric } from '../data/store';
import { ReactECharts, echarts, baseText, tooltipStyle } from '../lib/echarts';
import { COLORS, fmt } from '../lib/format';

const valueOf = (m: Metric, r: Group) => (m === 'work' ? r.work : m === 'billed' ? r.billed : r.work / Math.max(1e-9, r.work + r.standby + r.down));
const fmtOf = (m: Metric, v: number) => (m === 'work' ? fmt.hours(v) : m === 'billed' ? fmt.money(v) : fmt.pct(v));

/** Barra horizontal ECharts: clic filtra, Ctrl/⌘/Shift + clic suma opciones. */
function DimChart({ dim, keys, label, agg }: { dim: Dim; keys: string[]; label(k: string): string; agg: Aggregates }) {
  const metric = useUi(s => s.metric), selected = useUi(s => s.filters[dim]), toggle = useUi(s => s.toggle);
  const rows = useMemo(() => {
    const g = agg.groups[dim];
    return keys.map(k => g.get(k) ?? { key: k, count: 0, work: 0, standby: 0, down: 0, billed: 0, potential: 0 }).sort((a, b) => valueOf(metric, b) - valueOf(metric, a));
  }, [agg, dim, keys, metric]);

  const option = useMemo<EChartsOption>(() => {
    const dimmed = (k: string) => selected.length > 0 && !selected.includes(k);
    const cats = rows.map(r => r.key).reverse();
    const byKey = new Map(rows.map(r => [r.key, r]));
    const bar = (v: number, k: string, color: string) => ({ value: v, itemStyle: { color, opacity: dimmed(k) ? 0.3 : 1, borderRadius: 3 } });
    const series: EChartsOption['series'] = metric === 'work'
      ? [
          { type: 'bar', stack: 'h', name: 'Trabajadas', barWidth: 8, data: cats.map(k => bar(byKey.get(k)!.work, k, COLORS.op)) },
          { type: 'bar', stack: 'h', name: 'Standby', barWidth: 8, data: cats.map(k => bar(byKey.get(k)!.standby, k, COLORS.standby)) },
        ]
      : [{ type: 'bar', name: metric === 'billed' ? 'Facturación' : 'Utilización', barWidth: 8, data: cats.map(k => {
          const v = valueOf(metric, byKey.get(k)!);
          return bar(v, k, metric === 'billed' ? COLORS.accent : v > 0.6 ? COLORS.op : v > 0.4 ? COLORS.accent : COLORS.down);
        }) }];
    return {
      animationDurationUpdate: 500, animationEasingUpdate: 'cubicOut',
      grid: { left: 2, right: 58, top: 2, bottom: 2, containLabel: true },
      xAxis: { type: 'value', show: false, max: metric === 'util' ? 1 : undefined },
      yAxis: { type: 'category', data: cats, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#e8eef7', fontFamily: '"IBM Plex Sans", sans-serif', fontSize: 12, width: 112, overflow: 'truncate',
          formatter: (k: string) => `${label(k)} {c|${byKey.get(k)!.count}}`, rich: { c: { ...baseText } } } },
      tooltip: { ...tooltipStyle, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,201,77,.06)' } },
        formatter: (p: unknown) => {
          const ps = p as { name: string }[]; const r = byKey.get(ps[0].name)!;
          return `<b>${label(r.key)}</b><br/>${r.count} equipos<br/>Trabajadas ${fmt.hours(r.work)}<br/>Standby ${fmt.hours(r.standby)}<br/>Facturación ${fmt.money(r.billed)}`;
        } },
      series: [
        ...(series as object[]),
        // etiqueta de valor a la derecha
        { type: 'bar', stack: metric === 'work' ? 'h' : undefined, barGap: '-100%', barWidth: 8, silent: true, itemStyle: { color: 'transparent' },
          label: { show: true, position: 'right', ...baseText, color: '#e8eef7', formatter: (p: { name: string }) => fmtOf(metric, valueOf(metric, byKey.get(p.name)!)) },
          data: cats.map(() => 0) },
      ] as EChartsOption['series'],
    };
  }, [rows, metric, selected, label]);

  return (
    <ReactECharts echarts={echarts} option={option} notMerge style={{ height: rows.length * 26 + 8, width: '100%' }}
      onEvents={{ click: (p: { name: string; event?: { event?: MouseEvent } }) => { const e = p.event?.event; toggle(dim, p.name, !!(e && (e.ctrlKey || e.metaKey || e.shiftKey))); } }} />
  );
}

export function Sidebar({ agg, catalog }: { agg: Aggregates; catalog: Catalog }) {
  const filters = useUi(s => s.filters), metric = useUi(s => s.metric), set = useUi(s => s.set), toggle = useUi(s => s.toggle), clear = useUi(s => s.clear);
  const any = Object.values(filters).some(f => f.length);
  const labels = useMemo(() => ({
    type: (k: string) => catalog.types.find(t => t.id === k)?.name ?? k,
    site: (k: string) => catalog.sites.find(s => s.id === k)?.short ?? k,
    client: (k: string) => catalog.clients.find(c => c.id === k)?.name ?? k,
  }), [catalog]);
  const keys = useMemo(() => ({ type: catalog.types.map(t => t.id), site: catalog.sites.map(s => s.id), client: catalog.clients.map(c => c.id) }), [catalog]);
  const head = (dim: Dim, title: string) => (
    <div className="sec-head"><h3>{title}</h3>{filters[dim].length > 0 && <button type="button" className="link" onClick={() => clear(dim)}>Quitar</button>}</div>
  );
  return (
    <aside className="side panel" aria-label="Filtros">
      <div className="side-head"><h2>Filtros</h2>{any && <button type="button" className="link" onClick={() => clear()}>Limpiar todo</button>}</div>
      <div>
        <div className="sec-head"><h3>Medir por</h3></div>
        <div className="seg full" role="group" aria-label="Métrica de las barras">
          {([['work', 'Horas'], ['billed', 'Facturación'], ['util', 'Utilización']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={metric === k} onClick={() => set('metric', k)}>{l}</button>
          ))}
        </div>
      </div>
      <section className={filters.state.length ? 'dimmed' : ''}>
        {head('state', 'Estado en vivo')}
        <div className="chips">
          {catalog.states.map(s => (
            <button key={s.id} type="button" className="chip" aria-pressed={filters.state.includes(s.id)} onClick={e => toggle('state', s.id, e.ctrlKey || e.metaKey || e.shiftKey)}>
              <i style={{ background: s.color }} />{s.name}<b>{agg.groups.state.get(s.id)?.count ?? 0}</b>
            </button>
          ))}
        </div>
      </section>
      <section>{head('type', 'Tipo de equipo')}<DimChart dim="type" keys={keys.type} label={labels.type} agg={agg} /></section>
      <section>{head('site', 'Obra')}<DimChart dim="site" keys={keys.site} label={labels.site} agg={agg} /></section>
      <section>{head('client', 'Cliente')}<DimChart dim="client" keys={keys.client} label={labels.client} agg={agg} /></section>
      <p className="hint">Clic para filtrar todo el tablero. Ctrl/⌘ + clic suma varias opciones.</p>
    </aside>
  );
}
