'use strict';

// Pestañas de la ficha de una guild: Progreso (kills por semana y ritmo), Asistencia (quién fue a cada noche de raid) y
// Banda (composición por clase y buffos de banda que faltan). Los datos salen de los logs públicos de Warcraft Logs y del roster de Blizzard.
const GuildTabs = (() => {
  const ASSETS = 'https://assets.rpglogs.com/img/warcraft';
  const WEEK = 7 * 864e5;
  // La semana de WoW empieza con el reinicio: miércoles 04:00 UTC en Europa, martes 15:00 UTC en América
  const weekIdx = (t, region) => Math.floor((t - (String(region).toUpperCase() === 'US' ? Date.UTC(2024, 0, 2, 15) : Date.UTC(2024, 0, 3, 4))) / WEEK);
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const fmtShort = (ms) => new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  const fmtTime = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  const cache = new Map();
  const noLogsBox = (g) => `<div class="gc-warn">ⓘ ${LL(`Warcraft Logs no entrega ningún report público de ${esc(g.name)} para esta banda y dificultad (sus logs son privados u ocultos, o no están asociados a la guild), así que no hay datos que mostrar aquí.`, `Warcraft Logs returns no public report for ${esc(g.name)} for this raid and difficulty (its logs are private or hidden, or not linked to the guild), so there is no data to show here.`)}</div>`;

  // ---------------------------------------------------------------- Progreso
  async function progress(el, ctx) {
    const { g, region, zones } = ctx;
    const zone = zones.find((z) => z.id === ctx.zone) || zones[zones.length - 1];
    const key = `${g.realmSlug}/${g.name}/${zone.id}/${ctx.diff}`;
    if (!cache.has(key)) {
      el.innerHTML = `<div class="loading"><span class="spinner"></span>${LL('Leyendo los logs de la guild…', 'Reading the guild logs…')} <span id="gtPage"></span></div>`;
      cache.set(key, GuildCmp.fetchPulls({ ...g, region: region.toLowerCase() }, zone.id, ctx.diff, (p) => { const e = document.getElementById('gtPage'); if (e) e.textContent = `· ${LL('página', 'page')} ${p}`; }).catch((e) => { cache.delete(key); throw e; }));
    }
    const { per, nReports } = await cache.get(key);
    if (!document.getElementById('gdTab') || ctx.tab() !== 'prog') return;
    if (!nReports) { el.innerHTML = noLogsBox(g); return; }
    const sum = (list) => {
      if (!list?.length) return null;
      const k = list.findIndex((x) => x.kill), upto = k >= 0 ? list.slice(0, k + 1) : list;
      const wipes = upto.filter((x) => !x.kill && x.pct != null);
      return { n: upto.length, killed: k >= 0, firstAt: list[0].t, killAt: k >= 0 ? list[k].t : 0, time: upto.reduce((s, x) => s + (x.dur || 0), 0), best: wipes.length ? Math.min(...wipes.map((x) => x.pct)) : null, all: list };
    };
    const rows = zone.encounters.filter((e) => e.name).map((e) => ({ e, s: sum(per.get(e.id)) }));
    const killedRows = rows.filter((r) => r.s?.killed);
    const starts = rows.filter((r) => r.s).map((r) => r.s.firstAt);
    if (!starts.length) { el.innerHTML = `<div class="empty">${LL('Esta guild no tiene pulls en esta banda y dificultad.', 'This guild has no pulls in this raid and difficulty.')}</div>`; return; }
    const first = Math.min(...starts), w0 = weekIdx(first, region), wNow = weekIdx(Date.now(), region);
    const weeks = [];
    for (let w = w0; w <= wNow; w++) weeks.push({ w, kills: 0, pulls: 0 });
    for (const r of rows) {
      if (!r.s) continue;
      for (const x of r.s.all) { const i = weekIdx(x.t, region) - w0; if (weeks[i]) weeks[i].pulls++; }
      if (r.s.killed) { const i = weekIdx(r.s.killAt, region) - w0; if (weeks[i]) weeks[i].kills++; }
    }
    const maxP = Math.max(1, ...weeks.map((x) => x.pulls)), maxK = Math.max(1, ...weeks.map((x) => x.kills));
    const lastKill = killedRows.length ? Math.max(...killedRows.map((r) => r.s.killAt)) : 0;
    const totalPulls = killedRows.reduce((s, r) => s + r.s.n, 0);
    const pace = killedRows.length ? killedRows.length / Math.max(1, weekIdx(lastKill, region) - w0 + 1) : 0;
    const tiles = [
      [LL('Jefes con kill', 'Bosses killed'), `${killedRows.length} / ${rows.length}`], [LL('Primer pull', 'First pull'), fmtDate(first)],
      [LL('Última kill', 'Latest kill'), fmtDate(lastKill)], [LL('Trys hasta las kills', 'Tries to the kills'), num(totalPulls, 0)], [LL('Ritmo', 'Pace'), `${num(pace, 1)} ${LL('kills / semana', 'kills / week')}`],
    ].map(([k, v]) => `<div class="ov-tile"><small>${k}</small><div>${v}</div></div>`).join('');
    const chart = `<div class="gt-weeks">${weeks.map((x, i) => `<div class="gt-w" title="${esc(LL(`Semana ${i + 1}`, `Week ${i + 1}`))}: ${x.kills} kills · ${x.pulls} pulls">
      <div class="gt-bars"><i class="p" style="height:${(x.pulls / maxP) * 100}%"></i><i class="k" style="height:${x.kills ? Math.max(8, (x.kills / maxK) * 100) : 0}%"></i></div><b>${x.kills || ''}</b><small>${esc(fmtShort(Date.UTC(2024, 0, String(region).toUpperCase() === 'US' ? 2 : 3) + (x.w) * WEEK))}</small></div>`).join('')}</div>
      <div class="gt-legend"><span><i class="k"></i>${LL('Kills de la semana', 'Kills of the week')}</span><span><i class="p"></i>${LL('Pulls de la semana', 'Pulls of the week')}</span></div>`;
    const table = `<div class="gc-head gt-head"><span>${LL('Jefe', 'Boss')}</span><span>${LL('Kill', 'Kill')}</span><span>${LL('Semana', 'Week')}</span><span>${LL('Trys', 'Tries')}</span><span>${LL('Tiempo', 'Time')}</span></div><div class="gc-tbl gt-tbl">${rows.map((r) => {
      const s = r.s;
      return `<div class="gt-row ${s?.killed ? 'kill' : ''}"><div class="gc-boss"><span class="pf-bic"><img src="${ASSETS}/bosses/${r.e.id}-icon.jpg" width="24" height="24" loading="lazy" alt=""></span><span>${esc(r.e.name)}</span></div>`
        + (s ? `<span>${s.killed ? `✓ ${esc(fmtDate(s.killAt))}` : `<span class="muted">${LL('sin kill', 'no kill')}${s.best != null ? ` · ${num(pctOf(s.best), 1)} %` : ''}</span>`}</span><span>${s.killed ? weekIdx(s.killAt, region) - w0 + 1 : '—'}</span><b>${num(s.n, 0)}</b><span>${esc(fmtTime(s.time))}</span>` : `<span class="muted">—</span><span>—</span><span>—</span><span>—</span>`) + '</div>';
    }).join('')}</div>`;
    el.innerHTML = `<div class="ov-tiles">${tiles}</div><h3 class="sec">${LL('Progreso por semanas', 'Progress by week')}</h3>${chart}<h3 class="sec">${LL('Kill de cada jefe', 'Kill of each boss')}</h3>${table}
      <p class="foot">${LL('Datos de los logs públicos de Warcraft Logs (un pull subido en varios logs cuenta una vez). Las semanas empiezan con el reinicio semanal.', 'Data from public Warcraft Logs reports (a pull uploaded in several logs counts once). Weeks start at the weekly reset.')}</p>`;
  }

  // ---------------------------------------------------------------- Asistencia
  async function attendance(el, ctx) {
    const { g, region } = ctx;
    const key = `att/${g.realmSlug}/${g.name}/${ctx.zone}`;
    if (!cache.has(key)) {
      el.innerHTML = `<div class="loading"><span class="spinner"></span>${LL('Leyendo la asistencia…', 'Reading attendance…')}</div>`;
      cache.set(key, (async () => {
        const gi = await gql(`query($n:String!,$s:String!,$r:String!){guildData{guild(name:$n,serverSlug:$s,serverRegion:$r){id}}}`, { n: g.name, s: g.realmSlug, r: region.toUpperCase() });
        const id = gi.guildData?.guild?.id;
        if (!id) return { rows: [] };
        const d = await gql(`query($id:Int!,$z:Int){guildData{guild(id:$id){attendance(limit:25,zoneID:$z){data{code startTime zone{name} players{name type presence}}}}}}`, { id, z: ctx.zone });
        return { rows: (d.guildData?.guild?.attendance?.data || []).sort((a, b) => a.startTime - b.startTime) };
      })().catch((e) => { cache.delete(key); throw e; }));
    }
    const { rows } = await cache.get(key);
    if (!document.getElementById('gdTab') || ctx.tab() !== 'att') return;
    if (!rows.length) { el.innerHTML = noLogsBox(g); return; }
    const shown = rows.slice(-14);
    const per = new Map();
    for (const night of shown) for (const p of night.players || []) {
      let x = per.get(p.name);
      if (!x) per.set(p.name, x = { name: p.name, type: p.type, by: new Map(), n: 0 });
      x.by.set(night.code, p.presence); if (p.presence === 1) x.n++;
    }
    const list = [...per.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    const avg = list.length ? list.reduce((s, p) => s + p.n, 0) / list.length / shown.length * 100 : 0;
    const tiles = [[LL('Noches de raid', 'Raid nights'), shown.length], [LL('Jugadores distintos', 'Different players'), list.length], [LL('Asistencia media', 'Average attendance'), `${num(avg, 0)} %`], [LL('Más constante', 'Most reliable'), list[0] ? `${esc(list[0].name)} (${list[0].n}/${shown.length})` : '—']].map(([k, v]) => `<div class="ov-tile"><small>${k}</small><div>${v}</div></div>`).join('');
    const head = `<div class="at-row th"><span>${LL('Jugador', 'Player')}</span>${shown.map((n) => `<span title="${esc(n.zone?.name || '')}">${esc(fmtShort(n.startTime))}</span>`).join('')}<span>%</span></div>`;
    const body = list.map((p) => `<div class="at-row"><span class="who"><img class="spec-ic-sm" src="${classIconUrl(p.type)}" width="20" height="20" alt="" style="--cc:${classColor(p.type)}"><b style="color:${classColor(p.type)}">${esc(p.name)}</b></span>${shown.map((n) => { const v = p.by.get(n.code); return `<span class="at-c ${v === 1 ? 'on' : v === 2 ? 'bench' : ''}" title="${v === 1 ? LL('Presente', 'Present') : v === 2 ? LL('Banquillo', 'Bench') : LL('Ausente', 'Absent')}">${v === 1 ? '✓' : v === 2 ? '◐' : '·'}</span>`; }).join('')}<b class="at-p">${num(p.n / shown.length * 100, 0)} %</b></div>`).join('');
    el.innerHTML = `<div class="ov-tiles">${tiles}</div><div class="at-wrap" style="--n:${shown.length}">${head}${body}</div>
      <p class="foot">${LL('Según los logs públicos de la guild en la banda elegida (últimas 14 noches). ✓ presente · ◐ banquillo · · ausente.', 'From the guild’s public logs in the chosen raid (last 14 nights). ✓ present · ◐ bench · · absent.')}</p>`;
  }

  // ---------------------------------------------------------------- Banda: composición y buffos de banda que faltan
  async function roster(el, ctx) {
    const { g } = ctx;
    el.innerHTML = `<div class="loading"><span class="spinner"></span>${LL('Leyendo el roster…', 'Reading the roster…')}</div>`;
    const members = await ctx.rosterOf(g);
    if (!document.getElementById('gdTab') || ctx.tab() !== 'roster') return;
    const max = Math.max(0, ...members.map((m) => m.level));
    const pool = members.filter((m) => m.level === max);
    const byCls = new Map();
    for (const m of pool) { const c = ctx.classKey(m.classId); if (c) byCls.set(c, (byCls.get(c) || 0) + 1); }
    const list = [...byCls.entries()].sort((a, b) => b[1] - a[1]);
    const top = Math.max(1, ...list.map(([, n]) => n));
    const comp = list.map(([c, n]) => `<div class="rs-c" style="--cc:${classColor(c)}"><img src="${classIconUrl(c)}" width="26" height="26" alt=""><span>${esc(className(c))}</span><i style="width:${(n / top) * 100}%"></i><b>${n}</b></div>`).join('');
    const buffs = (Extras.RAID_BUFFS || []).map((b) => {
      const have = b.cls.reduce((s, c) => s + (byCls.get(c) || 0), 0);
      return { b, have };
    });
    const missing = buffs.filter((x) => !x.have);
    const bl = buffs.map(({ b, have }) => `<div class="rs-b ${have ? 'ok' : 'no'}" data-spell="${b.id}"><img class="ai" src="${abilityIconUrl(b.icon.replace(/\.jpg$/, ''))}" width="22" height="22" alt=""><span>${esc(S.lang === 'es' ? b.es : b.en)}</span><em>${b.cls.map((c) => esc(className(c))).join(' / ')}</em><b>${have ? have : '✗'}</b></div>`).join('');
    el.innerHTML = `<div class="ov-tiles"><div class="ov-tile"><small>${LL('Miembros de nivel máximo', 'Max-level members')}</small><div>${pool.length}</div></div><div class="ov-tile"><small>${LL('Miembros en total', 'Total members')}</small><div>${members.length}</div></div><div class="ov-tile"><small>${LL('Clases', 'Classes')}</small><div>${list.length} / 13</div></div><div class="ov-tile"><small>${LL('Buffos de banda sin cubrir', 'Uncovered raid buffs')}</small><div class="${missing.length ? 'bad' : 'ok'}">${missing.length}</div></div></div>
      <div class="gc-warn" ${missing.length ? '' : 'hidden'}>ⓘ ${LL('Ninguno de los miembros de nivel máximo aporta:', 'None of the max-level members provides:')} ${missing.map((x) => `<b>${esc(S.lang === 'es' ? x.b.es : x.b.en)}</b> (${x.b.cls.map((c) => esc(className(c))).join(' / ')})`).join(', ')}</div>
      <div class="rs-grid"><div><h3 class="sec">${LL('Composición por clase', 'Composition by class')}</h3>${comp}</div><div><h3 class="sec">${LL('Buffos y utilidades de banda', 'Raid buffs and utilities')}</h3>${bl}</div></div>
      <p class="foot">${LL('Según el roster de Blizzard (solo miembros de nivel máximo). El rol exacto de cada uno no viene en el roster; mira «Ranking de parses» para ver especializaciones.', 'From the Blizzard roster (max-level members only). Each member’s exact role is not in the roster; see «Parse ranking» for specs.')}</p>`;
  }

  async function show(tab, el, ctx) {
    try {
      if (tab === 'prog') await progress(el, ctx);
      else if (tab === 'att') await attendance(el, ctx);
      else if (tab === 'roster') await roster(el, ctx);
    } catch (e) {
      console.warn('guildtabs', e);
      const box = document.getElementById('gdTab');
      if (box) box.innerHTML = errorHTML(friendlyError(e));
    }
  }

  return { show };
})();
