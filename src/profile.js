'use strict';

// Ficha de personaje al estilo WoWProgress / Warcraft Logs: posiciones (mundial, región y reino), tabla por jefe,
// puntuación de Mítica+, equipo y modelo del personaje. Todo se pide en el momento, sin caché.
const Profile = (() => {
  const REGIONS = ['eu', 'us', 'kr', 'tw'];
  const METRICS = [['dps', 'DPS'], ['hps', 'HPS'], ['bossdps', null]];
  // Especializaciones de cada clase (nombres de Warcraft Logs, sin espacios) para el desplegable de specs
  const CLASS_SPECS = { DeathKnight: ['Blood', 'Frost', 'Unholy'], DemonHunter: ['Havoc', 'Vengeance', 'Devourer'], Druid: ['Balance', 'Feral', 'Guardian', 'Restoration'],
    Evoker: ['Devastation', 'Preservation', 'Augmentation'], Hunter: ['BeastMastery', 'Marksmanship', 'Survival'], Mage: ['Arcane', 'Fire', 'Frost'],
    Monk: ['Brewmaster', 'Mistweaver', 'Windwalker'], Paladin: ['Holy', 'Protection', 'Retribution'], Priest: ['Discipline', 'Holy', 'Shadow'],
    Rogue: ['Assassination', 'Outlaw', 'Subtlety'], Shaman: ['Elemental', 'Enhancement', 'Restoration'], Warlock: ['Affliction', 'Demonology', 'Destruction'], Warrior: ['Arms', 'Fury', 'Protection'] };
  // Warcraft Logs numera las clases distinto que Blizzard (Monje = 5 en WCL, 10 en Blizzard)
  const WCL_CLASS = { 1: 'DeathKnight', 2: 'Druid', 3: 'Hunter', 4: 'Mage', 5: 'Monk', 6: 'Paladin', 7: 'Priest', 8: 'Rogue', 9: 'Shaman', 10: 'Warlock', 11: 'Warrior', 12: 'DemonHunter', 13: 'Evoker' };
  const ASSETS = 'https://assets.rpglogs.com/img/warcraft';
  const SLOT_ORDER = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST', 'HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2', 'TRINKET_1', 'TRINKET_2', 'MAIN_HAND', 'OFF_HAND'];
  const QCOLOR = { POOR: '#9d9d9d', COMMON: '#ffffff', UNCOMMON: '#1eff00', RARE: '#0070dd', EPIC: '#a335ee', LEGENDARY: '#ff8000', ARTIFACT: '#e6cc80', HEIRLOOM: '#00ccff' };
  const st = { q: null, zones: null, zone: null, diff: 0, partition: -1, boss: 0, spec: '', metric: 'dps', arm: null, rio: null, wcl: null, wclErr: '', armErr: '', busy: false, at: 0, timer: null };

  const regionName = (r) => ({ eu: LL('Europa', 'Europe'), us: LL('América', 'America'), kr: LL('Corea', 'Korea'), tw: LL('Taiwán', 'Taiwan') }[r] || r.toUpperCase());
  const cleanLine = (x) => String(x ?? '').replace(/\|A:[^|]*\|a/g, '').replace(/\|c[0-9a-fA-F]{8}|\|cn[^:]*:|\|r/g, '').replace(/^Enchanted: /i, '').replace(/\s+/g, ' ').trim();
  const num0 = (v) => num(v || 0, 0);
  // Vista incrustada (ventana de armería de Guilds): usa el mismo estado, tabla y logs que la ficha, repintando en la ventana que la aloja
  const repaint = () => { if (S.profileOpen) render(); else if (S.guildOpen && st.embed && typeof Guilds !== 'undefined') Guilds.render(); };
  const recent = () => { try { return JSON.parse(lsGet('prof:recent') || '[]'); } catch { return []; } };

  function ago(ms) {
    if (!ms) return '—';
    const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (mins < 2) return LL('hace un momento', 'just now');
    if (mins < 60) return LL(`hace ${mins} min`, `${mins} min ago`);
    const h = Math.round(mins / 60);
    if (h < 24) return LL(`hace ${h} h`, `${h} h ago`);
    const d = Math.floor(h / 24);
    return d === 1 ? LL('hace 1 día', '1 day ago') : LL(`hace ${d} días`, `${d} days ago`);
  }
  const daysSince = (ms) => (ms ? Math.floor((Date.now() - ms) / 86400000) : null);

  // ------------------------------------------------------------ datos
  async function zonesList() {
    if (st.zones) return st.zones;
    // Bandas de todas las expansiones (no solo la actual), de la más antigua a la más nueva
    const d = await gql(`{worldData{expansions{id name zones{id name difficulties{id name} partitions{id name compactName default} encounters{id name}}}}}`);
    const bad = /ptr|complete|dummy|mythic\+|beta|torghast|delves|challenge|mage tower|season|dungeons/i;
    st.zones = (d.worldData?.expansions || []).flatMap((ex) => (ex.zones || []).map((z) => ({ ...z, expId: ex.id, expName: ex.name })))
      .filter((z) => z.encounters?.length >= 1 && !bad.test(z.name) && z.difficulties?.some((x) => [1, 2, 3, 4, 5].includes(x.id)))
      .sort((a, b) => a.expId - b.expId || a.id - b.id);
    if (!st.zones.some((z) => z.id === st.zone)) st.zone = st.zones[st.zones.length - 1]?.id;
    return st.zones;
  }

  // Todos los logs del personaje en un jefe (como el desplegable de Warcraft Logs), con caché por parche/dificultad/métrica
  st.encLogs = {};
  const encPending = new Set();
  const effDiff = () => st.diff || st.wcl?.zoneRankings?.difficulty || 5;
  const specArg = () => (st.spec ? `,specName:${JSON.stringify(st.spec)}` : '');
  const encKey = (id) => `${st.zone}:${st.diff}:${st.partition}:${st.spec}:${st.metric}:${id}`;
  async function fetchEncLogs(id) {
    const q = st.q, key = encKey(id);
    try {
      const metric = METRICS.some(([m]) => m === st.metric) ? st.metric : 'dps';
      const d = await gql(`{characterData{character(name:${JSON.stringify(q.name)},serverSlug:${JSON.stringify(q.slug)},serverRegion:${JSON.stringify(q.region.toUpperCase())}){encounterRankings(encounterID:${Number(id)},difficulty:${Number(effDiff())},metric:${metric},partition:${Number(st.partition)}${specArg()})}}}`, undefined, true);
      const ranks = d.characterData?.character?.encounterRankings?.ranks || [];
      st.encLogs[key] = ranks.filter((r) => r.report?.code).sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    } catch (e) { st.encLogs[key] = { error: friendlyError(e) }; }
  }
  function encLogsHTML(id, clsKey) {
    const data = st.encLogs[encKey(id)];
    let body;
    if (!data && !encPending.has(encKey(id))) { const k = encKey(id); encPending.add(k); fetchEncLogs(id).finally(() => { encPending.delete(k); repaint(); }); }
    if (!data) body = `<div class="loading"><span class="spinner"></span>${t('loading')}</div>`;
    else if (data.error) body = `<div class="empty sm">${esc(data.error)}</div>`;
    else if (!data.length) body = `<div class="empty sm">${LL('No hay logs públicos de este jefe.', 'No public logs for this boss.')}</div>`;
    else body = `<table class="pf-logs"><thead><tr><th>${LL('Fecha', 'Date')}</th><th>%</th><th>${esc(st.metric === 'hps' ? 'HPS' : 'DPS')}</th><th>${LL('Duración', 'Duration')}</th><th>${LL('Nivel obj.', 'Item lvl')}</th><th></th></tr></thead><tbody>`
      + data.map((r) => `<tr data-pf="log" data-code="${esc(r.report.code)}" data-fight="${Number(r.report.fightID) || ''}" title="${esc(LL('Abrir este log', 'Open this log'))}">`
        + `<td>${esc(new Date(r.startTime || r.report.startTime).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</td>`
        + `<td><span class="pf-pct"><b style="color:${parseColor(r.rankPercent)}">${r.rankPercent != null ? Math.floor(r.rankPercent) : '-'}</b>${clsKey && r.spec ? `<img class="pf-spec" src="${specIconUrl(`${clsKey}-${String(r.spec).split(' ').join('')}`)}" width="18" height="18" alt="">` : ''}</span></td>`
        + `<td>${r.amount != null ? num(r.amount, 1) : '-'}</td><td>${r.duration ? clock(r.duration) : '-'}</td><td>${r.bracketData != null ? esc(r.bracketData) : '-'}</td>`
        + `<td class="pf-logs-go">${LL('Ver log', 'View log')} →</td></tr>`).join('') + `</tbody></table>`;
    return `<tr class="pf-logs-row"><td colspan="10">${body}</td></tr>`;
  }

  async function fetchWcl() {
    const q = st.q;
    st.wclErr = '';
    try {
      const zones = await zonesList();
      const zone = zones.find((z) => z.id === st.zone) || zones[zones.length - 1];
      if (!zone) { st.wcl = null; return; }
      if (st.diff && !zone.difficulties?.some((x) => x.id === st.diff)) st.diff = 0;
      const metric = METRICS.some(([m]) => m === st.metric) ? st.metric : 'dps';
      const d = await gql(`{characterData{character(name:${JSON.stringify(q.name)},serverSlug:${JSON.stringify(q.slug)},serverRegion:${JSON.stringify(q.region.toUpperCase())}){name classID level faction{name} guildRank hidden zoneRankings(zoneID:${Number(zone.id)},${st.diff ? `difficulty:${Number(st.diff)},` : ''}metric:${metric},partition:${Number(st.partition)}${specArg()})}}}`, undefined, true);
      st.wcl = d.characterData?.character || null;
      if (!st.wcl) st.wclErr = LL('Warcraft Logs no tiene a este personaje (o no tiene logs públicos).', 'Warcraft Logs does not have this character (or it has no public logs).');
    } catch (e) { st.wcl = null; st.wclErr = friendlyError(e); }
  }

  async function fetchGear() {
    const q = st.q;
    const [a, r] = await Promise.all([window.api.bnetArmory(q.slug, q.name, S.lang, q.region), window.api.rioChar(q.region, q.slug, q.name)]);
    st.armErr = a.error ? a.error : '';
    if (!a.error) st.arm = a;
    st.rio = r.error ? null : r;
  }

  async function load() {
    clearInterval(st.timer);
    st.busy = true;
    render();
    await Promise.all([fetchWcl(), fetchGear()]);
    st.busy = false;
    st.at = Date.now();
    if (S.profileOpen) render();
    // el equipo se vuelve a pedir cada minuto mientras la ficha está abierta
    st.timer = setInterval(async () => {
      if (!S.profileOpen) { clearInterval(st.timer); return; }
      await fetchGear();
      st.at = Date.now();
      if (S.profileOpen && !st.busy) render();
    }, 60000);
  }


  // ------------------------------------------------------------ banderas y búsqueda por nombre
  const COUNTRY = { es_ES: 'es', es_MX: 'mx', es_AR: 'ar', es_CL: 'cl', de_DE: 'de', fr_FR: 'fr', en_GB: 'gb', it_IT: 'it', pt_PT: 'pt', pt_BR: 'br', ru_RU: 'ru', pl_PL: 'pl', en_US: 'us', en_AU: 'au', ko_KR: 'kr', zh_TW: 'tw', zh_CN: 'cn' };
  const REGION_FLAG = { eu: 'gb', us: 'us', kr: 'kr', tw: 'tw' };
  const flagCode = (locale, region) => COUNTRY[locale] || REGION_FLAG[region] || '';
  const flagHTML = (locale, region, title = '') => { const c = flagCode(locale, region); return c ? `<img class="flag" src="flags/${c}.svg" alt="${esc(c.toUpperCase())}" title="${esc(title || c.toUpperCase())}" width="22" height="16">` : ''; };
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const sr = { term: '', realm: '', region: 'all', list: [], hidden: 0, loading: false, error: '' };
  const CLASS_KEY_BY_ID = () => Cards.CLASS_KEY;

  // Comprobación directa en Blizzard cuando se escribe un reino (por si Raider.IO no conoce al personaje)
  async function directLookup(name, realm, region) {
    const slug = Cards.slugOf(realm);
    for (const rg of region === 'all' ? REGIONS : [region]) {
      try {
        const c = await Cards.char(name, slug, rg);
        return { name: c.name, realmSlug: c.realmSlug || slug, realmName: c.realmName || realm, altName: '', region: rg, regionShort: rg.toUpperCase(), locale: '', faction: String(c.faction || '').toLowerCase(), classId: c.classId || 0, thumb: c.avatar || '' };
      } catch { /* no existe en esa región */ }
    }
    return null;
  }

  async function search(name, realm, region) {
    sr.term = name; sr.realm = realm; sr.region = region; sr.list = []; sr.hidden = 0; sr.error = ''; sr.loading = true;
    renderSearch();
    const [r, direct] = await Promise.all([window.api.rioSearch(name), realm ? directLookup(name, realm, region) : Promise.resolve(null)]);
    sr.loading = false;
    if (r.error && !direct) sr.error = friendlyError(r.error);
    let list = r.list || [];
    if (region !== 'all') list = list.filter((x) => x.region === region);
    if (realm) {
      const k = norm(realm);
      list = list.filter((x) => norm(x.realmName).includes(k) || norm(x.realmSlug).includes(k) || norm(x.altName).includes(k));
    }
    if (direct && !list.some((x) => x.region === direct.region && x.realmSlug === direct.realmSlug && norm(x.name) === norm(direct.name))) list.unshift(direct);
    sr.list = list;
    sr.hidden = r.hidden || 0;
    renderSearch();
    fillSpecs(sr.term);
  }

  // Spec que lleva ahora cada personaje encontrado (Raider.IO), para poner su icono junto al nombre
  async function fillSpecs(term) {
    const todo = sr.list.map((x, i) => [x, i]).filter(([x]) => !x.specIcon && x.realmSlug).slice(0, 20);
    let k = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (k < todo.length) {
        const [x, i] = todo[k++];
        const r = await window.api.rioSpec?.(x.region, x.realmSlug, x.name);
        if (sr.term !== term || !r || r.error || !r.spec) continue;
        const cls = Cards.CLASS_KEY[x.classId] || String(r.cls || '').split(' ').join('');
        x.specIcon = `${cls}-${r.spec.split(' ').join('')}`;
        const img = document.querySelector(`#pfSearch .pf-row-spec[data-i="${i}"]`);
        if (img) { img.src = specIconUrl(x.specIcon); img.hidden = false; }
      }
    }));
  }

  function renderSearch() {
    const dlg = $('#pfSearch');
    if (!dlg) return;
    const key = Cards.CLASS_KEY;
    let body;
    if (sr.loading) body = `<div class="loading"><span class="spinner"></span>${t('loading')}</div>`;
    else if (sr.error) body = `<div class="error"><p>${esc(sr.error)}</p></div>`;
    else if (!sr.list.length) body = `<div class="empty sm">${LL('No he encontrado ningún personaje con ese nombre. Prueba a escribir el reino o a cambiar la región.', 'No character found with that name. Try entering the realm or changing the region.')}</div>`;
    else body = `<div class="pf-res">${sr.list.map((x, i) => {
      const cls = key[x.classId] || '';
      const faction = x.faction === 'horde' ? '#ff4a4a' : x.faction === 'alliance' ? '#4a8dff' : 'var(--muted)';
      const flag = flagHTML(x.locale, x.region, [x.realmName, x.regionShort].filter(Boolean).join(' · '));
      return `<button type="button" class="pf-row" data-pf="pick" data-i="${i}"><span class="pf-row-pic" style="--c:${classColor(cls)}">${x.thumb ? `<img src="${Cards.media(x.thumb)}" alt="" loading="lazy">` : ''}</span>
        <span class="pf-row-n"><b style="color:${classColor(cls)}"><img class="pf-row-spec" data-i="${i}" ${x.specIcon ? `src="${specIconUrl(x.specIcon)}"` : 'hidden'} width="20" height="20" alt="">${esc(x.name)}</b><small>${esc(cls ? className(cls) : '')} <i class="pf-fac" style="background:${faction}"></i></small></span>
        <span class="pf-row-s">${flag}<span>${esc(x.realmName)}${x.altName && x.altName !== x.realmName ? ` <small class="muted">${esc(x.altName)}</small>` : ''}<small>${esc(x.regionShort || x.region.toUpperCase())}</small></span></span></button>`;
    }).join('')}</div>${sr.hidden ? `<small class="muted">${LL(`${sr.hidden} resultados de reinos de China ocultos (no se pueden consultar).`, `${sr.hidden} results from China realms hidden (they cannot be queried).`)}</small>` : ''}`;
    dlg.innerHTML = `<div class="pf-dlg"><div class="pf-dlg-h"><div><h2>${LL('Personajes', 'Characters')}: «${esc(sr.term)}»</h2>
      <small class="muted">${sr.loading ? '' : LL(`${sr.list.length} encontrados`, `${sr.list.length} found`)}${sr.realm ? ` · ${esc(sr.realm)}` : ''}</small></div>
      <button type="button" class="btn ghost" data-pf="closesearch">${LL('Cerrar', 'Close')}</button></div>${body}</div>`;
    if (!dlg.open) dlg.showModal();
  }

  // ------------------------------------------------------------ vista
  function open(q) {
    if (typeof Replay !== 'undefined') Replay.stop();
    S.seq++;
    S.home = true;
    S.cmpOpen = true;
    S.guildOpen = false;
    S.profileOpen = true;
    sidebar.hidden = true;
    st.q = { name: q.name, slug: q.slug, realm: q.realm || q.slug, region: REGIONS.includes(q.region) ? q.region : 'eu', locale: q.locale || '' };
    st.arm = null; st.rio = null; st.wcl = null; st.wclErr = ''; st.armErr = '';
    st.embed = null; st.encLogs = {}; st.openEnc = null; st.boss = 0; st.spec = '';
    const l = recent().filter((x) => !(x.slug === st.q.slug && x.name.toLowerCase() === st.q.name.toLowerCase() && x.region === st.q.region));
    l.unshift({ name: st.q.name, realm: st.q.realm, slug: st.q.slug, region: st.q.region, locale: st.q.locale });
    lsSet('prof:recent', JSON.stringify(l.slice(0, 8)));
    main.scrollTop = 0;
    load();
  }

  const rankColor = (p) => (p == null ? 'var(--muted)' : parseColor(p));

  function tilesHTML() {
    const w = st.wcl;
    const zones = st.zones || [];
    const zone = zones.find((z) => z.id === st.zone);
    const zr = w?.zoneRankings;
    const tiles = [];
    if (zr) {
      const as = [...(zr.allStars || [])].sort((a, b) => b.points - a.points)[0];
      const killed = (zr.rankings || []).filter((r) => r.totalKills > 0).length;
      const total = zone?.encounters?.length || (zr.rankings || []).length;
      tiles.push(`<div class="pf-tile"><h4>${esc(zone?.name || '')} · ${esc(diffName(effDiff()))}</h4>
        <div class="pf-tile-b"><span class="pf-prog">${killed}<small> / ${total}</small></span><span><small>All Stars</small><b>${as ? num(as.points, 0) : '—'}</b></span>
        <span><small>${LL('Mundo', 'World')}</small><b style="color:${rankColor(as?.rankPercent)}">${as ? `#${num0(as.rank)}` : '—'}</b></span>
        <span><small>${esc(regionName(st.q.region))}</small><b style="color:${rankColor(as?.rankPercent)}">${as ? `#${num0(as.regionRank)}` : '—'}</b></span>
        <span><small>${LL('Reino', 'Realm')}</small><b>${as ? `#${num0(as.serverRank)}` : '—'}</b></span></div></div>`);
    }
    const rio = st.rio;
    if (rio?.season) {
      const ov = rio.ranks?.overall || {};
      const label = String(rio.season.season || '').replace(/^season-/, '').toUpperCase();
      tiles.push(`<div class="pf-tile"><h4>${LL('Mítica+', 'Mythic+')} · ${esc(label)}</h4>
        <div class="pf-tile-b"><span><small>${LL('Puntuación', 'Score')}</small><b style="color:${esc(rio.season.segments?.all?.color || 'var(--text)')}">${num(rio.season.scores?.all || 0, 0)}</b></span>
        <span><small>${LL('Mundo', 'World')}</small><b>${ov.world ? `#${num0(ov.world)}` : '—'}</b></span>
        <span><small>${esc(regionName(st.q.region))}</small><b>${ov.region ? `#${num0(ov.region)}` : '—'}</b></span>
        <span><small>${LL('Reino', 'Realm')}</small><b>${ov.realm ? `#${num0(ov.realm)}` : '—'}</b></span></div></div>`);
    }
    return tiles.join('');
  }

  // Enlaces a las mismas fichas en otras webs
  function linksHTML() {
    const q = st.q;
    const slug = encodeURIComponent(q.slug);
    const nm = encodeURIComponent(q.name);
    const lang = { es: 'es-es', en: 'en-gb' }[S.lang] || 'en-gb';
    const links = [
      ['Warcraft Logs', `https://www.warcraftlogs.com/character/${q.region}/${slug}/${nm}`],
      ['Raider.IO', st.rio?.url || `https://raider.io/characters/${q.region}/${slug}/${nm}`],
      [LL('Armería', 'Armory'), `https://worldofwarcraft.blizzard.com/${lang}/character/${q.region}/${slug}/${nm}`],
      ['Droptimizer', 'https://www.raidbots.com/simbot/droptimizer'],
    ];
    return links.map(([l, u]) => `<a href="#" class="link" data-pf="ext" data-u="${esc(u)}">${esc(l)} ↗</a>`).join(' · ');
  }

  function headerHTML() {
    const a = st.arm;
    const w = st.wcl;
    const q = st.q;
    const classId = a?.classId || w?.classID;
    const cls = Cards.CLASS_KEY[classId] || '';
    const days = daysSince(a?.lastLogin);
    const stale = days != null && days >= 7;
    const avatar = a?.avatar ? `<img src="${Cards.media(a.avatar)}" alt="">` : '';
    const guild = a?.guild ? `<span style="color:${a.faction === 'HORDE' ? '#ff4a4a' : '#4a8dff'}">${esc(a.guild)}</span> - ` : '';
    return `<div class="pf-head">
      <span class="pf-ava">${avatar}<b>${esc(a?.level || w?.level || '')}</b></span>
      <div class="pf-id"><h1>${esc(a?.name || q.name)}</h1>
        <div class="pf-sub">${guild}${flagHTML(q.locale, q.region)} <span>${esc(a?.realmName || q.realm)} (${esc(q.region.toUpperCase())})</span></div>
        <div class="pf-cls" style="color:${classColor(cls)}">${esc([a?.race, a?.cls].filter(Boolean).join(' '))}${a?.spec ? ` · ${esc(a.spec)}` : ''}</div>
        <div class="pf-links">${linksHTML()}</div></div>
      <div class="pf-tiles">${tilesHTML()}</div>
      <div class="pf-upd"><button type="button" class="btn ghost" data-pf="update" ${st.busy ? 'disabled' : ''}>↻ ${LL('Actualizar', 'Update')}</button>
        <small>${LL('Equipo actualizado', 'Gear updated')}: <b class="${stale ? 'bad' : ''}">${esc(ago(a?.lastLogin))}</b>${days != null && days > 0 ? ` <span class="muted">(${LL(`${days} d sin actualizar`, `${days} d without update`)})</span>` : ''}</small>
        <small class="muted">${LL('Consultado', 'Fetched')}: ${esc(ago(st.at))}</small></div></div>`;
  }

  // Desplegable propio (con iconos) igual que los de Warcraft Logs; items: [{ v, label, icon?, on? }]
  const ddHTML = (key, cur, items) => `<div class="abdd pf-dd"><button type="button" class="abdd-btn" data-pf="dd-toggle">${cur.icon ? `<img class="pf-ddi" src="${cur.icon}" width="20" height="20" alt="">` : ''}<span class="abdd-t">${esc(cur.label)}</span><span class="abdd-car">▾</span></button>
    <div class="abdd-list surface-dark" hidden>${items.map((it) => `<div class="abdd-i ${it.on ? 'on' : ''}" data-pf="dd-pick" data-dd="${key}" data-v="${esc(String(it.v))}">${it.icon ? `<img class="pf-ddi" src="${it.icon}" width="22" height="22" alt="" loading="lazy">` : ''}<span class="abdd-t">${esc(it.label)}</span></div>`).join('')}</div></div>`;
  const partName = (id) => { const p = (((st.zones || []).find((z) => z.id === st.zone) || {}).partitions || []).find((x) => x.id === id); return p ? (p.compactName || p.name) : ''; };
  function controlsHTML() {
    const zones = st.zones || [];
    const zone = zones.find((z) => z.id === st.zone);
    if (!zone) return '';
    const exps = [...new Map(zones.map((z) => [z.expId, z.expName])).entries()].sort((a, b) => b[0] - a[0]);
    const expDD = ddHTML('exp', { label: zone.expName }, exps.map(([id, name]) => ({ v: id, label: name, on: id === zone.expId })));
    const zoneDD = ddHTML('zone', { label: zone.name, icon: `${ASSETS}/zones/zone-${zone.id}.png` },
      [...zones].filter((z) => z.expId === zone.expId).sort((a, b) => b.id - a.id).map((z) => ({ v: z.id, label: z.name, icon: `${ASSETS}/zones/zone-${z.id}.png`, on: z.id === zone.id })));
    const mLabel = { dps: LL('Daño', 'Damage'), hps: LL('Sanación', 'Healing'), bossdps: LL('Daño a jefe', 'Boss Damage') };
    const metDD = ddHTML('metric', { label: mLabel[st.metric] || mLabel.dps }, METRICS.map(([m]) => ({ v: m, label: mLabel[m], on: st.metric === m })));
    const bosses = (zone.encounters || []).filter((e) => e.name);
    const allBoss = LL('Todos los jefes', 'All Bosses');
    const curBoss = bosses.find((e) => e.id === st.boss);
    const bossDD = ddHTML('boss', curBoss ? { label: curBoss.name, icon: `${ASSETS}/bosses/${curBoss.id}-icon.jpg` } : { label: allBoss },
      [{ v: 0, label: allBoss, on: !st.boss }, ...bosses.map((e) => ({ v: e.id, label: e.name, icon: `${ASSETS}/bosses/${e.id}-icon.jpg`, on: e.id === st.boss }))]);
    const clsKey = WCL_CLASS[st.wcl?.classID] || '';
    const specs = CLASS_SPECS[clsKey] || [];
    const allSpec = LL('Todas las especializaciones', 'All Specs');
    const specIc = (sp) => specIconUrl(`${clsKey}-${sp}`);
    const specDD = ddHTML('spec', st.spec && clsKey ? { label: specName(st.spec), icon: specIc(st.spec) } : { label: allSpec },
      [{ v: '', label: allSpec, on: !st.spec }, ...specs.map((sp) => ({ v: sp, label: specName(sp), icon: specIc(sp), on: sp === st.spec }))]);
    const dIds = [5, 4, 3, 2, 1].filter((id) => (zone.difficulties || []).some((d) => d.id === id));
    const dLabel = (id) => diffName(id) || (zone.difficulties.find((d) => d.id === id)?.name || '');
    const highest = LL('Dificultad máxima', 'Highest Difficulty');
    const diffDD = ddHTML('diff', { label: st.diff ? dLabel(st.diff) : highest }, [{ v: 0, label: highest, on: !st.diff }, ...dIds.map((id) => ({ v: id, label: dLabel(id), on: id === st.diff }))]);
    // Botones de parche dentro de la season (como en Warcraft Logs): Todos + uno por cada parche de la banda
    const parts = (zone.partitions || []).filter((p) => p.name !== 'default');
    const ptabs = parts.length > 1 ? `<div class="pf-ptabs"><button type="button" class="pf-ptab ${st.partition === -1 ? 'on' : ''}" data-pf="part" data-v="-1">${LL('Todos', 'All')}</button>${parts.map((p) => `<button type="button" class="pf-ptab ${st.partition === p.id ? 'on' : ''}" data-pf="part" data-v="${p.id}" title="${esc(p.name)}">${esc(p.compactName || p.name)}</button>`).join('')}</div>` : '';
    return `<div class="pf-fbar">${expDD}${zoneDD}</div><div class="pf-fbar">${metDD}${bossDD}${specDD}${diffDD}</div>${ptabs}`;
  }

  function tableHTML() {
    if (st.wclErr) return `<div class="empty sm">${esc(st.wclErr)}</div>`;
    const w = st.wcl;
    if (!w) return `<div class="loading"><span class="spinner"></span>${t('loading')}</div>`;
    const zr = w.zoneRankings;
    const zone = (st.zones || []).find((z) => z.id === st.zone);
    if (!zr || !zone) return `<div class="empty sm">${LL('Sin datos para este parche y dificultad.', 'No data for this patch and difficulty.')}</div>`;
    const byEnc = new Map((zr.rankings || []).map((r) => [r.encounter?.id, r]));
    const kills = (zr.rankings || []).reduce((s, r) => s + (r.totalKills || 0), 0);
    const as = [...(zr.allStars || [])].sort((a, b) => b.points - a.points)[0];
    const unit = zr.metric === 'hps' ? 'HPS' : 'DPS';
    const pct = (v) => (v == null ? '-' : `<b style="color:${parseColor(v)}">${Math.floor(v)}</b>`);
    // Icono de la spec con la que se hizo el mejor parse (como en Warcraft Logs)
    const clsKey = WCL_CLASS[w.classID] || Cards.CLASS_KEY[st.arm?.classId] || '';
    const specImg = (r) => { const sp = r.bestSpec || r.spec; return clsKey && sp ? `<img class="pf-spec" src="${specIconUrl(`${clsKey}-${String(sp).split(' ').join('')}`)}" width="20" height="20" alt="" title="${esc(sp)}">` : ''; };
    const rows = zone.encounters.filter((e) => e.name && (!st.boss || e.id === st.boss)).map((e) => { // sin nombre = jefe aún sin traducir en Warcraft Logs
      const r = byEnc.get(e.id);
      const has = r && r.totalKills > 0;
      const a2 = r?.allStars;
      return `<tr class="${has ? `pf-enc${st.openEnc === e.id ? ' open' : ''}` : 'none'}"${has ? ` data-pf="enc" data-e="${e.id}"` : ''}><td class="pf-boss"><div class="pf-bw"><span class="pf-bic"><img src="https://assets.rpglogs.com/img/warcraft/bosses/${e.id}-icon.jpg" width="28" height="28" loading="lazy" alt=""></span><span>${esc(e.name)}</span></div></td>
        <td>${has ? `<span class="pf-pct">${pct(r.rankPercent)}${specImg(r)}</span>` : '-'}</td><td class="n pf-dps">${has ? num(r.bestAmount, 1) : '-'}</td><td class="n">${has ? num0(r.totalKills) : 0}</td>
        <td class="n">${has && r.fastestKill ? clock(r.fastestKill) : '-'}</td><td>${has ? pct(r.medianPercent) : '-'}</td>
        <td class="n">${has && a2 ? num(a2.points, 2) : '-'}</td>
        <td class="n" title="${a2 ? esc(`${num0(a2.total)} ${LL('jugadores', 'players')}`) : ''}">${has && a2 ? `<b style="color:${parseColor(a2.rankPercent)}">${num0(a2.rank)}</b>` : '-'}</td>
        <td class="n">${has && a2 ? num0(a2.regionRank) : '-'}</td><td class="n">${has && a2 ? num0(a2.serverRank) : '-'}</td></tr>`
        + (has && st.openEnc === e.id ? encLogsHTML(e.id, clsKey) : '');
    }).join('');
    // Resumen con la misma disposición que Warcraft Logs: dificultad arriba, mejor media a la izquierda,
    // mediana y kills a la derecha, y los puntos All Star (con parche y spec) abajo en el centro
    const asSpec = as?.spec && clsKey ? `<img class="pf-spec" src="${specIconUrl(`${clsKey}-${String(as.spec).split(' ').join('')}`)}" width="20" height="20" alt="" title="${esc(as.spec)}">` : '';
    return `<div class="pf-sum2"><div class="pf-sum2-t">${esc(diffName(effDiff()) || '')}</div>
      <div class="pf-sum2-l"><small>${LL('Mejor media', 'Best Perf. Avg')}</small><b style="color:${rankColor(zr.bestPerformanceAverage)}">${zr.bestPerformanceAverage != null ? num(zr.bestPerformanceAverage, 1) : '—'}</b></div>
      <div class="pf-sum2-r"><span>${LL('Media mediana', 'Median Perf. Avg')}: <b style="color:${rankColor(zr.medianPerformanceAverage)}">${zr.medianPerformanceAverage != null ? num(zr.medianPerformanceAverage, 1) : '—'}</b></span>
        <span>${LL('Kills registradas', 'Kills Logged')}: <b>${num0(kills)}</b></span></div>
      <div class="pf-sum2-b">${LL('Puntos All Star', 'All Star Points')}: <b class="pf-as">${as ? num(as.points, 2) : '—'}</b>${as ? ` (<b style="color:${rankColor(as.rankPercent)}">${num0(as.rank)}</b>)` : ''}${partName(as?.partition) ? ` <span class="muted">(${esc(partName(as.partition))})</span>` : ''}${asSpec}</div></div>
      <div class="pf-tbl-w"><table class="pf-table"><thead><tr><th rowspan="2">${LL('Jefe', 'Boss')}</th><th rowspan="2">${LL('Mejor %', 'Best %')}</th><th rowspan="2">${LL(`${unit} máximo`, `Highest ${unit}`)}</th><th rowspan="2">Kills</th><th rowspan="2">${LL('Más rápida', 'Fastest')}</th><th rowspan="2">${LL('Med.', 'Med')}</th><th colspan="4">All Stars</th></tr>
        <tr><th>${LL('Puntos', 'Points')}</th><th>${LL('Mundo', 'World')}</th><th>${esc(regionName(st.q.region))}</th><th>${LL('Reino', 'Realm')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function gearHTML() {
    const a = st.arm;
    if (!a) return st.armErr ? `<div class="empty sm">${esc(st.armErr)}</div>` : `<div class="loading"><span class="spinner"></span>${t('loading')}</div>`;
    const items = [...a.items].filter((i) => !['SHIRT', 'TABARD'].includes(i.slot)).sort((x, y) => SLOT_ORDER.indexOf(x.slot) - SLOT_ORDER.indexOf(y.slot));
    const ilvl = a.ilvlExact ? num(a.ilvlExact, 2) : (st.rio?.ilvl || a.ilvlEquipped);
    const rows = items.map((it) => {
      const extra = [...it.enchant.map((e) => `<i class="ench">${esc(cleanLine(e))}</i>`), ...it.gems.map((g) => `<i class="gem">${esc(cleanLine(g.name || g.stat || ''))}</i>`)].join('');
      return `<div class="pf-it" style="--q:${QCOLOR[it.quality] || '#fff'}" data-itip="${Cards.itemTipKey(it)}"><span class="arm-ic">${it.icon ? `<img src="${Cards.media(it.icon)}" alt="" loading="lazy">` : ''}</span>
        <span class="pf-itx"><b title="${esc(it.name)}">${esc(it.name)}</b>${extra}</span><em>${esc(it.ilvl || '')}</em></div>`;
    }).join('');
    return `<div class="pf-gear-h"><b>${LL('Equipo', 'Gear')}</b><span>${LL('Nivel de objeto', 'Item Level')}: <b>${esc(ilvl || '—')}</b></span></div>${rows}`;
  }

  // Talentos que lleva ahora (Raider.IO): héroe y clase/especialización, con tooltip y botón para copiarlos al juego
  function talentsHTML() {
    const tl = st.rio?.talents;
    if (!tl || !tl.nodes?.length) return '';
    const icon = (n) => `<span class="pf-tal-i${n.rank < n.max ? ' part' : ''}" data-spell="${n.spell}" aria-label="${esc(n.name)}"><img src="wcicon://i/${encodeURIComponent(n.icon)}" alt="" loading="lazy">${n.max > 1 ? `<i>${n.rank}</i>` : ''}</span>`;
    const hero = tl.nodes.filter((n) => n.hero), rest = tl.nodes.filter((n) => !n.hero);
    return `<div class="pf-tal"><div class="pf-gear-h"><b>${LL('Talentos', 'Talents')}</b>${tl.text ? `<button type="button" class="btn ghost sm" data-pf="copytal">${LL('Copiar talentos', 'Copy talents')}</button>` : ''}</div>`
      + (hero.length ? `<small class="pf-tal-h">${LL('Héroe', 'Hero')}</small><div class="pf-tal-g">${hero.map(icon).join('')}</div>` : '')
      + `<small class="pf-tal-h">${LL('Clase y especialización', 'Class and specialization')}</small><div class="pf-tal-g">${rest.map(icon).join('')}</div></div>`;
  }

  function render() {
    if (!S.profileOpen || !st.q) return;
    const a = st.arm;
    const model = a?.render ? `<div class="pf-model" data-tilt><img src="${Cards.media(a.render)}" alt="${esc(a.name)}" draggable="false" crossorigin="anonymous"></div>` : '';
    main.innerHTML = `<div class="pf">
      <div class="pf-back"><button type="button" class="btn ghost sm" data-pf="home">${LL('← Inicio', '← Home')}</button></div>
      ${headerHTML()}
      <div class="pf-grid"><section class="pf-left">${controlsHTML()}${tableHTML()}</section>
        <aside class="pf-right"><div class="pf-gear">${gearHTML()}</div>${talentsHTML()}${model}</aside></div></div>`;
  }

  // ------------------------------------------------------------ buscador (portada)
  function formHTML() {
    const last = lsGet('prof:region') || 'all';
    const rec = recent();
    const reg = [['all', LL('Todas las regiones', 'All regions')], ['eu', 'EU'], ['us', 'US'], ['kr', 'KR'], ['tw', 'TW']];
    return `<form id="pfForm" class="pf-search" autocomplete="off">
      <input name="name" class="pf-in-name" placeholder="${esc(LL('Nombre del personaje', 'Character name'))}" spellcheck="false" required>
      <input name="realm" class="pf-in-realm" placeholder="${esc(LL('Reino (opcional)', 'Realm (optional)'))}" spellcheck="false">
      <select name="region">${reg.map(([v, l]) => `<option value="${v}" ${v === last ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn primary" type="submit">${LL('Buscar', 'Search')}</button></form>
      ${rec.length ? `<div class="chips pf-rec">${rec.map((x, i) => `<span class="pf-rec-i"><button type="button" class="chip" data-pf="recent" data-i="${i}">${flagHTML(x.locale, x.region)} ${esc(x.name)} <span class="muted">${esc(x.realm)} · ${esc(x.region.toUpperCase())}</span></button><button type="button" class="pf-rec-x" data-pf="recent-del" data-i="${i}" title="${esc(LL('Quitar de recientes', 'Remove from recent'))}" aria-label="${esc(LL('Quitar', 'Remove'))}">✕</button></span>`).join('')}<button type="button" class="mini-btn" data-pf="recent-clear">${LL('Borrar todos', 'Clear all')}</button></div>` : ''}`;
  }

  function sectionHTML() {
    return `<section class="pf-find"><h3 class="sec" data-pf="focus">${LL('Buscar personaje', 'Find a character')}</h3>
      <p class="muted">${LL('Escribe el nombre y pulsa Intro: verás los personajes que existen con ese nombre, su reino y su país. El reino es opcional. Al elegir uno, se abre su ficha con posiciones, logs por jefe, equipo y modelo en vivo.', 'Type the name and press Enter: you will see the characters that exist with that name, their realm and country. The realm is optional. Pick one to open its page with rankings, logs per boss, gear and model, live.')}</p>
      ${formHTML()}</section>`;
  }

  document.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'pfForm') return;
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const name = String(fd.get('name') || '').trim();
    const realm = String(fd.get('realm') || '').trim();
    const region = String(fd.get('region') || 'eu');
    lsSet('prof:region', region);
    if (name) search(name, realm, region);
  });

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-pf]');
    if (!el) return;
    const a = el.dataset.pf;
    if (a === 'recent') { const x = recent()[Number(el.dataset.i)]; if (x) open(x); }
    else if (a === 'recent-del' || a === 'recent-clear') {
      const l = a === 'recent-clear' ? [] : recent().filter((_, i) => i !== Number(el.dataset.i));
      lsSet('prof:recent', JSON.stringify(l));
      if (main.querySelector('.charsearch') && typeof openCharSearch === 'function') openCharSearch(); else if (!S.profileOpen) renderWelcome();
    }
    else if (a === 'pick') { const x = sr.list[Number(el.dataset.i)]; if (x) { $('#pfSearch').close(); open({ name: x.name, realm: x.realmName, slug: x.realmSlug, region: x.region, locale: x.locale }); } }
    else if (a === 'closesearch') $('#pfSearch').close();
    else if (a === 'ext') { ev.preventDefault(); window.api.openExternal(el.dataset.u); }
    else if (a === 'focus') { const i = document.querySelector('#pfForm input[name="name"]'); if (i) i.focus(); }
    else if (!S.profileOpen && !(S.guildOpen && st.embed)) return;
    else if (a === 'update') load();
    else if (a === 'enc') { const id = Number(el.dataset.e); st.openEnc = st.openEnc === id ? null : id; repaint(); }
    else if (a === 'log') loadReport(`https://www.warcraftlogs.com/reports/${el.dataset.code}${el.dataset.fight ? `#fight=${el.dataset.fight}` : ''}`);
    else if (a === 'copytal') { const txt = st.rio?.talents?.text; if (txt) navigator.clipboard.writeText(txt).then(() => toast(LL('Talentos copiados: pégalos en el juego con «Importar»', 'Talents copied: paste them in game with «Import»'))); }
    else if (a === 'home') goHome();
    else if (a === 'dd-toggle') {
      const list = el.nextElementSibling;
      document.querySelectorAll('.abdd-list:not([hidden])').forEach((l) => { if (l !== list) l.hidden = true; });
      list.hidden = !list.hidden;
    }
    else if (a === 'dd-pick') {
      const k = el.dataset.dd, v = el.dataset.v;
      const reload = () => { st.wcl = null; repaint(); fetchWcl().then(repaint); };
      const zoneReset = () => { st.partition = -1; st.boss = 0; st.openEnc = null; };
      if (k === 'exp') { const z = (st.zones || []).filter((x) => x.expId === Number(v)).sort((a, b) => b.id - a.id)[0]; if (z) { st.zone = z.id; zoneReset(); reload(); } }
      else if (k === 'zone') { st.zone = Number(v); zoneReset(); reload(); }
      else if (k === 'metric') { st.metric = v; reload(); }
      else if (k === 'diff') { st.diff = Number(v); st.openEnc = null; reload(); }
      else if (k === 'spec') { st.spec = v; st.openEnc = null; reload(); }
      else if (k === 'boss') { st.boss = Number(v); st.openEnc = st.boss || null; repaint(); }
    }
    else if (a === 'part') { st.partition = Number(el.dataset.v); st.openEnc = null; st.wcl = null; repaint(); fetchWcl().then(repaint); }
    else if (a === 'diff') { st.diff = Number(el.dataset.v); st.wcl = null; repaint(); fetchWcl().then(repaint); }
    else if (a === 'metric') { st.metric = el.dataset.v; st.wcl = null; repaint(); fetchWcl().then(repaint); }
  });
  document.addEventListener('change', (ev) => {
    if ((!S.profileOpen && !(S.guildOpen && st.embed)) || !ev.target.matches?.('[data-pf-zone]')) return;
    st.zone = Number(ev.target.value);
    st.partition = -1;
    st.openEnc = null;
    st.wcl = null;
    repaint();
    fetchWcl().then(repaint);
  });

  // Carga los parses de un personaje para mostrarlos dentro de otra ventana (no cambia de página)
  function embed(c) {
    const region = String(c.region || 'eu').toLowerCase();
    const key = `${region}/${c.realmSlug}/${String(c.name).toLowerCase()}`;
    if (st.embed === key) return;
    st.embed = key;
    st.q = { name: c.name, slug: c.realmSlug, realm: c.realmName || c.realmSlug, region: REGIONS.includes(region) ? region : 'eu', locale: '' };
    st.arm = null; st.rio = null; st.wcl = null; st.wclErr = ''; st.openEnc = null; st.encLogs = {}; st.boss = 0; st.spec = '';
    fetchWcl().then(() => { if (st.embed === key) repaint(); });
  }
  const embedHTML = () => (st.embed ? `<div class="pf pf-embed"><div class="pf-tiles">${tilesHTML()}</div>${controlsHTML()}${tableHTML()}</div>` : '');

  // Enlace directo: …/WipeTime/#char=eu/zuljin/okita abre directamente la ficha de ese personaje
  setTimeout(() => {
    const m = /#char=([a-z]{2})\/([^/]+)\/(.+)$/i.exec(location.hash || '');
    if (!m) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* sin historial */ }
    const slug = decodeURIComponent(m[2]), name = decodeURIComponent(m[3]);
    open({ name, slug, realm: slug, region: m[1].toLowerCase() });
  }, 900);

  return { open, render, formHTML, sectionHTML, search, load, embed, embedHTML };
})();
