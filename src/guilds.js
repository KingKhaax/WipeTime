'use strict';

// Guilds: inicio de sesión con Blizzard (o búsqueda manual), logs recientes de la guild y ranking de parses de sus miembros.
const Guilds = (() => {
  const CLASS_BY_ID = { 1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'DeathKnight', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 10: 'Monk', 11: 'Druid', 12: 'DemonHunter', 13: 'Evoker' };
  const RANK_TTL = 24 * 3600 * 1000;
  const MAX_MEMBERS = 80;
  const st = { status: null, mine: null, chars: null, results: null, mineErr: '', sel: null, armory: null, loginMine: null, loginChars: null, manualChars: [], charMsg: '', tab: 'logs', diff: 5, metric: 'dps', bracket: false, sort: 'desc', zones: null, zone: null, logs: null, rank: null, busy: '' };

  const region = () => (st.sel?.region || st.status?.region || 'eu').toUpperCase();
  const guildKey = (g) => `${g.realmSlug}/${g.name}`;
  const friendly = (code) => {
    const c = String(code || '');
    if (c === 'NO_BNET_CLIENT') return LL('La conexión con Blizzard no está disponible ahora mismo.', 'The Blizzard connection is not available right now.', 'Die Verbindung zu Blizzard ist gerade nicht verfügbar.', 'La connexion à Blizzard n’est pas disponible pour le moment.');
    if (c === 'CLOSED') return LL('Cerraste la ventana de inicio de sesión.', 'You closed the sign-in window.');
    if (/TOKEN_|BAD_STATE|access_denied|invalid_request|redirect/i.test(c)) return LL(`Blizzard rechazó el inicio de sesión (${c}). Inténtalo de nuevo más tarde.`, `Blizzard rejected the sign-in (${c}). Try again later.`, `Blizzard hat die Anmeldung abgelehnt (${c}). Versuche es später erneut.`, `Blizzard a refusé la connexion (${c}). Réessaie plus tard.`);
    if (/HTTP_404/.test(c)) return LL('No encontrado: revisa el nombre, el reino y la región.', 'Not found: check the name, realm and region.', 'Nicht gefunden: Prüfe Name, Realm und Region.', 'Introuvable : vérifie le nom, le royaume et la région.');
    if (c === 'NOT_LOGGED') return LL('La sesión de Blizzard ha caducado: vuelve a iniciar sesión.', 'The Blizzard session expired: sign in again.');
    return c;
  };

  async function open() {
    if (typeof Replay !== 'undefined') Replay.stop();
    S.seq++;
    S.home = true;
    S.cmpOpen = true; // la portada no debe repintarse encima
    S.guildOpen = true;
    S.profileOpen = false;
    sidebar.hidden = true;
    st.status = await window.api.bnetStatus();
    if (!st.loginMine && st.status.cachedGuilds?.list && st.status.cachedGuilds.region === st.status.region) { st.loginMine = st.status.cachedGuilds.list; st.loginChars = st.status.cachedGuilds.chars || null; }
    rebuild();
    render();
    loadSaved().then(() => { if (S.guildOpen) render(); });
    main.scrollTop = 0;
    if (st.status.loggedIn && !st.fresh) { st.fresh = true; loadMine(); }
  }

  async function loadMine() {
    st.busy = 'mine';
    render();
    const r = await window.api.bnetGuilds(S.lang);
    st.busy = '';
    if (r.error) { st.mineErr = friendly(r.error); st.loginMine = null; rebuild(); if (r.error === 'NOT_LOGGED') st.status = await window.api.bnetStatus(); } else { st.loginMine = r.guilds; st.loginChars = r.chars || null; rebuild(); st.mineErr = ''; (st.mine || []).slice(0, 4).forEach((g, i) => setTimeout(() => rosterOf(g).catch(() => {}), 1500 + i * 1500)); }
    if (S.guildOpen) render();
  }

  // ------------------------------------------------------------ vista
  function render() {
    if (!S.guildOpen) return;
    const s = st.status || {};
    const hasClient = s.canLogin;
    const glyph = '<img class="wi" src="icons/inv_shirt_guildtabard_01.jpg" width="30" height="30" alt="">';
    const saved = !s.loggedIn && s.cachedGuilds?.list?.length;
    const login = !s.canLogin && !s.loggedIn ? '' : saved
      ? `<div class="bn-card ok"><div class="bn-ic ok">${glyph}</div><div class="bn-txt"><h2>${esc(s.battletag || LL('Cuenta guardada', 'Saved account'))}</h2><p>${LL('Guilds guardadas de tu última sesión. Inicia sesión solo si quieres actualizar la lista.', 'Guilds saved from your last session. Sign in only to refresh the list.')}</p></div><div class="bn-actions"><button class="btn ghost sm" data-gd="login">↻ ${LL('Actualizar guilds', 'Refresh guilds')}</button></div></div>`
      : s.loggedIn
      ? `<div class="bn-card ok"><div class="bn-ic ok">${glyph}</div><div class="bn-txt"><h2>${esc(s.battletag || LL('Cuenta conectada', 'Account connected'))}</h2><p><span class="bn-dot"></span>${LL('Battle.net conectado · región', 'Battle.net connected · region')} ${esc((s.region || 'eu').toUpperCase())}</p></div>
          <div class="bn-actions"><button class="btn ghost sm" data-gd="refresh">↻ ${LL('Actualizar guilds', 'Refresh guilds')}</button><button class="btn ghost sm" data-gd="logout">${LL('Cerrar sesión', 'Sign out')}</button></div></div>`
      : `<div class="bn-card"><div class="bn-glow"></div><div class="bn-ic">${glyph}</div>
          <div class="bn-txt"><h2>${LL('Conecta tu cuenta de Battle.net (opcional)', 'Connect your Battle.net account (optional)', 'Verbinde dein Battle.net-Konto (optional)', 'Connecte ton compte Battle.net (facultatif)')}</h2>
            <p>${LL('Detectamos tus guilds automáticamente y abrimos sus logs y rankings con un clic.', 'We detect your guilds automatically and open their logs and rankings in one click.')}</p>
            <ul class="bn-feats"><li>${LL('Tus guilds al instante', 'Your guilds instantly')}</li><li>${LL('Logs recientes', 'Recent logs')}</li><li>${LL('Ranking de parses', 'Parse ranking')}</li></ul></div>
          ${hasClient ? `<button class="bn-btn" data-gd="login">${glyph}<span>${LL('Iniciar sesión con Battle.net', 'Sign in with Battle.net')}</span></button>` : ''}
          <small class="bn-note">${LL('Solo leemos los nombres de tus personajes y guilds. Tu contraseña nunca pasa por WipeTime.', 'We only read your character and guild names. Your password never goes through WipeTime.')}</small></div>`;
    let mine = '';
    if (st.busy === 'mine') mine = `<div class="loading"><span class="spinner"></span>${LL('Buscando tus guilds…', 'Finding your guilds…')}</div>`;
    else if (st.mineErr) mine = `<div class="error"><p>${esc(st.mineErr)}</p></div>`;
    else if (st.mine) mine = st.mine.length
      ? `<div class="chips">${st.mine.map((g) => `<button class="chip ${st.sel && guildKey(st.sel) === guildKey(g) ? 'on' : ''}" data-gd="pick" data-key="${esc(guildKey(g))}"><span class="crest-slot" data-crest data-realm="${esc(g.realmSlug)}" data-guild="${esc(g.name)}" data-size="26"></span>${esc(g.name)} <span class="muted">${esc(g.realmName)}</span></button>`).join('')}</div>`
      : `<div class="empty sm">${LL('Ninguno de tus personajes está en una guild.', 'None of your characters are in a guild.')}</div>`;
    const last = (() => { try { return JSON.parse(lsGet('guild:last') || 'null') || {}; } catch { return {}; } })();
    const manual = `<form id="gdForm" class="gd-form"><input name="guild" placeholder="${esc(LL('Nombre de la guild', 'Guild name'))}" value="${esc(last.name || '')}" spellcheck="false" autocomplete="off">
      <input name="realm" placeholder="${esc(LL('Reino (opcional, ej. twisting-nether)', 'Realm (optional, e.g. twisting-nether)'))}" value="${esc(last.realmSlug || '')}" spellcheck="false" autocomplete="off">
      <select name="region">${['eu', 'us', 'kr', 'tw'].map((r) => `<option value="${r}" ${r === (last.region || s.region) ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('')}</select>
      <button class="btn" type="submit">${LL('Buscar guild', 'Find guild')}</button></form>
      <small class="muted gd-hint">${LL('Si no sabes el reino, déjalo vacío y te mostraremos las guilds con ese nombre.', 'If you do not know the realm, leave it empty and we will list the guilds with that name.')}</small>${resultsHTML()}`;
    // el desplegable de una de tus guilds aparece justo debajo de ellas; el de una búsqueda a mano, al final
    const bodyUnderMine = !!(st.sel && Array.isArray(st.mine) && st.mine.some((g) => guildKey(g) === guildKey(st.sel)));
    const bodyDiv = `<div id="gdBody">${st.sel ? bodyHTML() : ''}</div>`;
    main.innerHTML = `<div class="hdr"><div class="eyebrow">${LL('Comunidad', 'Community')}</div><h1>Guilds</h1><div class="sub">${LL('Mira los logs de tu guild y quién tiene mejores parses.', 'See your guild\'s logs and who has the best parses.')}</div></div>
      ${login}${mine ? `<h3 class="sec">${LL('Tus guilds', 'Your guilds')}</h3>${mine}` : `<div class="empty sm">${LL('No hace falta iniciar sesión: añade tus personajes abajo o busca tu guild y guárdala.', 'No sign-in needed: add your characters below or find your guild and save it.', 'Keine Anmeldung nötig: Füge unten deine Charaktere hinzu oder suche deine Gilde und speichere sie.', 'Aucune connexion nécessaire : ajoute tes personnages ci-dessous ou cherche ta guilde et enregistre-la.')}</div>`}
      ${bodyUnderMine ? bodyDiv : ''}
      ${charsHTML()}
      <h4 class="subh">${LL('Añadir un personaje', 'Add a character', 'Charakter hinzufügen', 'Ajouter un personnage')}</h4>${charFormHTML()}
      <div class="bn-or"><span>${LL('o busca una guild a mano', 'or find a guild by hand')}</span></div>${manual}
      ${bodyUnderMine ? '' : bodyDiv}`;
    if (st.sel) afterBody();
    Cards.fillCrests(main);
  }

  // ---- Personajes: quitar de la lista y marcar como favoritos (se recuerda en este equipo)
  const lsList = (k) => { try { return JSON.parse(lsGet(k) || '[]'); } catch { return []; } };
  const charKey = (c) => `${c.realmSlug}/${String(c.name).toLowerCase()}`;
  const ICON_STAR = (on) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3.200 2.600 5.500 6 .8-4.400 4.200 1.100 6-5.300-2.900-5.300 2.900 1.100-6L3.400 9.500l6-.8z"/></svg>`;
  const ICON_X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  // ---- Armería: al pulsar un personaje se despliega su equipo y sus estadísticas (valor y %)
  const QCOLOR = { POOR: '#9d9d9d', COMMON: '#ffffff', UNCOMMON: '#1eff00', RARE: '#0070dd', EPIC: '#a335ee', LEGENDARY: '#ff8000', ARTIFACT: '#e6cc80', HEIRLOOM: '#00ccff' };
  const SLOTS_L = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'WRIST'];
  const SLOTS_R = ['HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2'];
  const SLOTS_B = ['TRINKET_1', 'TRINKET_2', 'MAIN_HAND', 'OFF_HAND'];
  // La mano izquierda solo sale si el personaje lleva algo (con un arma a dos manos no hay hueco)
  const slotHTML = (bySlot, sl) => { const it = bySlot.get(sl); return !it && sl === 'OFF_HAND' ? '' : itemHTML(it, it?.slotName || sl); };
  const modelHTML = (d) => `<div class="arm-model" data-tilt>${d.render ? `<img src="${Cards.media(d.render)}" alt="${esc(d.name)}" draggable="false">` : `<span class="arm-nomodel">${LL('Sin modelo disponible', 'No model available', 'Kein Modell verfügbar', 'Aucun modèle disponible')}</span>`}</div>`;

  const cleanLine = (x) => String(x ?? '').replace(/\|A:[^|]*\|a/g, '').replace(/\|c[0-9a-fA-F]{8}|\|cn[^:]*:|\|r/g, '').replace(/^Enchanted: /i, '').replace(/\s+/g, ' ').trim();
  function itemHTML(it, slotLabel) {
    if (!it) return `<div class="arm-it empty"><span class="arm-ic"></span><span class="arm-tx"><small>${esc(slotLabel)}</small></span></div>`;
    const col = QCOLOR[it.quality] || '#fff';
    const sub = [
      ...it.enchant.map((e) => `<i class="ench">${esc(cleanLine(e))}</i>`),
      ...it.gems.map((g) => `<i class="gem">${esc(cleanLine(g.name || g.stat || ''))}</i>`),
    ].join('');
    return `<div class="arm-it" style="--q:${col}"><span class="arm-ic">${it.icon ? `<img src="${Cards.media(it.icon)}" alt="" loading="lazy">` : ''}</span>
      <span class="arm-tx"><b title="${esc(it.name)}">${esc(it.name)}</b><small><em>${esc(it.ilvl || '')}</em> ${esc(slotLabel)}${it.set ? ` · ${esc(it.set)}` : ''}</small>${sub}</span></div>`;
  }

  function statsHTML(s) {
    if (!s) return `<div class="muted">${LL('Sin estadísticas disponibles.', 'No stats available.', 'Keine Werte verfügbar.', 'Aucune statistique disponible.')}</div>`;
    const n0 = (v) => num(v || 0, 0);
    const p2 = (v) => `${num(v || 0, 2)} %`;
    const row = (label, value, pct) => `<div class="arm-st"><span>${label}</span><b>${value}</b>${pct != null ? `<em>${pct}</em>` : '<em></em>'}</div>`;
    const sec = (title, rows) => (rows.filter(Boolean).length ? `<h5>${title}</h5>${rows.join('')}` : '');
    const rated = (label, o) => (o ? row(label, n0(o.rating), p2(o.value)) : '');
    const main = Math.max(s.strength, s.agility, s.intellect);
    const prim = [['strength', LL('Fuerza', 'Strength', 'Stärke', 'Force')], ['agility', LL('Agilidad', 'Agility', 'Beweglichkeit', 'Agilité')], ['intellect', LL('Intelecto', 'Intellect', 'Intelligenz', 'Intelligence')]]
      .map(([k, l]) => row(`${l}${s[k] === main && main ? ' ★' : ''}`, n0(s[k])));
    return [
      sec(LL('Principales', 'Primary', 'Primärwerte', 'Principales'), [...prim, row(LL('Aguante', 'Stamina', 'Ausdauer', 'Endurance'), n0(s.stamina)), row(LL('Salud', 'Health', 'Gesundheit', 'Santé'), n0(s.health))]),
      sec(LL('Secundarias', 'Secondary', 'Sekundärwerte', 'Secondaires'), [
        rated(LL('Golpe crítico', 'Critical strike', 'Kritischer Treffer', 'Coup critique'), s.crit), rated(LL('Celeridad', 'Haste', 'Tempo', 'Hâte'), s.haste), rated(LL('Maestría', 'Mastery', 'Meisterschaft', 'Maîtrise'), s.mastery),
        row(LL('Versatilidad', 'Versatility', 'Vielseitigkeit', 'Polyvalence'), n0(s.versatility?.rating), `${p2(s.versatility?.value)} / ${p2(s.versatility?.taken)}`)]),
      sec(LL('Terciarias', 'Tertiary', 'Tertiärwerte', 'Tertiaires'), [rated(LL('Parasitismo', 'Leech', 'Aderlass', 'Ponction'), s.leech), rated(LL('Evitación', 'Avoidance', 'Vermeidung', 'Évitement'), s.avoidance), rated(LL('Velocidad', 'Speed', 'Geschwindigkeit', 'Vitesse'), s.speed)]),
      sec(LL('Defensivas', 'Defensive', 'Defensivwerte', 'Défensives'), [row(LL('Armadura', 'Armor', 'Rüstung', 'Armure'), n0(s.armor)),
        s.dodge ? row(LL('Esquivar', 'Dodge', 'Ausweichen', 'Esquive'), n0(s.dodge.rating), p2(s.dodge.value)) : '',
        s.parry ? row(LL('Parar', 'Parry', 'Parieren', 'Parade'), n0(s.parry.rating), p2(s.parry.value)) : '',
        s.block ? row(LL('Bloqueo', 'Block', 'Blocken', 'Blocage'), n0(s.block.rating), p2(s.block.value)) : '']),
    ].join('');
  }

  function armoryHTML(c) {
    const a = st.armory;
    if (!a || a.key !== charKey(c)) return '';
    const head = `<div class="arm-top"><b>${esc(c.name)}</b><span class="arm-sp"></span>
      <button type="button" class="btn ghost sm" data-gd="armory-refresh" data-key="${esc(a.key)}">↻ ${LL('Actualizar', 'Refresh', 'Aktualisieren', 'Actualiser')}</button>
      ${c.guild ? `<button type="button" class="btn ghost sm" data-gd="pick-char" data-guild="${esc(c.guild.name)}" data-realm="${esc(c.guild.realmSlug)}" data-realmname="${esc(c.guild.realmName)}" data-region="${esc(c.region || '')}">${LL('Abrir guild', 'Open guild', 'Gilde öffnen', 'Ouvrir la guilde')}</button>` : ''}
      <button type="button" class="btn ghost sm" data-gd="armory-close">${LL('Cerrar', 'Close', 'Schließen', 'Fermer')}</button></div>`;
    if (a.status === 'loading') return `<div class="arm">${head}<div class="loading"><span class="spinner"></span>${t('loading')}</div></div>`;
    if (a.status === 'err') return `<div class="arm">${head}<div class="error"><p>${esc(friendly(a.err))}</p></div></div>`;
    const d = a.data;
    const bySlot = new Map(d.items.map((i) => [i.slot, i]));
    const col = (slots) => slots.map((sl) => slotHTML(bySlot, sl)).join('');
    const info = [
      `<span><small>${LL('Nivel de objeto', 'Item level', 'Gegenstandsstufe', 'Niveau d’objet')}</small><b>${esc(d.ilvlEquipped || d.ilvlAvg || '—')}</b></span>`,
      d.ilvlAvg && d.ilvlAvg !== d.ilvlEquipped ? `<span><small>${LL('Media (inventario)', 'Average (bags)', 'Durchschnitt (Taschen)', 'Moyenne (sacs)')}</small><b>${esc(d.ilvlAvg)}</b></span>` : '',
      d.spec ? `<span><small>${LL('Especialización', 'Spec', 'Spezialisierung', 'Spécialisation')}</small><b>${esc(d.spec)}</b></span>` : '',
      `<span><small>${LL('Nivel', 'Level', 'Stufe', 'Niveau')}</small><b>${esc(d.level)}</b></span>`,
      d.achievements ? `<span><small>${LL('Logros', 'Achievements', 'Erfolge', 'Hauts faits')}</small><b>${esc(d.achievements)}</b></span>` : '',
    ].join('');
    return `<div class="arm">${head}<div class="arm-info">${info}</div>
      <div class="arm-body"><div class="arm-gear"><div class="arm-col">${col(SLOTS_L)}</div>${modelHTML(d)}<div class="arm-col">${col(SLOTS_R)}</div><div class="arm-weapons">${col(SLOTS_B)}</div></div>
      <div class="arm-stats">${statsHTML(d.stats)}</div></div></div>`;
  }

  // Siempre se pide a Blizzard en el momento (sin caché) y, con la armería abierta, se vuelve a pedir cada minuto
  async function openArmory(key, realmSlug, name, silent = false, region = '') {
    clearInterval(st.armoryTimer);
    if (!silent) { st.armory = { key, status: 'loading' }; render(); }
    const r = await window.api.bnetArmory(realmSlug, name, S.lang, region);
    if (st.armory?.key !== key) return;
    if (r.error && silent && st.armory.data) return; // un fallo puntual no borra lo que ya se veía
    st.armory = r.error ? { key, status: 'err', err: r.error, realmSlug, name, region } : { key, status: 'ok', data: r, realmSlug, name, region };
    if (S.guildOpen) render();
    st.armoryTimer = setInterval(() => {
      if (!S.guildOpen || st.armory?.key !== key) { clearInterval(st.armoryTimer); return; }
      openArmory(key, realmSlug, name, true, region);
    }, 60000);
  }

  // ---- Registro a mano (sin iniciar sesión): personajes y guilds guardados en este equipo
  const savedChars = () => lsList('gd:chars');
  const savedGuilds = () => lsList('gd:guilds');
  const saveList = (k, l) => lsSet(k, JSON.stringify(l));

  // Une lo que viene de la cuenta de Battle.net (si inició sesión) con lo registrado a mano
  function rebuild() {
    const seen = new Set();
    const chars = [];
    for (const c of [...(st.loginChars || []), ...st.manualChars]) { const k = charKey(c); if (!seen.has(k)) { seen.add(k); chars.push(c); } }
    st.chars = chars.length ? chars : null;
    const gseen = new Set();
    const gl = [];
    const add = (g) => { if (!g?.name) return; const k = guildKey(g); if (gseen.has(k)) return; gseen.add(k); gl.push(g); };
    (st.loginMine || []).forEach(add);
    savedGuilds().forEach(add);
    st.manualChars.forEach((c) => c.guild && add({ name: c.guild.name, realmSlug: c.guild.realmSlug, realmName: c.guild.realmName, region: c.region }));
    st.mine = gl.length ? gl : (st.loginMine ? [] : null);
  }

  async function loadSaved() {
    const list = await Promise.all(savedChars().map(async (c) => {
      try { return { ...(await Cards.char(c.name, c.realmSlug, c.region)), manual: true, region: c.region }; } catch { return null; }
    }));
    st.manualChars = list.filter(Boolean);
    rebuild();
  }

  async function addChar(name, realm, region) {
    const slug = Cards.slugOf(realm);
    st.charMsg = '';
    try {
      const info = await Cards.char(name, slug, region);
      const l = savedChars();
      if (!l.some((x) => charKey(x) === charKey({ name: info.name, realmSlug: info.realmSlug }))) { l.push({ name: info.name, realmSlug: info.realmSlug, region }); saveList('gd:chars', l); }
      await loadSaved();
      lsSet('gd:hidden', JSON.stringify(lsList('gd:hidden').filter((k) => k !== charKey(info))));
    } catch (e) { st.charMsg = friendly(String(e.message || e)); }
    render();
  }

  const guildSaved = (g) => savedGuilds().some((x) => guildKey(x) === guildKey(g));
  function charFormHTML() {
    const last = lsGet('gd:charRegion') || st.status?.region || 'eu';
    return `<form id="gdCharForm" class="gd-form"><input name="name" placeholder="${esc(LL('Nombre del personaje', 'Character name', 'Charaktername', 'Nom du personnage'))}" spellcheck="false" autocomplete="off" required>
      <input name="realm" placeholder="${esc(LL('Reino (ej. Zul’jin)', 'Realm (e.g. Zul’jin)', 'Realm (z. B. Zul’jin)', 'Royaume (ex. Zul’jin)'))}" spellcheck="false" autocomplete="off" required>
      <select name="region">${['eu', 'us', 'kr', 'tw'].map((r) => `<option value="${r}" ${r === last ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('')}</select>
      <button class="btn" type="submit">${LL('Añadir personaje', 'Add character', 'Charakter hinzufügen', 'Ajouter le personnage')}</button></form>
      ${st.charMsg ? `<div class="error sm"><p>${esc(st.charMsg)}</p></div>` : ''}`;
  }

  function charsHTML() {
    if (!st.chars?.length) return '';
    const hidden = new Set(lsList('gd:hidden'));
    const favs = new Set(lsList('gd:favs'));
    const wrap = (c, canHide) => {
      const k = charKey(c);
      const pick = `data-gd="armory" data-key="${esc(k)}" data-realm="${esc(c.realmSlug)}" data-name="${esc(c.name)}" data-region="${esc(c.region || '')}"`;
      return `<div class="cc-wrap ${st.armory?.key === k ? 'open' : ''}">${Cards.charCardHTML(c, { onClick: pick })}<div class="cc-act">
        <button type="button" class="${favs.has(k) ? 'on' : ''}" data-gd="fav" data-key="${esc(k)}" title="${esc(favs.has(k) ? LL('Quitar de favoritos', 'Remove from favorites') : LL('Añadir a favoritos', 'Add to favorites'))}" aria-label="${esc(LL('Favorito', 'Favorite'))}">${ICON_STAR(favs.has(k))}</button>
        ${canHide ? `<button type="button" data-gd="${c.manual ? 'delchar' : 'hide'}" data-key="${esc(k)}" title="${esc(LL('Quitar de la lista', 'Remove from the list'))}" aria-label="${esc(LL('Quitar', 'Remove'))}">${ICON_X}</button>` : ''}</div></div>${armoryHTML(c)}`;
    };
    const favList = st.chars.filter((c) => favs.has(charKey(c)));
    const list = st.chars.filter((c) => !hidden.has(charKey(c)));
    const hiddenN = st.chars.length - list.length;
    return `${favList.length ? `<h3 class="sec">${LL('Personajes favoritos', 'Favorite characters')}</h3><div class="cc-grid">${favList.map((c) => wrap(c, false)).join('')}</div>` : ''}
      <h3 class="sec">${LL('Tus personajes', 'Your characters')}${hiddenN ? ` <button type="button" class="mini-btn" data-gd="unhide">${LL(`Restaurar ${hiddenN} quitado${hiddenN === 1 ? '' : 's'}`, `Restore ${hiddenN} removed`, `${hiddenN} entfernte wiederherstellen`, `Restaurer ${hiddenN} retiré${hiddenN === 1 ? '' : 's'}`)}</button>` : ''}</h3>
      ${list.length ? `<div class="cc-grid">${list.map((c) => wrap(c, true)).join('')}</div>` : `<div class="empty sm">${LL('Has quitado todos los personajes de la lista.', 'You removed every character from the list.')}</div>`}`;
  }

  function resultsHTML() {
    const r = st.results;
    if (!r) return '';
    if (r.loading) return `<div class="loading"><span class="spinner"></span>${LL('Buscando guilds…', 'Searching guilds…')}</div>`;
    if (r.error) return `<div class="error"><p>${esc(friendly(r.error))}</p></div>`;
    if (!r.list.length) return `<div class="empty sm">${LL(`No encontré ninguna guild llamada "${esc(r.term)}". Prueba con otro nombre o escribe también el reino.`, `I found no guild called "${esc(r.term)}". Try another name or enter the realm too.`, `Ich habe keine Gilde namens „${esc(r.term)}“ gefunden. Versuche einen anderen Namen oder gib auch den Realm an.`, `Je n’ai trouvé aucune guilde nommée « ${esc(r.term)} ». Essaie un autre nom ou saisis aussi le royaume.`)}</div>`;
    return `<h4 class="subh">${LL(`Guilds que coinciden con "${esc(r.term)}"`, `Guilds matching "${esc(r.term)}"`, `Gilden, die zu „${esc(r.term)}“ passen`, `Guildes correspondant à « ${esc(r.term)} »`)}</h4><div class="gd-results">${r.list.map((x, i) =>
      `<button class="gd-res" data-gd="pick-found" data-i="${i}"><span class="crest-slot" data-crest data-realm="${esc(x.realmSlug)}" data-guild="${esc(x.name)}" data-size="34"></span><span class="gd-res-t"><b>${esc(x.name)}</b><small>${esc(x.realmName)}</small></span><span class="gd-reg">${esc(x.region.toUpperCase())}</span></button>`).join('')}</div>`;
  }

  function bodyHTML() {
    const g = st.sel;
    const tab = (k, l) => `<button class="chip ${st.tab === k ? 'on' : ''}" data-gd="tab" data-tab="${k}">${l}</button>`;
    return `${st.tab === 'rank' ? '' : `<div class="gd-head"><span data-crest data-realm="${esc(g.realmSlug)}" data-guild="${esc(g.name)}" data-size="56"></span><h2>${esc(g.name)}</h2><span class="muted">${esc(g.realmName || g.realmSlug)} · ${region()}</span>${guildSaved(g) ? `<button type="button" class="btn ghost sm" data-gd="unsaveguild">${LL('Quitar de mis guilds', 'Remove from my guilds', 'Aus meinen Gilden entfernen', 'Retirer de mes guildes')}</button>` : `<button type="button" class="btn sm" data-gd="saveguild">★ ${LL('Guardar guild', 'Save guild', 'Gilde speichern', 'Enregistrer la guilde')}</button>`}</div>`}
      <div class="metricbar">${tab('logs', LL('Logs recientes', 'Recent logs'))}${tab('rank', LL('Ranking de parses', 'Parse ranking'))}</div>
      <div id="gdTab"><div class="loading"><span class="spinner"></span>${t('loading')}</div></div>`;
  }

  async function afterBody() {
    const el = document.getElementById('gdTab');
    if (!el) return;
    try {
      if (st.tab === 'logs') await logsTab(el); else await rankTab(el);
    } catch (e) {
      console.warn('guilds', e);
      const box = document.getElementById('gdTab');
      if (box) box.innerHTML = errorHTML(friendlyError(e) || friendly(e.message));
    }
  }

  async function logsTab(el) {
    const g = st.sel;
    const key = guildKey(g);
    if (!st.logs || st.logs.key !== key) {
      const d = await gql(`query($n:String!,$s:String!,$r:String!){reportData{reports(guildName:$n,guildServerSlug:$s,guildServerRegion:$r,limit:30){data{code title startTime endTime zone{name} owner{name}}}}}`,
        { n: g.name, s: g.realmSlug, r: region() });
      st.logs = { key, list: d.reportData?.reports?.data || [] };
    }
    const box = document.getElementById('gdTab');
    if (!box || st.tab !== 'logs') return;
    const list = st.logs.list;
    box.innerHTML = list.length ? `<div class="recent">${list.map((r) =>
      `<div class="rwrap"><button class="rcard" data-gd="report" data-code="${esc(r.code)}"><b>${esc(r.title)}</b><small>${esc(zoneName(r.zone?.name))}${r.owner?.name ? ' · ' + esc(r.owner.name) : ''} · ${new Date(r.startTime).toLocaleDateString(locale())} · ${clock(r.endTime - r.startTime)}</small></button></div>`).join('')}</div>`
      : `<div class="empty">${LL('Esta guild no tiene logs públicos en Warcraft Logs (o el nombre/reino no coincide con el de Warcraft Logs).', 'This guild has no public logs on Warcraft Logs (or the name/realm does not match the one on Warcraft Logs).')}</div>`;
  }

  // Parches de Midnight que han traído una banda (el 12.0.5 no trajo ninguna): zona de WCL y banda de Raider.io
  const PATCH_OF_ZONE = { 46: '12.0.0', 50: '12.0.7', 53: '12.1' };
  const RIO_RAID = { 46: 'tier-mn-1', 50: 'sporefall', 53: 'the-venomous-abyss' };
  const RIO_DIFF = { 3: 'normal', 4: 'heroic', 5: 'mythic' };
  const TANK = new Set(['Blood', 'Vengeance', 'Guardian', 'Brewmaster', 'Protection']);
  const HEAL = new Set(['Restoration', 'Holy', 'Discipline', 'Mistweaver', 'Preservation']);
  const REGION_NAME = () => ({ EU: LL('Europa', 'Europe'), US: LL('América', 'America'), KR: LL('Corea', 'Korea'), TW: LL('Taiwán', 'Taiwan') });

  async function zonesList() {
    if (st.zones) return st.zones;
    const d = await gql(`{worldData{expansion(id:${S.expansion?.id ?? 7}){zones{id name encounters{id name}}}}}`);
    const bad = /ptr|complete|dummy|mythic\+|beta/i;
    st.zones = (d.worldData?.expansion?.zones || []).filter((z) => z.encounters?.length >= 1 && !bad.test(z.name)).sort((x, y) => x.id - y.id);
    if (!st.zones.some((z) => z.id === st.zone)) st.zone = st.zones[st.zones.length - 1]?.id;
    return st.zones;
  }

  async function rosterOf(g) {
    const key = `gd:roster:${guildKey(g)}:${region()}`;
    try { const c = JSON.parse(lsGet(key) || 'null'); if (c && Date.now() - c.at < RANK_TTL) return c.members; } catch { /* sin caché */ }
    const r = await window.api.bnetRoster(g.realmSlug, g.name);
    if (r.error) throw new Error(friendly(r.error));
    lsSet(key, JSON.stringify({ at: Date.now(), members: r.members }));
    return r.members;
  }

  async function guildStanding(gd, zone, diff) {
    const regionCode = region();
    const rioRegion = regionCode.toLowerCase();
    const key = `gd:stand:v2:${guildKey(gd)}:${regionCode}:${zone}:${diff}`;
    try { const c = JSON.parse(lsGet(key) || 'null'); if (c && Date.now() - c.at < RANK_TTL) return c.v; } catch { /* sin caché */ }
    const out = { world: null, region: null, realm: null, spain: null, source: '' };
    if (diff === 5) { // el ranking de progreso de Warcraft Logs es el del nivel Mítico
      try {
        const r = await gql(`query($n:String!,$s:String!,$r:String!){guildData{guild(name:$n,serverSlug:$s,serverRegion:$r){zoneRanking(zoneId:${Number(zone)}){progress{worldRank{number} regionRank{number} serverRank{number}}}}}}`, { n: gd.name, s: gd.realmSlug, r: regionCode });
        const p = r.guildData?.guild?.zoneRanking?.progress;
        if (p) { out.world = p.worldRank?.number ?? null; out.region = p.regionRank?.number ?? null; out.realm = p.serverRank?.number ?? null; out.source = 'Warcraft Logs'; }
      } catch (e) { console.warn('guild standing', e); }
    }
    const raid = RIO_RAID[zone];
    if (raid) {
      const r = await window.api.rioRank({ raid, difficulty: RIO_DIFF[diff], region: rioRegion, realmSlug: gd.realmSlug, guildName: gd.name, needWorld: out.world == null });
      if (r && r.found) {
        if (out.world == null) { out.world = r.world; out.region = r.region; out.realm = r.realm; out.source = 'Raider.IO'; }
        if (r.spanish) out.spain = r.spain;
        out.spainSource = 'Raider.IO';
      }
    }
    lsSet(key, JSON.stringify({ at: Date.now(), v: out }));
    return out;
  }

  const parseCell = (p) => (p == null ? '<span class="gr-dash">-</span>' : `<b style="color:${parseColor(Math.floor(p))}">${Math.floor(p)}</b>`);

  async function rankTab(el) {
    const gd = st.sel;
    const zones = await zonesList();
    const zone = zones.find((z) => z.id === st.zone) || zones[zones.length - 1];
    const chip = (attr, on, label) => `<button class="chip ${on ? 'on' : ''}" ${attr}>${label}</button>`;
    const controls = `<div class="metricbar"><span class="muted">${LL('Parche', 'Patch')}</span>${zones.map((z) => chip(`data-gd="zone" data-v="${z.id}"`, z.id === zone.id, `${esc(PATCH_OF_ZONE[z.id] || z.name)} <span class="muted">${esc(z.name)}</span>`)).join('')}</div>
      <div class="metricbar"><span class="muted">${LL('Clasificación por', 'Rank by')}</span>${[['dps', LL('Daño', 'Damage')], ['hps', LL('Sanación', 'Healing')], ['bossdps', LL('Daño al jefe', 'Boss damage')]].map(([k, l]) => chip(`data-gd="metric" data-v="${k}"`, st.metric === k, l)).join('')}</div>
      <div class="metricbar"><span class="muted">${LL('Dificultad', 'Difficulty')}</span>${[[5, LL('Mítico', 'Mythic')], [4, LL('Heroico', 'Heroic')], [3, 'Normal']].map(([d, l]) => chip(`data-gd="diff" data-v="${d}"`, st.diff === d, l)).join('')}
        <span class="sep"></span><span class="muted">Parse</span>${chip('data-gd="bracket" data-v="0"', !st.bracket, LL('Global', 'Global'))}${chip('data-gd="bracket" data-v="1"', st.bracket, LL('Por nivel de objeto', 'By item level'))}
        <span class="sep"></span><span class="muted">${LL('Ordenar', 'Sort')}</span>${chip('data-gd="sort" data-v="desc"', st.sort === 'desc', LL('↓ Mayor a menor', '↓ High to low'))}${chip('data-gd="sort" data-v="asc"', st.sort === 'asc', LL('↑ Menor a mayor', '↑ Low to high'))}${chip('data-gd="sort" data-v="name"', st.sort === 'name', 'A–Z')}</div>`;
    const box = document.getElementById('gdTab');
    if (!box) return;
    box.innerHTML = `${controls}<div id="gdRank"><div class="loading"><span class="spinner"></span>${LL('Calculando el ranking de la guild…', 'Computing the guild ranking…')}</div></div>`;

    const standingP = guildStanding(gd, zone.id, st.diff).catch(() => ({}));
    const members = await rosterOf(gd);
    const maxLevel = Math.max(...members.map((m) => m.level), 0);
    const pool = members.filter((m) => m.level === maxLevel).sort((a, b) => a.rank - b.rank).slice(0, MAX_MEMBERS);
    const key = `gd:rank:v4:${guildKey(gd)}:${region()}:${zone.id}:${st.diff}:${st.metric}:${st.bracket ? 'b' : 'g'}`;
    let rows = null;
    try { const c = JSON.parse(lsGet(key) || 'null'); if (c && Date.now() - c.at < RANK_TTL) rows = c.rows; } catch { /* sin caché */ }
    if (!rows) {
      rows = [];
      for (let i = 0; i < pool.length; i += 8) {
        const chunk = pool.slice(i, i + 8);
        const aliases = chunk.map((m, j) => `c${j}:character(name:${JSON.stringify(m.name)},serverSlug:${JSON.stringify(m.realmSlug)},serverRegion:${JSON.stringify(region())}){name zoneRankings(zoneID:${Number(zone.id)},difficulty:${st.diff},metric:${['dps', 'hps', 'bossdps'].includes(st.metric) ? st.metric : 'dps'}${st.bracket ? ',byBracket:true' : ''})}`).join(' ');
        const d = await gql(`{characterData{${aliases}}}`).catch(() => null);
        chunk.forEach((m, j) => {
          const zr = d?.characterData?.[`c${j}`]?.zoneRankings;
          if (!zr || zr.error || zr.bestPerformanceAverage == null) return;
          const spec = zr.allStars?.[0]?.spec || (zr.rankings || []).find((x) => x.spec)?.spec || '';
          const boss = {};
          let kills = 0;
          for (const r of zr.rankings || []) {
            if (r.totalKills > 0) { kills++; boss[r.encounter.id] = { p: r.rankPercent, spec: r.spec || spec }; }
          }
          rows.push({ name: m.name, cls: CLASS_BY_ID[m.classId] || '', spec, role: HEAL.has(spec) ? 'healer' : TANK.has(spec) ? 'tank' : 'dps', avg: zr.bestPerformanceAverage, stars: zr.allStars?.[0]?.points ?? null, boss, kills });
        });
        const live = document.getElementById('gdRank');
        if (live) live.innerHTML = `<div class="loading"><span class="spinner"></span>${LL(`Calculando… ${Math.min(i + 8, pool.length)}/${pool.length} jugadores`, `Computing… ${Math.min(i + 8, pool.length)}/${pool.length} players`, `Berechne… ${Math.min(i + 8, pool.length)}/${pool.length} Spieler`, `Calcul… ${Math.min(i + 8, pool.length)}/${pool.length} joueurs`)}</div>`;
        if (st.tab !== 'rank') return;
      }
      lsSet(key, JSON.stringify({ at: Date.now(), rows }));
    }
    const standing = await standingP;
    const live = document.getElementById('gdRank');
    if (!live || st.tab !== 'rank') return;
    setTimeout(() => Cards.fillCrests(live), 0);

    const encs = zone.encounters;
    const killed = encs.filter((e) => rows.some((r) => r.boss[e.id])).length;
    const diffLabel = { 5: LL('Mítico', 'Mythic'), 4: LL('Heroico', 'Heroic'), 3: 'Normal' }[st.diff];
    const regionLabel = REGION_NAME()[region()] || region();
    const rankBox = (label, v, cls) => `<div class="gr-rk ${cls}"><small>${label}</small><b>${v != null ? v : '—'}</b></div>`;
    const spainBox = standing.spain != null ? rankBox(LL('España', 'Spain'), standing.spain, 'es') : '';
    const head = `<div class="gr-head"><div class="gr-prog"><div class="gr-title"><span data-crest data-realm="${esc(gd.realmSlug)}" data-guild="${esc(gd.name)}" data-size="64"></span><div class="gr-name">${esc(gd.name)}</div></div><small class="muted">${esc(gd.realmName || gd.realmSlug)} · ${regionLabel}</small>
        <div class="gr-bar"><i style="width:${encs.length ? (killed / encs.length) * 100 : 0}%"></i><span>${killed}/${encs.length} ${diffLabel}</span></div></div>
      <div class="gr-ranks">${rankBox(LL('Mundo', 'World'), standing.world, 'w')}${rankBox(regionLabel, standing.region, 'r')}${rankBox(LL('Reino', 'Realm'), standing.realm, 'n')}${spainBox}</div></div>
      <p class="foot gr-src">${standing.source ? LL(`Posiciones de ${standing.source}${standing.spain != null ? ' · España según Raider.IO' : ''}.`, `Rankings from ${standing.source}${standing.spain != null ? ' · Spain according to Raider.IO' : ''}.`, `Platzierungen von ${standing.source}${standing.spain != null ? ' · Spanien laut Raider.IO' : ''}.`, `Classements de ${standing.source}${standing.spain != null ? ' · Espagne selon Raider.IO' : ''}.`) : LL('No hay posición de guild para esta dificultad y parche (la guild no aparece en el ranking).', 'No guild ranking for this difficulty and patch (the guild is not in the ranking).')}</p>`;

    const sorted = (list) => {
      const l = [...list].sort((x, y) => y.avg - x.avg);
      if (st.sort === 'asc') return l.reverse();
      if (st.sort === 'name') return l.sort((x, y) => x.name.localeCompare(y.name, locale()));
      return l;
    };
    const table = (title, list) => {
      if (!list.length) return '';
      return `<h3 class="sec">${title}</h3><div class="gr-scroll"><div class="gr-table" style="--n:${encs.length}">
        <div class="gr-r th"><span>${LL('Nombre', 'Name')}</span><span>Avg</span>${encs.map((e) => `<span class="gr-boss" title="${esc(e.name)}"><img src="https://assets.rpglogs.com/img/warcraft/bosses/${e.id}-icon.jpg" width="38" height="38" alt=""></span>`).join('')}<span>All Stars</span></div>
        ${sorted(list).map((r) => `<div class="gr-r"><span class="gr-n" style="color:${classColor(r.cls)}">${esc(r.name)}</span>
          <span class="gr-avg">${parseCell(r.avg)}</span>
          ${encs.map((e) => { const c = r.boss[e.id]; return `<span class="gr-c">${c ? `${parseCell(c.p)}<img src="${specIconUrl(`${r.cls}-${c.spec}`)}" width="16" height="16" alt="">` : '<span class="gr-dash">-</span>'}</span>`; }).join('')}
          <span class="gr-stars">${r.stars != null ? `<b>${num(r.stars, 0)}</b>` : '<span class="gr-dash">-</span>'}</span></div>`).join('')}</div></div>`;
    };
    const by = (role) => rows.filter((r) => r.role === role);
    live.innerHTML = rows.length
      ? `${head}${table(LL('Daño', 'Damage dealers'), by('dps'))}${table(LL('Sanadores', 'Healers'), by('healer'))}${table(LL('Tanques', 'Tanks'), by('tank'))}
        <p class="foot">${LL(`Los ${pool.length} miembros de nivel máximo con mejor rango en la guild y su parse en Warcraft Logs (${st.bracket ? 'comparado con su mismo nivel de objeto' : 'comparado con todos los de su especialización'}). Avg es la media de su mejor parse en cada jefe. Quien no tiene logs públicos en este parche y dificultad no aparece.`, `The ${pool.length} max-level members with the highest guild rank and their Warcraft Logs parses (${st.bracket ? 'compared with their item level' : 'compared with everyone of their spec'}). Avg is the mean of their best parse on each boss. Anyone without public logs for this patch and difficulty is hidden.`, `Die ${pool.length} Mitglieder mit Maximalstufe und dem höchsten Gildenrang sowie ihr Parse auf Warcraft Logs (${st.bracket ? 'verglichen mit ihrer Gegenstandsstufe' : 'verglichen mit allen ihrer Spezialisierung'}). Avg ist der Mittelwert ihres besten Parses bei jedem Boss. Wer für diesen Patch und diese Schwierigkeit keine öffentlichen Logs hat, wird nicht angezeigt.`, `Les ${pool.length} membres de niveau maximum avec le meilleur rang dans la guilde et leur parse sur Warcraft Logs (${st.bracket ? 'comparé à leur niveau d’objet' : 'comparé à tous ceux de leur spécialisation'}). Avg est la moyenne de leur meilleur parse sur chaque boss. Ceux qui n’ont pas de logs publics pour ce patch et cette difficulté n’apparaissent pas.`)}</p>`
      : `${head}<div class="empty">${LL('Ningún miembro tiene parses públicos en este parche y dificultad.', 'No member has public parses for this patch and difficulty.')}</div>`;
  }

  // ------------------------------------------------------------ eventos
  async function pickGuild(g) {
    st.sel = g;
    st.results = null;
    if (g.region && st.status && g.region !== st.status.region) { await window.api.bnetSet({ region: g.region }); st.status = await window.api.bnetStatus(); }
    st.logs = null;
    try { lsSet('guild:last', JSON.stringify({ name: g.name, realmSlug: g.realmSlug, region: (g.region || st.status?.region || 'eu') })); } catch { /* nada */ }
    render();
  }

  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-gd]');
    if (!el || !S.guildOpen) return;
    const a = el.dataset.gd;
    if (a === 'login') {
      el.disabled = true;
      const r = await window.api.bnetLogin();
      st.status = await window.api.bnetStatus();
      if (r.error) { toast(friendly(r.error)); st.mineErr = r.error === 'CLOSED' ? '' : friendly(r.error); render(); return; }
      st.mine = null;
      render();
      loadMine();
    } else if (a === 'logout') {
      await window.api.bnetLogout();
      st.status = await window.api.bnetStatus();
      st.mine = null; st.mineErr = '';
      render();
    } else if (a === 'refresh') { st.mine = null; loadMine(); }
    else if (a === 'pick') { const g = (st.mine || []).find((x) => guildKey(x) === el.dataset.key); if (g) pickGuild({ ...g, region: g.region || st.status?.region }); }
    else if (a === 'pick-found') { const x = st.results?.list?.[Number(el.dataset.i)]; if (x) { st.tab = 'logs'; pickGuild({ name: x.name, realmSlug: x.realmSlug, realmName: x.realmName, region: x.region }); } }
    else if (a === 'fav') {
      const k = el.dataset.key;
      const l = lsList('gd:favs');
      lsSet('gd:favs', JSON.stringify(l.includes(k) ? l.filter((x) => x !== k) : [...l, k]));
      render();
    } else if (a === 'hide') {
      const k = el.dataset.key;
      const l = lsList('gd:hidden');
      if (!l.includes(k)) lsSet('gd:hidden', JSON.stringify([...l, k]));
      render();
    } else if (a === 'unhide') { lsSet('gd:hidden', '[]'); render(); }
    else if (a === 'armory') { if (st.armory?.key === el.dataset.key) { clearInterval(st.armoryTimer); st.armory = null; render(); } else openArmory(el.dataset.key, el.dataset.realm, el.dataset.name, false, el.dataset.region || ''); }
    else if (a === 'armory-refresh') { const x = st.armory; if (x) openArmory(x.key, x.realmSlug, x.name, false, x.region || ''); }
    else if (a === 'armory-close') { clearInterval(st.armoryTimer); st.armory = null; render(); }
    else if (a === 'pick-char') pickGuild({ name: el.dataset.guild, realmSlug: el.dataset.realm, realmName: el.dataset.realmname, region: el.dataset.region || st.status?.region });
    else if (a === 'delchar') { saveList('gd:chars', savedChars().filter((x) => charKey(x) !== el.dataset.key)); if (st.armory?.key === el.dataset.key) st.armory = null; await loadSaved(); render(); }
    else if (a === 'saveguild' || a === 'unsaveguild') {
      const g = st.sel;
      if (g) { const rest = savedGuilds().filter((x) => guildKey(x) !== guildKey(g)); saveList('gd:guilds', a === 'saveguild' ? [...rest, { name: g.name, realmSlug: g.realmSlug, realmName: g.realmName || g.realmSlug, region: g.region || st.status?.region || 'eu' }] : rest); rebuild(); render(); }
    }
    else if (a === 'tab') { st.tab = el.dataset.tab; render(); }
    else if (a === 'diff') { st.diff = Number(el.dataset.v); rankTab(); }
    else if (a === 'metric') { st.metric = el.dataset.v; rankTab(); }
    else if (a === 'sort') { st.sort = el.dataset.v; rankTab(); }
    else if (a === 'bracket') { st.bracket = el.dataset.v === '1'; rankTab(); }
    else if (a === 'zone') { st.zone = Number(el.dataset.v); rankTab(); }
    else if (a === 'report') { S.guildOpen = false; S.cmpOpen = false; loadReport(el.dataset.code); }
  });

  document.addEventListener('submit', async (ev) => {
    if (ev.target.id === 'gdCharForm') {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const region = String(fd.get('region') || 'eu');
      lsSet('gd:charRegion', region);
      const name = String(fd.get('name') || '').trim();
      const realm = String(fd.get('realm') || '').trim();
      if (name && realm) addChar(name, realm, region);
      return;
    }
    if (ev.target.id !== 'gdForm') return;
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const name = String(fd.get('guild') || '').trim();
    const realm = String(fd.get('realm') || '').trim().toLowerCase().replace(/\s+/g, '-');
    const reg = String(fd.get('region') || 'eu');
    if (!name) return toast(LL('Escribe el nombre de la guild', 'Enter the guild name'));
    if (!realm) { // sin reino: se buscan las guilds con ese nombre
      st.sel = null;
      st.results = { term: name, loading: true };
      render();
      const r = await window.api.rioGuilds(name);
      st.results = r.error ? { term: name, error: r.error } : { term: name, list: r.list };
      render();
      return;
    }
    st.tab = 'logs';
    pickGuild({ name, realmSlug: realm, realmName: realm, region: reg });
  });

  return { open, render };
})();
