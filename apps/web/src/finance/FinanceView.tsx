import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LineChart } from 'echarts/charts';
import { LegendComponent } from 'echarts/components';
import { echarts, ReactECharts, baseText, tooltipStyle } from '../lib/echarts';
import { COLORS, fmt, setCurrency } from '../lib/format';
import { financeApi, type Asset, type Contract, type Family, type Month } from './api';

echarts.use([LineChart, LegendComponent]);

type Tab = 'resumen' | 'activos' | 'contratos';
const TABS: { id: Tab; label: string }[] = [{ id: 'resumen', label: 'Resumen' }, { id: 'activos', label: 'Activos y tarifas' }, { id: 'contratos', label: 'Contratos' }];
const BUDGET = '#2f86e0';
const nf = new Intl.NumberFormat('es-CO');
const n0 = (v: number | null | undefined) => (v == null ? '—' : nf.format(Math.round(v)));
const money = (v: number | null | undefined) => (v == null ? '—' : fmt.money(v));
const axisMoney = (v: number) => (Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(0) + ' mil M' : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(0) + ' M' : String(v));
const monthLabel = (iso: string) => fmt.date(iso, { month: 'short', year: '2-digit' });
const monthEnd = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); };
const pct = (a: number | null, b: number | null) => (a != null && b ? fmt.pct(a / b) : '—');

function Status({ q }: { q: { isLoading: boolean; error: unknown } }) {
  if (q.isLoading) return <div className="fin-note"><span className="loader" />Cargando…</div>;
  if (q.error) return <div className="fin-note bad">{(q.error as Error).message}</div>;
  return null;
}

function MonthsChart({ months, from, to }: { months: Month[]; from: string; to: string }) {
  const option = useMemo(() => ({
    grid: { left: 58, right: 16, top: 30, bottom: 28 },
    legend: { top: 0, right: 0, textStyle: baseText, itemWidth: 12, itemHeight: 8 },
    tooltip: { ...tooltipStyle, trigger: 'axis', valueFormatter: (v: number) => (v == null ? '—' : fmt.moneyFull(v)) },
    xAxis: { type: 'category', data: months.map(m => monthLabel(m.period)), axisLabel: baseText, axisLine: { lineStyle: { color: COLORS.line } }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { ...baseText, formatter: axisMoney }, splitLine: { lineStyle: { color: COLORS.line } } },
    series: [
      { name: 'Repercusión real', type: 'bar', barMaxWidth: 18, itemStyle: { color: COLORS.accent }, data: months.map(m => ({ value: m.real, itemStyle: { color: m.period >= from && m.period <= to ? COLORS.accent : 'rgba(245,184,0,.35)', borderRadius: [3, 3, 0, 0] } })) },
      { name: 'Presupuesto', type: 'bar', barMaxWidth: 18, itemStyle: { color: BUDGET, borderRadius: [3, 3, 0, 0] }, data: months.map(m => m.budget) },
      { name: 'Venta incurrida (contable)', type: 'line', symbolSize: 5, lineStyle: { width: 1.5, color: COLORS.fg }, itemStyle: { color: COLORS.fg }, data: months.map(m => m.sales) },
    ],
  }), [months, from, to]);
  return <ReactECharts echarts={echarts} option={option} style={{ height: 260 }} notMerge />;
}

function Bar({ value, max, color = COLORS.accent }: { value: number | null; max: number; color?: string }) {
  return <span className="fin-bar"><i style={{ width: `${max ? Math.max(0, (value ?? 0) / max) * 100 : 0}%`, background: color }} /></span>;
}

function Summary({ months, from, to }: { months: Month[]; from: string; to: string }) {
  const [group, setGroup] = useState<string | null>(null);
  const groups = useQuery({ queryKey: ['fin-groups', from, to], queryFn: () => financeApi.groups(from, to) });
  const projects = useQuery({ queryKey: ['fin-projects', from, to, group], queryFn: () => financeApi.projects(from, to, group ?? undefined) });
  const fams = useQuery({ queryKey: ['fin-families', from, to], queryFn: () => financeApi.families(from, to) });
  const sel = months.filter(m => m.period >= from && m.period <= to);
  const real = sel.reduce((s, m) => s + (m.real ?? 0), 0), budget = sel.reduce((s, m) => s + (m.budget ?? 0), 0);
  const sales = sel.reduce((s, m) => s + (m.sales ?? 0), 0), hours = sel.reduce((s, m) => s + (m.real_hours ?? 0), 0);
  // cumplimiento solo en los meses que tienen real y presupuesto
  const both = sel.filter(m => m.real != null && m.budget != null);
  const budgetWithReal = both.reduce((s, m) => s + (m.budget ?? 0), 0), realWithBudget = both.reduce((s, m) => s + (m.real ?? 0), 0);
  const maxG = Math.max(0, ...(groups.data ?? []).map(g => g.real ?? 0));
  const maxP = Math.max(0, ...(projects.data ?? []).map(p => p.real));
  const maxF = Math.max(0, ...(fams.data ?? []).flatMap((f: Family) => [f.real ?? 0, f.budget ?? 0]));
  return (
    <>
      <section className="fin-kpis">
        <article className="kpi hero"><h3>Repercusión real</h3><div className="v">{fmt.money(real)}</div><div className="sub"><span>{sel.length} meses · {fmt.hours(hours)}</span></div></article>
        <article className="kpi"><h3>Presupuesto de venta</h3><div className="v">{budget ? fmt.money(budget) : '—'}</div><div className="sub"><span>{budgetWithReal ? `Cumplimiento ${pct(realWithBudget, budgetWithReal)} en ${both.length} meses con real` : 'Sin presupuesto en el rango'}</span></div></article>
        <article className="kpi"><h3>Venta incurrida contable</h3><div className="v">{sales ? fmt.money(sales) : '—'}</div><div className="sub"><span>{sales ? `Diferencia ${fmt.money(real - sales)} vs repercusión` : 'Sin dato contable'}</span></div></article>
        <article className="kpi"><h3>Tarifa media</h3><div className="v">{hours ? fmt.money(real / hours) : '—'}</div><div className="sub"><span>por hora repercutida</span></div></article>
      </section>
      <section className="panel fin-card"><h2>Mes a mes</h2><MonthsChart months={months} from={from} to={to} /></section>
      <div className="fin-grid">
        <section className="panel fin-card">
          <h2>Por obra</h2><Status q={groups} />
          <table className="fin-table"><thead><tr><th>Obra</th><th className="n">Activos</th><th className="n">Horas</th><th className="n">Real</th><th /></tr></thead>
            <tbody>{groups.data?.map(g => (
              <tr key={g.group_name} className={group === g.group_name ? 'on' : ''} onClick={() => setGroup(group === g.group_name ? null : g.group_name)}>
                <td>{g.group_name}</td><td className="n">{g.assets}</td><td className="n">{n0(g.hours)}</td><td className="n">{money(g.real)}</td><td className="w"><Bar value={g.real} max={maxG} /></td>
              </tr>))}</tbody></table>
          <p className="fin-hint">Clic en una obra para ver sus proyectos.</p>
        </section>
        <section className="panel fin-card">
          <h2>Por proyecto {group && <button type="button" className="af" onClick={() => setGroup(null)}><span>Obra</span>{group} ✕</button>}</h2><Status q={projects} />
          <div className="fin-scroll"><table className="fin-table"><thead><tr><th>Proyecto</th><th>Obra</th><th className="n">Horas</th><th className="n">Real</th><th /></tr></thead>
            <tbody>{projects.data?.map(p => (
              <tr key={p.project_id + p.group_name}><td>{p.name ?? p.project_id}</td><td className="muted">{p.group_name}</td><td className="n">{n0(p.hours)}</td><td className="n">{money(p.real)}</td><td className="w"><Bar value={p.real} max={maxP} /></td></tr>
            ))}</tbody></table></div>
        </section>
      </div>
      <section className="panel fin-card">
        <h2>Real vs presupuesto por familia</h2><Status q={fams} />
        <div className="fin-scroll"><table className="fin-table"><thead><tr><th>Familia</th><th className="n">Horas real</th><th className="n">Horas ppto</th><th className="n">Real</th><th className="n">Presupuesto</th><th className="n" title="Real de los meses con presupuesto ÷ presupuesto">Cumpl.</th><th /></tr></thead>
          <tbody>{fams.data?.map(f => (
            <tr key={f.family_code}><td>{f.name}</td><td className="n">{n0(f.real_hours)}</td><td className="n">{n0(f.budget_hours)}</td><td className="n">{money(f.real)}</td><td className="n">{money(f.budget)}</td>
              <td className={'n ' + (f.real_budgeted != null && f.budget ? (f.real_budgeted >= f.budget ? 'up' : 'down') : '')}>{pct(f.real_budgeted, f.budget)}</td>
              <td className="w"><Bar value={f.real} max={maxF} /><Bar value={f.budget} max={maxF} color={BUDGET} /></td></tr>
          ))}</tbody></table></div>
      </section>
    </>
  );
}

function AssetDrawer({ code, onClose }: { code: string; onClose(): void }) {
  const q = useQuery({ queryKey: ['fin-asset', code], queryFn: () => financeApi.asset(code) });
  const a = q.data;
  const real = a?.months.filter(m => m.kind === 'real') ?? [];
  const option = useMemo(() => ({
    grid: { left: 44, right: 10, top: 10, bottom: 24 },
    tooltip: { ...tooltipStyle, trigger: 'axis', valueFormatter: (v: number) => fmt.moneyFull(v) },
    xAxis: { type: 'category', data: real.map(m => monthLabel(m.period)), axisLabel: baseText, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { ...baseText, formatter: axisMoney }, splitLine: { lineStyle: { color: COLORS.line } } },
    series: [{ type: 'bar', barMaxWidth: 14, itemStyle: { color: COLORS.accent }, data: real.map(m => m.amount) }],
  }), [real]);
  return (
    <aside className="panel fin-drawer" aria-label="Detalle del activo">
      <button type="button" className="close" onClick={onClose} aria-label="Cerrar">✕</button>
      <Status q={q} />
      {a && <>
        <h2>{a.equipment_id} {a.plate && <small>{a.plate}</small>}</h2>
        <p className="muted">{a.description}</p>
        <p>Tarifa vigente <b>{a.rate_hour != null ? fmt.moneyFull(a.rate_hour) + '/h' : '—'}</b></p>
        <h3>Historial de tarifa</h3>
        <table className="fin-table"><tbody>{a.rates.map(r => <tr key={r.valid_from + r.rate_hour}><td>Desde {monthLabel(r.valid_from)}</td><td className="n">{fmt.moneyFull(r.rate_hour)}/h</td></tr>)}</tbody></table>
        <h3>Repercusión mensual</h3>
        {real.length ? <ReactECharts echarts={echarts} option={option} style={{ height: 180 }} notMerge /> : <p className="muted">Sin repercusión real.</p>}
        <div className="fin-scroll short"><table className="fin-table"><thead><tr><th>Mes</th><th>Obra</th><th className="n">Horas</th><th className="n">Valor</th></tr></thead>
          <tbody>{[...real].reverse().map(m => <tr key={m.period}><td>{monthLabel(m.period)}</td><td className="muted">{m.groups}</td><td className="n">{n0(m.hours)}</td><td className="n">{money(m.amount)}</td></tr>)}</tbody></table></div>
      </>}
    </aside>
  );
}

function Assets({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['fin-assets', from, to], queryFn: () => financeApi.assets(from, to) });
  const [text, setText] = useState(''), [family, setFamily] = useState(''), [open, setOpen] = useState<string | null>(null);
  const families = useMemo(() => [...new Set((q.data ?? []).map(a => a.family).filter(Boolean) as string[])].sort(), [q.data]);
  const rows = useMemo(() => {
    const t = text.trim().toUpperCase();
    return (q.data ?? []).filter((a: Asset) => (!family || a.family === family) &&
      (!t || [a.code, a.equipment_id, a.plate, a.description].some(v => v?.toUpperCase().includes(t))));
  }, [q.data, text, family]);
  return (
    <div className="fin-assets">
      <section className="panel fin-card">
        <div className="fin-tools">
          <input type="search" placeholder="Buscar código, placa o equipo" value={text} onChange={e => setText(e.target.value)} aria-label="Buscar activo" />
          <select value={family} onChange={e => setFamily(e.target.value)} aria-label="Familia"><option value="">Todas las familias</option>{families.map(f => <option key={f}>{f}</option>)}</select>
          <span className="muted">{rows.length} activos</span>
        </div>
        <Status q={q} />
        <div className="fin-scroll tall"><table className="fin-table"><thead><tr><th>Código</th><th>Equipo</th><th>Placa</th><th>Familia</th><th className="n">Tarifa/h</th><th className="n">Cambios</th><th className="n">Horas</th><th className="n">Real</th><th>Última obra</th><th>Fin de uso</th></tr></thead>
          <tbody>{rows.map(a => (
            <tr key={a.code} className={open === a.code ? 'on' : ''} onClick={() => setOpen(a.code)}>
              <td className="mono">{a.equipment_id}</td><td>{a.description}</td><td className="mono">{a.plate ?? ''}</td><td className="muted">{a.family}</td>
              <td className="n">{a.rate_hour ? nf.format(a.rate_hour) : '—'}</td><td className="n">{a.rate_changes > 1 ? a.rate_changes : ''}</td>
              <td className="n">{n0(a.hours)}</td><td className="n">{money(a.real)}</td><td className="muted">{a.last_group ?? ''}</td><td className="muted">{a.end_of_use ? monthLabel(a.end_of_use) : ''}</td>
            </tr>))}</tbody></table></div>
      </section>
      {open && <AssetDrawer code={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

const STATUS: Record<string, string> = { recibida: 'Recibida', en_revision: 'En revisión', validada: 'Validada', firmada: 'Firmada', facturada: 'Facturada' };

function ContractCard({ c }: { c: Contract }) {
  return (
    <section className="panel fin-card">
      <h2>{c.id} {c.order_no && <small>Orden {c.order_no}</small>}</h2>
      <p className="muted">{c.client} → {c.contractor} · {c.object} · {c.start_date && fmt.date(c.start_date, { day: 'numeric', month: 'short', year: 'numeric' })} a {c.end_date && fmt.date(c.end_date, { day: 'numeric', month: 'short', year: 'numeric' })} · valor {money(c.value)}</p>
      <h3>Tarifas</h3>
      <table className="fin-table"><thead><tr><th>Ítem</th><th>Unidad</th><th className="n">Precio</th><th className="n">Cantidad</th><th>Origen</th><th>Estado</th></tr></thead>
        <tbody>{c.tariffs.map(t => <tr key={t.source + t.unit_price}><td title={t.description}>{t.item_code}</td><td>{t.unit}</td><td className="n">{fmt.moneyFull(t.unit_price)}</td><td className="n">{n0(t.qty)}</td><td>{t.source}</td><td>{t.in_force ? 'Vigente' : <span className="pill">Vigencia por confirmar</span>}</td></tr>)}</tbody></table>
      <h3>Actas</h3>
      <div className="fin-scroll"><table className="fin-table"><thead><tr><th>Acta</th><th>Periodo</th><th>Estado</th><th className="n">Viajes</th><th className="n">m³</th><th className="n">Acarreo km</th><th className="n">m³-km cobrado</th><th className="n">m³-km calculado</th><th className="n">Diferencia</th><th className="n">Valor validado</th><th className="n">Stand by faltante</th></tr></thead>
        <tbody>{c.cuts.map(x => (
          <tr key={x.number}><td>No. {String(x.number).padStart(2, '0')}</td><td>{fmt.date(x.period_from)} a {fmt.date(x.period_to)}</td><td>{STATUS[x.status] ?? x.status}</td>
            <td className="n">{n0(x.trips)}</td><td className="n">{x.m3 != null ? nf.format(x.m3) : '—'}</td><td className="n">{x.km_min != null ? `${nf.format(x.km_min)}–${nf.format(x.km_max ?? 0)}` : '—'}</td>
            <td className="n">{n0(x.m3km_billed)}</td><td className="n">{n0(x.m3km_calc)}</td>
            <td className={'n ' + (x.m3km_diff ? 'down' : '')}>{x.m3km_diff ? `${n0(x.m3km_diff)} (${x.tickets_with_diff} recibos)` : '0'}</td>
            <td className="n">{money(x.amount)}</td><td className={'n ' + (x.shortfall ? 'down' : '')}>{x.shortfall ? `${n0(x.shortfall)} m³-km` : '0'}</td></tr>
        ))}</tbody></table></div>
      {c.standby.length > 0 && <>
        <h3>Stand by por cupo</h3>
        <div className="fin-scroll"><table className="fin-table"><thead><tr><th>Acta</th><th>Cupo</th><th>Placas</th><th className="n">Días</th><th className="n">Mínimo</th><th className="n">Ejecutado</th><th className="n">Viajes</th><th className="n">Faltante</th></tr></thead>
          <tbody>{c.standby.map(s => <tr key={s.cut_number + s.slot}><td>{String(s.cut_number).padStart(2, '0')}</td><td className="mono">{s.slot}</td><td className="mono">{s.plates.join(' + ')}</td><td className="n">{s.days_available}</td><td className="n">{n0(s.minimum_m3km)}</td><td className="n">{n0(s.executed_m3km)}</td><td className="n">{s.trips}</td><td className={'n ' + (s.shortfall_m3km ? 'down' : '')}>{n0(s.shortfall_m3km)}</td></tr>)}</tbody></table></div>
      </>}
    </section>
  );
}

function Contracts() {
  const q = useQuery({ queryKey: ['fin-contracts'], queryFn: financeApi.contracts });
  return <><Status q={q} />{q.data?.length === 0 && <div className="fin-note">No hay contratos cargados.</div>}{q.data?.map(c => <ContractCard key={c.id} c={c} />)}</>;
}

export function FinanceView() {
  const qc = useQueryClient();
  useEffect(() => {
    setCurrency('COP'); const title = document.title; document.title = 'FleetMap · Facturación';
    // al volver al mapa, la moneda vuelve a la del catálogo de la flota
    return () => { document.title = title; const c = qc.getQueryData<{ currency?: string }>(['catalog'])?.currency; if (c) setCurrency(c); };
  }, [qc]);
  const [tab, setTab] = useState<Tab>('resumen');
  const months = useQuery({ queryKey: ['fin-months'], queryFn: financeApi.months });
  const list = months.data ?? [];
  const lastReal = [...list].reverse().find(m => m.real != null)?.period;
  const [from, setFrom] = useState<string | null>(null), [to, setTo] = useState<string | null>(null);
  const f = from ?? (lastReal ? lastReal.slice(0, 4) + '-01-01' : ''), t = to ?? lastReal ?? '';
  const quick = (k: 'mes' | 'anio' | 'todo') => {
    if (!lastReal) return;
    if (k === 'mes') { setFrom(lastReal); setTo(lastReal); }
    if (k === 'anio') { setFrom(lastReal.slice(0, 4) + '-01-01'); setTo(lastReal); }
    if (k === 'todo') { setFrom(list[0].period); setTo(list[list.length - 1].period); }
  };
  return (
    <div className="app fin">
      <header className="top">
        <div className="brand">
          <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><rect x="1" y="1" width="32" height="32" rx="8" fill="#14202e" /><path d="M9 24V14m6 10V10m6 14v-7m6 7V12" stroke="#ffc94d" strokeWidth="2.4" strokeLinecap="round" /></svg>
          <div><b>FLEETMAP</b><small>Facturación de maquinaria</small></div>
        </div>
        <a className="fin-back" href="#">← Mapa de flota</a>
        <div className="seg" role="tablist" aria-label="Sección">
          {TABS.map(x => <button key={x.id} type="button" role="tab" aria-pressed={tab === x.id} aria-selected={tab === x.id} onClick={() => setTab(x.id)}>{x.label}</button>)}
        </div>
        {tab !== 'contratos' && <div className="dates">
          <div className="seg" role="group" aria-label="Periodo rápido">
            <button type="button" aria-pressed={f === lastReal && t === lastReal} onClick={() => quick('mes')}>Último mes</button>
            <button type="button" aria-pressed={!!lastReal && f === lastReal.slice(0, 4) + '-01-01' && t === lastReal} onClick={() => quick('anio')}>Año</button>
            <button type="button" aria-pressed={!!list.length && f === list[0].period && t === list[list.length - 1].period} onClick={() => quick('todo')}>Todo</button>
          </div>
          <label>Desde <input type="month" value={f.slice(0, 7)} onChange={e => e.target.value && setFrom(e.target.value + '-01')} /></label>
          <label>Hasta <input type="month" value={t.slice(0, 7)} onChange={e => e.target.value && setTo(e.target.value + '-01')} /></label>
        </div>}
      </header>
      <main className="fin-body">
        <Status q={months} />
        {months.data && tab === 'resumen' && <Summary months={list} from={f} to={t} />}
        {months.data && tab === 'activos' && <Assets from={f} to={monthEnd(t)} />}
        {tab === 'contratos' && <Contracts />}
      </main>
    </div>
  );
}
