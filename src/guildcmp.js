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

  // Un mismo pull aparece en cada log donde alguien lo subió: dos pulls distintos nunca se solapan en el tiempo,
  // así que un pull que empieza antes de que acabe el anterior es el mismo.
  function dedupe(list) {
    const out = [];
    let end = -1;
    for (const x of list) {
      const pv = out[out.length - 1];
      // mismo pull: se solapa con el anterior, o empieza casi a la vez con la misma vida y la misma duración (relojes de logs distintos)
      if (pv && (x.t < end - 1000 || (x.t - pv.t < 60000 && Math.abs((x.pct ?? -1) - (pv.pct ?? -2)) < 0.02 && Math.abs((x.dur || 0) - (pv.dur || 0)) < 4000))) {
        if (x.kill) pv.kill = true;
        end = Math.max(end, x.t + (x.dur || 0));
        continue;
      }
      out.push({ ...x });
      end = x.t + (x.dur || 0);
    }
    return out;
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
      for (const [e, l] of per) per.set(e, dedupe(l.sort((a, b) => a.t - b.t)));
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

  // Datos de la comparación (para la tabla y para la imagen)
  function compareData() {
    const zone = (st.zones || []).find((z) => z.id === st.zone);
    const [a, b] = st.sel;
    const mA = st.done.get(`${keyOf(a)}:${st.zone}:${st.diff}`), mB = st.done.get(`${keyOf(b)}:${st.zone}:${st.diff}`);
    if (!zone || !mA || !mB) return null;
    let totA = 0, totB = 0, both = 0;
    const rows = zone.encounters.filter((e) => e.name).map((e) => {
      const sA = summary(mA.get(e.id)), sB = summary(mB.get(e.id));
      let diff = null;
      if (sA?.killed && sB?.killed) { both++; totA += sA.n; totB += sB.n; diff = { d: sA.n - sB.n }; }
      return { e, sA, sB, diff };
    });
    return { zone, a, b, rows, both, totA, totB };
  }

  const cellTxt = (s) => (s ? `${s.killed ? `${fmtDate(s.killAt)} · ` : ''}${fmtTime(s.time)}${s.best != null ? ` · ${LL('mejor wipe', 'best wipe')} ${pctTxt(s.best)}` : ''}` : '');
  const diffTxt = (r, a, b) => {
    if (r.diff) return r.diff.d === 0 ? { t: LL('Igual', 'Same'), c: null } : { t: `${r.diff.d < 0 ? a.name : b.name} −${num(Math.abs(r.diff.d), 0)}`, c: NAME_COL[r.diff.d < 0 ? 0 : 1] };
    if (r.sA?.killed || r.sB?.killed) return { t: LL('Solo ', 'Only ') + (r.sA?.killed ? a.name : b.name), c: NAME_COL[r.sA?.killed ? 0 : 1] };
    return { t: '—', c: null };
  };

  function tableHTML() {
    if (st.err) return `<div class="error"><p>${esc(st.err)}</p></div>`;
    const cd = compareData();
    if (!cd) return `<div class="loading"><span class="spinner"></span>${LL('Cargando logs…', 'Loading logs…')} ${esc(st.loading)}</div>`;
    const { a, b, rows, both, totA, totB } = cd;
    const stealth = [a, b].filter((g) => g.stealth);
    const warn = stealth.length ? `<div class="gc-warn">🔒 ${LL(`${stealth.map((g) => g.name).join(' y ')}: tiene el modo sigilo de Warcraft Logs activado, así que sus reports no son públicos para aplicaciones externas y no se pueden contar sus trys.`, `${stealth.map((g) => g.name).join(' and ')}: has Warcraft Logs stealth mode on, so its reports are not public to external apps and its tries cannot be counted.`)}</div>` : '';
    const cell = (s, i, g) => (s ? `<div class="gc-c" style="--gc:${NAME_COL[i]}"><span class="gc-top"><b class="gc-n">${num(s.n, 0)}</b><span class="gc-l">${s.killed ? LL('trys', 'tries') : LL('trys, sin kill', 'tries, no kill')}</span></span><small>${esc(cellTxt(s))}</small></div>`
      : `<div class="gc-c none" style="--gc:${NAME_COL[i]}"><span class="gc-top"><b class="gc-n">—</b></span><small>${g.stealth ? '🔒 ' + LL('sigilo', 'stealth') : LL('sin pulls', 'no pulls')}</small></div>`);
    const body = rows.map((r) => {
      const d = diffTxt(r, a, b);
      const open = st.open.has(r.e.id);
      return `<div class="gc-row ${open ? 'open' : ''}" data-gc="row" data-e="${r.e.id}">
        <div class="gc-boss"><span class="pf-bic"><img src="${ASSETS}/bosses/${r.e.id}-icon.jpg" width="24" height="24" loading="lazy" alt=""></span><span>${esc(r.e.name)}</span></div>
        ${cell(r.sA, 0, a)}${cell(r.sB, 1, b)}<div class="gc-d"${d.c ? ` style="color:${d.c}"` : ''}>${esc(d.t)}</div></div>${open ? detailHTML(r.sA, r.sB) : ''}`;
    }).join('');
    const total = both ? `<div class="gc-sum">${LL(`En los ${both} jefes que mataron las dos`, `On the ${both} bosses both killed`)}: <b style="color:${NAME_COL[0]}">${esc(a.name)}</b> ${num(totA, 0)} ${LL('trys', 'tries')} · <b style="color:${NAME_COL[1]}">${esc(b.name)}</b> ${num(totB, 0)} ${LL('trys', 'tries')}</div>` : '';
    return `${warn}<div class="gc-tools"><button type="button" class="btn ghost sm" data-gc="copy">${LL('Copiar imagen', 'Copy image')}</button><button type="button" class="btn ghost sm" data-gc="save">${LL('Guardar PNG', 'Save PNG')}</button></div>${total}
      <div class="gc-head"><span>${LL('Jefe', 'Boss')}</span><span style="color:${NAME_COL[0]}">${esc(a.name)}</span><span style="color:${NAME_COL[1]}">${esc(b.name)}</span><span>${LL('Diferencia', 'Difference')}</span></div><div class="gc-tbl">${body}</div>
      <p class="foot">${LL('Un try es un pull al jefe en los logs públicos de Warcraft Logs (un pull subido en varios logs cuenta una vez); se cuentan hasta la primera kill (incluida). Pulsa un jefe para ver cada try.', 'A try is a pull on the boss in the public Warcraft Logs (a pull uploaded in several logs counts once); they are counted up to the first kill (included). Click a boss to see every try.')}</p>`;
  }

  // ---- Imagen PNG de la tabla (copiar al portapapeles o guardar)
  async function exportImage(mode) {
    const cd = compareData();
    if (!cd) return;
    const { zone, a, b, rows, both, totA, totB } = cd;
    const font = 'Segoe UI, system-ui, sans-serif';
    const W = 920, pad = 16, headH = 58, th = 26, rowH = 40;
    const cx = [pad, 250, 480, 710]; // columnas: jefe, A, B, diferencia
    const H = headH + th + rows.length * rowH + 30;
    const scale = 2;
    const draw = (withIcons) => new Promise((resolve) => {
      const cv = document.createElement('canvas');
      cv.width = W * scale; cv.height = H * scale;
      const g = cv.getContext('2d');
      g.scale(scale, scale);
      g.textBaseline = 'middle';
      g.fillStyle = '#0f1013'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#e8e8ec'; g.font = `700 17px ${font}`; g.textAlign = 'left';
      g.fillText(`${zone.name} · ${diffName(st.diff)}`, pad, 20);
      g.font = `700 15px ${font}`;
      let x = pad;
      g.fillStyle = NAME_COL[0]; g.fillText(a.name, x, 44); x += g.measureText(a.name).width;
      g.fillStyle = '#6b6b74'; g.fillText('  VS  ', x, 44); x += g.measureText('  VS  ').width;
      g.fillStyle = NAME_COL[1]; g.fillText(b.name, x, 44);
      if (both) { g.textAlign = 'right'; g.fillStyle = '#9a9aa3'; g.font = `12.5px ${font}`; g.fillText(`${LL('Trys en los jefes que mataron las dos', 'Tries on the bosses both killed')}: ${a.name} ${num(totA, 0)} · ${b.name} ${num(totB, 0)}`, W - pad, 44); g.textAlign = 'left'; }
      // cabecera
      g.fillStyle = '#17191f'; g.fillRect(0, headH, W, th);
      g.fillStyle = '#9aa3b2'; g.font = `600 12px ${font}`;
      g.fillText(LL('Jefe', 'Boss'), cx[0], headH + th / 2);
      g.fillText(a.name, cx[1], headH + th / 2); g.fillText(b.name, cx[2], headH + th / 2); g.fillText(LL('Diferencia', 'Difference'), cx[3], headH + th / 2);
      const imgs = rows.map((r) => (withIcons ? new Promise((ok) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = `${ASSETS}/bosses/${r.e.id}-icon.jpg`; }) : Promise.resolve(null)));
      Promise.all(imgs).then((ims) => {
        rows.forEach((r, i) => {
          const y = headH + th + i * rowH, cy = y + rowH / 2;
          g.fillStyle = i % 2 ? '#13151a' : '#0f1013'; g.fillRect(0, y, W, rowH);
          g.strokeStyle = '#2a2a30'; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
          if (ims[i]) g.drawImage(ims[i], cx[0], y + 8, 24, 24);
          g.fillStyle = '#8fb7ff'; g.font = `600 13px ${font}`; g.textAlign = 'left';
          g.fillText(r.e.name, cx[0] + (ims[i] ? 32 : 0), cy, cx[1] - cx[0] - 40);
          [[r.sA, 1, 0, a], [r.sB, 2, 1, b]].forEach(([sm, ci, k, gg]) => {
            if (!sm) { g.fillStyle = '#6b6b74'; g.font = `700 18px ${font}`; g.fillText('—', cx[ci], cy - 6); g.font = `11px ${font}`; g.fillText(gg.stealth ? LL('sigilo', 'stealth') : LL('sin pulls', 'no pulls'), cx[ci], cy + 11); return; }
            g.fillStyle = NAME_COL[k]; g.font = `700 19px ${font}`; g.fillText(num(sm.n, 0), cx[ci], cy - 6);
            const nw = g.measureText(num(sm.n, 0)).width;
            g.fillStyle = '#c9c9d1'; g.font = `12px ${font}`; g.fillText(sm.killed ? LL('trys', 'tries') : LL('trys, sin kill', 'tries, no kill'), cx[ci] + nw + 6, cy - 5);
            g.fillStyle = '#9a9aa3'; g.font = `11px ${font}`; g.fillText(cellTxt(sm), cx[ci], cy + 11, 222);
          });
          const d = diffTxt(r, a, b);
          g.fillStyle = d.c || '#9a9aa3'; g.font = `600 12.5px ${font}`; g.fillText(d.t, cx[3], cy, W - cx[3] - pad);
        });
        g.fillStyle = '#5d6572'; g.font = `11px ${font}`; g.textAlign = 'right'; g.fillText('WipeTime', W - pad, H - 12);
        try { cv.toBlob((bl) => resolve(bl), 'image/png'); } catch { resolve(null); }
      });
    });
    let blob = await draw(true);
    if (!blob) blob = await draw(false);
    if (!blob) return toast(LL('No se pudo crear la imagen', 'Could not create the image'));
    if (mode === 'save') {
      const el = document.createElement('a');
      el.href = URL.createObjectURL(blob);
      el.download = `WipeTime - ${a.name} vs ${b.name} - ${zone.name}.png`.replace(/[\\/:*?"<>|]/g, '-');
      el.click();
      setTimeout(() => URL.revokeObjectURL(el.href), 4000);
      return toast(LL('Imagen guardada', 'Image saved'));
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(LL('Imagen copiada: ya puedes pegarla', 'Image copied: you can paste it now'));
    } catch { toast(LL('No se pudo copiar; usa Guardar PNG', 'Could not copy; use Save PNG')); }
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
    g = { ...g };
    st.sel[i] = g;
    st.res[i] = null;
    st.msg[i] = '';
    st.open.clear();
    repaint();
    gql(`query($n:String!,$s:String!,$r:String!){guildData{guild(name:$n,serverSlug:$s,serverRegion:$r){stealthMode}}}`, { n: g.name, s: g.realmSlug, r: g.region.toUpperCase() })
      .then((d) => { g.stealth = !!d.guildData?.guild?.stealthMode; }).catch(() => {}).finally(() => { refresh(); });
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
    else if (a === 'copy' || a === 'save') exportImage(a);
    else if (a === 'row') { const id = Number(el.dataset.e); if (st.open.has(id)) st.open.delete(id); else st.open.add(id); repaint(); }
  });

  return { html };
})();
