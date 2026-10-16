'use strict';

// Comparar guilds: se eligen dos guilds (como en un buscador) y, para cada jefe de una banda, se ve cuántos trys (pulls) necesitó
// cada una hasta su primera kill, con el detalle try a try. Los datos salen de los logs públicos de Warcraft Logs de cada guild.
const GuildCmp = (() => {
  const ASSETS = 'https://assets.rpglogs.com/img/warcraft';
  const MAX_PAGES = 16;
  const emptyQ = () => ({ name: '', realm: '', region: 'eu' });
  const st = { q: [emptyQ(), emptyQ()], sel: [null, null], res: [null, null], msg: ['', ''], zones: null, zone: null, diff: 5, cache: new Map(), done: new Map(), loading: '', err: '', open: new Set() };

  const keyOf = (g) => `${g.region}/${g.realmSlug}/${String(g.name).toLowerCase()}`;
  const repaint = () => { if (S.guildOpen && typeof Guilds !== 'undefined') Guilds.render(); };
  const NAME_COL = ['#5b8def', '#e0a43a']; // color de cada guild

  // ---- bandas (de todas las expansiones; la más nueva por defecto)
  async function zonesList() {
    if (st.zones) return st.zones;
    const d = await gql(`{worldData{expansions{id name zones{id name difficulties{id name} encounters{id name}}}}}`);
    const bad = /ptr|complete|dummy|mythic\+|beta|torghast|delves|challenge|mage tower|season|dungeons/i;
    st.zones = (d.worldData?.expansions || []).flatMap((ex) => (ex.zones || []).map((z) => ({ ...z, expId: ex.id, expName: ex.name })))
      .filter((z) => z.encounters?.length >= 1 && !bad.test(z.name) && z.difficulties?.some((x) => [3, 4, 5].includes(x.id)))
      .sort((a, b) => a.expId - b.expId || a.id - b.id);
    if (!st.zones.some((z) => z.id === st.zone)) st.zone = st.zones[st.zones.length - 1]?.id;
    return st.zones;
  }

  // ---- datos de una guild: todos los pulls de jefe de la banda y dificultad elegidas
  async function loadGuild(g) {
    const key = `${keyOf(g)}:${st.zone}:${st.diff}`;
    if (st.cache.has(key)) return st.cache.get(key);
    const p = (async () => {
      const per = new Map();
      for (let page = 1; page <= MAX_PAGES; page++) {
        st.loading = `${g.name} · ${LL('página', 'page')} ${page}`;
        repaint();
        const d = await gql(`query($n:String!,$s:String!,$r:String!,$z:Int,$d:Int,$p:Int){reportData{reports(guildName:$n,guildServerSlug:$s,guildServerRegion:$r,zoneID:$z,limit:50,page:$p){has_more_pages data{code startTime fights(difficulty:$d){encounterID kill fightPercentage startTime endTime}}}}}`,
          { n: g.name, s: g.realmSlug, r: g.region.toUpperCase(), z: st.zone, d: st.diff, p: page });
        const r = d.reportData?.reports;
        for (const rep of r?.data || []) {
          for (const f of rep.fights || []) {
            if (!f.encounterID) continue;
            if (!per.has(f.encounterID)) per.set(f.encounterID, []);
            per.get(f.encounterID).push({ t: rep.startTime + f.startTime, dur: f.endTime - f.startTime, kill: !!f.kill, pct: f.fightPercentage, code: rep.code });
          }
        }
        if (!r?.has_more_pages) break;
      }
      for (const l of per.values()) l.sort((a, b) => a.t - b.t);
      st.done.set(key, per);
      return per;
    })();
    st.cache.set(key, p);
    p.catch(() => st.cache.delete(key));
    return p;
  }

  async function refresh() {
    if (!st.sel[0] || !st.sel[1]) return;
    st.err = '';
    try {
      await zonesList();
      repaint();
      await Promise.all(st.sel.map((g) => loadGuild(g)));
    } catch (e) { st.err = (typeof friendlyError === 'function' && friendlyError(e)) || String(e.message || e); }
    st.loading = '';
    repaint();
  }

  // Resumen de un jefe para una guild: trys hasta la primera kill, mejor wipe, tiempo invertido y lista de pulls
  function summary(list) {
    if (!list?.length) return null;
    const k = list.findIndex((x) => x.kill);
    const upto = k >= 0 ? list.slice(0, k + 1) : list;
    const wipes = upto.filter((x) => !x.kill && x.pct != null);
    return {
      tries: upto, n: upto.length, killed: k >= 0, killAt: k >= 0 ? list[k].t : 0, firstAt: list[0].t,
      best: wipes.length ? Math.min(...wipes.map((x) => x.pct)) : null,
      time: upto.reduce((s, x) => s + (x.dur || 0), 0), total: list.length,
    };
  }

  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const fmtTime = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  const pctTxt = (v) => (v == null ? '—' : `${num(pctOf(v), 1)} %`);

  // ---- vista
  function slotHTML(i) {
    const g = st.sel[i];
    if (g) {
      return `<div class="gc-slot on" style="--gc:${NAME_COL[i]}"><span data-crest data-realm="${esc(g.realmSlug)}" data-guild="${esc(g.name)}" data-size="44"></span>
        <div class="gc-gt"><b>${esc(g.name)}</b><small>${esc(g.realmName || g.realmSlug)} · ${esc(g.region.toUpperCase())}</small></div>
        <button type="button" class="gc-x" data-gc="clear" data-i="${i}" title="${esc(LL('Quitar', 'Remove'))}" aria-label="${esc(LL('Quitar', 'Remove'))}">×</button></div>`;
    }
    const q = st.q[i];
    const res = st.res[i];
    let list = '';
    if (res?.loading) list = `<div class="loading"><span class="spinner"></span>${LL('Buscando guilds…', 'Searching guilds…')}</div>`;
    else if (res?.error) list = `<div class="error sm"><p>${esc(res.error)}</p></div>`;
    else if (res?.list) list = res.list.length ? `<div class="gc-res">${res.list.map((x, j) => `<button type="button" class="gd-res" data-gc="pick" data-i="${i}" data-j="${j}"><span class="crest-slot" data-crest data-realm="${esc(x.realmSlug)}" data-guild="${esc(x.name)}" data-size="30"></span><span class="gd-res-t"><b>${esc(x.name)}</b><small>${esc(x.realmName)}</small></span><span class="gd-reg">${esc(x.region.toUpperCase())}</span></button>`).join('')}</div>`
      : `<div class="empty sm">${LL('No encontré ninguna guild con ese nombre.', 'No guild found with that name.')}</div>`;
    return `<div class="gc-slot" style="--gc:${NAME_COL[i]}"><form class="gd-form gc-form" id="gcForm${i}" autocomplete="off">
      <input name="name" placeholder="${esc(LL(`Guild ${i + 1}: nombre`, `Guild ${i + 1}: name`))}" value="${esc(q.name)}" spellcheck="false" required>
      <input name="realm" placeholder="${esc(LL('Reino (opcional)', 'Realm (optional)'))}" value="${esc(q.realm)}" spellcheck="false">
      <select name="region">${['eu', 'us', 'kr', 'tw'].map((r) => `<option value="${r}" ${r === q.region ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('')}</select>
      <button class="btn" type="submit">${LL('Buscar', 'Search')}</button></form>${st.msg[i] ? `<div class="error sm"><p>${esc(st.msg[i])}</p></div>` : ''}${list}</div>`;
  }

  function controlsHTML() {
    const zones = st.zones || [];
    const zone = zones.find((z) => z.id === st.zone);
    if (!zone) return '';
    const icon = (z) => `${ASSETS}/zones/zone-${z.id}.png`;
    const exps = [...new Map(zones.map((z) => [z.expId, z.expName])).entries()].sort((a, b) => b[0] - a[0]);
    const items = exps.map(([id, name]) => `<div class="gc-grp">${esc(name)}</div>${[...zones].filter((z) => z.expId === id).sort((a, b) => b.id - a.id).map((z) =>
      `<div class="abdd-i ${z.id === zone.id ? 'on' : ''}" data-gc="zone" data-v="${z.id}"><img class="pf-ddi" src="${icon(z)}" width="22" height="22" alt=""><span class="abdd-t">${esc(z.name)}</span></div>`).join('')}`).join('');
    const dd = `<div class="abdd pf-dd"><button type="button" class="abdd-btn" data-gc="zone-toggle"><img class="pf-ddi" src="${icon(zone)}" width="20" height="20" alt=""><span class="abdd-t">${esc(zone.name)}</span><span class="abdd-car">▾</span></button><div class="abdd-list surface-dark" hidden>${items}</div></div>`;
    const dids = [5, 4, 3].filter((id) => zone.difficulties.some((d) => d.id === id));
    const diffs = dids.map((id) => `<button type="button" class="chip ${st.diff === id ? 'on' : ''}" data-gc="diff" data-v="${id}">${esc(diffName(id))}</button>`).join('');
    return `<div class="pf-fbar gc-ctl">${dd}<span class="chips">${diffs}</span></div>`;
  }

  function tableHTML() {
    const zone = (st.zones || []).find((z) => z.id === st.zone);
    const [a, b] = st.sel;
    if (!zone) return '';
    if (st.err) return `<div class="error"><p>${esc(st.err)}</p></div>`;
    const mA = st.done.get(`${keyOf(a)}:${st.zone}:${st.diff}`), mB = st.done.get(`${keyOf(b)}:${st.zone}:${st.diff}`);
    if (!mA || !mB) return `<div class="loading"><span class="spinner"></span>${LL('Cargando logs…', 'Loading logs…')} ${esc(st.loading)}</div>`;
    const cell = (s, i) => (s ? `<div class="gc-c" style="--gc:${NAME_COL[i]}"><b class="gc-n">${num(s.n, 0)}</b><span class="gc-l">${s.killed ? LL('trys hasta la kill', 'tries to kill') : LL('trys, sin kill', 'tries, no kill')}</span>
      <small>${s.killed ? `${LL('Kill', 'Kill')}: ${esc(fmtDate(s.killAt))} · ` : ''}${LL('Tiempo', 'Time')}: ${esc(fmtTime(s.time))}</small>${s.best != null ? `<small>${LL('Mejor wipe', 'Best wipe')}: ${esc(pctTxt(s.best))}</small>` : ''}</div>`
      : `<div class="gc-c none" style="--gc:${NAME_COL[i]}"><b class="gc-n">—</b><span class="gc-l">${LL('sin pulls', 'no pulls')}</span></div>`);
    let totA = 0, totB = 0, both = 0;
    const rows = zone.encounters.filter((e) => e.name).map((e) => {
      const sA = summary(mA.get(e.id)), sB = summary(mB.get(e.id));
      let diff = '<span class="muted">—</span>';
      if (sA?.killed && sB?.killed) {
        both++; totA += sA.n; totB += sB.n;
        const d = sA.n - sB.n;
        diff = d === 0 ? `<b>${LL('Igual', 'Same')}</b>` : `<b style="color:${NAME_COL[d < 0 ? 0 : 1]}">${esc(d < 0 ? a.name : b.name)}</b><small>${LL(`${num(Math.abs(d), 0)} trys menos`, `${num(Math.abs(d), 0)} fewer tries`)}</small>`;
      } else if (sA?.killed || sB?.killed) diff = `<small>${LL('Solo la mató', 'Only killed by')} <b style="color:${NAME_COL[sA?.killed ? 0 : 1]}">${esc(sA?.killed ? a.name : b.name)}</b></small>`;
      const open = st.open.has(e.id);
      return `<div class="gc-row ${open ? 'open' : ''}" data-gc="row" data-e="${e.id}">
        <div class="gc-boss"><span class="pf-bic"><img src="${ASSETS}/bosses/${e.id}-icon.jpg" width="28" height="28" loading="lazy" alt=""></span><span>${esc(e.name)}</span></div>
        ${cell(sA, 0)}${cell(sB, 1)}<div class="gc-d">${diff}</div></div>${open ? detailHTML(sA, sB) : ''}`;
    }).join('');
    const total = both ? `<div class="gc-sum">${LL('En los jefes que mataron las dos', 'On the bosses both killed')} (${both}): <b style="color:${NAME_COL[0]}">${esc(a.name)}</b> ${num(totA, 0)} ${LL('trys', 'tries')} · <b style="color:${NAME_COL[1]}">${esc(b.name)}</b> ${num(totB, 0)} ${LL('trys', 'tries')}</div>` : '';
    return `${total}<div class="gc-head"><span>${LL('Jefe', 'Boss')}</span><span style="color:${NAME_COL[0]}">${esc(a.name)}</span><span style="color:${NAME_COL[1]}">${esc(b.name)}</span><span>${LL('Diferencia', 'Difference')}</span></div><div class="gc-tbl">${rows}</div>
      <p class="foot">${LL('Un try es un pull al jefe en los logs públicos de Warcraft Logs; se cuentan hasta la primera kill (incluida). Pulsa un jefe para ver cada try.', 'A try is a pull on the boss in the public Warcraft Logs; they are counted up to the first kill (included). Click a boss to see every try.')}</p>`;
  }

  // Detalle try a try de cada guild (barra = vida que le quedaba al jefe)
  function detailHTML(sA, sB) {
    const col = (s, i) => {
      if (!s) return `<div class="gc-dc"><div class="empty sm">${LL('Sin pulls', 'No pulls')}</div></div>`;
      return `<div class="gc-dc" style="--gc:${NAME_COL[i]}">${s.tries.map((x, j) => {
        const p = x.kill ? 0 : pctOf(x.pct);
        return `<div class="gc-t ${x.kill ? 'kill' : ''}"><span class="gc-tn">Try ${num(j + 1, 0)}</span><span class="gc-tb"><i style="width:${x.kill ? 100 : Math.max(2, Math.min(100, p ?? 0))}%"></i></span><b>${x.kill ? 'Kill' : pctTxt(x.pct)}</b><em>${esc(clock(x.dur || 0))}</em></div>`;
      }).join('')}</div>`;
    };
    return `<div class="gc-detail">${col(sA, 0)}${col(sB, 1)}</div>`;
  }

  function html() {
    const both = st.sel[0] && st.sel[1];
    return `<h3 class="sec gc-sec">${LL('Comparar guilds', 'Compare guilds')}</h3>
      <p class="muted gc-hint">${LL('Busca dos guilds y compara cuántos trys necesitó cada una para matar cada jefe.', 'Find two guilds and compare how many tries each needed to kill each boss.')}</p>
      <div class="gc-slots">${slotHTML(0)}<span class="gc-vs">VS</span>${slotHTML(1)}</div>
      ${both ? `${controlsHTML()}<div id="gcBody">${tableHTML()}</div>` : ''}`;
  }

  // ---- búsqueda de una guild
  async function find(i, name, realm, region) {
    st.q[i] = { name, realm, region };
    st.msg[i] = '';
    st.res[i] = null;
    if (!realm) {
      st.res[i] = { loading: true };
      repaint();
      const r = await window.api.rioGuilds(name);
      st.res[i] = r.error ? { error: r.error } : { list: r.list };
      repaint();
      return;
    }
    try {
      const slug = Cards.slugOf(realm);
      const d = await gql(`query($n:String!,$s:String!,$r:String!){guildData{guild(name:$n,serverSlug:$s,serverRegion:$r){name server{name slug}}}}`, { n: name, s: slug, r: region.toUpperCase() });
      const g = d.guildData?.guild;
      if (!g) throw new Error('HTTP_404');
      select(i, { name: g.name, realmSlug: g.server?.slug || slug, realmName: g.server?.name || realm, region });
    } catch (e) {
      st.msg[i] = LL('No encontrada: revisa el nombre, el reino y la región.', 'Not found: check the name, realm and region.');
      repaint();
    }
  }

  function select(i, g) {
    st.sel[i] = g;
    st.res[i] = null;
    st.msg[i] = '';
    st.open.clear();
    repaint();
    refresh();
  }

  document.addEventListener('submit', (ev) => {
    const m = /^gcForm(\d)$/.exec(ev.target.id || '');
    if (!m) return;
    ev.preventDefault();
    const fd = new FormData(ev.target);
    find(Number(m[1]), String(fd.get('name') || '').trim(), String(fd.get('realm') || '').trim(), String(fd.get('region') || 'eu'));
  });

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-gc]');
    if (!el || !S.guildOpen) return;
    const a = el.dataset.gc;
    const i = Number(el.dataset.i);
    if (a === 'clear') { st.sel[i] = null; st.res[i] = null; st.open.clear(); repaint(); }
    else if (a === 'pick') { const g = st.res[i]?.list?.[Number(el.dataset.j)]; if (g) select(i, g); }
    else if (a === 'zone-toggle') { const l = el.nextElementSibling; document.querySelectorAll('.abdd-list:not([hidden])').forEach((x) => { if (x !== l) x.hidden = true; }); l.hidden = !l.hidden; }
    else if (a === 'zone') { st.zone = Number(el.dataset.v); st.open.clear(); repaint(); refresh(); }
    else if (a === 'diff') { st.diff = Number(el.dataset.v); st.open.clear(); repaint(); refresh(); }
    else if (a === 'row') { const id = Number(el.dataset.e); if (st.open.has(id)) st.open.delete(id); else st.open.add(id); repaint(); }
  });

  return { html };
})();
