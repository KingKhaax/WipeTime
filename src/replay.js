'use strict';

// Replay: reproduce la pelea sobre un radar 2D a partir de los eventos con posición del log.
// Las coordenadas del log van en centésimas de yarda (100 unidades = 1 yd). El campo "facing"
// del log no coincide con la dirección real de movimiento, así que no se dibuja orientación.
const Replay = (() => {
  const SPEEDS = [0.5, 1, 2, 4];
  const BOSS_COLORS = ['#f0646f', '#f0a23b', '#a77bf3'];
  const HOLD_MS = { player: 8000, pet: 6000, npc: 6000, boss: 30000 };
  const INTERP_MS = 6000;
  const UNITS_PER_YD = 100;
  const imgCache = new Map();
  let R = null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function loadImg(src) {
    let e = imgCache.get(src);
    if (!e) {
      e = { img: new Image(), ok: false };
      e.img.onload = () => { e.ok = true; if (R) R.dirty = true; };
      e.img.src = src;
      imgCache.set(src, e);
    }
    return e.ok ? e.img : null;
  }

  function kindOf(id) {
    const a = S.actors.get(id);
    if (!a) return null;
    if (a.type === 'Player') return 'player';
    if (a.type === 'Pet') return 'pet';
    return a.subType === 'Boss' ? 'boss' : 'npc';
  }

  const fullWin = (raw) => ({
    ...raw, fightStart: raw.startTime, fightEnd: raw.endTime, full: true,
    key: `${raw.id}:${raw.startTime}-${raw.endTime}`, rangeLabel: '',
  });

  // ------------------------------------------------------------ datos
  function load(raw, onProgress) {
    return cached(`replay:${raw.id}`, async () => {
      const tr = new Map();
      const dmg = new Map();
      let count = 0;

      const stream = (type, isDmg) => Promise.all(timeChunks(raw.startTime, raw.endTime, 4, 45000).map(({ s: s0, e: e0, last }) => streamChunk(type, isDmg, s0, e0, last)));
      const streamChunk = async (type, isDmg, s0, e0, last) => {
        let start = s0;
        for (let page = 0; page < 60; page++) {
          const d = await gql(`query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){
            events(fightIDs:$f,startTime:$s,endTime:$e,dataType:${type},limit:10000,includeResources:true){data nextPageTimestamp}}}}`,
          { code: S.code, f: [raw.id], s: start, e: e0 });
          const ev = d.reportData.report.events;
          const data = (ev?.data || []).filter((x) => last || x.timestamp < e0);
          for (const e of data) {
            if (e.x != null) {
              const id = e.resourceActor === 1 ? e.sourceID : e.targetID;
              const inst = e.resourceActor === 1 ? e.sourceInstance : e.targetInstance;
              const key = inst != null && kindOf(id) && kindOf(id) !== 'player' ? `${id}#${inst}` : id;
              let tk = tr.get(key);
              if (!tk) { tk = { t: [], x: [], y: [], hp: [], mx: [], map: [] }; tr.set(key, tk); }
              tk.t.push(e.timestamp); tk.x.push(e.x); tk.y.push(e.y);
              tk.hp.push(e.hitPoints ?? -1); tk.mx.push(e.maxHitPoints ?? -1); tk.map.push(e.mapID ?? 0);
            }
            if (isDmg && e.type === 'damage' && !isPlayer(e.targetID)) {
              const owner = ownerOf(e.sourceID);
              let m = dmg.get(owner);
              if (!m) { m = { t: [], v: [] }; dmg.set(owner, m); }
              m.t.push(e.timestamp); m.v.push(e.amount || 0);
            }
          }
          count += data.length;
          onProgress?.(count);
          if (!ev?.nextPageTimestamp || ev.nextPageTimestamp <= start) break;
          start = ev.nextPageTimestamp;
        }
      };
      await Promise.all([stream('Casts'), stream('DamageTaken'), stream('DamageDone', true)]);

      // Un solo sistema de coordenadas: el mapa donde estuvo la mayoría de jugadores
      const mapCount = new Map();
      for (const [id, tk] of tr) if (kindOf(id) === 'player') for (const m of tk.map) mapCount.set(m, (mapCount.get(m) || 0) + 1);
      const mainMap = [...mapCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

      const tracks = new Map();
      for (const [key, tk] of tr) {
        const id = typeof key === 'string' ? Number(key.split('#')[0]) : key;
        const kind = kindOf(id);
        if (!kind) continue;
        const order = tk.t.map((_, i) => i).filter((i) => mainMap == null || tk.map[i] === mainMap).sort((a, b) => tk.t[a] - tk.t[b]);
        const keep = [];
        for (const i of order) if (!keep.length || tk.t[i] !== tk.t[keep[keep.length - 1]]) keep.push(i);
        if (keep.length < (kind === 'player' ? 2 : 4)) continue;
        tracks.set(key, {
          id, key, kind,
          t: Float64Array.from(keep, (i) => tk.t[i]), x: Float64Array.from(keep, (i) => tk.x[i]), y: Float64Array.from(keep, (i) => tk.y[i]),
          hp: Float64Array.from(keep, (i) => tk.hp[i]), mx: Float64Array.from(keep, (i) => tk.mx[i]),
        });
      }

      let bossHp = 0;
      for (const tk of tracks.values()) if (tk.kind === 'boss') for (const v of tk.mx) if (v > bossHp) bossHp = v;
      for (const tk of tracks.values()) {
        if (tk.kind !== 'npc') continue;
        const life = tk.t[tk.t.length - 1] - tk.t[0];
        let maxHp = 0;
        for (const v of tk.mx) if (v > maxHp) maxHp = v;
        const f = maxHp > 0 && bossHp > 0 ? maxHp / bossHp : null;
        let tier = 'minor';
        if (f != null) {
          if (f >= 0.02 || (f >= 0.005 && life >= 15000)) tier = 'major';
          else if (f >= 0.002 || (life >= 8000 && tk.t.length >= 25)) tier = 'medium';
        } else if (life >= 40000 && tk.t.length >= 100) tier = 'major';
        else if (tk.t.length >= 20) tier = 'medium';
        tk.tier = tier;
        tk.life = life;
      }

      const meters = new Map();
      for (const [id, m] of dmg) {
        const order = m.t.map((_, i) => i).sort((a, b) => m.t[a] - m.t[b]);
        const t = new Float64Array(order.length);
        const c = new Float64Array(order.length);
        let s = 0;
        order.forEach((i, k) => { s += m.v[i]; t[k] = m.t[i]; c[k] = s; });
        meters.set(id, { t, c });
      }

      // Límites de la arena: percentiles 2–98 de las posiciones de jugadores
      const xs = [];
      const ys = [];
      for (const tk of tracks.values()) if (tk.kind === 'player') for (let i = 0; i < tk.t.length; i++) { xs.push(tk.x[i]); ys.push(tk.y[i]); }
      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      const pc = (a, p) => a[Math.floor((a.length - 1) * p)];
      let bounds = null;
      if (xs.length) {
        const x0 = pc(xs, 0.02); const x1 = pc(xs, 0.98); const y0 = pc(ys, 0.02); const y1 = pc(ys, 0.98);
        bounds = {
          cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
          spanX: Math.max((x1 - x0) * 1.22, 2500), spanY: Math.max((y1 - y0) * 1.22, 2500),
        };
      }
      return { tracks, meters, bounds, events: count, mainMap: mainMap ?? 0 };
    });
  }

  async function loadExtras(raw) {
    const fw = fullWin(raw);
    const [deaths, pi, util, shields] = await Promise.allSettled([deathsData(fw), piData(fw), utilityData(fw), shieldData(fw)]);
    return {
      deaths: deaths.status === 'fulfilled' ? deaths.value : [],
      pi: pi.status === 'fulfilled' ? pi.value : [],
      util: util.status === 'fulfilled' ? util.value : { dispels: [], interrupts: [] },
      shields: shields.status === 'fulfilled' ? shields.value : [],
    };
  }

  // ------------------------------------------------------------ muestreo
  function sample(tk, T) {
    const t = tk.t;
    const n = t.length;
    if (T < t[0]) return { x: tk.x[0], y: tk.y[0], hp: tk.hp[0], mx: tk.mx[0], stale: true };
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (t[mid] <= T) lo = mid; else hi = mid - 1;
    }
    const i = lo;
    const hold = tk.tier === 'major' ? 15000 : HOLD_MS[tk.kind];
    if (i === n - 1) return { x: tk.x[i], y: tk.y[i], hp: tk.hp[i], mx: tk.mx[i], stale: T - t[i] > hold, age: T - t[i] };
    const gap = t[i + 1] - t[i];
    if (gap <= INTERP_MS) {
      const k = (T - t[i]) / gap;
      return { x: tk.x[i] + (tk.x[i + 1] - tk.x[i]) * k, y: tk.y[i] + (tk.y[i + 1] - tk.y[i]) * k, hp: tk.hp[i], mx: tk.mx[i], stale: false, age: 0 };
    }
    return { x: tk.x[i], y: tk.y[i], hp: tk.hp[i], mx: tk.mx[i], stale: T - t[i] > hold, age: T - t[i] };
  }

  function cumAt(m, T) {
    if (!m) return 0;
    let lo = 0;
    let hi = m.t.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (m.t[mid] <= T) lo = mid + 1; else hi = mid;
    }
    return lo ? m.c[lo - 1] : 0;
  }

  function deathAt(id, T) {
    const list = R.deathsBy.get(id);
    if (!list) return null;
    let d = null;
    for (const x of list) if (x.timestamp <= T) d = x; else break;
    if (!d) return null;
    const tk = R.data.tracks.get(id);
    if (tk) { // resucitado: hay posiciones con vida positiva claramente después de morir
      const s = sample(tk, T);
      if (s.age != null && s.age < 1500 && s.hp > 0 && T - d.timestamp > 2500) return null;
    }
    return d;
  }

  // Radar con el norte arriba: a la derecha crece x del registro y hacia arriba crece y (convención de los mapas de RaidPlan)
  const toScreen = (x, y) => [R.cw / 2 + (x - R.vcx) * R.scale, R.ch / 2 - (y - R.vcy) * R.scale];

  // ------------------------------------------------------------ montaje
  async function mount(f, seq) {
    const root = $('#rpRoot');
    if (!root) return;
    const raw = S.fight;
    let data;
    try {
      data = await load(raw, (n) => { const p = $('#rpProg'); if (p) p.textContent = t('replayLoading', { n: n.toLocaleString(locale()) }); });
    } catch (e) {
      if (seq === S.seq) root.innerHTML = errorHTML(friendlyError(e));
      return;
    }
    if (seq !== S.seq || !$('#rpRoot')) return;
    if (!data.bounds) { root.innerHTML = `<div class="empty">${t('replayNoPos')}</div>`; return; }
    const extras = await loadExtras(raw);
    if (seq !== S.seq || !$('#rpRoot')) return;

    const deathsBy = new Map();
    for (const d of extras.deaths) {
      if (!deathsBy.has(d.targetID)) deathsBy.set(d.targetID, []);
      deathsBy.get(d.targetID).push(d);
    }
    const phases = phaseSegments(raw);
    const feed = [];
    for (const p of phases) feed.push({ t: p.start, kind: 'phase', name: p.name });
    for (const d of extras.deaths) feed.push({ t: d.timestamp, kind: 'death', d });
    for (const p of extras.pi) feed.push({ t: p.start, kind: 'pi', p });
    for (const e of extras.util.dispels) feed.push({ t: e.timestamp, kind: 'dispel', e });
    for (const e of extras.util.interrupts) feed.push({ t: e.timestamp, kind: 'interrupt', e });
    const raidSize = [...data.tracks.values()].filter((tk) => tk.kind === 'player').length;
    const wipe = wipeAnalysis(fullWin(raw), extras.deaths, raidSize);
    if (wipe && wipe.kind !== 'attrition') feed.push({ t: wipe.t, kind: 'wipe', w: wipe });
    const spawnsByNpc = new Map();
    for (const tk of data.tracks.values()) {
      if (tk.kind !== 'npc' || tk.tier !== 'major') continue;
      if (!spawnsByNpc.has(tk.id)) spawnsByNpc.set(tk.id, []);
      spawnsByNpc.get(tk.id).push(tk.t[0]);
    }
    for (const [npcId, times] of spawnsByNpc) {
      times.sort((a, b) => a - b);
      let cluster = null;
      for (const ts of times) {
        if (cluster && ts - cluster.last <= 3000) { cluster.count++; cluster.last = ts; continue; }
        cluster = { t: ts, last: ts, count: 1, npcId };
        feed.push({ t: ts, kind: 'add', cluster });
      }
    }
    feed.sort((a, b) => a.t - b.t);

    const bosses = [...data.tracks.values()].filter((tk) => tk.kind === 'boss' && tk.mx.some((v) => v > 0))
      .sort((a, b) => b.t.length - a.t.length).slice(0, 3);

    R = {
      raw, f, data, deathsBy, feed, phases, bosses, wipe,
      shields: extras.shields, pi: extras.pi,
      W0: f.startTime, W1: f.endTime, T: f.startTime,
      playing: false, speed: Number(WCSettings.get('rpSpeed')) || 1, lastNow: performance.now(), lastUi: 0, dirty: true,
      show: { player: true, pet: !!WCSettings.get('rpPets'), boss: true, npc: true }, names: !!WCSettings.get('rpNames'), trails: !!WCSettings.get('rpTrails'),
      selected: null, hover: null, side: 'players', hits: [], tlHover: null,
      cw: 0, ch: 0, scale: 1, dpr: window.devicePixelRatio || 1,
      mapKey: `${raw.encounterID || 0}-${data.mainMap || 0}`,
      box: raw.boundingBox || null,
      map: { img: null, showImg: true, showGen: true, showBoss: true, panel: false, growing: '', calib: { ...CAL_DEFAULT },
        boss: { entries: [], entry: null, img: null, state: 'idle', approx: null, cal: null } },
      arena: null, floor: null, floorSig: '',
    };
    buildUI(root);
    bind();
    if (S.replaySeek != null) { // viene de "Ver el momento en el replay"
      R.T = clamp(S.replaySeek, R.W0, R.W1);
      S.replaySeek = null;
      $('#rpBig').hidden = true;
    }
    R.raf = requestAnimationFrame(frame);
    initMaps();
    // círculos rojos y registro para las mecánicas evitables marcadas en la pestaña Mecánicas
    if (typeof Extras !== 'undefined') {
      const mine = R;
      Extras.mechEvents(raw).then((list) => {
        if (R !== mine || !list.length) return;
        R.mech = list;
        for (const m of list) R.feed.push({ t: m.t, kind: 'mech', m });
        R.feed.sort((a, b) => a.t - b.t);
        R.dirty = true;
      }).catch((err) => console.warn('mech', err));
    }
  }

  function stop() {
    if (!R) return;
    cancelAnimationFrame(R.raf);
    clearTimeout(R.map?.saveTimer);
    R.ro?.disconnect();
    document.removeEventListener('keydown', R.onKey);
    document.removeEventListener('paste', R.onPaste);
    window.removeEventListener('pointermove', R.onPanMove);
    window.removeEventListener('pointerup', R.onPanUp);
    document.removeEventListener('fullscreenchange', R.onFs);
    R = null;
  }

  // ------------------------------------------------------------ interfaz
  const svgPlay = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
  const svgMap = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M9 4 3 6.500v13.500l6-2.500 6 2.500 6-2.500V4l-6 2.500zM9 4v13.500M15 6.500V20"/></svg>';
  const svgPause = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" fill="currentColor"/></svg>';

  function buildUI(root) {
    const total = R.W1 - R.raw.startTime;
    root.innerHTML = `<div class="rp-main" id="rpMain">
        <div class="rp-stage surface-dark" id="rpStage">
          <canvas id="rpCanvas"></canvas>
          <div class="rp-hud rp-tl" id="rpHudL"></div>
          <div class="rp-hud rp-tr" id="rpHudR"></div>
          <div class="rp-tip" id="rpTip" hidden></div>
          <div class="rp-mapnote" id="rpMapNote"></div>
          <div class="rp-mappanel" id="rpMapPanel" hidden></div>
          <button class="rp-big" id="rpBig" aria-label="Play">${svgPlay}</button>
        </div>
        <canvas id="rpTl" class="rp-timeline"></canvas>
        <div class="rp-bar">
          <button class="rp-play" id="rpPlay" aria-label="Play">${svgPlay}</button>
          <span class="rp-time"><b id="rpNow">0:00</b> / <span id="rpTotal">${clock(total)}</span></span>
          <div class="segs" id="rpSpeeds">${SPEEDS.map((s) => `<button data-rp-speed="${s}" class="${s === R.speed ? 'on' : ''}">${s}×</button>`).join('')}</div>
          <div class="rp-chips">
            ${[['player', 'rpPlayers'], ['pet', 'rpPets'], ['boss', 'rpBosses'], ['npc', 'rpNpcs']].map(([k, l]) =>
    `<button class="chip ${R.show[k] ? 'on' : ''}" data-rp-show="${k}"><span class="sq"></span>${t(l)}</button>`).join('')}
            <button class="chip ${R.names ? 'on' : ''}" data-rp-toggle="names"><span class="sq"></span>${t('rpNames')}</button>
            <button class="chip ${R.trails ? 'on' : ''}" data-rp-toggle="trails"><span class="sq"></span>${t('rpTrails')}</button>
          </div>
          <span class="grow"></span>
          <button class="btn ghost sm" data-rp-map="toggle" id="rpMapBtn">${svgMap} ${t('rpMap')}</button>
          <span class="rp-zoom"><button class="btn ghost sm" id="rpZoomOut" title="${esc(LL('Alejar', 'Zoom out'))}">−</button><span id="rpZoomLbl">1×</span><button class="btn ghost sm" id="rpZoomIn" title="${esc(LL('Acercar', 'Zoom in'))}">+</button><button class="btn ghost sm" id="rpZoomReset" title="${esc(LL('Restablecer vista (doble clic en el mapa)', 'Reset view (double-click the map)'))}">⟲</button></span>
          <button class="btn ghost sm" id="rpFs" title="${esc(t('rpFullscreen'))}">⛶</button>
        </div>
        <div class="rp-auras surface-dark" id="rpAuras" hidden></div>
      </div>
      <aside class="rp-side">
        <div class="segs wide" id="rpSideTabs">
          <button data-rp-side="players" class="on">${t('rpRoster')}</button>
          <button data-rp-side="adds">${t('rpAddsTab')}</button>
          <button data-rp-side="events">${t('rpEvents')}</button>
        </div>
        <div id="rpList" class="rp-list"></div>
      </aside>`;
    R.stage = $('#rpStage');
    R.canvas = $('#rpCanvas');
    R.ctx = R.canvas.getContext('2d');
    R.tl = $('#rpTl');
    R.tlCtx = R.tl.getContext('2d');
    resize();
    R.ro = new ResizeObserver(() => { resize(); R.dirty = true; });
    R.ro.observe(R.stage);
    R.ro.observe(R.tl);
    updateSide();
    updateHud();
  }

  function resize() {
    if (!R) return;
    const dpr = window.devicePixelRatio || 1;
    R.dpr = dpr;
    const sb = R.stage.getBoundingClientRect();
    R.cw = Math.max(200, Math.floor(sb.width));
    R.ch = Math.max(200, Math.floor(sb.height));
    R.canvas.width = R.cw * dpr; R.canvas.height = R.ch * dpr;
    const tb = R.tl.getBoundingClientRect();
    R.tw = Math.max(200, Math.floor(tb.width));
    R.th = Math.max(40, Math.floor(tb.height));
    R.tl.width = R.tw * dpr; R.tl.height = R.th * dpr;
    const b = R.data.bounds;
    R.fit = Math.min(R.cw / b.spanX, R.ch / b.spanY);
    if (R.vcx == null) { R.vcx = b.cx; R.vcy = b.cy; R.zoom = 1; }
    R.scale = R.fit * R.zoom;
  }

  // Zoom y desplazamiento del radar: rueda = zoom hacia el cursor, arrastrar = mover, doble clic = restablecer
  const ZOOM_MAX = 120;
  function zoomAt(mx, my, factor) {
    const z = clamp(R.zoom * factor, 0.5, ZOOM_MAX);
    const wx = R.vcx + (mx - R.cw / 2) / R.scale;
    const wy = R.vcy - (my - R.ch / 2) / R.scale;
    R.zoom = z;
    R.scale = R.fit * z;
    R.vcx = wx - (mx - R.cw / 2) / R.scale;
    R.vcy = wy + (my - R.ch / 2) / R.scale;
    R.dirty = true;
    const l = $('#rpZoomLbl');
    if (l) l.textContent = `${R.zoom >= 10 ? R.zoom.toFixed(0) : R.zoom.toFixed(1)}×`;
  }
  function zoomReset() {
    const b = R.data.bounds;
    R.zoom = 1; R.vcx = b.cx; R.vcy = b.cy; R.scale = R.fit; R.dirty = true;
    const l = $('#rpZoomLbl');
    if (l) l.textContent = '1×';
  }

  function setPlaying(on) {
    if (on && R.T >= R.W1 - 50) R.T = R.W0;
    R.playing = on;
    R.lastNow = performance.now();
    $('#rpPlay').innerHTML = on ? svgPause : svgPlay;
    $('#rpBig').hidden = on || R.T > R.W0;
    R.dirty = true;
  }

  function seek(T) {
    R.T = clamp(T, R.W0, R.W1);
    $('#rpBig').hidden = true;
    R.dirty = true;
    R.lastUi = 0;
  }

  function bind() {
    const root = $('#rpRoot');
    $('#rpPlay').addEventListener('click', () => setPlaying(!R.playing));
    $('#rpZoomIn').addEventListener('click', () => zoomAt(R.cw / 2, R.ch / 2, 1.6));
    $('#rpZoomOut').addEventListener('click', () => zoomAt(R.cw / 2, R.ch / 2, 1 / 1.6));
    $('#rpZoomReset').addEventListener('click', zoomReset);
    $('#rpBig').addEventListener('click', () => setPlaying(true));
    $('#rpFs').addEventListener('click', () => {
      try { if (document.fullscreenElement) document.exitFullscreen(); else $('#rpMain').requestFullscreen(); } catch { /* sin pantalla completa */ }
    });
    R.onFs = () => { setTimeout(() => { resize(); R.dirty = true; }, 60); };
    document.addEventListener('fullscreenchange', R.onFs);

    root.addEventListener('click', (ev) => {
      const mp = ev.target.closest('[data-rp-map]');
      if (mp) { mapAction(mp.dataset.rpMap, mp.dataset); return; }
      const sp = ev.target.closest('[data-rp-speed]');
      if (sp) {
        R.speed = Number(sp.dataset.rpSpeed);
        root.querySelectorAll('[data-rp-speed]').forEach((b) => b.classList.toggle('on', b === sp));
        return;
      }
      const sh = ev.target.closest('[data-rp-show]');
      if (sh) { R.show[sh.dataset.rpShow] = !R.show[sh.dataset.rpShow]; sh.classList.toggle('on'); R.dirty = true; return; }
      const tg = ev.target.closest('[data-rp-toggle]');
      if (tg) { R[tg.dataset.rpToggle] = !R[tg.dataset.rpToggle]; tg.classList.toggle('on'); R.dirty = true; return; }
      const sd = ev.target.closest('[data-rp-side]');
      if (sd) {
        R.side = sd.dataset.rpSide;
        root.querySelectorAll('[data-rp-side]').forEach((b) => b.classList.toggle('on', b === sd));
        updateSide();
        return;
      }
      const pl = ev.target.closest('[data-rp-id]');
      if (pl) { const id = Number(pl.dataset.rpId); R.selected = R.selected === id ? null : id; R.dirty = true; updateSide(); return; }
      const ts = ev.target.closest('[data-rp-t]');
      if (ts) seek(Number(ts.dataset.rpT) - 2000);
    });

    root.addEventListener('input', (ev) => {
      const cal = ev.target.dataset?.rpCal;
      if (cal) {
        if (ev.target.closest('[data-cal-scope="boss"]')) {
          const bs = R.map.boss;
          bs.cal = { ...(bs.cal || BM_CAL_DEFAULT), [cal]: Number(ev.target.value) };
          try { lsSet(bmCalKey(bs.entry), JSON.stringify(bs.cal)); } catch { /* sin almacenamiento */ }
          R.dirty = true;
        } else { R.map.calib[cal] = Number(ev.target.value); onCalibChanged(); }
        return;
      }
      const tg = ev.target.dataset?.rpMaptoggle;
      if (tg) { R.map[tg] = ev.target.checked; R.dirty = true; updateMapNote(); }
    });

    // Línea de tiempo: clic y arrastre
    let drag = false;
    const tlT = (ev) => {
      const r = R.tl.getBoundingClientRect();
      return R.W0 + clamp((ev.clientX - r.left) / r.width, 0, 1) * (R.W1 - R.W0);
    };
    R.tl.addEventListener('pointerdown', (ev) => {
      drag = true;
      try { R.tl.setPointerCapture(ev.pointerId); } catch { /* sin captura: el arrastre sigue dentro del canvas */ }
      seek(tlT(ev));
    });
    R.tl.addEventListener('pointermove', (ev) => { R.tlHover = tlT(ev); R.dirty = true; if (drag) seek(tlT(ev)); });
    R.tl.addEventListener('pointerup', () => { drag = false; });
    R.tl.addEventListener('pointerleave', () => { R.tlHover = null; R.dirty = true; });

    // Radar: hover y selección
    R.canvas.addEventListener('mousemove', (ev) => {
      const r = R.canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left;
      const my = ev.clientY - r.top;
      let best = null;
      for (const h of R.hits) {
        const d = Math.hypot(h.sx - mx, h.sy - my);
        if (d <= h.r + 6 && (!best || d < best.d)) best = { ...h, d };
      }
      R.hover = best ? best.id : null;
      R.canvas.style.cursor = best ? 'pointer' : 'default';
      showTip(best, mx, my);
      R.dirty = true;
    });
    R.canvas.addEventListener('mouseleave', () => { R.hover = null; showTip(null); R.dirty = true; });
    R.canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const rc = R.canvas.getBoundingClientRect();
      zoomAt(ev.clientX - rc.left, ev.clientY - rc.top, Math.exp(-ev.deltaY * 0.0022));
    }, { passive: false });
    let pan = null;
    R.canvas.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 && ev.button !== 1) return;
      pan = { x: ev.clientX, y: ev.clientY, vcx: R.vcx, vcy: R.vcy, moved: false };
    });
    window.addEventListener('pointermove', R.onPanMove = (ev) => {
      if (!pan) return;
      const dx = ev.clientX - pan.x;
      const dy = ev.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) < 4) return;
      pan.moved = true;
      R.panned = true;
      R.canvas.style.cursor = 'grabbing';
      R.vcx = pan.vcx - dx / R.scale;
      R.vcy = pan.vcy + dy / R.scale;
      R.dirty = true;
    });
    window.addEventListener('pointerup', R.onPanUp = () => { pan = null; setTimeout(() => { R.panned = false; }, 0); });
    R.canvas.addEventListener('dblclick', zoomReset);
    R.canvas.addEventListener('click', () => {
      if (R.panned) return;
      if (R.hover != null) R.selected = R.selected === R.hover ? null : R.hover;
      else R.selected = null;
      R.dirty = true;
      updateSide();
    });

    R.onPaste = (ev) => {
      if (/INPUT|TEXTAREA/.test(ev.target.tagName)) return;
      const item = [...(ev.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) { ev.preventDefault(); importMapFile(item.getAsFile()); }
    };
    document.addEventListener('paste', R.onPaste);
    R.stage.addEventListener('dragover', (ev) => { ev.preventDefault(); R.stage.classList.add('drop'); });
    R.stage.addEventListener('dragleave', () => R.stage.classList.remove('drop'));
    R.stage.addEventListener('drop', (ev) => { ev.preventDefault(); R.stage.classList.remove('drop'); importMapFile(ev.dataTransfer?.files?.[0]); });

    R.onKey = (ev) => {
      if (/INPUT|TEXTAREA/.test(ev.target.tagName)) return;
      if (ev.code === 'Space') { ev.preventDefault(); setPlaying(!R.playing); }
      else if (ev.code === 'ArrowRight') seek(R.T + (ev.shiftKey ? 1000 : 5000));
      else if (ev.code === 'ArrowLeft') seek(R.T - (ev.shiftKey ? 1000 : 5000));
      else if (ev.code === 'Escape') { R.selected = null; R.dirty = true; updateSide(); }
    };
    document.addEventListener('keydown', R.onKey);
  }

  function liveStats(id) {
    const m = R.data.meters.get(id);
    const v = cumAt(m, R.T) - cumAt(m, R.W0);
    return { dmg: v, dps: v / Math.max(1, (R.T - R.W0) / 1000) };
  }

  function showTip(h, mx, my) {
    const tip = $('#rpTip');
    if (!h || h.kind === 'npc' && !h.label) { tip.hidden = true; return; }
    let html;
    if (h.kind === 'player') {
      const p = playerInfo(h.id);
      const s = sample(R.data.tracks.get(h.id), R.T);
      const hp = s.mx > 0 ? clamp((s.hp / s.mx) * 100, 0, 100) : null;
      const st = liveStats(h.id);
      html = `<b style="color:${classColor(p.cls)}">${esc(p.name)}</b><small>${esc(specName(p.spec) || className(p.cls))}</small>
        ${hp != null ? `<div class="tipbar"><span style="width:${hp}%"></span></div><div class="tiprow"><span>${t('hp')}</span><b>${num(hp, 0)} %</b></div>` : ''}
        <div class="tiprow"><span>${t('tabs.damage')}</span><b>${plain(st.dmg)}</b></div>
        <div class="tiprow"><span>DPS</span><b>${plain(st.dps)}</b></div>`;
    } else {
      const tkn = R.data.tracks.get(h.key ?? h.id);
      const sn = tkn ? sample(tkn, R.T) : null;
      const hp = sn && sn.mx > 0 ? clamp((sn.hp / sn.mx) * 100, 0, 100) : null;
      const tier = h.tier ? t({ major: 'rpTierMajor', medium: 'rpTierMedium', minor: 'rpTierMinor' }[h.tier]) : '';
      html = `<b>${esc(actorName(h.id))}</b>${tier ? `<small>${tier}</small>` : ''}${hp != null ? `<div class="tipbar"><span style="width:${hp}%;background:${hpColor(hp / 100)}"></span></div><div class="tiprow"><span>${t('hp')}</span><b>${num(hp, 0)} %</b></div>` : ''}`;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${clamp(mx + 16, 8, R.cw - w - 8)}px`;
    tip.style.top = `${clamp(my + 14, 8, R.ch - tip.offsetHeight - 8)}px`;
  }

  // ------------------------------------------------------------ bucle
  function frame(now) {
    if (!R) return;
    R.raf = requestAnimationFrame(frame);
    const dt = now - R.lastNow;
    R.lastNow = now;
    if (R.playing) {
      R.T += dt * R.speed;
      if (R.T >= R.W1) { R.T = R.W1; setPlaying(false); }
      R.dirty = true;
    }
    if (!$('#rpStage')) { stop(); return; }
    if (R.dirty) {
      R.dirty = false;
      drawStage(now);
      drawTimeline();
      $('#rpNow').textContent = clock(R.T - R.raw.startTime);
    }
    if (now - R.lastUi > (R.playing ? 220 : 500)) {
      R.lastUi = now;
      updateSide();
      updateHud();
    }
  }

  // ------------------------------------------------------------ radar
  // ------------------------------------------------------------ mapas
  // Dos fuentes: (1) suelo generado con las posiciones de los jugadores de todos los intentos del boss
  // (se acumula y se guarda por boss+mapa) y (2) una imagen que pone el usuario, con calibración.
  const CAL_DEFAULT = { zoom: 1, dx: 0, dy: 0, rot: 0, flipH: false, flipV: false, opacity: 0.9 };
  const CELL = 100; // 1 yd por celda del suelo generado
  const ARENA_MAX_PULLS = 7;

  function boxOfFight() {
    if (R.box && R.box.maxX > R.box.minX && R.box.maxY > R.box.minY) return R.box;
    const b = R.data.bounds;
    return { minX: b.cx - b.spanX / 2, maxX: b.cx + b.spanX / 2, minY: b.cy - b.spanY / 2, maxY: b.cy + b.spanY / 2 };
  }

  async function initMaps() {
    const token = R;
    try {
      const stored = await window.api.mapGet(token.mapKey);
      if (R === token && stored?.dataUrl) await applyStoredMap(stored);
    } catch (e) { console.warn('map', e); }
    if (R !== token) return;
    const entries = bossEntriesFor(token.raw.encounterID);
    token.map.boss.entries = entries;
    if (entries.length) loadBossMap(pickDefaultBoss(entries));
    loadArena();
    syncMapPanel();
    growArena(token);
  }

  function applyStoredMap(payload) {
    return new Promise((resolve) => {
      const img = new Image();
      const token = R;
      img.onload = () => {
        if (R === token) {
          R.map.img = img;
          R.map.calib = { ...CAL_DEFAULT, ...(payload.calib || {}) };
          R.dirty = true;
          syncMapPanel();
          updateMapNote();
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = payload.dataUrl;
    });
  }

  // ---- suelo generado
  const arenaKey = () => `arena:v1:${R.mapKey}`;
  const addCell = (cells, x, y) => { const k = `${Math.round(x / CELL)},${Math.round(y / CELL)}`; cells.set(k, (cells.get(k) || 0) + 1); };

  function addTrackCells(cells, T, X, Y) {
    for (let i = 0; i < T.length; i++) {
      addCell(cells, X[i], Y[i]);
      if (i < T.length - 1 && T[i + 1] - T[i] <= 4000) {
        const dx = X[i + 1] - X[i];
        const dy = Y[i + 1] - Y[i];
        const dist = Math.hypot(dx, dy);
        if (dist > CELL && dist < 3500) {
          const n = Math.floor(dist / CELL);
          for (let k = 1; k < n; k++) addCell(cells, X[i] + (dx * k) / n, Y[i] + (dy * k) / n);
        }
      }
    }
  }

  function loadArena() {
    const arena = { cells: new Map(), pulls: new Set(), ver: 0 };
    try {
      const saved = JSON.parse(lsGet(arenaKey()) || 'null');
      if (saved) {
        for (const [ix, iy, n] of saved.cells) arena.cells.set(`${ix},${iy}`, n);
        for (const p of saved.pulls) arena.pulls.add(p);
      }
    } catch { /* caché corrupta: se regenera */ }
    R.arena = arena;
    const token = `${S.code}:${R.raw.id}`;
    if (!arena.pulls.has(token)) {
      for (const tk of R.data.tracks.values()) if (tk.kind === 'player') addTrackCells(arena.cells, tk.t, tk.x, tk.y);
      arena.pulls.add(token);
      saveArena();
    }
    arena.ver++;
    R.dirty = true;
    updateMapNote();
  }

  function saveArena() {
    const a = R.arena;
    const cells = [...a.cells.entries()].sort((x, y) => y[1] - x[1]).slice(0, 20000)
      .map(([k, n]) => { const [ix, iy] = k.split(','); return [Number(ix), Number(iy), n]; });
    lsSet(arenaKey(), JSON.stringify({ pulls: [...a.pulls].slice(-80), cells }));
  }

  async function playerPositions(fight, mainMap) {
    const byActor = new Map();
    let start = fight.startTime;
    for (let page = 0; page < 10; page++) {
      const d = await gql(`query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){
        events(fightIDs:$f,startTime:$s,endTime:$e,dataType:Casts,limit:10000,includeResources:true){data nextPageTimestamp}}}}`,
      { code: S.code, f: [fight.id], s: start, e: fight.endTime });
      const ev = d.reportData.report.events;
      for (const e of ev?.data || []) {
        if (e.x == null || e.resourceActor !== 1 || kindOf(e.sourceID) !== 'player' || (mainMap && e.mapID !== mainMap)) continue;
        let a = byActor.get(e.sourceID);
        if (!a) { a = { T: [], X: [], Y: [] }; byActor.set(e.sourceID, a); }
        a.T.push(e.timestamp); a.X.push(e.x); a.Y.push(e.y);
      }
      if (!ev?.nextPageTimestamp || ev.nextPageTimestamp <= start) break;
      start = ev.nextPageTimestamp;
    }
    return [...byActor.values()];
  }

  async function growArena(token) {
    const raw = token.raw;
    const todo = S.fights.filter((x) => x.encounterID && x.encounterID === raw.encounterID && x.difficulty === raw.difficulty
      && x.id !== raw.id && fightDur(x) > 25000)
      .sort((a, b) => fightDur(b) - fightDur(a)).slice(0, ARENA_MAX_PULLS - 1)
      .filter((x) => !token.arena.pulls.has(`${S.code}:${x.id}`));
    for (let i = 0; i < todo.length; i++) {
      if (R !== token) return;
      token.map.growing = `${i + 1}/${todo.length}`;
      updateMapNote();
      try {
        const tracks = await playerPositions(todo[i], token.data.mainMap);
        if (R !== token) return;
        for (const a of tracks) addTrackCells(token.arena.cells, a.T, a.X, a.Y);
        token.arena.pulls.add(`${S.code}:${todo[i].id}`);
        token.arena.ver++;
        saveArena();
        token.dirty = true;
      } catch (e) { console.warn('arena', e); break; }
    }
    if (R === token) { token.map.growing = ''; updateMapNote(); syncMapPanel(); }
  }

  let stoneTex = null;
  function stoneTexture() {
    if (stoneTex) return stoneTex;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#2f4272';
    x.fillRect(0, 0, 256, 256);
    let seed = 1337;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 3200; i++) {
      const light = rnd() > 0.5;
      x.fillStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${0.015 + rnd() * 0.04})`;
      x.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    x.strokeStyle = 'rgba(8,12,24,.65)';
    x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, 1); x.lineTo(256, 1); x.moveTo(1, 0); x.lineTo(1, 256); x.moveTo(0, 129); x.lineTo(256, 129); x.moveTo(129, 0); x.lineTo(129, 256); x.stroke();
    x.strokeStyle = 'rgba(200,215,250,.10)';
    x.lineWidth = 1;
    x.beginPath(); x.moveTo(0, 3); x.lineTo(256, 3); x.moveTo(3, 0); x.lineTo(3, 256); x.moveTo(0, 131); x.lineTo(256, 131); x.moveTo(131, 0); x.lineTo(131, 256); x.stroke();
    stoneTex = c;
    return c;
  }

  const smooth = (a, b, v) => { const t0 = Math.max(0, Math.min(1, (v - a) / (b - a))); return t0 * t0 * (3 - 2 * t0); };

  // Suelo de la arena: zona recorrida por los jugadores -> forma nítida con losas, desgaste según uso y borde luminoso
  function ensureFloor() {
    const a = R.arena;
    if (!a || !a.cells.size) { R.floor = null; return; }
    const sig = `${R.cw}x${R.ch}@${R.scale.toFixed(5)}:${R.data.bounds.cx}:${R.data.bounds.cy}:${a.ver}`;
    if (sig === R.floorSig && R.floor) return;
    R.floorSig = sig;
    const { cw, ch } = R;
    const mk = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
    const counts = [...a.cells.values()].sort((x, y) => x - y);
    const maxC = counts[counts.length - 1];
    const ref = Math.max(2, counts[Math.floor(counts.length * 0.75)]);
    const thr = maxC > 30 ? 2 : 1;
    const yd = CELL * R.scale;

    const mask = mk();
    const mc = mask.getContext('2d');
    mc.fillStyle = '#fff';
    const size = CELL * R.scale + 1.2;
    for (const [k, n] of a.cells) {
      if (n < thr) continue;
      const [ix, iy] = k.split(',');
      const [sx, sy] = toScreen(Number(ix) * CELL, Number(iy) * CELL);
      if (sx < -size || sy < -size || sx > cw + size || sy > ch + size) continue;
      mc.globalAlpha = Math.min(1, 0.45 + (0.55 * n) / ref);
      mc.fillRect(sx - size / 2, sy - size / 2, size, size);
    }

    // forma y borde a partir de la máscara desenfocada con umbrales
    const blurred = mk();
    const bx = blurred.getContext('2d', { willReadFrequently: true });
    bx.filter = `blur(${Math.max(2, yd * 2.4)}px)`;
    bx.drawImage(mask, 0, 0);
    bx.filter = 'none';
    const src = bx.getImageData(0, 0, cw, ch);
    const shape = bx.createImageData(cw, ch);
    const rim = bx.createImageData(cw, ch);
    for (let i = 0; i < src.data.length; i += 4) {
      const al = src.data[i + 3] / 255;
      const outer = smooth(0.2, 0.3, al);
      const inner = smooth(0.34, 0.44, al);
      shape.data[i] = shape.data[i + 1] = shape.data[i + 2] = 255; shape.data[i + 3] = outer * 255;
      rim.data[i] = 165; rim.data[i + 1] = 195; rim.data[i + 2] = 255; rim.data[i + 3] = Math.max(0, outer - inner) * 255;
    }
    const shapeC = mk(); shapeC.getContext('2d').putImageData(shape, 0, 0);
    const rimC = mk(); rimC.getContext('2d').putImageData(rim, 0, 0);

    const out = mk();
    const oc = out.getContext('2d');

    // resplandor exterior
    const glow = mk();
    const gc = glow.getContext('2d');
    gc.filter = `blur(${Math.max(6, yd * 4)}px)`;
    gc.drawImage(shapeC, 0, 0);
    gc.filter = 'none';
    gc.globalCompositeOperation = 'source-in';
    gc.fillStyle = '#4f78d8';
    gc.fillRect(0, 0, cw, ch);
    oc.globalAlpha = 0.5;
    oc.drawImage(glow, 0, 0);
    oc.globalAlpha = 1;

    // losas con desgaste: más claro donde más se camina
    const floor = mk();
    const fc = floor.getContext('2d');
    const pat = fc.createPattern(stoneTexture(), 'repeat');
    const k = (yd * 10) / 128; // una losa = 10 yd
    if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(k));
    fc.fillStyle = pat;
    fc.fillRect(0, 0, cw, ch);
    const heat = mk();
    const hc = heat.getContext('2d');
    hc.filter = `blur(${Math.max(4, yd * 3.5)}px)`;
    hc.drawImage(mask, 0, 0);
    hc.filter = 'none';
    hc.globalCompositeOperation = 'source-in';
    hc.fillStyle = '#b9c9f2';
    hc.fillRect(0, 0, cw, ch);
    fc.globalAlpha = 0.28;
    fc.drawImage(heat, 0, 0);
    fc.globalAlpha = 1;
    fc.globalCompositeOperation = 'destination-in';
    fc.drawImage(shapeC, 0, 0);
    oc.drawImage(floor, 0, 0);

    // borde luminoso
    oc.globalAlpha = 0.85;
    oc.drawImage(rimC, 0, 0);
    oc.globalAlpha = 1;
    R.floor = out;
  }

  // ---- mapa del jefe (RaidPlan.io) o imagen del usuario
  const BM_CAL_DEFAULT = { zoom: 1, dx: 0, dy: 0, opacity: 0.95 };
  const bmCalKey = (e) => `bmcal:v1:${e.path}`;

  const bossEntriesFor = (enc) => (typeof BOSS_MAPS === 'undefined' || !enc ? [] : BOSS_MAPS.filter((e) => e.encounter === enc).sort((x, y) => (y.yards || 0) - (x.yards || 0)));
  const bossActive = () => !!(R.map.showBoss && R.map.boss.img && WCSettings.get('bossMaps') !== false);
  const userActive = () => !!(R.map.img && R.map.showImg);
  const mapImageActive = () => userActive() || bossActive();

  // Posición exacta según RaidPlan: centro (x,y) del mapa en el mundo, altura en yardas y norte girado `yaw` grados a la derecha.
  // Sus coordenadas son (X,Y) = (y del registro, -x del registro) en yardas.
  // Correcciones de giro (grados a la derecha) donde la orientación de RaidPlan no coincide con la del juego
  const YAW_FIX = { '3429:ort-v108': 90 }; // El Altar en Espiral: las puertas van a los lados
  const placeExact = (e) => ({ cx: -e.world.y * UNITS_PER_YD, cy: e.world.x * UNITS_PER_YD, hUnits: e.yards * UNITS_PER_YD, yaw: e.world.yaw + (YAW_FIX[`${e.encounter}:${e.slug}`] || 0) + 90 * Number(lsGet(`bossmap:rot:${e.encounter}:${e.slug}`) || 0) });

  function pickDefaultBoss(entries) {
    const saved = lsGet(`bossmap:sel:${R.raw.encounterID}`);
    const bySaved = entries.find((e) => e.slug === saved);
    if (bySaved) return bySaved;
    const pts = [];
    for (const tk of R.data.tracks.values()) if (tk.kind === 'player') for (let i = 0; i < tk.t.length; i += 7) pts.push([tk.x[i], tk.y[i]]);
    let best = null;
    for (const e of [...entries].sort((a, b) => (b.yards || 0) - (a.yards || 0))) {
      if (!e.world) continue;
      const p = placeExact(e);
      const a = (p.yaw * Math.PI) / 180;
      const sn = Math.sin(a);
      const cs = Math.cos(a);
      const H = p.hUnits;
      const W = H * (16 / 9);
      let inside = 0;
      for (const [x, y] of pts) {
        const bx = x - p.cx;
        const by = -(y - p.cy);
        const px = bx * cs - by * sn;
        const py = bx * sn + by * cs;
        if (Math.abs(px) <= W / 2 && Math.abs(py) <= H / 2) inside++;
      }
      const score = pts.length ? inside / pts.length : 0;
      if (!best || score > best.score + 0.03) best = { e, score };
    }
    if (best && best.score >= 0.5) return best.e;
    return entries.find((e) => /^(main|full)$/.test(e.slug)) || entries[0];
  }

  function loadBossMap(e) {
    const b = R.map.boss;
    const token = R;
    b.entry = e; b.state = 'loading'; b.img = null; b.approx = null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (R !== token || b.entry !== e) return;
      b.img = img;
      b.state = 'ready';
      if (!e.world) b.approx = approxPlacement(img);
      try { b.cal = { ...BM_CAL_DEFAULT, ...(JSON.parse(lsGet(bmCalKey(e)) || 'null') || {}) }; } catch { b.cal = { ...BM_CAL_DEFAULT }; }
      R.dirty = true;
      syncMapPanel();
      updateMapNote();
    };
    img.onerror = () => { if (R === token && b.entry === e) { b.state = 'error'; syncMapPanel(); updateMapNote(); } };
    img.src = `wcmap://m/${e.path}`;
    syncMapPanel();
  }

  // Salas sin posición publicada: se ajusta la imagen a la zona que pisan los jugadores
  function approxPlacement(img) {
    const bnd = R.data.bounds;
    const pw = bnd.spanX / 1.22;
    const ph = bnd.spanY / 1.22;
    let box = { fx0: 0.1, fx1: 0.9, fy0: 0.1, fy1: 0.9 };
    try {
      const cw = 192;
      const ch = Math.round((192 * img.naturalHeight) / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, cw, ch);
      const d = x.getImageData(0, 0, cw, ch).data;
      const xs = [];
      const ys = [];
      for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
        const i = (yy * cw + xx) * 4;
        const rr = d[i]; const gg = d[i + 1]; const bb = d[i + 2];
        if (!(gg > rr + 25 && gg > bb + 40) && 0.299 * rr + 0.587 * gg + 0.114 * bb > 40) { xs.push(xx); ys.push(yy); }
      }
      if (xs.length > 200) {
        xs.sort((p, q) => p - q); ys.sort((p, q) => p - q);
        const qn = (a, f) => a[Math.floor((a.length - 1) * f)];
        box = { fx0: qn(xs, 0.01) / cw, fx1: qn(xs, 0.99) / cw, fy0: qn(ys, 0.01) / ch, fy1: qn(ys, 0.99) / ch };
      }
    } catch (e) { /* sin lectura de píxeles: se usa un recuadro central */ }
    const aspect = img.naturalWidth / img.naturalHeight;
    const fw = Math.max(0.1, box.fx1 - box.fx0);
    const fh = Math.max(0.1, box.fy1 - box.fy0);
    const hUnits = Math.max((ph * 1.3) / fh, (pw * 1.3) / (fw * aspect));
    const wUnits = hUnits * aspect;
    return { cx: bnd.cx - ((box.fx0 + box.fx1) / 2 - 0.5) * wUnits, cy: bnd.cy + ((box.fy0 + box.fy1) / 2 - 0.5) * hUnits, hUnits, yaw: 0 };
  }

  function drawBossMap(ctx) {
    const b = R.map.boss;
    const e = b.entry;
    const place = e.world ? placeExact(e) : b.approx;
    if (!place) return;
    const cal = b.cal || BM_CAL_DEFAULT;
    const aspect = b.img.naturalWidth / b.img.naturalHeight;
    const hU = place.hUnits * (e.world ? 1 : cal.zoom);
    const [sx, sy] = toScreen(place.cx + (e.world ? 0 : cal.dx * UNITS_PER_YD), place.cy + (e.world ? 0 : cal.dy * UNITS_PER_YD));
    const h = hU * R.scale;
    const w = h * aspect;
    ctx.save();
    ctx.globalAlpha = cal.opacity ?? 0.95;
    ctx.translate(sx, sy);
    ctx.rotate(-(place.yaw * Math.PI) / 180); // la imagen se gira para dejar el norte arriba
    ctx.drawImage(b.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function drawUserImage(ctx) {
    const m = R.map;
    const c = m.calib;
    const box = boxOfFight();
    const bcx = (box.minX + box.maxX) / 2;
    const bcy = (box.minY + box.maxY) / 2;
    const wWorld = (box.maxX - box.minX) * c.zoom; // ancho horizontal en pantalla (eje x del registro)
    const [sx, sy] = toScreen(bcx + c.dx * UNITS_PER_YD, bcy + c.dy * UNITS_PER_YD);
    const odd = c.rot % 2 === 1;
    const nw = m.img.naturalWidth;
    const nh = m.img.naturalHeight;
    const shownW = wWorld * R.scale;
    const w = odd ? shownW * (nw / nh) : shownW;
    const h = odd ? shownW : shownW * (nh / nw);
    ctx.save();
    ctx.globalAlpha = c.opacity;
    ctx.translate(sx, sy);
    ctx.rotate((c.rot * Math.PI) / 2);
    ctx.scale(c.flipH ? -1 : 1, c.flipV ? -1 : 1);
    ctx.drawImage(m.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function drawMapLayers(ctx) {
    const m = R.map;
    if (userActive()) { drawUserImage(ctx); return; }
    if (bossActive()) { drawBossMap(ctx); return; }
    if (m.showGen) {
      ensureFloor();
      if (R.floor) ctx.drawImage(R.floor, 0, 0, R.cw, R.ch);
    }
  }

  // Coloca la imagen del usuario ocupando la zona donde se movieron los jugadores
  function fitImageToPlayers() {
    const b = R.data.bounds;
    const box = boxOfFight();
    const c = R.map.calib;
    c.zoom = Math.max(0.3, Math.min(3, b.spanX / (box.maxX - box.minX)));
    c.dx = Math.max(-80, Math.min(80, (b.cx - (box.minX + box.maxX) / 2) / UNITS_PER_YD));
    c.dy = Math.max(-80, Math.min(80, (b.cy - (box.minY + box.maxY) / 2) / UNITS_PER_YD));
    R.dirty = true;
  }

  // Imagen pegada (Ctrl+V) o arrastrada sobre el replay: se guarda para este boss
  async function importMapFile(file) {
    if (!R || !file) return;
    const fail = (k) => toast(t(k));
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { fail('mapErrType'); return; }
    if (file.size > 25 * 1024 * 1024) { fail('mapErrBig'); return; }
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    const out = await window.api.mapSaveData(R.mapKey, dataUrl);
    if (!R) return;
    if (!out || out.error) { fail('mapErrType'); return; }
    R.map.showImg = true;
    R.map.panel = true;
    await applyStoredMap(out);
    R.map.calib = { ...CAL_DEFAULT };
    fitImageToPlayers();
    onCalibChanged();
    syncMapPanel();
    toast(t('mapPasted'));
  }

  function onCalibChanged() {
    R.dirty = true;
    clearTimeout(R.map.saveTimer);
    const key = R.mapKey;
    const calib = { ...R.map.calib };
    R.map.saveTimer = setTimeout(() => window.api.mapCalib(key, calib), 400);
  }

  async function mapAction(a, data = {}) {
    const m = R.map;
    if (a === 'toggle') { m.panel = !m.panel; syncMapPanel(); return; }
    if (a === 'close') { m.panel = false; syncMapPanel(); return; }
    if (a === 'bossvar') {
      const e = m.boss.entries.find((x) => x.slug === data.slug);
      if (e) { lsSet(`bossmap:sel:${R.raw.encounterID}`, e.slug); loadBossMap(e); updateMapNote(); }
      return;
    }
    if (a === 'bossrot') {
      const k = `bossmap:rot:${m.boss.entry.encounter}:${m.boss.entry.slug}`;
      lsSet(k, String((Number(lsGet(k) || 0) + 1) % 4));
      R.dirty = true;
      return;
    }
    if (a === 'bossreset') {
      m.boss.cal = { ...BM_CAL_DEFAULT };
      try { localStorage.removeItem(bmCalKey(m.boss.entry)); } catch { /* sin almacenamiento */ }
      R.dirty = true; syncMapPanel();
      return;
    }
    if (a === 'pick') {
      const res = await window.api.mapPick(R.mapKey);
      if (!R || res?.canceled) return;
      if (res?.error) { toast(t(res.error === 'TOO_BIG' ? 'mapErrBig' : 'mapErrType')); return; }
      if (res?.dataUrl) { m.showImg = true; await applyStoredMap(res); onCalibChanged(); }
      return;
    }
    if (a === 'remove') {
      await window.api.mapRemove(R.mapKey);
      m.img = null; m.calib = { ...CAL_DEFAULT };
      R.dirty = true; syncMapPanel(); updateMapNote();
      return;
    }
    if (a === 'rot') m.calib.rot = (m.calib.rot + 1) % 4;
    else if (a === 'flipH') m.calib.flipH = !m.calib.flipH;
    else if (a === 'flipV') m.calib.flipV = !m.calib.flipV;
    else if (a === 'reset') m.calib = { ...CAL_DEFAULT };
    else if (a === 'fit') fitImageToPlayers();
    else return;
    syncMapPanel();
    onCalibChanged();
  }

  function syncMapPanel() {
    if (!R) return;
    const p = $('#rpMapPanel');
    if (!p) return;
    p.hidden = !R.map.panel;
    if (!R.map.panel) return;
    const c = R.map.calib;
    const bs = R.map.boss;
    const bc = bs.cal || BM_CAL_DEFAULT;
    const slider = (k, label, min, max, step, val) => `<label class="mp-sl"><span>${label}</span>
      <input type="range" data-rp-cal="${k}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
    const bossStatus = { loading: LL('Descargando mapa…', 'Downloading map…'), error: LL('No se pudo descargar el mapa', 'Could not download the map'), idle: '', ready: '' }[bs.state];
    const bossHtml = bs.entries.length ? `<div class="mp-sec"><label class="mp-check"><input type="checkbox" data-rp-maptoggle="showBoss" ${R.map.showBoss ? 'checked' : ''}> ${LL('Mapa del jefe', 'Boss map')}</label>
        <div class="mp-var">${bs.entries.map((e) => `<button type="button" class="chip ${bs.entry === e ? 'on' : ''}" data-rp-map="bossvar" data-slug="${esc(e.slug)}"><span class="sq"></span>${esc(e.map)}</button>`).join('')}</div>
        ${bossStatus ? `<small class="mp-info">${bossStatus}</small>` : ''}
        ${bs.entry && !bs.entry.world && bs.state === 'ready' ? `<small class="mp-info">${LL('Ajustado automáticamente a la zona de los jugadores (aprox.)', 'Auto-fitted to the players’ area (approx.)')}</small>
          <div data-cal-scope="boss">${slider('zoom', t('mapSize'), 0.4, 2.5, 0.01, bc.zoom)}${slider('dx', t('mapMoveX'), -80, 80, 0.5, bc.dx)}${slider('dy', t('mapMoveY'), -80, 80, 0.5, bc.dy)}</div>` : ''}
        <div data-cal-scope="boss">${slider('opacity', t('mapOpacity'), 0.3, 1, 0.05, bc.opacity ?? 0.95)}</div>
        ${bs.entry && bs.entry.world ? `<div class="mp-actions"><button class="btn ghost sm" data-rp-map="bossrot">⟳ ${t('mapRotate')} 90°</button></div>` : ''}
        ${bs.entry && !bs.entry.world ? `<div class="mp-actions"><button class="btn ghost sm" data-rp-map="bossreset">${t('mapReset')}</button></div>` : ''}
        <small class="mp-info">${LL('Mapas: RaidPlan.io', 'Maps: RaidPlan.io')}</small></div>` : '';
    p.innerHTML = `<div class="mp-head"><b>${t('rpMap')}</b><button data-rp-map="close" aria-label="close">✕</button></div>
      ${bossHtml}
      <label class="mp-check"><input type="checkbox" data-rp-maptoggle="showGen" ${R.map.showGen ? 'checked' : ''}> ${t('mapShowGen')}</label>
      <small class="mp-info">${t('mapArenaInfo', { n: R.arena ? R.arena.pulls.size : 0 })}${R.map.growing ? ` · ${t('mapGrowing', { p: R.map.growing })}` : ''}</small>
      <div class="mp-actions"><button class="btn sm" data-rp-map="pick">${t('mapPick')}</button>
        ${R.map.img ? `<button class="btn ghost sm" data-rp-map="remove">${t('mapRemove')}</button>` : ''}</div>
      ${R.map.img ? `<div class="mp-cal">
        <label class="mp-check"><input type="checkbox" data-rp-maptoggle="showImg" ${R.map.showImg ? 'checked' : ''}> ${t('mapShowImg')}</label>
        ${slider('zoom', t('mapSize'), 0.3, 3, 0.01, c.zoom)}${slider('dx', t('mapMoveX'), -80, 80, 0.5, c.dx)}${slider('dy', t('mapMoveY'), -80, 80, 0.5, c.dy)}${slider('opacity', t('mapOpacity'), 0.1, 1, 0.05, c.opacity)}
        <div class="mp-actions"><button class="btn ghost sm" data-rp-map="fit">${t('mapFit')}</button>
          <button class="btn ghost sm" data-rp-map="rot">⟳ ${t('mapRotate')}</button>
          <button class="btn ghost sm" data-rp-map="flipH">↔</button><button class="btn ghost sm" data-rp-map="flipV">↕</button>
          <button class="btn ghost sm" data-rp-map="reset">${t('mapReset')}</button></div></div>` : ''}
      <p class="mp-hint">${t('mapHint')}</p>`;
  }

  function updateMapNote() {
    const el = $('#rpMapNote');
    if (!el || !R) return;
    const m = R.map;
    if (userActive()) el.textContent = '';
    else if (bossActive()) el.textContent = `${LL('Mapa', 'Map')}: RaidPlan.io · ${m.boss.entry.map}${m.boss.entry.world ? '' : LL(' (ajustado automáticamente)', ' (auto-fitted)')}`;
    else if (m.showGen && R.arena?.cells.size) {
      el.textContent = `${t('mapGenerated')}${m.growing ? ` · ${t('mapGrowing', { p: m.growing })}` : ''}`;
    } else el.textContent = '';
    if (m.panel) syncMapPanel();
  }

  function hpColor(p) {
    if (p > 0.55) return '#46c28e';
    if (p > 0.25) return '#f0a23b';
    return '#f0646f';
  }

  function drawStage(now) {
    const { ctx, cw, ch, dpr } = R;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const bg = ctx.createRadialGradient(cw / 2, ch / 2, 10, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
    bg.addColorStop(0, '#14223f');
    bg.addColorStop(1, '#08101f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);
    drawMapLayers(ctx);

    const b = R.data.bounds;
    // rejilla de puntos cada 5 yd
    const step = 5 * UNITS_PER_YD;
    ctx.fillStyle = 'rgba(160,175,200,.16)';
    const gx0 = Math.floor((R.vcx - cw / R.scale / 2) / step) * step;
    const gx1 = R.vcx + cw / R.scale / 2;
    const gy0 = Math.floor((R.vcy - ch / R.scale / 2) / step) * step;
    const gy1 = R.vcy + ch / R.scale / 2;
    if (!mapImageActive()) for (let gx = gx0; gx <= gx1; gx += step) {
      for (let gy = gy0; gy <= gy1; gy += step) {
        const [sx, sy] = toScreen(gx, gy);
        ctx.fillRect(sx - 0.75, sy - 0.75, 1.5, 1.5);
      }
    }
    // anillos de distancia cada 10 yd desde el centro de la arena
    const [ox, oy] = toScreen(b.cx, b.cy);
    const maxR = Math.hypot(cw, ch) / 2;
    ctx.lineWidth = 1;
    ctx.font = `500 10px ${UI_FONT}`;
    ctx.textAlign = 'center';
    for (let yd = 10; yd * UNITS_PER_YD * R.scale < maxR + 30; yd += 10) {
      const rad = yd * UNITS_PER_YD * R.scale;
      ctx.strokeStyle = yd % 20 === 0 ? 'rgba(130,150,190,.22)' : 'rgba(130,150,190,.12)';
      ctx.beginPath(); ctx.arc(ox, oy, rad, 0, Math.PI * 2); ctx.stroke();
      if (oy - rad > 8) { ctx.fillStyle = 'rgba(150,165,195,.5)'; ctx.fillText(`${yd} yd`, ox, oy - rad - 3); }
    }
    ctx.strokeStyle = 'rgba(130,150,190,.12)';
    ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, ch); ctx.moveTo(0, oy); ctx.lineTo(cw, oy); ctx.stroke();

    // brújula: el norte siempre está arriba
    ctx.save();
    ctx.translate(30, ch - 62);
    ctx.fillStyle = 'rgba(8,16,31,.7)'; ctx.strokeStyle = 'rgba(150,175,225,.5)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f0646f';
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(4, 1); ctx.lineTo(-4, 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c5d0ea'; ctx.font = `700 9px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.fillText('N', 0, 11);
    ctx.restore();

    R.hits = [];
    const T = R.T;
    const rp = clamp(cw / 110, 8, 13);
    const labels = [];
    const piActive = new Set(R.pi.filter((p) => T >= p.start && T < p.end).map((p) => p.target));
    const order = { npc: 0, pet: 1, boss: 2, player: 3 };
    const ents = [];
    for (const tk of R.data.tracks.values()) {
      if (!R.show[tk.kind]) continue;
      const s = sample(tk, T);
      if (s.stale && tk.kind !== 'player') continue;
      if (tk.kind === 'npc' && s.mx > 0 && s.hp <= 0 && (s.age ?? 0) > 1500) continue;
      ents.push({ tk, s });
    }
    const tierRank = (tk) => ({ minor: 0, medium: 1, major: 2 }[tk.tier] ?? 0);
    ents.sort((a, c) => order[a.tk.kind] - order[c.tk.kind] || tierRank(a.tk) - tierRank(c.tk) || (a.tk.id === R.selected) - (c.tk.id === R.selected));

    if (R.mech?.length) {
      let lo = 0;
      let hi = R.mech.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (R.mech[mid].t < T - 1800) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < R.mech.length && R.mech[i].t <= T; i++) {
        const m = R.mech[i];
        const mt = R.data.tracks.get(m.id);
        if (!mt) continue;
        const p0 = sample(mt, m.t);
        const [mx, my] = toScreen(p0.x, p0.y);
        const k = (T - m.t) / 1800;
        ctx.beginPath();
        ctx.arc(mx, my, 8 + k * 26, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,93,93,${(1 - k) * 0.2})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(255,93,93,${(1 - k) * 0.95})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }

    for (const { tk, s } of ents) {
      const [sx, sy] = toScreen(s.x, s.y);
      if (sx < -30 || sy < -30 || sx > cw + 30 || sy > ch + 30) continue;
      const sel = tk.id === R.selected;
      const hov = tk.id === R.hover;
      const hpFrac = s.mx > 0 ? clamp(s.hp / s.mx, 0, 1) : null;

      if (tk.kind === 'player') {
        const p = playerInfo(tk.id);
        const color = classColor(p.cls);
        const dead = deathAt(tk.id, T);
        const alpha = dead ? 0.55 : s.stale ? 0.4 : 1;
        // estela
        if (sel || R.trails) {
          const t0 = T - (sel ? 8000 : 4000);
          ctx.lineCap = 'round';
          let prev = null;
          const stepMs = 400;
          for (let tt = Math.max(t0, tk.t[0]); tt <= T; tt += stepMs) {
            const q = sample(tk, tt);
            const [qx, qy] = toScreen(q.x, q.y);
            if (prev) {
              ctx.strokeStyle = color;
              ctx.globalAlpha = 0.65 * ((tt - t0) / (T - t0 + 1)) * alpha;
              ctx.lineWidth = sel ? 2.4 : 1.6;
              ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(qx, qy); ctx.stroke();
            }
            prev = [qx, qy];
          }
          ctx.globalAlpha = 1;
        }
        // halo de PI
        if (piActive.has(tk.id) && !dead) {
          const pulse = 0.5 + 0.5 * Math.sin(now / 220);
          ctx.strokeStyle = `rgba(80,225,255,${0.55 + pulse * 0.35})`;
          ctx.lineWidth = 2.5;
          ctx.shadowColor = '#3cd8ff'; ctx.shadowBlur = 14;
          ctx.beginPath(); ctx.arc(sx, sy, rp + 8 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
          ctx.shadowBlur = 0;
        }
        // pulso de muerte
        if (dead && T - dead.timestamp < 1600) {
          const k = (T - dead.timestamp) / 1600;
          ctx.strokeStyle = `rgba(240,100,111,${1 - k})`;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(sx, sy, rp + 4 + k * 34, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = alpha;
        if (sel || hov) {
          ctx.shadowColor = color; ctx.shadowBlur = 16;
        }
        ctx.fillStyle = '#0a0d13';
        ctx.beginPath(); ctx.arc(sx, sy, rp + 1.5, 0, Math.PI * 2); ctx.fill();
        const img = dead ? null : loadImg(`${specIconUrl(p.icon)}`);
        ctx.save();
        ctx.beginPath(); ctx.arc(sx, sy, rp - 1.5, 0, Math.PI * 2); ctx.clip();
        if (img) ctx.drawImage(img, sx - rp, sy - rp, rp * 2, rp * 2);
        else { ctx.fillStyle = dead ? '#3a404c' : color; ctx.fillRect(sx - rp, sy - rp, rp * 2, rp * 2); }
        ctx.restore();
        ctx.lineWidth = sel ? 3.2 : 2.4;
        ctx.strokeStyle = dead ? '#6b7383' : color;
        ctx.beginPath(); ctx.arc(sx, sy, rp, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
        if (dead) {
          ctx.strokeStyle = '#f0646f'; ctx.lineWidth = 2.4;
          const k = rp * 0.5;
          ctx.beginPath(); ctx.moveTo(sx - k, sy - k); ctx.lineTo(sx + k, sy + k); ctx.moveTo(sx + k, sy - k); ctx.lineTo(sx - k, sy + k); ctx.stroke();
        } else if (hpFrac != null) {
          ctx.lineWidth = 2.6; ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(0,0,0,.55)';
          ctx.beginPath(); ctx.arc(sx, sy, rp + 4.2, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = hpColor(hpFrac);
          ctx.beginPath(); ctx.arc(sx, sy, rp + 4.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpFrac); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        R.hits.push({ id: tk.id, sx, sy, r: rp + 4, kind: 'player' });
        if (R.names || sel || hov) labels.push({ sx, sy: sy + rp + 15, text: p.name, color, strong: sel || hov, alpha });
      } else if (tk.kind === 'boss') {
        const rb = rp * 1.9;
        ctx.save();
        ctx.translate(sx, sy);
        const col = BOSS_COLORS[R.bosses.findIndex((x) => x.id === tk.id) % 3] || '#f0646f';
        ctx.shadowColor = col; ctx.shadowBlur = 18;
        ctx.fillStyle = 'rgba(30,10,14,.92)'; ctx.strokeStyle = col; ctx.lineWidth = 2.6;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i - Math.PI / 2; ctx.lineTo(Math.cos(a) * rb, Math.sin(a) * rb); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(0, 0, rb * 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        R.hits.push({ id: tk.id, sx, sy, r: rb, kind: 'boss', label: true });
        labels.push({ sx, sy: sy - rb - 8, text: actorName(tk.id), color: '#ffd9dc', strong: true, alpha: 1, size: 12 });
      } else if (tk.kind === 'npc') {
        const tier = tk.tier || 'minor';
        const nm = actorName(tk.id);
        if (tier === 'minor') {
          ctx.fillStyle = 'rgba(240,162,59,.85)';
          ctx.beginPath(); ctx.arc(sx, sy, 3.4, 0, Math.PI * 2); ctx.fill();
          R.hits.push({ id: tk.id, key: tk.key, sx, sy, r: 4, kind: 'npc', label: true, tier });
          if (hov || sel) labels.push({ sx, sy: sy - 9, text: nm, color: '#f6c987', strong: true, alpha: 1 });
        } else if (tier === 'medium') {
          const d = rp * 0.95;
          ctx.fillStyle = 'rgba(240,162,59,.92)'; ctx.strokeStyle = '#2a1a05'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(sx, sy - d); ctx.lineTo(sx + d, sy); ctx.lineTo(sx, sy + d); ctx.lineTo(sx - d, sy); ctx.closePath(); ctx.fill(); ctx.stroke();
          if (hpFrac != null) {
            ctx.lineWidth = 2.2; ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.arc(sx, sy, d + 4, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = hpColor(hpFrac); ctx.beginPath(); ctx.arc(sx, sy, d + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpFrac); ctx.stroke();
          }
          R.hits.push({ id: tk.id, key: tk.key, sx, sy, r: d + 3, kind: 'npc', label: true, tier });
          if (R.names || hov || sel) labels.push({ sx, sy: sy - d - 8, text: nm, color: '#f6c987', strong: hov || sel, alpha: 1 });
        } else {
          const rm = rp * 1.55;
          const since = T - tk.t[0];
          if (since >= 0 && since < 1600) { // aparición
            const k = since / 1600;
            ctx.strokeStyle = `rgba(240,162,59,${1 - k})`; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(sx, sy, rm + 4 + k * 38, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.save();
          ctx.translate(sx, sy);
          ctx.shadowColor = '#f0a23b'; ctx.shadowBlur = 14;
          ctx.fillStyle = 'rgba(46,28,8,.95)'; ctx.strokeStyle = '#f0a23b'; ctx.lineWidth = 2.6;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) { const a = (Math.PI / 4) * i + Math.PI / 8; ctx.lineTo(Math.cos(a) * rm, Math.sin(a) * rm); }
          ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#ffd9a0';
          ctx.font = `800 ${Math.round(rm * 0.95)}px ${UI_FONT}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText((nm.match(/[A-Za-zÁÉÍÓÚÑ0-9]/g) || ['?'])[0].toUpperCase(), 0, 1);
          ctx.textBaseline = 'alphabetic';
          ctx.restore();
          if (hpFrac != null) {
            ctx.lineWidth = 2.8; ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.arc(sx, sy, rm + 4.5, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = hpColor(hpFrac); ctx.beginPath(); ctx.arc(sx, sy, rm + 4.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpFrac); ctx.stroke();
          }
          R.hits.push({ id: tk.id, key: tk.key, sx, sy, r: rm + 4, kind: 'npc', label: true, tier });
          labels.push({ sx, sy: sy - rm - 9, text: `${nm}${hpFrac != null ? ` ${Math.round(hpFrac * 100)} %` : ''}`, color: '#ffd9a0', strong: true, alpha: 1, size: 11 });
        }
      } else {
        const owner = S.actors.get(tk.id)?.petOwner;
        const op = owner != null ? playerInfo(owner) : null;
        ctx.fillStyle = op ? classColor(op.cls) : '#9aa3b2';
        ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.arc(sx, sy, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // etiquetas sin solaparse
    ctx.textAlign = 'center';
    const placed = [];
    labels.sort((a, c) => (c.strong ? 1 : 0) - (a.strong ? 1 : 0));
    for (const l of labels) {
      ctx.font = `${l.strong ? 700 : 600} ${l.size || 11}px ${UI_FONT}`;
      const w = ctx.measureText(l.text).width + 4;
      const rect = { x0: l.sx - w / 2, x1: l.sx + w / 2, y0: l.sy - 11, y1: l.sy + 3 };
      if (!l.strong && placed.some((p) => rect.x0 < p.x1 && rect.x1 > p.x0 && rect.y0 < p.y1 && rect.y1 > p.y0)) continue;
      placed.push(rect);
      ctx.globalAlpha = l.alpha;
      ctx.lineWidth = 3.4; ctx.strokeStyle = 'rgba(6,9,14,.92)'; ctx.lineJoin = 'round';
      ctx.strokeText(l.text, l.sx, l.sy);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.sx, l.sy);
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------ línea de tiempo
  function drawTimeline() {
    const { tlCtx: c, tw: w, th: h, dpr } = R;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const X = (T) => ((T - R.W0) / (R.W1 - R.W0)) * w;
    c.fillStyle = '#0e1a33';
    c.beginPath(); c.roundRect(0, 0, w, h, 10); c.fill();
    c.save();
    c.beginPath(); c.roundRect(0, 0, w, h, 10); c.clip();

    // fases
    R.phases.forEach((p, i) => {
      const x0 = X(Math.max(p.start, R.W0));
      const x1 = X(Math.min(p.end, R.W1));
      if (x1 <= x0) return;
      c.fillStyle = i % 2 ? 'rgba(255,255,255,.045)' : 'rgba(255,255,255,.015)';
      c.fillRect(x0, 0, x1 - x0, h);
      c.fillStyle = 'rgba(150,165,195,.6)';
      c.font = `600 10px ${UI_FONT}`;
      c.textAlign = 'left';
      const name = p.name.replace(/^(Stage|Intermission)\s*\w*:\s*/i, (m) => (/^Inter/i.test(m) ? '⏸ ' : ''));
      if (x1 - x0 > 50) c.fillText(name, x0 + 6, 12, x1 - x0 - 10);
    });

    // marcas de tiempo
    const span = (R.W1 - R.W0) / 1000;
    const stepS = span > 600 ? 60 : span > 180 ? 30 : span > 60 ? 10 : 5;
    c.fillStyle = 'rgba(150,165,195,.45)';
    c.font = `500 9px ${UI_FONT}`;
    c.textAlign = 'center';
    const rel0 = Math.ceil((R.W0 - R.raw.startTime) / 1000 / stepS) * stepS;
    for (let s = rel0; R.raw.startTime + s * 1000 <= R.W1; s += stepS) {
      const x = X(R.raw.startTime + s * 1000);
      c.fillRect(x, h - 5, 1, 5);
      if (x > 14 && x < w - 14) c.fillText(clock(s * 1000), x, h - 8);
    }

    // vida de los bosses
    R.bosses.forEach((tk, bi) => {
      const col = BOSS_COLORS[bi % 3];
      const top = 20;
      const bottom = h - 22;
      c.beginPath();
      let started = false;
      let lastX = 0;
      for (let px = 0; px <= w; px += 2) {
        const T = R.W0 + (px / w) * (R.W1 - R.W0);
        const s = sample(tk, T);
        const fr = s.mx > 0 ? clamp(s.hp / s.mx, 0, 1) : 1;
        const y = bottom - (bottom - top) * fr;
        if (!started) { c.moveTo(px, y); started = true; } else c.lineTo(px, y);
        lastX = px;
      }
      c.strokeStyle = col; c.lineWidth = 1.8; c.globalAlpha = 0.9; c.stroke();
      if (bi === 0) {
        c.lineTo(lastX, bottom); c.lineTo(0, bottom); c.closePath();
        const g = c.createLinearGradient(0, top, 0, bottom);
        g.addColorStop(0, 'rgba(240,100,111,.22)'); g.addColorStop(1, 'rgba(240,100,111,0)');
        c.fillStyle = g; c.globalAlpha = 1; c.fill();
      }
      c.globalAlpha = 1;
    });

    // escudos (naranja) y PI (cian)
    for (const s of R.shields) {
      c.fillStyle = 'rgba(240,162,59,.9)';
      c.beginPath(); c.roundRect(X(s.start), h - 18, Math.max(3, X(s.end) - X(s.start)), 4, 2); c.fill();
    }
    for (const p of R.pi) {
      c.fillStyle = 'rgba(80,225,255,.9)';
      c.beginPath(); c.roundRect(X(p.start), h - 13, Math.max(3, X(p.end) - X(p.start)), 4, 2); c.fill();
    }
    // muerte masiva (wipe)
    if (R.wipe && R.wipe.kind !== 'attrition') {
      c.fillStyle = 'rgba(240,100,111,.22)';
      c.fillRect(X(R.wipe.t), 0, Math.max(3, X(R.wipe.t + WIPE_WINDOW_MS) - X(R.wipe.t)), h);
    }
    // aparición de adds importantes
    for (const ad of R.feed.filter((e) => e.kind === 'add')) {
      const x = X(ad.t);
      c.fillStyle = '#f0a23b';
      c.beginPath(); c.moveTo(x, h - 28); c.lineTo(x + 4, h - 24); c.lineTo(x, h - 20); c.lineTo(x - 4, h - 24); c.closePath(); c.fill();
    }
    // muertes
    for (const d of R.feed.filter((e) => e.kind === 'death')) {
      const x = X(d.t);
      c.strokeStyle = 'rgba(240,100,111,.8)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x, 16); c.lineTo(x, h - 20); c.stroke();
      c.fillStyle = '#f0646f';
      c.beginPath(); c.arc(x, 16, 3.4, 0, Math.PI * 2); c.fill();
    }

    // progreso y cabezal
    const xp = X(R.T);
    c.fillStyle = 'rgba(91,141,239,.10)';
    c.fillRect(0, 0, xp, h);
    if (R.tlHover != null) {
      const xh = X(R.tlHover);
      c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(xh, 0, 1, h);
      const txt = clock(R.tlHover - R.raw.startTime);
      c.font = `700 10px ${UI_FONT}`;
      const tw2 = c.measureText(txt).width + 10;
      const bx = clamp(xh - tw2 / 2, 2, w - tw2 - 2);
      c.fillStyle = 'rgba(8,11,16,.92)'; c.beginPath(); c.roundRect(bx, 2, tw2, 16, 5); c.fill();
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(txt, bx + tw2 / 2, 13);
    }
    c.fillStyle = '#fff';
    c.fillRect(xp - 1, 0, 2, h);
    c.beginPath(); c.arc(xp, h - 4, 4, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  // ------------------------------------------------------------ paneles
  function updateHud() {
    if (!R) return;
    const T = R.T;
    const ph = R.phases.find((p) => T >= p.start && T < p.end) || R.phases[R.phases.length - 1];
    const sh = R.shields.find((s) => T >= s.start && T <= s.end + 1500);
    const piN = R.pi.filter((p) => T >= p.start && T < p.end).length;
    $('#rpHudL').innerHTML = [
      ph ? `<span class="hchip">${esc(ph.name)}</span>` : '',
      sh ? `<span class="hchip orange">${t('rpShield')}</span>` : '',
      piN ? `<span class="hchip cyan">PI ×${piN}</span>` : '',
    ].join('');
    const bossHtml = R.bosses.map((tk, i) => {
      const s = sample(tk, T);
      if (!(s.mx > 0)) return '';
      const fr = clamp(s.hp / s.mx, 0, 1);
      return `<div class="bhp"><div class="bhp-top"><span style="color:${BOSS_COLORS[i % 3]}">${esc(actorName(tk.id))}</span><b>${num(fr * 100, 1)} %</b></div>
        <div class="bhp-bar"><span style="width:${fr * 100}%;background:${BOSS_COLORS[i % 3]}"></span></div></div>`;
    }).join('');
    const groups = activeEnemies(T).filter((g) => g.tier !== 'boss');
    const major = groups.filter((g) => g.tier === 'major').slice(0, 3);
    const minorN = groups.filter((g) => g.tier !== 'major').reduce((s, g) => s + g.count, 0);
    const addsHtml = major.map((g) => `<div class="bhp add"><div class="bhp-top"><span>${esc(g.name)} ×${g.count}</span><b>${g.minHp != null ? `${num(g.minHp, 0)} %` : ''}</b></div>
        <div class="bhp-bar"><span style="width:${g.minHp ?? 100}%"></span></div></div>`).join('')
      + (minorN ? `<div class="bhp-more">${t('rpMoreAdds', { n: minorN })}</div>` : '');
    $('#rpHudR').innerHTML = bossHtml + addsHtml;
  }

  // Enemigos visibles en el instante T agrupados por tipo (los adds iguales se cuentan juntos)
  function activeEnemies(T) {
    const groups = new Map();
    for (const tk of R.data.tracks.values()) {
      if (tk.kind !== 'npc' && tk.kind !== 'boss') continue;
      const s = sample(tk, T);
      if (s.stale || (s.age != null && s.age > 5000)) continue;
      if (tk.kind === 'npc' && s.mx > 0 && s.hp <= 0 && (s.age ?? 0) > 1500) continue;
      const tier = tk.kind === 'boss' ? 'boss' : tk.tier || 'minor';
      const gk = `${tk.id}`;
      let g = groups.get(gk);
      if (!g) { g = { name: actorName(tk.id), tier, count: 0, minHp: null, sumHp: 0, nHp: 0 }; groups.set(gk, g); }
      g.count++;
      if (s.mx > 0) {
        const hp = clamp((s.hp / s.mx) * 100, 0, 100);
        g.minHp = g.minHp == null ? hp : Math.min(g.minHp, hp);
        g.sumHp += hp; g.nHp++;
      }
    }
    const rank = { boss: 3, major: 2, medium: 1, minor: 0 };
    return [...groups.values()].sort((a, b) => rank[b.tier] - rank[a.tier] || b.count - a.count);
  }

  // ------------------------------------------------------------ buffos y debuffos del jugador, su objetivo y el jefe (como Warcraft Logs)
  // Se descargan los eventos de auras solo del jugador elegido, de su objetivo actual y del jefe, y se calcula qué hay activo en cada momento.
  const AU_DEPTH = /^(apply|remove)(buff|debuff)$/;
  function buildIntervals(events, w0, w1) {
    const open = new Map();
    const out = [];
    for (const e of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
      const g = e.abilityGameID;
      const kind = e.type;
      if (AU_DEPTH.test(kind)) {
        let o = open.get(g);
        if (kind.startsWith('apply')) {
          if (!o) { o = { guid: g, s: e.timestamp, stacks: 1, depth: 0 }; open.set(g, o); }
          o.depth++;
        } else {
          if (!o) o = { guid: g, s: w0, stacks: 1, depth: 1 }; // ya estaba activa al empezar
          o.depth--;
          if (o.depth <= 0) { out.push({ guid: g, s: o.s, e: e.timestamp, stacks: o.stacks }); open.delete(g); } else open.set(g, o);
        }
      } else if (/^(apply|remove)(buff|debuff)stack$/.test(kind)) {
        const o = open.get(g);
        if (o && e.stack) o.stacks = e.stack;
      }
    }
    for (const o of open.values()) out.push({ guid: o.guid, s: o.s, e: w1, stacks: o.stacks });
    return out;
  }

  function wantAuras(kind, type, id) {
    const key = `${kind}:${type}:${id}`;
    R.au = R.au || new Map();
    R.auWait = R.auWait || new Set();
    if (R.au.has(key) || R.auWait.has(key)) return R.au.get(key) || null;
    R.auWait.add(key);
    const mine = R;
    allEvents(fullWin(R.raw), type, `,targetID:${id}${kind === 'enemy' ? ',hostilityType:Enemies' : ''}`).then((ev) => {
      if (R !== mine) return;
      R.au.set(key, buildIntervals(ev, R.raw.startTime, R.raw.endTime));
      R.auWait.delete(key);
      R.lastUi = 0;
    }).catch((err) => { console.warn('auras', key, err); if (R === mine) { R.au.set(key, []); R.auWait.delete(key); } });
    return null;
  }

  // objetivo del jugador: el destino de su último lanzamiento contra un enemigo
  function wantTargets(id) {
    const key = `cast:${id}`;
    R.au = R.au || new Map();
    R.auWait = R.auWait || new Set();
    if (R.au.has(key) || R.auWait.has(key)) return R.au.get(key) || null;
    R.auWait.add(key);
    const mine = R;
    allEvents(fullWin(R.raw), 'Casts', `,sourceID:${id}`).then((ev) => {
      if (R !== mine) return;
      R.au.set(key, ev.filter((e) => e.type === 'cast' && !e.fake && e.targetID > 0 && S.actors.get(e.targetID)?.type !== 'Player' && S.actors.get(e.targetID)?.type !== 'Pet')
        .map((e) => ({ t: e.timestamp, id: e.targetID })).sort((a, b) => a.t - b.t));
      R.auWait.delete(key);
      R.lastUi = 0;
    }).catch(() => { if (R === mine) { R.au.set(key, []); R.auWait.delete(key); } });
    return null;
  }

  function targetAt(id, T) {
    const list = R.au?.get(`cast:${id}`);
    if (!list) return null;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].t <= T) lo = mid + 1; else hi = mid; }
    const hit = list[lo - 1];
    return hit && T - hit.t < 12000 ? hit.id : null;
  }

  const activeAuras = (arr, T) => (arr || []).filter((a) => a.s <= T && T < a.e).sort((x, y) => x.s - y.s);

  function auraRow(label, arr, T, cls) {
    if (arr == null) return `<div class="au-sec"><small>${label}</small><span class="muted">${t('loading')}</span></div>`;
    const act = activeAuras(arr, T);
    return `<div class="au-sec ${cls}"><small>${label} <b>${act.length}</b></small><div class="au-grid">${act.length ? act.map((a) => {
      const ab = ability(a.guid);
      return `<span class="au-ic">${iconImg(ab.icon, 26, `${esc(ab.name)}${a.stacks > 1 ? ` ×${a.stacks}` : ''} · ${clock(a.e - T)}`, a.guid)}${a.stacks > 1 ? `<i>${a.stacks}</i>` : ''}</span>`;
    }).join('') : '<span class="muted">—</span>'}</div></div>`;
  }

  function renderAuras() {
    const el = $('#rpAuras');
    if (!el) return;
    if (R.selected == null || R.data.tracks.get(R.selected)?.kind !== 'player') { el.hidden = true; return; }
    el.hidden = false;
    const T = R.T;
    const pid = R.selected;
    const p = playerInfo(pid);
    wantTargets(pid);
    const bossTk = R.bosses[0];
    const bossId = bossTk?.id ?? null;
    const tid = targetAt(pid, T) ?? bossId;
    const mineB = wantAuras('friendly', 'Buffs', pid);
    const mineD = wantAuras('friendly', 'Debuffs', pid);
    const col = (title, color, sections) => `<div class="au-col"><div class="au-h" style="--cc:${color}">${title}</div>${sections}</div>`;
    let html = col(`${LL('Jugador', 'Player')}: <b>${esc(p.name)}</b>`, classColor(p.cls), auraRow(LL('Buffos', 'Buffs'), mineB, T, 'au-g') + auraRow(LL('Debuffos', 'Debuffs'), mineD, T, 'au-b'));
    if (tid != null) {
      const tb = wantAuras('enemy', 'Buffs', tid);
      const td = wantAuras('enemy', 'Debuffs', tid);
      html += col(`${LL('Objetivo', 'Target')}: <b>${esc(actorName(tid))}</b>`, '#ff8a5c', auraRow(LL('Buffos', 'Buffs'), tb, T, 'au-g') + auraRow(LL('Debuffos', 'Debuffs'), td, T, 'au-b'));
    }
    if (bossId != null && bossId !== tid) {
      const bb = wantAuras('enemy', 'Buffs', bossId);
      const bd = wantAuras('enemy', 'Debuffs', bossId);
      html += col(`${LL('Jefe', 'Boss')}: <b>${esc(actorName(bossId))}</b>`, '#e7b84a', auraRow(LL('Buffos', 'Buffs'), bb, T, 'au-g') + auraRow(LL('Debuffos', 'Debuffs'), bd, T, 'au-b'));
    }
    if (R.auSig !== html) { R.auSig = html; el.innerHTML = html; }
  }

  function updateSide() {
    if (!R) return;
    renderAuras();
    const list = $('#rpList');
    if (!list) return;
    if (R.side === 'players') {
      const rows = [];
      for (const tk of R.data.tracks.values()) {
        if (tk.kind !== 'player') continue;
        rows.push({ id: tk.id, ...liveStats(tk.id), s: sample(tk, R.T) });
      }
      rows.sort((a, b) => b.dmg - a.dmg);
      const max = Math.max(1, rows[0]?.dmg || 1);
      list.innerHTML = rows.map((r) => {
        const p = playerInfo(r.id);
        const dead = deathAt(r.id, R.T);
        const hp = r.s.mx > 0 ? clamp((r.s.hp / r.s.mx) * 100, 0, 100) : null;
        return `<div class="rpr ${R.selected === r.id ? 'sel' : ''} ${dead ? 'dead' : ''} ${isMe(p.name) ? 'me' : ''}" data-rp-id="${r.id}" style="--cc:${classColor(p.cls)};--dp:${(r.dmg / max) * 100}%">
          <img class="spec-ic" src="${specIconUrl(esc(p.icon))}" alt="">
          <div class="rpr-body">
            <div class="rpr-top"><b>${esc(p.name)}</b>${isMe(p.name) ? `<span class="you">${t('you')}</span>` : ''}<span class="grow"></span><em>${plain(r.dmg)}</em><small>${plain(r.dps)}</small></div>
            <div class="rpr-hp">${dead ? `<i class="rip">✕ ${clock(dead.timestamp - R.raw.startTime)}</i>` : hp != null ? `<span style="width:${hp}%;background:${hpColor(hp / 100)}"></span>` : ''}</div>
          </div></div>`;
      }).join('');
    } else if (R.side === 'adds') {
      const groups = activeEnemies(R.T);
      list.innerHTML = groups.length ? groups.map((g) => `<div class="rpa tier-${g.tier}">
          <span class="rpa-ic">${esc((g.name.match(/[A-Za-zÁÉÍÓÚÑ0-9]/g) || ['?'])[0].toUpperCase())}</span>
          <div class="rpa-body"><div class="rpr-top"><b>${esc(g.name)}</b><span class="grow"></span><em>×${g.count}</em></div>
            <div class="rpa-sub"><span class="rpa-tier">${g.tier === 'boss' ? t('rpBosses') : t({ major: 'rpTierMajor', medium: 'rpTierMedium', minor: 'rpTierMinor' }[g.tier])}</span>
              ${g.nHp ? `${t('hp')}: ${num(g.sumHp / g.nHp, 0)} %` : ''}</div>
            ${g.nHp ? `<div class="rpr-hp"><span style="width:${g.sumHp / g.nHp}%;background:${hpColor(g.sumHp / g.nHp / 100)}"></span></div>` : ''}</div></div>`).join('')
        : `<div class="empty sm">${t('rpNoEnemies')}</div>`;
    } else {
      const shown = R.feed.filter((e) => e.t <= R.T).slice(-40).reverse();
      list.innerHTML = shown.length ? shown.map(feedRow).join('') : `<div class="empty sm">${t('rpNoEvents')}</div>`;
    }
  }

  function who(id) {
    const p = playerInfo(id);
    return `<b style="color:${classColor(p.cls)}">${esc(p.name)}</b>`;
  }

  function feedRow(e) {
    const rel = clock(e.t - R.raw.startTime);
    let body = '';
    if (e.kind === 'death') {
      const a = ability(e.d.abilityId);
      body = `<span class="fi red">✕</span><div>${t('rpDied', { name: who(e.d.targetID) })}<br><small><span data-spell="${e.d.abilityId}">${iconImg(a.icon, 14)} ${esc(a.name)}</span> · ${esc(actorName(e.d.killerId))}${e.d.blowAmount ? ` · ${plain(e.d.blowAmount)}` : ''}</small></div>`;
    } else if (e.kind === 'pi') {
      const a = ability(POWER_INFUSION);
      body = `<span class="fi">${iconImg(a.icon, 20, '', POWER_INFUSION)}</span><div>${t('rpPi', { a: who(e.p.source), b: who(e.p.target) })}${e.p.selfAlso ? ` <small>${t('selfAlso')}</small>` : ''}</div>`;
    } else if (e.kind === 'dispel' || e.kind === 'interrupt') {
      const a = ability(e.e.extraAbilityGameID ?? e.e.abilityGameID);
      body = `<span class="fi">${iconImg(a.icon, 20, '', e.e.extraAbilityGameID ?? e.e.abilityGameID)}</span><div>${t(e.kind === 'dispel' ? 'rpDispel' : 'rpInterrupt', { a: who(e.e.sourceID) })}<br><small>${esc(a.name)}</small></div>`;
    } else if (e.kind === 'mech') {
      const a = ability(e.m.aid);
      body = `<span class="fi red">◉</span><div>${LL(`${who(e.m.id)} recibió una mecánica evitable`, `${who(e.m.id)} took an avoidable mechanic`)}<br><small><span data-spell="${e.m.aid}">${iconImg(a.icon, 14)} ${esc(a.name)}</span> · ${plain(e.m.amount)}</small></div>`;
    } else if (e.kind === 'wipe') {
      body = `<span class="fi red">☠</span><div><b>WIPE</b><br><small>${wipeCauseText(e.w)}</small></div>`;
    } else if (e.kind === 'add') {
      body = `<span class="fi amber">◆</span><div>${t('rpAdd', { name: `<b>${esc(actorName(e.cluster.npcId))}</b>`, n: e.cluster.count > 1 ? ` ×${e.cluster.count}` : '' })}</div>`;
    } else {
      body = `<span class="fi cyan">◆</span><div>${t('rpPhase', { name: esc(e.name) })}</div>`;
    }
    return `<div class="rpe" data-rp-t="${e.t}"><span class="rpe-t">${rel}</span>${body}</div>`;
  }

  window.R_REDRAW = () => { if (R) { R.dirty = true; R.floorSig = ''; } };
  return { mount, stop, debug: () => R, load };
})();

VIEWS.replay = async (f) => {
  S.post = (seq) => Replay.mount(f, seq);
  return headerHTML(f, t('tabs.replay'), t('replaySub'))
    + `<div id="rpRoot" class="rp"><div class="rp-loading"><span class="spinner"></span><span id="rpProg">${t('replayLoading', { n: 0 })}</span></div></div>`;
};
TABS.push('replay');
