'use strict';

// Segunda tanda de funciones: Buffos ampliado (PI, prepoti, resumen de la pelea), pulls de Mítica+ en la barra lateral,
// comparar con los mejores de tu llave, comparar con tu mejor try, informe de la noche y maná de sanadores.
Object.assign(STRINGS.es.tabs, { night: 'Informe general', bestcmp: 'Progreso', mana: 'Maná', debuffs: 'Perjuicios' });
Object.assign(STRINGS.en.tabs, { night: 'General report', bestcmp: 'Progress', mana: 'Mana', debuffs: 'Debuffs' });

const Extras2 = (() => {
  const fw = (raw) => ({ ...raw, fightStart: raw.startTime, fightEnd: raw.endTime, full: true, key: `${raw.id}:${raw.startTime}-${raw.endTime}`, rangeLabel: '' });
  const POTION_RE = /potion|poci[oó]n|tonic|t[oó]nico/i;
  const FLASK_RE = /flask|frasco|phial|vial/i;
  const sec = (ms) => {
    const neg = ms < 0;
    const s = Math.abs(ms) / 1000;
    const m = Math.floor(s / 60);
    return `${neg ? '−' : ''}${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
  };

  // ============================================================ BUFFOS: jugador · PI · prepoti · resumen
  const origBuffs = VIEWS.buffs;
  const origPi = VIEWS.pi;

  function prepotData(raw) {
    const f = fw(raw);
    return cached(`prepot:${f.key}`, async () => {
      const sd = await Extras.summaryData(f);
      const guids = new Map(); // guid -> {name, icon}
      const bandUse = new Map(); // id -> [{t, guid}] (respaldo: inicio de la aura)
      for (const [pid, auras] of sd.per) {
        for (const a of auras) {
          if (!POTION_RE.test(a.name) || FLASK_RE.test(a.name)) continue;
          guids.set(a.guid, { name: a.name, icon: a.abilityIcon });
          for (const b of a.bands || []) {
            if (!bandUse.has(pid)) bandUse.set(pid, []);
            bandUse.get(pid).push({ t: b.startTime - f.startTime, guid: a.guid, aura: true });
          }
        }
      }
      const uses = new Map(); // id -> [{t, guid}]
      if (guids.size) {
        let start = f.startTime - 30000;
        for (let page = 0; page < 6; page++) {
          const d = await gql(`query($code:String!,$s:Float,$e:Float){reportData{report(code:$code){
            events(startTime:$s,endTime:$e,dataType:Casts,limit:10000,filterExpression:"ability.id in (${[...guids.keys()].join(',')})"){data nextPageTimestamp}}}}`,
          { code: S.code, s: start, e: f.endTime });
          const ev = d.reportData.report.events;
          for (const e of ev?.data || []) {
            if (e.type !== 'cast' || e.fake || !sd.roles.players.has(e.sourceID)) continue;
            if (!uses.has(e.sourceID)) uses.set(e.sourceID, []);
            uses.get(e.sourceID).push({ t: e.timestamp - f.startTime, guid: e.abilityGameID });
          }
          if (!ev?.nextPageTimestamp || ev.nextPageTimestamp <= start) break;
          start = ev.nextPageTimestamp;
        }
      }
      // piedras de salud (de brujo): lanzamientos durante el intento
      const stones = new Map(); // id -> [{t, guid}]
      try {
        const d = await gql(`query($code:String!,$s:Float,$e:Float){reportData{report(code:$code){
          events(startTime:$s,endTime:$e,dataType:Casts,limit:10000,filterExpression:"ability.id in (6262,5512,452930) or ability.name in (\\"Healthstone\\",\\"Piedra de salud\\",\\"Piedra de salud demon\u00edaca\\",\\"Demonic Healthstone\\")"){data}}}}`,
        { code: S.code, s: f.startTime, e: f.endTime });
        for (const ev of d.reportData.report.events?.data || []) {
          if (ev.type !== 'cast' || ev.fake || !sd.roles.players.has(ev.sourceID)) continue;
          if (!stones.has(ev.sourceID)) stones.set(ev.sourceID, []);
          stones.get(ev.sourceID).push({ t: ev.timestamp - f.startTime, guid: ev.abilityGameID });
        }
      } catch { /* sin datos de piedras */ }
      const rows = [];
      for (const p of sd.roles.players.values()) {
        let list = (uses.get(p.id) || []).sort((a, b) => a.t - b.t);
        let approx = false;
        if (!list.length && bandUse.has(p.id)) { list = bandUse.get(p.id).sort((a, b) => a.t - b.t); approx = true; }
        let pre = list.find((u) => u.t <= 1500 && u.t >= -30000);
        let inferred = false;
        // Si el log no guarda el lanzamiento pero la poción ya estaba activa al empezar el pull, se tomó 1-2 s antes: se cuenta en 0:00
        if (!pre) {
          const band = (bandUse.get(p.id) || []).find((u) => u.t <= 1500);
          if (band) { pre = { t: 0, guid: band.guid, aura: true }; inferred = true; }
        }
        const combat = list.filter((u) => u !== pre && u.t > 1500);
        rows.push({ p, pre, inferred, combat, approx, stones: (stones.get(p.id) || []).sort((a, b) => a.t - b.t), any: list.length > 0 });
      }
      return { rows, guids };
    });
  }

  async function viewPrepot(f, raw = S.fight) {
    const { rows, guids } = await prepotData(raw);
    if (!guids.size && !rows.some((r) => r.stones.length)) return `<div class="empty">${LL('No se detectó ninguna poción ni piedra de salud en este intento.', 'No potion or healthstone was detected in this pull.')}</div>`;
    const order = { tank: 0, healer: 1, dps: 2 };
    rows.sort((a, b) => order[a.p.role] - order[b.p.role] || a.p.name.localeCompare(b.p.name));
    const withPre = rows.filter((r) => r.pre).length;
    const ab = (u) => { const g = guids.get(u.guid) || ability(u.guid); return `<span class="pp-ab" data-spell="${u.guid}">${iconImg(g?.icon, 18)}</span>`; };
    const body = rows.map((r) => {
      const pi = playerInfo(r.p.id);
      return `<div class="pp-row ${isMe(r.p.name) ? 'me' : ''}">
        <span class="who">${pi.icon ? `<img class="spec-ic-sm" src="${specIconUrl(esc(pi.icon))}" width="22" height="22" alt="" style="--cc:${classColor(pi.cls)}">` : `<span class="dot" style="background:${classColor(pi.cls)}"></span>`}<b style="color:${classColor(pi.cls)}">${esc(r.p.name)}</b></span>
        <span class="pp-pre ${r.pre ? 'ok' : 'no'}">${r.pre ? `${ab(r.pre)} ${LL('Prepoti', 'Prepot')} <b>${sec(r.pre.t)}</b>${r.inferred ? `<small class="muted" title="${esc(LL('El log no guarda el lanzamiento, pero el buff ya estaba activo al empezar: se tomó 1-2 s antes del pull', 'The log has no cast, but the buff was already active at the pull: taken 1-2 s before it'))}"> *</small>` : ''}` : `✗ ${LL('Sin prepoti', 'No prepot')}`}</span>
        <span class="pp-combat">${r.combat.length ? r.combat.map((u) => `${ab(u)} <b>${sec(u.t)}</b>`).join(' · ') : '<span class="muted">—</span>'}</span>
        <span class="pp-hs">${r.stones.length ? r.stones.map((u) => `${ab(u)} <b>${sec(u.t)}</b>`).join(' · ') : '<span class="muted">—</span>'}</span>
      </div>`;
    }).join('');
    return `<div class="pp-sum"><b>${withPre}</b> / ${rows.length} ${LL('con prepoti', 'with prepot')}</div>
      <div class="pp-table"><div class="pp-row th"><span>${LL('Jugador', 'Player')}</span><span>${LL('Prepoti (antes del pull)', 'Prepot (before pull)')}</span><span>${LL('Pociones en combate (minuto de la pelea)', 'Combat potions (fight time)')}</span><span>${LL('Piedra de salud', 'Healthstone')}</span></div>${body}</div>
      <p class="foot">${LL('Tiempos respecto al inicio del pull: un valor negativo es antes de pullear. Si Warcraft Logs no guarda el lanzamiento pero el buff estaba activo al empezar, se cuenta como 0:00 (*).', 'Times relative to pull start: negative means before the pull. If Warcraft Logs has no cast event but the buff was active at the start, it counts as 0:00 (*).')}</p>`;
  }

  async function viewOverview(f, raw = S.fight) {
    const w = fw(raw);
    const [d, deaths, roles] = await Promise.all([fightData(w), Extras.deathTimes(w).catch(() => []), Extras.rolesData(w).catch(() => null)]);
    const dur = fightDur(w) / 1000;
    const sum = (arr) => arr.filter((e) => isPlayer(e.id, e)).reduce((s, e) => s + (e.total || 0), 0);
    const tiles = [
      [LL('Resultado', 'Result'), raw.kill ? `<b class="okc">${LL('Kill', 'Kill')}</b>` : `<b class="badc">${LL('Wipe', 'Wipe')} ${raw.fightPercentage != null ? num(pctOf(raw.fightPercentage), 1) + ' %' : ''}</b>`],
      [LL('Duración', 'Duration'), clock(fightDur(w))],
      [LL('Muertes', 'Deaths'), deaths.length],
      [LL('DPS de banda', 'Raid DPS'), plain(sum(d.dmg) / dur)],
      [LL('HPS de banda', 'Raid HPS'), plain(sum(d.heal) / dur)],
      [LL('Daño recibido medio', 'Avg damage taken'), plain(sum(d.taken) / dur)],
      [LL('Jugadores', 'Players'), roles ? roles.players.size : '–'],
      [LL('Nivel de objeto', 'Item level'), roles?.itemLevel ? num(roles.itemLevel, 1) : '–'],
    ].map(([k, v]) => `<div class="ov-tile"><small>${k}</small><div>${v}</div></div>`).join('');
    const segs = phaseSegments(raw);
    const total = fightDur(raw);
    const phases = segs.length ? `<div class="ov-phases">${segs.map((s, i) => `<span class="ov-ph ${s.intermission ? 'int' : ''}" style="flex:${s.end - s.start} 1 0" title="${esc(s.name)}"><i>${esc(s.name)}</i><small>${clock(s.start - raw.startTime)} · ${clock(s.end - s.start)}</small></span>`).join('')}
      </div>` : '';
    const dl = deaths.slice(0, 12).map((x) => {
      const pi = playerInfo(x.targetID);
      return `<span class="chip"><span class="sq" style="background:${classColor(pi.cls)}"></span>${esc(pi.name)} <span class="muted">${clock(x.timestamp - raw.startTime)}</span></span>`;
    }).join('');
    return `<div class="ov-tiles">${tiles}</div>
      ${phases ? `<h3 class="sec">${LL('Fases', 'Phases')}</h3>${phases}` : ''}
      ${deaths.length ? `<h3 class="sec">${LL('Primeras muertes', 'First deaths')}</h3><div class="chips">${dl}</div>` : ''}
      ${typeof MechGuide !== 'undefined' ? MechGuide.changesHTML(raw) : ''}`;
  }

  VIEWS.buffs = async (f) => {
    const mode = !S.buffsMode || S.buffsMode === 'player' ? 'raid' : S.buffsMode;
    const chip = (k, label) => `<button class="chip ${mode === k ? 'on' : ''}" data-action="buffs-mode" data-m="${k}">${label}</button>`;
    const bar = `<div class="metricbar">${chip('pi', LL('Detector de PI', 'PI detector'))}${chip('prepot', LL('Prepoti y pociones', 'Prepot & potions'))}${chip('raid', LL('Buffos de banda por clase', 'Raid buffs by class'))}${chip('overview', LL('Resumen del intento', 'Fight overview'))}</div>`;
    let body;
    if (mode === 'pi') body = await origPi(f);
    else if (mode === 'prepot') body = headerHTML(f, LL('Prepoti y pociones', 'Prepot & potions')) + await viewPrepot(f);
    else if (mode === 'raid') body = headerHTML(f, LL('Buffos y debuffs de banda por clase', 'Raid buffs and debuffs by class')) + await Extras.raidBuffsView(f);
    else if (mode === 'overview') body = headerHTML(f, LL('Resumen del intento', 'Fight overview')) + await viewOverview(f);
    else body = await origBuffs(f);
    // alcance: este intento, todos los intentos del jefe o todos los kills del log; cada intento va en su propio bloque que se carga al abrirlo
    const scope = S.buffsScope || 'this';
    const hasBoss = !!S.fight?.encounterID && !S.fight?.keystoneLevel;
    const scopeFights = scope === 'boss' && hasBoss
      ? S.fights.filter((x) => x.encounterID === S.fight.encounterID && x.difficulty === S.fight.difficulty && !x.keystoneLevel)
      : scope === 'log' ? S.fights.filter((x) => x.encounterID && x.kill && !x.keystoneLevel) : [];
    const sc = (k, label) => `<button class="chip ${scope === k ? 'on' : ''}" data-action="buffs-scope" data-s="${k}">${label}</button>`;
    const scopeBar = `<div class="metricbar"><span class="muted">${LL('Alcance', 'Scope')}</span>${sc('this', LL('Este intento', 'This pull'))}${hasBoss ? sc('boss', LL('Todos los intentos del jefe', 'All tries of this boss')) : ''}${sc('log', LL('Todos los kills del log', 'All kills in the log'))}</div>`;
    if (scopeFights.length && mode !== 'player') {
      const sorted = [...scopeFights].sort((a, b) => a.startTime - b.startTime);
      let top = '';
      if (mode === 'pi') {
        const lists = [];
        for (let i = 0; i < sorted.length; i += 3) lists.push(...await Promise.all(sorted.slice(i, i + 3).map((x) => piData(fw(x)).catch(() => []))));
        const byTarget = new Map();
        let n = 0;
        for (const l of lists) for (const p of l) { n++; byTarget.set(p.target, (byTarget.get(p.target) || 0) + 1); }
        const chips = [...byTarget.entries()].sort((a, b) => b[1] - a[1]).map(([id, c]) => { const p = playerInfo(id); return `<span class="chip on ${isMe(p.name) ? 'me' : ''}" style="--cc:${classColor(p.cls)}"><span class="sq"></span>${esc(p.name)} <b>×${c}</b></span>`; }).join('');
        top = `<p class="muted bx-sum"><b>${n}</b> ${LL('Infusiones de poder en', 'Power Infusions in')} ${sorted.length} ${LL('intentos', 'pulls')}</p><div class="chips">${chips}</div>`;
      }
      const blocks = sorted.map((x, i) => `<details class="bx-try" data-bx="${x.id}" data-bm="${mode}" ${i === 0 ? 'open' : ''}><summary><span>${esc(x.name)} · ${esc(fightLabel(x))}</span><small class="muted">${new Date(S.report.startTime + x.startTime).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</small></summary><div class="bx-body">${i === 0 ? loadingHTML() : ''}</div></details>`).join('');
      S.post = async (seq) => { if (seq === S.seq) bxLoad(document.querySelector('.bx-try[open]')); };
      const head = headerHTML(f, LL('Buffos del conjunto de intentos', 'Buffs across pulls'), LL(`${sorted.length} intentos`, `${sorted.length} pulls`));
      return head + bar + scopeBar + top + `<div class="bx-list">${blocks}</div>`;
    }
    // la barra va siempre justo debajo de la cabecera (el primer bloque .hdr completo), igual en todos los modos
    if (body.startsWith('<div class="hdr"')) {
      let depth = 0;
      const re = /<div\b|<\/div>/g;
      let m;
      while ((m = re.exec(body))) {
        depth += m[0] === '</div>' ? -1 : 1;
        if (depth === 0) { const end = m.index + 6; return body.slice(0, end) + bar + scopeBar + body.slice(end); }
      }
    }
    return bar + scopeBar + body;
  };

  // ============================================================ MÍTICA+: pulls en la barra lateral
  const pullCache = new Map();
  function pullStats(raw) {
    return cached(`pullstats:${raw.id}`, async () => {
      const pulls = raw.dungeonPulls || [];
      const out = [];
      for (let i = 0; i < pulls.length; i += 10) {
        const chunk = pulls.slice(i, i + 10);
        const aliases = chunk.map((p, j) => `p${j}:table(fightIDs:$f,dataType:DamageDone,startTime:${p.startTime},endTime:${p.endTime})`).join(' ');
        const d = await gql(`query($code:String!,$f:[Int]){reportData{report(code:$code){${aliases}}}}`, { code: S.code, f: [raw.id] });
        chunk.forEach((p, j) => {
          const dmg = entriesOf(d.reportData.report[`p${j}`]).filter((e) => isPlayer(e.id, e)).reduce((s, e) => s + (e.total || 0), 0);
          out.push({ dmg, dps: dmg / Math.max(1, (p.endTime - p.startTime) / 1000) });
        });
      }
      return out;
    });
  }

  function sidePulls(f) {
    const bossIds = new Set([...S.actors.values()].filter((a) => a.subType === 'Boss').map((a) => a.id));
    const cur = S.range && S.range.fight === f.id ? S.range.phaseIdx : null;
    const rows = f.dungeonPulls.map((p, i) => {
      const boss = (p.enemyNPCs || []).some((m) => bossIds.has(m.id));
      return `<button class="pullrow ${cur === i ? 'active' : ''}" data-action="range" data-phase="${i}">
        <span class="pr-n">${boss ? '<img class="wi" src="icons/inv_misc_bone_humanskull_01.jpg" width="14" height="14" alt="">' : ''}Pull ${p.id}</span><span class="pr-t">${clock(p.endTime - p.startTime)}</span><span class="pr-d" data-pull-dmg="${i}">…</span><i class="pr-bar" data-pull-bar="${i}"></i></button>`;
    }).join('');
    return `<div class="pullside"><button class="pullrow ${cur == null ? 'active' : ''}" data-action="range" data-phase="full"><span class="pr-n">${LL('Clave completa', 'Whole key')}</span><span class="pr-t">${clock(fightDur(f))}</span></button>${rows}</div>`;
  }

  async function afterSidebar() {
    const raw = S.fight;
    const slots = document.querySelectorAll('[data-pull-dmg]');
    if (!raw || !slots.length) return;
    try {
      const stats = await pullStats(raw);
      const max = Math.max(...stats.map((s) => s.dmg), 1);
      document.querySelectorAll('[data-pull-dmg]').forEach((el) => {
        const s = stats[Number(el.dataset.pullDmg)];
        if (!s) return;
        el.textContent = plain(s.dmg);
        const bar = document.querySelector(`[data-pull-bar="${el.dataset.pullDmg}"]`);
        if (bar) bar.style.width = `${(s.dmg / max) * 100}%`;
      });
    } catch (e) { console.warn('pullstats', e); }
  }

  document.addEventListener('click', (ev) => {
    const row = ev.target.closest('.pullrow');
    if (row) setTimeout(() => {
      const cur = S.range && S.range.fight === S.fight?.id ? S.range.phaseIdx : null;
      document.querySelectorAll('.pullrow').forEach((r) => {
        const ph = r.dataset.phase;
        r.classList.toggle('active', ph === 'full' ? cur == null : Number(ph) === cur);
      });
    }, 0);
    const b = ev.target.closest('[data-action="buffs-mode"]');
    if (b) { S.buffsMode = b.dataset.m; render(); return; }
    const bs = ev.target.closest('[data-action="buffs-scope"]');
    if (bs) { S.buffsScope = bs.dataset.s; render(); return; }
    const mp = ev.target.closest('[data-action="mp-player"]');
    if (mp) { S.mpPlayer = Number(mp.dataset.id); render(); }
  });

  // carga (una vez) el contenido de un intento dentro del alcance «varios intentos»
  async function bxLoad(det) {
    if (!det || det.dataset.done) return;
    det.dataset.done = '1';
    const box = det.querySelector('.bx-body');
    const raw = S.fights.find((x) => x.id === Number(det.dataset.bx));
    if (!raw) return;
    const w = fw(raw);
    const seq = S.seq;
    try {
      let body;
      const m = det.dataset.bm;
      if (m === 'pi') body = await origPi(w);
      else if (m === 'prepot') body = await viewPrepot(w, raw);
      else if (m === 'raid') body = await Extras.raidBuffsView(w);
      else body = await viewOverview(w, raw);
      if (seq !== S.seq) return;
      box.innerHTML = body.startsWith('<div class="hdr"') ? (() => { let d = 0; const re = /<div\b|<\/div>/g; let x; while ((x = re.exec(body))) { d += x[0] === '</div>' ? -1 : 1; if (d === 0) return body.slice(x.index + 6); } return body; })() : body;
    } catch (e) { box.innerHTML = `<div class="empty">${esc(LL('No se pudo cargar este intento.', 'Could not load this pull.'))}</div>`; det.dataset.done = ''; }
  }
  document.addEventListener('toggle', (ev) => { if (ev.target.classList?.contains('bx-try') && ev.target.open) bxLoad(ev.target); }, true);

  // ============================================================ MÍTICA+: compararte con los mejores de tu llave
  const origMplus = VIEWS.mplus;
  VIEWS.mplus = async (f) => {
    const html = await origMplus(f);
    const raw = S.fight;
    if (!raw?.keystoneLevel) return html;
    const prev = S.post;
    S.post = async (seq) => { await prev?.(seq); mplusOverall(seq, raw); await mplusBest(seq, raw); };
    const i = html.indexOf('</div></div>') + 12;
    const overall = `<h3 class="sec">${LL('Overall de la mítica', 'Key overall')}</h3><div id="mpOverall"><div class="loading"><span class="spinner"></span>${t('loading')}</div></div>`;
    return `${i >= 12 ? html.slice(0, i) + overall + html.slice(i) : html + overall}<h3 class="sec">${LL(`Compararte con los mejores de +${raw.keystoneLevel}`, `Compare with the best at +${raw.keystoneLevel}`)}</h3><div id="mpBest"><div class="loading"><span class="spinner"></span>${t('loading')}</div></div>`;
  };

  async function mplusOverall(seq, raw) {
    const box = document.getElementById('mpOverall');
    if (!box) return;
    try {
      const w = fw(raw);
      const [d, deaths, util] = await Promise.all([fightData(w), Extras.deathTimes(w).catch(() => []), utilityData(w).catch(() => ({ interrupts: [], dispels: [] }))]);
      if (seq !== S.seq || !document.getElementById('mpOverall')) return;
      const dur = fightDur(w) / 1000;
      const sum = (arr) => arr.filter((e) => isPlayer(e.id, e)).reduce((s, e) => s + (e.total || 0), 0);
      const dmg = sum(d.dmg); const heal = sum(d.heal); const taken = sum(d.taken);
      const ints = util.interrupts.filter((e) => isPlayer(e.sourceID));
      const byInt = new Map();
      for (const e of ints) byInt.set(e.sourceID, (byInt.get(e.sourceID) || 0) + 1);
      const topInt = [...byInt.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => { const p = playerInfo(id); return `<span class="chip"><span class="sq" style="background:${classColor(p.cls)}"></span>${esc(p.name)} <b>${n}</b></span>`; }).join('');
      const byDeath = new Map();
      for (const x of deaths) byDeath.set(x.targetID, (byDeath.get(x.targetID) || 0) + 1);
      const deathChips = [...byDeath.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => { const p = playerInfo(id); return `<span class="chip"><span class="sq" style="background:${classColor(p.cls)}"></span>${esc(p.name)} <b>×${n}</b></span>`; }).join('');
      const tile = (k, v, sub = '') => `<div class="ov-tile"><small>${k}</small><div>${v}</div>${sub ? `<small>${sub}</small>` : ''}</div>`;
      box.innerHTML = `<div class="ov-tiles">
        ${tile(LL('Cortes', 'Interrupts'), ints.length, `${util.dispels.filter((e) => isPlayer(e.sourceID)).length} dispels`)}
        ${tile(LL('Daño total', 'Total damage'), plain(dmg), `${plain(dmg / dur)}`)}
        ${tile(LL('Muertes', 'Deaths'), deaths.length, deaths.length ? `${LL('penalización de tiempo', 'time penalty')}: ${clock(deaths.length * 5000 * 1)}` : '')}
        ${tile(LL('Sanación total', 'Total healing'), plain(heal), `${plain(heal / dur)}`)}
        ${tile(LL('Daño recibido', 'Damage taken'), plain(taken), `${plain(taken / dur)}`)}
      </div>
      ${topInt ? `<h4 class="subh">${LL('Quién cortó', 'Who interrupted')}</h4><div class="chips">${topInt}</div>` : ''}
      ${deathChips ? `<h4 class="subh">${LL('Quién murió', 'Who died')}</h4><div class="chips">${deathChips}</div>` : ''}`;
    } catch (e) {
      console.warn('mplusOverall', e);
      if (seq === S.seq && document.getElementById('mpOverall')) box.innerHTML = errorHTML(friendlyError(e));
    }
  }

  async function mplusBest(seq, raw) {
    const box = document.getElementById('mpBest');
    if (!box) return;
    try {
      const w = fw(raw);
      const roles = await Extras.rolesData(w);
      const players = [...roles.players.values()];
      const mine = players.find((p) => isMe(p.name)) || players[0];
      const sel = players.find((p) => p.id === S.mpPlayer) || mine;
      const pi = playerInfo(sel.id);
      const spec = (sel.specs && sel.specs[0]) || pi.spec;
      const metric = sel.role === 'healer' ? 'hps' : 'dps';
      const zb = (await gql(`{worldData{encounter(id:${Number(raw.encounterID)}){zone{brackets{min bucket type}}}}}`).catch(() => null))?.worldData?.encounter?.zone?.brackets;
      const idx = zb ? Math.floor((raw.keystoneLevel - zb.min) / (zb.bucket || 1)) + 1 : 0;
      const q = (args) => gql(`{worldData{encounter(id:${Number(raw.encounterID)}){p:characterRankings(className:"${pi.cls}",specName:"${spec}",${args}metric:${metric},page:1)}}}`, undefined, true);
      let list = idx > 0 ? (await q(`bracket:${idx},`)).worldData?.encounter?.p?.rankings || [] : [];
      let exact = list.length > 0;
      if (!list.length) list = (await q('')).worldData?.encounter?.p?.rankings || [];
      if (seq !== S.seq || !document.getElementById('mpBest')) return;
      const data = await fightData(w);
      const entry = (metric === 'hps' ? data.heal : data.dmg).find((e) => e.id === sel.id);
      const dur = fightDur(w) / 1000;
      const myRate = (entry?.total || 0) / dur;
      const amounts = list.map((r) => r.amount).sort((a, b) => b - a);
      const med = amounts[Math.floor(amounts.length / 2)] || 0;
      const better = amounts.filter((a) => a > myRate).length;
      const picker = `<div class="chips">${players.map((p) => { const q2 = playerInfo(p.id); return `<button class="chip ${p.id === sel.id ? 'on' : ''}" data-action="mp-player" data-id="${p.id}" style="--cc:${classColor(q2.cls)}"><span class="sq"></span>${esc(p.name)}</button>`; }).join('')}</div>`;
      const stat = (k, v, sub = '') => `<div class="ov-tile"><small>${k}</small><div>${v}</div>${sub ? `<small>${sub}</small>` : ''}</div>`;
      box.innerHTML = `${picker}
        <div class="ov-tiles">
          ${stat(LL('Tu ' + metric.toUpperCase(), 'Your ' + metric.toUpperCase()), `<b>${plain(myRate)}</b>`, esc(sel.name))}
          ${stat(LL('Top 1', 'Top 1'), plain(amounts[0] || 0), exact ? `+${raw.keystoneLevel}` : LL('todas las llaves', 'all keys'))}
          ${stat(LL('Mediana del top', 'Top median'), plain(med), `${amounts.length} ${LL('jugadores', 'players')}`)}
          ${stat(LL('Tu posición', 'Your position'), amounts.length ? `${better + 1} / ${amounts.length}` : '–', myRate >= med ? LL('por encima de la mediana', 'above median') : LL('por debajo de la mediana', 'below median'))}
        </div>
        <p class="foot">${exact ? LL(`Ranking de ${esc(specName(spec))} ${esc(className(pi.cls))} en esta mazmorra con llaves de +${raw.keystoneLevel}.`, `Ranking of ${esc(specName(spec))} ${esc(className(pi.cls))} in this dungeon with +${raw.keystoneLevel} keys.`)
          : LL('No hay ranking de tu nivel exacto: se usa el ranking general de la mazmorra.', 'No ranking for your exact level: using the dungeon-wide ranking.')}</p>
        <button class="btn primary" data-action="player" data-id="${sel.id}" data-ptab="analyze">${LL('Ver exactamente qué mejorar (analizar contra los mejores)', 'See exactly what to improve (analyze vs the best)')}</button>`;
    } catch (e) {
      console.warn('mplusBest', e);
      if (seq === S.seq && document.getElementById('mpBest')) box.innerHTML = errorHTML(friendlyError(e));
    }
  }

  // ============================================================ VS TU MEJOR TRY
  const groupOf = (f) => S.fights.filter((x) => x.groupKey && x.groupKey === f.groupKey);
  const progressOf = (x) => (x.kill ? -1 : pctOf(x.fightPercentage ?? x.bossPercentage) ?? 101);
  function bestOther(f) {
    const others = groupOf(f).filter((x) => x.id !== f.id);
    if (!others.length) return null;
    return [...others].sort((a, b) => progressOf(a) - progressOf(b) || (a.kill && b.kill ? fightDur(a) - fightDur(b) : fightDur(b) - fightDur(a)))[0];
  }

  function prevOther(f) {
    return groupOf(f).filter((x) => x.id !== f.id && x.startTime < f.startTime).sort((a, b) => b.startTime - a.startTime)[0] || null;
  }

  async function snapshot(x) {
    const w = fw(x);
    const [d, deaths] = await Promise.all([fightData(w), Extras.deathTimes(w).catch(() => [])]);
    const dur = fightDur(w) / 1000;
    const per = new Map();
    for (const e of d.dmg.filter((e) => isPlayer(e.id, e))) per.set(e.id, { id: e.id, dmg: e.total, rate: e.total / dur, cls: e.type, icon: e.icon, name: e.name });
    const heal = new Map(d.heal.filter((e) => isPlayer(e.id, e) && e.total > 0).map((e) => [e.id, { id: e.id, rate: e.total / dur, cls: e.type, icon: e.icon, name: e.name }]));
    return { x, dur, deaths, per, heal, taken: d.taken.filter((e) => isPlayer(e.id, e)).reduce((s, e) => s + e.total, 0), dps: [...per.values()].reduce((s, e) => s + e.rate, 0) };
  }

  const pickDefault = (f) => prevOther(f) || bestOther(f);
  const pickOther = (f) => groupOf(f).find((x) => x.id === S.cmpPick && x.id !== f.id) || pickDefault(f);
  document.addEventListener('change', (ev) => {
    const s = ev.target.closest?.('select[data-action="cmp-pick"]');
    if (!s) return;
    S.cmpPick = Number(s.value); S.cmpMode = 'pick';
    render();
  });

  function cmpBarHTML() {
    const chip = (k, label) => `<button class="chip ${(S.cmpMode || 'best') === k ? 'on' : ''}" data-action="cmp-mode" data-m="${k}">${label}</button>`;
    const others = groupOf(S.fight).filter((x) => x.id !== S.fight.id).sort((a, b) => a.startTime - b.startTime);
    const pickOn = S.cmpMode === 'pick';
    const sel = others.length ? `<select class="txt" data-action="cmp-pick" title="${esc(LL('Elige con qué intento comparar', 'Choose which attempt to compare with'))}">${others.map((x) => `<option value="${x.id}" ${x.id === (S.cmpPick ?? pickDefault(S.fight)?.id) ? 'selected' : ''}>${esc(fightLabel(x))} · ${clock(fightDur(x))}</option>`).join('')}</select>` : '';
    return `<div class="metricbar"><span class="muted">${LL('Comparar con', 'Compare with')}</span>${chip('best', LL('Tu mejor intento', 'Your best attempt'))}${chip('prev', LL('Intento anterior', 'Previous attempt'))}${chip('pick', LL('Elegir intento', 'Pick an attempt'))}${pickOn ? sel : ''}</div>`;
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest?.('[data-action="cmp-mode"]');
    if (!b) return;
    S.cmpMode = b.dataset.m;
    render();
  });

  async function viewBestCmp(f) {
    const cur = S.fight;
    const pickMode = S.cmpMode === 'pick';
    const prevMode = S.cmpMode === 'prev';
    const best = prevMode ? prevOther(cur) : pickMode ? pickOther(cur) : bestOther(cur);
    const tag = prevMode ? LL('anterior', 'previous') : pickMode ? LL('elegido', 'chosen') : LL('tu mejor', 'your best');
    if (!best) return headerHTML(f, t('tabs.bestcmp')) + `${cmpBarHTML()}<div class="empty">${prevMode ? LL('Este es el primer intento de este jefe en el reporte: no hay uno anterior.', 'This is the first attempt at this boss in the report: there is no previous one.') : LL('Este es el único intento de este jefe en el reporte.', 'This is the only attempt at this boss in the report.')}</div>`;
    const [A, B] = await Promise.all([snapshot(cur), snapshot(best)]);
    const delta = (a, b, fmt, goodHigh = true) => {
      const diff = a - b;
      const good = goodHigh ? diff >= 0 : diff <= 0;
      return `<span class="${Math.abs(diff) < 1e-9 ? '' : good ? 'okc' : 'badc'}">${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))}</span>`;
    };
    const hp = (x) => (x.kill ? LL('Kill', 'Kill') : `${num(pctOf(x.fightPercentage ?? x.bossPercentage) ?? 0, 1)} %`);
    const rowT = (label, a, b, d) => `<div class="bc-row"><span>${label}</span><b>${a}</b><b>${b}</b><span>${d}</span></div>`;
    const head = `<div class="bc-row th"><span></span><span>${esc(fightLabel(cur))}<small>${LL('actual', 'current')}</small></span><span>${esc(fightLabel(best))}<small>${tag}</small></span><span>${LL('Diferencia', 'Difference')}</span></div>`;
    const summary = head
      + rowT(LL('Resultado', 'Result'), hp(cur), hp(best), '')
      + rowT(LL('Duración', 'Duration'), clock(fightDur(cur)), clock(fightDur(best)), delta(A.dur, B.dur, (v) => clock(v * 1000), false))
      + rowT(LL('Muertes', 'Deaths'), A.deaths.length, B.deaths.length, delta(A.deaths.length, B.deaths.length, (v) => v, false))
      + rowT(LL('DPS de banda', 'Raid DPS'), plain(A.dps), plain(B.dps), delta(A.dps, B.dps, plain))
      + rowT(LL('Daño recibido', 'Damage taken'), plain(A.taken), plain(B.taken), delta(A.taken / A.dur, B.taken / B.dur, (v) => plain(v), false));
    // por jugador
    const names = [...new Set([...A.per.keys(), ...B.per.keys()])];
    const prow = names.map((id) => {
      const a = A.per.get(id);
      const b = B.per.get(id);
      const pi = playerInfo(id, a || b);
      return { pi, a, b, diff: (a?.rate || 0) - (b?.rate || 0) };
    }).sort((x, y) => (y.a?.rate || 0) - (x.a?.rate || 0));
    const players = prow.map((r) => `<div class="bc-row ${isMe(r.pi.name) ? 'me' : ''}"><span class="who">${r.pi.icon && r.pi.icon.includes('-') ? `<img class="spec-ic-sm" src="${specIconUrl(esc(r.pi.icon))}" width="22" height="22" alt="" style="--cc:${classColor(r.pi.cls)}">` : `<span class="dot" style="background:${classColor(r.pi.cls)}"></span>`}<b style="color:${classColor(r.pi.cls)}">${esc(r.pi.name)}</b></span>
      <b>${r.a ? plain(r.a.rate) : '—'}</b><b>${r.b ? plain(r.b.rate) : '—'}</b>${r.a && r.b ? delta(r.a.rate, r.b.rate, (v) => plain(v)) : '<span></span>'}</div>`).join('');
    // sanación por sanador
    const hIds = [...new Set([...A.heal.keys(), ...B.heal.keys()])].filter((id) => HEALER_SPECS.has(playerInfo(id, A.heal.get(id) || B.heal.get(id)).spec));
    const healRows = hIds.map((id) => ({ id, a: A.heal.get(id), b: B.heal.get(id) })).sort((x, y) => (y.a?.rate || 0) - (x.a?.rate || 0)).map((r) => {
      const pi = playerInfo(r.id, r.a || r.b);
      return `<div class="bc-row ${isMe(pi.name) ? 'me' : ''}"><span class="who">${pi.icon && pi.icon.includes('-') ? `<img class="spec-ic-sm" src="${specIconUrl(esc(pi.icon))}" width="22" height="22" alt="" style="--cc:${classColor(pi.cls)}">` : ''}<b style="color:${classColor(pi.cls)}">${esc(pi.name)}</b></span>
        <b>${r.a ? plain(r.a.rate) : '—'}</b><b>${r.b ? plain(r.b.rate) : '—'}</b>${r.a && r.b ? delta(r.a.rate, r.b.rate, (v) => plain(v)) : '<span></span>'}</div>`;
    }).join('');
    // muertes lado a lado
    const dcol = (S2) => (S2.deaths.length ? S2.deaths.slice(0, 15).map((d) => { const pi = playerInfo(d.targetID); return `<div><b style="color:${classColor(pi.cls)}">${esc(pi.name)}</b> <span class="muted">${clock(d.timestamp - S2.x.startTime)}</span></div>`; }).join('') : `<div class="muted">${LL('Sin muertes', 'No deaths')}</div>`);
    const deaths = `<div class="bc-deaths"><div><h4>${esc(fightLabel(cur))}</h4>${dcol(A)}</div><div><h4>${esc(fightLabel(best))}</h4>${dcol(B)}</div></div>`;
    // tu rotación: lanzamientos por habilidad
    let rot = '';
    const me = [...A.per.values()].find((e) => isMe(e.name));
    if (me && B.per.has(me.id)) {
      const [pa, pb] = await Promise.all([playerData(windowed(cur), me.id), playerData(windowed(best), me.id)]);
      const count = (pd) => { const m = new Map(); for (const c of pd.casts) m.set(c.abilityGameID, (m.get(c.abilityGameID) || 0) + 1); return m; };
      const ca = count(pa); const cb = count(pb);
      const ids = [...new Set([...ca.keys(), ...cb.keys()])].map((id) => ({ id, a: ca.get(id) || 0, b: cb.get(id) || 0 }))
        .filter((x) => x.a + x.b >= 3).sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b)).slice(0, 12);
      rot = `<h3 class="sec">${LL('Tu rotación (lanzamientos)', 'Your rotation (casts)')} · ${esc(me.name)}</h3><div class="bc-table"><div class="bc-row th"><span>${LL('Habilidad', 'Ability')}</span><span>${LL('Actual', 'Current')}</span><span>${LL('Mejor', 'Best')}</span><span>${LL('Diferencia', 'Difference')}</span></div>${ids.map((x) => {
        const ab = ability(x.id);
        return `<div class="bc-row"><span class="ab" data-spell="${x.id}">${iconImg(ab.icon, 20)}${esc(ab.name)}</span><b>${x.a}</b><b>${x.b}</b>${delta(x.a, x.b, (v) => v)}</div>`;
      }).join('')}</div>`;
    }
    return headerHTML(f, t('tabs.bestcmp'), prevMode ? LL(`Comparado con el intento anterior: <b>${esc(fightLabel(best))}</b>`, `Compared with the previous attempt: <b>${esc(fightLabel(best))}</b>`) : pickMode ? LL(`Comparado con el intento elegido: <b>${esc(fightLabel(best))}</b>`, `Compared with the chosen attempt: <b>${esc(fightLabel(best))}</b>`) : LL(`Comparado con tu mejor intento: <b>${esc(fightLabel(best))}</b>`, `Compared with your best attempt: <b>${esc(fightLabel(best))}</b>`))
      + cmpBarHTML() + `<div class="bc-table">${summary}</div>
        <h3 class="sec">${LL('DPS por jugador', 'DPS per player')}</h3><div class="bc-table">${players}</div>
        ${healRows ? `<h3 class="sec">${LL('HPS por sanador', 'HPS per healer')}</h3><div class="bc-table">${healRows}</div>` : ''}
        <h3 class="sec">${LL('Muertes lado a lado', 'Deaths side by side')}</h3>${deaths}${rot}
        <p class="foot">${LL('Tu mejor intento es el kill más rápido o, si no hay kill, el wipe con menos vida del jefe.', 'Your best attempt is the fastest kill or, with no kill, the wipe with the lowest boss health.')}</p>`;
  }

  // ============================================================ INFORME DE LA NOCHE
  function nightData() {
    const groups = new Map();
    for (const f of S.fights) {
      if (!f.encounterID || f.keystoneLevel) continue;
      if (!groups.has(f.groupKey)) groups.set(f.groupKey, []);
      groups.get(f.groupKey).push(f);
    }
    const out = [];
    for (const list of groups.values()) {
      const kills = list.filter((x) => x.kill);
      const best = [...list].sort((a, b) => progressOf(a) - progressOf(b) || fightDur(a) - fightDur(b))[0];
      out.push({ name: list[0].name, diff: list[0].difficulty, list, kills: kills.length, best, time: list.reduce((s, x) => s + fightDur(x), 0) });
    }
    return out.sort((a, b) => a.list[0].startTime - b.list[0].startTime);
  }

  function nightText(rows, r) {
    const lines = [`WipeTime — ${r.title}`, `${zoneName(r.zone?.name)} · ${new Date(r.startTime).toLocaleDateString(locale())}`, ''];
    for (const g of rows) lines.push(`${g.name} (${diffName(g.diff)}): ${g.kills ? LL('KILL en try ', 'KILL on try ') + g.best.tryNo : LL('mejor try ', 'best try ') + num(pctOf(g.best.fightPercentage ?? g.best.bossPercentage) ?? 0, 1) + ' %'} · ${g.list.length} ${LL('intentos', 'pulls')} · ${clock(g.time)}`);
    lines.push('', `https://www.warcraftlogs.com/reports/${S.code}`);
    return lines.join('\n');
  }


  // ---- Rankings de la noche: quién muere más (solo las 2 primeras muertes de cada try), mejores DPS y mejores sanadores
  const HEAL_SPECS = new Set(['Restoration', 'Holy', 'Discipline', 'Mistweaver', 'Preservation']);
  const TANK_SPECS = new Set(['Blood', 'Vengeance', 'Guardian', 'Brewmaster', 'Protection']);
  const CROWNS = ['#ffc933', '#e6ebf3', '#b0692a'];
  const crownSvg = (rank) => `<svg class="crown" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><defs><linearGradient id="cr${rank}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs><path d="M3 18.500 1.800 7.500l5 4L12 4.500l5.200 7 5-4L21 18.500z" fill="${CROWNS[rank - 1]}" stroke="#00000066" stroke-width="1" stroke-linejoin="round"/><path d="M3 18.500 1.800 7.500l5 4L12 4.500l5.200 7 5-4L21 18.500z" fill="url(#cr${rank})" opacity=".3"/><path d="M3.500 20.500h17" stroke="${CROWNS[rank - 1]}" stroke-width="2.200" stroke-linecap="round"/><circle cx="12" cy="4.200" r="1.500" fill="${CROWNS[rank - 1]}"/><circle cx="1.800" cy="7" r="1.200" fill="${CROWNS[rank - 1]}"/><circle cx="22.200" cy="7" r="1.200" fill="${CROWNS[rank - 1]}"/></svg>`;

  function nightTopsData() {
    return cached(`nighttops:v5:${S.code}`, async () => {
      const fights = S.fights.filter((x) => x.encounterID && !x.keystoneLevel);
      const agg = new Map(); // id -> { id, icon, dmg, durD, heal, durH }
      const rec = (e) => {
        if (!agg.has(e.id)) agg.set(e.id, { id: e.id, icon: e.icon || playerInfo(e.id, e).icon, dmg: 0, durD: 0, heal: 0, durH: 0 });
        return agg.get(e.id);
      };
      for (let i = 0; i < fights.length; i += 6) {
        const chunk = fights.slice(i, i + 6);
        const parts = chunk.map((x, j) => `d${j}:table(fightIDs:[${x.id}],dataType:DamageDone,startTime:${x.startTime},endTime:${x.endTime}) h${j}:table(fightIDs:[${x.id}],dataType:Healing,startTime:${x.startTime},endTime:${x.endTime})`).join(' ');
        const d = await gql(`query($code:String!){reportData{report(code:$code){${parts}}}}`, { code: S.code });
        chunk.forEach((x, j) => {
          const dur = (x.endTime - x.startTime) / 1000;
          for (const e of entriesOf(d.reportData.report[`d${j}`]).filter((q) => isPlayer(q.id, q) && q.total > 0)) { const r = rec(e); r.dmg += e.total; r.durD += dur; }
          for (const e of entriesOf(d.reportData.report[`h${j}`]).filter((q) => isPlayer(q.id, q) && q.total > 0)) { const r = rec(e); r.heal += e.total; r.durH += dur; }
        });
      }
      // muertes: solo las dos primeras de cada intento (el resto suele ser consecuencia del wipe)
      const deaths = new Map();
      for (let i = 0; i < fights.length; i += 4) {
        const batch = await Promise.all(fights.slice(i, i + 4).map((x) => allEvents(x, 'Deaths').catch(() => [])));
        for (const ev of batch) {
          const first = ev.filter((q) => q.type === 'death' && isPlayer(q.targetID)).sort((a, b) => a.timestamp - b.timestamp).slice(0, 2);
          for (const q of first) deaths.set(q.targetID, (deaths.get(q.targetID) || 0) + 1);
        }
      }
      // cortes: interrupciones de jugadores en todos los intentos
      const ints = new Map();
      for (let i = 0; i < fights.length; i += 4) {
        const batch = await Promise.all(fights.slice(i, i + 4).map((x) => allEvents(x, 'Interrupts').catch(() => [])));
        for (const ev of batch) for (const q of ev) if (q.type === 'interrupt' && isPlayer(q.sourceID)) ints.set(q.sourceID, (ints.get(q.sourceID) || 0) + 1);
      }
      // dispels: disipaciones de jugadores en todos los intentos
      const disp = new Map();
      for (let i = 0; i < fights.length; i += 4) {
        const batch = await Promise.all(fights.slice(i, i + 4).map((x) => allEvents(x, 'Dispels').catch(() => [])));
        for (const ev of batch) for (const q of ev) if (q.type === 'dispel' && isPlayer(q.sourceID)) disp.set(q.sourceID, (disp.get(q.sourceID) || 0) + 1);
      }
      // disfrutones: quién recibe más Infusiones de poder (los sacerdotes no cuentan: ellos siempre se la pueden poner)
      const pis = new Map();
      for (let i = 0; i < fights.length; i += 4) {
        const batch = await Promise.all(fights.slice(i, i + 4).map((x) => piData({ ...x, fightStart: x.startTime, fightEnd: x.endTime, full: true, key: `${x.id}:${x.startTime}-${x.endTime}`, rangeLabel: '' }).catch(() => [])));
        for (const l of batch) for (const p of l) if (isPlayer(p.target) && playerInfo(p.target).cls !== 'Priest') pis.set(p.target, (pis.get(p.target) || 0) + 1);
      }
      const all = [...agg.values()];
      const spec = (r) => (r.icon || '').split('-')[1] || '';
      return {
        pulls: fights.length,
        roster: all.map((r) => ({ id: r.id, icon: r.icon })),
        dps: all.filter((r) => r.dmg > 0 && !HEAL_SPECS.has(spec(r)) && !TANK_SPECS.has(spec(r))).map((r) => ({ id: r.id, icon: r.icon, v: r.dmg / r.durD })).sort((a, b) => b.v - a.v).slice(0, 5),
        heal: all.filter((r) => HEAL_SPECS.has(spec(r)) && r.heal > 0).map((r) => ({ id: r.id, icon: r.icon, v: r.heal / r.durH })).sort((a, b) => b.v - a.v).slice(0, 3),
        ints: [...ints.entries()].map(([id, n]) => ({ id, icon: agg.get(id)?.icon || playerInfo(id).icon, v: n })).sort((a, b) => b.v - a.v).slice(0, 5),
        disp: [...disp.entries()].map(([id, n]) => ({ id, icon: agg.get(id)?.icon || playerInfo(id).icon, v: n })).sort((a, b) => b.v - a.v).slice(0, 5),
        pi: [...pis.entries()].map(([id, n]) => ({ id, icon: agg.get(id)?.icon || playerInfo(id).icon, v: n })).sort((a, b) => b.v - a.v).slice(0, 5),
        died: [...deaths.entries()].map(([id, n]) => ({ id, icon: agg.get(id)?.icon || playerInfo(id).icon, v: n })).sort((a, b) => b.v - a.v).slice(0, 5),
      };
    });
  }


  // ---- Chivato: pociones de salud y piedras de salud que ha usado cada jugador en todos los intentos de boss de la noche
  const HEALTH_POT_RE = /(health|healing)\s+potion|potion\s+of\s+(health|healing)|poci[oó]n\s+de\s+(salud|sanaci[oó]n|curaci[oó]n)|poci[oó]n\s+(curativa|sanadora)/i;
  const STONE_RE = /health\s*stone|piedra\s+de\s+salud/i;
  const STONE_IDS = [6262, 5512, 452930];

  function chivatoData() {
    return cached(`chivato:v1:${S.code}`, async () => {
      const fights = S.fights.filter((x) => x.encounterID && !x.keystoneLevel);
      const pots = new Set();
      const stones = new Set(STONE_IDS);
      for (const [id, a] of S.abilities) {
        if (!a || !a.name) continue;
        if (STONE_RE.test(a.name)) stones.add(id);
        else if (HEALTH_POT_RE.test(a.name)) pots.add(id);
      }
      const per = new Map(); // id jugador -> { pot, stone }
      if (!fights.length) return { per, pulls: 0 };
      const ids = [...pots, ...stones];
      const fightIDs = fights.map((x) => x.id);
      const end = Math.max(...fights.map((x) => x.endTime));
      let start = Math.min(...fights.map((x) => x.startTime));
      for (let page = 0; page < 40; page++) {
        const d = await gql(`query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){
          events(fightIDs:$f,startTime:$s,endTime:$e,dataType:Casts,limit:10000,filterExpression:"ability.id in (${ids.join(',')})"){data nextPageTimestamp}}}}`,
        { code: S.code, f: fightIDs, s: start, e: end });
        const ev = d.reportData.report.events;
        for (const e of ev?.data || []) {
          if (e.type !== 'cast' || e.fake || !isPlayer(e.sourceID)) continue;
          if (!per.has(e.sourceID)) per.set(e.sourceID, { pot: 0, stone: 0 });
          const u = per.get(e.sourceID);
          if (stones.has(e.abilityGameID)) u.stone++; else u.pot++;
        }
        if (!ev?.nextPageTimestamp || ev.nextPageTimestamp <= start) break;
        start = ev.nextPageTimestamp;
      }
      return { per, pulls: fights.length };
    });
  }

  async function fillChivato(seq) {
    const box = document.getElementById('nightChivato');
    if (!box) return;
    try {
      const [tops, c] = await Promise.all([nightTopsData(), chivatoData()]);
      if (seq !== S.seq || !document.getElementById('nightChivato')) return;
      const icons = new Map(tops.roster.map((r) => [r.id, r.icon]));
      const ids = new Set([...icons.keys(), ...c.per.keys()]);
      const rows = [...ids].map((id) => {
        const u = c.per.get(id) || { pot: 0, stone: 0 };
        const p = playerInfo(id);
        return { id, name: p.name, cls: p.cls, icon: icons.get(id) || p.icon, pot: u.pot, stone: u.stone };
      }).sort((a, b) => (b.pot + b.stone) - (a.pot + a.stone) || a.name.localeCompare(b.name));
      const totPot = rows.reduce((s, r) => s + r.pot, 0);
      const totStone = rows.reduce((s, r) => s + r.stone, 0);
      const cell = (n) => (n ? '<b>' + n + '</b>' : '<span class="muted">0</span>');
      const body = rows.map((r) => {
        const color = classColor(r.cls);
        const ic = r.icon && r.icon.includes('-') ? specIconUrl(esc(r.icon)) : classIconUrl(r.cls);
        return '<div class="chv-row ' + (isMe(r.name) ? 'me' : '') + '"><span class="who"><img class="spec-ic-sm" src="' + ic + '" width="22" height="22" alt="" style="--cc:' + color + '"><b style="color:' + color + '">' + esc(r.name) + '</b></span><span class="r">' + cell(r.pot) + '</span><span class="r">' + cell(r.stone) + '</span></div>';
      }).join('');
      const sub = LL('Pociones de salud y piedras de salud que ha usado cada jugador en ' + c.pulls + ' intentos', 'Health potions and healthstones each player used over ' + c.pulls + ' pulls');
      box.innerHTML = '<div class="chv">'
        + '<div class="chv-h"><h3>' + LL('Chivato', 'Snitch') + '</h3><small class="muted">' + sub + '</small></div>'
        + '<div class="chv-row th"><span>' + LL('Jugador', 'Player') + '</span><span class="r">' + LL('Pociones de salud', 'Health potions') + '</span><span class="r">' + LL('Piedras de salud', 'Healthstones') + '</span></div>'
        + body
        + '<div class="chv-row tot"><span>' + LL('Total', 'Total') + '</span><span class="r"><b>' + totPot + '</b></span><span class="r"><b>' + totStone + '</b></span></div>'
        + '</div>';
    } catch (e) {
      console.warn('chivato', e);
      if (seq === S.seq && document.getElementById('nightChivato')) box.innerHTML = errorHTML(friendlyError(e));
    }
  }

  function topCard(title, sub, rows, fmt) {
    if (!rows.length) return `<div class="tp-card"><h4>${title}</h4><small class="muted">${sub}</small><div class="empty sm">${t('noData')}</div></div>`;
    return `<div class="tp-card"><h4>${title}</h4><small class="muted">${sub}</small>${rows.map((r, i) => {
      const p = playerInfo(r.id);
      const color = classColor(p.cls);
      return `<div class="tp-row"><span class="tp-rank">${i < 3 ? crownSvg(i + 1) : `<b>${i + 1}</b>`}</span>
        <img class="spec-ic-sm" src="${r.icon && r.icon.includes('-') ? specIconUrl(esc(r.icon)) : classIconUrl(p.cls)}" width="26" height="26" alt="" style="--cc:${color}">
        <span class="tp-name" style="color:${color}">${esc(p.name)}</span><span class="grow"></span><b class="tp-val">${fmt(r.v)}</b></div>`;
    }).join('')}</div>`;
  }

  async function fillNightTops(seq) {
    const box = document.getElementById('nightTops');
    if (!box) return;
    try {
      const d = await nightTopsData();
      if (seq !== S.seq || !document.getElementById('nightTops')) return;
      box.innerHTML = topCard(LL('Top 5 muertes de la noche', 'Top 5 deaths of the night'), LL('Solo las 2 primeras muertes de cada intento', 'Only the first 2 deaths of each pull'), d.died, (v) => `${v} ${v === 1 ? LL('muerte', 'death') : LL('muertes', 'deaths')}`)
        + topCard(LL('Top 5 DPS de la noche', 'Top 5 DPS of the night'), LL(`Daño medio por segundo en ${d.pulls} intentos`, `Average damage per second over ${d.pulls} pulls`), d.dps, (v) => plain(v))
        + topCard(LL('Top 3 sanadores de la noche', 'Top 3 healers of the night'), LL('Sanación media por segundo', 'Average healing per second'), d.heal, (v) => plain(v))
        + topCard(LL('Top 5 cortes de la noche', 'Top 5 interrupts of the night'), LL('Hechizos enemigos interrumpidos en todos los intentos', 'Enemy spells interrupted across every pull'), d.ints, (v) => `${v} ${v === 1 ? LL('corte', 'interrupt') : LL('cortes', 'interrupts')}`)
        + topCard(LL('Top 5 disfrutones de la noche', 'Top 5 PI enjoyers of the night'), LL('PIs recibidos (sin contar sacerdotes)', 'PIs received (priests excluded)'), d.pi, (v) => `${v} PI`)
        + topCard(LL('Top 5 dispels de la noche', 'Top 5 dispels of the night'), LL('Efectos disipados en todos los intentos', 'Effects dispelled across every pull'), d.disp, (v) => `${v} dispel${v === 1 ? '' : 's'}`);
    } catch (e) {
      console.warn('nightTops', e);
      if (seq === S.seq && document.getElementById('nightTops')) box.innerHTML = errorHTML(friendlyError(e));
    }
  }

  // Quién se come más daño evitable: se mira el mejor intento de cada jefe (la kill, o el wipe más avanzado) y se suma por jugador
  async function fillNightAvoid(seq) {
    const box = document.getElementById('nightAvoid');
    if (!box) return;
    try {
      const rows = nightData();
      const per = new Map();
      for (const g of rows) {
        const raw = g.list.find((x) => x.kill) || g.best;
        if (!raw) continue;
        const fwin = { ...raw, fightStart: raw.startTime, fightEnd: raw.endTime, full: true, key: `${raw.id}:${raw.startTime}-${raw.endTime}`, rangeLabel: '' };
        const list = await Extras.mechData(fwin);
        const marks = Extras.avoidMarks(raw);
        for (const a of list) {
          if (!(marks[a.guid] != null ? !!marks[a.guid] : a.guess)) continue;
          for (const tg of a.targets) {
            let p = per.get(tg.id);
            if (!p) per.set(tg.id, p = { id: tg.id, icon: tg.icon, v: 0, by: new Map() });
            p.v += tg.total;
            p.by.set(a.guid, (p.by.get(a.guid) || 0) + tg.total);
          }
        }
        if (seq !== S.seq || !document.getElementById('nightAvoid')) return;
      }
      const top = [...per.values()].sort((a, b) => b.v - a.v).slice(0, 8);
      if (seq !== S.seq || !document.getElementById('nightAvoid')) return;
      box.innerHTML = topCard(LL('Daño evitable de la noche', 'Avoidable damage of the night'), LL('Quién se comió más mecánicas evitables (mejor intento de cada jefe)', 'Who took the most avoidable mechanics (best attempt of each boss)'), top, (v) => plain(v));
    } catch (e) {
      console.warn('nightAvoid', e);
      if (seq === S.seq && document.getElementById('nightAvoid')) box.innerHTML = '';
    }
  }

  async function viewNight(f) {
    const r = S.report;
    const rows = nightData();
    if (!rows.length) return headerHTML(f, t('tabs.night')) + `<div class="empty">${LL('Este reporte no tiene intentos de boss de banda.', 'This report has no raid boss attempts.')}</div>`;
    const total = r.endTime - r.startTime;
    const active = rows.reduce((s, g) => s + g.time, 0);
    const kills = rows.filter((g) => g.kills).length;
    const pulls = rows.reduce((s, g) => s + g.list.length, 0);
    const tiles = [
      [LL('Duración del reporte', 'Report length'), clock(total)],
      [LL('Tiempo en combate', 'Time in combat'), clock(active)],
      [LL('Jefes con kill', 'Bosses killed'), `${kills} / ${rows.length}`],
      [LL('Intentos totales', 'Total pulls'), pulls],
    ].map(([k, v]) => `<div class="ov-tile"><small>${k}</small><div>${v}</div></div>`).join('');
    const cards = rows.map((g) => {
      const p = g.kills ? 0 : pctOf(g.best.fightPercentage ?? g.best.bossPercentage) ?? 100;
      const wipes = g.list.length - g.kills;
      return `<div class="night-card ${g.kills ? 'kill' : ''}"><div class="nc-h"><b>${esc(g.name)}</b><span class="muted">${esc(diffName(g.diff))}</span><span class="grow"></span>${g.kills ? `<span class="okc">✓ KILL</span>` : `<span class="badc">${num(p, 1)} %</span>`}</div>
        <div class="nc-bar"><i style="width:${g.kills ? 100 : 100 - p}%"></i></div>
        <div class="nc-m"><span>${g.list.length} ${g.list.length === 1 ? LL('intento', 'pull') : LL('intentos', 'pulls')}${wipes ? ` · ${wipes} wipes` : ''}</span><span>${LL('Tiempo', 'Time')}: ${clock(g.time)}</span><button class="mini-btn" data-action="fight" data-id="${g.best.id}">${g.kills ? LL('Ver', 'View') : LL('Ver mejor try', 'View best try')} ${esc(fightLabel(g.best))}</button></div></div>`;
    }).join('');
    S.post = async (seq) => { window._nightText = nightText(rows, r); fillNightTops(seq); fillChivato(seq); fillNightAvoid(seq); };
    return headerHTML(f, t('tabs.night'), `${esc(r.title)} · ${new Date(r.startTime).toLocaleDateString(locale())}`)
      + `<div class="ov-tiles">${tiles}</div>
      <div class="night-tops" id="nightTops"><div class="loading"><span class="spinner"></span>${LL('Calculando los rankings de la noche…', 'Computing the night rankings…')}</div></div>
      <div class="night-tops" id="nightAvoid"><div class="loading"><span class="spinner"></span>${LL('Calculando el daño evitable de la noche…', 'Computing the avoidable damage of the night…')}</div></div>
      <div id="nightChivato"><div class="loading"><span class="spinner"></span>${LL('Contando pociones y piedras de salud…', 'Counting health potions and healthstones…')}</div></div>
      <div class="night-grid">${cards}</div>
      <div class="set-actions"><button class="btn" data-action="night-copy">${LL('Copiar informe para Discord', 'Copy report for Discord')}</button><button class="btn" data-action="night-png">${LL('Guardar como imagen', 'Save as image')}</button></div>`;
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action="night-copy"], [data-action="night-png"]');
    if (!el) return;
    if (el.dataset.action === 'night-copy') {
      navigator.clipboard?.writeText(window._nightText || '').then(() => toast(LL('Informe copiado', 'Report copied')));
    } else Extras.exportPng();
  });

  // ============================================================ MANÁ DE SANADORES
  async function viewMana(f) {
    S.post = async (seq) => {
      const w = windowed(S.fight);
      const roles = await Extras.rolesData(w);
      const healers = [...roles.players.values()].filter((p) => p.role === 'healer');
      const lines = [];
      for (const h of healers) {
        const ev = await allEvents(w, 'Casts', `,sourceID:${h.id},includeResources:true`);
        const pts = [];
        for (const e of ev) {
          const r = (e.classResources || []).find((x) => x.type === 0);
          if (r && r.max > 0 && e.resourceActor === 1) pts.push({ t: e.timestamp - w.startTime, v: (r.amount / r.max) * 100 });
        }
        const pi = playerInfo(h.id);
        if (pts.length > 2) lines.push({ name: h.name, color: classColor(pi.cls), pts });
      }
      if (seq !== S.seq) return;
      const box = document.getElementById('manaBox');
      if (!box) return;
      if (!lines.length) { box.innerHTML = `<div class="empty">${LL('No hay datos de maná de los sanadores en este intento.', 'No healer mana data for this pull.')}</div>`; return; }
      box.innerHTML = `<div class="chart"><div class="chart-h"><b>${LL('Maná de los sanadores (%)', 'Healer mana (%)')}</b><span class="chart-v" id="mana-v"></span></div><canvas id="manaCv" height="220"></canvas></div>
        <div class="chips">${lines.map((l) => `<span class="chip on" style="--cc:${l.color}"><span class="sq"></span>${esc(l.name)} <span class="muted">${LL('final', 'end')} ${num(l.pts[l.pts.length - 1].v, 0)}%</span></span>`).join('')}</div>`;
      drawMulti(document.getElementById('manaCv'), lines, fightDur(w));
    };
    return headerHTML(f, t('tabs.mana'), LL('Maná de cada sanador a lo largo del pull, a partir de sus lanzamientos.', 'Each healer\'s mana over the pull, from their casts.'))
      + `<div id="manaBox"><div class="loading"><span class="spinner"></span>${t('loading')}</div></div>
      <p class="foot">${LL('Se muestra el maná justo en cada hechizo que lanza el sanador; entre hechizos se une con líneas rectas.', 'Mana is sampled at each spell the healer casts; straight lines join the samples.')}</p>`;
  }

  function drawMulti(cv, lines, total) {
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth; const H = 220;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue('--muted').trim() || '#8896b8';
    const grid = css.getPropertyValue('--line').trim() || '#2a3b60';
    const padL = 40; const padB = 20; const padT = 8;
    const iw = W - padL - 8; const ih = H - padB - padT;
    const X = (ms) => padL + (ms / total) * iw;
    const Y = (v) => padT + ih - (v / 100) * ih;
    ctx.font = `11px ${UI_FONT}`; ctx.fillStyle = muted; ctx.strokeStyle = grid; ctx.lineWidth = 1;
    for (let v = 0; v <= 100; v += 25) {
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(W - 8, Y(v)); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.textAlign = 'right'; ctx.fillText(`${v}%`, padL - 6, Y(v) + 4);
    }
    ctx.textAlign = 'center';
    const tick = total > 600000 ? 120000 : total > 240000 ? 60000 : 30000;
    for (let ms = 0; ms <= total; ms += tick) ctx.fillText(clock(ms), X(ms), H - 5);
    for (const l of lines) {
      ctx.beginPath();
      l.pts.forEach((p, i) => { const x = X(p.t); const y = Y(p.v); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.strokeStyle = l.color; ctx.lineWidth = 2; ctx.stroke();
    }
    cv.onmousemove = (ev) => {
      const r = cv.getBoundingClientRect();
      const ms = ((ev.clientX - r.left - padL) / iw) * total;
      const out = document.getElementById('mana-v');
      if (!out) return;
      out.textContent = ms < 0 || ms > total ? '' : `${clock(ms)} · ` + lines.map((l) => {
        let best = l.pts[0];
        for (const p of l.pts) if (Math.abs(p.t - ms) < Math.abs(best.t - ms)) best = p;
        return `${l.name} ${num(best.v, 0)}%`;
      }).join(' · ');
    };
  }

  // ============================================================ registro
  // ============================================================ PERJUICIOS (debuffs de la pelea, como la pestaña Debuffs de Warcraft Logs)
  function debuffQuery(f, body) {
    return gql(`query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){${body}}}}`,
      { code: S.code, f: fightIds(f), s: f.startTime, e: f.endTime }).then((d) => d.reportData.report);
  }
  const hostOf = (mode) => (mode === 'enemies' ? 'Enemies' : 'Friendlies');

  function debuffList(f, mode) {
    return cached(`debuffs:${mode}:${f.key}`, async () => {
      const r = await debuffQuery(f, `t:table(fightIDs:$f,dataType:Debuffs,hostilityType:${hostOf(mode)},startTime:$s,endTime:$e)`);
      return (r.t?.data?.auras || []).filter((a) => a.name && a.totalUses > 0).sort((x, y) => y.totalUptime - x.totalUptime);
    });
  }

  function debuffDetail(f, mode, id) {
    return cached(`debuffd:${mode}:${id}:${f.key}`, async () => {
      const dmgType = mode === 'enemies' ? 'DamageDone' : 'DamageTaken';
      const r = await debuffQuery(f, `aur:table(fightIDs:$f,dataType:Debuffs,hostilityType:${hostOf(mode)},abilityID:${id},viewBy:Target,startTime:$s,endTime:$e)
        dmg:table(fightIDs:$f,dataType:${dmgType},abilityID:${id},startTime:$s,endTime:$e)`);
      return { aur: r.aur?.data?.auras || [], dmg: entriesOf(r.dmg) };
    });
  }

  async function viewDebuffs(f) {
    const mode = S.debuffMode === 'enemies' ? 'enemies' : 'players';
    const chip = (k, label) => `<button class="chip ${mode === k ? 'on' : ''}" data-action="debuff-mode" data-m="${k}">${label}</button>`;
    const bar = `<div class="metricbar"><span class="muted">${LL('Ver perjuicios', 'Show debuffs')}</span>${chip('players', LL('En jugadores', 'On players'))}${chip('enemies', LL('En enemigos', 'On enemies'))}</div>`;
    const list = await debuffList(f, mode);
    const title = t('tabs.debuffs');
    if (!list.length) return headerHTML(f, title) + bar + `<div class="empty">${LL('No hay perjuicios de este tipo en la pelea.', 'There are no debuffs of this kind in the fight.')}</div>`;
    const sel = list.find((a) => a.guid === S.debuffId) || list[0];
    const rowsHtml = list.slice(0, 150).map((a) => `<button class="dbf-row ${a.guid === sel.guid ? 'on' : ''}" data-action="debuff-pick" data-id="${a.guid}">
      <span class="dbf-n"><span data-spell="${a.guid}">${iconImg(a.abilityIcon, 22)}</span>${esc(a.name)}</span>
      <span class="dbf-u">${a.totalUses} ${LL('aplic.', 'applic.')}</span><span class="dbf-t">${num(a.totalUptime / 1000, 1)} s</span></button>`).join('');
    const listHtml = `<div class="dbf-list"><div class="dbf-row dbf-head"><span>${LL('Perjuicio', 'Debuff')} <small class="muted">(${list.length})</small></span><span class="dbf-u">${LL('Aplicaciones', 'Applications')}</span><span class="dbf-t">${LL('Tiempo activo', 'Uptime')}</span></div>${rowsHtml}</div>`;

    const det = await debuffDetail(f, mode, sel.guid);
    const per = new Map();
    const get = (e) => {
      if (!per.has(e.id)) per.set(e.id, { ...playerInfo(e.id, e), dmg: 0, uptime: 0, uses: 0, abil: [] });
      return per.get(e.id);
    };
    for (const e of det.dmg) {
      const isP = isPlayer(e.id, e);
      if (mode === 'players' ? !isP : !isP) continue;
      const r = get(e);
      r.dmg += e.total || 0;
      r.abil = abilList(e.abilities);
    }
    for (const a of det.aur) {
      if (mode === 'players' && !isPlayer(a.id, a)) continue;
      const r = get({ id: a.id, name: a.name, type: a.type, icon: a.icon });
      r.uptime += a.totalUptime || 0;
      r.uses += a.totalUses || 0;
    }
    const all = [...per.values()];
    const hasDmg = all.some((r) => r.dmg > 0);
    const rows = all.map((r) => ({
      ...r, total: hasDmg ? r.dmg : r.uptime / 1000,
      note: `${r.uses ? `${r.uses} ${LL('aplic.', 'applic.')} · ` : ''}${num(r.uptime / 1000, 1)} s`,
    })).filter((r) => r.total > 0).sort((x, y) => y.total - x.total);
    const dmgTotal = all.reduce((s, r) => s + r.dmg, 0);
    const who = mode === 'players' ? LL('jugadores afectados', 'players affected') : LL('jugadores que lo aplican', 'players applying it');
    const sub = hasDmg
      ? `<b>${esc(sel.name)}</b> · <b>${plain(dmgTotal)}</b> ${LL(mode === 'players' ? 'de daño recibido' : 'de daño', mode === 'players' ? 'damage taken' : 'damage')} · ${rows.length} ${who}`
      : `<b>${esc(sel.name)}</b> · ${LL('sin daño directo: se ordena por tiempo activo', 'no direct damage: sorted by uptime')} · ${rows.length} ${who}`;
    const detail = rows.length ? rankedList(rows, { clickable: false }) : `<div class="empty">${t('noData')}</div>`;
    return headerHTML(f, title, sub) + bar + listHtml + detail;
  }

  VIEWS.debuffs = viewDebuffs;
  VIEWS.bestcmp = viewBestCmp;
  VIEWS.night = viewNight;
  VIEWS.mana = viewMana;
  TABS.length = 0;
  TABS.push('night', 'summary', 'damage', 'healing', 'taken', 'deaths', 'avoidable', 'mechanics', 'cooldowns', 'utility', 'buffs', 'debuffs', 'mana', 'rotation', 'detail', 'enemies', 'shields', 'graphs', 'mplus', 'replay');
  const prevHidden = window.tabHidden;
  window.tabHidden = (k) => {
    if (prevHidden?.(k)) return true;
    if (k === 'bestcmp') return !S.fight || !S.fight.encounterID || !!S.fight.keystoneLevel || groupOf(S.fight).length < 2;
    return false;
  };

  return { sidePulls, afterSidebar, bestOther };
})();
