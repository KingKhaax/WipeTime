'use strict';

// Ficha de personaje al estilo WoWProgress / Warcraft Logs: posiciones (mundial, región y reino), tabla por jefe,
// puntuación de Mítica+, equipo y modelo del personaje. Todo se pide en el momento, sin caché.
const Profile = (() => {
  const REGIONS = ['eu', 'us', 'kr', 'tw'];
  const PATCH_OF_ZONE = { 46: '12.0.0', 50: '12.0.7', 53: '12.1' };
  const METRICS = [['dps', 'DPS'], ['hps', 'HPS']];
  const SLOT_ORDER = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST', 'HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2', 'TRINKET_1', 'TRINKET_2', 'MAIN_HAND', 'OFF_HAND'];
  const QCOLOR = { POOR: '#9d9d9d', COMMON: '#ffffff', UNCOMMON: '#1eff00', RARE: '#0070dd', EPIC: '#a335ee', LEGENDARY: '#ff8000', ARTIFACT: '#e6cc80', HEIRLOOM: '#00ccff' };
  const st = { q: null, zones: null, zone: null, diff: 5, metric: 'dps', arm: null, rio: null, wcl: null, wclErr: '', armErr: '', busy: false, at: 0, timer: null };

  const regionName = (r) => ({ eu: LL('Europa', 'Europe', 'Europa', 'Europe'), us: LL('América', 'America', 'Amerika', 'Amérique'), kr: LL('Corea', 'Korea', 'Korea', 'Corée'), tw: LL('Taiwán', 'Taiwan', 'Taiwan', 'Taïwan') }[r] || r.toUpperCase());
  const cleanLine = (x) => String(x ?? '').replace(/\|A:[^|]*\|a/g, '').replace(/\|c[0-9a-fA-F]{8}|\|cn[^:]*:|\|r/g, '').replace(/^Enchanted: /i, '').replace(/\s+/g, ' ').trim();
  const num0 = (v) => num(v || 0, 0);
  const recent = () => { try { return JSON.parse(lsGet('prof:recent') || '[]'); } catch { return []; } };

  function ago(ms) {
    if (!ms) return '—';
    const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (mins < 2) return LL('hace un momento', 'just now', 'gerade eben', 'à l’instant');
    if (mins < 60) return LL(`hace ${mins} min`, `${mins} min ago`, `vor ${mins} Min.`, `il y a ${mins} min`);
    const h = Math.round(mins / 60);
    if (h < 24) return LL(`hace ${h} h`, `${h} h ago`, `vor ${h} Std.`, `il y a ${h} h`);
    const d = Math.floor(h / 24);
    return d === 1 ? LL('hace 1 día', '1 day ago', 'vor 1 Tag', 'il y a 1 jour') : LL(`hace ${d} días`, `${d} days ago`, `vor ${d} Tagen`, `il y a ${d} jours`);
  }
  const daysSince = (ms) => (ms ? Math.floor((Date.now() - ms) / 86400000) : null);

  // ------------------------------------------------------------ datos
  async function zonesList() {
    if (st.zones) return st.zones;
    const d = await gql(`{worldData{expansion(id:${S.expansion?.id ?? 7}){zones{id name difficulties{id name} encounters{id name}}}}}`);
    const bad = /ptr|complete|dummy|mythic\+|beta/i;
    st.zones = (d.worldData?.expansion?.zones || []).filter((z) => z.encounters?.length >= 1 && !bad.test(z.name)).sort((a, b) => a.id - b.id);
    if (!st.zones.some((z) => z.id === st.zone)) st.zone = st.zones[st.zones.length - 1]?.id;
    return st.zones;
  }

  async function fetchWcl() {
    const q = st.q;
    st.wclErr = '';
    try {
      const zones = await zonesList();
      const zone = zones.find((z) => z.id === st.zone) || zones[zones.length - 1];
      if (!zone) { st.wcl = null; return; }
      if (!zone.difficulties?.some((x) => x.id === st.diff)) st.diff = (zone.difficulties || []).map((x) => x.id).filter((i) => [3, 4, 5].includes(i)).pop() || zone.difficulties?.[0]?.id || 5;
      const metric = METRICS.some(([m]) => m === st.metric) ? st.metric : 'dps';
      const d = await gql(`{characterData{character(name:${JSON.stringify(q.name)},serverSlug:${JSON.stringify(q.slug)},serverRegion:${JSON.stringify(q.region.toUpperCase())}){name classID level faction{name} guildRank hidden zoneRankings(zoneID:${Number(zone.id)},difficulty:${Number(st.diff)},metric:${metric})}}}`, undefined, true);
      st.wcl = d.characterData?.character || null;
      if (!st.wcl) st.wclErr = LL('Warcraft Logs no tiene a este personaje (o no tiene logs públicos).', 'Warcraft Logs does not have this character (or it has no public logs).', 'Warcraft Logs kennt diesen Charakter nicht (oder er hat keine öffentlichen Logs).', 'Warcraft Logs ne connaît pas ce personnage (ou il n’a aucun log public).');
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

  // ------------------------------------------------------------ vista
  function open(q) {
    if (typeof Replay !== 'undefined') Replay.stop();
    S.seq++;
    S.home = true;
    S.cmpOpen = true;
    S.guildOpen = false;
    S.profileOpen = true;
    sidebar.hidden = true;
    st.q = { name: q.name, slug: q.slug, realm: q.realm || q.slug, region: REGIONS.includes(q.region) ? q.region : 'eu' };
    st.arm = null; st.rio = null; st.wcl = null; st.wclErr = ''; st.armErr = '';
    const l = recent().filter((x) => !(x.slug === st.q.slug && x.name.toLowerCase() === st.q.name.toLowerCase() && x.region === st.q.region));
    l.unshift({ name: st.q.name, realm: st.q.realm, slug: st.q.slug, region: st.q.region });
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
      tiles.push(`<div class="pf-tile"><h4>${esc(zone?.name || '')} · ${esc(diffName(st.diff))}</h4>
        <div class="pf-tile-b"><span class="pf-prog">${killed}<small> / ${total}</small></span><span><small>All Stars</small><b>${as ? num(as.points, 0) : '—'}</b></span>
        <span><small>${LL('Mundo', 'World', 'Welt', 'Monde')}</small><b style="color:${rankColor(as?.rankPercent)}">${as ? `#${num0(as.rank)}` : '—'}</b></span>
        <span><small>${esc(regionName(st.q.region))}</small><b style="color:${rankColor(as?.rankPercent)}">${as ? `#${num0(as.regionRank)}` : '—'}</b></span>
        <span><small>${LL('Reino', 'Realm', 'Realm', 'Royaume')}</small><b>${as ? `#${num0(as.serverRank)}` : '—'}</b></span></div></div>`);
    }
    const rio = st.rio;
    if (rio?.season) {
      const ov = rio.ranks?.overall || {};
      const label = String(rio.season.season || '').replace(/^season-/, '').toUpperCase();
      tiles.push(`<div class="pf-tile"><h4>${LL('Mítica+', 'Mythic+', 'Mythisch+', 'Mythique+')} · ${esc(label)}</h4>
        <div class="pf-tile-b"><span><small>${LL('Puntuación', 'Score', 'Wertung', 'Score')}</small><b style="color:${esc(rio.season.segments?.all?.color || 'var(--text)')}">${num(rio.season.scores?.all || 0, 0)}</b></span>
        <span><small>${LL('Mundo', 'World', 'Welt', 'Monde')}</small><b>${ov.world ? `#${num0(ov.world)}` : '—'}</b></span>
        <span><small>${esc(regionName(st.q.region))}</small><b>${ov.region ? `#${num0(ov.region)}` : '—'}</b></span>
        <span><small>${LL('Reino', 'Realm', 'Realm', 'Royaume')}</small><b>${ov.realm ? `#${num0(ov.realm)}` : '—'}</b></span></div></div>`);
    }
    return tiles.join('');
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
        <div class="pf-sub">${guild}<span>${esc(a?.realmName || q.realm)} (${esc(q.region.toUpperCase())})</span></div>
        <div class="pf-cls" style="color:${classColor(cls)}">${esc([a?.race, a?.cls].filter(Boolean).join(' '))}${a?.spec ? ` · ${esc(a.spec)}` : ''}</div></div>
      <div class="pf-tiles">${tilesHTML()}</div>
      <div class="pf-upd"><button type="button" class="btn ghost" data-pf="update" ${st.busy ? 'disabled' : ''}>↻ ${LL('Actualizar', 'Update', 'Aktualisieren', 'Actualiser')}</button>
        <small>${LL('Equipo actualizado', 'Gear updated', 'Ausrüstung aktualisiert', 'Équipement mis à jour')}: <b class="${stale ? 'bad' : ''}">${esc(ago(a?.lastLogin))}</b>${days != null && days > 0 ? ` <span class="muted">(${LL(`${days} d sin actualizar`, `${days} d without update`, `${days} T. ohne Update`, `${days} j sans mise à jour`)})</span>` : ''}</small>
        <small class="muted">${LL('Consultado', 'Fetched', 'Abgerufen', 'Consulté')}: ${esc(ago(st.at))}</small></div></div>`;
  }

  function controlsHTML() {
    const zones = st.zones || [];
    const zone = zones.find((z) => z.id === st.zone);
    const opts = zones.map((z) => `<option value="${z.id}" ${z.id === st.zone ? 'selected' : ''}>${esc(PATCH_OF_ZONE[z.id] ? `${PATCH_OF_ZONE[z.id]} · ${z.name}` : z.name)}</option>`).join('');
    const diffs = (zone?.difficulties || []).filter((d) => [1, 3, 4, 5].includes(d.id)).map((d) => `<button type="button" class="chip ${st.diff === d.id ? 'on' : ''}" data-pf="diff" data-v="${d.id}">${esc(diffName(d.id) || d.name)}</button>`).join('');
    const mets = METRICS.map(([m, l]) => `<button type="button" class="chip ${st.metric === m ? 'on' : ''}" data-pf="metric" data-v="${m}">${l}</button>`).join('');
    return `<div class="pf-ctl"><label>${LL('Parche', 'Patch', 'Patch', 'Patch')}<select data-pf-zone>${opts}</select></label>
      <span class="chips">${diffs}</span><span class="sep"></span><span class="chips">${mets}</span></div>`;
  }

  function tableHTML() {
    if (st.wclErr) return `<div class="empty sm">${esc(st.wclErr)}</div>`;
    const w = st.wcl;
    if (!w) return `<div class="loading"><span class="spinner"></span>${t('loading')}</div>`;
    const zr = w.zoneRankings;
    const zone = (st.zones || []).find((z) => z.id === st.zone);
    if (!zr || !zone) return `<div class="empty sm">${LL('Sin datos para este parche y dificultad.', 'No data for this patch and difficulty.', 'Keine Daten für diesen Patch und diese Schwierigkeit.', 'Aucune donnée pour ce patch et cette difficulté.')}</div>`;
    const byEnc = new Map((zr.rankings || []).map((r) => [r.encounter?.id, r]));
    const kills = (zr.rankings || []).reduce((s, r) => s + (r.totalKills || 0), 0);
    const as = [...(zr.allStars || [])].sort((a, b) => b.points - a.points)[0];
    const unit = zr.metric === 'hps' ? 'HPS' : 'DPS';
    const pct = (v) => (v == null ? '-' : `<b style="color:${parseColor(v)}">${Math.floor(v)}</b>`);
    const rows = zone.encounters.map((e) => {
      const r = byEnc.get(e.id);
      const has = r && r.totalKills > 0;
      const a2 = r?.allStars;
      return `<tr class="${has ? '' : 'none'}"><td class="pf-boss">${esc(e.name)}</td>
        <td>${has ? pct(r.rankPercent) : '-'}</td><td class="n">${has ? num(r.bestAmount, 1) : '-'}</td><td class="n">${has ? r.totalKills : 0}</td>
        <td class="n">${has && r.fastestKill ? clock(r.fastestKill) : '-'}</td><td>${has ? pct(r.medianPercent) : '-'}</td>
        <td class="n">${has && a2 ? num(a2.points, 2) : '-'}</td>
        <td class="n" title="${a2 ? esc(`${num0(a2.total)} ${LL('jugadores', 'players', 'Spieler', 'joueurs')}`) : ''}">${has && a2 ? `<b style="color:${parseColor(a2.rankPercent)}">${num0(a2.rank)}</b>` : '-'}</td>
        <td class="n">${has && a2 ? num0(a2.regionRank) : '-'}</td><td class="n">${has && a2 ? num0(a2.serverRank) : '-'}</td></tr>`;
    }).join('');
    return `<div class="pf-sum"><div><small>${LL('Mejor media', 'Best Perf. Avg', 'Beste Ø-Leistung', 'Meilleure moyenne')}</small><b style="color:${rankColor(zr.bestPerformanceAverage)}">${zr.bestPerformanceAverage != null ? num(zr.bestPerformanceAverage, 1) : '—'}</b></div>
      <div class="pf-sum-r"><span>${LL('Media mediana', 'Median Perf. Avg', 'Median-Ø', 'Moyenne médiane')}: <b style="color:${rankColor(zr.medianPerformanceAverage)}">${zr.medianPerformanceAverage != null ? num(zr.medianPerformanceAverage, 1) : '—'}</b></span>
        <span>${LL('Kills registradas', 'Kills Logged', 'Registrierte Kills', 'Kills enregistrés')}: <b>${kills}</b></span>
        <span>${LL('Puntos All Star', 'All Star Points', 'All-Star-Punkte', 'Points All Star')}: <b>${as ? num(as.points, 2) : '—'}</b>${as ? ` (<b style="color:${rankColor(as.rankPercent)}">${num0(as.rank)}</b>)` : ''}</span></div></div>
      <div class="pf-tbl-w"><table class="pf-table"><thead><tr><th rowspan="2">${LL('Jefe', 'Boss', 'Boss', 'Boss')}</th><th rowspan="2">${LL('Mejor %', 'Best %', 'Bester %', 'Meilleur %')}</th><th rowspan="2">${LL(`${unit} máximo`, `Highest ${unit}`, `Höchstes ${unit}`, `${unit} max.`)}</th><th rowspan="2">Kills</th><th rowspan="2">${LL('Más rápida', 'Fastest', 'Schnellste', 'Plus rapide')}</th><th rowspan="2">${LL('Med.', 'Med', 'Med.', 'Méd.')}</th><th colspan="4">All Stars</th></tr>
        <tr><th>${LL('Puntos', 'Points', 'Punkte', 'Points')}</th><th>${LL('Mundo', 'World', 'Welt', 'Monde')}</th><th>${esc(regionName(st.q.region))}</th><th>${LL('Reino', 'Realm', 'Realm', 'Royaume')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function gearHTML() {
    const a = st.arm;
    if (!a) return st.armErr ? `<div class="empty sm">${esc(st.armErr)}</div>` : `<div class="loading"><span class="spinner"></span>${t('loading')}</div>`;
    const items = [...a.items].filter((i) => !['SHIRT', 'TABARD'].includes(i.slot)).sort((x, y) => SLOT_ORDER.indexOf(x.slot) - SLOT_ORDER.indexOf(y.slot));
    const ilvl = st.rio?.ilvl || a.ilvlEquipped;
    const rows = items.map((it) => {
      const extra = [...it.enchant.map((e) => `<i class="ench">${esc(cleanLine(e))}</i>`), ...it.gems.map((g) => `<i class="gem">${esc(cleanLine(g.name || g.stat || ''))}</i>`)].join('');
      return `<div class="pf-it" style="--q:${QCOLOR[it.quality] || '#fff'}"><span class="arm-ic">${it.icon ? `<img src="${Cards.media(it.icon)}" alt="" loading="lazy">` : ''}</span>
        <span class="pf-itx"><b title="${esc(it.name)}">${esc(it.name)}</b>${extra}</span><em>${esc(it.ilvl || '')}</em></div>`;
    }).join('');
    return `<div class="pf-gear-h"><b>${LL('Equipo', 'Gear', 'Ausrüstung', 'Équipement')}</b><span>${LL('Nivel de objeto', 'Item Level', 'Gegenstandsstufe', 'Niveau d’objet')}: <b>${esc(ilvl || '—')}</b></span></div>${rows}`;
  }

  function render() {
    if (!S.profileOpen || !st.q) return;
    const a = st.arm;
    const model = a?.render ? `<div class="pf-model" data-tilt><img src="${Cards.media(a.render)}" alt="${esc(a.name)}" draggable="false"></div>` : '';
    main.innerHTML = `<div class="pf">
      <div class="pf-back"><button type="button" class="btn ghost sm" data-pf="home">${LL('← Inicio', '← Home', '← Start', '← Accueil')}</button></div>
      ${headerHTML()}
      <div class="pf-grid"><section class="pf-left">${controlsHTML()}${tableHTML()}</section>
        <aside class="pf-right"><div class="pf-gear">${gearHTML()}</div>${model}</aside></div></div>`;
  }

  // ------------------------------------------------------------ formulario de búsqueda (portada)
  function formHTML() {
    const last = lsGet('prof:region') || 'eu';
    const rec = recent();
    return `<form id="pfForm" class="gd-form pf-form"><input name="name" placeholder="${esc(LL('Nombre del personaje', 'Character name', 'Charaktername', 'Nom du personnage'))}" spellcheck="false" autocomplete="off" required>
      <input name="realm" placeholder="${esc(LL('Reino (ej. Zul’jin)', 'Realm (e.g. Zul’jin)', 'Realm (z. B. Zul’jin)', 'Royaume (ex. Zul’jin)'))}" spellcheck="false" autocomplete="off" required>
      <select name="region">${REGIONS.map((r) => `<option value="${r}" ${r === last ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('')}</select>
      <button class="btn primary" type="submit">${LL('Buscar personaje', 'Find character', 'Charakter suchen', 'Chercher le personnage')}</button></form>
      ${rec.length ? `<div class="chips pf-rec">${rec.map((x, i) => `<button type="button" class="chip" data-pf="recent" data-i="${i}">${esc(x.name)} <span class="muted">${esc(x.realm)} · ${esc(x.region.toUpperCase())}</span></button>`).join('')}</div>` : ''}`;
  }

  document.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'pfForm') return;
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const name = String(fd.get('name') || '').trim();
    const realm = String(fd.get('realm') || '').trim();
    const region = String(fd.get('region') || 'eu');
    lsSet('prof:region', region);
    if (name && realm) open({ name, realm, slug: Cards.slugOf(realm), region });
  });

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-pf]');
    if (!el) return;
    const a = el.dataset.pf;
    if (a === 'recent') { const x = recent()[Number(el.dataset.i)]; if (x) open(x); }
    else if (!S.profileOpen) return;
    else if (a === 'update') load();
    else if (a === 'home') goHome();
    else if (a === 'diff') { st.diff = Number(el.dataset.v); st.wcl = null; render(); fetchWcl().then(render); }
    else if (a === 'metric') { st.metric = el.dataset.v; st.wcl = null; render(); fetchWcl().then(render); }
  });
  document.addEventListener('change', (ev) => {
    if (!S.profileOpen || !ev.target.matches?.('[data-pf-zone]')) return;
    st.zone = Number(ev.target.value);
    st.wcl = null;
    render();
    fetchWcl().then(render);
  });

  return { open, render, formHTML, load };
})();
