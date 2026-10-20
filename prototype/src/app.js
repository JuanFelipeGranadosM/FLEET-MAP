/* FleetMap · arranque y enlace de la interfaz */
(async () => {
  const cfg = FM.config, fmt = FM.fmt, $ = s => document.querySelector(s);
  const stateById = Object.fromEntries(cfg.states.map(s => [s.id, s]));
  const typeById = Object.fromEntries(cfg.types.map(t => [t.id, t]));
  const siteById = Object.fromEntries(cfg.sites.map(s => [s.id, s]));
  const clientById = Object.fromEntries(cfg.clients.map(c => [c.id, c]));
  const labels = {
    type: k => typeById[k]?.name, site: k => siteById[k]?.short, client: k => clientById[k]?.name, state: k => stateById[k]?.name,
  };

  // Cambiar esta línea por `new FM.AempTelemetryProvider({...})` para datos reales.
  const provider = new FM.MockTelemetryProvider();
  const store = new FM.FleetStore(provider);
  await store.load();

  let metric = 'work', rankBy = 'leak';

  /* ---------- mapa ---------- */
  const tip = $('#mapTip');
  const map = new FM.FleetMap($('#map'), store, {
    onSelect: id => select(id, false),
    onSite: id => store.toggle('site', id, false),
    onHover: (h, x, y) => {
      if (!h) { tip.hidden = true; return; }
      tip.hidden = false;
      if (h.kind === 'eq') {
        const eq = h.p.eq, i = store.idx.get(eq.id), p = store.per[i], st = stateById[store.live.get(eq.id)?.state];
        tip.innerHTML = `<b>${eq.id}</b> <span class="pill" style="color:${st.color};margin-left:6px">${st.name}</span>
          <div style="color:var(--muted);margin:2px 0 6px">${eq.model} · ${siteById[eq.siteId].short}</div>
          <div class="row"><span>Trabajadas</span><span>${fmt.hours(p.work)}</span></div>
          <div class="row"><span>Standby</span><span>${fmt.hours(p.standby)}</span></div>
          <div class="row"><span>Facturación</span><span>${fmt.money(p.billed)}</span></div>`;
      } else {
        const g = store.groups.site.get(h.st.s.id);
        tip.innerHTML = `<b>${h.st.s.name}</b><div style="color:var(--muted);margin:2px 0 6px">${clientById[h.st.s.client].name}</div>
          <div class="row"><span>Equipos</span><span>${g?.count || 0}</span></div>
          <div class="row"><span>Trabajadas</span><span>${fmt.hours(g?.work || 0)}</span></div>
          <div class="row"><span>Facturación</span><span>${fmt.money(g?.billed || 0)}</span></div>
          <div style="margin-top:6px;color:var(--accent);font-size:11px">Clic para filtrar la obra</div>`;
      }
      const wrap = $('#mapWrap').getBoundingClientRect();
      const tx = Math.min(x + 16, wrap.width - tip.offsetWidth - 8), ty = Math.min(y + 16, wrap.height - tip.offsetHeight - 8);
      tip.style.transform = `translate(${tx}px, ${ty}px)`;
    },
  });
  $('#zin').onclick = () => map.zoomBy(1.6);
  $('#zout').onclick = () => map.zoomBy(1 / 1.6);
  $('#zreset').onclick = () => map.reset();
  segmented('#layer', 'l', v => map.setLayer(v));
  $('#legend').innerHTML = cfg.states.map(s => `<span style="color:${s.color}"><i style="background:${s.color}"></i><span style="color:var(--fg)">${s.name}</span></span>`).join('');

  new FM.Timeline($('#tl'), store, $('#tlTip'));

  /* ---------- fechas ---------- */
  const fromI = $('#from'), toI = $('#to');
  fromI.min = toI.min = store.days[0]; fromI.max = toI.max = store.days[store.nDays - 1];
  const dayIndex = iso => store.days.indexOf(iso);
  fromI.onchange = () => { const i = dayIndex(fromI.value); if (i >= 0) store.setRange(i, Math.max(i, store.range.to)); };
  toI.onchange = () => { const i = dayIndex(toI.value); if (i >= 0) store.setRange(Math.min(i, store.range.from), i); };
  document.querySelectorAll('#presets button').forEach(b => b.onclick = () => { const n = +b.dataset.days; store.setRange(store.nDays - n, store.nDays - 1); });
  function syncDates() {
    const { from, to } = store.range;
    fromI.value = store.days[from]; toI.value = store.days[to];
    const len = to - from + 1;
    document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', String(to === store.nDays - 1 && +b.dataset.days === len)));
    $('#tlRange').textContent = `${fmt.date(store.days[from])} – ${fmt.date(store.days[to], { day: 'numeric', month: 'short', year: 'numeric' })} · ${len} días`;
  }

  /* ---------- KPIs ---------- */
  const kpiDefs = [
    { id: 'count', title: 'Equipos en vista' },
    { id: 'work', title: 'Horas trabajadas', spark: 'work', color: 'var(--op)' },
    { id: 'standby', title: 'Horas standby', spark: 'standby', color: 'var(--standby)', invert: true },
    { id: 'util', title: 'Utilización' },
    { id: 'billed', title: 'Facturación', spark: 'billed', color: 'var(--accent)', hero: true },
    { id: 'leak', title: 'No facturado', invert: true },
  ];
  $('#kpis').innerHTML = kpiDefs.map(d => `<article class="kpi${d.hero ? ' hero' : ''}" data-k="${d.id}"><h3>${d.title}</h3><div class="v">—</div><div class="sub"></div><div class="spark"></div></article>`).join('');
  const shown = {};
  function tween(el, key, to, f) {
    const from = shown[key] ?? to * 0.6, t0 = performance.now(), dur = 550;
    shown[key] = to;
    const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = f(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function renderKpis() {
    const k = store.kpi, { from, to } = store.range;
    for (const d of kpiDefs) {
      const el = document.querySelector(`.kpi[data-k="${d.id}"]`), v = el.querySelector('.v'), sub = el.querySelector('.sub'), sp = el.querySelector('.spark');
      if (d.id === 'count') {
        tween(v, d.id, k.count, x => Math.round(x) + ' / ' + store.fleet.length);
        sp.innerHTML = `<div class="statebar">${cfg.states.map(s => `<i style="flex-grow:${k.states[s.id] || 0};background:${s.color}" title="${s.name}"></i>`).join('')}</div>`;
        sub.innerHTML = `<span>${k.states.op || 0} operando</span><span>${k.states.down || 0} en avería</span>`;
        continue;
      }
      if (d.id === 'util') {
        tween(v, d.id, k.util, fmt.pct);
        const dl = fmt.delta(k.util, k.prevUtil);
        sub.innerHTML = `<span>vs periodo anterior</span><span class="${dl.cls}">${dl.text}</span>`;
        sp.innerHTML = `<div class="statebar"><i style="flex-grow:${k.work};background:var(--op)"></i><i style="flex-grow:${k.standby};background:var(--standby)"></i><i style="flex-grow:${k.down};background:var(--down)"></i></div>`;
        continue;
      }
      const val = k[d.id], prev = d.id === 'leak' ? k.prevLeak : k['prev' + d.id[0].toUpperCase() + d.id.slice(1)];
      const isMoney = d.id === 'billed' || d.id === 'leak';
      tween(v, d.id, val, isMoney ? fmt.money : fmt.hours);
      const dl = fmt.delta(val, prev, d.invert);
      sub.innerHTML = d.id === 'leak'
        ? `<span>${fmt.pct(val / Math.max(1, k.potential))} del potencial</span><span class="${dl.cls}">${dl.text}</span>`
        : `<span>vs periodo anterior</span><span class="${dl.cls}">${dl.text}</span>`;
      if (d.spark) sp.innerHTML = FM.svg.spark(Array.from(store.daily[d.spark].subarray(from, to + 1)), d.color, 160, 28);
      else sp.innerHTML = `<div class="statebar"><i style="flex-grow:${k.billed};background:var(--accent)"></i><i style="flex-grow:${val};background:var(--down)"></i></div>`;
    }
  }

  /* ---------- filtros laterales ---------- */
  segmented('#metric', 'm', v => { metric = v; renderSide(); });
  const valueOf = row => metric === 'work' ? row.work : metric === 'billed' ? row.billed : row.work / Math.max(1e-9, row.work + row.standby + row.down);
  const fmtOf = v => metric === 'work' ? fmt.hours(v) : metric === 'billed' ? fmt.money(v) : fmt.pct(v);
  document.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => store.clear(b.dataset.clear));
  $('#clearAll').onclick = () => store.clear();

  function renderSide() {
    for (const dim of ['state', 'type', 'site', 'client']) {
      const sec = document.querySelector(`[data-dim="${dim}"]`), f = store.filters[dim], g = store.groups[dim];
      sec.classList.toggle('dimmed', f.size > 0);
      sec.querySelector('[data-clear]').hidden = !f.size;
      const keys = dim === 'state' ? cfg.states.map(s => s.id) : dim === 'type' ? cfg.types.map(t => t.id) : dim === 'site' ? cfg.sites.map(s => s.id) : cfg.clients.map(c => c.id);
      if (dim === 'state') {
        sec.querySelector('.chips').innerHTML = keys.map(k => `<button type="button" class="chip" data-k="${k}" aria-pressed="${f.has(k)}"><i style="background:${stateById[k].color}"></i>${stateById[k].name}<b>${g.get(k)?.count || 0}</b></button>`).join('');
        continue;
      }
      const rows = keys.map(k => g.get(k) || { key: k, count: 0, work: 0, standby: 0, down: 0, billed: 0 });
      rows.sort((a, b) => valueOf(b) - valueOf(a));
      const max = Math.max(1e-9, ...rows.map(valueOf));
      const box = sec.querySelector('.bars');
      // actualización con clave para que las barras animen su ancho
      const existing = new Map([...box.children].map(el => [el.dataset.k, el]));
      rows.forEach(r => {
        let el = existing.get(r.key);
        if (!el) {
          el = document.createElement('button'); el.type = 'button'; el.className = 'bar'; el.dataset.k = r.key;
          el.innerHTML = `<span class="n"></span><span class="val"></span><span class="track"><i></i><i></i></span>`;
          el.querySelectorAll('.track i').forEach(i => i.style.width = '0');
        }
        box.appendChild(el);
        el.setAttribute('aria-pressed', String(f.has(r.key)));
        el.querySelector('.n').innerHTML = `${labels[dim](r.key)}<small>${r.count}</small>`;
        const v = valueOf(r);
        el.querySelector('.val').textContent = fmtOf(v);
        const [a, b] = el.querySelectorAll('.track i');
        requestAnimationFrame(() => {
          if (metric === 'work') { a.style.width = (r.work / max * 100) + '%'; a.style.background = 'var(--op)'; b.style.width = Math.min(100 - r.work / max * 100, r.standby / max * 100 * 0.35) + '%'; b.style.background = 'var(--standby)'; }
          else if (metric === 'billed') { a.style.width = (v / max * 100) + '%'; a.style.background = 'var(--accent)'; b.style.width = '0'; }
          else { a.style.width = (v * 100) + '%'; a.style.background = v > 0.6 ? 'var(--op)' : v > 0.4 ? 'var(--accent)' : 'var(--down)'; b.style.width = '0'; }
        });
      });
    }
    $('#clearAll').hidden = !store.hasFilters();
    // chips de filtros activos sobre el mapa
    const af = [];
    for (const dim of ['state', 'type', 'site', 'client']) for (const k of store.filters[dim]) af.push(`<button type="button" class="af" data-dim="${dim}" data-k="${k}"><span>${{ state: 'Estado', type: 'Tipo', site: 'Obra', client: 'Cliente' }[dim]}</span>${labels[dim](k)} ✕</button>`);
    $('#activeFilters').innerHTML = af.join('');
  }
  $('#side').addEventListener('click', e => {
    const b = e.target.closest('.chip, .bar'); if (!b) return;
    const dim = b.closest('[data-dim]').dataset.dim;
    store.toggle(dim, b.dataset.k, e.ctrlKey || e.metaKey || e.shiftKey);
  });
  $('#activeFilters').addEventListener('click', e => { const b = e.target.closest('.af'); if (b) store.toggle(b.dataset.dim, b.dataset.k); });

  /* ---------- ranking y eventos ---------- */
  segmented('#rankBy', 'r', v => { rankBy = v; renderRank(); });
  function renderRank() {
    const rows = [];
    store.fleet.forEach((eq, i) => { if (store.visible[i]) rows.push({ eq, p: store.per[i], v: rankBy === 'leak' ? store.per[i].potential - store.per[i].billed : store.per[i].work }); });
    rows.sort((a, b) => b.v - a.v);
    const top = rows.slice(0, 10), max = top[0]?.v || 1, sel = store.filters.equipment;
    const ul = $('#rank'); ul.classList.toggle('hours', rankBy === 'work');
    ul.innerHTML = top.map(r => {
      const st = stateById[store.live.get(r.eq.id)?.state];
      return `<li><button type="button" data-id="${r.eq.id}" aria-current="${r.eq.id === sel}"><i style="background:${st.color}"></i>
        <span class="nm">${r.eq.id}<small>${typeById[r.eq.typeId].name} · ${siteById[r.eq.siteId].short}</small></span>
        <span class="vv">${rankBy === 'leak' ? fmt.money(r.v) : fmt.hours(r.v)}</span><span class="mini"><b style="width:${r.v / max * 100}%"></b></span></button></li>`;
    }).join('') || '<li class="hint">Ningún equipo cumple los filtros.</li>';
  }
  $('#rank').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) select(b.dataset.id, true); });

  function renderFeed() {
    $('#feed').innerHTML = store.events.slice(0, 12).map(ev => {
      const a = stateById[ev.prev], b = stateById[ev.state];
      const t = new Date(ev.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `<li data-id="${ev.id}"><time>${t}</time><span class="ev"><b>${ev.id}</b><span class="to" style="color:${a.color}">${a.name}</span>→<span class="to" style="color:${b.color}">${b.name}</span></span>${ev.fault ? `<span class="fault">${ev.fault}</span>` : ''}</li>`;
    }).join('') || '<li class="hint" style="background:none">Esperando eventos de telemetría…</li>';
  }
  $('#feed').addEventListener('click', e => { const li = e.target.closest('[data-id]'); if (li) select(li.dataset.id, true); });

  /* ---------- detalle del equipo ---------- */
  const detail = $('#detail');
  function select(id, fly) {
    store.select(id);
    if (!id) { detail.hidden = true; renderRank(); return; }
    if (fly) map.flyTo(id); else map.target = null;
    renderDetail(true); renderRank();
  }
  function renderDetail(fresh) {
    const id = store.filters.equipment; if (!id) return;
    const i = store.idx.get(id), eq = store.fleet[i], p = store.per[i], live = store.live.get(id), st = stateById[live.state];
    const type = typeById[eq.typeId], site = siteById[eq.siteId], client = clientById[eq.clientId];
    const avail = p.work + p.standby + p.down, util = p.work / Math.max(1e-9, avail);
    const ago = Math.max(0, Math.round((Date.now() - live.ts) / 60000));
    const rows = store.equipmentSeries(id);
    const fuelRate = p.fuel / Math.max(1e-9, p.work);
    const sbBilled = p.standby * eq.rate * eq.standbyFactor;
    const { from, to } = store.range;
    detail.hidden = false;
    if (fresh) { detail.style.animation = 'none'; void detail.offsetWidth; detail.style.animation = ''; }
    detail.innerHTML = `
      <div class="d-head"><div><h2>${eq.id}</h2><p>${type.name} · ${eq.model} · ${eq.year}</p></div><button type="button" class="x" id="dClose" aria-label="Cerrar detalle">✕</button></div>
      <div class="d-meta"><span class="pill" style="color:${st.color}">${st.name}</span><span>Reporte hace ${ago} min</span><span>${eq.pin}</span></div>
      ${live.state === 'down' && live.fault ? `<div class="d-fault">⚠ ${live.fault}</div>` : ''}
      <div class="d-meta"><span>Obra: <b style="color:var(--fg)">${site.name}</b></span><span>Cliente: <b style="color:var(--fg)">${client.name}</b></span></div>
      <div class="d-grid">
        <div class="gauge">${FM.svg.gauge(util, util > 0.6 ? 'var(--op)' : util > 0.4 ? 'var(--accent)' : 'var(--down)')}<div class="gv">${(util * 100).toFixed(0)}%</div><div class="gl">Utilización</div></div>
        <div class="hrs">
          <div><span><i style="background:var(--op)"></i>Trabajadas</span><b>${p.work.toFixed(1)} h</b></div>
          <div><span><i style="background:var(--idle)"></i>de ellas ralentí</span><b>${p.idle.toFixed(1)} h</b></div>
          <div><span><i style="background:var(--standby)"></i>Standby</span><b>${p.standby.toFixed(1)} h</b></div>
          <div><span><i style="background:var(--down)"></i>Avería</span><b>${p.down.toFixed(1)} h</b></div>
        </div>
      </div>
      <div class="d-sec"><h4>Horas por día · ${fmt.date(store.days[from])} – ${fmt.date(store.days[to])}</h4>${FM.svg.dailyBars(rows)}</div>
      <div class="d-sec"><h4>Facturación del periodo</h4>
        <table class="bill"><tbody>
          <tr><td>Horas trabajadas<span class="calc">${p.work.toFixed(1)} h × ${fmt.moneyFull(eq.rate)}/h</span></td><td>${fmt.moneyFull(p.work * eq.rate)}</td></tr>
          <tr><td>Standby<span class="calc">${p.standby.toFixed(1)} h × ${fmt.moneyFull(eq.rate)}/h × ${Math.round(eq.standbyFactor * 100)} %</span></td><td>${fmt.moneyFull(sbBilled)}</td></tr>
          <tr class="leak"><td>No facturado<span class="calc">standby restante + avería, sobre ${fmt.moneyFull(p.potential)} potencial</span></td><td>−${fmt.moneyFull(p.potential - p.billed)}</td></tr>
          <tr class="total"><td>Total facturable</td><td>${fmt.moneyFull(p.billed)}</td></tr>
        </tbody></table>
      </div>
      <div class="d-sec"><h4>Operación</h4>
        <div class="hrs">
          <div><span>Combustible</span><b>${Math.round(p.fuel).toLocaleString('es-CO')} L · ${fuelRate.toFixed(1)} L/h</b></div>
          <div><span>Horómetro</span><b>${Math.round(eq.hourMeter).toLocaleString('es-CO')} h</b></div>
          <div><span>Posición</span><b>${eq.lat.toFixed(4)}, ${eq.lon.toFixed(4)}</b></div>
        </div>
      </div>
      <div class="d-actions"><button type="button" class="btn primary" id="dFollow">Seguir en el mapa</button><button type="button" class="btn" id="dSite">Filtrar obra</button></div>
      <p class="foot">Fuente: simulador · Campos AEMP: CumulativeOperatingHours, CumulativeIdleHours, FuelUsed, Location. Standby y tarifa salen del contrato.</p>`;
    $('#dClose').onclick = () => select(null);
    $('#dFollow').onclick = () => map.flyTo(id);
    $('#dSite').onclick = () => store.toggle('site', eq.siteId, false);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && store.filters.equipment) select(null); });

  /* ---------- reloj y suscripción ---------- */
  const clock = $('#clock');
  setInterval(() => clock.textContent = new Date().toLocaleTimeString('es-CO', { hour12: false }), 1000);
  clock.textContent = new Date().toLocaleTimeString('es-CO', { hour12: false });

  store.on((kind, ev) => {
    renderKpis(); renderSide(); renderRank();
    if (kind === 'filter') { syncDates(); renderDetail(false); }
    if (kind === 'live') { renderFeed(); if (ev.id === store.filters.equipment) renderDetail(false); }
  });
  syncDates(); renderKpis(); renderSide(); renderRank(); renderFeed();
  // Abre un equipo de ejemplo para que la maqueta arranque mostrando el detalle.
  const first = store.fleet.find(eq => store.live.get(eq.id).state === 'op' && eq.typeId === 'EXC');
  if (first && innerWidth > 860) setTimeout(() => select(first.id, true), 900);

  function segmented(sel, key, cb) {
    const g = $(sel);
    g.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      g.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      cb(b.dataset[key]);
    });
  }
})();
