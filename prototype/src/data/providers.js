/* FleetMap · capa de datos de telemetría
 *
 * Toda la UI consume un único contrato (TelemetryProvider). Hoy se usa
 * MockTelemetryProvider (datos simulados y deterministas). Para producción se
 * cambia por AempTelemetryProvider (ISO 15143-3 / AEMP 2.0) o por un backend
 * propio que agregue varias marcas, sin tocar mapa ni gráficos.
 *
 * Contrato:
 *   getFleet()                     -> Promise<Equipment[]>
 *   getDailyMetrics(fromISO, toISO)-> Promise<{ days: string[], metrics: { work, idle, standby, down, fuel } }>
 *        cada métrica es Float32Array(nEquipos * nDías), índice = eq * nDías + día
 *   getLiveStatus()                -> Promise<LiveStatus[]>
 *   subscribe(cb)                  -> () => void   (push de cambios de estado en vivo)
 *
 * Equipment  = { id, pin, oem, model, typeId, siteId, clientId, lat, lon, rate, standbyFactor, year, hourMeter, route? }
 * LiveStatus = { id, state: 'op'|'idle'|'standby'|'down'|'off', lat, lon, ts, fault? }
 *
 * Definiciones de negocio:
 *   work    = horas trabajadas (horómetro, motor encendido; incluye ralentí)
 *   idle    = horas en ralentí (subconjunto de work)
 *   standby = horas de turno con el equipo disponible pero sin operar
 *   down    = horas de turno perdidas por avería o mantenimiento
 *   fuel    = litros consumidos
 *   facturación = work * tarifa + standby * tarifa * factorStandby
 */
window.FM = window.FM || {};

FM.util = {
  // PRNG determinista (mulberry32) para que la maqueta siempre muestre lo mismo.
  rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  isoToDay(iso) { return Math.round(Date.parse(iso + 'T00:00:00Z') / 864e5); },
  dayToIso(day) { return new Date(day * 864e5).toISOString().slice(0, 10); },
  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
};

/* ------------------------------------------------------------------ */
/* Simulador                                                           */
/* ------------------------------------------------------------------ */
FM.MockTelemetryProvider = class {
  constructor(cfg = FM.config, seed = 20261020) {
    this.cfg = cfg;
    this.seed = seed;
    this._listeners = new Set();
    this._build();
  }

  _build() {
    const { cfg } = this;
    const r = FM.util.rng(this.seed);
    const typeById = Object.fromEntries(cfg.types.map(t => [t.id, t]));
    const fleet = [];
    let n = 0;

    for (const site of cfg.sites) {
      const touching = cfg.roads
        .map((road, i) => ({ i, road }))
        .filter(({ road }) => near(road[0], site) || near(road[road.length - 1], site));
      for (const [typeId, count] of Object.entries(site.mix)) {
        const type = typeById[typeId];
        for (let k = 0; k < count; k++) {
          n++;
          const model = type.models[Math.floor(r() * type.models.length)];
          const ang = r() * Math.PI * 2, dist = Math.sqrt(r()) * site.radius;
          const eq = {
            id: `${typeId}-${String(n).padStart(3, '0')}`,
            pin: 'PIN' + Math.floor(1e7 + r() * 9e7),
            oem: model.split(' ')[0],
            model,
            typeId,
            siteId: site.id,
            clientId: site.client,
            lat: site.lat + Math.sin(ang) * dist,
            lon: site.lon + Math.cos(ang) * dist * 1.1,
            rate: Math.round(type.rate * (0.92 + r() * 0.16)),
            standbyFactor: cfg.defaultStandbyFactor,
            year: 2016 + Math.floor(r() * 10),
            hourMeter: Math.round(2000 + r() * 16000),
            // parámetros internos de la simulación
            _prop: 0.45 + r() * 0.5,
            _idle: 0.08 + r() * 0.22,
            _fuel: type.fuel * (0.9 + r() * 0.2),
          };
          // Las volquetas recorren un corredor vial que toca su obra.
          if (typeId === 'VOL' && touching.length) {
            const t = touching[Math.floor(r() * touching.length)];
            const pts = near(t.road[0], site) ? t.road : t.road.slice().reverse();
            eq.route = pts;
          }
          fleet.push(eq);
        }
      }
    }
    this.fleet = fleet;

    // Serie diaria completa (historyDays) para todos los equipos.
    const endDay = FM.util.isoToDay(cfg.today);
    const nDays = cfg.historyDays + 1;
    const startDay = endDay - cfg.historyDays;
    const N = fleet.length * nDays;
    const m = { work: new Float32Array(N), idle: new Float32Array(N), standby: new Float32Array(N), down: new Float32Array(N), fuel: new Float32Array(N) };
    const siteById = Object.fromEntries(cfg.sites.map(s => [s.id, s]));
    const sitePhase = Object.fromEntries(cfg.sites.map(s => [s.id, r() * 6.28]));

    fleet.forEach((eq, e) => {
      const site = siteById[eq.siteId];
      let downLeft = 0;
      for (let d = 0; d < nDays; d++) {
        const day = startDay + d;
        const dow = (new Date(day * 864e5).getUTCDay() + 6) % 7; // 0 = lunes
        const shift = dow < 5 ? 10 : dow === 5 ? 6 : site.sunday ? 6 : 0;
        const i = e * nDays + d;
        if (downLeft <= 0 && r() < 0.012) downLeft = 1 + Math.floor(r() * 5);
        if (shift === 0) { if (downLeft > 0) downLeft--; continue; }
        if (downLeft > 0) {
          downLeft--;
          m.down[i] = shift;
          continue;
        }
        const activity = 0.78 + 0.22 * Math.sin(d / 23 + sitePhase[eq.siteId]);
        const util = FM.util.clamp(eq._prop * activity * (0.75 + r() * 0.5), 0, 0.98);
        const work = shift * util;
        const idle = work * eq._idle * (0.7 + r() * 0.6);
        m.work[i] = work;
        m.idle[i] = idle;
        m.standby[i] = shift - work;
        m.fuel[i] = (work - idle) * eq._fuel * (0.85 + r() * 0.3) + idle * eq._fuel * 0.22;
      }
    });
    this._start = startDay;
    this._nDays = nDays;
    this._m = m;

    // Estado en vivo inicial: coherente con el último día simulado.
    this.live = fleet.map((eq, e) => {
      const i = e * nDays + nDays - 1;
      let state = 'standby';
      if (m.down[i] > 0) state = 'down';
      else if (r() < 0.04) state = 'off';
      else { const p = m.work[i] / 10; const x = r(); state = x < p * 0.85 ? 'op' : x < p ? 'idle' : 'standby'; }
      return { id: eq.id, state, lat: eq.lat, lon: eq.lon, ts: Date.now() - Math.floor(r() * 9e5) };
    });

    function near(pt, site) { return Math.abs(pt[0] - site.lat) < 0.02 && Math.abs(pt[1] - site.lon) < 0.02; }
  }

  async getFleet() { return this.fleet.map(({ _prop, _idle, _fuel, ...pub }) => pub); }

  async getDailyMetrics(fromISO, toISO) {
    const a = Math.max(FM.util.isoToDay(fromISO), this._start);
    const b = Math.min(FM.util.isoToDay(toISO), this._start + this._nDays - 1);
    if (a === this._start && b === this._start + this._nDays - 1) {
      return { days: this._days(a, b), metrics: this._m };
    }
    const nD = b - a + 1, nE = this.fleet.length, out = {};
    for (const k of Object.keys(this._m)) {
      const src = this._m[k], dst = new Float32Array(nE * nD);
      for (let e = 0; e < nE; e++) dst.set(src.subarray(e * this._nDays + (a - this._start), e * this._nDays + (b - this._start) + 1), e * nD);
      out[k] = dst;
    }
    return { days: this._days(a, b), metrics: out };
  }

  _days(a, b) { const d = []; for (let x = a; x <= b; x++) d.push(FM.util.dayToIso(x)); return d; }

  async getLiveStatus() { return this.live.map(s => ({ ...s })); }

  // Simula el push de eventos de telemetría (en producción: websocket / SSE / polling AEMP).
  subscribe(cb) {
    this._listeners.add(cb);
    if (!this._timer) {
      const r = FM.util.rng(Date.now() & 0xffff);
      const faults = ['SPN 110 · Temp. refrigerante alta', 'SPN 100 · Presión aceite baja', 'SPN 190 · Sobrevelocidad motor', 'Filtro hidráulico obstruido', 'Nivel DEF bajo'];
      this._timer = setInterval(() => {
        const s = this.live[Math.floor(r() * this.live.length)];
        const prev = s.state;
        const roll = r();
        let next = prev;
        if (prev === 'down') next = roll < 0.4 ? 'standby' : 'down';
        else if (prev === 'off') next = 'standby';
        else next = roll < 0.5 ? 'op' : roll < 0.68 ? 'idle' : roll < 0.95 ? 'standby' : roll < 0.985 ? 'down' : 'off';
        if (next === prev) return;
        s.state = next; s.ts = Date.now();
        s.fault = next === 'down' ? faults[Math.floor(r() * faults.length)] : undefined;
        const ev = { ...s, prev };
        this._listeners.forEach(fn => fn(ev));
      }, 1800);
    }
    return () => this._listeners.delete(cb);
  }
};

/* ------------------------------------------------------------------ */
/* Adaptador ISO 15143-3 (AEMP 2.0) · esqueleto para producción        */
/* ------------------------------------------------------------------ */
/* Cada OEM (CAT VisionLink, Komatsu Komtrax, Volvo CareTrack, JDLink…)
 * expone el mismo estándar con su propia URL base y OAuth2. Recomendado:
 * llamar desde un backend propio (los tokens no deben vivir en el navegador)
 * y que ese backend exponga este mismo contrato ya agregado.
 *
 * Endpoints del estándar usados:
 *   GET /Fleet/{page}                                                    -> snapshot de la flota
 *   GET /Fleet/Equipment/ID/{id}/CumulativeOperatingHours/{from}/{to}/{page}
 *   GET /Fleet/Equipment/ID/{id}/CumulativeIdleHours/{from}/{to}/{page}
 *   GET /Fleet/Equipment/ID/{id}/FuelUsed/{from}/{to}/{page}
 * Verificar nombres exactos y paginación contra la documentación de cada OEM.
 */
FM.AempTelemetryProvider = class {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl        URL base AEMP del OEM o del backend propio
   * @param {() => Promise<string>} opts.getToken  devuelve un bearer token
   * @param {(pin: string) => object} opts.assetMaster  datos de negocio por PIN: { siteId, clientId, typeId, rate, standbyFactor }
   * @param {(siteId: string, isoDay: string) => number} opts.shiftHours  horas de turno programadas
   */
  constructor(opts) { this.o = opts; }

  async _get(path) {
    const res = await fetch(this.o.baseUrl + path, { headers: { Authorization: 'Bearer ' + await this.o.getToken(), Accept: 'application/json' } });
    if (!res.ok) throw new Error(`AEMP ${res.status} en ${path}`);
    return res.json();
  }

  async getFleet() {
    const out = [];
    for (let page = 1; ; page++) {
      const json = await this._get(`/Fleet/${page}`);
      for (const eq of json.Equipment || []) {
        const h = eq.EquipmentHeader || {};
        const loc = eq.Location || {};
        out.push({
          id: h.EquipmentID || h.SerialNumber, pin: h.PIN || h.SerialNumber,
          oem: h.OEMName, model: h.Model,
          lat: loc.Latitude, lon: loc.Longitude,
          hourMeter: eq.CumulativeOperatingHours?.Hour,
          ...this.o.assetMaster(h.PIN || h.SerialNumber),
        });
      }
      if (!(json.Links || []).some(l => l.rel === 'Next')) break;
    }
    this._fleet = out;
    return out;
  }

  // Las series AEMP son acumuladas: se convierten a deltas diarios.
  async getDailyMetrics(fromISO, toISO) {
    const fleet = this._fleet || await this.getFleet();
    const a = FM.util.isoToDay(fromISO), b = FM.util.isoToDay(toISO), nD = b - a + 1;
    const days = []; for (let x = a; x <= b; x++) days.push(FM.util.dayToIso(x));
    const N = fleet.length * nD;
    const m = { work: new Float32Array(N), idle: new Float32Array(N), standby: new Float32Array(N), down: new Float32Array(N), fuel: new Float32Array(N) };
    const series = async (id, kind, key) => {
      const json = await this._get(`/Fleet/Equipment/ID/${encodeURIComponent(id)}/${kind}/${fromISO}T00:00:00Z/${toISO}T23:59:59Z/1`);
      return (json[kind] || []).map(p => ({ day: FM.util.isoToDay(p.datetime.slice(0, 10)), v: +(p[key] ?? p.Hour ?? p.FuelConsumed ?? 0) }));
    };
    const toDaily = (pts, dst, e) => {
      let prev = null;
      for (const p of pts.sort((x, y) => x.day - y.day)) {
        if (prev && p.day >= a && p.day <= b) dst[e * nD + (p.day - a)] += Math.max(0, p.v - prev.v);
        prev = p;
      }
    };
    await Promise.all(fleet.map(async (eq, e) => {
      const [op, idle, fuel] = await Promise.all([
        series(eq.id, 'CumulativeOperatingHours', 'Hour'),
        series(eq.id, 'CumulativeIdleHours', 'Hour'),
        series(eq.id, 'FuelUsed', 'FuelConsumed'),
      ]);
      toDaily(op, m.work, e); toDaily(idle, m.idle, e); toDaily(fuel, m.fuel, e);
      // standby y avería salen del calendario de turnos + órdenes de mantenimiento (no vienen en AEMP).
      for (let d = 0; d < nD; d++) {
        const i = e * nD + d;
        m.standby[i] = Math.max(0, this.o.shiftHours(eq.siteId, days[d]) - m.work[i] - m.down[i]);
      }
    }));
    return { days, metrics: m };
  }

  async getLiveStatus() {
    const fleet = await this.getFleet();
    return fleet.map(eq => ({ id: eq.id, state: 'standby', lat: eq.lat, lon: eq.lon, ts: Date.now() }));
  }

  subscribe(cb) {
    const t = setInterval(async () => (await this.getLiveStatus()).forEach(cb), 5 * 60 * 1000);
    return () => clearInterval(t);
  }
};
