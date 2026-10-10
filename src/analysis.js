'use strict';

// Analizador: compara el perfil de un jugador (habilidades, tiempos, buffos, muertes) con una lista de
// perfiles de referencia. La referencia son los mejores de su especialización en ese boss (ranking
// público de Warcraft Logs) o los logs que el usuario añada en "Comparar logs". Mismo motor para ambos.
const Analysis = (() => {
  const L = (es, en) => (S.lang === 'es' ? es : en);
  const TOP_K = 5;
  const BENCH_TTL = 24 * 3600 * 1000;
  const WIPE_CLUSTER = 8; // 8+ muertes en 10 s = wipe general: no es un fallo individual
  const WIPE_WINDOW_MS = 10000;
  const fmt = (v, d = 1) => num(v, d);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const pct = (v) => `${num(v * 100, 0)} %`;
  const safeWord = (s) => /^[A-Za-z]+$/.test(s || '');

  // ------------------------------------------------------------ datos de un jugador en un log
  async function pagedEvents(code, fight, type, extra) {
    const out = [];
    let start = fight.startTime;
    for (let page = 0; page < 12; page++) {
      const d = await gql(`query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){
        events(fightIDs:$f,startTime:$s,endTime:$e,dataType:${type},limit:10000${extra}){data nextPageTimestamp}}}}`,
      { code, f: [fight.id], s: start, e: fight.endTime });
      const ev = d.reportData.report.events;
      out.push(...(ev?.data || []));
      if (!ev?.nextPageTimestamp || ev.nextPageTimestamp <= start) break;
      start = ev.nextPageTimestamp;
    }
    return out;
  }

  // Lanzamientos de hechizos que no aparecen en la tabla (p. ej. de objetos): se busca su nombre e icono
  async function fillUnknownAbilities(abilities, casts) {
    const counts = new Map();
    for (const [, g] of casts) if (!abilities[g]) counts.set(g, (counts.get(g) || 0) + 1);
    const unknown = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (!unknown.length) return;
    let data = {};
    try {
      const aliases = unknown.map(([g]) => `a${Number(g)}:ability(id:${Number(g)}){name icon}`).join(' ');
      data = (await gql(`{gameData{${aliases}}}`)).gameData || {};
    } catch (e) { console.warn('abilities', e); }
    for (const [g, n] of unknown) {
      const a = data[`a${Number(g)}`];
      abilities[g] = { name: a?.name || `#${g}`, icon: a?.icon || '', amount: 0, hits: 0, casts: n, over: 0 };
    }
  }

  const specOfIcon = (icon) => {
    const [cls, spec] = (icon || '').split('-');
    return { cls: cls || '', spec: spec || '' };
  };

  function fetchProfile({ code, fight, actor, metric }) {
    const key = `prof:${code}:${fight.id}:${actor.id}:${metric}:${S.lang}`;
    const build = async () => {
      const ty = metric === 'hps' ? 'Healing' : 'DamageDone';
      const pid = Number(actor.id);
      const d = await gql(`query($c:String!,$f:[Int],$p:Int,$s:Float,$e:Float){reportData{report(code:$c){
        all:table(fightIDs:$f,dataType:${ty},startTime:$s,endTime:$e)
        ab:table(fightIDs:$f,dataType:${ty},sourceID:$p,viewBy:Ability,startTime:$s,endTime:$e)
        cast:table(fightIDs:$f,dataType:Casts,sourceID:$p,startTime:$s,endTime:$e)
        buff:table(fightIDs:$f,dataType:Buffs,sourceID:$p,startTime:$s,endTime:$e)
        tk:table(fightIDs:$f,dataType:DamageTaken,startTime:$s,endTime:$e)}}}`,
      { c: code, f: [fight.id], p: pid, s: fight.startTime, e: fight.endTime });
      const r = d.reportData.report;
      const dur = fight.endTime - fight.startTime;
      const me = entriesOf(r.all).find((e) => e.id === pid) || {};
      const abilities = {};
      for (const e of entriesOf(r.ab)) {
        abilities[e.guid] = { name: e.name, icon: e.abilityIcon, amount: e.total || 0, hits: (e.hitCount || 0) + (e.tickCount || 0), casts: 0, over: e.overheal || 0 };
      }
      for (const e of entriesOf(r.cast)) {
        const a = abilities[e.guid] || (abilities[e.guid] = { name: e.name, icon: e.abilityIcon, amount: 0, hits: 0, casts: 0, over: 0 });
        a.casts = e.total || 0;
        if (!a.icon) a.icon = e.abilityIcon;
      }
      const buffs = {};
      for (const a of r.buff?.data?.auras || []) buffs[a.guid] = { name: a.name, icon: a.abilityIcon, uptime: a.totalUptime || 0, uses: a.totalUses || 0 };
      const [castEv, deathEv] = await Promise.all([
        pagedEvents(code, fight, 'Casts', `,sourceID:${pid}${HEALER_SPECS.has(actor.spec) ? ',includeResources:true' : ''}`),
        pagedEvents(code, fight, 'Deaths', ''),
      ]);
      const casts = castEv.filter((e) => e.type === 'cast' && !e.fake).map((e) => [e.timestamp - fight.startTime, e.abilityGameID]);
      await fillUnknownAbilities(abilities, casts);
      // maná del sanador a lo largo de la pelea (porcentaje en cada lanzamiento) y coste medio por minuto
      let mana = null;
      let manaPerMin = 0;
      if (HEALER_SPECS.has(actor.spec)) {
        const pts = [];
        let cost = 0;
        let mx = 0;
        for (const e of castEv) {
          const rs = (e.classResources || []).find((x) => x.type === 0);
          if (!rs || !(rs.max > 0) || e.resourceActor !== 1) continue;
          pts.push([e.timestamp - fight.startTime, (rs.amount / rs.max) * 100]);
          mx = Math.max(mx, rs.max);
          if (e.type === 'cast' && !e.fake && rs.cost) cost += rs.cost;
        }
        const step = Math.max(1, Math.ceil(pts.length / 500));
        mana = pts.filter((_, i) => i % step === 0);
        manaPerMin = mx > 0 ? (cost / mx) * 100 / (dur / 60000) : 0;
      }
      const takenMe = entriesOf(r.tk).find((e) => e.id === pid);
      return {
        code, fightId: fight.id, name: actor.name, cls: actor.cls, spec: actor.spec, icon: actor.icon, metric,
        encounterID: fight.encounterID, kill: !!fight.kill, bossPct: fight.fightPercentage ?? null, difficulty: fight.difficulty,
        durationMs: dur, activeMs: me.activeTime || 0, total: me.total || 0, rate: (me.total || 0) / (dur / 1000),
        abilities, buffs,
        casts, mana, manaPerMin, takenTotal: takenMe?.total || 0,
        phases: (fight.phaseTransitions || []).map((p) => ({ id: p.id, t: p.startTime - fight.startTime })),
        deaths: ownDeaths(deathEv, pid, fight),
      };
    };
    // Si la API falla a medias, el perfil sale vacío (0 de daño, sin lanzamientos): se reintenta y, si sigue vacío,
    // se avisa en vez de guardar un resultado falso en la caché.
    return cached(key, async () => {
      let prof = await build();
      if (!prof.total && !prof.casts.length) prof = await build();
      if (!prof.total && !prof.casts.length) throw new Error('EMPTY_PROFILE');
      return prof;
    });
  }

  // Muertes propias; en un wipe se descartan las que forman parte de la muerte general de la banda.
  function ownDeaths(events, pid, fight) {
    const all = events.filter((e) => e.type === 'death').map((e) => e.timestamp - fight.startTime);
    return events.filter((e) => e.type === 'death' && e.targetID === pid).map((e) => e.timestamp - fight.startTime)
      .filter((ms) => fight.kill || all.filter((x) => Math.abs(x - ms) <= WIPE_WINDOW_MS).length < WIPE_CLUSTER);
  }

  // ------------------------------------------------------------ los mejores de la especialización
  async function topProfiles(raw, p, metric, onProgress) {
    const lvl = raw.keystoneLevel || 0; // Mítica+: se compara con los mejores de tu mismo nivel de llave
    if (!safeWord(p.cls) || !safeWord(p.spec) || !raw.encounterID || !(raw.difficulty || lvl)) return [];
    const key = `bench:v4:${raw.encounterID}:${lvl ? 'k' + lvl : raw.difficulty}:${p.cls}:${p.spec}:${metric}:${S.lang}`;
    try {
      const saved = JSON.parse(lsGet(key) || 'null');
      if (saved && Date.now() - saved.at < BENCH_TTL && saved.profiles?.length) return saved.profiles;
    } catch { /* se vuelve a calcular */ }

    const rankQ = (args) => gql(`{worldData{encounter(id:${Number(raw.encounterID)}){p:characterRankings(className:"${p.cls}",specName:"${p.spec}",${args}metric:${metric},page:1)}}}`);
    let list;
    if (lvl) {
      const zb = (await gql(`{worldData{encounter(id:${Number(raw.encounterID)}){zone{brackets{min bucket type}}}}}`).catch(() => null))?.worldData?.encounter?.zone?.brackets;
      const idx = zb && zb.type === 'Keystone Level' ? Math.floor((lvl - zb.min) / (zb.bucket || 1)) + 1 : 0;
      list = idx > 0 ? (await rankQ(`bracket:${idx},`)).worldData?.encounter?.p?.rankings || [] : [];
      if (!list.length) list = (await rankQ('')).worldData?.encounter?.p?.rankings || [];
    } else {
      list = (await rankQ(`difficulty:${Number(raw.difficulty)},`)).worldData?.encounter?.p?.rankings || [];
    }
    const out = [];
    for (let i = 0; i < list.length && out.length < TOP_K; i++) {
      const r = list[i];
      onProgress?.(out.length, TOP_K);
      try {
        const m = await gql(`query($c:String!,$f:[Int]){reportData{report(code:$c){
          masterData{actors(type:"Player"){id name server}}
          fights(fightIDs:$f){id startTime endTime encounterID kill difficulty fightPercentage}}}}`, { c: r.report.code, f: [r.report.fightID] });
        const rep = m.reportData.report;
        const actor = rep.masterData.actors.find((a) => a.name === r.name && (!r.server?.name || !a.server || a.server === r.server.name))
          || rep.masterData.actors.find((a) => a.name === r.name);
        const fight = rep.fights[0];
        if (!actor || !fight) continue;
        const prof = await fetchProfile({ code: r.report.code, fight, actor: { id: actor.id, name: r.name, cls: p.cls, spec: p.spec, icon: `${p.cls}-${p.spec}` }, metric });
        out.push({ ...prof, label: `Top ${out.length + 1}`, rankName: r.name, rankAmount: r.amount });
      } catch (e) { console.warn('top', r.name, e); }
    }
    if (out.length) {
      try {
        for (let i = 0; i < localStorage.length; i++) { // no acumular cachés eternamente
          const k = localStorage.key(i);
          if (k && k.startsWith('bench:') && k !== key && Date.now() - (JSON.parse(localStorage.getItem(k) || '{}').at || 0) > BENCH_TTL) localStorage.removeItem(k);
        }
      } catch { /* sin limpieza */ }
      lsSet(key, JSON.stringify({ at: Date.now(), profiles: out }));
    }
    return out;
  }

  // ------------------------------------------------------------ motor de comparación
  const timesOf = (p, g) => p.casts.filter((c) => String(c[1]) === String(g)).map((c) => c[0]);

  function analyze(M, O, opts = {}) {
    const durM = M.durationMs / 60000;
    const all = [M, ...O];
    const guids = new Set();
    for (const p of all) for (const g of Object.keys(p.abilities)) guids.add(g);
    const info = (g) => { for (const p of all) if (p.abilities[g]?.name) return { name: p.abilities[g].name, icon: p.abilities[g].icon }; return { name: `#${g}`, icon: '' }; };
    const rateOf = (p, g) => (p.abilities[g]?.casts || 0) / (p.durationMs / 60000);

    const rows = [];
    for (const g of guids) {
      const castsAll = all.map((p) => p.abilities[g]?.casts || 0);
      if (Math.max(...castsAll) < 2) continue;
      const rM = rateOf(M, g);
      const rOs = O.map((p) => rateOf(p, g));
      const perCast = O.map((p) => { const a = p.abilities[g]; return a && a.casts ? a.amount / a.casts : 0; }).filter((x) => x > 0);
      rows.push({
        guid: g, ...info(g), rM, rOs, rO: avg(rOs),
        castsM: M.abilities[g]?.casts || 0, castsOs: O.map((p) => p.abilities[g]?.casts || 0),
        perCastO: avg(perCast), shareM: (M.abilities[g]?.amount || 0) / (M.total || 1),
        shareO: avg(O.map((p) => (p.abilities[g]?.amount || 0) / (p.total || 1))),
        timesM: timesOf(M, g), timesOs: O.map((p) => timesOf(p, g)),
      });
    }

    const tips = [];
    const good = [];
    const isCd = (r) => avg([r.castsM, ...r.castsOs]) <= 15 && Math.max(r.rO, r.rM) <= 2.5;

    for (const r of rows) {
      const missing = (r.rO - r.rM) * durM;
      if (r.castsM === 0 && r.rO >= 0.2 && r.castsOs.filter((c) => c > 0).length >= Math.ceil(O.length / 2)) {
        tips.push({ kind: 'missing', row: r, impact: 0.2, sev: 'low' });
      } else if (r.rO >= 0.35 && r.rM < r.rO * 0.8 && missing >= 1.5) {
        const impact = ((r.perCastO * missing) / (M.total || 1)) * 100;
        tips.push({ kind: isCd(r) ? 'cd' : 'rate', row: r, missing, impact, sev: impact >= 2.5 ? 'high' : impact >= 1 || r.shareO >= 0.05 ? 'mid' : 'low' });
      } else if (isCd(r) && r.castsM > 0 && r.rO >= 0.2) {
        // uso tardío del primer cooldown aunque lo lances las veces que toca
        const firsts = r.timesOs.map((t0) => t0[0]).filter((x) => x != null).sort((a, b) => a - b);
        const medFirst = firsts[Math.floor(firsts.length / 2)];
        if (medFirst != null && r.timesM[0] - medFirst > 12000) {
          tips.push({ kind: 'late', row: r, medFirst, impact: 0.6, sev: 'low' });
        }
      }
      if (r.rM >= 1.0 && r.rO <= r.rM * 0.15 && (r.rM - r.rO) * durM >= 3) {
        tips.push({ kind: 'over', row: r, impact: 0.1, sev: 'low' });
      }
      if (r.rO >= 0.5 && r.rM >= r.rO * 0.9 && r.rM <= r.rO * 1.2) good.push({ kind: 'rate', row: r, w: r.shareO });
    }

    const actM = M.activeMs / M.durationMs;
    const actO = avg(O.map((p) => p.activeMs / p.durationMs));
    if (actO > 0 && actO - actM >= 0.04) tips.push({ kind: 'active', actM, actO, impact: (actO - actM) * 100 * 0.8, sev: actO - actM >= 0.08 ? 'high' : 'mid' });
    else if (actO > 0 && actM >= actO - 0.01) good.push({ kind: 'active', actM, actO, w: 1 });

    const selfGuids = new Set(rows.map((r) => r.guid));
    for (const g of new Set(all.flatMap((p) => Object.keys(p.buffs)))) {
      if (!selfGuids.has(g)) continue;
      const upO = avg(O.map((p) => (p.buffs[g]?.uptime || 0) / p.durationMs));
      const upM = (M.buffs[g]?.uptime || 0) / M.durationMs;
      const bi = (M.buffs[g] || O.map((p) => p.buffs[g]).find(Boolean));
      if (upO >= 0.35 && upM <= upO - 0.15) tips.push({ kind: 'buff', guid: g, name: bi.name, icon: bi.icon, upM, upO, impact: (upO - upM) * 10, sev: upO - upM >= 0.3 ? 'high' : 'mid' });
    }

    if (M.deaths.length) {
      const first = M.deaths[0];
      tips.push({ kind: 'death', times: M.deaths, left: 1 - first / M.durationMs, othersDeaths: avg(O.map((p) => p.deaths.length)), impact: 50, sev: first < M.durationMs * 0.8 ? 'high' : 'mid' });
    }
    if (M.rate >= avg(O.map((p) => p.rate)) * 0.97) good.push({ kind: 'rate-total', w: 2 });

    tips.sort((a, b) => b.impact - a.impact);
    // misma habilidad con dos identificadores (p. ej. el lanzamiento y su copia "falsa" de Warcraft Logs): una sola tarjeta
    const seen = new Set();
    const uniq = tips.filter((tp) => {
      const nm = tp.row ? tp.row.name : tp.name;
      if (!nm) return true;
      const k = `${tp.kind}:${String(nm).toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    tips.splice(0, tips.length, ...uniq);
    good.sort((a, b) => b.w - a.w);

    const cds = rows.filter(isCd).sort((a, b) => b.shareO + b.shareM - (a.shareO + a.shareM) || b.rO - a.rO).slice(0, 8);
    const table = [...rows].sort((a, b) => Math.max(b.shareO, b.shareM) - Math.max(a.shareO, a.shareM) || b.rO - a.rO).slice(0, 14);

    return {
      M, O, tips, good, cds, table, rows, durM, actM, actO,
      rateO: avg(O.map((p) => p.rate)), cpmM: M.casts.length / durM, cpmO: avg(O.map((p) => p.casts.length / (p.durationMs / 60000))),
      deathsO: avg(O.map((p) => p.deaths.length)), labels: opts.labels || O.map((p, i) => p.label || `Log ${i + 2}`),
      whoWord: opts.whoWord || L('los mejores', 'the best'),
    };
  }

  // ------------------------------------------------------------ dibujo
  const ic = (icon, size = 22, title = '', spell = null) => iconImg(icon, size, title, spell);
  const tp = (ms, title = '') => `<span class="tpill" title="${esc(title || clockPrecise(ms))}">${clock(ms)}</span>`;
  const timeList = (arr, max = 8) => (arr.length
    ? arr.slice(0, max).map((x) => tp(x)).join('') + (arr.length > max ? `<span class="tmore">+${arr.length - max}</span>` : '')
    : `<span class="tnone">${L('nunca', 'never')}</span>`);

  function timesBlock(a, r) {
    const rowsHtml = [`<div class="trow me"><span class="tl">${L('Tú', 'You')}</span>${timeList(r.timesM)}</div>`];
    a.O.forEach((p, i) => {
      rowsHtml.push(`<div class="trow"><span class="tl" title="${esc(p.name)}">${esc(a.labels[i])}</span>${timeList(r.timesOs[i])}</div>`);
    });
    const shown = rowsHtml.slice(0, 4).join('');
    const rest = rowsHtml.slice(4).join('');
    return `<div class="tip-times">${shown}${rest ? `<details><summary>${L('Ver los demás', 'See the rest')} (${rowsHtml.length - 4})</summary>${rest}</details>` : ''}</div>`;
  }

  function tipHTML(tip, a) {
    const who = a.whoWord;
    let title = '';
    let text = '';
    let icon = '';
    let extra = '';
    const r = tip.row;
    if (tip.kind === 'rate') {
      icon = ic(r.icon, 34, '', r.guid);
      title = L(`Lanza más ${r.name}`, `Cast ${r.name} more`);
      text = L(`Lo lanzas ${fmt(r.rM)} veces por minuto y ${who} ${fmt(r.rO)}. Son unos <b>${Math.round(tip.missing)} lanzamientos menos</b> en esta pelea${tip.impact >= 0.3 ? ` (≈ ${fmt(tip.impact)} % más de tu ${a.M.metric === 'hps' ? 'sanación' : 'daño'})` : ''}.`,
        `You cast it ${fmt(r.rM)} times per minute and ${who} ${fmt(r.rO)}. That is about <b>${Math.round(tip.missing)} fewer casts</b> this fight${tip.impact >= 0.3 ? ` (≈ ${fmt(tip.impact)} % more ${a.M.metric === 'hps' ? 'healing' : 'damage'})` : ''}.`);
      extra = timesBlock(a, r);
    } else if (tip.kind === 'cd') {
      icon = ic(r.icon, 34, '', r.guid);
      title = L(`Aprovecha mejor ${r.name}`, `Use ${r.name} better`);
      text = L(`Lo usaste <b>${r.castsM}</b> ${r.castsM === 1 ? 'vez' : 'veces'}; de media ${who} lo usan <b>${fmt(avg(r.castsOs))}</b>. Cada vez que está disponible y no lo lanzas, pierdes ese bonus.`,
        `You used it <b>${r.castsM}</b> time${r.castsM === 1 ? '' : 's'}; on average ${who} use it <b>${fmt(avg(r.castsOs))}</b>. Every time it is ready and you don't cast it, you lose that bonus.`);
      extra = timesBlock(a, r);
    } else if (tip.kind === 'missing') {
      icon = ic(r.icon, 34, '', r.guid);
      title = L(`${who[0].toUpperCase() + who.slice(1)} usan ${r.name} y tú no`, `${who[0].toUpperCase() + who.slice(1)} use ${r.name} and you don't`);
      text = L(`No lo usaste en toda la pelea y ${who} lo lanzan <b>${fmt(avg(r.castsOs))}</b> veces de media. Puede que tengas otro talento o sea una habilidad de raza distinta; si lo tienes disponible, úsalo.`,
        `You did not use it all fight and ${who} cast it <b>${fmt(avg(r.castsOs))}</b> times on average. You may have a different talent or race; if you have it available, use it.`);
      extra = timesBlock(a, r);
    } else if (tip.kind === 'late') {
      icon = ic(r.icon, 34, '', r.guid);
      title = L(`Usa antes ${r.name}`, `Use ${r.name} earlier`);
      text = L(`Tu primer uso fue a los <b>${clock(r.timesM[0])}</b>; ${who} lo lanzan hacia los <b>${clock(tip.medFirst)}</b>. Usarlo antes te deja volver a usarlo más veces.`,
        `Your first use was at <b>${clock(r.timesM[0])}</b>; ${who} cast it around <b>${clock(tip.medFirst)}</b>. Using it earlier lets you cast it more times.`);
      extra = timesBlock(a, r);
    } else if (tip.kind === 'over') {
      icon = ic(r.icon, 34, '', r.guid);
      title = L(`Revisa tu uso de ${r.name}`, `Check your use of ${r.name}`);
      text = L(`Lo lanzas ${fmt(r.rM)} veces por minuto y ${who} casi no lo usan (${fmt(r.rO)}). Puede que estés gastando tiempo o recursos que otra habilidad aprovecharía mejor.`,
        `You cast it ${fmt(r.rM)} times per minute and ${who} barely use it (${fmt(r.rO)}). You may be spending time or resources another ability would use better.`);
    } else if (tip.kind === 'active') {
      icon = '<span class="tip-emoji">⏱</span>';
      title = L('Pasas más tiempo sin atacar', 'You spend more time not attacking');
      text = L(`Estuviste activo el <b>${pct(tip.actM)}</b> del tiempo y ${who} el <b>${pct(tip.actO)}</b>. Intenta moverte menos entre ataques y usar habilidades que puedas lanzar en movimiento.`,
        `You were active <b>${pct(tip.actM)}</b> of the time and ${who} <b>${pct(tip.actO)}</b>. Try to move less between attacks and use abilities you can cast while moving.`);
    } else if (tip.kind === 'buff') {
      icon = ic(tip.icon, 34, '', tip.guid);
      title = L(`Mantén ${tip.name} más tiempo`, `Keep ${tip.name} up longer`);
      text = L(`Lo tienes activo el <b>${pct(tip.upM)}</b> del tiempo y ${who} el <b>${pct(tip.upO)}</b>.`, `You have it up <b>${pct(tip.upM)}</b> of the time and ${who} <b>${pct(tip.upO)}</b>.`);
    } else if (tip.kind === 'death') {
      icon = '<span class="tip-emoji">☠</span>';
      title = tip.times.length === 1 ? L('Moriste en esta pelea', 'You died this fight') : L(`Moriste ${tip.times.length} veces`, `You died ${tip.times.length} times`);
      text = L(`Tu primera muerte fue a los <b>${clock(tip.times[0])}</b>, con un ${num(tip.left * 100, 0)} % de la pelea por delante sin poder atacar. ${who[0].toUpperCase() + who.slice(1)} murieron de media ${fmt(tip.othersDeaths)} veces.`,
        `Your first death was at <b>${clock(tip.times[0])}</b>, leaving ${num(tip.left * 100, 0)} % of the fight without being able to attack. ${who[0].toUpperCase() + who.slice(1)} died ${fmt(tip.othersDeaths)} times on average.`);
      extra = `<div class="tip-times"><div class="trow me"><span class="tl">${L('Muertes', 'Deaths')}</span>${timeList(tip.times)}</div></div>`;
    }
    const sevTxt = { high: L('Prioridad alta', 'High priority'), mid: L('Prioridad media', 'Medium'), low: L('Detalle', 'Detail') }[tip.sev];
    return `<div class="tip sev-${tip.sev}"><div class="tip-ic">${icon}</div>
      <div class="tip-body"><div class="tip-head"><b>${esc(title)}</b><span class="sev">${sevTxt}</span></div><p>${text}</p>${extra}</div></div>`;
  }

  function goodHTML(g, a) {
    if (g.kind === 'active') return `<div class="good"><span class="tip-emoji">⏱</span><div><b>${L('Buen tiempo activo', 'Good uptime')}</b><small>${pct(g.actM)} · ${a.whoWord}: ${pct(g.actO)}</small></div></div>`;
    if (g.kind === 'rate-total') return `<div class="good"><span class="tip-emoji">🏁</span><div><b>${L('Tu ritmo de daño está a su nivel', 'Your output is on par')}</b><small>${plain(a.M.rate)}${t('perSec')} · ${a.whoWord}: ${plain(a.rateO)}${t('perSec')}</small></div></div>`;
    const r = g.row;
    return `<div class="good">${ic(r.icon, 28, '', r.guid)}<div><b>${L(`${r.name} bien usado`, `${r.name} well used`)}</b><small>${fmt(r.rM)}/min · ${a.whoWord}: ${fmt(r.rO)}/min</small></div></div>`;
  }

  function summaryHTML(a) {
    const M = a.M;
    const metric = M.metric === 'hps' ? 'HPS' : 'DPS';
    const ratio = a.rateO ? M.rate / a.rateO : 0;
    const card = (label, big1, small, bar) => `<div class="an-card"><small>${label}</small><b>${big1}</b><span>${small}</span>${bar != null ? `<div class="an-bar"><i style="width:${clamp100(bar)}%"></i></div>` : ''}</div>`;
    return `<div class="an-cards">
      ${card(metric, `${plain(M.rate)}<em>${t('perSec')}</em>`, `${a.whoWord}: ${plain(a.rateO)}${t('perSec')} · ${num(ratio * 100, 0)} %`, ratio * 100)}
      ${card(L('Tiempo activo', 'Active time'), pct(a.actM), `${a.whoWord}: ${pct(a.actO)}`, a.actO ? (a.actM / a.actO) * 100 : null)}
      ${card(L('Lanzamientos / min', 'Casts / min'), fmt(a.cpmM), `${a.whoWord}: ${fmt(a.cpmO)}`, a.cpmO ? (a.cpmM / a.cpmO) * 100 : null)}
      ${card(L('Muertes', 'Deaths'), String(M.deaths.length), `${a.whoWord}: ${fmt(a.deathsO)}`, null)}
    </div>`;
  }
  const clamp100 = (v) => Math.max(0, Math.min(100, v));

  function tableHTML(a) {
    const head = [`<span>${L('Habilidad', 'Ability')}</span>`, `<span class="r">${L('Tú', 'You')}</span>`,
      ...a.O.map((p, i) => `<span class="r" title="${esc(p.name)}">${esc(a.labels[i])}</span>`)];
    const cols = `minmax(190px, 2fr) repeat(${1 + a.O.length}, minmax(64px, 1fr))`;
    const rowsHtml = a.table.map((r) => {
      const low = r.rO >= 0.35 && r.rM < r.rO * 0.8;
      const high = r.rM > r.rO * 1.25 && r.rM - r.rO >= 0.4;
      return `<div class="an-tr" style="grid-template-columns:${cols}"><span class="ab" data-spell="${r.guid}">${ic(r.icon, 22)}${esc(r.name)}</span>
        <span class="r ${low ? 'neg' : high ? 'pos' : ''}">${fmt(r.rM)}</span>${r.rOs.map((x) => `<span class="r">${fmt(x)}</span>`).join('')}</div>`;
    }).join('');
    return `<div class="an-table"><div class="an-tr th" style="grid-template-columns:${cols}">${head.join('')}</div>${rowsHtml}</div>
      <p class="foot">${L('Lanzamientos por minuto. En rojo, donde lanzas bastante menos que la referencia; en verde, donde lanzas más.', 'Casts per minute. Red where you cast clearly less than the reference; green where you cast more.')}</p>`;
  }

  function cdHTML(a) {
    if (!a.cds.length) return `<div class="empty sm">${L('Sin cooldowns claros para comparar.', 'No clear cooldowns to compare.')}</div>`;
    return a.cds.map((r) => `<div class="cdrow"><div class="cdh" data-spell="${r.guid}">${ic(r.icon, 26)}<b>${esc(r.name)}</b><small>${L('Tú', 'You')}: ${r.castsM} · ${a.whoWord}: ${fmt(avg(r.castsOs))}</small></div>${timesBlock(a, r)}</div>`).join('');
  }

  function openerHTML(a, n = 14) {
    const seq = (p, label, me) => `<div class="op-row ${me ? 'me' : ''}"><span class="op-l" title="${esc(p.name)}">${esc(label)}</span><div class="op-seq">${p.casts.slice(0, n).map(([ms, g]) => {
      const ab = [p, ...a.O].map((x) => x.abilities[g]).find((x) => x?.name) || { name: `#${g}`, icon: '' };
      return `<span class="op-i">${ic(ab.icon, 30, clockPrecise(ms), g)}<small>${clock(ms)}</small></span>`;
    }).join('')}</div></div>`;
    return `<div class="opener">${seq(a.M, L('Tú', 'You'), true)}${a.O.slice(0, 6).map((p, i) => seq(p, a.labels[i], false)).join('')}</div>`;
  }

  // ------------------------------------------------------------ sanadores y tanques: lo importante de su rol
  const TANK_SPECS = new Set(['Blood', 'Vengeance', 'Guardian', 'Brewmaster', 'Protection']);
  // Mitigación activa y pasivas clave de los tanques (por nombre, en español e inglés)
  const TANK_AURAS = [
    /bloqueo con escudo|shield block/i, /ignorar dolor|ignore pain/i, /escudo del recto|shield of the righteous/i, /escudo de sangre|blood shield/i,
    /escudo de huesos|bone shield/i, /p[uú]as demon[ií]acas|demon spikes/i, /piel de hierro|ironfur/i, /defensor ardiente|sentinel|centinela eterno/i,
    /guardi[aá]n de los reyes antiguos|guardian of ancient kings/i, /fortalecer|fortifying brew|brebaje fortificante|zen meditation|meditaci[oó]n zen/i,
    /muro de escudo|shield wall|last stand|[uú]ltimo bastión/i, /vengan[sz]a|vengeance|revancha|revenge/i, /regeneraci[oó]n fren[eé]tica|frenzied regeneration|cuerpo de hierro|ironbark/i,
  ];

  const manaAt = (p, frac) => {
    if (!p.mana || !p.mana.length) return null;
    const t = p.durationMs * frac;
    let v = p.mana[0][1];
    for (const [ms, pc] of p.mana) { if (ms <= t) v = pc; else break; }
    return v;
  };
  const manaAtMs = (p, ms) => {
    if (!p.mana || !p.mana.length) return null;
    let v = p.mana[0][1];
    for (const [t0, pc] of p.mana) { if (t0 <= ms) v = pc; else break; }
    return v;
  };

  function healerSection(a) {
    const profs = [a.M, ...a.O];
    if (!a.M.mana || a.M.mana.length < 3) return `<h2 class="an-h">${L('Maná', 'Mana')}</h2><div class="empty sm">${L('No hay datos de maná de tu personaje en este log.', 'There is no mana data for your character in this log.')}</div>`;
    const names = ['Tú', ...a.O.map((p, i) => (p.label || `Log ${i + 2}`))];
    const cell = (v) => (v == null ? '<span class="muted">—</span>' : `${num(v, 0)} %`);
    const palette = ['#4da3ff', '#ff6b6b', '#4ade80', '#f5b942', '#b266ff', '#2fb7c0', '#ff9bd0', '#9aa3b2', '#ffd45c', '#7fe0ff', '#c8803f'];
    const lines = profs.map((p, i) => {
      if (!p.mana?.length) return '';
      const pts = p.mana.map(([ms, pc]) => `${((ms / p.durationMs) * 100).toFixed(2)},${(40 - (pc / 100) * 40).toFixed(2)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${palette[i % palette.length]}" stroke-width="${i === 0 ? 1.6 : 0.9}" vector-effect="non-scaling-stroke" opacity="${i === 0 ? 1 : 0.8}"/>`;
    }).join('');
    const legend = profs.map((p, i) => `<span class="mg-leg"><i style="background:${palette[i % palette.length]}"></i>${esc(i === 0 ? L('Tú', 'You') : names[i])}</span>`).join('');
    const row = (label, fn) => `<div class="mn-r"><span>${label}</span>${profs.map((p) => `<span>${cell(fn(p))}</span>`).join('')}</div>`;
    const min = (p) => (p.mana?.length ? Math.min(...p.mana.map((x) => x[1])) : null);
    // fases (si el log las tiene): maná al empezar cada una
    const phaseRows = (a.M.phases || []).length > 1 ? a.M.phases.map((ph, i) => {
      const nm = S.phases?.get(a.M.encounterID)?.get(ph.id)?.name || `${L('Fase', 'Phase')} ${ph.id}`;
      return row(`${esc(nm)} <small class="muted">${clock(ph.t)}</small>`, (p) => { const q = (p.phases || [])[i]; return q ? manaAtMs(p, q.t) : null; });
    }).join('') : '';
    const myEnd = manaAt(a.M, 1);
    const othersEnd = a.O.map((p) => manaAt(p, 1)).filter((v) => v != null);
    const avgEnd = othersEnd.length ? othersEnd.reduce((s, v) => s + v, 0) / othersEnd.length : null;
    const othersSpend = a.O.map((p) => p.manaPerMin).filter((v) => v > 0);
    const avgSpend = othersSpend.length ? othersSpend.reduce((s, v) => s + v, 0) / othersSpend.length : null;
    let note = '';
    if (myEnd != null && avgEnd != null) {
      const d = myEnd - avgEnd;
      note = Math.abs(d) < 8 ? L('Terminas la pelea con un maná parecido al de los demás: lo gestionas igual.', 'You end the fight with similar mana to the others: you manage it the same way.')
        : d < 0 ? L(`Terminas con ${num(Math.abs(d), 0)} puntos menos de maná que los demás${avgSpend ? ` (gastas ${num(a.M.manaPerMin, 0)} % de tu maná máximo por minuto frente a ${num(avgSpend, 0)} %)` : ''}: gastas más rápido; revisa hechizos caros o sanación de más (overheal).`, `You end with ${num(Math.abs(d), 0)} points less mana than the others${avgSpend ? ` (you spend ${num(a.M.manaPerMin, 0)}% of max mana per minute vs ${num(avgSpend, 0)}%)` : ''}: you spend faster; check expensive spells or overhealing.`)
        : L(`Terminas con ${num(d, 0)} puntos más de maná que los demás: te sobra recurso, podrías sanar más.`, `You end with ${num(d, 0)} points more mana than the others: you have spare resource, you could heal more.`);
    }
    return `<h2 class="an-h">${L('Maná del sanador', 'Healer mana')}</h2>
      <div class="mn-card"><svg viewBox="0 0 100 40" preserveAspectRatio="none" class="mn-chart"><g stroke="currentColor" opacity=".12"><path d="M0 10H100M0 20H100M0 30H100M25 0V40M50 0V40M75 0V40" vector-effect="non-scaling-stroke"/></g>${lines}</svg>
        <div class="mn-axis"><span>0 %</span><span>25 %</span><span>50 %</span><span>75 %</span><span>${L('fin', 'end')}</span></div>
        <div class="mg-legend">${legend}</div></div>
      <div class="mn-table"><div class="mn-r th"><span></span>${profs.map((p, i) => `<span>${esc(i === 0 ? L('Tú', 'You') : names[i])}</span>`).join('')}</div>
        ${row(L('Maná al 25 % de la pelea', 'Mana at 25% of the fight'), (p) => manaAt(p, 0.25))}${row(L('Maná al 50 %', 'Mana at 50%'), (p) => manaAt(p, 0.5))}${row(L('Maná al 75 %', 'Mana at 75%'), (p) => manaAt(p, 0.75))}${row(L('Maná al final', 'Mana at the end'), (p) => manaAt(p, 1))}
        ${row(L('Mínimo de maná', 'Lowest mana'), min)}${row(L('Gasto por minuto (% del máximo)', 'Spend per minute (% of max)'), (p) => (p.manaPerMin > 0 ? p.manaPerMin : null))}${phaseRows}</div>
      ${note ? `<p class="mn-note">${note}</p>` : ''}`;
  }

  function tankSection(a) {
    const profs = [a.M, ...a.O];
    const names = [L('Tú', 'You'), ...a.O.map((p, i) => p.label || `Log ${i + 2}`)];
    const auraOf = (p, re) => Object.values(p.buffs || {}).filter((b) => re.test(b.name)).sort((x, y) => y.uptime - x.uptime)[0] || null;
    const rows = TANK_AURAS.map((re) => {
      const per = profs.map((p) => auraOf(p, re));
      const found = per.find(Boolean);
      return found ? { name: found.name, icon: found.icon, per } : null;
    }).filter(Boolean);
    const cellA = (b, p) => {
      if (!b) return '<span class="muted">—</span>';
      const up = (b.uptime / p.durationMs) * 100;
      const every = b.uses > 1 ? p.durationMs / 1000 / b.uses : null;
      return `<b>${num(Math.min(100, up), 0)} %</b><small class="muted">${b.uses}× ${every ? `· ${L('cada', 'every')} ${num(every, 0)} s` : ''}</small>`;
    };
    const auraTable = rows.length ? `<div class="mn-table tk"><div class="mn-r th"><span>${L('Pasiva / mitigación', 'Passive / mitigation')}</span>${names.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
      ${rows.map((r) => `<div class="mn-r"><span class="ab">${ic(r.icon, 22)}${esc(r.name)}</span>${r.per.map((b, i) => `<span>${cellA(b, profs[i])}</span>`).join('')}</div>`).join('')}</div>`
      : `<div class="empty sm">${L('No he detectado mitigación activa ni pasivas conocidas de tanque en estos logs.', 'No active mitigation or known tank passives detected in these logs.')}</div>`;
    // defensivos personales lanzados (de la lista de WipeTime)
    const defs = typeof Extras !== 'undefined' ? Extras.DEF_BY_ID : new Map();
    const defRows = new Map();
    profs.forEach((p, i) => {
      for (const [ms, g] of p.casts) {
        const d = defs.get(g);
        if (!d || d.kind !== 'self') continue;
        if (!defRows.has(g)) defRows.set(g, { g, per: profs.map(() => ({ n: 0, first: null })) });
        const o = defRows.get(g).per[i];
        o.n++;
        if (o.first == null) o.first = ms;
      }
    });
    const defTable = defRows.size ? `<div class="mn-table tk"><div class="mn-r th"><span>${L('Defensivos personales', 'Personal defensives')}</span>${names.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
      ${[...defRows.values()].map((r) => { const ab = ability(r.g); return `<div class="mn-r"><span class="ab" data-spell="${r.g}">${ic(ab.icon, 22)}${esc(ab.name.startsWith('#') ? defs.get(r.g).name : ab.name)}</span>${r.per.map((o) => `<span>${o.n ? `<b>${o.n}×</b><small class="muted">${L('primero', 'first')} ${clock(o.first)}</small>` : '<span class="muted">—</span>'}</span>`).join('')}</div>`; }).join('')}</div>` : '';
    const rate = (p) => (p.takenTotal / (p.durationMs / 1000));
    const tk = `<div class="mn-table tk"><div class="mn-r th"><span>${L('Daño recibido', 'Damage taken')}</span>${names.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
      <div class="mn-r"><span>${L('Por segundo (toda la banda)', 'Per second (whole raid)')}</span>${profs.map((p) => `<span>${p.takenTotal ? plain(rate(p)) : '—'}</span>`).join('')}</div>
      <div class="mn-r"><span>${L('Tus muertes', 'Your deaths')}</span>${profs.map((p) => `<span>${p.deaths.length}</span>`).join('')}</div></div>`;
    return `<h2 class="an-h">${L('Tanque: mitigación y pasivas clave', 'Tank: mitigation and key passives')}</h2>
      <p class="mn-note">${L('Uptime = porcentaje de la pelea con el efecto activo; "cada N s" es cada cuánto lo vuelves a activar. Tu uptime debería ser parecido o mayor que el de los demás.', 'Uptime = share of the fight with the effect active; "every N s" is how often you reapply it. Your uptime should be similar to or higher than the others\'.')}</p>
      ${auraTable}${defTable}${tk}`;
  }

  function roleSections(a) {
    if (HEALER_SPECS.has(a.M.spec)) return healerSection(a);
    if (TANK_SPECS.has(a.M.spec)) return tankSection(a);
    return '';
  }

  function sections(a) {
    const high = a.tips.slice(0, 6);
    return `${summaryHTML(a)}
      <h2 class="an-h">${L('Qué mejorar', 'What to improve')}</h2>
      ${high.length ? `<div class="tips">${high.map((x) => tipHTML(x, a)).join('')}</div>` : `<div class="empty sm">${L('No he encontrado diferencias claras: tu ejecución es muy parecida.', 'No clear differences found: your execution is very similar.')}</div>`}
      ${a.good.length ? `<h2 class="an-h">${L('Lo que ya haces bien', 'What you already do well')}</h2><div class="goods">${a.good.slice(0, 6).map((g) => goodHTML(g, a)).join('')}</div>` : ''}
      <h2 class="an-h">${L('Cooldowns: cuándo los usa cada uno', 'Cooldowns: when each one uses them')}</h2>${cdHTML(a)}
      <h2 class="an-h">${L('Apertura (primeros lanzamientos)', 'Opener (first casts)')}</h2>${openerHTML(a)}
      <h2 class="an-h">${L('Habilidades por minuto', 'Abilities per minute')}</h2>${tableHTML(a)}
      ${roleSections(a)}`;
  }

  // ------------------------------------------------------------ vista de jugador: "Analizar"
  async function mountPlayer(f, id, p, seq) {
    const root = $('#anRoot');
    if (!root) return;
    const raw = S.fight;
    if (!raw.encounterID) { root.innerHTML = `<div class="empty">${L('El análisis solo está disponible en peleas de boss.', 'Analysis is only available for boss fights.')}</div>`; return; }
    const metric = HEALER_SPECS.has(p.spec) ? 'hps' : 'dps';
    const say = (m) => { const el = $('#anProg'); if (el) el.textContent = m; };
    try {
      say(L('Buscando a los mejores de tu especialización…', 'Finding the best players of your spec…'));
      const [mine, tops] = await Promise.all([
        fetchProfile({ code: S.code, fight: raw, actor: { id, name: p.name, cls: p.cls, spec: p.spec, icon: p.icon }, metric }),
        topProfiles(raw, p, metric, (i, n) => say(L(`Analizando a los mejores… ${i + 1}/${n}`, `Analyzing the best… ${i + 1}/${n}`))),
      ]);
      if (seq !== S.seq || !$('#anRoot')) return;
      if (!tops.length) {
        root.innerHTML = `<div class="empty">${L('No hay rankings públicos de tu especialización en este boss y dificultad todavía.', 'There are no public rankings for your spec on this boss and difficulty yet.')}</div>`;
        return;
      }
      const a = analyze(mine, tops);
      const bossName = raw.name;
      root.innerHTML = `<div class="an-intro"><div>${L(`Comparado con los <b>${tops.length} mejores</b> ${esc(specName(p.spec))} ${esc(className(p.cls))} en <b>${esc(bossName)}</b> ${raw.keystoneLevel ? '(ranking de Mítica+, llaves de tu nivel +' + raw.keystoneLevel + ').' : '(ranking de la zona, kills).'}`,
        `Compared with the <b>${tops.length} best</b> ${esc(specName(p.spec))} ${esc(className(p.cls))} on <b>${esc(bossName)}</b> ${raw.keystoneLevel ? '(Mythic+ rankings, keys around your level +' + raw.keystoneLevel + ').' : '(zone rankings, kills).'}`)}
        <small>${L('Analiza la pelea completa.', 'Analyzes the whole fight.')} ${tops.map((x) => esc(x.rankName)).join(', ')}</small></div>
        <button class="btn" data-cmp="open" data-from-player="${id}">${L('Comparar con mis logs…', 'Compare with my logs…')}</button></div>
        ${sections(a)}`;
    } catch (e) {
      console.error(e);
      if (seq === S.seq && $('#anRoot')) root.innerHTML = errorHTML(friendlyError(e));
    }
  }

  return { fetchProfile, topProfiles, analyze, sections, mountPlayer, timesBlock, tp, timeList, ic, L, specOfIcon, avg, fmt, pct };
})();
