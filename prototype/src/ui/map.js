/* FleetMap · mapa en Canvas 2D
 *
 * Rendimiento:
 *  - El relieve se genera una sola vez en un canvas fuera de pantalla y se
 *    dibuja con drawImage (una llamada por cuadro).
 *  - Los marcadores usan sprites pre-renderizados por estado (sin gradientes por cuadro).
 *  - La capa de calor se recalcula sólo cuando cambian filtros o fechas.
 *  - requestAnimationFrame se pausa solo cuando la pestaña no está visible.
 * En producción el relieve se reemplaza por MapLibre GL (teselas vectoriales)
 * y esta misma capa de equipos se dibuja encima como overlay.
 */
window.FM = window.FM || {};

FM.FleetMap = class {
  constructor(canvas, store, hooks = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;
    this.hooks = hooks;
    this.W = 1000; // tamaño del mundo en unidades de mapa
    this.cam = { x: 500, y: 500, z: 1 };
    this.target = null;
    this.layer = 'state'; // 'state' | 'heat'
    this.hover = null;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.colors = Object.fromEntries(FM.config.states.map(s => [s.id, s.color]));
    this.siteById = Object.fromEntries(FM.config.sites.map(s => [s.id, s]));
    this._prepare();
    this._resize();
    this._fit(true);
    new ResizeObserver(() => { this._resize(); }).observe(canvas.parentElement);
    this._bind();
    store.on(kind => { if (kind !== 'select') this._heatDirty = true; });
    this._heatDirty = true;
    const loop = t => { this._frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  /* ---------- proyección ---------- */
  project(lat, lon) {
    const b = FM.config.bbox;
    return [(lon - b.lonMin) / (b.lonMax - b.lonMin) * this.W, (b.latMax - lat) / (b.latMax - b.latMin) * this.W];
  }
  toScreen(x, y) { return [(x - this.cam.x) * this.cam.z + this.vw / 2, (y - this.cam.y) * this.cam.z + this.vh / 2]; }
  toWorld(sx, sy) { return [(sx - this.vw / 2) / this.cam.z + this.cam.x, (sy - this.vh / 2) / this.cam.z + this.cam.y]; }

  _prepare() {
    const cfg = FM.config;
    this.fleet = this.store.fleet.map(eq => {
      const [x, y] = this.project(eq.lat, eq.lon);
      const route = eq.route && eq.route.map(([la, lo]) => this.project(la, lo));
      let lens, total = 0;
      if (route) { lens = [0]; for (let i = 1; i < route.length; i++) { total += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]); lens.push(total); } }
      const h = hash(eq.id);
      return { eq, x, y, route, lens, total, phase: (h % 1000) / 1000, wob: 0.6 + (h % 97) / 97, sx: 0, sy: 0 };
    });
    this.roads = cfg.roads.map(r => r.map(([la, lo]) => this.project(la, lo)));
    this.rivers = cfg.rivers.map(r => r.map(([la, lo]) => this.project(la, lo)));
    this.sites = cfg.sites.map(s => { const [x, y] = this.project(s.lat, s.lon); return { s, x, y, r: s.radius / (cfg.bbox.lonMax - cfg.bbox.lonMin) * this.W * 1.25 }; });
    this.terrain = this._terrain(768);
    this.sprites = Object.fromEntries(FM.config.states.map(s => [s.id, sprite(s.color)]));
    this.sprites.sel = sprite('#ffc94d');
    this.ghost = sprite('#5a6984', 0.5);
    this.heat = document.createElement('canvas'); this.heat.width = this.heat.height = 384;

    function hash(str) { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
    function sprite(color, alpha = 1) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      grd.addColorStop(0, color); grd.addColorStop(0.22, color + 'cc'); grd.addColorStop(0.45, color + '33'); grd.addColorStop(1, color + '00');
      g.globalAlpha = alpha; g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      g.beginPath(); g.arc(32, 32, 7, 0, 7); g.fillStyle = color; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(6,12,22,.9)'; g.stroke();
      return c;
    }
  }

  // Relieve procedural: fbm de ruido de valor + cordillera diagonal, curvas de nivel y sombreado.
  _terrain(S) {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'); const img = g.createImageData(S, S); const px = img.data;
    const rnd = FM.util.rng(7); const P = 256; const perm = new Float32Array(P * P); for (let i = 0; i < perm.length; i++) perm[i] = rnd();
    const vn = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = perm[((yi & 255) * P) + (xi & 255)], b = perm[((yi & 255) * P) + ((xi + 1) & 255)];
      const cc = perm[(((yi + 1) & 255) * P) + (xi & 255)], d = perm[(((yi + 1) & 255) * P) + ((xi + 1) & 255)];
      return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
    };
    const H = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const nx = x / S, ny = y / S;
      let f = 0, amp = 0.5, fr = 4;
      for (let o = 0; o < 5; o++) { f += vn(nx * fr, ny * fr) * amp; amp *= 0.5; fr *= 2.03; }
      const ridge1 = Math.exp(-Math.pow((nx * 0.9 + ny * 0.25 - 0.42) * 5.2, 2));
      const ridge2 = Math.exp(-Math.pow((nx * 0.7 - ny * 0.35 - 0.38) * 5.5, 2)) * 0.6;
      H[y * S + x] = f * 0.62 + (ridge1 + ridge2) * 0.45 * (0.5 + f);
    }
    const levels = 14;
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const i = y * S + x, h = H[i];
      const shade = (H[i - S - 1] - H[i + S + 1]) * 9; // luz desde el noroeste
      const lv = Math.floor(h * levels);
      const edge = lv !== Math.floor(H[i + 1] * levels) || lv !== Math.floor(H[i + S] * levels);
      const t = FM.util.clamp(h, 0, 1);
      let r = 9 + t * 22, gg = 19 + t * 34, b = 31 + t * 38;
      r += shade * 40; gg += shade * 48; b += shade * 55;
      if (edge) { r += 14; gg += 26; b += 32; }
      if (lv % 4 === 0 && edge) { r += 10; gg += 16; b += 20; }
      const o = i * 4; px[o] = r; px[o + 1] = gg; px[o + 2] = b; px[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  _resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = r.width; this.vh = r.height;
    this.c.width = Math.round(r.width * this.dpr); this.c.height = Math.round(r.height * this.dpr);
    this.c.style.width = r.width + 'px'; this.c.style.height = r.height + 'px';
    this.fitZ = Math.min(this.vw, this.vh) / this.W * 1.08;
  }
  _fit(instant) {
    const t = { x: this.W * 0.5, y: this.W * 0.5, z: Math.max(this.vw, this.vh) / this.W * 0.98 };
    t.z = Math.max(t.z, this.fitZ);
    if (instant) this.cam = t; else this.target = t;
  }
  reset() { this._fit(false); }
  zoomBy(f) { const z = (this.target || this.cam).z * f; this.target = { x: this.cam.x, y: this.cam.y, z: FM.util.clamp(z, this.fitZ * 0.8, this.fitZ * 30) }; }
  flyTo(id) {
    const p = this.fleet.find(f => f.eq.id === id); if (!p) return;
    // deja el equipo a la izquierda del panel de detalle cuando hay espacio
    const z = Math.max(this.cam.z, this.fitZ * 3.2), off = this.vw > 860 ? Math.min(190, this.vw * 0.2) / z : 0;
    this.target = { x: p.x, y: p.y, z, follow: p, off };
  }
  setLayer(l) { this.layer = l; }

  /* ---------- interacción ---------- */
  _bind() {
    const c = this.c, pts = new Map();
    let drag = null, moved = 0, pinch = null;
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pts.size === 1) { drag = { x: e.offsetX, y: e.offsetY, cx: this.cam.x, cy: this.cam.y }; moved = 0; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: this.cam.z }; }
      this.target = null;
    });
    c.addEventListener('pointermove', e => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.cam.z = FM.util.clamp(pinch.z * d / pinch.d, this.fitZ * 0.8, this.fitZ * 30); moved = 99; return;
      }
      if (drag) {
        const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y; moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
        this.cam.x = drag.cx - dx / this.cam.z; this.cam.y = drag.cy - dy / this.cam.z;
        c.style.cursor = 'grabbing';
      } else {
        this._hoverAt(e.offsetX, e.offsetY);
      }
    });
    const up = e => {
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (drag && moved < 5 && pts.size === 0) this._clickAt(e.offsetX, e.offsetY);
      if (pts.size === 0) drag = null;
      c.style.cursor = '';
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { this.hover = null; this.hooks.onHover?.(null); });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      const z = FM.util.clamp(this.cam.z * f, this.fitZ * 0.8, this.fitZ * 30);
      const [wx, wy] = this.toWorld(e.offsetX, e.offsetY);
      this.cam.z = z;
      const [wx2, wy2] = this.toWorld(e.offsetX, e.offsetY);
      this.cam.x += wx - wx2; this.cam.y += wy - wy2; this.target = null;
    }, { passive: false });
    c.addEventListener('dblclick', e => { const [x, y] = this.toWorld(e.offsetX, e.offsetY); this.target = { x, y, z: Math.min(this.cam.z * 2.2, this.fitZ * 30) }; });
  }

  _pick(sx, sy) {
    let best = null, bd = 14 * 14;
    for (const p of this.fleet) {
      const i = this.store.idx.get(p.eq.id); if (!this.store.visible[i]) continue;
      const dx = p.sx - sx, dy = p.sy - sy, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = p; }
    }
    if (best) return { kind: 'eq', p: best };
    for (const st of this.sites) {
      const [x, y] = this.toScreen(st.x, st.y);
      if (Math.hypot(x - sx, y - sy) < Math.max(26, st.r * this.cam.z)) return { kind: 'site', st };
    }
    return null;
  }
  _hoverAt(sx, sy) {
    const h = this._pick(sx, sy);
    this.hover = h;
    this.c.style.cursor = h ? 'pointer' : 'grab';
    this.hooks.onHover?.(h, sx, sy);
  }
  _clickAt(sx, sy) {
    const h = this._pick(sx, sy);
    if (h?.kind === 'eq') this.hooks.onSelect?.(h.p.eq.id);
    else if (h?.kind === 'site') this.hooks.onSite?.(h.st.s.id);
    else this.hooks.onSelect?.(null);
  }

  /* ---------- render ---------- */
  _pos(p, t) {
    const st = this.store.live.get(p.eq.id)?.state;
    if (p.route && (st === 'op' || st === 'idle')) {
      const speed = st === 'op' ? 0.018 : 0;
      let u = (t * 0.001 * speed + p.phase) % 2; if (u > 1) u = 2 - u;
      const d = u * p.total * 0.92;
      let k = 1; while (k < p.lens.length - 1 && p.lens[k] < d) k++;
      const a = p.route[k - 1], b = p.route[k], seg = (d - p.lens[k - 1]) / (p.lens[k] - p.lens[k - 1] || 1);
      return [a[0] + (b[0] - a[0]) * seg, a[1] + (b[1] - a[1]) * seg];
    }
    if (st === 'op' && !this.reduced) {
      const w = t * 0.0006 * p.wob + p.phase * 6.28;
      return [p.x + Math.cos(w) * 0.9 * p.wob, p.y + Math.sin(w * 1.3) * 0.7];
    }
    return [p.x, p.y];
  }

  _renderHeat() {
    const g = this.heat.getContext('2d'), S = this.heat.width, k = S / this.W;
    g.clearRect(0, 0, S, S);
    g.globalCompositeOperation = 'lighter';
    let max = 1; for (const p of this.store.per) max = Math.max(max, p.work);
    this.fleet.forEach((p, i) => {
      if (!this.store.visible[i]) return;
      const v = this.store.per[i].work / max; if (v <= 0) return;
      const r = 26 * k * (0.6 + v);
      const grd = g.createRadialGradient(p.x * k, p.y * k, 0, p.x * k, p.y * k, r);
      grd.addColorStop(0, `rgba(255,170,60,${0.28 * v + 0.05})`); grd.addColorStop(1, 'rgba(255,90,60,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(p.x * k, p.y * k, r, 0, 7); g.fill();
    });
    g.globalCompositeOperation = 'source-over';
    this._heatDirty = false;
  }

  _frame(t) {
    const { ctx, cam } = this;
    if (this.target) {
      const T = this.target;
      if (T.follow) { const [fx, fy] = this._pos(T.follow, t); T.x = fx + (T.off || 0); T.y = fy; }
      const k = 0.14;
      cam.x += (T.x - cam.x) * k; cam.y += (T.y - cam.y) * k; cam.z *= Math.pow(T.z / cam.z, k);
      if (Math.abs(T.x - cam.x) < 0.05 && Math.abs(T.y - cam.y) < 0.05 && Math.abs(T.z / cam.z - 1) < 0.002 && !T.follow) this.target = null;
    }
    const z = cam.z, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#060d17'; ctx.fillRect(0, 0, this.vw, this.vh);

    // relieve
    const [ox, oy] = this.toScreen(0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.terrain, ox, oy, this.W * z, this.W * z);

    // retícula geográfica cada 0.2°
    const b = FM.config.bbox;
    ctx.strokeStyle = 'rgba(150,190,230,.07)'; ctx.lineWidth = 1; ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = 'rgba(170,200,230,.45)';
    ctx.beginPath();
    for (let lo = Math.ceil(b.lonMin * 5) / 5; lo <= b.lonMax + 1e-9; lo += 0.2) { const [x] = this.toScreen(...this.project(b.latMax, lo)); ctx.moveTo(x, 0); ctx.lineTo(x, this.vh); }
    for (let la = Math.ceil(b.latMin * 5) / 5; la <= b.latMax + 1e-9; la += 0.2) { const [, y] = this.toScreen(...this.project(la, b.lonMin)); ctx.moveTo(0, y); ctx.lineTo(this.vw, y); }
    ctx.stroke();
    for (let lo = Math.ceil(b.lonMin * 5) / 5; lo <= b.lonMax + 1e-9; lo += 0.2) { const [x] = this.toScreen(...this.project(b.latMax, lo)); ctx.fillText(Math.abs(lo).toFixed(1) + '°W', x + 4, 14); }
    for (let la = Math.ceil(b.latMin * 5) / 5; la <= b.latMax + 1e-9; la += 0.2) { const [, y] = this.toScreen(...this.project(la, b.lonMin)); ctx.fillText(la.toFixed(1) + '°N', 6, y - 4); }

    // ríos
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const r of this.rivers) { this._path(r, true); ctx.strokeStyle = 'rgba(70,150,230,.35)'; ctx.lineWidth = Math.max(1.5, 1.6 * z); ctx.stroke(); }

    // vías con flujo animado
    for (const r of this.roads) {
      this._path(r, false);
      ctx.strokeStyle = 'rgba(5,10,18,.8)'; ctx.lineWidth = Math.max(3, 2.6 * z); ctx.stroke();
      ctx.strokeStyle = 'rgba(214,190,140,.35)'; ctx.lineWidth = Math.max(1.2, 1.1 * z); ctx.stroke();
      ctx.setLineDash([4, 10]); ctx.lineDashOffset = this.reduced ? 0 : -t * 0.02;
      ctx.strokeStyle = 'rgba(255,201,77,.45)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    }

    // capa de calor
    if (this.layer === 'heat') {
      if (this._heatDirty) this._renderHeat();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.heat, ox, oy, this.W * z, this.W * z);
      ctx.globalCompositeOperation = 'source-over';
    }

    // obras: anillo con dona de estados en vivo
    const st = this.store, siteFilter = st.filters.site;
    const counts = {};
    this.fleet.forEach((p, i) => { if (!st.visible[i]) return; const s = st.live.get(p.eq.id)?.state; const c = counts[p.eq.siteId] ||= { n: 0 }; c[s] = (c[s] || 0) + 1; c.n++; });
    for (const S of this.sites) {
      const [x, y] = this.toScreen(S.x, S.y);
      const R = Math.max(22, S.r * z);
      const dim = siteFilter.size && !siteFilter.has(S.s.id);
      const c = counts[S.s.id] || { n: 0 };
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fillStyle = 'rgba(255,201,77,.035)'; ctx.fill();
      ctx.save(); ctx.translate(x, y); ctx.rotate(this.reduced ? 0 : t * 0.00012);
      ctx.setLineDash([2, 6]); ctx.strokeStyle = 'rgba(255,201,77,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, R + 6, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      // dona
      let a0 = -Math.PI / 2;
      for (const s of FM.config.states) {
        const v = c[s.id] || 0; if (!v) continue;
        const a1 = a0 + v / c.n * Math.PI * 2;
        ctx.beginPath(); ctx.arc(x, y, R + 1, a0 + 0.03, a1 - 0.03); ctx.strokeStyle = s.color; ctx.lineWidth = 3; ctx.stroke();
        a0 = a1;
      }
      // etiqueta
      const label = S.s.short.toUpperCase();
      ctx.font = '600 13px "Barlow Condensed", "Arial Narrow", sans-serif';
      const tw = ctx.measureText(label).width;
      const lx = x + R + 10, ly = y - R * 0.55;
      ctx.fillStyle = 'rgba(6,12,22,.78)'; roundRect(ctx, lx - 6, ly - 13, tw + 44, 20, 4); ctx.fill();
      ctx.fillStyle = '#e8eef7'; ctx.fillText(label, lx, ly + 1);
      ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = '#ffc94d'; ctx.fillText(String(c.n), lx + tw + 8, ly + 1);
      ctx.globalAlpha = 1;
    }

    // equipos
    const size = FM.util.clamp(10 + z * 3.2, 16, 46);
    const selId = st.filters.equipment;
    const hoverId = this.hover?.kind === 'eq' ? this.hover.p.eq.id : null;
    let selP = null;
    for (let i = 0; i < this.fleet.length; i++) {
      const p = this.fleet[i];
      const [wx, wy] = this._pos(p, t);
      const [x, y] = this.toScreen(wx, wy);
      p.sx = x; p.sy = y;
      if (x < -40 || y < -40 || x > this.vw + 40 || y > this.vh + 40) continue;
      if (!st.visible[i]) { ctx.drawImage(this.ghost, x - size * 0.3, y - size * 0.3, size * 0.6, size * 0.6); continue; }
      const s = st.live.get(p.eq.id)?.state || 'off';
      if (s === 'op' && !this.reduced) {
        const ph = ((t * 0.0009 + p.phase) % 1);
        ctx.beginPath(); ctx.arc(x, y, 5 + ph * size * 0.7, 0, 7);
        ctx.strokeStyle = `rgba(56,224,160,${0.55 * (1 - ph)})`; ctx.lineWidth = 1.5; ctx.stroke();
      }
      if (s === 'down') {
        const blink = this.reduced ? 1 : 0.5 + 0.5 * Math.sin(t * 0.008 + p.phase * 6);
        ctx.globalAlpha = 0.4 + 0.6 * blink;
      }
      const sz = p.eq.id === hoverId ? size * 1.35 : size;
      ctx.drawImage(this.sprites[s], x - sz / 2, y - sz / 2, sz, sz);
      ctx.globalAlpha = 1;
      if (z > this.fitZ * 4.5) {
        ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = 'rgba(232,238,247,.85)';
        ctx.fillText(p.eq.id, x + 9, y + 3);
      }
      if (p.eq.id === selId) selP = { x, y, p };
    }

    // selección
    if (selP) {
      const { x, y } = selP, pul = this.reduced ? 0 : (t * 0.002) % 1;
      ctx.strokeStyle = '#ffc94d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1 - pul; ctx.beginPath(); ctx.arc(x, y, 14 + pul * 26, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.lineWidth = 1; ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * 18, y + dy * 18); ctx.lineTo(x + dx * 28, y + dy * 28); }
      ctx.stroke();
    }

    // escala gráfica
    const kmPerUnit = (b.lonMax - b.lonMin) * 111.32 * Math.cos((b.latMin + b.latMax) / 2 * Math.PI / 180) / this.W;
    const targetPx = 110, km = niceKm(targetPx / z * kmPerUnit), px = km / kmPerUnit * z;
    const sx = 16, sy = this.vh - 18;
    ctx.fillStyle = 'rgba(6,12,22,.7)'; roundRect(ctx, sx - 8, sy - 20, px + 70, 28, 6); ctx.fill();
    ctx.strokeStyle = '#e8eef7'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx, sy - 6); ctx.lineTo(sx, sy); ctx.lineTo(sx + px, sy); ctx.lineTo(sx + px, sy - 6); ctx.stroke();
    ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = '#e8eef7'; ctx.fillText(km + ' km', sx + px + 8, sy - 1);

    this.hooks.onFrame?.(selP);

    function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function niceKm(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; }
  }

  _path(pts, smooth) {
    const ctx = this.ctx; ctx.beginPath();
    const s = pts.map(([x, y]) => this.toScreen(x, y));
    ctx.moveTo(s[0][0], s[0][1]);
    if (!smooth || s.length < 3) { for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]); return; }
    for (let i = 1; i < s.length - 1; i++) { const mx = (s[i][0] + s[i + 1][0]) / 2, my = (s[i][1] + s[i + 1][1]) / 2; ctx.quadraticCurveTo(s[i][0], s[i][1], mx, my); }
    ctx.lineTo(s[s.length - 1][0], s[s.length - 1][1]);
  }
};
