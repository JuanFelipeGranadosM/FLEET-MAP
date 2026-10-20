const nf = new Intl.NumberFormat('es-CO');
export const fmt = {
  money(v: number) {
    const a = Math.abs(v);
    return 'US$ ' + (a >= 1e6 ? (v / 1e6).toFixed(2) + ' M' : a >= 1e3 ? (v / 1e3).toFixed(1) + ' k' : v.toFixed(0));
  },
  moneyFull: (v: number) => 'US$ ' + nf.format(Math.round(v)),
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

export const COLORS = { op: '#38e0a0', idle: '#ff9b5c', standby: '#6cb6ff', down: '#ff5d73', off: '#7d8aa3', accent: '#ffc94d', muted: '#8797b0', fg: '#e8eef7', line: 'rgba(140,172,214,0.14)' };

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
