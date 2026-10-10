'use strict';
// Clasificaciones: ranking de parses del intento seleccionado, de los pulls combinados o de todos los intentos del jefe,
// con filtros por clase y rol y distintos órdenes. Un jugador de varios intentos se agrupa (parse medio, DPS/HPS sobre el tiempo total).
(() => {
  Object.assign(STRINGS.es.tabs, { rankings: 'Clasificaciones' });
  Object.assign(STRINGS.en.tabs, { rankings: 'Rankings' });

  const TANK_SPECS = new Set(['Blood', 'Vengeance', 'Guardian', 'Brewmaster', 'Protection']);
  const rk = { scope: 'sel', sort: 'parse-desc', cls: '', metric: 'dmg' };
  const roleOf = (spec) => (HEALER_SPECS.has(spec) ? 'healer' : TANK_SPECS.has(spec) ? 'tank' : 'dps');
  const ROLE_NAME = { tank: ['Tanque', 'Tank'], healer: ['Sanador', 'Healer'], dps: ['DPS', 'DPS'] };

  const rawFight = (x) => ({ ...x, key: `${x.id}:${x.startTime}-${x.endTime}`, full: true, fightStart: x.startTime, fightEnd: x.endTime });

  function scopeFights(f) {
    const raw = S.fight;
    if (rk.scope === 'boss' && raw?.encounterID) {
      return S.fights.filter((x) => x.encounterID === raw.encounterID && x.difficulty === raw.difficulty && !x.keystoneLevel).sort((a, b) => a.startTime - b.startTime);
    }
    const ids = f.ids || [f.id];
    return ids.map((id) => S.fights.find((x) => x.id === id)).filter(Boolean);
  }

  async function collect(list) {
    const by = new Map();
    for (let i = 0; i < list.length; i += 4) {
      await Promise.all(list.slice(i, i + 4).map(async (x) => {
        const pf = rawFight(x);
        const [d, ranks] = await Promise.all([fightData(pf), rankings(pf)]);
        const dur = (x.endTime - x.startTime) / 1000;
        const heal = new Map(d.heal.filter((e) => isPlayer(e.id, e)).map((e) => [e.name, e]));
        for (const e of d.dmg.filter((e) => isPlayer(e.id, e))) {
          const info = playerInfo(e.id, e);
          const role = roleOf(info.spec);
          const key = e.name;
          if (!by.has(key)) by.set(key, { name: e.name, id: e.id, cls: info.cls, spec: info.spec, icon: info.icon, role, ilvl: 0, dmg: 0, heal: 0, boss: 0, time: 0, n: 0, pa: [], pb: [] });
          const r = by.get(key);
          r.dmg += e.total || 0;
          r.boss += (e.targets || []).filter((x) => x.type === 'Boss').reduce((a, x) => a + x.total, 0);
          r.heal += heal.get(e.name)?.total || 0;
          r.time += dur;
          r.n++;
          r.ilvl = Math.max(r.ilvl, e.itemLevel || 0);
          const m = role === 'healer' ? ranks.hps : ranks.dps;
          const mb = role === 'healer' ? ranks.hpsB : ranks.dpsB;
          if (m.has(e.name)) r.pa.push(m.get(e.name));
          if (mb.has(e.name)) r.pb.push(mb.get(e.name));
        }
        for (const e of heal.values()) { // sanadores que no salen en la tabla de daño
          if (by.has(e.name)) continue;
          const info = playerInfo(e.id, e);
          by.set(e.name, { name: e.name, id: e.id, cls: info.cls, spec: info.spec, icon: info.icon, role: roleOf(info.spec), ilvl: e.itemLevel || 0, dmg: 0, heal: e.total || 0, boss: 0, time: dur, n: 1, pa: [], pb: [] });
        }
      }));
    }
    const avg = (a) => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : null);
    return [...by.values()].map((r) => ({ ...r, parse: avg(r.pa), parseIlvl: avg(r.pb), }));
  }

  const METRICS = [['dmg', 'Daño', 'Damage'], ['heal', 'Sanación', 'Healing'], ['boss', 'Daño al jefe', 'Boss damage']];

  async function viewRankings(f) {
    const list = scopeFights(f);
    if (!list.length) return headerHTML(f, t('tabs.rankings')) + `<div class="empty">${t('noData')}</div>`;
    const all = await collect(list);
    const kills = list.filter((x) => x.kill).length;
    const val = (r) => (rk.metric === 'heal' ? r.heal : rk.metric === 'boss' ? r.boss : r.dmg);
    const rows = all.map((r) => ({ ...r, total: val(r), rate: val(r) / Math.max(1, r.time) }));
    const cmp = {
      'parse-desc': (a, b) => (b.parse ?? -1) - (a.parse ?? -1) || b.rate - a.rate,
      'parse-asc': (a, b) => (a.parse ?? 101) - (b.parse ?? 101) || a.rate - b.rate,
      'pilvl-desc': (a, b) => (b.parseIlvl ?? -1) - (a.parseIlvl ?? -1) || b.rate - a.rate,
      'pilvl-asc': (a, b) => (a.parseIlvl ?? 101) - (b.parseIlvl ?? 101) || a.rate - b.rate,
      'rate-desc': (a, b) => b.rate - a.rate,
      'rate-asc': (a, b) => a.rate - b.rate,
      'ilvl-desc': (a, b) => b.ilvl - a.ilvl,
      'ilvl-asc': (a, b) => a.ilvl - b.ilvl,
      name: (a, b) => a.name.localeCompare(b.name, locale()),
    }[rk.sort] || (() => 0);
    const classes = [...new Set(rows.map((r) => r.cls))].sort((a, b) => className(a).localeCompare(className(b), locale()));
    const chip = (attr, v, label, on, extra = '') => `<button class="chip ${on ? 'on' : ''}" data-rk="${attr}" data-v="${esc(v)}" ${extra}>${label}</button>`;
    const sorts = [['parse-desc', LL('Parse ↓ mejor a peor', 'Parse ↓ best to worst')], ['parse-asc', LL('Parse ↑ peor a mejor', 'Parse ↑ worst to best')], ['pilvl-desc', LL('Parse ilvl ↓', 'Parse ilvl ↓')], ['pilvl-asc', LL('Parse ilvl ↑', 'Parse ilvl ↑')], ['rate-desc', LL('Por segundo ↓', 'Per second ↓')], ['rate-asc', LL('Por segundo ↑', 'Per second ↑')], ['ilvl-desc', LL('Nivel de objeto ↓', 'Item level ↓')], ['ilvl-asc', LL('Nivel de objeto ↑', 'Item level ↑')], ['name', 'A–Z']];
    const bar = `<div class="metricbar"><span class="muted">${LL('Clasificación por', 'Rank by')}</span>${METRICS.map(([k, es, en]) => chip('metric', k, LL(es, en), rk.metric === k)).join('')}
      <span class="sep"></span><span class="muted">${LL('Alcance', 'Scope')}</span>
      ${chip('scope', 'sel', f.combined ? LL(`Pulls combinados (${list.length})`, `Combined pulls (${list.length})`) : LL('Este intento', 'This pull'), rk.scope === 'sel')}
      ${S.fight?.encounterID ? chip('scope', 'boss', LL('Todos los intentos del jefe', 'All attempts on this boss'), rk.scope === 'boss') : ''}</div>
      <div class="metricbar"><span class="muted">${LL('Ordenar', 'Sort')}</span>${sorts.map(([k, l]) => chip('sort', k, l, rk.sort === k)).join('')}</div>
      <div class="metricbar"><span class="muted">${LL('Clase', 'Class')}</span>${chip('cls', '', LL('Todas', 'All'), !rk.cls)}${classes.map((c) => chip('cls', c, `<img class="cls-ic" src="${classIconUrl(c)}" width="18" height="18" alt="">${esc(className(c))}`, rk.cls === c, `style="--cc:${classColor(c)}"`)).join('')}</div>`;
    const crown = ['#ffd45c', '#cfd6e0', '#cd8b4a'];
    const unit = rk.metric === 'heal' ? 'HPS' : 'DPS';
    const rowHTML = (r, i, crowns) => {
      const color = classColor(r.cls);
      return `<div class="rk-row ${isMe(r.name) ? 'me' : ''}" ${S.viewCombined ? '' : `data-action="player" data-id="${r.id}"`}>
        <span class="rk-pos" ${crowns && i < 3 ? `style="color:${crown[i]}"` : ''}>${i + 1}</span>
        <span class="rk-who">${r.icon && r.icon.includes('-') ? `<img class="spec-ic-sm" src="${specIconUrl(esc(r.icon))}" width="26" height="26" alt="" style="--cc:${color}">` : `<img class="spec-ic-sm" src="${classIconUrl(r.cls)}" width="26" height="26" alt="" style="--cc:${color}">`}<b style="color:${color}">${esc(r.name)}</b><small>${esc(specName(r.spec) || className(r.cls))}</small></span>
        <span class="rk-il">${r.ilvl ? r.ilvl : '–'}</span>
        <span class="rk-parse">${r.parse != null ? parsePill(r.parse) : '<span class="muted">–</span>'}</span>
        <span class="rk-parse">${r.parseIlvl != null ? parsePill(r.parseIlvl) : '<span class="muted">–</span>'}${r.pa.length > 1 ? `<small class="muted">${LL('media de', 'avg of')} ${r.pa.length}</small>` : ''}</span>
        <span class="rk-rate">${plain(r.rate)}${t('perSec')}</span>
        <span class="rk-tot muted">${big(r.total)}${r.n > 1 ? ` · ${r.n}×` : ''}</span>
      </div>`;
    };
    const head = `<div class="rk-row th"><span>#</span><span>${LL('Jugador', 'Player')}</span><span>ilvl</span><span>Parse</span><span>${LL('Parse ilvl', 'Parse ilvl')}</span><span>${unit}</span><span>${LL('Total', 'Total')}</span></div>`;
    // tres ventanas: DPS arriba, luego tanques y por último sanadores
    const WINS = [['dps', LL('DPS', 'DPS'), 'inv_sword_04'], ['tank', LL('Tanques', 'Tanks'), 'inv_shield_04'], ['healer', LL('Sanadores', 'Healers'), 'spell_holy_flashheal']];
    const wins = WINS.map(([role, title]) => {
      const mine = rows.filter((r) => r.role === role && (!rk.cls || r.cls === rk.cls)).sort(cmp);
      const crowns = rk.sort === 'parse-desc' && !rk.cls;
      return `<section class="rk-win"><h3 class="rk-win-h">${Extras.roleIcon(role)}<span>${title}</span><small class="muted">${mine.length}</small></h3>
        ${mine.length ? `<div class="rk-table">${head}${mine.map((r, i) => rowHTML(r, i, crowns)).join('')}</div>` : `<div class="empty sm">${t('noData')}</div>`}</section>`;
    }).join('');
    const note = kills ? '' : `<p class="foot">${LL('Estos intentos son wipes: Warcraft Logs solo calcula parses en kills. Ordena por "Por segundo".', 'These pulls are wipes: Warcraft Logs only computes parses on kills. Sort by "Per second".')}</p>`;
    return headerHTML(f, t('tabs.rankings'), LL(`<b>${rows.length}</b> jugadores · ${list.length} ${list.length === 1 ? 'intento' : 'intentos'} (${kills} kill${kills === 1 ? '' : 's'})`, `<b>${rows.length}</b> players · ${list.length} ${list.length === 1 ? 'pull' : 'pulls'} (${kills} kill${kills === 1 ? '' : 's'})`))
      + bar + wins + note
      + `<p class="foot">${LL('El parse es siempre el de tu rol (daño para DPS y tanques, sanación para sanadores); con varios intentos es la media de los kills y lo "por segundo" se calcula sobre el tiempo total jugado.', 'Parse always reflects your role (damage for DPS and tanks, healing for healers); with several pulls it is the kills\' average and per-second uses the total time played.')}</p>`;
  }

  VIEWS.rankings = viewRankings;
  COMBINABLE.add('rankings');

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest?.('[data-rk]');
    if (!el) return;
    rk[el.dataset.rk] = el.dataset.v;
    render();
  });
})();
