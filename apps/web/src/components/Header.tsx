import { useEffect, useState } from 'react';
import { useUi } from '../data/store';
import { fmt } from '../lib/format';

const PRESETS = [{ label: '7D', days: 7 }, { label: '30D', days: 30 }, { label: '90D', days: 90 }, { label: '6M', days: 181 }];

export function Header({ days, provider }: { days: string[]; provider: string }) {
  const range = useUi(s => s.range), setRange = useUi(s => s.setRange);
  const n = days.length, len = range.to - range.from + 1;
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <header className="top">
      <div className="brand">
        <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
          <rect x="1" y="1" width="32" height="32" rx="8" fill="#14202e" />
          <path d="M7 23h20M9 23l3-8h7l2 4h4v4" fill="none" stroke="#ffc94d" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="12" cy="24" r="2.4" fill="#ffc94d" /><circle cx="23" cy="24" r="2.4" fill="#ffc94d" />
          <path d="M19 15l5-6 3 2" fill="none" stroke="#12a87a" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <div><b>FLEETMAP</b><small>Centro de control de flota</small></div>
      </div>
      <span className="live"><span className="dot" />EN VIVO {clock.toLocaleTimeString('es-CO', { hour12: false })}</span>
      <span className="source">Fuente: <b>{provider === 'aemp' ? 'ISO 15143-3 (AEMP 2.0)' : provider === 'excel' ? 'Arranque diario de equipos (40BU)' : provider === 'demo' ? 'Simulador en el navegador' : 'Simulador'}</b>{provider === 'mock' || provider === 'demo' ? ' · listo para ISO 15143-3' : ''}</span>
      <a className="fin-link" href="#facturacion">Facturación</a>
      <div className="dates">
        <div className="seg" role="group" aria-label="Periodo rápido">
          {PRESETS.map(p => (
            <button key={p.label} type="button" aria-pressed={range.to === n - 1 && len === p.days} onClick={() => setRange(n - p.days, n - 1, n)}>{p.label}</button>
          ))}
        </div>
        <label htmlFor="from">Desde <input id="from" type="date" min={days[0]} max={days[n - 1]} value={days[range.from] ?? ''}
          onChange={e => { const i = days.indexOf(e.target.value); if (i >= 0) setRange(i, Math.max(i, range.to), n); }} /></label>
        <label htmlFor="to">Hasta <input id="to" type="date" min={days[0]} max={days[n - 1]} value={days[range.to] ?? ''}
          onChange={e => { const i = days.indexOf(e.target.value); if (i >= 0) setRange(Math.min(i, range.from), i, n); }} /></label>
      </div>
      <span className="sr-only" aria-live="polite">{fmt.date(days[range.from] ?? days[0])} a {fmt.date(days[range.to] ?? days[0])}</span>
    </header>
  );
}
