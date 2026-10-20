/* FleetMap · estado y agregación con filtros cruzados (tipo crossfilter)
 *
 * Todas las series viven en Float32Array planos; cada cambio de filtro recorre
 * nEquipos × nDías una sola vez (≈ 25 mil celdas en la maqueta, < 1 ms).
 * Cada dimensión se agrega ignorando su propio filtro, como en un BI:
 * al elegir "Excavadora", la lista de tipos sigue mostrando los demás tipos.
 */
window.FM = window.FM || {};

FM.FleetStore = class {
  constructor(provider) {
    this.provider = provider;
    this.filters = { type: new Set(), site: new Set(), client: new Set(), state: new Set(), equipment: null };
    this.range = { from: 0, to: 0 };
    this._subs = new Set();
    this.events = [];
  }

  async load() {
    const cfg = FM.config;
    this.fleet = await this.provider.getFleet();
    const end = FM.util.isoToDay(cfg.today);
    const { days, metrics } = await this.provider.getDailyMetrics(FM.util.dayToIso(end - cfg.historyDays), cfg.today);
    this.days = days;
    this.nDays = days.length;
    this.m = metrics;
    const live = await this.provider.getLiveStatus();
    this.live = new Map(live.map(s => [s.id, s]));
    this.idx = new Map(this.fleet.map((eq, i) => [eq.id, i]));
    this.range = { from: this.nDays - 30, to: this.nDays - 1 };
    this.provider.subscribe(ev => {
      const cur = this.live.get(ev.id); if (cur) Object.assign(cur, ev);
      this.events.unshift(ev); this.events.length = Math.min(this.events.length, 40);
      this.compute(); this.emit('live', ev);
    });
    this.compute();
  }

  on(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  emit(kind, payload) { this._subs.forEach(fn => fn(kind, payload)); }

  setRange(from, to) {
    from = FM.util.clamp(Math.round(from), 0, this.nDays - 1);
    to = FM.util.clamp(Math.round(to), from, this.nDays - 1);
    if (from === this.range.from && to === this.range.to) return;
    this.range = { from, to };
    this.compute(); this.emit('filter');
  }

  toggle(dim, key, additive = true) {
    const s = this.filters[dim];
    if (!additive) { const had = s.has(key) && s.size === 1; s.clear(); if (!had) s.add(key); }
    else s.has(key) ? s.delete(key) : s.add(key);
    this.compute(); this.emit('filter');
  }
  clear(dim) {
    if (dim) this.filters[dim].clear();
    else for (const k of ['type', 'site', 'client', 'state']) this.filters[k].clear();
    this.compute(); this.emit('filter');
  }
  select(id) { this.filters.equipment = id; this.emit('select', id); }

  _keyOf(eq, dim) {
    return dim === 'type' ? eq.typeId : dim === 'site' ? eq.siteId : dim === 'client' ? eq.clientId : this.live.get(eq.id)?.state;
  }
  passes(eq, except) {
    for (const dim of ['type', 'site', 'client', 'state']) {
      if (dim === except) continue;
      const s = this.filters[dim];
      if (s.size && !s.has(this._keyOf(eq, dim))) return false;
    }
    return true;
  }
  hasFilters() { return ['type', 'site', 'client', 'state'].some(k => this.filters[k].size); }

  compute() {
    const { fleet, m, nDays } = this;
    const { from, to } = this.range;
    const len = to - from + 1;
    const pFrom = Math.max(0, from - len), pTo = from - 1;
    const nE = fleet.length;

    // Totales por equipo en el rango (y en el rango anterior para deltas).
    const per = this.per = new Array(nE);
    for (let e = 0; e < nE; e++) {
      const eq = fleet[e], base = e * nDays;
      let w = 0, i = 0, s = 0, d = 0, f = 0, pw = 0, ps = 0, pd = 0;
      for (let k = base + from, end = base + to; k <= end; k++) { w += m.work[k]; i += m.idle[k]; s += m.standby[k]; d += m.down[k]; f += m.fuel[k]; }
      for (let k = base + pFrom, end = base + pTo; k <= end; k++) { pw += m.work[k]; ps += m.standby[k]; pd += m.down[k]; }
      const sf = eq.standbyFactor;
      per[e] = {
        work: w, idle: i, standby: s, down: d, fuel: f,
        billed: w * eq.rate + s * eq.rate * sf,
        potential: (w + s + d) * eq.rate,
        prevWork: pw, prevStandby: ps, prevBilled: pw * eq.rate + ps * eq.rate * sf, prevPotential: (pw + ps + pd) * eq.rate,
      };
    }

    // Grupos por dimensión (cada uno ignora su propio filtro).
    const groups = this.groups = {};
    for (const dim of ['type', 'site', 'client', 'state']) {
      const g = new Map();
      for (let e = 0; e < nE; e++) {
        const eq = fleet[e];
        if (!this.passes(eq, dim)) continue;
        const key = this._keyOf(eq, dim), p = per[e];
        const row = g.get(key) || { key, count: 0, work: 0, standby: 0, down: 0, billed: 0, potential: 0 };
        row.count++; row.work += p.work; row.standby += p.standby; row.down += p.down; row.billed += p.billed; row.potential += p.potential;
        g.set(key, row);
      }
      groups[dim] = g;
    }

    // KPIs y serie diaria (historia completa) del conjunto filtrado.
    const k = this.kpi = { count: 0, work: 0, idle: 0, standby: 0, down: 0, fuel: 0, billed: 0, potential: 0, prevWork: 0, prevStandby: 0, prevBilled: 0, prevPotential: 0, states: {} };
    const daily = this.daily = { work: new Float64Array(nDays), idle: new Float64Array(nDays), standby: new Float64Array(nDays), down: new Float64Array(nDays), billed: new Float64Array(nDays) };
    const visible = this.visible = new Uint8Array(nE);
    for (let e = 0; e < nE; e++) {
      const eq = fleet[e];
      if (!this.passes(eq)) continue;
      visible[e] = 1;
      const p = per[e];
      k.count++;
      for (const key of ['work', 'idle', 'standby', 'down', 'fuel', 'billed', 'potential', 'prevWork', 'prevStandby', 'prevBilled', 'prevPotential']) k[key] += p[key];
      const st = this.live.get(eq.id)?.state; k.states[st] = (k.states[st] || 0) + 1;
      const base = e * nDays, sf = eq.standbyFactor * eq.rate;
      for (let d = 0; d < nDays; d++) {
        const w = m.work[base + d], s = m.standby[base + d];
        daily.work[d] += w; daily.idle[d] += m.idle[base + d]; daily.standby[d] += s; daily.down[d] += m.down[base + d];
        daily.billed[d] += w * eq.rate + s * sf;
      }
    }
    k.util = k.work / Math.max(1e-9, k.work + k.standby + k.down);
    k.prevUtil = k.prevWork / Math.max(1e-9, this._prevHours());
    k.leak = k.potential - k.billed;
    k.prevLeak = k.prevPotential - k.prevBilled;
  }

  _prevHours() {
    const { from, to } = this.range, len = to - from + 1, pFrom = Math.max(0, from - len), pTo = from - 1;
    let h = 0;
    for (let e = 0; e < this.fleet.length; e++) {
      if (!this.visible[e]) continue;
      const base = e * this.nDays;
      for (let k = base + pFrom; k <= base + pTo; k++) h += this.m.work[k] + this.m.standby[k] + this.m.down[k];
    }
    return h;
  }

  equipmentSeries(id) {
    const e = this.idx.get(id), base = e * this.nDays, { from, to } = this.range, out = [];
    for (let d = from; d <= to; d++) out.push({ day: this.days[d], work: this.m.work[base + d], idle: this.m.idle[base + d], standby: this.m.standby[base + d], down: this.m.down[base + d], fuel: this.m.fuel[base + d] });
    return out;
  }
};
