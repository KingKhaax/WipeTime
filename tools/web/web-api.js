'use strict';

// Versión web de WipeTime (GitHub Pages): sustituye al preload.js de Electron.
// Expone el mismo `window.api` que la app de escritorio, pero hablando con el servidor intermedio (Vercel, que guarda las claves)
// y con las APIs públicas que permiten CORS (Raider.IO, Wowhead, Raidbots). Lo que se guarda va al navegador (localStorage / IndexedDB).
(function () {
  const PROXY = '__PROXY__';
  const VERSION = '__VERSION__';
  window.WT_WEB = true;
  window.WT_PROXY = PROXY;
  document.documentElement.classList.add('web');

  const REGIONS = ['eu', 'us', 'kr', 'tw'];
  const WOWHEAD_LOCALE = { es: 6, en: 0, de: 3, fr: 2 };
  const BNET_LOCALE = { es: 'es_ES', en: 'en_US', de: 'de_DE', fr: 'fr_FR' };
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
  };

  // ---- Almacén de claves/valores grandes (mapas e imágenes que sube el usuario, mapa de talentos) en IndexedDB
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('wipetime', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function idb(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  const kvGet = (k) => idb('readonly', (s) => s.get(k)).catch(() => undefined);
  const kvSet = (k, v) => idb('readwrite', (s) => s.put(v, k)).catch(() => undefined);
  const kvDel = (k) => idb('readwrite', (s) => s.delete(k)).catch(() => undefined);

  // ---- Warcraft Logs (a través del servidor intermedio) con caché en memoria
  const QCACHE = new Map();
  const inflightQ = new Map();
  function qcacheTtl(gql) {
    if (/rateLimitData/.test(gql)) return 0;
    if (/fights\s*\{\s*id name/.test(gql)) return 5 * 60 * 1000;
    if (/rankings|zoneRanking|guildData|characterData/.test(gql)) return 12 * 3600 * 1000;
    if (/worldData/.test(gql)) return 3600 * 1000; // zonas y jefes de la raid: pueden cambiar con un parche, no se guardan una semana
    return 7 * 24 * 3600 * 1000;
  }
  async function wclFetch(gql, variables, lang) {
    const res = await fetch(`${PROXY}/wcl`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: gql, variables, lang }) });
    if (res.status === 429) throw new Error('RATE_LIMIT');
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return res.json();
  }
  async function query(gql, variables, lang, noCache) {
    try {
      const ttl = noCache ? 0 : qcacheTtl(gql);
      if (!ttl) return await wclFetch(gql, variables, lang);
      const key = JSON.stringify([gql, variables, ['es', 'de', 'fr'].includes(lang) ? lang : 'en']);
      const hit = QCACHE.get(key);
      if (hit && Date.now() - hit.at < ttl) return hit.res;
      if (!inflightQ.has(key)) {
        inflightQ.set(key, wclFetch(gql, variables, lang).then((res) => {
          if (res && res.data && !res.errors) {
            if (QCACHE.size > 60) QCACHE.delete(QCACHE.keys().next().value);
            QCACHE.set(key, { at: Date.now(), res });
          }
          return res;
        }).finally(() => inflightQ.delete(key)));
      }
      return await inflightQ.get(key);
    } catch (e) { return { error: e.message }; }
  }

  // ---- Imágenes del usuario (mapas de jefes y arte del parche)
  const MIME_OK = ['image/png', 'image/jpeg', 'image/webp'];
  const MAP_MAX_BYTES = 25 * 1024 * 1024;
  const mapKeyOk = (k) => typeof k === 'string' && /^\d+-\d+$/.test(k);
  const artKeyOk = (k) => typeof k === 'string' && /^[a-z0-9.\-]{1,40}$/.test(k);
  const dataUrlOk = (u) => typeof u === 'string' && u.length <= MAP_MAX_BYTES * 1.4 && /^data:image\/(png|jpeg|webp);base64,/.test(u);
  const readAsDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
  const cleanCalib = (c) => {
    const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
    return { zoom: n(c?.zoom, 0.2, 4, 1), dx: n(c?.dx, -200, 200, 0), dy: n(c?.dy, -200, 200, 0), rot: Math.round(n(c?.rot, 0, 3, 0)), flipH: !!c?.flipH, flipV: !!c?.flipV, opacity: n(c?.opacity, 0.1, 1, 0.9) };
  };
  const mapPayload = async (key) => {
    const dataUrl = await kvGet('map:' + key);
    return dataUrl ? { dataUrl, calib: (await kvGet('calib:' + key)) || null } : null;
  };
  function pickImage() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = () => resolve(input.files && input.files[0] || null);
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }

  // ---- Blizzard (servidor intermedio): solo datos públicos, sin inicio de sesión
  const bnetRegion = () => { const r = ls.get('wt:bnetRegion'); return REGIONS.includes(r) ? r : 'eu'; };
  async function bnetApi(pathQuery, region = bnetRegion()) {
    const res = await fetch(`${PROXY}/bnet?region=${region}&path=${encodeURIComponent(pathQuery)}`);
    if (!res.ok) throw new Error('BNET_HTTP_' + res.status);
    return res.json();
  }
  async function charInfo(realmSlug, name, lang, region = bnetRegion()) {
    const ns = `profile-${region}`;
    const loc = BNET_LOCALE[lang] || 'en_US';
    const base = `/profile/wow/character/${encodeURIComponent(String(realmSlug).toLowerCase())}/${encodeURIComponent(String(name).toLowerCase())}`;
    const [p, md] = await Promise.all([bnetApi(`${base}?namespace=${ns}&locale=${loc}`, region), bnetApi(`${base}/character-media?namespace=${ns}`, region).catch(() => null)]);
    return {
      name: p.name, level: p.level, race: p.race?.name, cls: p.character_class?.name, classId: p.character_class?.id, faction: p.faction?.type,
      guild: p.guild ? { name: p.guild.name, realmSlug: p.guild.realm.slug, realmName: p.guild.realm.name, faction: p.guild.faction?.type } : null,
      realmSlug: p.realm?.slug || realmSlug, realmName: p.realm?.name || realmSlug, region,
      avatar: md?.assets?.find((x) => x.key === 'avatar')?.value || md?.assets?.[0]?.value || '',
    };
  }
  const itemIconCache = new Map();
  function itemIcon(id, region) {
    if (!id) return Promise.resolve('');
    if (!itemIconCache.has(id)) {
      itemIconCache.set(id, bnetApi(`/data/wow/media/item/${Number(id)}?namespace=static-${region}`, region)
        .then((j) => j.assets?.find((a) => a.key === 'icon')?.value || '').catch(() => { itemIconCache.delete(id); return ''; }));
    }
    return itemIconCache.get(id);
  }
  async function armory(realmSlug, name, lang, region = bnetRegion()) {
    if (!REGIONS.includes(region)) region = bnetRegion();
    const ns = `profile-${region}`;
    const loc = BNET_LOCALE[lang] || 'en_US';
    const base = `/profile/wow/character/${encodeURIComponent(String(realmSlug).toLowerCase())}/${encodeURIComponent(String(name).toLowerCase())}`;
    const get = (sub) => bnetApi(`${base}${sub}?namespace=${ns}&locale=${loc}`, region);
    const [sum, eq, st, md] = await Promise.all([get(''), get('/equipment').catch(() => null), get('/statistics').catch(() => null), get('/character-media').catch(() => null)]);
    const equipped = eq?.equipped_items || [];
    const icons = await Promise.all(equipped.map((i) => itemIcon(i.item?.id, region)));
    const items = equipped.map((i, k) => ({
      slot: i.slot?.type || '', slotName: i.slot?.name || '', id: i.item?.id, name: i.name || '', ilvl: i.level?.value || 0,
      quality: i.quality?.type || 'COMMON', icon: icons[k], binding: i.binding?.name || '',
      enchant: (i.enchantments || []).map((e) => e.display_string).filter(Boolean),
      gems: (i.sockets || []).map((sk) => ({ name: sk.item?.name || '', stat: sk.display_string || '' })),
      set: i.set?.item_set?.name || '', armorType: i.item_subclass?.name || '',
    }));
    const pct = (o) => (o ? { rating: o.rating_normalized ?? o.rating ?? 0, value: o.value ?? o.rating_bonus ?? 0 } : null);
    const stats = st ? {
      health: st.health, power: st.power, powerType: st.power_type?.name || '',
      strength: st.strength?.effective ?? 0, agility: st.agility?.effective ?? 0, intellect: st.intellect?.effective ?? 0, stamina: st.stamina?.effective ?? 0,
      armor: st.armor?.effective ?? 0, attackPower: st.attack_power ?? 0, spellPower: st.spell_power ?? 0,
      crit: (st.spell_crit?.value ?? 0) >= (st.melee_crit?.value ?? 0) ? pct(st.spell_crit) : pct(st.melee_crit),
      haste: (st.spell_haste?.value ?? 0) >= (st.melee_haste?.value ?? 0) ? pct(st.spell_haste) : pct(st.melee_haste),
      mastery: pct(st.mastery),
      versatility: { rating: st.versatility ?? 0, value: st.versatility_damage_done_bonus ?? 0, taken: st.versatility_damage_taken_bonus ?? 0 },
      leech: pct(st.lifesteal), avoidance: pct(st.avoidance), speed: pct(st.speed),
      dodge: pct(st.dodge), parry: pct(st.parry), block: pct(st.block),
    } : null;
    return {
      name: sum.name, level: sum.level, race: sum.race?.name, cls: sum.character_class?.name, classId: sum.character_class?.id,
      spec: sum.active_spec?.name || '', faction: sum.faction?.type, guild: sum.guild?.name || '', realmName: sum.realm?.name || realmSlug,
      ilvlAvg: sum.average_item_level || 0, ilvlEquipped: sum.equipped_item_level || 0, achievements: sum.achievement_points || 0,
      render: md?.assets?.find((a) => a.key === 'main-raw')?.value || md?.assets?.find((a) => a.key === 'main')?.value || md?.assets?.find((a) => a.key === 'inset')?.value || '',
      avatar: md?.assets?.find((a) => a.key === 'avatar')?.value || '', lastLogin: sum.last_login_timestamp || 0, gender: sum.gender?.type || '',
      guildRealm: sum.guild?.realm?.slug || '', guildRealmName: sum.guild?.realm?.name || '', realmSlug: sum.realm?.slug || realmSlug, region,
      items, stats, at: Date.now(),
    };
  }
  const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (err) { return { error: String(err.message || err) }; } };

  // ---- Raider.IO (permite CORS desde cualquier origen)
  const rioGet = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP_' + res.status);
    return res.json();
  };

  // ---- Wowhead (tooltips de habilidades) y Raidbots (mapa de talentos)
  const spellMem = new Map();
  let talentMem = null;

  const openOk = /^https:\/\/(([a-z]+\.)?warcraftlogs\.com|worldofwarcraft\.blizzard\.com|news\.blizzard\.com|raider\.io|www\.raider\.io)\//;

  window.api = {
    query,
    clearQueryCache: async () => { const n = QCACHE.size; QCACHE.clear(); return n; },
    getConfig: async () => ({ clientId: '', hasSecret: false, bundled: true, me: ls.get('wt:me') || '', hdIcons: true }),
    setConfig: async ({ me } = {}) => { if (me !== undefined) ls.set('wt:me', String(me).trim()); return true; },
    openExternal: async (url) => { if (openOk.test(String(url))) window.open(url, '_blank', 'noopener,noreferrer'); },
    getMe: async (code) => { const v = ls.get('wt:me:' + code); return v === null ? null : v; },
    setMe: async (code, name) => { ls.set('wt:me:' + code, name); return true; },
    mapGet: async (key) => (mapKeyOk(key) ? mapPayload(key) : null),
    mapPick: async (key) => {
      if (!mapKeyOk(key)) return { error: 'BAD_KEY' };
      const file = await pickImage();
      if (!file) return { canceled: true };
      if (!MIME_OK.includes(file.type)) return { error: 'BAD_TYPE' };
      if (file.size > MAP_MAX_BYTES) return { error: 'TOO_BIG' };
      await kvSet('map:' + key, await readAsDataUrl(file));
      return mapPayload(key);
    },
    mapCalib: async (key, calib) => { if (!mapKeyOk(key)) return false; await kvSet('calib:' + key, cleanCalib(calib)); return true; },
    mapRemove: async (key) => { if (!mapKeyOk(key)) return false; await kvDel('map:' + key); await kvDel('calib:' + key); return true; },
    mapSaveData: async (key, dataUrl) => {
      if (!mapKeyOk(key)) return { error: 'BAD_KEY' };
      if (!dataUrlOk(dataUrl)) return { error: 'BAD_TYPE' };
      await kvSet('map:' + key, dataUrl);
      return mapPayload(key);
    },
    setZoom: (factor) => { document.documentElement.style.zoom = String(Math.min(2, Math.max(0.5, Number(factor) || 1))); },
    appInfo: async () => ({ electron: 'web', chrome: (navigator.userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/) || [''])[0], version: VERSION }),
    updateCheck: async () => ({ outdated: false, latest: VERSION, canInstall: false }),
    updateInstall: async () => ({ error: 'WEB' }),
    onUpdateProgress: () => {},
    setPref: async () => true,
    clearIcons: async () => { try { if (window.caches) await caches.delete('wt-icons'); } catch { /* sin caché */ } return 0; },
    clearBossMaps: async () => 0,
    exportPng: async () => ({ error: 'solo disponible en la app de escritorio / only in the desktop app' }),
    exportText: async (text, name) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
      a.download = String(name || 'wipetime.csv');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return { ok: true };
    },
    takeDeepLink: async () => {
      // ?report=CODE&fight=N  ·  ?log=<enlace de Warcraft Logs>
      const q = new URLSearchParams(location.search);
      const fromLog = String(q.get('log') || q.get('url') || '').match(/reports\/([A-Za-z0-9]+)(?:.*[#&?]fight=(\d+))?/);
      const code = q.get('report') || (fromLog && fromLog[1]);
      const fight = q.get('fight') || (fromLog && fromLog[2]);
      if (!code || !/^[A-Za-z0-9]+$/.test(code)) return null;
      return `wipetime://report/${code}${fight && /^\d+$/.test(fight) ? `?fight=${fight}` : ''}`;
    },
    onDeepLink: () => {},
    rioGuilds: wrap(async (term) => {
      const q = String(term || '').trim();
      if (q.length < 2) return { list: [] };
      const j = await rioGet(`https://raider.io/api/search?term=${encodeURIComponent(q)}&type=guild`);
      const low = q.toLowerCase();
      const list = (j.matches || []).filter((x) => x.type === 'guild' && x.data?.realm && REGIONS.includes(x.data.region?.slug))
        .map((x) => ({ name: x.data.name, realmSlug: x.data.realm.slug, realmName: x.data.realm.name, region: x.data.region.slug, faction: x.data.faction }))
        .sort((a, b) => (a.name.toLowerCase() === low ? 0 : 1) - (b.name.toLowerCase() === low ? 0 : 1) || (a.region === 'eu' ? 0 : 1) - (b.region === 'eu' ? 0 : 1) || a.name.localeCompare(b.name))
        .slice(0, 24);
      return { list };
    }),
    rioRank: wrap(async ({ raid, difficulty, region, realmSlug, guildName, needWorld }) => {
      const regionOk = REGIONS.includes(region) ? region : 'eu';
      const diffOk = ['normal', 'heroic', 'mythic'].includes(difficulty) ? difficulty : 'mythic';
      if (!/^[a-z0-9-]+$/.test(raid || '')) return { error: 'BAD_RAID' };
      const norm = (s) => String(s || '').toLowerCase();
      const slugs = (r) => [norm(r.slug), norm(r.altSlug)].filter(Boolean);
      const page = async (reg, n) => (await rioGet(`https://raider.io/api/v1/raiding/raid-rankings?raid=${raid}&difficulty=${diffOk}&region=${reg}&limit=100&page=${n}`)).raidRankings || [];
      let spain = 0;
      let realm = 0;
      let out = null;
      for (let n = 0; n < 40 && !out; n++) {
        const list = await page(regionOk, n);
        if (!list.length) break;
        for (const e of list) {
          const g = e.guild;
          const same = slugs(g.realm).includes(norm(realmSlug));
          const es = g.realm.locale === 'es_ES';
          if (same && norm(g.name) === norm(guildName)) { out = { found: true, region: e.rank, realm: realm + 1, spain: es ? spain + 1 : null, spanish: es }; break; }
          if (same) realm++;
          if (es) spain++;
        }
      }
      if (!out) return { found: false };
      out.world = null;
      if (needWorld) {
        for (let n = 0; n < 60 && out.world == null; n++) {
          const list = await page('world', n);
          if (!list.length) break;
          const hit = list.find((e) => slugs(e.guild.realm).includes(norm(realmSlug)) && norm(e.guild.name) === norm(guildName));
          if (hit) out.world = hit.rank;
        }
      }
      return out;
    }),
    bnetStatus: async () => ({
      clientId: '', hasSecret: false, bundled: false, hasClient: true, canLogin: false, proxy: true, region: bnetRegion(), loggedIn: false,
      battletag: '', expired: false, cachedGuilds: null, redirect: '',
    }),
    bnetSet: async ({ region } = {}) => { if (region && REGIONS.includes(region)) ls.set('wt:bnetRegion', region); return true; },
    bnetLogin: async () => ({ error: 'NO_BNET_CLIENT' }),
    bnetLogout: async () => true,
    bnetGuilds: async () => ({ error: 'NOT_LOGGED' }),
    bnetChar: wrap((realm, name, lang, region) => charInfo(realm, name, lang, REGIONS.includes(region) ? region : bnetRegion())),
    rioSearch: wrap(async (term) => {
      const q = String(term || '').trim();
      if (q.length < 2) return { list: [], hidden: 0 };
      const j = await rioGet(`https://raider.io/api/search?term=${encodeURIComponent(q)}&type=character`);
      const low = q.toLowerCase();
      const order = { eu: 0, us: 1, kr: 2, tw: 3 };
      let hidden = 0;
      const list = [];
      for (const x of j.matches || []) {
        const d = x.data;
        if (x.type !== 'character' || !d?.realm || !d?.name) continue;
        if (!(d.region?.slug in order)) { hidden++; continue; }
        list.push({
          name: d.name, realmSlug: d.realm.slug, realmName: d.realm.name, altName: d.realm.altName || '', region: d.region.slug, regionShort: d.region.short_name || '',
          locale: d.realm.locale || '', faction: d.faction || '', classId: d.class?.id || 0,
          thumb: d.thumbnail_url ? 'https:' + String(d.thumbnail_url).replace(/^https?:/, '').split('?')[0] : '',
        });
      }
      list.sort((a, b) => (a.name.toLowerCase() === low ? 0 : 1) - (b.name.toLowerCase() === low ? 0 : 1) || order[a.region] - order[b.region] || a.realmName.localeCompare(b.realmName));
      return { list: list.slice(0, 80), hidden };
    }),
    rioChar: wrap(async (region, realmSlug, name) => {
      if (!REGIONS.includes(region)) region = 'eu';
      const fields = 'mythic_plus_scores_by_season:current,mythic_plus_ranks,gear,talents';
      const j = await rioGet(`https://raider.io/api/v1/characters/profile?region=${region}&realm=${encodeURIComponent(realmSlug)}&name=${encodeURIComponent(name)}&fields=${encodeURIComponent(fields)}`);
      const lo = j.talentLoadout;
      const talents = lo && Array.isArray(lo.loadout) ? {
        text: lo.loadout_text || '', spec: j.active_spec_name || '',
        nodes: lo.loadout.filter((x) => !x.grantedNode && x.rank > 0).map((x) => { const e = (x.node?.entries || [])[x.entryIndex || 0] || {}; return e.spell ? { spell: e.spell.id, name: e.spell.name, icon: String(e.spell.icon || '').toLowerCase(), rank: x.rank, max: e.maxRanks || 1, hero: (x.node.subTreeId || 0) > 0 } : null; }).filter(Boolean),
      } : null;
      return { season: j.mythic_plus_scores_by_season?.[0] || null, ranks: j.mythic_plus_ranks || null, ilvl: j.gear?.item_level_equipped || 0, crawled: j.last_crawled_at || '', url: j.profile_url || '', talents };
    }),
    rioSpec: wrap(async (region, realmSlug, name) => {
      if (!REGIONS.includes(region)) region = 'eu';
      const j = await rioGet(`https://raider.io/api/v1/characters/profile?region=${region}&realm=${encodeURIComponent(realmSlug)}&name=${encodeURIComponent(name)}`);
      return { spec: j.active_spec_name || '', cls: j.class || '' };
    }),
    bnetArmory: wrap(armory),
    bnetCrest: wrap(async (realmSlug, guildName) => {
      const slug = encodeURIComponent(String(guildName).trim().toLowerCase().replace(/\s+/g, '-'));
      const g = await bnetApi(`/data/wow/guild/${encodeURIComponent(String(realmSlug).toLowerCase())}/${slug}?namespace=profile-${bnetRegion()}&locale=en_US`);
      const c = g.crest;
      if (!c) return { error: 'NO_CREST' };
      const img = async (href) => {
        try { const u = new URL(href); return (await bnetApi(u.pathname + u.search)).assets?.[0]?.value || ''; } catch { return ''; }
      };
      const col = (x) => `rgba(${x.rgba.r},${x.rgba.g},${x.rgba.b},${x.rgba.a})`;
      const [em, bo] = await Promise.all([img(c.emblem.media.key.href), img(c.border.media.key.href)]);
      return { faction: g.faction?.type, bg: col(c.background.color), emblem: { url: em, color: col(c.emblem.color) }, border: { url: bo, color: col(c.border.color) } };
    }),
    bnetRoster: wrap(async (realmSlug, guildName) => {
      const slug = encodeURIComponent(String(guildName).trim().toLowerCase().replace(/\s+/g, '-'));
      const realm = encodeURIComponent(String(realmSlug).trim().toLowerCase().replace(/\s+/g, '-'));
      const j = await bnetApi(`/data/wow/guild/${realm}/${slug}/roster?namespace=profile-${bnetRegion()}&locale=en_US`);
      return {
        guild: j.guild?.name || guildName, realmSlug: j.guild?.realm?.slug || realmSlug, region: bnetRegion(),
        members: (j.members || []).map((x) => ({ name: x.character.name, realmSlug: x.character.realm.slug, level: x.character.level, classId: x.character.playable_class?.id, rank: x.rank })),
      };
    }),
    talentMap: async () => {
      if (talentMem) return talentMem;
      const saved = await kvGet('talents-map');
      if (saved && Date.now() - saved.at < 7 * 24 * 3600 * 1000) { talentMem = saved.map; return talentMem; }
      try {
        const j = await rioGet('https://www.raidbots.com/static/data/live/talents.json');
        const map = {};
        const walk = (o) => {
          if (!o || typeof o !== 'object') return;
          if (Array.isArray(o.entries)) for (const e of o.entries) if (e && e.id && e.name) map[e.id] = [e.name, e.icon || '', e.spellId || 0];
          for (const k in o) walk(o[k]);
        };
        walk(j);
        await kvSet('talents-map', { at: Date.now(), map });
        talentMem = map;
        return map;
      } catch { return saved ? saved.map : {}; }
    },
    spellTip: async (id, lang) => {
      id = Number(id);
      if (!Number.isInteger(id) || id < 1 || id > 99999999) return { error: 'BAD_ID' };
      const loc = WOWHEAD_LOCALE[lang] ?? 0;
      const key = `${loc}-${id}`;
      if (spellMem.has(key)) return spellMem.get(key);
      try {
        const j = await rioGet(`https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=${loc}`);
        const out = { name: j.name || '', icon: j.icon || '', tooltip: j.tooltip || '', buff: j.buff || '' };
        spellMem.set(key, out);
        return out;
      } catch (e) { return { error: String(e.message || e) }; }
    },
    clearSpells: async () => { const n = spellMem.size; spellMem.clear(); return n; },
    openDataFolder: async () => {},
    artGet: async (key) => {
      if (!artKeyOk(key)) return null;
      const dataUrl = await kvGet('art:' + key);
      return dataUrl ? { dataUrl } : null;
    },
    artSave: async (key, dataUrl) => {
      if (!artKeyOk(key)) return { error: 'BAD_KEY' };
      if (!dataUrlOk(dataUrl)) return { error: 'BAD_TYPE' };
      await kvSet('art:' + key, dataUrl);
      return { ok: true };
    },
  };

  // ---- Iconos: la app de escritorio los sirve con wcicon://; aquí un service worker (sw.js) redirige ic/<nombre> al CDN de Warcraft Logs.
  // Si el navegador no lo permite (o es la primera visita, antes de que el worker tome el control), se corrige el <img> que falle.
  const SPEC_KEYS = '__SPEC_KEYS__'.split(',');
  window.WT_iconCdn = function (name) {
    name = String(name).toLowerCase();
    if (name.startsWith('class-')) return `https://assets.rpglogs.com/img/warcraft/icons/${name.slice(6).replace(/[^a-z]/g, '')}.jpg`;
    if (name.startsWith('spec-')) return `https://assets.rpglogs.com/img/warcraft/icons/${SPEC_KEYS.find((k) => k.toLowerCase() === name.slice(5)) || name.slice(5)}.jpg`;
    return `https://assets.rpglogs.com/img/warcraft/abilities/${name}.jpg`;
  };
  document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!img || img.tagName !== 'IMG' || img.dataset.wtFix) return;
    const m = (img.getAttribute('src') || '').match(/(?:^|\/)ic\/([^?#]+)$/);
    if (!m) return;
    img.dataset.wtFix = '1';
    try { img.src = window.WT_iconCdn(decodeURIComponent(m[1]).replace(/\.(jpg|png|tga|blp)$/, '')); } catch { /* nombre no válido */ }
  }, true);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin service worker: vale el respaldo de arriba */ });
  }
}());
