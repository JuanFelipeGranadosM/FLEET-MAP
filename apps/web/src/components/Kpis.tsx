import type { Catalog } from '../api/types';
import type { Aggregates } from '../data/aggregate';
import { useUi } from '../data/store';
import { COLORS, fmt } from '../lib/format';
import { useTween } from '../lib/useTween';

function Spark({ values, color }: { values: ArrayLike<number>; color: string }) {
  const n = values.length, w = 160, h = 28; if (!n) return null;
  let max = 0; for (let i = 0; i < n; i++) max = Math.max(max, values[i]); max ||= 1;
  const pts = Array.from({ length: n }, (_, i) => [(i / Math.max(1, n - 1)) * (w - 4) + 2, h - 3 - (values[i] / max) * (h - 6)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const last = pts[n - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d}L${last[0]} ${h}L2 ${h}Z`} fill={color} fillOpacity=".14" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    </svg>
  );
}
function StateBar({ parts }: { parts: [number, string][] }) {
  return <div className="statebar">{parts.map(([v, c], i) => <i key={i} style={{ flexGrow: v, background: c }} />)}</div>;
}
function Tile({ title, value, format, hero, sub, children }: { title: string; value: number; format(v: number): string; hero?: boolean; sub: React.ReactNode; children: React.ReactNode }) {
  const v = useTween(value);
  return (
    <article className={'kpi' + (hero ? ' hero' : '')}>
      <h3>{title}</h3><div className="v">{format(v)}</div><div className="sub">{sub}</div><div className="spark">{children}</div>
    </article>
  );
}
function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  const d = fmt.delta(cur, prev, invert);
  return <><span>vs periodo anterior</span><span className={d.cls}>{d.text}</span></>;
}

export function Kpis({ agg, catalog, total }: { agg: Aggregates; catalog: Catalog; total: number }) {
  const { kpi: k, daily } = agg;
  const { from, to } = useUi(s => s.range);
  const sl = (a: Float64Array) => a.subarray(from, to + 1);
  return (
    <section className="kpis" aria-label="Indicadores del periodo">
      <Tile title="Equipos en vista" value={k.count} format={v => `${Math.round(v)} / ${total}`}
        sub={<><span>{k.states.op ?? 0} operando</span><span>{k.states.down ?? 0} en avería</span></>}>
        <StateBar parts={catalog.states.map(s => [k.states[s.id] ?? 0, s.color])} />
      </Tile>
      <Tile title="Horas trabajadas" value={k.work} format={fmt.hours} sub={<Delta cur={k.work} prev={k.prevWork} />}><Spark values={sl(daily.work)} color={COLORS.op} /></Tile>
      <Tile title="Horas standby" value={k.standby} format={fmt.hours} sub={<Delta cur={k.standby} prev={k.prevStandby} invert />}><Spark values={sl(daily.standby)} color={COLORS.standby} /></Tile>
      <Tile title="Utilización" value={k.util} format={fmt.pct} sub={<Delta cur={k.util} prev={k.prevUtil} />}>
        <StateBar parts={[[k.work, COLORS.op], [k.standby, COLORS.standby], [k.down, COLORS.down]]} />
      </Tile>
      <Tile title="Facturación" value={k.billed} format={fmt.money} hero sub={<Delta cur={k.billed} prev={k.prevBilled} />}><Spark values={sl(daily.billed)} color={COLORS.accentText} /></Tile>
      <Tile title="No facturado" value={k.leak} format={fmt.money}
        sub={<><span>{fmt.pct(k.leak / Math.max(1, k.potential))} del potencial</span><span className={fmt.delta(k.leak, k.prevLeak, true).cls}>{fmt.delta(k.leak, k.prevLeak, true).text}</span></>}>
        <StateBar parts={[[k.billed, COLORS.accent], [k.leak, COLORS.down]]} />
      </Tile>
    </section>
  );
}
