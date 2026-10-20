import type { Catalog, Equipment } from '../api/types';
import type { Aggregates } from '../data/aggregate';
import { useUi } from '../data/store';
import { fmt } from '../lib/format';

export function RightPanel({ agg, fleet, catalog }: { agg: Aggregates; fleet: Equipment[]; catalog: Catalog }) {
  const rankBy = useUi(s => s.rankBy), set = useUi(s => s.set), selected = useUi(s => s.selected), select = useUi(s => s.select);
  const live = useUi(s => s.live), events = useUi(s => s.events);
  const color = (id: string) => catalog.states.find(s => s.id === (live[id]?.state ?? 'off'))!;
  const rows = fleet.map((eq, i) => ({ eq, v: rankBy === 'leak' ? agg.per[i].potential - agg.per[i].billed : agg.per[i].work, vis: agg.visible[i] }))
    .filter(r => r.vis).sort((a, b) => b.v - a.v).slice(0, 10);
  const max = rows[0]?.v || 1;
  return (
    <aside className="right panel" aria-label="Equipos y eventos">
      <section>
        <div className="sec-head"><h2>Equipos</h2>
          <div className="seg" role="group" aria-label="Ordenar equipos">
            <button type="button" aria-pressed={rankBy === 'leak'} onClick={() => set('rankBy', 'leak')}>Fuga</button>
            <button type="button" aria-pressed={rankBy === 'work'} onClick={() => set('rankBy', 'work')}>Horas</button>
          </div>
        </div>
        <ul className={'rank' + (rankBy === 'work' ? ' hours' : '')}>
          {rows.map(r => (
            <li key={r.eq.id}><button type="button" aria-current={r.eq.id === selected} onClick={() => select(r.eq.id)}>
              <i style={{ background: color(r.eq.id).color }} />
              <span className="nm">{r.eq.id}<small>{catalog.types.find(t => t.id === r.eq.typeId)?.name} · {catalog.sites.find(s => s.id === r.eq.siteId)?.short}</small></span>
              <span className="vv">{rankBy === 'leak' ? fmt.money(r.v) : fmt.hours(r.v)}</span>
              <span className="mini"><b style={{ width: `${(r.v / max) * 100}%` }} /></span>
            </button></li>
          ))}
          {!rows.length && <li className="hint">Ningún equipo cumple los filtros.</li>}
        </ul>
      </section>
      <section>
        <div className="sec-head"><h2>Eventos en vivo</h2></div>
        <ul className="feed">
          {events.slice(0, 12).map(ev => {
            const a = catalog.states.find(s => s.id === ev.prev), b = catalog.states.find(s => s.id === ev.state)!;
            return (
              <li key={ev.id + ev.ts} onClick={() => select(ev.id)}>
                <time>{new Date(ev.ts).toLocaleTimeString('es-CO', { hour12: false })}</time>
                <span className="ev"><b>{ev.id}</b>{a && <span className="to" style={{ color: a.color }}>{a.name}</span>}→<span className="to" style={{ color: b.color }}>{b.name}</span></span>
                {ev.fault && <span className="fault">{ev.fault}</span>}
              </li>
            );
          })}
          {!events.length && <li className="hint empty">Esperando eventos de telemetría…</li>}
        </ul>
      </section>
    </aside>
  );
}
