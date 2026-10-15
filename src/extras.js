'use strict';

// Pestañas extra: Resumen de la banda, Detalle (sanación por objetivo, daño recibido por habilidad…),
// Gráficas, Defensivos, Mecánicas evitables y Mítica+. Se apoyan en las funciones de app.js.
Object.assign(STRINGS.es.tabs, { summary: 'Resumen', detail: 'Sanación recibida', graphs: 'Gráficas', cooldowns: 'Defensivos', mechanics: 'Mecánicas', avoidable: 'Daño evitable', mplus: 'Mítica+' });
Object.assign(STRINGS.en.tabs, { summary: 'Summary', detail: 'Healing received', graphs: 'Graphs', cooldowns: 'Defensives', mechanics: 'Mechanics', avoidable: 'Avoidable damage', mplus: 'Mythic+' });

const Extras = (() => {
  const dur = (f) => fightDur(f);
  const ids = (f) => fightIds(f);
  const rel = (f, ts) => ts - (f.fightStart ?? f.startTime);
  const pct = (v, d = 0) => `${num(v, d)} %`;

  // ============================================================ datos compartidos
  // Resumen de WCL: roles, composición, equipo, estadísticas, talentos
  const sumPlayers = new Map();
  const QCOL = { 0: '#9d9d9d', 1: '#ffffff', 2: '#1eff00', 3: '#0070dd', 4: '#a335ee', 5: '#ff8000', 6: '#e6cc80' };
  const SLOT_L = [[0, 'Cabeza', 'Head'], [1, 'Cuello', 'Neck'], [2, 'Hombros', 'Shoulders'], [14, 'Espalda', 'Back'], [4, 'Pecho', 'Chest'], [8, 'Muñecas', 'Wrists'], [15, 'Mano derecha', 'Main hand']];
  const SLOT_R = [[9, 'Manos', 'Hands'], [5, 'Cintura', 'Waist'], [6, 'Piernas', 'Legs'], [7, 'Pies', 'Feet'], [10, 'Anillo 1', 'Ring 1'], [11, 'Anillo 2', 'Ring 2'], [12, 'Abalorio 1', 'Trinket 1'], [13, 'Abalorio 2', 'Trinket 2'], [16, 'Mano izquierda', 'Off hand']];
  const iconUrl = (ic) => `wcicon://i/${encodeURIComponent(String(ic || '').replace(/\.(jpg|png)$/i, '').toLowerCase())}`;
  function gearSlot(gear, [slot, es, en]) {
    const g = gear.find((x) => x.slot === slot && x.id);
    const lab = S.lang === 'es' ? es : en;
    if (!g) return `<div class="ag-slot empty"><span class="ag-ic"></span><div><small>${lab}</small></div></div>`;
    const col = QCOL[g.quality] || '#fff';
    const noEnch = ENCHANT_SLOTS[slot] && !g.permanentEnchant;
    const ench = g.permanentEnchantName ? `<small class="ag-en">${esc(g.permanentEnchantName.replace(/^Enchant [^-]+- /, ''))}</small>` : (noEnch ? `<small class="ag-no">⚠ ${LL('Sin encantar', 'Unenchanted')}</small>` : '');
    const gems = (g.gems || []).map((x) => `<img src="${iconUrl(x.icon)}" width="16" height="16" alt="">`).join('');
    return `<div class="ag-slot" style="--q:${col}"><span class="ag-ic"><img src="${iconUrl(g.icon)}" width="38" height="38" alt=""><i>${g.itemLevel || ''}</i></span>
      <div><b style="color:${col}">${esc(g.name || '#' + g.id)}</b><small>${lab}${g.itemLevel ? ' · ' + g.itemLevel : ''}</small>${ench}<span class="ag-gems">${gems}</span></div></div>`;
  }
  function playerPanel(p) {
    const ci = p.combatantInfo || {};
    const gear = ci.gear || [];
    const tal = (ci.talentTree || []).filter((t) => t.id);
    const ilv = gear.filter((g) => g.itemLevel > 1 && ![3, 18].includes(g.slot));
    const avg = ilv.length ? ilv.reduce((a, g) => a + g.itemLevel, 0) / ilv.length : 0;
    return `<div class="armory" style="--cc:${classColor(p.type)}">
      <div class="ar-gear"><h4>${LL('Equipo', 'Gear')}${avg ? ` <small>· ${LL('nivel medio', 'average')} ${num(avg, 1)}</small>` : ''}</h4>
        <div class="ag-cols"><div>${SLOT_L.map((x) => gearSlot(gear, x)).join('')}</div><div>${SLOT_R.map((x) => gearSlot(gear, x)).join('')}</div></div></div>
      <div class="ar-tal"><h4>${LL('Talentos usados en este jefe', 'Talents used on this boss')} <small>· ${tal.length}</small></h4>
        <div class="tl-grid">${tal.length ? tal.map((t) => `<span class="tl" data-spell="${t.id}" data-tid="${t.id}"><img src="icons/inv_misc_questionmark.jpg" width="26" height="26" alt="">${t.rank > 1 ? `<em>×${t.rank}</em>` : ''}<b>…</b></span>`).join('') : `<span class="muted">${LL('Este log no incluye talentos de este jugador.', 'This log has no talent data for this player.')}</span>`}</div></div>
    </div>`;
  }
  async function fillTalents(box) {
    const els = [...box.querySelectorAll('.tl[data-tid]')];
    let map = {};
    try { map = (await window.api.talentMap()) || {}; } catch { /* sin mapa */ }
    for (const el of els) {
      const hit = map[el.dataset.tid];
      const b = el.querySelector('b');
      if (!hit) { el.remove(); continue; }
      b.textContent = hit[0];
      if (hit[1]) el.querySelector('img').src = iconUrl(hit[1]);
      if (hit[2]) el.dataset.spell = hit[2];
      el.dataset.sid = hit[2] || '';
    }
    if (S.lang !== 'es') return;
    // nombres en español desde el tooltip del hechizo
    const todo = [...box.querySelectorAll('.tl[data-sid]')].filter((el) => el.dataset.sid);
    for (let i = 0; i < todo.length; i += 6) {
      await Promise.all(todo.slice(i, i + 6).map(async (el) => {
        try {
          const r = await window.api.spellTip(Number(el.dataset.sid), 'es');
          if (r && !r.error && r.name) el.querySelector('b').textContent = r.name;
        } catch { /* se queda el nombre en inglés */ }
      }));
    }
  }
  document.addEventListener('click', (ev) => {
    const row = ev.target.closest?.('.sum-row.clickable');
    if (!row) return;
    const nx = row.nextElementSibling;
    if (nx && nx.classList.contains('armory-wrap')) { nx.remove(); row.classList.remove('open'); return; }
    const p = sumPlayers.get(row.dataset.pid);
    if (!p) return;
    const wrap = document.createElement('div');
    wrap.className = 'armory-wrap';
    wrap.innerHTML = playerPanel(p);
    row.after(wrap);
    row.classList.add('open');
    fillTalents(wrap);
  });

  function rolesData(f) {
    return cached(`roles:${f.key}`, async () => {
      const d = await gql(`query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){
        sum:table(fightIDs:$f,dataType:Summary,startTime:$s,endTime:$e)}}}`, { code: S.code, f: ids(f), s: f.startTime, e: f.endTime });
      const sm = d.reportData.report.sum?.data || {};
      const pd = sm.playerDetails || {};
      const players = new Map();
      for (const [role, key] of [['tank', 'tanks'], ['healer', 'healers'], ['dps', 'dps']]) {
        for (const p of pd[key] || []) players.set(p.id, { ...p, role });
      }
      return { players, itemLevel: sm.itemLevel, composition: sm.composition || [] };
    });
  }

  function graphData(f, type) {
    return cached(`graph:${type}:${f.key}`, async () => {
      const d = await gql(`query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){
        g:graph(fightIDs:$f,dataType:${type},startTime:$s,endTime:$e)}}}`, { code: S.code, f: ids(f), s: f.startTime, e: f.endTime });
      const g = d.reportData.report.g?.data;
      const series = (g?.series || []).filter((s) => isPlayer(s.id) && s.data?.length);
      if (!series.length) return { pts: [], step: 1000, start: f.startTime };
      const n = Math.max(...series.map((s) => s.data.length));
      const step = series[0].pointInterval || 1000;
      const start = series[0].pointStart ?? f.startTime;
      const pts = new Array(n).fill(0);
      for (const s of series) s.data.forEach((v, i) => { pts[i] += (typeof v === 'number' ? v : v?.[1] || 0); });
      return { pts: pts.map((v) => (v * 1000) / step), step, start };
    });
  }

  const smooth = (a, w) => a.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(a.length - 1, i + w); k++) { s += a[k]; c++; }
    return s / c;
  });

  // muertes de jugadores (ligero: solo los eventos de muerte)
  function deathTimes(f) {
    return cached(`dtimes:${f.key}`, async () => (await allEvents(f, 'Deaths')).filter((e) => e.type === 'death' && isPlayer(e.targetID)).sort((a, b) => a.timestamp - b.timestamp));
  }

  // ============================================================ RESUMEN
  const ENCHANT_SLOTS = { 0: ['Cabeza', 'Head'], 2: ['Hombros', 'Shoulders'], 4: ['Pecho', 'Chest'], 6: ['Piernas', 'Legs'], 7: ['Pies', 'Feet'], 10: ['Anillo 1', 'Ring 1'], 11: ['Anillo 2', 'Ring 2'], 15: ['Arma', 'Weapon'] };
  const CONSUMABLES = [
    ['flask', /flask|frasco|phial|vial|ampolla|elixir/i, 'Frasco', 'Flask'],
    ['food', /well fed|bien alimentado|food|comida|feast|banquete|hearty|abundante/i, 'Comida', 'Food'],
    ['rune', /augment|aumento|crystalliz|cristaliz|void-touched|tocado por el vac[ií]o/i, 'Runa', 'Rune'],
    ['pot', /potion|poci[oó]n|tonic|t[oó]nico/i, 'Poción', 'Potion'],
  ];

  function summaryData(f) {
    return cached(`summary:${f.key}`, async () => {
      const roles = await rolesData(f);
      const base = { code: S.code, f: ids(f), s: f.startTime, e: f.endTime };
      const list = [...roles.players.keys()];
      const aliases = list.map((id) => `p${id}:table(fightIDs:$f,dataType:Buffs,targetID:${id},startTime:$s,endTime:$e)`).join(' ');
      const d = await gql(`query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){
        buffs:table(fightIDs:$f,dataType:Buffs,startTime:$s,endTime:$e)
        debuffs:table(fightIDs:$f,dataType:Debuffs,hostilityType:Enemies,startTime:$s,endTime:$e)
        ${aliases}}}}`, base);
      const r = d.reportData.report;
      const per = new Map();
      for (const id of list) per.set(id, r[`p${id}`]?.data?.auras || []);
      return { roles, buffs: r.buffs?.data?.auras || [], debuffs: r.debuffs?.data?.auras || [], buffTime: r.buffs?.data?.totalTime || dur(f), per };
    });
  }

  function consumablesOf(auras, f) {
    const out = {};
    for (const a of auras) {
      for (const [key, re] of CONSUMABLES) {
        if (!re.test(a.name)) continue;
        // frasco, comida y runa deben estar activos al empezar el pull
        const early = key === 'pot' || (a.bands || []).some((b) => b.startTime <= f.startTime + 4000);
        if (early) (out[key] = out[key] || []).push(a);
      }
    }
    return out;
  }

  function coverageList(auras, total, scale, limit) {
    return auras.filter((a) => a.totalUptime > 0 && a.name)
      .map((a) => ({ ...a, cov: Math.min(100, (a.totalUptime / (total * scale)) * 100) }))
      .sort((x, y) => y.cov - x.cov).slice(0, limit);
  }


  // ---- Iconos de rol con estilo del juego (escudo azul, cruz verde, espada roja), dibujados en SVG
  const ROLE_SVG = {
    tank: '<path d="M32 17 45 21v10c0 8-5.500 13-13 17-7.500-4-13-9-13-17V21z" fill="#4a6fb5" stroke="#d9dff0" stroke-width="2"/><path d="M32 17v31c7.500-4 13-9 13-17V21z" fill="#2a4580"/>',
    healer: '<path d="M27 16h10v11h11v10H37v11H27V37H16V27h11z" fill="#3ec96a" stroke="#e6ffe9" stroke-width="1.500"/>',
    dps: '<path d="M46 14 52 12l-2 6-17 22-7-2z" fill="#d6d9e0" stroke="#7b0f12" stroke-width="1.500"/><path d="M26 38l7 2-2 5-4 1-2 4-5-5 4-2 1-4z" fill="#c13a2c" stroke="#3b0a08" stroke-width="1.200"/>',
  };
  const ROLE_BG = { tank: '#1c2a4a', healer: '#103a22', dps: '#4a1214' };
  // Iconos de rol originales de Blizzard (UI-LFG-ICON-ROLES), recortados de la hoja src/roles.png
  const roleIcon = (role) => `<span class="role r-${role}" title="${{ tank: LL('Tanque', 'Tank'), healer: LL('Sanador', 'Healer'), dps: 'DPS' }[role]}"><i class="role-sprite"></i></span>`;

  // ---- Buffos y debuffs de banda por clase: verde si están en el log, rojo si faltan
  const RAID_BUFFS = [
    { kind: 'buff', es: 'Intelecto arcano', en: 'Arcane Intellect', cls: ['Mage'], id: 1459, icon: 'spell_holy_magicalsentry.jpg', re: /intelecto arcano|arcane intellect/i },
    { kind: 'buff', es: 'Palabra de poder: Entereza', en: 'Power Word: Fortitude', cls: ['Priest'], id: 21562, icon: 'spell_holy_wordfortitude.jpg', re: /entereza|fortitude/i },
    { kind: 'buff', es: 'Grito de batalla', en: 'Battle Shout', cls: ['Warrior'], id: 6673, icon: 'ability_warrior_battleshout.jpg', re: /grito de batalla|battle shout/i },
    { kind: 'buff', es: 'Marca de lo salvaje', en: 'Mark of the Wild', cls: ['Druid'], id: 1126, icon: 'spell_nature_regeneration.jpg', re: /marca de lo salvaje|mark of the wild/i },
    { kind: 'buff', es: 'Furia del cielo', en: 'Skyfury', cls: ['Shaman'], id: 462854, icon: 'achievement_raidprimalist_windelemental.jpg', re: /furia del cielo|skyfury/i },
    { kind: 'buff', es: 'Bendición del bronce', en: 'Blessing of the Bronze', cls: ['Evoker'], id: 381748, icon: 'ability_evoker_blessingofthebronze.jpg', re: /bendici[oó]n del bronce|blessing of the bronze/i },
    { kind: 'buff', es: 'Ansia de sangre / Heroísmo', en: 'Bloodlust / Heroism', cls: ['Shaman', 'Mage', 'Evoker', 'Hunter'], id: 2825, icon: 'spell_nature_bloodlust.jpg', re: /ansia de sangre|bloodlust|hero[ií]smo|heroism|distorsi[oó]n temporal|time warp|furia primigenia|primal rage|furia de los aspectos|fury of the aspects/i },
    { kind: 'debuff', es: 'Marca del caos', en: 'Chaos Brand', cls: ['DemonHunter'], id: 1490, icon: 'ability_demonhunter_empowerwards.jpg', re: /marca del caos|chaos brand/i },
    { kind: 'debuff', es: 'Toque místico', en: 'Mystic Touch', cls: ['Monk'], id: 113746, icon: 'ability_monk_sparring.jpg', re: /toque m[ií]stico|mystic touch/i },
    { kind: 'debuff', es: 'Veneno atrófico', en: 'Atrophic Poison', cls: ['Rogue'], id: 392388, icon: 'ability_rogue_nervesofsteel.jpg', re: /veneno atr[oó]fico|atrophic poison/i },
    { kind: 'debuff', es: 'Marca del cazador', en: "Hunter's Mark", cls: ['Hunter'], id: 257284, icon: 'ability_hunter_markedfordeath.jpg', re: /marca del cazador|hunter'?s mark/i },
  ];

  function raidBuffsHTML(sd, classes) {
    const present = (it) => {
      const pool = it.kind === 'buff' ? sd.buffs : sd.debuffs;
      return pool.some((a) => a.guid === it.id || it.re.test(a.name || ''));
    };
    const cards = RAID_BUFFS.map((it) => {
      const ok = present(it);
      const inRaid = it.cls.filter((c) => classes.has(c));
      const provider = it.cls.map((c) => `<span style="color:${classColor(c)}">${esc(className(c))}</span>`).join(' · ');
      const why = ok ? LL('Presente', 'Present') : inRaid.length ? LL('Falta: hay quien lo da pero no se aplicó', 'Missing: a provider is present but it was not applied') : LL('Falta: no hay esa clase en la banda', 'Missing: no provider class in the raid');
      return `<div class="rb ${ok ? 'ok' : 'no'}"><span class="rb-ic" data-spell="${it.id}"><img class="ai" width="34" height="34" src="${abilityIconUrl(it.icon)}" alt=""></span>
        <div><b>${esc(S.lang === 'es' ? it.es : it.en)}</b><small>${provider}</small><small class="rb-st">${ok ? '✓' : '✗'} ${why}</small></div></div>`;
    }).join('');
    const have = RAID_BUFFS.filter(present).length;
    return `<h3 class="sec">${LL('Buffos y debuffs de banda por clase', 'Raid buffs and debuffs by class')} <span class="rb-count">${have}/${RAID_BUFFS.length}</span></h3><div class="rb-grid">${cards}</div>`;
  }

  function alertsHTML(a, n) {
    const rows = [
      [a.flask, LL('Sin frasco al pull', 'No flask at pull')],
      [a.food, LL('Sin comida al pull', 'No food at pull')],
      [a.rune, LL('Sin runa de aumento', 'No augment rune')],
      [a.ench, LL('Equipo sin encantar', 'Unenchanted gear')],
    ].filter(([l]) => l.length);
    if (!rows.length) return `<div class="alerts ok">✓ ${LL('Todos llegaron con frasco, comida, runa y encantamientos.', 'Everyone arrived with flask, food, rune and enchants.')}</div>`;
    return `<div class="alerts"><b>⚠ ${LL('Alertas antes del pull', 'Pre-pull alerts')}</b>${rows.map(([l, t]) => `<div><span class="al-t">${t}</span> <span class="al-n">${l.length}/${n}</span><small>${esc(l.join(', '))}</small></div>`).join('')}</div>`;
  }

  async function raidBuffsView(f) {
    const sd = await summaryData(f);
    const list = [...sd.roles.players.values()];
    if (!list.length) return `<div class="empty">${t('noData')}</div>`;
    return raidBuffsHTML(sd, new Set(list.map((p) => p.type)));
  }

  async function viewSummary(f) {
    const sd = await summaryData(f);
    const { players, itemLevel } = sd.roles;
    const list = [...players.values()];
    if (!list.length) return headerHTML(f, t('tabs.summary')) + `<div class="empty">${t('noData')}</div>`;
    const order = { tank: 0, healer: 1, dps: 2 };
    list.sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
    const nRole = (r) => list.filter((p) => p.role === r).length;
    const byClass = new Map();
    for (const p of list) byClass.set(p.type, (byClass.get(p.type) || 0) + 1);
    const compo = [...byClass.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) =>
      `<span class="chip on cls-chip" style="--cc:${classColor(c)}"><img class="cls-ic" src="${classIconUrl(c)}" width="22" height="22" alt="">${esc(className(c))} <b>×${n}</b></span>`).join('');
    const sub = LL(`<b>${list.length}</b> jugadores · ${nRole('tank')} tanques · ${nRole('healer')} sanadores · ${nRole('dps')} DPS · nivel de objeto medio <b>${num(itemLevel || 0, 1)}</b>`,
      `<b>${list.length}</b> players · ${nRole('tank')} tanks · ${nRole('healer')} healers · ${nRole('dps')} DPS · average item level <b>${num(itemLevel || 0, 1)}</b>`);

    const dot = (ok, label, auras) => `<span class="cons ${ok ? 'ok' : 'no'}" ${ok ? `data-spell="${auras[0].guid}"` : ''} title="${ok ? '' : esc(LL('No detectado', 'Not detected'))}">${esc(label)}</span>`;
    const alerts = { flask: [], food: [], rune: [], ench: [] };
    const rows = list.map((p) => {
      const gear = p.combatantInfo?.gear || [];
      const missing = Object.entries(ENCHANT_SLOTS).filter(([slot]) => {
        const g = gear.find((x) => x.slot === Number(slot));
        return g && g.id && !g.permanentEnchant;
      }).map(([slot, nm]) => { const g = gear.find((x) => x.slot === Number(slot)); return { label: nm[S.lang === 'es' ? 0 : 1], g }; });
      const missTip = missing.map((m) => `<div class="et-row">${m.g?.icon ? `<img src="wcicon://i/${encodeURIComponent(String(m.g.icon).replace(/\.(jpg|png)$/i, '').toLowerCase())}" width="28" height="28" alt="">` : ''}<span><b>${esc(m.label)}</b>${m.g?.name ? `<small>${esc(m.g.name)}</small>` : ''}</span></div>`).join('');
      const missNames = missing.map((m) => m.label);
      const gems = gear.reduce((s, g) => s + (g.gems?.length || 0), 0);
      const ilvls = gear.filter((g) => g.itemLevel > 1 && ![3, 18].includes(g.slot));
      const avg = ilvls.length ? ilvls.reduce((s, g) => s + g.itemLevel, 0) / ilvls.length : 0;
      const cons = consumablesOf(sd.per.get(p.id) || [], f);
      if (!cons.flask) alerts.flask.push(p.name);
      if (!cons.food) alerts.food.push(p.name);
      if (!cons.rune) alerts.rune.push(p.name);
      if (missing.length) alerts.ench.push(`${p.name} (${missNames.join(', ')})`);
      const stats = p.combatantInfo?.stats || {};
      const sec = ['Crit', 'Haste', 'Mastery', 'Versatility'].map((k) => [k, stats[k]?.min]).filter(([, v]) => v);
      const secTxt = sec.sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(' · ');
      const sp = (p.specs && p.specs[0]) || '';
      const me = isMe(p.name);
      sumPlayers.set(String(p.id), p);
      return `<div class="sum-row clickable ${me ? 'me' : ''}" data-pid="${p.id}" title="${esc(LL('Clic para ver talentos y equipo', 'Click to see talents and gear'))}">
        <span class="who">${p.icon && /-/.test(p.icon) ? `<img class="spec-ic-sm" src="${specIconUrl(esc(p.icon))}" width="24" height="24" alt="" style="--cc:${classColor(p.type)}">` : `<img class="spec-ic-sm" src="${classIconUrl(p.type)}" width="24" height="24" alt="" style="--cc:${classColor(p.type)}">`}<b style="color:${classColor(p.type)}">${esc(p.name)}</b></span>
        ${roleIcon(p.role)}
        <span class="ilvl">${avg ? num(avg, 0) : '–'}</span>
        <span class="ench ${missing.length ? 'bad' : 'ok'}">${missing.length ? `⚠ ${LL('Sin encantar', 'Unenchanted')}: ${esc(missNames.join(', '))}<span class="etip"><b>${LL('Piezas sin encantamiento', 'Pieces without an enchant')}</b>${missTip}</span>` : `✓ ${LL('Encantado', 'Enchanted')}`}${gems ? ` · ${gems} ${LL('gemas', 'gems')}` : ''}</span>
        <span class="consrow">${CONSUMABLES.map(([k, , es, en]) => dot(!!cons[k], S.lang === 'es' ? es : en, cons[k])).join('')}</span>
        <span class="stats muted">${esc(secTxt)}</span>
      </div>`;
    }).join('');

    const cov = (arr, total, scale, cls) => coverageList(arr, total, scale, 12).map((a) =>
      `<div class="cov"><span class="covn" data-spell="${a.guid}">${iconImg(a.abilityIcon, 18)} ${esc(a.name)}</span><span class="covbar"><i class="${cls}" style="width:${a.cov}%"></i></span><b>${num(a.cov, 0)}%</b></div>`).join('');
    const bossTime = dur(f);
    const buffsHtml = cov(sd.buffs, sd.buffTime, 1, '');
    const debuffsHtml = cov(sd.debuffs, bossTime, 1, 'bad');
    return headerHTML(f, t('tabs.summary'), sub)
      + `<div class="chips">${compo}</div>
      ${alertsHTML(alerts, list.length)}
      <h3 class="sec">${LL('Jugadores, equipo y consumibles', 'Players, gear and consumables')}</h3>
      <div class="sum-table"><div class="sum-row th"><span>${LL('Jugador', 'Player')}</span><span></span><span>ilvl</span><span>${LL('Encantamientos', 'Enchants')}</span><span>${LL('Consumibles al pull', 'Consumables at pull')}</span><span>${LL('Estadísticas', 'Stats')}</span></div>${rows}</div>
      <p class="foot">${LL('Los consumibles se detectan por el nombre de las auras activas al empezar el pull (frasco, comida y runa) o usadas durante la pelea (poción); si algo no sale, puede ser una aura con otro nombre. Pasa el ratón por una etiqueta verde para ver qué detectó.', 'Consumables are detected from the names of auras active at pull (flask, food and rune) or used during the fight (potion); a miss may just be an aura with a different name. Hover a green tag to see what was detected.')}</p>
      <div class="cov-grid"><div><h3 class="sec">${LL('Cobertura de buffos de la banda', 'Raid buff coverage')}</h3>${buffsHtml || `<div class="empty">${t('noData')}</div>`}</div>
      <div><h3 class="sec">${LL('Debuffs sobre enemigos', 'Debuffs on enemies')}</h3>${debuffsHtml || `<div class="empty">${t('noData')}</div>`}</div></div>`;
  }

  // ============================================================ DETALLE
  function tableBy(f, dataType, viewBy) {
    return cached(`by:${dataType}:${viewBy}:${f.key}`, async () => {
      const d = await gql(`query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){
        t:table(fightIDs:$f,dataType:${dataType},viewBy:${viewBy},startTime:$s,endTime:$e)}}}`, { code: S.code, f: ids(f), s: f.startTime, e: f.endTime });
      return entriesOf(d.reportData.report.t);
    });
  }

  async function viewDetail(f) {
    const mode = S.detailMode || 'healtarget';
    const seconds = dur(f) / 1000;
    const chip = (k, label) => `<button class="chip ${mode === k ? 'on' : ''}" data-action="detail-mode" data-m="${k}">${label}</button>`;
    const bar = `<div class="metricbar">${chip('healtarget', LL('Sanación por objetivo', 'Healing by target'))}${chip('healability', LL('Sanación por habilidad', 'Healing by ability'))}${chip('takenability', LL('Daño recibido por habilidad', 'Damage taken by ability'))}</div>`;
    let body = '';
    let title = '';
    if (mode === 'healtarget') {
      title = LL('Sanación recibida por jugador', 'Healing received by player');
      const rows = (await tableBy(f, 'Healing', 'Target')).filter((e) => isPlayer(e.id, e) && e.total > 0).map((e) => {
        const src = (e.sources || []).filter((x) => x.total > 0).sort((a, b) => b.total - a.total).slice(0, 3);
        const note = src.map((x) => `<span style="color:${classColor(x.type)}">${esc(x.name)}</span> ${num((x.total / e.total) * 100, 0)}%`).join(' · ');
        return { ...playerInfo(e.id, e), total: e.total, rate: e.total / seconds, note, abil: abilList(e.abilities) };
      }).sort((a, b) => b.total - a.total);
      body = rankedList(rows, { clickable: false, unit: 'HPS' });
    } else if (mode === 'healability') {
      title = LL('Sanación por habilidad (toda la banda)', 'Healing by ability (whole raid)');
      body = abilityTable((await tableBy(f, 'Healing', 'Ability')).filter((e) => e.total > 0), seconds, 'heal');
    } else {
      title = LL('Daño recibido por habilidad (toda la banda)', 'Damage taken by ability (whole raid)');
      body = abilityTable((await tableBy(f, 'DamageTaken', 'Ability')).filter((e) => e.total > 0), seconds, 'taken');
    }
    return headerHTML(f, t('tabs.detail'), title) + bar + body;
  }

  function abilityTable(entries, seconds, kind) {
    if (!entries.length) return `<div class="empty">${t('noData')}</div>`;
    const sorted = [...entries].sort((a, b) => b.total - a.total).slice(0, 60);
    const sum = entries.reduce((s, e) => s + e.total, 0);
    const max = sorted[0].total;
    const rows = sorted.map((e, i) => {
      const src = e.actorName || (e.sources || [])[0]?.name || '';
      const hits = e.hitCount ?? null;
      const top = (e.targets || []).slice().sort((a, b) => b.total - a.total).slice(0, 3)
        .map((x) => `<span style="color:${classColor(x.type)}">${esc(x.name)}</span> ${plain(x.total)}`).join(' · ');
      return `<div class="atr"><span class="dnum">${i + 1}</span>
        <span class="ab" data-spell="${e.guid}">${iconImg(e.abilityIcon || e.icon, 22)}${esc(e.name)}${src ? ` <small class="muted">${esc(src)}</small>` : ''}</span>
        <span class="bar"><span class="bar-in" style="width:${(e.total / max) * 100}%;background:${kind === 'heal' ? (CLASSES[e.type || (e.sources || [])[0]?.type] ? classColor(e.type || (e.sources || [])[0]?.type) : '#4ade80') : '#e5484d'}"></span></span>
        <span class="r muted">${hits != null ? hits : ''}</span><span class="r"><b>${plain(e.total)}</b></span><span class="r muted">${num((e.total / sum) * 100, 1)}%</span>
        ${top ? `<span class="atop muted">${top}</span>` : ''}</div>`;
    }).join('');
    return `<div class="atable"><div class="atr th"><span>#</span><span>${LL('Habilidad', 'Ability')}</span><span></span><span class="r">${LL('Golpes', 'Hits')}</span><span class="r">${LL('Total', 'Total')}</span><span class="r">%</span></div>${rows}</div>`;
  }

  // ============================================================ GRÁFICAS
  const chartStore = new Map();

  function chartCanvas(id, title, color) {
    return `<div class="chart"><div class="chart-h"><b>${title}</b><span class="chart-v" id="${id}-v"></span></div><canvas id="${id}" height="150"></canvas></div>`;
  }

  function drawChart(id, f, series, opts) {
    const cv = document.getElementById(id);
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = 150;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const total = dur(f);
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue('--muted').trim() || '#8896b8';
    const line = css.getPropertyValue('--line').trim() || '#2a3b60';
    const padL = 46; const padB = 20; const padT = 8;
    const iw = W - padL - 8; const ih = H - padB - padT;
    const max = Math.max(opts.fixedMax || 0, ...series.map((s) => s.v), 1) * 1.08;
    const X = (ms) => padL + (ms / total) * iw;
    const Y = (v) => padT + ih - (v / max) * ih;
    ctx.font = `11px ${UI_FONT}`; ctx.fillStyle = muted; ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const v = (max / 3) * i; const y = Y(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - 8, y); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.textAlign = 'right'; ctx.fillText(opts.fmt(v), padL - 6, y + 4);
    }
    ctx.textAlign = 'center';
    const tickEvery = total > 600000 ? 120000 : total > 240000 ? 60000 : 30000;
    for (let ms = 0; ms <= total; ms += tickEvery) ctx.fillText(clock(ms), X(ms), H - 5);
    // fases
    ctx.setLineDash([4, 4]);
    for (const p of opts.phases || []) { ctx.strokeStyle = '#7aa7ff88'; ctx.beginPath(); ctx.moveTo(X(p.t), padT); ctx.lineTo(X(p.t), padT + ih); ctx.stroke(); ctx.fillStyle = '#7aa7ff'; ctx.textAlign = 'left'; ctx.fillText(p.name.split(':')[0].trim().slice(0, 18), X(p.t) + 3, padT + 10); }
    ctx.setLineDash([]);
    // serie
    const pts = series.filter((s) => s.t >= 0 && s.t <= total);
    if (pts.length) {
      ctx.beginPath();
      pts.forEach((s, i) => { const x = X(s.t); const y = Y(s.v); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.strokeStyle = opts.color; ctx.lineWidth = 2; ctx.stroke();
      ctx.lineTo(X(pts[pts.length - 1].t), padT + ih); ctx.lineTo(X(pts[0].t), padT + ih); ctx.closePath();
      const gr = ctx.createLinearGradient(0, padT, 0, padT + ih); gr.addColorStop(0, `${opts.color}55`); gr.addColorStop(1, `${opts.color}05`);
      ctx.fillStyle = gr; ctx.fill();
    }
    // muertes
    for (const d of opts.deaths || []) { const x = X(d.t); ctx.fillStyle = '#ff5d5d'; ctx.fillRect(x - 1, padT + ih - 9, 2, 9); }
    chartStore.set(id, { f, series: pts, opts, X, Y, padL, iw, total });
  }

  function chartHover(ev) {
    const cv = ev.target.closest?.('.chart canvas');
    if (!cv) return;
    const c = chartStore.get(cv.id);
    if (!c) return;
    const rect = cv.getBoundingClientRect();
    const ms = ((ev.clientX - rect.left - c.padL) / c.iw) * c.total;
    const out = document.getElementById(`${cv.id}-v`);
    if (ms < 0 || ms > c.total || !c.series.length) { if (out) out.textContent = ''; return; }
    let best = c.series[0];
    for (const s of c.series) if (Math.abs(s.t - ms) < Math.abs(best.t - ms)) best = s;
    if (out) out.textContent = `${clock(best.t)} · ${c.opts.fmt(best.v)}`;
  }
  document.addEventListener('mousemove', chartHover);

  async function viewGraphs(f) {
    S.post = async (seq) => {
      const [dd, hh, tt, deaths] = await Promise.all([graphData(f, 'DamageDone'), graphData(f, 'Healing'), graphData(f, 'DamageTaken'), deathTimes(f).catch(() => [])]);
      if (seq !== S.seq) return;
      const phases = phaseSegments(S.fight).slice(1).map((p) => ({ t: p.start - f.startTime, name: p.name }));
      const dts = deaths.map((d) => ({ t: d.timestamp - f.startTime }));
      const mk = (g) => { const sm = smooth(g.pts, 2); return sm.map((v, i) => ({ t: g.start - f.startTime + i * g.step, v })); };
      const base = { phases, deaths: dts, fmt: (v) => plain(v) };
      drawChart('ch-dps', f, mk(dd), { ...base, color: '#4da3ff' });
      drawChart('ch-hps', f, mk(hh), { ...base, color: '#4ade80' });
      drawChart('ch-tkn', f, mk(tt), { ...base, color: '#ff6b6b' });
      // vida media de la banda a partir de las posiciones/vida del replay
      const hpEl = document.getElementById('ch-hp');
      try {
        const data = await Replay.load(S.fight, (n) => { const e = document.getElementById('ch-hp-v'); if (e) e.textContent = LL(`Descargando… ${n} eventos`, `Downloading… ${n} events`); });
        if (seq !== S.seq) return;
        const diedAt = new Map();
        for (const d of deaths) diedAt.set(d.targetID, d.timestamp);
        const players = [...data.tracks.values()].filter((tk) => tk.kind === 'player');
        const pts = [];
        for (let ms = 0; ms <= dur(f); ms += 1000) {
          const T = f.startTime + ms;
          let sum = 0; let n = 0;
          for (const tk of players) {
            if (diedAt.has(tk.id) && T >= diedAt.get(tk.id)) continue;
            let lo = 0; let hi = tk.t.length - 1;
            if (T < tk.t[0]) continue;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tk.t[mid] <= T) lo = mid; else hi = mid - 1; }
            if (T - tk.t[lo] > 20000 || tk.mx[lo] <= 0 || tk.hp[lo] < 0) continue;
            sum += tk.hp[lo] / tk.mx[lo]; n++;
          }
          if (n) pts.push({ t: ms, v: (sum / n) * 100 });
        }
        drawChart('ch-hp', f, pts, { ...base, color: '#f5b942', fixedMax: 100, fmt: (v) => `${num(v, 0)}%` });
        const e = document.getElementById('ch-hp-v'); if (e) e.textContent = '';
      } catch (e) {
        if (hpEl) hpEl.parentElement.querySelector('.chart-h b').insertAdjacentHTML('afterend', `<small class="muted"> ${LL('sin datos de vida', 'no health data')}</small>`);
      }
    };
    return headerHTML(f, t('tabs.graphs'), LL('Daño, sanación, daño recibido y vida media de la banda a lo largo del pull. Las marcas rojas son muertes; las líneas azules, cambios de fase.', 'Damage, healing, damage taken and average raid health over the pull. Red marks are deaths; blue lines are phase changes.'))
      + chartCanvas('ch-dps', LL('Daño de la banda (por segundo)', 'Raid damage (per second)'))
      + chartCanvas('ch-hps', LL('Sanación de la banda (por segundo)', 'Raid healing (per second)'))
      + chartCanvas('ch-tkn', LL('Daño recibido por la banda (por segundo)', 'Raid damage taken (per second)'))
      + chartCanvas('ch-hp', LL('Vida media de los jugadores vivos', 'Average health of living players'))
      + `<p class="foot">${LL('La vida se calcula con los datos de posición del replay: es una estimación entre golpes recibidos y no incluye a quien ya ha muerto.', 'Health is computed from replay position data: it is an estimate between hits taken and excludes anyone already dead.')}</p>`;
  }

  // ============================================================ DEFENSIVOS
  // [id, nombre, tipo]  raid = de banda, ext = externo, self = personal
  const DEFENSIVES = [
    [62618, 'Power Word: Barrier', 'raid'], [97462, 'Rallying Cry', 'raid'], [51052, 'Anti-Magic Zone', 'raid'], [31821, 'Aura Mastery', 'raid'],
    [98008, 'Spirit Link Totem', 'raid'], [108280, 'Healing Tide Totem', 'raid'], [740, 'Tranquility', 'raid'], [64843, 'Divine Hymn', 'raid'],
    [115310, 'Revival', 'raid'], [388615, 'Restoral', 'raid'], [196718, 'Darkness', 'raid'], [374227, 'Zephyr', 'raid'], [363534, 'Rewind', 'raid'],
    [265202, 'Holy Word: Salvation', 'raid'], [246287, 'Evangelism', 'raid'], [200183, 'Apotheosis', 'raid'], [114052, 'Ascendance', 'raid'],
    [33206, 'Pain Suppression', 'ext'], [47788, 'Guardian Spirit', 'ext'], [102342, 'Ironbark', 'ext'], [116849, 'Life Cocoon', 'ext'],
    [6940, 'Blessing of Sacrifice', 'ext'], [1022, 'Blessing of Protection', 'ext'], [357170, 'Time Dilation', 'ext'], [204018, 'Blessing of Spellwarding', 'ext'],
    [871, 'Shield Wall', 'self'], [12975, 'Last Stand', 'self'], [22812, 'Barkskin', 'self'], [61336, 'Survival Instincts', 'self'],
    [48792, 'Icebound Fortitude', 'self'], [55233, 'Vampiric Blood', 'self'], [48707, 'Anti-Magic Shell', 'self'], [115203, 'Fortifying Brew', 'self'],
    [122278, 'Dampen Harm', 'self'], [122783, 'Diffuse Magic', 'self'], [31850, 'Ardent Defender', 'self'], [86659, 'Guardian of Ancient Kings', 'self'],
    [642, 'Divine Shield', 'self'], [45438, 'Ice Block', 'self'], [186265, 'Aspect of the Turtle', 'self'], [104773, 'Unending Resolve', 'self'],
    [118038, 'Die by the Sword', 'self'], [108271, 'Astral Shift', 'self'], [5277, 'Evasion', 'self'], [31224, 'Cloak of Shadows', 'self'],
    [198589, 'Blur', 'self'], [196555, 'Netherwalk', 'self'], [109304, 'Exhilaration', 'self'], [363916, 'Obsidian Scales', 'self'], [374348, 'Renewing Blaze', 'self'],
    [586, 'Fade', 'self'], [19236, 'Desperate Prayer', 'self'], [47585, 'Dispersion', 'self'], [185311, 'Crimson Vial', 'self'],
  ];
  const DEF_BY_ID = new Map(DEFENSIVES.map(([id, name, kind]) => [id, { name, kind }]));

  function cooldownData(f) {
    return cached(`cds:${f.key}`, async () => {
      const filter = `ability.id in (${DEFENSIVES.map((d) => d[0]).join(',')})`;
      const ev = await allEvents(f, 'Casts', `,filterExpression:"${filter}"`);
      return ev.filter((e) => e.type === 'cast' && !e.fake && isPlayer(e.sourceID));
    });
  }

  // A quién va dirigido un defensivo: un aliado concreto, uno mismo o toda la banda / un área
  function defTarget(ev) {
    if (ev.targetID > 0 && ev.targetID !== ev.sourceID && S.actors.get(ev.targetID)) return { name: actorName(ev.targetID), id: ev.targetID, self: false };
    if (ev.targetID === ev.sourceID) return { name: LL('Sí mismo', 'Self'), id: ev.sourceID, self: true };
    return { name: LL('Toda la banda / zona', 'Whole raid / area'), id: null, self: false };
  }

  async function viewCooldowns(f) {
    const [events, tkn] = await Promise.all([cooldownData(f), graphData(f, 'DamageTaken').catch(() => null)]);
    if (!events.length) return headerHTML(f, t('tabs.cooldowns')) + `<div class="empty">${LL('Nadie usó defensivos de la lista en este intento.', 'Nobody used any of the listed defensives in this pull.')}</div>`;
    const total = dur(f);
    const byAb = new Map();
    for (const e of events) {
      if (!byAb.has(e.abilityGameID)) byAb.set(e.abilityGameID, []);
      byAb.get(e.abilityGameID).push(e);
    }
    const kinds = [['raid', LL('Defensivos de banda', 'Raid cooldowns')], ['ext', LL('Externos', 'Externals')], ['self', LL('Personales', 'Personal')]];
    const tick = total > 600000 ? 120000 : total > 240000 ? 60000 : 30000;
    const ruler = [];
    for (let ms = 0; ms <= total; ms += tick) ruler.push(`<span style="left:${(ms / total) * 100}%">${clock(ms)}</span>`);
    let html = headerHTML(f, t('tabs.cooldowns'), LL(`<b>${events.length}</b> usos de defensivos durante el pull. Pasa el ratón por un icono para ver quién lo usó y cuándo.`, `<b>${events.length}</b> defensive uses during the pull. Hover an icon to see who used it and when.`))
      + `<div class="cd-wrap"><div class="cd-ruler">${ruler.join('')}</div>`;
    if (tkn?.pts.length) {
      const sm = smooth(tkn.pts, 2);
      const mx = Math.max(...sm, 1);
      const path = sm.map((v, i) => `${(((tkn.start - f.startTime + i * tkn.step) / total) * 100).toFixed(2)},${(100 - (v / mx) * 100).toFixed(1)}`).join(' ');
      html += `<div class="cd-spike"><span class="muted">${LL('Daño recibido', 'Damage taken')}</span><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${path}" fill="none" stroke="#ff6b6b" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></div>`;
    }
    for (const [kind, label] of kinds) {
      const items = [...byAb.entries()].filter(([id]) => DEF_BY_ID.get(id)?.kind === kind).sort((a, b) => b[1].length - a[1].length);
      if (!items.length) continue;
      html += `<h3 class="sec">${label}</h3>`;
      for (const [id, evs] of items) {
        const ab = ability(id);
        const nm = ab.name.startsWith('#') ? DEF_BY_ID.get(id).name : ab.name;
        const marks = evs.map((e) => {
          const p = playerInfo(e.sourceID);
          const left = ((e.timestamp - f.startTime) / total) * 100;
          const tg = defTarget(e);
          return `<span class="cdm" style="left:${left}%;--cc:${classColor(p.cls)}" data-spell="${id}" data-spell-extra="${esc(p.name)} → ${esc(tg.name)} · ${clockPrecise(e.timestamp - f.startTime)}">${iconImg(ab.icon, 22)}</span>`;
        }).join('');
        const who = [...new Set(evs.map((e) => playerInfo(e.sourceID).name))].slice(0, 4).join(', ');
        html += `<div class="cd-row"><div class="cd-l" data-spell="${id}">${iconImg(ab.icon, 20)}<span>${esc(nm)} <b>×${evs.length}</b><small class="muted">${esc(who)}</small></span></div><div class="cd-t">${marks}</div></div>`;
      }
    }
    // registro exacto, ordenado por tiempo: cuándo, qué defensivo, quién lo lanzó y sobre quién
    const log = [...events].sort((a, b) => a.timestamp - b.timestamp).map((ev) => {
      const ab = ability(ev.abilityGameID);
      const nm = ab.name.startsWith('#') ? DEF_BY_ID.get(ev.abilityGameID)?.name || ab.name : ab.name;
      const src = playerInfo(ev.sourceID);
      const tg = defTarget(ev);
      const tp = tg.id != null ? playerInfo(tg.id) : null;
      const kind = DEF_BY_ID.get(ev.abilityGameID)?.kind || 'self';
      return `<div class="dl-row"><span class="dl-t">${clockPrecise(ev.timestamp - f.startTime)}</span>
        <span class="dl-ab" data-spell="${ev.abilityGameID}">${iconImg(ab.icon, 24)}<b>${esc(nm)}</b></span>
        <span class="dl-k dl-${kind}">${kind === 'raid' ? LL('Banda', 'Raid') : kind === 'ext' ? LL('Externo', 'External') : LL('Personal', 'Personal')}</span>
        <span class="dl-who"><img class="spec-ic-sm" src="${src.icon && src.icon.includes('-') ? specIconUrl(esc(src.icon)) : classIconUrl(src.cls)}" width="20" height="20" alt="" style="--cc:${classColor(src.cls)}"><b style="color:${classColor(src.cls)}">${esc(src.name)}</b></span>
        <span class="dl-arrow">→</span>
        <span class="dl-to">${tp ? `<img class="spec-ic-sm" src="${tp.icon && tp.icon.includes('-') ? specIconUrl(esc(tp.icon)) : classIconUrl(tp.cls)}" width="20" height="20" alt="" style="--cc:${classColor(tp.cls)}"><b style="color:${classColor(tp.cls)}">${esc(tg.name)}</b>` : `<span class="muted">${esc(tg.name)}</span>`}</span></div>`;
    }).join('');
    html += `</div><h3 class="sec">${LL('Registro exacto de defensivos', 'Exact defensive log')} <span class="rb-count">${events.length}</span></h3>
      <div class="dl-table"><div class="dl-row th"><span>${LL('Tiempo', 'Time')}</span><span>${LL('Defensivo', 'Defensive')}</span><span>${LL('Tipo', 'Type')}</span><span>${LL('Lo lanzó', 'Cast by')}</span><span></span><span>${LL('Sobre', 'On')}</span></div>${log}</div>`;
    return html + `<p class="foot">${LL('Se muestran las habilidades defensivas más habituales (lista propia de WipeTime). Una habilidad que no aparezca puede no estar en la lista o haberse renombrado en este parche.', 'Shows the most common defensive abilities (WipeTime\'s own list). A missing ability may not be on the list or may have been renamed this patch.')}</p>`;
  }

  // ============================================================ MECÁNICAS
  const avoidKey = (f) => `avoid:${f.encounterID || 0}`;
  function avoidMarks(f) { try { return JSON.parse(lsGet(avoidKey(f)) || '{}'); } catch { return {}; } }

  function mechData(f) {
    return cached(`mech:${f.key}`, async () => {
      const [entries, roles] = await Promise.all([tableBy(f, 'DamageTaken', 'Ability'), rolesData(f).catch(() => ({ players: new Map() }))]);
      const tanks = new Set([...roles.players.values()].filter((p) => p.role === 'tank').map((p) => p.name));
      const raidSize = Math.max(1, roles.players.size || 20);
      // la tabla por habilidad solo trae 5 objetivos: pedimos el reparto completo de las 30 habilidades enemigas con más daño
      const hostile = entries.filter((e) => e.total > 0 && !CLASSES[e.actorType || (e.sources || [])[0]?.type]).slice(0, 30);
      const per = new Map();
      for (let i = 0; i < hostile.length; i += 10) {
        const chunk = hostile.slice(i, i + 10);
        const aliases = chunk.map((e) => `a${e.guid}:table(fightIDs:$f,dataType:DamageTaken,abilityID:${e.guid},startTime:$s,endTime:$e)`).join(' ');
        const d = await gql(`query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){${aliases}}}}`, { code: S.code, f: ids(f), s: f.startTime, e: f.endTime });
        for (const e of chunk) per.set(e.guid, entriesOf(d.reportData.report[`a${e.guid}`]).filter((x) => isPlayer(x.id, x) && x.total > 0));
      }
      const list = [];
      for (const e of hostile) {
        const targets = per.get(e.guid) || [];
        const onTanks = targets.filter((x) => tanks.has(x.name)).reduce((s, x) => s + x.total, 0);
        const all = targets.reduce((s, x) => s + x.total, 0) || 1;
        const hitCount = targets.length;
        // heurística: golpea a pocos jugadores y no es sobre todo daño a tanques = probablemente evitable
        const guess = hitCount > 0 && hitCount <= Math.max(4, Math.round(raidSize * 0.4)) && onTanks / all < 0.6;
        list.push({ guid: e.guid, name: e.name, icon: e.abilityIcon, source: e.actorName || (e.sources || [])[0]?.name || '', total: e.total, hits: e.hitCount || 0, targets, hitCount, guess, onTanks: onTanks / all });
      }
      return list.sort((x, y) => y.total - x.total);
    });
  }

  let lastMech = [];
  // Golpes de habilidades evitables a jugadores (para los círculos rojos del replay); los DoT seguidos se agrupan
  function mechEvents(raw) {
    return cached(`mechev:${raw.id}:${lsGet(avoidKey(raw)) || ''}`, async () => {
      const fw = { ...raw, fightStart: raw.startTime, fightEnd: raw.endTime, full: true, key: `${raw.id}:${raw.startTime}-${raw.endTime}`, rangeLabel: '' };
      const list = await mechData(fw);
      const marks = avoidMarks(raw);
      const avoid = list.filter((a) => isAvoidable(a, marks)).map((a) => a.guid);
      if (!avoid.length) return [];
      const out = [];
      for (let i = 0; i < avoid.length; i += 25) {
        const ev = await allEvents(fw, 'DamageTaken', `,filterExpression:"ability.id in (${avoid.slice(i, i + 25).join(',')})"`);
        for (const x of ev) {
          const amount = (x.amount || 0) + (x.absorbed || 0);
          if (x.type === 'damage' && isPlayer(x.targetID) && amount > 0) out.push({ t: x.timestamp, id: x.targetID, aid: x.abilityGameID, amount });
        }
      }
      out.sort((a, b) => a.t - b.t);
      const last = new Map();
      const res = [];
      for (const x of out) {
        const k = `${x.id}:${x.aid}`;
        const prev = last.get(k);
        last.set(k, x.t);
        if (prev != null && x.t - prev < 3000) continue;
        res.push(x);
      }
      return res.slice(0, 600);
    });
  }

  const isAvoidable = (a, marks) => (marks[a.guid] != null ? !!marks[a.guid] : a.guess);

  async function viewMechanics(f) {
    const list = await mechData(f);
    lastMech = list;
    if (!list.length) return headerHTML(f, t('tabs.avoidable')) + `<div class="empty">${t('noData')}</div>`;
    const marks = avoidMarks(f);
    const avoid = list.filter((a) => isAvoidable(a, marks));
    const per = new Map();
    for (const a of avoid) {
      for (const x of a.targets) {
        const key = x.name;
        if (!per.has(key)) per.set(key, { id: x.id, name: key, cls: x.type, icon: x.icon || '', spec: x.icon?.split('-')[1] || '', total: 0, abil: [] });
        const p = per.get(key);
        p.total += x.total;
        p.abil.push([a.name, x.total]);
      }
    }
    const rows = [...per.values()].sort((a, b) => b.total - a.total).slice(0, 25).map((p) => ({
      ...p,
      note: p.abil.sort((x, y) => y[1] - x[1]).slice(0, 2).map(([n, v]) => `${esc(n)} ${plain(v)}`).join(' · '),
    }));
    const tr = list.slice(0, 50).map((a) => {
      const on = isAvoidable(a, marks);
      const explicit = marks[a.guid] != null;
      return `<div class="mrow ${on ? 'avoid' : ''}">
        <span class="ab" data-spell="${a.guid}">${iconImg(a.icon, 22)}${esc(a.name)} <small class="muted">${esc(a.source)}</small></span>
        <span class="r muted">${a.hitCount} ${LL('jug.', 'plr')}</span><span class="r">${plain(a.total)}</span>
        <button class="avbtn ${on ? 'on' : ''} ${explicit ? '' : 'auto'}" data-action="avoid" data-id="${a.guid}" title="${esc(explicit ? LL('Marcada por ti. Pulsa para cambiar.', 'Set by you. Click to toggle.') : LL('Sugerencia automática: golpea a pocos jugadores y no sobre todo a tanques. Pulsa para confirmar o cambiar.', 'Automatic guess: hits few players and mostly not tanks. Click to confirm or change.'))}">${on ? LL('Evitable', 'Avoidable') : LL('Inevitable', 'Unavoidable')}${explicit ? '' : ' ?'}</button></div>`;
    }).join('');
    return headerHTML(f, t('tabs.avoidable'), LL(`<b>${avoid.length}</b> de ${list.length} habilidades enemigas marcadas como evitables`, `<b>${avoid.length}</b> of ${list.length} enemy abilities marked avoidable`))
      + `<div class="mech-grid"><div><h3 class="sec">${LL('Habilidades enemigas', 'Enemy abilities')}</h3><div class="mtable">${tr}</div></div>
      <div><h3 class="sec">${LL('Quién recibió más daño evitable', 'Who took the most avoidable damage')}</h3>${rows.length ? rankedList(rows, { clickable: false }) : `<div class="empty">${LL('No hay habilidades marcadas como evitables.', 'No abilities are marked avoidable.')}</div>`}</div></div>
      <p class="foot">${LL('WCL no indica qué mecánicas se pueden esquivar. WipeTime sugiere (con "?") las que golpean a pocos jugadores y no sobre todo a tanques; tú decides pulsando el botón y se recuerda para este jefe.', 'WCL does not say which mechanics can be dodged. WipeTime suggests (with "?") abilities that hit few players and not mostly tanks; you decide with the button and it is remembered for this boss.')}</p>`;
  }

  // ============================================================ MÍTICA+
  const AFFIXES = { 1: 'Overflowing', 2: 'Skittish', 3: 'Volcanic', 4: 'Necrotic', 5: 'Teeming', 6: 'Raging', 7: 'Bolstering', 8: 'Sanguine', 9: 'Tyrannical', 10: 'Fortified', 11: 'Bursting', 12: 'Grievous', 13: 'Explosive', 14: 'Quaking', 117: 'Reaping', 119: 'Beguiling', 120: 'Awakened', 121: 'Prideful', 122: 'Inspiring', 123: 'Spiteful', 124: 'Storming', 134: 'Entangling', 135: 'Afflicted', 136: 'Incorporeal', 147: "Xal'atath's Guile", 158: 'Voidbound', 159: 'Oblivion' };
  const isKey = (f) => !!(f && f.keystoneLevel);

  function viewMplus(f0) {
    const raw = S.fight;
    if (!isKey(raw)) return headerHTML(f0, t('tabs.mplus')) + `<div class="empty">${LL('Este combate no es una clave de Mítica+.', 'This fight is not a Mythic+ key.')}</div>`;
    const pulls = raw.dungeonPulls || [];
    const total = raw.endTime - raw.startTime;
    const chests = raw.keystoneBonus ? '★'.repeat(raw.keystoneBonus) : LL('Agotada', 'Depleted');
    const aff = (raw.keystoneAffixes || []).map((id) => `<span class="chip">${esc(AFFIXES[id] || `#${id}`)}</span>`).join('');
    const bossIds = new Set([...S.actors.values()].filter((a) => a.subType === 'Boss').map((a) => a.id));
    const cards = pulls.map((p, i) => {
      const mobs = new Map();
      let n = 0;
      for (const m of p.enemyNPCs || []) {
        const c = Math.max(1, (m.maximumInstanceID ?? 1) - (m.minimumInstanceID ?? 1) + 1);
        const nm = actorName(m.id);
        mobs.set(nm, (mobs.get(nm) || 0) + c);
        n += c;
      }
      const boss = (p.enemyNPCs || []).some((m) => bossIds.has(m.id));
      const top = [...mobs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${esc(k)}${v > 1 ? ` ×${v}` : ''}`).join(', ');
      const on = S.range && S.range.fight === raw.id && S.range.phaseIdx === i;
      return `<button class="pullcard ${on ? 'on' : ''} ${boss ? 'boss' : ''}" data-action="range" data-phase="${i}"><b>${boss ? '<img class="wi" src="icons/inv_misc_bone_humanskull_01.jpg" width="16" height="16" alt=""> ' : ''}Pull ${p.id}</b><span class="muted">${clock(p.startTime - raw.startTime)} · ${clock(p.endTime - p.startTime)} · ${n} ${LL('enemigos', 'enemies')}</span><small>${top}</small></button>`;
    }).join('');
    S.post = async () => drawRoute(raw);
    return headerHTML(f0, t('tabs.mplus'), `<b>+${raw.keystoneLevel}</b> · ${chests} · ${clock(total)}`)
      + `<div class="chips">${aff}</div>
      <div class="mp-grid"><div><h3 class="sec">${LL('Ruta', 'Route')}</h3><canvas id="mpRoute" width="640" height="420"></canvas>
      <p class="foot">${LL('Cada círculo es un pull, en el orden en que los hicisteis; el tamaño depende de su duración.', 'Each circle is a pull in the order you did them; size depends on its duration.')}</p></div>
      <div><h3 class="sec">Pulls (${pulls.length})</h3><div class="pulls">${cards}</div>
      <p class="foot">${LL('Pulsa un pull para ver el daño, la sanación y las muertes solo de ese tramo.', 'Click a pull to see damage, healing and deaths for just that stretch.')}</p></div></div>`;
  }

  function drawRoute(raw) {
    const cv = document.getElementById('mpRoute');
    if (!cv) return;
    const pulls = (raw.dungeonPulls || []).filter((p) => p.boundingBox);
    const ctx = cv.getContext('2d');
    const W = cv.width; const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (!pulls.length) return;
    const cs = pulls.map((p) => ({ p, x: (p.boundingBox.minX + p.boundingBox.maxX) / 2, y: (p.boundingBox.minY + p.boundingBox.maxY) / 2 }));
    const minX = Math.min(...cs.map((c) => c.x)); const maxX = Math.max(...cs.map((c) => c.x));
    const minY = Math.min(...cs.map((c) => c.y)); const maxY = Math.max(...cs.map((c) => c.y));
    const pad = 40;
    const sc = Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2) / Math.max(1, maxY - minY));
    const ox = W / 2 - ((minX + maxX) / 2) * sc; const oy = H / 2 + ((minY + maxY) / 2) * sc;
    const P = (c) => [c.x * sc + ox, oy - c.y * sc];
    ctx.fillStyle = 'rgba(8,15,31,.6)'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(122,167,255,.14)'; ctx.lineWidth = 1;
    for (let g = 0; g < W; g += 40) { ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, H); ctx.stroke(); }
    for (let g = 0; g < H; g += 40) { ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(W, g); ctx.stroke(); }
    ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.beginPath(); cs.forEach((c, i) => { const [x, y] = P(c); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]);
    const maxD = Math.max(...pulls.map((p) => p.endTime - p.startTime), 1);
    cs.forEach((c, i) => {
      const [x, y] = P(c);
      const r = 10 + 12 * ((c.p.endTime - c.p.startTime) / maxD);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = 'rgba(77,163,255,.35)'; ctx.fill(); ctx.strokeStyle = '#7aa7ff'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `700 12px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(c.p.id), x, y);
    });
  }

  // ============================================================ EXPORTAR
  function viewRows() {
    const rows = [...document.querySelectorAll('#view .ranked .row')];
    if (rows.length) {
      return [['#', LL('Jugador', 'Player'), LL('Especialización', 'Spec'), 'Parse', LL('Por segundo', 'Per second'), LL('Total', 'Total')],
        ...rows.map((r, i) => [i + 1, r.querySelector('.name')?.textContent, r.querySelector('.spec')?.textContent, r.querySelector('.pill')?.textContent || '', r.querySelector('.rate')?.textContent || '', r.querySelector('.val')?.textContent || ''])];
    }
    const grid = [...document.querySelectorAll('#view .atr, #view .pirow, #view .sum-row, #view .mrow')];
    if (grid.length) return grid.map((r) => [...r.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
    const table = document.querySelector('#view table');
    if (table) return [...table.rows].map((r) => [...r.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
    return [];
  }
  const csvOf = (rows) => '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const wclLink = () => `https://www.warcraftlogs.com/reports/${S.code}${S.fight ? `#fight=${S.fight.id}` : ''}`;
  const wcLink = () => `wipetime://report/${S.code}${S.fight ? `?fight=${S.fight.id}` : ''}`;

  function summaryText() {
    const f = S.fight;
    const rows = viewRows().slice(1, 11);
    const head = `${f.name} · ${diffName(f.difficulty)} · ${fightLabel(f)} · ${clock(fightDur(f))}`;
    const label = t('tabs.' + S.tab);
    return [`WipeTime — ${S.report.title}`, head, `${label}:`, ...rows.map((r) => `${r[0]}. ${r[1]}${r[3] ? ` (${r[3]})` : ''} — ${r[4]}  ${r[5]}`), wclLink()].join('\n');
  }

  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast(msg);
  }

  async function exportPng() {
    document.body.classList.add('capturing');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const m = document.getElementById('main');
    const r = m.getBoundingClientRect();
    const rect = { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(m.scrollWidth), height: Math.ceil(Math.max(m.scrollHeight, r.height)) };
    const name = `${(S.fight?.name || 'wipetime').replace(/[^\w]+/g, '-')}-${S.tab}.png`;
    const res = await window.api.exportPng(rect, name);
    document.body.classList.remove('capturing');
    if (res?.ok) toast(LL('Captura guardada', 'Screenshot saved'));
    else if (res?.error) toast(LL('No se pudo guardar la captura: ', 'Could not save screenshot: ') + res.error);
  }

  function exportMenu(anchor) {
    document.getElementById('exportMenu')?.remove();
    if (!S.report || S.home) return toast(LL('Abre primero un reporte', 'Open a report first'));
    const m = document.createElement('div');
    m.id = 'exportMenu';
    m.className = 'xmenu surface-dark';
    const items = [
      ['png', '<img class="wi" src="icons/inv_misc_eye_01.jpg" width="20" height="20" alt="">', LL('Guardar captura (PNG) de esta vista', 'Save screenshot (PNG) of this view')],
      ['csv', '<img class="wi" src="icons/inv_misc_note_06.jpg" width="20" height="20" alt="">', LL('Guardar tabla como CSV', 'Save table as CSV')],
      ['text', '<img class="wi" src="icons/inv_scroll_11.jpg" width="20" height="20" alt="">', LL('Copiar resumen para Discord', 'Copy summary for Discord')],
      ['wcl', '<img class="wi" src="icons/inv_misc_spyglass_03.jpg" width="20" height="20" alt="">', LL('Copiar enlace de Warcraft Logs', 'Copy Warcraft Logs link')],
    ];
    m.innerHTML = items.map(([k, ic, l]) => `<button type="button" data-x="${k}"><span>${ic}</span>${l}</button>`).join('');
    document.body.appendChild(m);
    const b = anchor.getBoundingClientRect();
    m.style.top = `${b.bottom + 6}px`;
    m.style.right = `${Math.max(8, window.innerWidth - b.right)}px`;
    const close = (ev) => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('mousedown', close, true); } };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
    m.addEventListener('click', async (ev) => {
      const k = ev.target.closest('[data-x]')?.dataset.x;
      if (!k) return;
      m.remove();
      if (k === 'png') exportPng();
      else if (k === 'csv') {
        const rows = viewRows();
        if (!rows.length) return toast(LL('Esta vista no tiene una tabla que exportar', 'This view has no table to export'));
        const res = await window.api.exportText(csvOf(rows), `${(S.fight?.name || 'wipetime').replace(/[^\w]+/g, '-')}-${S.tab}.csv`, 'csv');
        if (res?.ok) toast(LL('CSV guardado', 'CSV saved'));
      } else if (k === 'text') copy(summaryText(), LL('Resumen copiado', 'Summary copied'));
      else if (k === 'wcl') copy(wclLink(), LL('Enlace copiado', 'Link copied'));
    });
  }

  // ============================================================ registro
  VIEWS.summary = viewSummary;
  VIEWS.detail = viewDetail;
  VIEWS.graphs = viewGraphs;
  VIEWS.cooldowns = viewCooldowns;
  VIEWS.avoidable = viewMechanics;
  VIEWS.mechanics = viewMechanics; // MechGuide lo sustituye por la guía
  VIEWS.mplus = viewMplus;

  TABS.length = 0;
  TABS.push('summary', 'damage', 'healing', 'taken', 'detail', 'enemies', 'shields', 'deaths', 'mechanics', 'utility', 'cooldowns', 'buffs', 'debuffs', 'rotation', 'graphs', 'mplus', 'replay');
  window.tabHidden = (k) => (k === 'mplus' && !isKey(S.fight)) || (k === 'replay' && isKey(S.fight));

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action="detail-mode"], [data-action="avoid"], #exportBtn');
    if (!el) return;
    if (el.id === 'exportBtn') { exportMenu(el); return; }
    if (el.dataset.action === 'detail-mode') { S.detailMode = el.dataset.m; render(); return; }
    if (el.dataset.action === 'avoid') {
      const f = S.fight;
      const marks = avoidMarks(f);
      const guid = Number(el.dataset.id);
      const cur = lastMech.find((x) => x.guid === guid);
      const now = marks[guid] != null ? !!marks[guid] : !!cur?.guess;
      marks[guid] = now ? 0 : 1;
      lsSet(avoidKey(f), JSON.stringify(marks));
      render();
    }
  });

  return { roleIcon, raidBuffsView, rolesData, summaryData, deathTimes, graphData, smooth, mechEvents, exportPng, exportMenu, wcLink, wclLink, summaryText, cooldownData, mechData, avoidMarks, isAvoidable, DEF_BY_ID };
})();
