/* FleetMap · gráficos ligeros (Canvas / SVG sin librerías) */
window.FM = window.FM || {};

FM.fmt = {
  money(v) {
    const a = Math.abs(v);
    const s = a >= 1e6 ? (v / 1e6).toFixed(2) + ' M' : a >= 1e3 ? (v / 1e3).toFixed(1) + ' k' : v.toFixed(0);
    return 'US$ ' + s;
  },
  moneyFull(v) { return 'US$ ' + Math.round(v).toLocaleString('es-CO'); },
  hours(v) { return v >= 1e4 ? (v / 1e3).toFixed(1) + ' k h' : Math.round(v).toLocaleString('es-CO') + ' h'; },
  pct(v) { return (v * 100).toFixed(1) + ' %'; },
  date(iso, opts = { day: 'numeric', month: 'short' }) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('es-CO', { ...opts, timeZone: 'UTC' }); },
  delta(cur, prev, invert = false) {
    if (!prev) return { text: '—', cls: '' };
    const d = (cur - prev) / prev;
    const good = invert ? d < 0 : d > 0;
    return { text: (d > 0 ? '▲ ' : '▼ ') + Math.abs(d * 100).toFixed(1) + ' %', cls: Math.abs(d) < 0.005 ? '' : good ? 'up' : 'down' };
  },
};

/* Línea de tiempo con barras apiladas por día y selector de rango arrastrable. */
FM.Timeline = class {
  constructor(canvas, store, tip) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.store = store; this.tip = tip;
    this.pad = { l: 44, r: 12, t: 10, b: 22 };
    new ResizeObserver(() => this.draw()).observe(canvas.parentElement);
    store.on(() => this.draw());
    this._bind();
  }
  _x(d) { const w = this.w - this.pad.l - this.pad.r; return this.pad.l + d / this.store.nDays * w; }
  _d(x) { const w = this.w - this.pad.l - this.pad.r; return FM.util.clamp(Math.floor((x - this.pad.l) / w * this.store.nDays), 0, this.store.nDays - 1); }
  _bind() {
    const c = this.c; let mode = null, anchor = 0, start = null;
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const d = this._d(e.offsetX), { from, to } = this.store.range;
      const xf = this._x(from), xt = this._x(to + 1);
      if (Math.abs(e.offsetX - xf) < 7) mode = 'from';
      else if (Math.abs(e.offsetX - xt) < 7) mode = 'to';
      else if (d >= from && d <= to && to > from) { mode = 'move'; anchor = d; start = { from, to }; }
      else { mode = 'new'; anchor = d; this.store.setRange(d, d); }
    });
    c.addEventListener('pointermove', e => {
      const d = this._d(e.offsetX), { from, to } = this.store.range;
      if (!mode) {
        const xf = this._x(from), xt = this._x(to + 1);
        c.style.cursor = Math.abs(e.offsetX - xf) < 7 || Math.abs(e.offsetX - xt) < 7 ? 'ew-resize' : d >= from && d <= to ? 'grab' : 'crosshair';
        this._hover(d, e); return;
      }
      if (mode === 'from') this.store.setRange(Math.min(d, to), to);
      else if (mode === 'to') this.store.setRange(from, Math.max(d, from));
      else if (mode === 'new') this.store.setRange(Math.min(anchor, d), Math.max(anchor, d));
      else if (mode === 'move') {
        const len = start.to - start.from; let f = start.from + d - anchor;
        f = FM.util.clamp(f, 0, this.store.nDays - 1 - len); this.store.setRange(f, f + len);
      }
      this._hover(d, e);
    });
    const end = () => { mode = null; };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { this.hoverDay = null; this.tip.hidden = true; this.draw(); });
  }
  _hover(d, e) {
    this.hoverDay = d; this.draw();
    const s = this.store, dl = s.daily;
    this.tip.hidden = false;
    this.tip.innerHTML = `<b>${FM.fmt.date(s.days[d], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b>
      <span><i style="background:var(--op)"></i>Trabajadas ${FM.fmt.hours(dl.work[d])}</span>
      <span><i style="background:var(--idle)"></i>Ralentí ${FM.fmt.hours(dl.idle[d])}</span>
      <span><i style="background:var(--standby)"></i>Standby ${FM.fmt.hours(dl.standby[d])}</span>
      <span><i style="background:var(--down)"></i>Avería ${FM.fmt.hours(dl.down[d])}</span>
      <span class="tip-money">${FM.fmt.moneyFull(dl.billed[d])}</span>`;
    const r = this.c.getBoundingClientRect();
    const tx = Math.min(e.offsetX + 14, r.width - 190);
    this.tip.style.transform = `translate(${tx}px, ${-8}px)`;
  }
  draw() {
    const s = this.store; if (!s.daily) return;
    const r = this.c.parentElement.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.c.width = r.width * dpr; this.c.height = r.height * dpr; this.c.style.width = r.width + 'px'; this.c.style.height = r.height + 'px';
    const g = this.ctx; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const { l, r: pr, t, b } = this.pad, H = this.h - t - b, n = s.nDays, dl = s.daily;
    let max = 1; for (let d = 0; d < n; d++) max = Math.max(max, dl.work[d] + dl.standby[d] + dl.down[d]);
    max = nice(max);
    const css = getComputedStyle(this.c);
    const col = { op: css.getPropertyValue('--op'), idle: css.getPropertyValue('--idle'), standby: css.getPropertyValue('--standby'), down: css.getPropertyValue('--down'), grid: css.getPropertyValue('--line'), text: css.getPropertyValue('--muted'), acc: css.getPropertyValue('--accent') };
    // retícula
    g.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'; g.fillStyle = col.text; g.strokeStyle = col.grid; g.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = t + H - H * i / 3; g.beginPath(); g.moveTo(l, Math.round(y) + 0.5); g.lineTo(this.w - pr, Math.round(y) + 0.5); g.stroke();
      g.textAlign = 'right'; g.fillText(fmtK(max * i / 3), l - 6, y + 3);
    }
    g.textAlign = 'left';
    // barras
    const bw = Math.max(1, (this.w - l - pr) / n - 1);
    const { from, to } = s.range;
    for (let d = 0; d < n; d++) {
      const x = this._x(d), inR = d >= from && d <= to;
      g.globalAlpha = inR ? 1 : 0.28;
      let y = t + H;
      const segs = [[dl.work[d] - dl.idle[d], col.op], [dl.idle[d], col.idle], [dl.standby[d], col.standby], [dl.down[d], col.down]];
      for (const [v, c] of segs) { const h = v / max * H; if (h <= 0) continue; y -= h; g.fillStyle = c; g.fillRect(x, y, bw, h); }
      if (s.days[d].endsWith('-01')) { g.globalAlpha = 1; g.fillStyle = col.text; g.fillText(FM.fmt.date(s.days[d], { month: 'short' }).toUpperCase(), x + 2, this.h - 6); g.fillStyle = col.grid; g.fillRect(x, t, 1, H); }
    }
    g.globalAlpha = 1;
    // rango seleccionado
    const xf = this._x(from), xt = this._x(to + 1);
    g.strokeStyle = col.acc; g.lineWidth = 1.5; g.strokeRect(xf + 0.5, t - 4, xt - xf - 1, H + 6);
    g.fillStyle = col.acc; for (const x of [xf, xt]) { g.fillRect(x - 2.5, t + H / 2 - 9, 5, 18); }
    if (this.hoverDay != null) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(this._x(this.hoverDay), t, bw, H); }
    function nice(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p * 2) / 2 * p; }
    function fmtK(v) { return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v); }
  }
};

FM.svg = {
  spark(values, color, w = 120, h = 32) {
    const n = values.length; if (!n) return '';
    let max = 0; for (const v of values) max = Math.max(max, v); max = max || 1;
    const pts = values.map((v, i) => [(i / Math.max(1, n - 1)) * (w - 4) + 2, h - 3 - v / max * (h - 6)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const last = pts[n - 1];
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${d}L${last[0]} ${h}L2 ${h}Z" fill="${color}" fill-opacity=".14"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${color}"/></svg>`;
  },
  gauge(v, color) {
    const R = 52, C = Math.PI * R; const val = FM.util.clamp(v, 0, 1);
    return `<svg viewBox="0 0 128 74" width="128" height="74" aria-hidden="true">
      <path d="M12 66 A52 52 0 0 1 116 66" fill="none" stroke="var(--line)" stroke-width="10" stroke-linecap="round"/>
      <path class="gauge-arc" d="M12 66 A52 52 0 0 1 116 66" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - val)}"/>
    </svg>`;
  },
  dailyBars(rows, w = 300, h = 78) {
    const n = rows.length; if (!n) return '';
    let max = 1; for (const r of rows) max = Math.max(max, r.work + r.standby + r.down);
    const bw = w / n; let out = '';
    rows.forEach((r, i) => {
      let y = h; const x = (i * bw).toFixed(2), wd = Math.max(0.6, bw - (bw > 4 ? 1.5 : 0.3)).toFixed(2);
      for (const [v, c] of [[r.work - r.idle, 'var(--op)'], [r.idle, 'var(--idle)'], [r.standby, 'var(--standby)'], [r.down, 'var(--down)']]) {
        const hh = v / max * (h - 2); if (hh <= 0) continue; y -= hh;
        out += `<rect x="${x}" y="${y.toFixed(2)}" width="${wd}" height="${hh.toFixed(2)}" fill="${c}"><title>${r.day}</title></rect>`;
      }
    });
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true">${out}</svg>`;
  },
};
