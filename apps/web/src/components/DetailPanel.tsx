import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EChartsOption } from 'echarts';
import { api } from '../api/client';
import type { Catalog, Equipment } from '../api/types';
import type { Aggregates, Series } from '../data/aggregate';
import { useUi } from '../data/store';
import { ReactECharts, echarts, tooltipStyle } from '../lib/echarts';
import { COLORS, fmt } from '../lib/format';
import { machineIconUrl } from '../lib/machineIcons';

interface Props { eq: Equipment; idx: number; agg: Aggregates; series: Series; days: string[]; catalog: Catalog }

export function DetailPanel({ eq, idx, agg, series, days, catalog }: Props) {
  const range = useUi(s => s.range), live = useUi(s => s.live[eq.id]), select = useUi(s => s.select), toggle = useUi(s => s.toggle);
  const p = agg.per[idx], n = days.length, from = days[range.from], to = days[range.to];
  const st = catalog.states.find(s => s.id === (live?.state ?? 'off'))!;
  const type = catalog.types.find(t => t.id === eq.typeId)!, site = catalog.sites.find(s => s.id === eq.siteId)!, client = catalog.clients.find(c => c.id === eq.clientId)!;
  const util = p.work / Math.max(1e-9, p.work + p.standby + p.down);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  // La facturación oficial la calcula el servidor; mientras llega se muestra el cálculo local.
  const billing = useQuery({ queryKey: ['billing', eq.id, from, to], queryFn: () => api.billing(eq.id, from, to), staleTime: 60_000 });
  const local = { work: p.work * eq.rate, standby: p.standby * eq.rate * eq.standbyFactor, total: p.billed, potential: p.potential };
  const b = billing.data;
  const lines = b ? { work: b.lines[0].amount, standby: b.lines[1].amount, total: b.total, potential: b.potential } : local;

  const gauge = useMemo<EChartsOption>(() => ({
    series: [{
      type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100, radius: '100%', center: ['50%', '62%'],
      progress: { show: true, width: 10, roundCap: true, itemStyle: { color: util > 0.6 ? COLORS.op : util > 0.4 ? COLORS.accent : COLORS.down } },
      axisLine: { roundCap: true, lineStyle: { width: 10, color: [[1, 'rgba(20,40,70,.08)']] } },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, anchor: { show: false },
      title: { offsetCenter: [0, '38%'], color: COLORS.muted, fontSize: 10, fontFamily: '"IBM Plex Sans", sans-serif' },
      detail: { offsetCenter: [0, '0%'], valueAnimation: true, formatter: '{value}%', color: COLORS.fg, fontSize: 24, fontWeight: 600, fontFamily: '"Barlow Condensed", sans-serif' },
      data: [{ value: Math.round(util * 100), name: 'UTILIZACIÓN' }],
    }],
  }), [util]);

  const bars = useMemo<EChartsOption>(() => {
    const base = idx * n, xs = days.slice(range.from, range.to + 1), at = (a: Float32Array) => xs.map((_, i) => +a[base + range.from + i].toFixed(2));
    const work = at(series.work), idle = at(series.idle);
    const s = (name: string, color: string, data: number[]) => ({ type: 'bar' as const, name, stack: 'e', data, itemStyle: { color }, barCategoryGap: '20%' });
    return {
      grid: { left: 0, right: 0, top: 4, bottom: 0 }, xAxis: { type: 'category', data: xs, show: false }, yAxis: { type: 'value', show: false, max: 12 },
      tooltip: { ...tooltipStyle, trigger: 'axis', valueFormatter: v => `${(+(v ?? 0)).toFixed(1)} h` },
      series: [s('Trabajadas', COLORS.op, work.map((w, i) => +(w - idle[i]).toFixed(2))), s('Ralentí', COLORS.idle, idle), s('Standby', COLORS.standby, at(series.standby)), s('Avería', COLORS.down, at(series.down))],
    };
  }, [idx, n, days, range, series]);

  return (
    <aside className="detail" aria-live="polite" key={eq.id}>
      <div className="d-head">
        <img className="d-icon" src={machineIconUrl(eq.typeId)} alt={type.name} width="72" height="72" />
        <div className="d-title"><h2>{eq.id}</h2><p>{type.name} · {eq.model} · {eq.year}</p></div>
        <button type="button" className="x" aria-label="Cerrar detalle" onClick={() => select(null)}>✕</button>
      </div>
      <div className="d-meta">
        <span className="pill" style={{ color: st.color }}>{st.name}</span>
        <span>Reporte hace {Math.max(0, Math.round((now - (live?.ts ?? now)) / 60000))} min</span><span>{eq.pin}</span>
      </div>
      {live?.state === 'down' && live.fault && <div className="d-fault">⚠ {live.fault}</div>}
      <div className="d-meta"><span>Obra: <b>{site.name}</b></span><span>Cliente: <b>{client.name}</b></span></div>
      <div className="d-grid">
        <ReactECharts echarts={echarts} option={gauge} style={{ height: 96, width: 128 }} />
        <div className="hrs">
          <div><span><i style={{ background: COLORS.op }} />Trabajadas</span><b>{p.work.toFixed(1)} h</b></div>
          <div><span><i style={{ background: COLORS.idle }} />de ellas ralentí</span><b>{p.idle.toFixed(1)} h</b></div>
          <div><span><i style={{ background: COLORS.standby }} />Standby</span><b>{p.standby.toFixed(1)} h</b></div>
          <div><span><i style={{ background: COLORS.down }} />Avería</span><b>{p.down.toFixed(1)} h</b></div>
        </div>
      </div>
      <div className="d-sec"><h4>Horas por día · {fmt.date(from)} – {fmt.date(to)}</h4><ReactECharts echarts={echarts} option={bars} style={{ height: 80 }} /></div>
      <div className="d-sec">
        <h4>Facturación del periodo {b ? <em className="ok">· validada por el servidor</em> : billing.isError ? <em>· cálculo local</em> : null}</h4>
        <table className="bill"><tbody>
          <tr><td>Horas trabajadas<span className="calc">{p.work.toFixed(1)} h × {fmt.moneyFull(eq.rate)}/h</span></td><td>{fmt.moneyFull(lines.work)}</td></tr>
          <tr><td>Standby<span className="calc">{p.standby.toFixed(1)} h × {fmt.moneyFull(eq.rate)}/h × {Math.round(eq.standbyFactor * 100)} %</span></td><td>{fmt.moneyFull(lines.standby)}</td></tr>
          <tr className="leak"><td>No facturado<span className="calc">standby restante + avería, sobre {fmt.moneyFull(lines.potential)} potencial</span></td><td>−{fmt.moneyFull(lines.potential - lines.total)}</td></tr>
          <tr className="total"><td>Total facturable</td><td>{fmt.moneyFull(lines.total)}</td></tr>
        </tbody></table>
      </div>
      <div className="d-sec"><h4>Operación</h4>
        <div className="hrs">
          <div><span>Combustible</span><b>{fmt.int(p.fuel)} L · {(p.fuel / Math.max(1e-9, p.work)).toFixed(1)} L/h</b></div>
          <div><span>Horómetro</span><b>{fmt.int(eq.hourMeter)} h</b></div>
          <div><span>Posición</span><b>{eq.lat.toFixed(4)}, {eq.lon.toFixed(4)}</b></div>
        </div>
      </div>
      <div className="d-actions">
        <button type="button" className="btn" onClick={() => toggle('site', eq.siteId)}>Filtrar obra</button>
        <button type="button" className="btn" onClick={() => toggle('type', eq.typeId)}>Filtrar tipo</button>
      </div>
      <p className="foot">Campos AEMP: CumulativeOperatingHours, CumulativeIdleHours, FuelUsed, Location. Standby y tarifa salen del contrato.</p>
    </aside>
  );
}
