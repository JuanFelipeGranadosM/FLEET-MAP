const nf = new Intl.NumberFormat('es-CO');
let SYM = 'US$';
/** Moneda del catálogo (USD del simulador, COP del libro de arranque). */
export const setCurrency = (c: string) => { SYM = c === 'USD' ? 'US$' : c === 'COP' ? 'COP $' : c; };
export const fmt = {
  money(v: number) {
    const a = Math.abs(v);
    return SYM + ' ' + (a >= 1e9 ? (v / 1e9).toFixed(2) + ' mil M' : a >= 1e6 ? (v / 1e6).toFixed(2) + ' M' : a >= 1e3 ? (v / 1e3).toFixed(1) + ' k' : v.toFixed(0));
  },
  moneyFull: (v: number) => SYM + ' ' + nf.format(Math.round(v)),
  hours: (v: number) => (v >= 1e4 ? (v / 1e3).toFixed(1) + ' k h' : nf.format(Math.round(v)) + ' h'),
  pct: (v: number) => (v * 100).toFixed(1) + ' %',
  int: (v: number) => nf.format(Math.round(v)),
  date: (iso: string, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
    new Date(iso + 'T12:00:00Z').toLocaleDateString('es-CO', { ...o, timeZone: 'UTC' }),
  delta(cur: number, prev: number, invert = false) {
    if (!prev) return { text: '—', cls: '' };
    const d = (cur - prev) / prev, good = invert ? d < 0 : d > 0;
    return { text: (d > 0 ? '▲ ' : '▼ ') + Math.abs(d * 100).toFixed(1) + ' %', cls: Math.abs(d) < 0.005 ? '' : good ? 'up' : 'down' };
  },
};

// Tema claro. accent = amarillo maquinaria (rellenos); accentText = versión legible sobre blanco.
export const COLORS = { op: '#12a87a', idle: '#f07c2a', standby: '#2f86e0', down: '#e5384f', off: '#8a94a6', accent: '#f5b800', accentText: '#946600', muted: '#5d6b7e', fg: '#14202e', line: 'rgba(20,40,70,0.10)' };

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
