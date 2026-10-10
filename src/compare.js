'use strict';

// Comparar logs: tu log principal contra 1–10 logs más. Reutiliza el motor de Analysis.
const Compare = (() => {
  const { L, fmt, pct, avg, ic, tp } = Analysis;
  const MAX_LOGS = 10;
  let st = null;
  const metaCache = new Map();

  const newRow = () => ({ url: '', state: 'idle', err: '', code: null, meta: null, fights: [], players: [], fightId: null, playerId: null });

  async function fetchMeta(code) {
    if (!metaCache.has(code)) {
      metaCache.set(code, gql(`query($code:String!){reportData{report(code:$code){
        code title startTime zone{name}
        fights{id name encounterID kill fightPercentage difficulty startTime endTime phaseTransitions{id startTime}}
        masterData{actors{id name type subType icon server}}}}}`, { code })
        .then((d) => { if (!d.reportData?.report) throw new Error(t('notFound')); return d.reportData.report; })
        .catch((e) => { metaCache.delete(code); throw e; }));
    }
    return metaCache.get(code);
  }

  function reportUrl() {
    return S.code ? `https://www.warcraftlogs.com/reports/${S.code}${S.fight ? `#fight=${S.fight.id}` : ''}` : '';
  }

  function open(fromPlayerId) {
    if (!S.hasCreds) { openSettings(); return; }
    if (typeof Replay !== 'undefined') Replay.stop();
    S.seq++;
    S.home = true;
    S.cmpOpen = true;
    S.guildOpen = false;
    sidebar.hidden = true;
    if (!st) st = { rows: [newRow()], main: newRow(), results: null, win: [0, 30000], last: null, hintName: '', dirty: true };
    if (S.code && (!st.main.url || fromPlayerId != null)) {
      st.main = newRow();
      st.main.url = reportUrl();
      st.results = null;
    }
    st.hintId = fromPlayerId != null ? Number(fromPlayerId) : null;
    st.hintName = S.me || '';
    render();
    main.scrollTop = 0;
    if (st.main.url && st.main.state === 'idle') loadRow(st.main, true).then(render);
  }

  // ------------------------------------------------------------ carga y selección automática
  const playersOf = (meta) => meta.masterData.actors.filter((a) => a.type === 'Player').map((a) => {
    const [cls, spec] = (a.icon || '').split('-');
    return { id: a.id, name: a.name, cls: cls || a.subType, spec: spec || '', icon: a.icon };
  }).sort((a, b) => a.name.localeCompare(b.name));

  function pickFight(r, hintFight, encounterID) {
    if (hintFight && r.fights.some((f) => f.id === hintFight)) return hintFight;
    const pool = encounterID ? r.fights.filter((f) => f.encounterID === encounterID) : [];
    const list = pool.length ? pool : r.fights;
    if (!list.length) return null;
    const best = [...list].sort((a, b) => (b.kill ? 1 : 0) - (a.kill ? 1 : 0)
      || (a.fightPercentage ?? 100) - (b.fightPercentage ?? 100) || (b.endTime - b.startTime) - (a.endTime - a.startTime))[0];
    return best.id;
  }

  function pickPlayer(r, ref, hintId, hintName) {
    if (hintId != null && r.players.some((p) => p.id === hintId)) return hintId;
    const byName = (n) => r.players.find((p) => n && p.name.toLocaleLowerCase() === n.toLocaleLowerCase());
    return (byName(ref?.name) || byName(hintName) || r.players.find((p) => ref && p.cls === ref.cls && p.spec === ref.spec) || r.players[0])?.id ?? null;
  }

  async function loadRow(r, isMain) {
    const { code, fight } = parseInput(r.url);
    if (!code) { r.state = 'error'; r.err = t('badUrl'); return; }
    r.state = 'loading';
    r.err = '';
    try {
      const meta = await fetchMeta(code);
      r.code = code;
      r.meta = meta;
      r.fights = numberTries(meta.fights.filter((f) => f.encounterID).map((f) => ({ ...f })));
      r.players = playersOf(meta);
      if (!r.fights.length) throw new Error(L('Ese log no tiene peleas de boss.', 'That log has no boss fights.'));
      const ref = isMain ? null : currentMainPlayer();
      const refFight = isMain ? null : st.main.fights.find((f) => f.id === st.main.fightId);
      const hintFight = fight && fight !== 'last' ? Number(fight) : null;
      r.fightId = pickFight(r, hintFight, refFight?.encounterID);
      r.playerId = pickPlayer(r, ref, isMain ? st.hintId : null, isMain ? st.hintName : '');
      r.state = 'ready';
    } catch (e) {
      r.state = 'error';
      r.err = friendlyError(e);
    }
  }

  const currentMainPlayer = () => st.main.players.find((p) => p.id === st.main.playerId);
  const readyRows = () => st.rows.filter((r) => r.state === 'ready');
  // Comparar solo se activa tras "Cargar logs": al añadir, quitar o cambiar un log hay que volver a cargarlos
  const withUrl = () => st.rows.filter((r) => r.url);
  const allLoaded = () => st.main.state === 'ready' && withUrl().length > 0 && withUrl().every((r) => r.state === 'ready');
  const canRun = () => !st.dirty && allLoaded() && !st.running;

  // ------------------------------------------------------------ interfaz
  function pickersHTML(r, i) {
    const f = r.fights.map((x) => `<option value="${x.id}" ${x.id === r.fightId ? 'selected' : ''}>${esc(x.name)} · ${esc(fightLabel(x))}${x.kill ? '' : ` · ${clock(x.endTime - x.startTime)}`}</option>`).join('');
    const p = r.players.map((x) => `<option value="${x.id}" ${x.id === r.playerId ? 'selected' : ''}>${esc(x.name)} — ${esc(specName(x.spec) || className(x.cls))}</option>`).join('');
    const pl = r.players.find((x) => x.id === r.playerId);
    return `<div class="cmp-pick"><select data-cmp-fight="${i}">${f}</select>
      <span class="cmp-pl" style="--cc:${pl ? classColor(pl.cls) : '#999'}">${pl ? `<img class="spec-ic" src="${specIconUrl(esc(pl.icon || ''))}" alt="">` : ''}<select data-cmp-player="${i}">${p}</select></span></div>`;
  }

  function rowHTML(r, i) {
    const chip = { idle: '', loading: `<span class="cmp-chip">${t('loading')}</span>`, ready: `<span class="cmp-chip ok">✓ ${esc(r.meta?.title || '')}</span>`, error: `<span class="cmp-chip err">${esc(r.err)}</span>` }[r.state];
    return `<div class="cmp-row"><span class="cmp-n ${i < 0 ? 'mine' : ''}">${i < 0 ? '★' : i + 2}</span>
      <input data-cmp-url="${i}" value="${esc(r.url)}" spellcheck="false" autocomplete="off" placeholder="https://www.warcraftlogs.com/reports/…#fight=12">
      ${i >= 0 && st.rows.length > 1 ? `<button class="btn ghost sm" data-cmp="remove" data-i="${i}" aria-label="remove">✕</button>` : '<span class="cmp-sp"></span>'}
      <div class="cmp-info">${chip}${r.state === 'ready' ? pickersHTML(r, i) : ''}</div></div>`;
  }

  function render() {
    if (!S.cmpOpen) return;
    const n = st.rows.length;
    main.innerHTML = `<div class="cmp">
      <div class="cmp-hero">
        <div class="eyebrow">${L('COMPARAR LOGS', 'COMPARE LOGS')}</div>
        <h1>${L('Compárate con otros logs', 'Compare yourself with other logs')}</h1>
        <p class="sub">${L('Pon tu log y los logs de otros jugadores. Te diré qué hacen ellos que tú no, y en qué minuto y segundo exactos.', 'Add your log and other players’ logs. I will tell you what they do that you don’t, and at which exact minute and second.')}</p>
        ${S.report ? `<button class="btn ghost" data-cmp="back">${L('← Volver al log', '← Back to the log')}</button>` : ''}
      </div>
      <section class="cmp-card">
        <h3>${L('Tu log', 'Your log')}</h3>${rowHTML(st.main, -1)}
        <div class="cmp-count"><h3>${L('Logs para comparar', 'Logs to compare')}</h3>
          <div class="segs">${[1, 2, 3, 4, 5, 10].map((k) => `<button data-cmp="count" data-n="${k}" class="${n === k ? 'on' : ''}">${k}</button>`).join('')}</div>
          <button class="btn ghost sm" data-cmp="add" ${n >= MAX_LOGS ? 'disabled' : ''}>+ ${L('Añadir', 'Add')}</button><small>${n}/${MAX_LOGS}</small></div>
        ${st.rows.map((r, i) => rowHTML(r, i)).join('')}
        <div class="cmp-actions"><button class="btn ghost" data-cmp="reset" title="${esc(L('Borra todos los logs y el resultado', 'Clears all logs and the result'))}">↺ ${L('Reiniciar', 'Reset')}</button>
          <button class="btn ${st.dirty ? 'primary' : ''}" data-cmp="load">${L('Cargar logs', 'Load logs')}</button>
          <button class="btn primary" data-cmp="run" ${canRun() ? '' : 'disabled'} title="${esc(canRun() ? '' : L('Pulsa «Cargar logs» primero', 'Press “Load logs” first'))}">${L('Comparar', 'Compare')}</button><span class="muted" id="cmpStatus"></span></div>
        <p class="foot">${L('Consejo: pega el enlace con la pelea concreta (…#fight=12). Si no lo pones, elijo el mejor intento de ese boss.', 'Tip: paste the link with the exact fight (…#fight=12). If you don’t, I pick the best attempt on that boss.')}</p>
      </section>
      <div id="cmpResults">${st.results || ''}</div></div>`;
  }

  // ------------------------------------------------------------ resultados
  function scoreboard(a) {
    const rows = [a.M, ...a.O].map((p, i) => {
      const label = i === 0 ? L('Tú', 'You') : a.labels[i - 1];
      const ratio = a.M.rate ? p.rate / a.M.rate : 0;
      return `<div class="sc-tr ${i === 0 ? 'me' : ''}"><span class="sc-l" style="--cc:${classColor(p.cls)}"><b>${esc(label)}</b><small>${esc(p.name)} · ${esc(specName(p.spec) || className(p.cls))}</small></span>
        <span>${p.kill ? `<span class="sc-kill">${t('kill')}</span>` : p.bossPct != null ? `${num(p.bossPct, 1)} %` : '—'}</span>
        <span class="r">${clock(p.durationMs)}</span>
        <span class="r"><b>${plain(p.rate)}</b>${t('perSec')}</span>
        <span class="r ${i && ratio > 1.03 ? 'neg' : i && ratio < 0.97 ? 'pos' : ''}">${i ? `${ratio >= 1 ? '+' : ''}${num((ratio - 1) * 100, 0)} %` : '—'}</span>
        <span class="r">${pct(p.activeMs / p.durationMs)}</span>
        <span class="r">${fmt(p.casts.length / (p.durationMs / 60000))}</span>
        <span class="r">${p.deaths.length}</span></div>`;
    }).join('');
    const cols = 'minmax(190px, 2fr) 80px 64px 96px 78px 74px 78px 62px';
    return `<div class="sc-table" style="--cols:${cols}"><div class="sc-tr th"><span>${L('Log', 'Log')}</span><span>${L('Pelea', 'Fight')}</span><span class="r">${L('Dur.', 'Dur.')}</span><span class="r">${a.M.metric === 'hps' ? 'HPS' : 'DPS'}</span><span class="r">${L('vs tú', 'vs you')}</span><span class="r">${L('Activo', 'Active')}</span><span class="r">${L('Cast/min', 'Cast/min')}</span><span class="r">${L('Muertes', 'Deaths')}</span></div>${rows}</div>`;
  }

  function windowHTML(a) {
    const [from, to] = st.win;
    const all = [a.M, ...a.O];
    const lines = all.map((p, i) => {
      const label = i === 0 ? L('Tú', 'You') : a.labels[i - 1];
      const seq = p.casts.filter(([ms]) => ms >= from && ms <= to);
      const body = seq.length ? seq.map(([ms, g]) => {
        const ab = all.map((x) => x.abilities[g]).find((x) => x?.name) || { name: `#${g}`, icon: '' };
        return `<span class="op-i">${ic(ab.icon, 30, clockPrecise(ms), g)}<small>${clockPrecise(ms)}</small></span>`;
      }).join('') : `<span class="tnone">${L('sin lanzamientos', 'no casts')}</span>`;
      return `<div class="op-row ${i === 0 ? 'me' : ''}"><span class="op-l" title="${esc(p.name)}">${esc(label)}</span><div class="op-seq">${body}</div></div>`;
    }).join('');
    return `<div class="opener">${lines}</div>`;
  }

  function resultsHTML(a, warns) {
    return `<h2 class="an-h big">${L('Resultado de la comparación', 'Comparison result')}</h2>
      ${warns.map((w) => `<div class="cmp-warn">${w}</div>`).join('')}${scoreboard(a)}
      ${Analysis.sections(a)}
      <h2 class="an-h">${L('Rotación segundo a segundo', 'Rotation, second by second')}</h2>
      <form id="cmpWinForm" class="rangeform on cmp-win"><span class="muted">${L('Desde', 'From')}</span><input name="from" value="${clock(st.win[0])}" spellcheck="false">
        <span class="muted">${L('hasta', 'to')}</span><input name="to" value="${clock(st.win[1])}" spellcheck="false"><button class="btn sm" type="submit">${L('Ver', 'Show')}</button></form>
      <div id="cmpWin">${windowHTML(a)}</div>`;
  }

  async function run() {
    if (!canRun()) return;
    st.running = true;
    const status = (m) => { const el = $('#cmpStatus'); if (el) el.textContent = m; };
    const out = $('#cmpResults');
    try {
      const mp = currentMainPlayer();
      const metric = HEALER_SPECS.has(mp.spec) ? 'hps' : 'dps';
      const jobs = [{ r: st.main, label: L('Tú', 'You') }, ...withUrl().map((r, i) => ({ r, label: `Log ${i + 2}` }))];
      const profiles = [];
      const failed = [];
      for (let i = 0; i < jobs.length; i++) {
        status(L(`Analizando ${i + 1}/${jobs.length}…`, `Analyzing ${i + 1}/${jobs.length}…`, `Analysiere ${i + 1}/${jobs.length}…`, `Analyse ${i + 1}/${jobs.length}…`));
        const { r, label } = jobs[i];
        const fight = r.fights.find((f) => f.id === r.fightId);
        const actor = r.players.find((p) => p.id === r.playerId);
        try {
          const prof = await Analysis.fetchProfile({ code: r.code, fight, actor: { id: actor.id, name: actor.name, cls: actor.cls, spec: actor.spec, icon: actor.icon }, metric });
          profiles.push({ ...prof, label });
        } catch (err) {
          if (i === 0) throw (/EMPTY_PROFILE/.test(err.message) ? new Error(L('No se pudieron cargar los datos de tu personaje en ese log. Prueba a pulsar Cargar logs y Comparar de nuevo.', 'Could not load your character\'s data in that log. Try Load logs and Compare again.')) : err);
          failed.push(`${label} (${actor.name})`);
        }
      }
      if (profiles.length < 2) throw new Error(L('No se pudieron cargar los datos de los otros logs (puede ser un límite temporal de Warcraft Logs). Espera un momento, pulsa Cargar logs y vuelve a comparar.', 'Could not load the data of the other logs (this may be a temporary Warcraft Logs limit). Wait a moment, press Load logs and compare again.'));
      const [M, ...O] = profiles;
      const warns = failed.map((n) => L(`No se pudieron cargar los datos de ${esc(n)}: no se incluye en la comparación.`, `Could not load the data of ${esc(n)}: it is not included in the comparison.`, `Die Daten von ${esc(n)} konnten nicht geladen werden: Sie werden nicht in den Vergleich einbezogen.`, `Impossible de charger les données de ${esc(n)} : elles ne sont pas incluses dans la comparaison.`));
      for (const p of O) if (p.spec !== M.spec || p.cls !== M.cls) warns.push(L(`${esc(p.label)} (${esc(p.name)}) juega otra especialización: sus habilidades no son comparables con las tuyas.`, `${esc(p.label)} (${esc(p.name)}) plays a different spec: their abilities are not comparable with yours.`, `${esc(p.label)} (${esc(p.name)}) spielt eine andere Spezialisierung: Die Fähigkeiten sind mit deinen nicht vergleichbar.`, `${esc(p.label)} (${esc(p.name)}) joue une autre spécialisation : ses capacités ne sont pas comparables aux tiennes.`));
      for (const p of O) if (p.encounterID !== M.encounterID) warns.push(L(`${esc(p.label)} es de otro boss: los tiempos no se pueden comparar.`, `${esc(p.label)} is from another boss: timings are not comparable.`, `${esc(p.label)} stammt von einem anderen Boss: Die Zeiten sind nicht vergleichbar.`, `${esc(p.label)} provient d’un autre boss : les temps ne sont pas comparables.`));
      const a = Analysis.analyze(M, O, { labels: O.map((p) => p.label), whoWord: L('los otros logs', 'the other logs') });
      st.last = a;
      st.warns = warns;
      st.results = resultsHTML(a, warns);
      status('');
      render();
      $('#cmpResults')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      status('');
      if (out) out.innerHTML = errorHTML(friendlyError(e));
    }
    st.running = false;
    const btn = document.querySelector('[data-cmp="run"]');
    if (btn) btn.disabled = !canRun();
  }

  // ------------------------------------------------------------ eventos
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-cmp]');
    if (!el) return;
    const a = el.dataset.cmp;
    if (a === 'open') { open(el.dataset.fromPlayer); return; }
    if (!st) return;
    if (a === 'back') {
      S.cmpOpen = false;
      S.home = false;
      renderSidebar();
      window.render();
      return;
    }
    if (a === 'reset') {
      st = { rows: [newRow()], main: newRow(), results: null, win: [0, 30000], last: null, hintName: S.me || '', hintId: null, warns: [], dirty: true };
      render();
      main.scrollTop = 0;
      return;
    }
    if (a === 'count') {
      const n = Number(el.dataset.n);
      while (st.rows.length < n) st.rows.push(newRow());
      st.rows.length = n;
      st.dirty = true;
      st.results = null;
      render();
    } else if (a === 'add') {
      if (st.rows.length < MAX_LOGS) { st.rows.push(newRow()); st.dirty = true; st.results = null; render(); }
    } else if (a === 'remove') {
      st.rows.splice(Number(el.dataset.i), 1);
      if (!st.rows.length) st.rows.push(newRow());
      st.dirty = true;
      st.results = null;
      render();
    } else if (a === 'load') {
      el.disabled = true;
      $('#cmpStatus').textContent = t('loading');
      st.results = null;
      if (st.main.url) await loadRow(st.main, true);
      await Promise.all(st.rows.filter((r) => r.url).map((r) => loadRow(r, false)));
      st.dirty = !allLoaded(); // si algún log falla, no se puede comparar hasta arreglarlo o quitarlo
      render();
    } else if (a === 'run') {
      if (canRun()) run();
    }
  });

  document.addEventListener('input', (ev) => {
    const u = ev.target.dataset?.cmpUrl;
    if (u == null || !st) return;
    const r = Number(u) < 0 ? st.main : st.rows[Number(u)];
    if (r) {
      r.url = ev.target.value; r.state = 'idle'; r.err = '';
      st.dirty = true;
      const run = document.querySelector('[data-cmp="run"]');
      if (run) { run.disabled = true; run.title = L('Pulsa «Cargar logs» primero', 'Press “Load logs” first'); }
      document.querySelector('[data-cmp="load"]')?.classList.add('primary');
    }
  });

  document.addEventListener('change', (ev) => {
    if (!st) return;
    const f = ev.target.dataset?.cmpFight;
    const p = ev.target.dataset?.cmpPlayer;
    const pick = (k) => (Number(k) < 0 ? st.main : st.rows[Number(k)]);
    if (f != null) pick(f).fightId = Number(ev.target.value);
    if (p != null) { pick(p).playerId = Number(ev.target.value); render(); }
  });

  document.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'cmpWinForm' || !st?.last) return;
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const from = parseClock(fd.get('from'));
    const to = parseClock(fd.get('to'));
    if (from == null || to == null || to <= from) { toast(t('badRange')); return; }
    st.win = [from, to];
    st.results = resultsHTML(st.last, st.warns || []);
    $('#cmpWin').innerHTML = windowHTML(st.last);
  });

  return { open, render };
})();
