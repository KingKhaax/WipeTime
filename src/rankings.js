'use strict';
// Clasificaciones: ranking de parses del intento seleccionado, de los pulls combinados o de todos los intentos del jefe,
// con filtros por clase y rol y distintos órdenes. Un jugador de varios intentos se agrupa (parse medio, DPS/HPS sobre el tiempo total).
(() => {
  Object.assign(STRINGS.es.tabs, { rankings: 'Clasificaciones' });
  Object.assign(STRINGS.en.tabs, { rankings: 'Rankings' });

  const TANK_SPECS = new Set(['Blood', 'Vengeance', 'Guardian', 'Brewmaster', 'Protection']);
  const rk = { scope: 'sel', sort: 'parse-desc', cls: '', metric: 'dmg', view: 'wcl', tab: 'dmg' };
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

  // ---------------------------------------------------------------- vista con el formato de Warcraft Logs
  // Ranking de ejecución, ranking de velocidad y clasificación de jugadores (Daño · Sanación · Daño al jefe) del intento (kill) elegido.
  function rankFull(raw) {
    return cached(`rankfull:${raw.id}`, async () => {
      try {
        const d = await gql(`query($code:String!,$f:[Int]){reportData{report(code:$code){
          dps:rankings(fightIDs:$f,playerMetric:dps) hps:rankings(fightIDs:$f,playerMetric:hps) bd:rankings(fightIDs:$f,playerMetric:bossdps)
          dpsP:rankings(fightIDs:$f,playerMetric:dps,compare:Parses) hpsP:rankings(fightIDs:$f,playerMetric:hps,compare:Parses) bdP:rankings(fightIDs:$f,playerMetric:bossdps,compare:Parses)}}}`, { code: S.code, f: [raw.id] }, true);
        const r = d.reportData.report;
        const one = (x) => x?.data?.[0] || null;
        const out = { dps: one(mergeRankings(r.dps, r.dpsP)), hps: one(mergeRankings(r.hps, r.hpsP)), bd: one(mergeRankings(r.bd, r.bdP)) };
        const chars = Object.values(out.dps?.roles || {}).flatMap((ro) => ro?.characters || []);
        // valores provisionales (sin parses totales): no se dan por buenos, la próxima vez se vuelven a pedir
        if (!out.dps || !chars.length || chars.some((c) => !c.totalParses)) setTimeout(() => S.cache.delete(`rankfull:${raw.id}`), 0);
        else if (S.liveReport) setTimeout(() => S.cache.delete(`rankfull:${raw.id}`), 60000);
        return out;
      } catch (e) {
        console.warn('rankFull', e);
        setTimeout(() => S.cache.delete(`rankfull:${raw.id}`), 0);
        return { dps: null, hps: null, bd: null };
      }
    });
  }

  const nf = (n) => Number(n).toLocaleString(locale());
  // posición: puede venir como número o como «~1125» (aproximada)
  const fmtRank = (v) => {
    if (v == null || v === '-' || v === '') return '–';
    const m = String(v).match(/^(~?)(\d+)$/);
    return m ? m[1] + nf(m[2]) : String(v);
  };
  const pctCell = (v) => (typeof v === 'number' ? `<span class="wl-pct" style="color:${parseColor(v)}">${Math.floor(v)}</span>` : '<span class="wl-muted">–</span>');
  const ilvlFmt = (v) => (v == null ? '–' : Number.isInteger(v) ? String(v) : num(v, 1));
  const guildColor = (g) => (g?.faction === 1 ? '#e5484d' : '#4da3ff');

  // ---------------------------------------------------------------- exportar la clasificación como imagen (copiar o guardar PNG)
  let lastWcl = null;

  function exportWcl(mode) {
    const D = lastWcl;
    if (!D) return toast(LL('No hay nada que exportar', 'Nothing to export'));
    const W = 1180, pad = 24, scale = 2, rowH = 32, headH = 30;
    const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
    // alto total
    const secs = D.sections;
    let H = 112 + pad;
    for (const s of secs) H += 34 + headH + s.rows.length * rowH + 14;
    const draw = (withIcons) => new Promise((resolve) => {
      const cv = document.createElement('canvas');
      cv.width = W * scale; cv.height = H * scale;
      const g = cv.getContext('2d');
      g.scale(scale, scale);
      g.fillStyle = '#0f1013'; g.fillRect(0, 0, W, H);
      g.textBaseline = 'middle';
      g.fillStyle = '#8b93a1'; g.font = `12px ${font}`; g.fillText(D.eyebrow.toUpperCase().slice(0, 150), pad, 26);
      g.fillStyle = '#ffffff'; g.font = `700 28px ${font}`; g.fillText(D.title, pad, 58);
      g.fillStyle = '#b4bac6'; g.font = `14px ${font}`; g.fillText(D.sub.slice(0, 170), pad, 88);
      const loads = new Map();
      if (withIcons) for (const s of secs) for (const r of s.rows) if (r.icon && !loads.has(r.icon)) loads.set(r.icon, new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = r.icon; }));
      Promise.all([...loads.entries()].map(async ([k, p]) => [k, await p])).then((arr) => {
        const imgs = new Map(arr);
        let y = 112;
        for (const s of secs) {
          g.fillStyle = '#eef1f7'; g.font = `700 16px ${font}`; g.textAlign = 'left'; g.fillText(s.title, pad, y + 12);
          y += 34;
          const fixed = s.cols.filter((c) => c.w).reduce((a, c) => a + c.w, 0);
          const flex = W - 2 * pad - fixed;
          let x = pad;
          const xs = s.cols.map((c) => { const w = c.w || flex; const o = { x, w }; x += w; return o; });
          g.fillStyle = '#17191f'; g.fillRect(pad, y, W - 2 * pad, headH);
          g.fillStyle = '#9aa3b2'; g.font = `700 11px ${font}`;
          s.cols.forEach((c, i) => {
            const b = xs[i];
            g.textAlign = c.align === 'center' ? 'center' : c.align === 'left' ? 'left' : 'right';
            const tx = c.align === 'center' ? b.x + b.w / 2 : c.align === 'left' ? b.x + 10 : b.x + b.w - 10;
            g.fillText(c.label.toUpperCase(), tx, y + headH / 2);
          });
          y += headH;
          s.rows.forEach((r, ri) => {
            g.fillStyle = ri % 2 ? '#13151a' : '#0f1013'; g.fillRect(pad, y, W - 2 * pad, rowH);
            if (r.me) { g.fillStyle = 'rgba(77,163,255,.14)'; g.fillRect(pad, y, W - 2 * pad, rowH); }
            s.cols.forEach((c, i) => {
              const cell = r.cells[c.k];
              if (cell == null) return;
              const b = xs[i];
              const txt = typeof cell === 'object' ? cell.t : cell;
              const color = typeof cell === 'object' && cell.color ? cell.color : '#dfe3ec';
              g.fillStyle = color;
              g.font = `${typeof cell === 'object' && cell.bold ? 700 : 400} ${c.k === 'pct' || c.k === 'pcti' ? 15 : 14}px ${font}`;
              g.textAlign = c.align === 'center' ? 'center' : c.align === 'left' ? 'left' : 'right';
              let tx = c.align === 'center' ? b.x + b.w / 2 : c.align === 'left' ? b.x + 10 : b.x + b.w - 10;
              if (c.k === 'player') {
                const im = r.icon && imgs.get(r.icon);
                if (im) g.drawImage(im, tx, y + 3, 26, 26); else { g.fillStyle = r.color || '#888'; g.beginPath(); g.arc(tx + 13, y + rowH / 2, 6, 0, 7); g.fill(); }
                g.fillStyle = r.color || color; g.font = `600 14px ${font}`;
                g.fillText(txt, tx + 36, y + rowH / 2, b.w - 150);
                if (r.server) { g.fillStyle = '#7f8794'; g.font = `12px ${font}`; g.textAlign = 'right'; g.fillText(r.server, b.x + b.w - 10, y + rowH / 2); }
              } else g.fillText(txt, tx, y + rowH / 2, b.w - 14);
            });
            y += rowH;
          });
          y += 14;
        }
        g.fillStyle = '#5d6572'; g.font = `11px ${font}`; g.textAlign = 'right'; g.fillText('WipeTime · datos de Warcraft Logs', W - pad, H - 10);
        try { cv.toBlob((b) => resolve(b), 'image/png'); } catch { resolve(null); }
      });
    });
    return (async () => {
      let blob = await draw(true);
      if (!blob) blob = await draw(false);
      if (!blob) return toast(LL('No se pudo crear la imagen', 'Could not create the image'));
      if (mode === 'save') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `WipeTime - ${D.title}.png`.replace(/[\\/:*?"<>|]/g, '-');
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        return toast(LL('Imagen guardada', 'Image saved'));
      }
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast(LL('Imagen copiada: ya puedes pegarla', 'Image copied: you can paste it now'));
      } catch { toast(LL('No se pudo copiar; usa Guardar PNG', 'Could not copy; use Save PNG')); }
    })();
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest?.('[data-action="export-wcl"]');
    if (b) exportWcl(b.dataset.m);
  });

  async function viewWcl(f) {
    const raw = S.fight;
    const all = await rankFull(raw);
    const fd = all.dps;
    if (!fd) return null;
    const tab = ['dmg', 'heal', 'boss'].includes(rk.tab) ? rk.tab : 'dmg';
    const src = tab === 'heal' ? all.hps : tab === 'boss' ? all.bd : all.dps;
    const roles = src?.roles || fd.roles || {};
    const unit = tab === 'heal' ? 'HPS' : 'DPS';
    const chip = (attr, v, label, on) => `<button class="chip ${on ? 'on' : ''}" data-rk="${attr}" data-v="${esc(v)}">${label}</button>`;
    const th = (cells) => `<div class="wl-row th">${cells.map(([l, cls]) => `<span class="${cls || ''}">${l}</span>`).join('')}</div>`;
    const table = (cols, head, rows) => `<div class="wl-wrap"><div class="wl-table" style="--wl-cols:${cols}">${th(head)}${rows}</div></div>`;
    const g = fd.guild;
    const guildCell = g?.name ? `<span class="wl-l wl-guild" style="color:${guildColor(g)}">${esc(g.name)}</span>` : '<span class="wl-l wl-muted">–</span>';
    const hdrPos = [[LL('% rango', 'Rank %'), 'wl-c'], [LL('Rango', 'Rank')], [LL('De', 'Out of')], [LL('Mejor rango', 'Best rank')]];
    const posCells = (x) => `<span class="wl-c">${pctCell(x?.rankPercent)}</span><span>${fmtRank(x?.rank)}</span><span class="wl-muted">${x?.totalParses != null ? nf(x.totalParses) : '–'}</span><span class="wl-muted">${fmtRank(x?.best)}</span>`;

    // ---- ejecución y velocidad
    const exec = table('78px 84px 84px 100px minmax(180px,1fr) 80px 150px 80px',
      [...hdrPos, [LL('Hermandad', 'Guild'), 'wl-l'], [LL('Muertes', 'Deaths')], [LL('Daño recibido', 'Damage taken')], ['Ilvl']],
      `<div class="wl-row">${posCells(fd.execution)}${guildCell}<span>${fd.deaths ?? '–'}</span><span class="wl-dps">${fd.damageTakenExcludingTanks != null ? nf(fd.damageTakenExcludingTanks) : '–'}</span><span>${ilvlFmt(fd.bracketData)}</span></div>`);
    const speed = table('78px 84px 84px 100px minmax(180px,1fr) 90px 80px',
      [...hdrPos, [LL('Hermandad', 'Guild'), 'wl-l'], [LL('Duración', 'Duration')], ['Ilvl']],
      `<div class="wl-row">${posCells(fd.speed)}${guildCell}<span class="wl-dps">${clock(fd.duration ?? (raw.endTime - raw.startTime))}</span><span>${ilvlFmt(fd.bracketData)}</span></div>`);

    // ---- jugadores
    const actorByName = new Map([...S.actors.values()].filter((a) => a.type === 'Player').map((a) => [a.name, a]));
    const playerRow = (c) => {
      const color = classColor(c.class);
      const icon = c.spec ? `${c.class}-${c.spec}` : c.class;
      const a = actorByName.get(c.name);
      const me = isMe(c.name);
      const click = a && !S.viewCombined;
      const srv = c.server?.name ? `${esc(c.server.name)}${c.server.region ? ` (${esc(c.server.region)})` : ''}` : '';
      return `<div class="wl-row ${me ? 'me' : ''} ${click ? 'click' : ''}" ${click ? `data-action="player" data-id="${a.id}"` : ''}>
        <span class="wl-c">${pctCell(c.rankPercent)}</span><span>${fmtRank(c.rank)}</span><span class="wl-muted">${c.totalParses != null ? nf(c.totalParses) : '–'}</span><span class="wl-muted">${fmtRank(c.best)}</span>
        <span class="wl-player"><img src="${specIconUrl(esc(icon))}" width="26" height="26" alt="" style="--cc:${color}"><b style="color:${color}">${esc(c.name)}</b>${me ? `<span class="you">${t('you')}</span>` : ''}<span class="wl-srv">${srv}</span></span>
        <span class="wl-dps">${c.amount != null ? num(c.amount, 1) : '–'}</span><span class="wl-muted">${ilvlFmt(c.bracketData)}</span><span class="wl-c">${pctCell(c.bracketPercent)}</span></div>`;
    };
    const ROLE_ORDER = tab === 'heal' ? ['healers', 'tanks', 'dps'] : ['dps', 'tanks', 'healers'];
    const ROLE_TITLE = { dps: LL('Dañadores', 'Damage dealers'), tanks: LL('Tanques', 'Tanks'), healers: LL('Sanadores', 'Healers') };
    const ROLE_KEY = { dps: 'dps', tanks: 'tank', healers: 'healer' };
    const playerCols = '78px 84px 84px 100px minmax(240px,1fr) 130px 70px 76px';
    const playerHead = [...hdrPos, [LL('Jugador', 'Player'), 'wl-l'], [unit], ['Ilvl'], ['Ilvl %', 'wl-c']];
    const blocks = ROLE_ORDER.map((role) => {
      const list = [...(roles[role]?.characters || [])].sort((a, b) => (b.rankPercent ?? -1) - (a.rankPercent ?? -1) || (b.amount || 0) - (a.amount || 0));
      if (!list.length) return '';
      return `<h4 class="wl-sec">${Extras.roleIcon(ROLE_KEY[role])}<span>${ROLE_TITLE[role]}</span><small>${list.length}</small></h4>${table(playerCols, playerHead, list.map(playerRow).join(''))}`;
    }).join('');

    // datos para exportar la clasificación como imagen
    const posData = (x) => ({
      pct: { t: typeof x?.rankPercent === 'number' ? String(Math.floor(x.rankPercent)) : '–', color: typeof x?.rankPercent === 'number' ? parseColor(x.rankPercent) : '#888', bold: true },
      rank: fmtRank(x?.rank), outof: x?.totalParses != null ? nf(x.totalParses) : '–', best: fmtRank(x?.best),
    });
    const posCols = [{ k: 'pct', label: LL('% rango', 'Rank %'), w: 78, align: 'center' }, { k: 'rank', label: LL('Rango', 'Rank'), w: 84 }, { k: 'outof', label: LL('De', 'Out of'), w: 84 }, { k: 'best', label: LL('Mejor rango', 'Best rank'), w: 100 }];
    const gCell = { t: g?.name || '–', color: g?.name ? guildColor(g) : '#888', bold: true };
    const secs = [
      { title: LL('Ranking de ejecución', 'Execution ranking'), cols: [...posCols, { k: 'guild', label: LL('Hermandad', 'Guild'), align: 'left' }, { k: 'deaths', label: LL('Muertes', 'Deaths'), w: 80 }, { k: 'taken', label: LL('Daño recibido', 'Damage taken'), w: 150 }, { k: 'ilvl', label: 'Ilvl', w: 80 }],
        rows: [{ cells: { ...posData(fd.execution), guild: gCell, deaths: String(fd.deaths ?? '–'), taken: { t: fd.damageTakenExcludingTanks != null ? nf(fd.damageTakenExcludingTanks) : '–', color: '#a8e060', bold: true }, ilvl: ilvlFmt(fd.bracketData) } }] },
      { title: LL('Ranking de velocidad', 'Speed ranking'), cols: [...posCols, { k: 'guild', label: LL('Hermandad', 'Guild'), align: 'left' }, { k: 'dur', label: LL('Duración', 'Duration'), w: 100 }, { k: 'ilvl', label: 'Ilvl', w: 80 }],
        rows: [{ cells: { ...posData(fd.speed), guild: gCell, dur: { t: clock(fd.duration ?? (raw.endTime - raw.startTime)), color: '#a8e060', bold: true }, ilvl: ilvlFmt(fd.bracketData) } }] },
    ];
    for (const role of ROLE_ORDER) {
      const list = [...(roles[role]?.characters || [])].sort((a, b) => (b.rankPercent ?? -1) - (a.rankPercent ?? -1) || (b.amount || 0) - (a.amount || 0));
      if (!list.length) continue;
      secs.push({
        title: `${ROLE_TITLE[role]} (${list.length})`,
        cols: [...posCols, { k: 'player', label: LL('Jugador', 'Player'), align: 'left' }, { k: 'dps', label: unit, w: 130 }, { k: 'ilvl', label: 'Ilvl', w: 70 }, { k: 'pcti', label: 'Ilvl %', w: 76, align: 'center' }],
        rows: list.map((c) => ({
          me: isMe(c.name), icon: specIconUrl(c.spec ? `${c.class}-${c.spec}` : c.class), color: classColor(c.class), server: c.server?.name ? `${c.server.name}${c.server.region ? ` (${c.server.region})` : ''}` : '',
          cells: { ...posData(c), player: c.name, dps: { t: c.amount != null ? num(c.amount, 1) : '–', color: '#a8e060', bold: true }, ilvl: ilvlFmt(c.bracketData),
            pcti: { t: typeof c.bracketPercent === 'number' ? String(Math.floor(c.bracketPercent)) : '–', color: typeof c.bracketPercent === 'number' ? parseColor(c.bracketPercent) : '#888', bold: true } },
        })),
      });
    }
    lastWcl = {
      eyebrow: `${fd.encounter?.name || raw.name} · ${diffName(raw.difficulty)} · ${clock(fd.duration ?? (raw.endTime - raw.startTime))}`,
      title: `${t('tabs.rankings')} · ${tab === 'heal' ? LL('Sanación', 'Healing') : tab === 'boss' ? LL('Daño al jefe', 'Boss damage') : LL('Daño', 'Damage')}`,
      sub: `${fd.encounter?.name || raw.name} · ${LL('tamaño', 'size')} ${fd.size ?? '–'} · ${new Date(S.report?.startTime || Date.now()).toLocaleDateString(locale())}`,
      sections: secs,
    };
    const expBtns = `<span class="grow"></span><button class="chip" data-action="export-wcl" data-m="copy" title="${esc(LL('Copiar la clasificación como imagen', 'Copy the ranking as an image'))}">📋 ${LL('Copiar imagen', 'Copy image')}</button><button class="chip" data-action="export-wcl" data-m="save">💾 ${LL('Guardar PNG', 'Save PNG')}</button>`;
    const viewBar = `<div class="metricbar"><span class="muted">${LL('Vista', 'View')}</span>${chip('view', 'wcl', LL('Formato Warcraft Logs', 'Warcraft Logs format'), true)}${chip('view', 'adv', LL('Vista avanzada (varios intentos, filtros)', 'Advanced view (several pulls, filters)'), false)}${expBtns}</div>`;
    const tabs = `<div class="metricbar wl-tabs"><span class="muted">${LL('Clasificación de jugadores', 'Player rankings')}</span>${chip('tab', 'dmg', LL('Daño', 'Damage'), tab === 'dmg')}${chip('tab', 'heal', LL('Sanación', 'Healing'), tab === 'heal')}${chip('tab', 'boss', LL('Daño al jefe', 'Boss damage'), tab === 'boss')}</div>`;
    const sub = LL(`<b>${esc(fd.encounter?.name || raw.name)}</b> · ${esc(diffName(raw.difficulty))} · tamaño ${fd.size ?? '–'} · datos de Warcraft Logs`, `<b>${esc(fd.encounter?.name || raw.name)}</b> · ${esc(diffName(raw.difficulty))} · size ${fd.size ?? '–'} · data from Warcraft Logs`);
    return headerHTML(f, t('tabs.rankings'), sub) + viewBar
      + `<h3 class="wl-sec">${LL('Ranking de ejecución', 'Execution ranking')}</h3>${exec}`
      + `<h3 class="wl-sec">${LL('Ranking de velocidad', 'Speed ranking')}</h3>${speed}`
      + tabs + blocks
      + `<p class="foot">${LL('Posiciones y porcentajes tal como los calcula Warcraft Logs para este kill; «~» indica posición aproximada. Para varios intentos, wipes o filtros por clase usa la vista avanzada.', 'Positions and percentages as Warcraft Logs computes them for this kill; “~” means an approximate position. For several pulls, wipes or class filters use the advanced view.')}</p>`;
  }

  const METRICS = [['dmg', 'Daño', 'Damage'], ['heal', 'Sanación', 'Healing'], ['boss', 'Daño al jefe', 'Boss damage']];

  async function viewRankings(f) {
    const canWcl = !f.combined && !!S.fight?.kill && !!S.fight?.encounterID && f.full !== false && rk.scope === 'sel';
    if (rk.view !== 'adv' && canWcl) {
      const html = await viewWcl(f);
      if (html) return html;
    }
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
    const viewBar = canWcl ? `<div class="metricbar"><span class="muted">${LL('Vista', 'View')}</span>${chip('view', 'wcl', LL('Formato Warcraft Logs', 'Warcraft Logs format'), false)}${chip('view', 'adv', LL('Vista avanzada', 'Advanced view'), true)}</div>` : '';
    const bar = viewBar + `<div class="metricbar"><span class="muted">${LL('Clasificación por', 'Rank by')}</span>${METRICS.map(([k, es, en]) => chip('metric', k, LL(es, en), rk.metric === k)).join('')}
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
        <span class="rk-who">${r.icon && r.icon.includes('-') ? `<img class="spec-ic-sm" src="${specIconUrl(esc(r.icon))}" width="26" height="26" alt="" style="--cc:${color}">` : `<img class="spec-ic-sm" src="${classIconUrl(r.cls)}" width="26" height="26" alt="" style="--cc:${color}">`}<b style="color:${color}">${esc(r.name)}</b></span>
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
