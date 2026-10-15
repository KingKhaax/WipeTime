'use strict';

// ============================================================ state
const S = {
  specById: new Map(), // id de jugador -> «Clase-Spec», reunido de playerDetails y de las tablas
  lang: ['es', 'en'].includes(lsGet('lang')) ? lsGet('lang') : 'es',
  me: '',
  hasCreds: false,
  code: null,
  report: null,
  actors: new Map(),
  abilities: new Map(),
  fights: [],
  fight: null,
  tab: 'damage',
  player: null,      // id del jugador abierto en la vista de detalle
  ptab: 'abilities',
  enemySel: null,    // { fight, ids: [] }
  range: null,       // { fight, start, end, label, phaseIdx? | relFrom?, relTo? }
  phases: new Map(), // encounterID -> Map(phaseId -> {name, isIntermission})
  meDefault: '',
  expansion: null,
  home: true,
  cmpOpen: false,
  buffsPlayer: null,
  rotZoom: 8,        // píxeles por segundo
  rotMode: 'lanes',
  cache: new Map(),
  seq: 0,
  sortMode: lsGet('sortMode') || 'desc', // desc | asc | name
  takenAbility: '', // habilidad elegida en Daño recibido ('' = todas)
  shieldKind: 'all', // all | boss | allies | adds
  dmgMetric: 'dps',   // dps | boss | active
  parseMode: 'all',   // all | ilvl
  combineMode: false,
  combine: [],        // ids de pulls combinados
  viewCombined: false,
};


// El botón «Exportar» solo aparece con un reporte abierto: no en el inicio ni en comparar logs, guilds o personajes
(() => {
  const sync = () => { const b = document.getElementById('exportBtn'); if (b) b.hidden = !(S.report && !S.home); };
  for (const k of ['report', 'home']) {
    let v = S[k];
    Object.defineProperty(S, k, { get: () => v, set: (x) => { v = x; sync(); }, enumerable: true, configurable: true });
  }
  sync();
})();

const $ = (sel, el = document) => el.querySelector(sel);
const main = $('#main');
const sidebar = $('#sidebar');

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ============================================================ formato
const locale = () => langInfo().locale;
function num(n, digits = 1) {
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}
function bigParts(n) {
  n = n || 0;
  const a = Math.abs(n);
  if (a >= 1e9) return [num(n / 1e9), 'B'];
  if (a >= 1e6) return [num(n / 1e6), 'M'];
  if (a >= 1e3) return [num(n / 1e3), 'k'];
  return [num(n, 0), ''];
}
const big = (n) => { const [v, u] = bigParts(n); return `${v}${u ? `<small> ${u}</small>` : ''}`; };
const plain = (n) => { const [v, u] = bigParts(n); return v + (u ? ' ' + u : ''); };
function clock(ms) {
  const s = Math.max(0, ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s - m * 60)).padStart(2, '0')}`;
}
function clockPrecise(ms) {
  const s = Math.max(0, ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
const pctOf = (v) => (v == null ? null : v > 100 ? v / 100 : v);
const fightDur = (f) => f.dur ?? (f.endTime - f.startTime);

// ============================================================ actores y habilidades
function playerInfo(id, entry) {
  const a = S.actors.get(id) || {};
  const cands = [entry?.icon, S.specById.get(id), a.icon];
  const icon = cands.find((c) => typeof c === 'string' && c.includes('-')) || cands.find(Boolean) || '';
  let [cls, spec] = icon.includes('-') ? icon.split('-') : [a.subType || entry?.type || '', ''];
  if (!CLASSES[cls]) cls = a.subType || entry?.type || cls;
  return { id, name: entry?.name || a.name || '?', cls, spec, icon };
}
const classColor = (cls) => CLASSES[cls]?.color || '#9aa3b2';
const className = (cls) => CLASSES[cls]?.[S.lang] || CLASSES[cls]?.en || cls || '';
function specName(spec) {
  if (!spec) return '';
  const table = { es: SPECS_ES }[S.lang];
  return table ? table[spec] || spec : spec.replace(/([a-z])([A-Z])/g, '$1 $2');
}
function isPlayer(id, entry) {
  const a = S.actors.get(id);
  if (a) return a.type === 'Player';
  return !!CLASSES[entry?.type];
}
function actorName(id) {
  if (id == null || id === -1) return t('environment');
  return S.actors.get(id)?.name || t('unknown');
}
function ability(id) {
  const ab = S.abilities.get(id);
  // Warcraft Logs llama «Unknown Ability» a las habilidades sin nombre: se muestra en el idioma de la app
  if (ab && /^unknown ability$/i.test(ab.name || '')) return { ...ab, name: LL('Habilidad desconocida', 'Unknown ability') };
  return ab || { name: `#${id}`, icon: 'inv_misc_questionmark.jpg' };
}
function iconImg(icon, size = 20, title = '', spell = null) {
  const src = abilityIconUrl(icon);
  // con id de habilidad se muestra el tooltip propio (el texto extra, p. ej. el segundo exacto, va dentro de él)
  if (spell != null) {
    const mt = typeof MechGuide !== 'undefined' ? MechGuide.ringType(spell) : null;
    return `<img class="ai" width="${size}" height="${size}" src="${src}" loading="lazy" alt="" data-spell="${spell}"${mt ? ` data-mech="${mt}"` : ''}${title ? ` data-spell-extra="${esc(title)}"` : ''}>`;
  }
  return `<img class="ai" width="${size}" height="${size}" src="${src}" loading="lazy" alt=""${title ? ` title="${esc(title)}"` : ''}>`;
}
function isMe(name) {
  return S.me && name && name.toLocaleLowerCase() === S.me.toLocaleLowerCase();
}

// Iconos rotos -> interrogación (sin manejadores inline por la CSP)
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el.tagName !== 'IMG') return;
  // spec sin icono propio: se usa el de su clase
  const sp = el.src.match(/\/specs\/([a-z]+)-[a-z]+\.png$/);
  if (sp && !el.dataset.cls) { el.dataset.cls = '1'; el.src = classIconUrl(sp[1]); return; }
  // un icono que no llega (red lenta o cortada) se reintenta dos veces antes de rendirse
  if (/^wcicon:/.test(el.src)) {
    const n = Number(el.dataset.retry || 0);
    if (n < 2) {
      el.dataset.retry = String(n + 1);
      const base = el.src.replace(/\?r=\d+$/, '');
      setTimeout(() => { el.src = `${base}?r=${n + 1}`; }, 1500 * (n + 1));
      return;
    }
  }
  // sin respuesta del programa: se pide directamente al CDN de Warcraft Logs antes de rendirse
  if (/^wcicon:/.test(el.src) && !el.dataset.direct) {
    el.dataset.direct = '1';
    const raw = decodeURIComponent(el.src.replace(/^wcicon:\/\/i\//, '').replace(/\?r=\d+$/, ''));
    const m = raw.match(/^spec-([a-z]+)-([a-z]+)$/);
    const cap = (w) => ({ deathknight: 'DeathKnight', demonhunter: 'DemonHunter', beastmastery: 'BeastMastery' }[w] || w.charAt(0).toUpperCase() + w.slice(1));
    el.src = m ? SPEC_ICON_BASE + cap(m[1]) + '-' + cap(m[2]) + '.jpg' : ICON_BASE + raw + '.jpg';
    return;
  }
  if (!el.dataset.fb) { el.dataset.fb = '1'; el.src = FALLBACK_ICON; }
}, true);

// ============================================================ API
// fresh = true salta la caché en disco (rankings públicos, que cambian de un momento a otro)
async function gql(query, variables, fresh = false) {
  const res = await window.api.query(query, variables, S.lang, fresh || S.liveReport);
  if (res.error) throw new Error(res.error);
  if (!res.data && res.errors) throw new Error(res.errors.map((e) => e.message).join(' · '));
  if (res.errors) console.warn('GraphQL', res.errors);
  return res.data;
}

function cached(key, fn) {
  if (!S.cache.has(key)) {
    S.cache.set(key, fn().catch((e) => { S.cache.delete(key); throw e; }));
  }
  return S.cache.get(key);
}

const entriesOf = (tbl) => {
  const list = tbl?.data?.entries || [];
  for (const e of list) if (e && e.id != null && typeof e.icon === 'string' && e.icon.includes('-') && CLASSES[e.icon.split('-')[0]]) S.specById.set(e.id, e.icon);
  return list;
};

// Divide un rango de tiempo en trozos para pedirlos en paralelo (la API pagina cada trozo por separado)
function timeChunks(start, end, maxChunks = 4, minMs = 60000) {
  const n = Math.max(1, Math.min(maxChunks, Math.floor((end - start) / minMs)));
  const step = (end - start) / n;
  return Array.from({ length: n }, (_, i) => ({ s: Math.floor(start + step * i), e: i === n - 1 ? end : Math.floor(start + step * (i + 1)), last: i === n - 1 }));
}

async function allEvents(f, dataType, extra = '') {
  const run = async ({ s: s0, e: e0, last }) => {
    const out = [];
    let start = s0;
    for (let page = 0; page < 40; page++) {
      const d = await gql(`query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){
        events(fightIDs:$f,startTime:$s,endTime:$e,dataType:${dataType},limit:10000${extra}){data nextPageTimestamp}}}}`,
      { code: S.code, f: [f.id], s: start, e: e0 });
      const ev = d.reportData.report.events;
      for (const x of ev?.data || []) if (last || x.timestamp < e0) out.push(x);
      if (!ev?.nextPageTimestamp || ev.nextPageTimestamp <= start) break;
      start = ev.nextPageTimestamp;
    }
    return out;
  };
  return (await Promise.all(timeChunks(f.startTime, f.endTime).map(run))).flat();
}

// ---- Ventana de tiempo: pelea completa, una fase o un rango elegido (p. ej. 1:00–1:10).
// Las vistas reciben la pelea "recortada": startTime/endTime son los de la ventana y
// fightStart/fightEnd los de la pelea real (para mostrar tiempos relativos al pull).
function phaseSegments(f) {
  if (f.dungeonPulls?.length) {
    return f.dungeonPulls.map((p, i) => ({ idx: i, id: p.id, name: `Pull ${p.id}`, intermission: false, start: Math.max(f.startTime, p.startTime), end: p.endTime }))
      .filter((s) => s.end > s.start);
  }
  const names = S.phases.get(f.encounterID);
  const tr = [...(f.phaseTransitions || [])].sort((a, b) => a.startTime - b.startTime);
  if (!tr.length) return [];
  const seen = {};
  return tr.map((p, i) => {
    seen[p.id] = (seen[p.id] || 0) + 1;
    const info = names?.get(p.id);
    let name = info?.name || `${t('phase')} ${p.id}`;
    if (seen[p.id] > 1) name += ` (${seen[p.id]})`;
    return { idx: i, id: p.id, name, intermission: !!info?.isIntermission, start: Math.max(f.startTime, p.startTime), end: tr[i + 1]?.startTime ?? f.endTime };
  }).filter((s) => s.end > s.start);
}

function windowed(f) {
  const r = S.range && S.range.fight === f.id ? S.range : null;
  const s = r ? Math.max(f.startTime, r.start) : f.startTime;
  const e = r ? Math.min(f.endTime, r.end) : f.endTime;
  return { ...f, startTime: s, endTime: e, fightStart: f.startTime, fightEnd: f.endTime, full: !r, key: `${f.id}:${s}-${e}`, rangeLabel: r?.label || '' };
}

// Al cambiar de pull se mantiene la misma fase o el mismo tramo relativo.
function carryRange(f) {
  const r = S.range;
  if (!r) return;
  if (r.phaseIdx != null) {
    const seg = phaseSegments(f).find((s) => s.idx === r.phaseIdx);
    S.range = seg ? { fight: f.id, start: seg.start, end: seg.end, label: seg.name, phaseIdx: seg.idx } : null;
  } else if (r.relFrom != null) {
    S.range = r.relFrom < fightDur(f) ? { ...r, fight: f.id, start: f.startTime + r.relFrom, end: f.startTime + r.relTo } : null;
  }
}

// Varios pulls del mismo jefe como uno solo (suma de duraciones; las pestañas de cifras lo admiten)
const COMBINABLE = new Set(['damage', 'healing', 'taken', 'enemies', 'detail', 'mechanics']);
function combinedFight() {
  const fs = S.combine.map((id) => S.fights.find((x) => x.id === id)).filter(Boolean).sort((x, y) => x.startTime - y.startTime);
  const ids = fs.map((x) => x.id);
  const start = Math.min(...fs.map((x) => x.startTime));
  const end = Math.max(...fs.map((x) => x.endTime));
  return {
    ...fs[0], name: new Set(fs.map((x) => x.encounterID)).size > 1 ? LL('Todos los jefes', 'All bosses') : fs[0].name, id: 'c', ids, startTime: start, endTime: end, dur: fs.reduce((s, x) => s + (x.endTime - x.startTime), 0),
    fightStart: start, fightEnd: end, kill: false, full: true, combined: true, key: `c:${ids.join(',')}`, rangeLabel: '',
    phaseTransitions: [], fightPercentage: null, bossPercentage: null, tryNo: null,
  };
}
const fightIds = (f) => f.ids || [f.id];

function fightData(f) {
  return cached(`fight:${f.key}`, async () => {
    const d = await gql(`query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){
      dmg:table(fightIDs:$f,dataType:DamageDone,startTime:$s,endTime:$e)
      heal:table(fightIDs:$f,dataType:Healing,startTime:$s,endTime:$e)
      taken:table(fightIDs:$f,dataType:DamageTaken,startTime:$s,endTime:$e)
      tgt:table(fightIDs:$f,dataType:DamageDone,viewBy:Target,startTime:$s,endTime:$e)}}}`, { code: S.code, f: fightIds(f), s: f.startTime, e: f.endTime });
    const r = d.reportData.report;
    return { dmg: entriesOf(r.dmg), heal: entriesOf(r.heal), taken: entriesOf(r.taken), tgt: entriesOf(r.tgt) };
  });
}

function rankMap(json, field = 'rankPercent') {
  const m = new Map();
  for (const fd of json?.data || []) {
    for (const role of Object.values(fd.roles || {})) {
      for (const c of role?.characters || []) {
        if (c[field] != null) m.set(c.name, Math.floor(c[field]));
      }
    }
  }
  return m;
}

// Warcraft Logs: en el modo por defecto («Rankings») da rankPercent 0 a los jugadores cuya posición es aproximada («~»,
// fuera de la lista de ranking), mientras que en el modo «Parses» sí calcula su porcentaje, igual que la web. Se piden los
// dos y, donde el primero da 0 con posición aproximada, se usa el valor del segundo.
function mergeRankings(a, b) {
  const fa = a?.data?.[0];
  if (!fa) return a;
  const byName = new Map();
  for (const ro of Object.values(b?.data?.[0]?.roles || {})) for (const c of ro?.characters || []) byName.set(c.name, c);
  const roles = {};
  for (const [k, ro] of Object.entries(fa.roles || {})) {
    roles[k] = { ...ro, characters: (ro.characters || []).map((c) => {
      const p = byName.get(c.name);
      const approx = typeof c.rank === 'string' && c.rank.startsWith('~');
      if (p && (c.rankPercent == null || c.rankPercent === 0) && (approx || c.rank >= c.totalParses) && p.rankPercent > 0) {
        return { ...c, rank: p.rank, best: p.best, totalParses: p.totalParses, rankPercent: p.rankPercent, bracketPercent: p.bracketPercent || c.bracketPercent, fromParses: true };
      }
      return c;
    }) };
  }
  return { ...a, data: [{ ...fa, roles }, ...a.data.slice(1)] };
}

function rankings(f) {
  return cached(`rank:${f.id}`, async () => {
    if (!f.kill || !f.encounterID || !f.full || f.combined) return { dps: new Map(), hps: new Map(), dpsB: new Map(), hpsB: new Map() };
    try {
      // sin caché en disco: Warcraft Logs recalcula los parses de un log (al subirlo da valores provisionales y luego
      // los ajusta al entrar más logs), y guardarlos horas hacía que WipeTime enseñara un número y la web otro
      const d = await gql(`query($code:String!,$f:[Int]){reportData{report(code:$code){
        dps:rankings(fightIDs:$f,playerMetric:dps) hps:rankings(fightIDs:$f,playerMetric:hps)
        dpsP:rankings(fightIDs:$f,playerMetric:dps,compare:Parses) hpsP:rankings(fightIDs:$f,playerMetric:hps,compare:Parses)}}}`, { code: S.code, f: [f.id] }, true);
      const raw = d.reportData.report;
      const r = { dps: mergeRankings(raw.dps, raw.dpsP), hps: mergeRankings(raw.hps, raw.hpsP) };
      const chars = [r.dps, r.hps].flatMap((x) => (x?.data || []).flatMap((fd) => Object.values(fd.roles || {}).flatMap((ro) => ro?.characters || [])));
      // provisional = sin ranking calculado todavía (sin total de parses): no se da por bueno, la próxima vez se vuelve a pedir
      if (!chars.length || chars.some((x) => !x.totalParses)) setTimeout(() => S.cache.delete(`rank:${f.id}`), 0);
      else if (S.liveReport) setTimeout(() => S.cache.delete(`rank:${f.id}`), 60000); // log reciente: Warcraft Logs ajusta los parses
      return { dps: rankMap(r.dps), hps: rankMap(r.hps), dpsB: rankMap(r.dps, 'bracketPercent'), hpsB: rankMap(r.hps, 'bracketPercent') };
    } catch (e) {
      console.warn('rankings', e);
      setTimeout(() => S.cache.delete(`rank:${f.id}`), 0);
      return { dps: new Map(), hps: new Map(), dpsB: new Map(), hpsB: new Map() };
    }
  });
}

// ---- Parses estimados (wipes): la API no da rankings de wipes, así que se compara
// el DPS/HPS del jugador con el ranking de su especialización en ese boss, como hace la web.
const HEALER_SPECS = new Set(['Restoration', 'Holy', 'Discipline', 'Mistweaver', 'Preservation']);
const DIST_TTL = 12 * 3600 * 1000;
const RANK_PAGES_MAX = 20; // límite de la API
const RANK_PAGES_PER_QUERY = 5;

// Tramos de nivel de objeto de la zona: índice = floor((ilvl - min) / bucket) + 1 (como el campo "bracket" de la API)
function zoneBrackets(encounterID) {
  return cached(`brackets:${encounterID}`, async () => {
    try {
      const d = await gql(`{worldData{encounter(id:${encounterID}){zone{brackets{min max bucket type}}}}}`);
      const b = d.worldData?.encounter?.zone?.brackets;
      return b && b.type === 'Item Level' ? b : null;
    } catch { return null; }
  });
}
const bracketIndex = (b, ilvl) => (b && ilvl ? Math.max(1, Math.floor((Math.min(ilvl, b.max) - b.min) / b.bucket) + 1) : 0);

// Partición (parche dentro de la zona) a la que pertenece el log: la da Warcraft Logs en el ranking de cualquier kill del mismo informe.
// Los parses de un log se calculan contra su propia partición; sin esto se compararía con la partición actual (casi vacía tras un parche).
function reportPartition() {
  return cached(`partition:${S.code}`, async () => {
    const kills = (S.fights || []).filter((x) => x.kill && x.encounterID && !x.keystoneLevel).slice(0, 3);
    for (const k of kills) {
      try {
        const d = await gql(`query($code:String!,$f:[Int]){reportData{report(code:$code){r:rankings(fightIDs:$f,playerMetric:dps)}}}`, { code: S.code, f: [k.id] });
        const p = d.reportData.report.r?.data?.[0]?.partition;
        if (p != null) return p;
      } catch { /* siguiente kill */ }
    }
    return null;
  });
}

// Descarga una lista de characterRankings (hasta 20 páginas de 100). Devuelve { amounts, capped }.
async function rankingPages(encounterID, difficulty, metric, cls, spec, extra) {
  const amounts = [];
  let more = true;
  for (let start = 1; more && start <= RANK_PAGES_MAX; start += RANK_PAGES_PER_QUERY) {
    const pages = [];
    for (let p = start; p < start + RANK_PAGES_PER_QUERY && p <= RANK_PAGES_MAX; p++) pages.push(p);
    const aliases = pages.map((p) =>
      `p${p}:characterRankings(className:"${cls}",specName:"${spec}",difficulty:${difficulty},metric:${metric}${extra},page:${p})`).join(' ');
    const d = await gql(`{worldData{encounter(id:${encounterID}){${aliases}}}}`);
    const enc = d.worldData?.encounter;
    more = false;
    if (!enc) break;
    for (const p of pages) {
      const pg = enc[`p${p}`];
      if (!pg || pg.error) { more = false; break; }
      for (const r of pg.rankings || []) amounts.push(r.amount);
      more = !!pg.hasMorePages;
      if (!more) break;
    }
  }
  return { amounts, capped: more };
}

function specDistribution(encounterID, difficulty, metric, cls, spec, bracket = 0) {
  return cached(`distp:${encounterID}:${difficulty}:${metric}:${cls}:${spec}:${bracket}`, async () => {
    const partition = await reportPartition();
    const part = partition != null ? `,partition:${partition}` : '';
    const key = `dist:v2:${encounterID}:${difficulty}:${metric}:${cls}:${spec}${bracket ? ':b' + bracket : ''}:p${partition ?? 'x'}`;
    try {
      const saved = JSON.parse(lsGet(key) || 'null');
      if (saved && Date.now() - saved.at < DIST_TTL) return saved;
    } catch { /* caché corrupta: se vuelve a descargar */ }
    const base = await rankingPages(encounterID, difficulty, metric, cls, spec, `${bracket ? `,bracket:${bracket}` : ''}${part}`);
    const amounts = base.amounts;
    const capped = base.capped; // más de 2000 entradas: la API no deja pedir más, así que el percentil no se puede calcular con exactitud
    const dist = { at: Date.now(), amounts: amounts.map(Math.round).sort((x, y) => y - x), capped };
    lsSet(key, JSON.stringify(dist));
    return dist;
  });
}

function percentileOf(dist, amount) {
  const a = dist.amounts;
  if (!a.length) return null;
  let lo = 0;
  let hi = a.length;
  while (lo < hi) { // primer índice con un valor menor que amount (lista descendente)
    const mid = (lo + hi) >> 1;
    if (a[mid] >= amount) lo = mid + 1; else hi = mid;
  }
  return Math.max(0, Math.min(100, Math.floor((100 * (a.length - lo)) / a.length)));
}

/** rows: {name, cls, spec, total}. Devuelve Map nombre -> percentil estimado. */
async function estimateParses(f, rows, metric, mode = S.parseMode) {
  const out = new Map();
  if (!f.encounterID || !f.difficulty) return out;
  const dur = fightDur(f) / 1000;
  const bySpec = new Map();
  const brackets = mode === 'ilvl' ? await zoneBrackets(f.encounterID) : null;
  if (mode === 'ilvl' && !brackets) return out; // sin tramos de nivel de objeto para este jefe: no se inventa un «Ilvl %»
  for (const r of rows) {
    if (!/^[A-Za-z]+$/.test(r.cls || '') || !/^[A-Za-z]+$/.test(r.spec || '')) continue;
    r.bracket = bracketIndex(brackets, r.ilvl);
    const k = `${r.cls}:${r.spec}:${r.bracket}`;
    if (!bySpec.has(k)) bySpec.set(k, []);
    bySpec.get(k).push(r);
  }
  await Promise.all([...bySpec.values()].map(async (list) => {
    try {
      const dist = await specDistribution(f.encounterID, f.difficulty, metric, list[0].cls, list[0].spec, list[0].bracket);
      if (dist.capped) return; // lista truncada por la API (más de 2000): un porcentaje sería falso, no se muestra
      for (const r of list) {
        const p = percentileOf(dist, r.total / dur);
        if (p != null) out.set(r.name, p);
      }
    } catch (e) {
      console.warn('estimateParses', list[0].cls, list[0].spec, e);
    }
  }));
  return out;
}

// Rellena los huecos de parse después de pintar la lista, para no bloquear la vista.
function fillEstimatedPills(f, rows, metric) {
  S.post = async (seq) => {
    const copy = () => rows.map((r) => ({ ...r }));
    const [est, estI] = await Promise.all([estimateParses(f, copy(), metric, 'all'), estimateParses(f, copy(), metric, 'ilvl')]);
    if (seq !== S.seq) return;
    const lowConf = fightDur(f) < 60000;
    document.querySelectorAll('.pill-slot').forEach((el) => {
      const p = est.get(el.dataset.name);
      el.outerHTML = p != null ? parsePill(p, true, lowConf) : '<span class="muted">–</span>';
    });
    document.querySelectorAll('.pill-slot-i').forEach((el) => {
      const p = estI.get(el.dataset.name);
      el.outerHTML = p != null ? parsePill(p, true, lowConf) : '<span class="muted">–</span>';
    });
    for (const r of S.lastRanked || []) {
      if (est.has(r.name)) r.parse = est.get(r.name);
      if (estI.has(r.name)) r.parseI = estI.get(r.name);
    }
  };
}

function enemyTable(f, id) {
  return cached(`enemy:${f.key}:${id}`, async () => {
    const d = await gql(`query($code:String!,$f:[Int],$t:Int,$s:Float,$e:Float){reportData{report(code:$code){
      t:table(fightIDs:$f,dataType:DamageDone,targetID:$t,startTime:$s,endTime:$e)}}}`, { code: S.code, f: fightIds(f), t: id, s: f.startTime, e: f.endTime });
    return entriesOf(d.reportData.report.t);
  });
}

function playerData(f, id) {
  return cached(`player:${f.key}:${id}`, async () => {
    const [d, casts] = await Promise.all([
      gql(`query($code:String!,$f:[Int],$p:Int,$s:Float,$e:Float){reportData{report(code:$code){
        pd:table(fightIDs:$f,dataType:DamageDone,sourceID:$p,viewBy:Ability,startTime:$s,endTime:$e)
        ph:table(fightIDs:$f,dataType:Healing,sourceID:$p,viewBy:Ability,startTime:$s,endTime:$e)
        pb:table(fightIDs:$f,dataType:Buffs,sourceID:$p,startTime:$s,endTime:$e)}}}`, { code: S.code, f: [f.id], p: id, s: f.startTime, e: f.endTime }),
      allEvents(f, 'Casts', `,sourceID:${id}`),
    ]);
    const r = d.reportData.report;
    return {
      abil: entriesOf(r.pd),
      heal: entriesOf(r.ph),
      auras: r.pb?.data?.auras || [],
      totalTime: r.pb?.data?.totalTime || fightDur(f),
      casts: casts.filter((e) => e.type === 'cast' && !e.fake),
    };
  });
}

function deathsData(f) {
  return cached(`deaths:${f.key}`, async () => {
    const deaths = (await allEvents(f, 'Deaths'))
      .filter((e) => e.type === 'death' && isPlayer(e.targetID))
      .sort((a, b) => a.timestamp - b.timestamp);
    const WINDOW = 10000;
    const details = [];
    for (let i = 0; i < deaths.length; i += 8) {
      const chunk = deaths.slice(i, i + 8);
      const parts = chunk.map((e, j) => {
        const s = Math.max(f.fightStart, e.timestamp - WINDOW);
        const en = e.timestamp + 1;
        return `d${j}:events(fightIDs:$f,dataType:DamageTaken,targetID:${e.targetID},startTime:${s},endTime:${en},limit:500,includeResources:true){data}
                h${j}:events(fightIDs:$f,dataType:Healing,targetID:${e.targetID},startTime:${s},endTime:${en},limit:500,includeResources:true){data}`;
      }).join('\n');
      const d = await gql(`query($code:String!,$f:[Int]){reportData{report(code:$code){${parts}}}}`, { code: S.code, f: [f.id] });
      const r = d.reportData.report;
      chunk.forEach((e, j) => details.push(buildDeath(f, e, r[`d${j}`]?.data || [], r[`h${j}`]?.data || [], WINDOW)));
    }
    return details;
  });
}

function buildDeath(f, death, dmgEvents, healEvents, windowMs) {
  const dmg = dmgEvents.filter((e) => e.type === 'damage' && e.targetID === death.targetID);
  const heals = healEvents.filter((e) => (e.type === 'heal' || e.type === 'absorbed') && e.targetID === death.targetID);
  const timeline = [...dmg.map((e) => ({ ...e, kind: 'dmg' })), ...heals.map((e) => ({ ...e, kind: e.type === 'absorbed' ? 'shield' : 'heal' }))]
    .sort((a, b) => a.timestamp - b.timestamp);
  const lastDmg = dmg[dmg.length - 1];
  const blow = [...dmg].reverse().find((e) => e.overkill > 0) || lastDmg;
  const abilityId = blow?.abilityGameID ?? death.killingAbilityGameID;
  const killerId = blow?.sourceID ?? death.killerID;
  const bySource = new Map();
  for (const e of dmg) {
    const k = e.abilityGameID;
    const cur = bySource.get(k) || { abilityId: k, sourceID: e.sourceID, total: 0, hits: 0 };
    cur.total += (e.amount || 0) + (e.absorbed || 0);
    cur.hits++;
    bySource.set(k, cur);
  }
  return {
    ...death,
    rel: death.timestamp - f.fightStart,
    abilityId,
    killerId,
    blowAmount: blow ? (blow.amount || 0) + (blow.absorbed || 0) : 0,
    overkill: blow?.overkill || 0,
    totalDmg: dmg.reduce((s, e) => s + (e.amount || 0) + (e.absorbed || 0), 0),
    totalHeal: heals.reduce((s, e) => s + (e.amount || 0), 0),
    top: [...bySource.values()].sort((a, b) => b.total - a.total).slice(0, 3),
    timeline,
    windowMs,
  };
}

function utilityData(f) {
  return cached(`util:${f.key}`, async () => {
    const [disp, ints] = await Promise.all([allEvents(f, 'Dispels'), allEvents(f, 'Interrupts')]);
    return {
      dispels: disp.filter((e) => e.type === 'dispel'),
      interrupts: ints.filter((e) => e.type === 'interrupt'),
    };
  });
}

// ---- Detector de PI (Infusión de poder, 10060)
const POWER_INFUSION = 10060;

function piData(f) {
  return cached(`pi:${f.key}`, async () => {
    const evs = (await allEvents(f, 'Buffs', `,abilityID:${POWER_INFUSION}`)).sort((a, b) => a.timestamp - b.timestamp);
    const open = new Map();
    const list = [];
    for (const e of evs) {
      const k = `${e.sourceID}>${e.targetID}`;
      if (e.type === 'applybuff') {
        open.set(k, { source: e.sourceID, target: e.targetID, start: e.timestamp });
      } else if (e.type === 'removebuff') {
        const o = open.get(k) || { source: e.sourceID, target: e.targetID, start: f.startTime, cut: true };
        open.delete(k);
        list.push({ ...o, end: e.timestamp });
      }
    }
    for (const o of open.values()) list.push({ ...o, end: f.endTime, cut: true });
    list.sort((a, b) => a.start - b.start);
    // El talento de Disciplina copia el PI al propio sacerdote: se muestra en la misma fila
    for (const self of list.filter((p) => p.source === p.target)) {
      const given = list.find((p) => p.source === self.source && p.target !== p.source && Math.abs(p.start - self.start) < 500);
      if (given) { given.selfAlso = true; self.merged = true; }
    }
    list.splice(0, list.length, ...list.filter((p) => !p.merged));
    // Daño del receptor mientras tenía el PI
    for (let i = 0; i < list.length; i += 10) {
      const chunk = list.slice(i, i + 10);
      const parts = chunk.map((p, j) =>
        `p${j}:table(fightIDs:$f,dataType:DamageDone,sourceID:${p.target},startTime:${p.start},endTime:${Math.max(p.end, p.start + 1)})`).join('\n');
      const d = await gql(`query($code:String!,$f:[Int]){reportData{report(code:$code){${parts}}}}`, { code: S.code, f: [f.id] });
      chunk.forEach((p, j) => {
        p.damage = entriesOf(d.reportData.report[`p${j}`]).reduce((s, e) => s + (e.total || 0), 0);
      });
    }
    return list;
  });
}

// ---- Daño a escudos: absorciones sobre enemigos, agrupadas en escudos por huecos de tiempo
const SHIELD_GAP = 4000;

function ownerOf(id) {
  return S.actors.get(id)?.petOwner || id;
}

function shieldData(f) {
  return cached(`shield:${f.key}`, async () => {
    const evs = await allEvents(f, 'DamageDone');
    const isMc = (e) => S.actors.get(e.targetID)?.type === 'Player' && isPlayer(ownerOf(e.sourceID)) && ownerOf(e.sourceID) !== e.targetID;
    const abs = evs.filter((e) => e.absorbed > 0 && (['NPC', 'Boss'].includes(S.actors.get(e.targetID)?.type) || isMc(e)))
      .sort((a, b) => a.timestamp - b.timestamp);
    const shields = [];
    const lastByTarget = new Map();
    for (const e of abs) {
      let sh = lastByTarget.get(e.targetID);
      if (!sh || e.timestamp - sh.end > SHIELD_GAP) {
        sh = { target: e.targetID, mc: S.actors.get(e.targetID)?.type === 'Player', start: e.timestamp, end: e.timestamp, total: 0, byPlayer: new Map(), byAbil: new Map() };
        shields.push(sh);
        lastByTarget.set(e.targetID, sh);
      }
      sh.end = e.timestamp;
      sh.total += e.absorbed;
      const p = ownerOf(e.sourceID);
      sh.byPlayer.set(p, (sh.byPlayer.get(p) || 0) + e.absorbed);
      if (!sh.byAbil.has(p)) sh.byAbil.set(p, new Map());
      const ba = sh.byAbil.get(p);
      ba.set(e.abilityGameID, (ba.get(e.abilityGameID) || 0) + e.absorbed);
    }
    const grand = shields.reduce((s, x) => s + x.total, 0);
    return shields.filter((s) => s.total >= grand * 0.002).sort((a, b) => a.start - b.start);
  });
}

// ============================================================ carga del reporte
function parseInput(input) {
  const s = (input || '').trim();
  const m = s.match(/reports\/([A-Za-z0-9:]+)/);
  const code = m ? m[1] : /^[A-Za-z0-9:]{10,}$/.test(s) ? s : null;
  const fm = s.match(/[#?&]fight=(\d+|last)/);
  return { code, fight: fm ? fm[1] : null };
}

function friendlyError(e) {
  const msg = e?.message || String(e);
  if (msg === 'NO_CREDENTIALS') return t('noCreds');
  if (msg.startsWith('AUTH_FAILED')) return t('authFailed');
  if (msg === 'RATE_LIMIT') return t('rateLimit');
  if (/does not exist|permission|private/i.test(msg)) return t('notFound');
  return msg;
}

async function loadReport(input, opts = {}) {
  const { code, fight } = parseInput(input);
  if (!code) return toast(t('badUrl'));
  if (!S.hasCreds) return toast(t('noCreds'));
  if (typeof Replay !== 'undefined') Replay.stop();
  const seq = ++S.seq;
  S.home = false;
  S.cmpOpen = false;
  S.guildOpen = false;
  S.profileOpen = false;
  S.cache.clear();
  if (!opts.keepView) { S.player = null; S.tab = 'damage'; S.enemySel = null; S.buffsPlayer = null; S.range = null; S.combine = []; S.combineMode = false; }
  main.innerHTML = loadingHTML();
  try {
    const d = await gql(`query($code:String!){reportData{report(code:$code){
      code title startTime endTime zone{name} owner{name}
      phases{encounterID phases{id name isIntermission}}
      fights{id name encounterID kill fightPercentage bossPercentage difficulty startTime endTime size friendlyPlayers boundingBox{minX maxX minY maxY} phaseTransitions{id startTime} keystoneLevel keystoneAffixes keystoneBonus keystoneTime dungeonPulls{id startTime endTime boundingBox{minX maxX minY maxY} enemyNPCs{id gameID minimumInstanceID maximumInstanceID}}}
      masterData{actors{id name type subType server petOwner icon gameID} abilities{gameID name icon type}}}}}`, { code });
    if (seq !== S.seq) return;
    const r = d.reportData?.report;
    if (!r) throw new Error(t('notFound'));
    S.code = code;
    S.report = r;
    S.liveReport = Date.now() - (r.endTime || 0) < 3 * 3600 * 1000; // log reciente: puede seguir creciendo, no se cachea
    S.actors = new Map((r.masterData?.actors || []).map((a) => [a.id, a]));
    S.abilities = new Map((r.masterData?.abilities || []).map((a) => [a.gameID, a]));
    S.phases = new Map((r.phases || []).map((p) => [p.encounterID, new Map((p.phases || []).map((x) => [x.id, x]))]));
    S.fights = numberTries(r.fights || []);
    rememberReport(r);
    $('#urlInput').value = `https://www.warcraftlogs.com/reports/${code}`;

    S.specById = new Map();
    try {
      const ids = (r.fights || []).filter((x) => x.encounterID > 0).map((x) => x.id);
      const pdIds = (ids.length ? ids : (r.fights || []).map((x) => x.id)).slice(0, 80);
      if (pdIds.length) {
        const pdr = await gql(`query($code:String!,$f:[Int]){reportData{report(code:$code){pd:playerDetails(fightIDs:$f)}}}`, { code, f: pdIds });
        const det = pdr.reportData?.report?.pd?.data?.playerDetails || {};
        for (const p of Object.values(det).flat()) {
          if (!p || p.id == null) continue;
          const icon = typeof p.icon === 'string' && p.icon.includes('-') ? p.icon
            : p.specs?.length ? `${p.type}-${[...p.specs].sort((a, b) => b.count - a.count)[0].spec}` : null;
          if (icon) S.specById.set(p.id, icon);
        }
      }
    } catch (e) { console.warn('playerDetails', e); }
    const chosen = await window.api.getMe(code);
    S.me = chosen ?? S.meDefault;
    if (chosen === null) askWhoAmI();

    const bosses = S.fights.filter((f) => f.encounterID);
    let target = opts.fightId != null ? S.fights.find((f) => f.id === opts.fightId) : null;
    if (!target && fight && fight !== 'last') target = S.fights.find((f) => f.id === Number(fight));
    if (!target) target = bosses[bosses.length - 1] || S.fights[S.fights.length - 1];
    S.fight = target;
    renderSidebar();
    render();
  } catch (e) {
    if (seq !== S.seq) return;
    main.innerHTML = errorHTML(friendlyError(e));
  }
}

function numberTries(fights) {
  const counters = {};
  const totals = {};
  const sorted = [...fights].sort((a, b) => a.startTime - b.startTime);
  for (const f of sorted) {
    if (!f.encounterID) continue;
    const k = `${f.encounterID}-${f.difficulty}`;
    totals[k] = (totals[k] || 0) + 1;
  }
  for (const f of sorted) {
    if (!f.encounterID) continue;
    const k = `${f.encounterID}-${f.difficulty}`;
    counters[k] = (counters[k] || 0) + 1;
    f.tryNo = counters[k];
    f.groupKey = k;
  }
  return sorted;
}

function rememberReport(r) {
  let list = [];
  try { list = JSON.parse(lsGet('recent') || '[]'); } catch { /* vacío */ }
  list = list.filter((x) => x.code !== r.code);
  list.unshift({ code: r.code, title: r.title, zone: r.zone?.name || '', date: r.startTime });
  lsSet('recent', JSON.stringify(list.slice(0, 8)));
}

// ============================================================ sidebar
function fightLabel(f) {
  if (f.keystoneLevel) return `+${f.keystoneLevel} ${f.keystoneBonus ? '★'.repeat(f.keystoneBonus) : '✗'} · ${clock(fightDur(f))}`;
  if (!f.encounterID) return f.name;
  if (f.kill) return `${t('kill')} · ${clock(fightDur(f))}`;
  const p = pctOf(f.fightPercentage ?? f.bossPercentage);
  return p != null ? t('tryOfPct', { n: f.tryNo, p: num(p, 1) }) : t('tryN', { n: f.tryNo });
}
const diffName = (d) => DIFFICULTY[d]?.[S.lang] || DIFFICULTY[d]?.en || '';
// Nombre de la zona en el idioma de la app (Warcraft Logs la devuelve en inglés)
function zoneName(n) {
  if (!n || S.lang !== 'es') return n || '';
  if (/^the venomous abyss$/i.test(n)) return 'Abismo Venenoso';
  const m = n.match(/^Mythic\+ Season (\d+)/i);
  return m ? `Mítica+ Temporada ${m[1]}` : n;
}

function renderSidebar() {
  const r = S.report;
  const groups = new Map();
  const trash = [];
  for (const f of S.fights) {
    if (!f.encounterID) { trash.push(f); continue; }
    if (!groups.has(f.groupKey)) groups.set(f.groupKey, []);
    groups.get(f.groupKey).push(f);
  }
  const fightBtn = (f) => {
    const p = pctOf(f.fightPercentage ?? f.bossPercentage);
    // Color estilo parse pero invertido: cuanto menos vida le queda al jefe, mejor «parse»
    const pcol = p != null ? parseColor(100 - Math.min(100, p)) : '';
    let label = esc(fightLabel(f));
    // Hora (24 h, sin segundos) a la que acabó el try, entre «Try N» y el porcentaje
    if (f.encounterID && r.startTime != null) {
      const hm = new Date(r.startTime + f.endTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      label = label.replace(' · ', ` · <span class="fl-clock">${hm}</span> · `);
    }
    if (!f.kill && p != null) label = label.replace(`${num(p, 1)} %`, (m) => `<b class="fl-pct" style="color:${pcol}">${m}</b>`);
    const bar = f.encounterID && f.kill ? '<span class="hpbar kill"><span style="width:100%;--c:${parseColor(100)}"></span></span>'
      : f.encounterID && p != null
        ? `<span class="hpbar" title="${esc(LL('Vida restante del jefe', 'Boss health remaining'))}"><span style="width:${Math.max(3, Math.min(100, p))}%;--c:${pcol}"></span></span>` : '';
    return `<button class="fight ${f.kill ? 'kill' : ''} ${S.fight?.id === f.id && !S.combineMode ? 'active' : ''} ${S.combine.includes(f.id) ? 'combined' : ''}" data-action="fight" data-id="${f.id}">${S.combineMode ? `<span class="cbox">${S.combine.includes(f.id) ? '✓' : ''}</span>` : ''}
      <span class="fl">${label}</span><span class="ft">${clock(fightDur(f))}</span>${bar}</button>${typeof Extras2 !== 'undefined' && S.fight?.id === f.id && f.dungeonPulls?.length ? Extras2.sidePulls(f) : ''}`;
  };
  let html = `<button class="whoami-line" data-action="whoami"><span class="me-av" id="meAv"></span>${S.me ? `${t('you')}: <b>${esc(S.me)}</b>` : t('notInLog')} · <span class="link">${t('change')}</span></button>
    <div class="rep-title">${esc(r.title)}</div>
    <div class="rep-sub">${esc(zoneName(r.zone?.name))}${r.owner?.name ? ' · ' + esc(r.owner.name) : ''}<br>${new Date(r.startTime).toLocaleString(locale())}</div>
    <div class="combine-bar"><button class="chip refresh-btn ${S.refreshing ? 'busy' : ''}" data-action="refresh-report" title="${esc(LL('Vuelve a cargar el log para ver nuevos pulls y kills', 'Reload the log to see new pulls and kills'))}">${S.refreshing ? '<span class="spinner sm"></span> ' : ''}${LL('Actualizar', 'Refresh')}</button><button class="chip" data-action="combine-all" title="${esc(LL('Combinar todos los trys de todos los jefes del log', 'Combine every try of every boss in the log'))}">${LL('Todo el log', 'Whole log')}</button><button class="chip ${S.combineMode ? 'on' : ''}" data-action="combine-toggle" title="${esc(LL('Marca varios pulls y mira sus cifras sumadas', 'Tick several pulls and see their combined numbers'))}">${LL('Combinar pulls', 'Combine pulls')}</button>${S.combineMode ? `<small class="muted">${S.combine.length < 2 ? LL('Marca al menos 2 pulls', 'Tick at least 2 pulls') : LL(`${S.combine.length} pulls`, `${S.combine.length} pulls`)}</small>` : ''}</div>`;
  for (const fights of groups.values()) {
    const f0 = fights[0];
    const kills = fights.filter((f) => f.kill).length;
    html += `<div class="enc"><div class="enc-h"><span>${esc(f0.name)}</span><span class="enc-d">${esc(diffName(f0.difficulty))} · ${fights.length}${kills ? ' · ✓' : ''} <button class="mini-btn" data-action="combine-group" data-key="${esc(f0.groupKey)}" title="${esc(LL('Combinar todos los trys de este jefe', 'Combine every try of this boss'))}">${LL('Todos los trys', 'All tries')}</button></span></div>
      ${fights.map(fightBtn).join('')}</div>`;
  }
  if (trash.length) {
    html += `<details class="enc trash"><summary class="enc-h"><span>${t('trash')}</span><span class="enc-d">${trash.length}</span></summary>${trash.map(fightBtn).join('')}</details>`;
  }
  sidebar.innerHTML = html;
  sidebar.hidden = false;
  if (typeof Extras2 !== 'undefined') Extras2.afterSidebar();
  if (typeof Cards !== 'undefined') Cards.fillMe();
}

// ============================================================ render principal
const TABS = ['damage', 'healing', 'taken', 'enemies', 'shields', 'deaths', 'utility', 'buffs', 'debuffs', 'rotation'];

function parseClock(s) {
  const m = String(s || '').trim().replace(',', '.').match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return ((Number(m[1] || 0) * 60) + Number(m[2])) * 1000;
}

function rangeBar(f) {
  const segs = phaseSegments(f);
  const r = S.range && S.range.fight === f.id ? S.range : null;
  const rel = (ts) => clock(ts - f.startTime);
  const chip = (on, attrs, label, sub) =>
    `<button class="chip ${on ? 'on' : ''}" data-action="range" ${attrs}>${esc(label)}${sub ? ` <span class="muted">${sub}</span>` : ''}</button>`;
  const phaseChips = segs.map((s) => chip(r?.phaseIdx === s.idx, `data-phase="${s.idx}"`, s.name, `${rel(s.start)}–${rel(s.end)}`)).join('');
  const from = r ? clock(r.start - f.startTime) : '';
  const to = r ? clock(r.end - f.startTime) : '';
  return `<div class="rangebar">
    ${chip(!r, 'data-phase="full"', t('fullFight'), clock(fightDur(f)))}
    ${phaseChips}
    <form id="rangeForm" class="rangeform ${r && r.phaseIdx == null ? 'on' : ''}">
      <span class="muted">${t('rangeFrom')}</span><input name="from" placeholder="1:00" value="${from}" spellcheck="false">
      <span class="muted">${t('rangeTo')}</span><input name="to" placeholder="1:10" value="${to}" spellcheck="false">
      <button class="btn sm" type="submit">${t('apply')}</button>
    </form>
    <button class="chip" data-action="copy-summary" title="${esc(LL('Copia un resumen de este intento (resultado, motivo del wipe, primeras muertes, mejores números) listo para pegar en Discord', 'Copies a summary of this attempt (result, wipe cause, first deaths, top numbers) ready to paste into Discord'))}">📋 ${LL('Copiar resumen', 'Copy summary')}</button>
  </div>`;
}

async function render() {
  if (typeof Replay !== 'undefined') Replay.stop();
  const raw = S.fight;
  if (!S.report || !raw) return renderWelcome();
  if (window.tabHidden?.(S.tab)) S.tab = 'damage';
  const combined = !S.player && S.combine.length > 1 && COMBINABLE.has(S.tab);
  const f = combined ? combinedFight() : windowed(raw);
  S.viewCombined = combined;
  const seq = ++S.seq;
  const rkBtn = S.player ? '' : `<button class="rank-btn ${S.tab === 'rankings' ? 'active' : ''}" data-action="tab" data-tab="rankings"><img class="wi" src="icons/achievement_bg_winwsg.jpg" width="22" height="22" alt="">${t('tabs.rankings')}</button>`;
  const nav = S.player ? '' : `${rkBtn}<nav class="tabs">${TABS.filter((k) => !window.tabHidden?.(k)).map((k) =>
    `<button class="tab ${S.tab === k ? 'active' : ''}" data-action="tab" data-tab="${k}">${t('tabs.' + k)}</button>`).join('')}</nav>`;
  const banner = S.combine.length > 1 ? `<div class="combine-banner">${LL(`Combinando ${S.combine.length} pulls`, `Combining ${S.combine.length} pulls`)}${combined ? '' : ` · <span class="muted">${LL('esta pestaña muestra solo el pull seleccionado', 'this tab only shows the selected pull')}</span>`}<span class="grow"></span><button class="chip" data-action="combine-clear">${LL('Salir', 'Exit')}</button></div>` : '';
  main.innerHTML = `${nav}${banner}${combined ? '' : raw.encounterID || fightDur(raw) > 20000 ? rangeBar(raw) : ''}<section id="view">${loadingHTML()}</section>`;
  S.post = null;
  try {
    const html = S.player ? await viewPlayer(f, S.player) : await VIEWS[S.tab](f);
    if (seq !== S.seq) return;
    $('#view').innerHTML = html;
    afterRender();
    const post = S.post;
    S.post = null;
    if (post) post(seq).catch((e) => console.warn(e));
  } catch (e) {
    console.error(e);
    if (seq !== S.seq) return;
    $('#view').innerHTML = errorHTML(friendlyError(e));
  }
}

function afterRender() {
  const track = $('.rot-scroll');
  if (track && S._rotScroll != null) { track.scrollLeft = S._rotScroll; S._rotScroll = null; }
}

function eyebrow(f) {
  const zone = zoneName(S.report.zone?.name);
  const parts = [];
  if (f.encounterID) parts.push(`${f.name}`);
  parts.push(`${zone} ${diffName(f.difficulty)}`.trim());
  const real = S.fight;
  if (f.encounterID && !f.combined) parts.push(fightLabel(real));
  if (!f.kill) parts.push(clock(fightDur(f.combined ? f : real)));
  if (f.combined) parts.push(LL(`${f.ids.length} pulls combinados`, `${f.ids.length} pulls combined`));
  if (!f.full) parts.push(`${f.rangeLabel ? f.rangeLabel + ' ' : ''}${clock(f.startTime - f.fightStart)}–${clock(f.endTime - f.fightStart)}`);
  return esc(parts.filter(Boolean).join(' · '));
}

function headerHTML(f, title, sub = '') {
  return `<div class="hdr"><div class="eyebrow">${eyebrow(f)}</div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

function parsePill(p, estimated = false, low = false) {
  if (p == null) return '';
  const c = parseColor(p);
  let tip = t(estimated ? 'parseEstTip' : 'parseTip', { p });
  if (estimated && S.parseMode === 'ilvl') tip += LL(' · Comparado con jugadores de tu mismo nivel de objeto.', ' · Compared with players of your item level.');
  if (low) tip += LL(' · Pull de menos de 1 minuto: poco fiable.', ' · Pull under 1 minute: low reliability.');
  return `<span class="pill${estimated ? ' est' : ''}${low ? ' low' : ''}" style="--pc:${c}" title="${esc(tip)}">${p}</span>`;
}

/** Lista con barras estilo ranking. rows: {id,name,cls,spec,total,rate?,note?,segs?[{v,color,label}]} */
// Selector de orden común a todas las listas con barras
function sortBarHTML(hasParse = false) {
  const chip = (k, label) => `<button class="chip ${S.sortMode === k ? 'on' : ''}" data-action="sort" data-m="${k}">${label}</button>`;
  return `<div class="sortbar"><span class="muted">${LL('Ordenar', 'Sort')}</span>${chip('desc', LL('↓ Mayor a menor', '↓ High to low'))}${chip('asc', LL('↑ Menor a mayor', '↑ Low to high'))}${chip('name', LL('A–Z', 'A–Z'))}<span class="grow"></span><button class="chip" data-action="export-img" data-m="copy" title="${esc(LL('Copiar esta lista como imagen', 'Copy this list as an image'))}">📋 ${LL('Copiar imagen', 'Copy image')}</button><button class="chip" data-action="export-img" data-m="save">💾 ${LL('Guardar PNG', 'Save PNG')}</button>${hasParse ? `<span class="sep"></span>${chip('parse-desc', LL('Parse: mejor a peor', 'Parse: best to worst'))}${chip('parse-asc', LL('Parse: peor a mejor', 'Parse: worst to best'))}` : ''}</div>`;
}

const ENEMY_RED = '#e5484d';
const rowColor = (r) => (CLASSES[r.cls] ? classColor(r.cls) : ENEMY_RED);
// Lista de habilidades {name,total}: acepta la tabla de Warcraft Logs y la ordena de mayor a menor
const abilList = (arr) => (arr || []).filter((a) => a && a.total > 0).map((a) => ({ name: a.name, total: a.total, icon: a.abilityIcon || a.icon || '' })).sort((x, y) => y.total - x.total);
function mergeAbil(lists) {
  const m = new Map();
  for (const l of lists) for (const a of l || []) { const c = m.get(a.name); if (c) c.total += a.total; else m.set(a.name, { ...a }); }
  return [...m.values()].sort((x, y) => y.total - x.total);
}

// Cantidades como Warcraft Logs: 81,55m · 437,7k · 1,84b (el separador decimal sigue al idioma de la app)
function amountFmt(n) {
  n = n || 0;
  const a = Math.abs(n);
  if (a >= 1e9) return `${num(n / 1e9, 2)}b`;
  if (a >= 1e6) return `${num(n / 1e6, 2)}m`;
  if (a >= 1e3) return `${num(n / 1e3, 1)}k`;
  return num(n, 0);
}
const PET_TEAL = '#5eb8c7';
const petsOf = (e) => (e?.pets || []).reduce((s, p) => s + (p.total || 0), 0);
const activeOf = (e, ms) => (e?.activeTime != null && ms > 0 ? Math.min(100, (e.activeTime / ms) * 100) : null);

function rankedList(rows, { parse, parseIlvl, slots, slotsIlvl, clickable = !S.viewCombined, unit = '' } = {}) {
  if (!rows.length) return `<div class="empty">${t('noData')}</div>`;
  const max = Math.max(...rows.map((r) => r.total), 1);
  let list = rows;
  if (S.sortMode === 'asc') list = [...rows].reverse();
  else if (S.sortMode === 'name') list = [...rows].sort((x, y) => x.name.localeCompare(y.name, locale()));
  else if (parse && /^parse-/.test(S.sortMode)) {
    const pv = (r) => { const v = parse.get(r.name); return typeof v === 'number' ? v : -1; };
    list = [...rows].sort((x, y) => (S.sortMode === 'parse-asc' ? pv(x) - pv(y) : pv(y) - pv(x)));
  }
  const sum = rows.reduce((x, r) => x + r.total, 0) || 1;
  const hasParse = !!(parse || slots?.size);
  const hasParseI = !!(parseIlvl || slotsIlvl?.size);
  const hasIlvl = rows.some((r) => r.ilvl > 0);
  const hasActive = rows.some((r) => r.active != null);
  const hasRate = rows.some((r) => r.rate != null);
  const hasNote = rows.some((r) => r.note);
  const cols = [hasParse && '60px', 'minmax(170px, 250px)', 'minmax(240px, 1fr)', hasNote && 'auto', hasIlvl && '54px', hasParseI && '62px', hasActive && '70px', hasRate && '124px'].filter(Boolean).join(' ');
  const tags = (h) => String(h ?? '').replace(/<[^>]*>/g, '').trim();
  const pill = (map, slotSet, cls, r) => {
    const v = map?.get(r.name);
    if (typeof v === 'number') return parsePill(v);
    if (slotSet?.has(r.name)) return `<span class="${cls}" data-name="${esc(r.name)}"></span>`;
    return '<span class="muted">–</span>';
  };
  S.lastRanked = list.map((r) => {
    const pets = Math.min(r.pets || 0, r.total);
    const color = rowColor(r);
    return {
      name: r.name, cls: r.cls, icon: r.icon, total: r.total, pct: (r.total / sum) * 100, amount: amountFmt(r.total), me: isMe(r.name),
      rate: r.rate != null ? num(r.rate, 1) : tags(r.note), ilvl: r.ilvl > 0 ? r.ilvl : null, active: r.active ?? null,
      parse: parse?.get(r.name) ?? null, parseI: parseIlvl?.get(r.name) ?? null,
      segs: pets > 0 ? [{ v: r.total - pets, color }, { v: pets, color: PET_TEAL }] : [{ v: r.total, color }], abil: r.abil || null,
    };
  });
  S.lastRankedMeta = { unit, hasParse, hasParseI, hasIlvl, hasActive, hasRate: hasRate || hasNote };
  const head = `<div class="row head">${hasParse ? '<span>Parse %</span>' : ''}<span class="c-name">${LL('Nombre', 'Name')}</span><span class="c-amt">${LL('Cantidad', 'Amount')}</span>${hasNote ? '<span></span>' : ''}${hasIlvl ? '<span>Ilvl</span>' : ''}${hasParseI ? '<span>Ilvl %</span>' : ''}${hasActive ? `<span>${LL('Activo', 'Active')}</span>` : ''}${hasRate ? `<span class="c-rate">${unit}</span>` : ''}</div>`;
  return `${sortBarHTML(!!parse)}<div class="ranked" style="--cols:${cols}">${head}${list.map((r, i) => {
    const color = rowColor(r);
    const me = isMe(r.name);
    const pets = Math.min(r.pets || 0, r.total);
    const segs = pets > 0 ? [[r.total - pets, color], [pets, PET_TEAL]] : [[r.total, color]];
    const bar = segs.map(([v, c]) => `<span class="seg" style="flex:${v} 1 0;background:${c}"></span>`).join('');
    return `<div class="row ${me ? 'me' : ''} ${clickable ? 'click' : ''}" data-ri="${i}" ${clickable ? `data-action="player" data-id="${r.id}"` : ''}>
      ${hasParse ? `<span class="c-parse">${pill(parse, slots, 'pill-slot', r)}</span>` : ''}
      <div class="r-name">
        ${r.icon ? `<img class="spec-ic-sm" src="${specIconUrl(esc(r.icon))}" width="22" height="22" alt="" style="--cc:${color}">` : `<span class="dot" style="background:${color}"></span>`}
        <span class="name" style="color:${color}">${esc(r.name)}</span>
        ${me ? `<span class="you">${t('you')}</span>` : ''}
      </div>
      <div class="r-bar"><span class="r-pct">${num((r.total / sum) * 100, 2)}%</span><div class="bar-wrap"><div class="bar"><div class="bar-in" style="width:calc((100% - 74px) * ${(r.total / max).toFixed(4)})">${bar}</div><span class="r-amt" style="color:${color}">${amountFmt(r.total)}</span></div></div></div>
      ${hasNote ? `<span class="note">${r.note || ''}</span>` : ''}
      ${hasIlvl ? `<span class="c-ilvl">${r.ilvl > 0 ? Math.round(r.ilvl) : '–'}</span>` : ''}
      ${hasParseI ? `<span class="c-parsei">${pill(parseIlvl, slotsIlvl, 'pill-slot-i', r)}</span>` : ''}
      ${hasActive ? `<span class="c-active">${r.active != null ? `${num(r.active, 2)}%` : '–'}</span>` : ''}
      ${hasRate ? `<span class="c-rate">${r.rate != null ? num(r.rate, 1) : ''}</span>` : ''}
    </div>`;
  }).join('')}</div>`;
}

// ---- Exportar la lista actual (daño, sanación, escudos…) como imagen para copiar o guardar, con las mismas columnas
function exportRankedImage(mode) {
  const rows = S.lastRanked || [];
  const m = S.lastRankedMeta || {};
  if (!rows.length) return toast(LL('No hay nada que exportar', 'Nothing to export'));
  const txt = (sel) => ($(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
  const eyebrowT = txt('#view .eyebrow'), title = txt('#view .hdr h1'), sub = txt('#view .hdr .sub');
  const draw = (withIcons) => new Promise((resolve) => {
    const rowH = 30, headH = 100 + (sub ? 26 : 0), pad = 24, scale = 2;
    const parseW = rows.some((r) => r.parse != null) || m.hasParse ? 60 : 0;
    const ilvlW = m.hasIlvl ? 56 : 0, parseIW = rows.some((r) => r.parseI != null) || m.hasParseI ? 64 : 0, actW = m.hasActive ? 72 : 0, rateW = m.hasRate ? 128 : 0;
    const nameW = 230;
    const W = 1180;
    const x0 = pad;
    const xName = x0 + parseW;
    const xBar = xName + nameW;
    const xRight = W - pad - rateW - actW - parseIW - ilvlW;
    const barW = xRight - xBar - 12;
    const cv = document.createElement('canvas');
    cv.width = W * scale;
    cv.height = (headH + 30 + rows.length * rowH + pad + 8) * scale;
    const g = cv.getContext('2d');
    g.scale(scale, scale);
    g.fillStyle = '#0f1013'; g.fillRect(0, 0, W, cv.height);
    const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = '#8b93a1'; g.font = `12px ${font}`; g.fillText(eyebrowT.toUpperCase().slice(0, 150), pad, 26);
    g.fillStyle = '#ffffff'; g.font = `700 28px ${font}`; g.fillText(title, pad, 56);
    if (sub) { g.fillStyle = '#b4bac6'; g.font = `14px ${font}`; g.fillText(sub.slice(0, 160), pad, 86); }
    // cabecera
    const hy = headH - 4;
    g.fillStyle = '#17191f'; g.fillRect(0, hy, W, 28);
    g.fillStyle = '#9aa3b2'; g.font = `600 12px ${font}`;
    g.textAlign = 'center';
    if (parseW) g.fillText('Parse %', x0 + parseW / 2, hy + 14);
    g.textAlign = 'left';
    g.fillText(LL('Nombre', 'Name'), xName, hy + 14);
    g.fillText(LL('Cantidad', 'Amount'), xBar, hy + 14);
    g.textAlign = 'center';
    let cx = xRight;
    if (ilvlW) { g.fillText('Ilvl', cx + ilvlW / 2, hy + 14); cx += ilvlW; }
    if (parseIW) { g.fillText('Ilvl %', cx + parseIW / 2, hy + 14); cx += parseIW; }
    if (actW) { g.fillText(LL('Activo', 'Active'), cx + actW / 2, hy + 14); cx += actW; }
    g.textAlign = 'right';
    if (rateW) g.fillText(m.unit || '', W - pad, hy + 14);
    g.textAlign = 'left';
    const yRows = headH + 24;
    const max = Math.max(...rows.map((r) => r.total), 1);
    const imgs = rows.map((r) => (withIcons && r.icon
      ? new Promise((ok) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = specIconUrl(r.icon); })
      : Promise.resolve(null)));
    Promise.all(imgs).then((ims) => {
      rows.forEach((r, i) => {
        const y = yRows + i * rowH, cy = y + rowH / 2;
        g.fillStyle = i % 2 ? '#13151a' : '#0f1013'; g.fillRect(0, y, W, rowH);
        const color = classColor(r.cls);
        g.textAlign = 'center';
        if (parseW && r.parse != null) { g.fillStyle = parseColor(r.parse); g.font = `700 14px ${font}`; g.fillText(String(r.parse), x0 + parseW / 2, cy); }
        g.textAlign = 'left';
        if (ims[i]) g.drawImage(ims[i], xName, y + 4, 22, 22);
        else { g.fillStyle = color; g.beginPath(); g.arc(xName + 11, cy, 5, 0, 7); g.fill(); }
        g.fillStyle = color; g.font = `600 14px ${font}`; g.fillText(r.name + (r.me ? `  (${t('you')})` : ''), xName + 30, cy, nameW - 36);
        g.fillStyle = '#c9ced8'; g.font = `12px ${font}`; g.textAlign = 'right'; g.fillText(`${r.pct.toFixed(2).replace('.', num(0.5, 1).charAt(1))}%`, xBar + 50, cy); g.textAlign = 'left';
        const bx = xBar + 58;
        const avail = barW - 58 - 70;
        const bw = Math.max(4, avail * (r.total / max));
        const tot = r.segs.reduce((x, q) => x + q.v, 0) || 1;
        let sx = bx;
        for (const q of r.segs) { const w = bw * (q.v / tot); g.fillStyle = q.color; g.fillRect(sx, y + 7, Math.max(1, w), rowH - 14); sx += w; }
        g.fillStyle = color; g.font = `700 13px ${font}`; g.fillText(r.amount, bx + bw + 8, cy);
        let px = xRight;
        g.textAlign = 'center'; g.font = `13px ${font}`;
        if (ilvlW) { g.fillStyle = '#9aa3b2'; if (r.ilvl != null) g.fillText(String(Math.round(r.ilvl)), px + ilvlW / 2, cy); px += ilvlW; }
        if (parseIW) { if (r.parseI != null) { g.fillStyle = parseColor(r.parseI); g.font = `700 14px ${font}`; g.fillText(String(r.parseI), px + parseIW / 2, cy); } px += parseIW; }
        g.font = `13px ${font}`;
        if (actW) { g.fillStyle = '#9aa3b2'; if (r.active != null) g.fillText(`${num(r.active, 2)}%`, px + actW / 2, cy); px += actW; }
        g.textAlign = 'right';
        if (rateW) { g.fillStyle = '#a8e060'; g.font = `700 13px ${font}`; g.fillText(r.rate, W - pad, cy); }
        g.textAlign = 'left';
      });
      g.fillStyle = '#5d6572'; g.font = `11px ${font}`; g.textAlign = 'right'; g.fillText('WipeTime', W - pad, cv.height / scale - 10); g.textAlign = 'left';
      try { cv.toBlob((b) => resolve(b), 'image/png'); } catch { resolve(null); }
    });
  });
  return (async () => {
    let blob = await draw(true);
    if (!blob) blob = await draw(false); // si los iconos manchan el lienzo, se repite sin ellos
    if (!blob) return toast(LL('No se pudo crear la imagen', 'Could not create the image'));
    if (mode === 'save') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `WipeTime - ${title || 'log'}.png`.replace(/[\\/:*?"<>|]/g, '-');
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

// Parses: reales en kills, estimados en wipes; con una fase/rango no se muestran (no son comparables).
function parseOptions(f, rows, realMap, metric, realMapIlvl) {
  if (!f.full || !f.encounterID || f.combined) return {};
  if (f.kill) return { parse: realMap, parseIlvl: realMapIlvl };
  // todos los jugadores, como en Warcraft Logs: los sanadores también tienen parse de daño y los DPS y tanques parse de sanación
  const est = rows;
  fillEstimatedPills(f, est, metric);
  const names = new Set(est.map((r) => r.name));
  return { slots: names, slotsIlvl: names };
}

function leaderSub(rows, f) {
  if (!rows.length) return '';
  const total = rows.reduce((s, r) => s + r.total, 0);
  const note = f && f.full && f.encounterID && !f.kill && !f.combined ? ` · <span class="dimmed">${t('estNote')}</span>`
    : f && f.full && f.encounterID && f.kill && !f.combined && S.liveReport ? ` · <span class="dimmed" title="${esc(LL('Warcraft Logs ajusta los parses durante las primeras horas tras subir el log; pulsa Actualizar más tarde.', 'Warcraft Logs adjusts parses during the first hours after the log is uploaded; press Refresh later.'))}">${LL('parses provisionales (log reciente)', 'provisional parses (recent log)')}</span>` : '';
  return t('sumLeader', { total: plain(total), name: esc(rows[0].name), val: plain(rows[0].total) }) + note;
}

// ============================================================ motivo del wipe
const LL = tr;
const WIPE_CLUSTER = 8; // 8+ muertes en 10 s (o el 40 % de la banda) = muerte masiva
const WIPE_WINDOW_MS = 10000;

/** Devuelve null si el intento es un kill o no hay muertes; si no, cuándo y por qué murió la banda. */
function wipeAnalysis(f, deaths, raidSize) {
  if (f.kill || !deaths.length) return null;
  const ds = [...deaths].sort((a, b) => a.timestamp - b.timestamp);
  const need = Math.max(WIPE_CLUSTER, Math.ceil(raidSize * 0.4));
  let start = -1;
  for (let i = 0; i < ds.length && start < 0; i++) {
    let n = 0;
    for (let j = i; j < ds.length && ds[j].timestamp - ds[i].timestamp <= WIPE_WINDOW_MS; j++) n++;
    if (n >= need) start = i;
  }
  const abilityOf = (d) => d.abilityId ?? 0;
  const tally = (list) => {
    const m = new Map();
    for (const d of list) {
      const k = abilityOf(d);
      const c = m.get(k) || { abilityId: k, count: 0, killers: new Map() };
      c.count++;
      c.killers.set(d.killerId, (c.killers.get(d.killerId) || 0) + 1);
      m.set(k, c);
    }
    return [...m.values()].sort((x, y) => y.count - x.count).map((c) => ({
      abilityId: c.abilityId, count: c.count, share: c.count / list.length,
      killerId: [...c.killers.entries()].sort((x, y) => y[1] - x[1])[0]?.[0],
    }));
  };
  if (start < 0) { // sin golpe único: desgaste progresivo
    if (ds.length < Math.max(3, raidSize * 0.4)) return null;
    return { kind: 'attrition', t: ds[0].timestamp, rel: ds[0].timestamp - f.fightStart, n: ds.length, raid: raidSize, before: 0, causes: tally(ds).slice(0, 4), dmg: [], first: ds.slice(0, 3) };
  }
  const t0 = ds[start].timestamp;
  const cluster = ds.filter((d) => d.timestamp >= t0 && d.timestamp <= t0 + WIPE_WINDOW_MS);
  const causes = tally(cluster).slice(0, 4);
  // daño recibido por habilidad en los 8 s previos a cada muerte del grupo
  const dmgBy = new Map();
  let dmgTotal = 0;
  for (const d of cluster) {
    for (const e of d.timeline || []) {
      if (e.kind !== 'dmg' || e.timestamp < d.timestamp - 8000) continue;
      const v = (e.amount || 0) + (e.absorbed || 0);
      const c = dmgBy.get(e.abilityGameID) || { abilityId: e.abilityGameID, total: 0, sourceID: e.sourceID };
      c.total += v;
      dmgTotal += v;
      dmgBy.set(e.abilityGameID, c);
    }
  }
  const dmg = [...dmgBy.values()].sort((x, y) => y.total - x.total).slice(0, 4).map((c) => ({ ...c, share: dmgTotal ? c.total / dmgTotal : 0 }));
  const top = causes[0];
  const kind = top.share >= 0.5 ? 'burst' : causes.length > 1 && causes[0].share + causes[1].share >= 0.6 ? 'mixed' : 'many';
  return { kind, t: t0, rel: t0 - f.fightStart, n: cluster.length, raid: raidSize, before: start, causes, dmg, first: cluster.slice(0, 3), span: (cluster[cluster.length - 1].timestamp - t0) / 1000 };
}

/** Frase corta con el motivo (se usa en la tarjeta de Muertes y en el registro del replay). */
function wipeCauseText(w) {
  const nm = (c) => `<b>${esc(ability(c.abilityId).name)}</b>`;
  const src = (c) => (c.killerId != null && c.killerId !== -1 ? LL(' de ', ' from ') + esc(actorName(c.killerId)) : '');
  if (w.kind === 'burst') return LL(`Muerte masiva por ${nm(w.causes[0])}${src(w.causes[0])}`, `Mass death caused by ${nm(w.causes[0])}${src(w.causes[0])}`);
  if (w.kind === 'mixed') return LL(`Varias habilidades a la vez: ${nm(w.causes[0])} y ${nm(w.causes[1])}`, `Several abilities at once: ${nm(w.causes[0])} and ${nm(w.causes[1])}`);
  if (w.kind === 'attrition') return LL('Desgaste: fueron muriendo jugadores durante la pelea', 'Attrition: players kept dying through the fight');
  return LL(`Muerte masiva por varias causas, sobre todo ${nm(w.causes[0])}`, `Mass death from several causes, mostly ${nm(w.causes[0])}`);
}

/** Resumen corto del intento para pegar en Discord: resultado, motivo del wipe, primeras muertes y mejores números. */
async function pullSummaryText(raw) {
  const w = { ...raw, fightStart: raw.startTime, fightEnd: raw.endTime, full: true, key: `${raw.id}:${raw.startTime}-${raw.endTime}`, rangeLabel: '' };
  const [d, deaths] = await Promise.all([fightData(w), deathsData(w).catch(() => [])]);
  const dur = fightDur(w) / 1000;
  const txt = (h) => String(h || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
  const players = d.dmg.filter((e) => isPlayer(e.id, e));
  const topList = (list, n = 3) => list.slice(0, n).map((e) => `${e.name} ${plain(e.total / dur)}`).join(' · ');
  const dps = [...players].filter((e) => e.total > 0).sort((a, b) => b.total - a.total);
  const hps = d.heal.filter((e) => isPlayer(e.id, e) && e.total > 0 && HEALER_SPECS.has(playerInfo(e.id, e).spec)).sort((a, b) => b.total - a.total);
  const diff = raw.encounterID ? diffName(raw.difficulty) : '';
  const head = `**${raw.name}**${diff ? ` (${diff})` : ''} · ${txt(fightLabel(raw))}${raw.kill ? '' : ` · ${clock(fightDur(raw))}`}`;
  const lines = [head];
  const ds = [...deaths].sort((a, b) => a.timestamp - b.timestamp);
  const first = ds.slice(0, 3).map((x) => {
    const pi = playerInfo(x.targetID);
    const ab = x.abilityId ? ` (${ability(x.abilityId).name})` : '';
    return `${pi.name} ${clock(x.timestamp - w.fightStart)}${ab}`;
  });
  if (raw.kill) {
    lines.push(LL(`✅ **Kill** · ${ds.length} ${ds.length === 1 ? 'muerte' : 'muertes'}`, `✅ **Kill** · ${ds.length} ${ds.length === 1 ? 'death' : 'deaths'}`));
  } else {
    const wa = wipeAnalysis(w, deaths, Math.max(players.length, 1));
    lines.push(LL('❌ **Wipe**', '❌ **Wipe**') + (wa ? ` · ${txt(wipeCauseText(wa))} (${clock(wa.rel)}, ${wa.n}/${wa.raid})` : ''));
    if (wa?.dmg?.length) lines.push(LL('Daño justo antes: ', 'Damage just before: ') + wa.dmg.slice(0, 3).map((c) => `${ability(c.abilityId).name} ${plain(c.total)}`).join(' · '));
  }
  if (first.length) lines.push(LL('Primeros en caer: ', 'First to fall: ') + first.join(', '));
  if (dps.length) lines.push(`DPS: ${topList(dps)}`);
  if (hps.length) lines.push(`HPS: ${topList(hps)}`);
  lines.push(`https://www.warcraftlogs.com/reports/${S.code}#fight=${raw.id}`);
  return lines.join(String.fromCharCode(10));
}

function wipeCardHTML(w) {
  const chips = w.causes.map((c) => {
    const a = ability(c.abilityId);
    return `<span class="wchip" data-spell="${c.abilityId}">${iconImg(a.icon, 20)}<b>${esc(a.name)}</b><em>×${c.count}</em></span>`;
  }).join('');
  const dmg = w.dmg.slice(0, 3).map((c) => `${esc(ability(c.abilityId).name)} <b>${plain(c.total)}</b> <small>(${num(c.share * 100, 0)} %)</small>`).join(' · ');
  const names = w.first.map((d) => `<b style="color:${classColor(playerInfo(d.targetID).cls)}">${esc(playerInfo(d.targetID).name)}</b>`).join(', ');
  const body = w.kind === 'attrition'
    ? LL(`Murieron <b>${w.n}</b> de ${w.raid} jugadores a lo largo del intento; la primera muerte fue a los <b>${clock(w.rel)}</b>.`,
      `<b>${w.n}</b> of ${w.raid} players died over the attempt; the first death was at <b>${clock(w.rel)}</b>.`)
    : LL(`<b>${w.n} de ${w.raid}</b> jugadores murieron en ${num(w.span, 0)} s a los <b>${clock(w.rel)}</b>${w.before ? `. Antes ya habían muerto ${w.before}` : ''}.`,
      `<b>${w.n} of ${w.raid}</b> players died within ${num(w.span, 0)} s at <b>${clock(w.rel)}</b>${w.before ? `. ${w.before} had already died before` : ''}.`);
  return `<div class="wipe-card"><div class="wipe-ic">☠</div><div class="wipe-body">
      <div class="wipe-tag">${LL('MOTIVO DEL WIPE', 'WIPE CAUSE')} · ${clock(w.rel)}</div>
      <h2>${wipeCauseText(w)}</h2><p>${body}</p>
      <div class="wchips">${chips}</div>
      ${dmg ? `<p class="wipe-dmg">${LL('Daño recibido justo antes', 'Damage taken just before')}: ${dmg}</p>` : ''}
      <p class="wipe-first">${LL('Primeros en caer', 'First to fall')}: ${names}</p>
      <button class="btn" data-action="wipe-replay" data-t="${w.t - 6000}">${LL('Ver el momento en el replay', 'Watch the moment in the replay')}</button>
    </div></div>`;
}

// ============================================================ vistas
const VIEWS = {
  async shields(f) {
    const all = await shieldData(f);
    if (!all.length) return headerHTML(f, t('shieldsTitle')) + `<div class="empty">${t('noShields')}</div>`;
    // Tipos de escudo: boss, aliados (jugadores controlados mentalmente) y adds; se elige con un desplegable
    const kindOf = (s) => (s.mc ? 'allies' : S.actors.get(s.target)?.subType === 'Boss' ? 'boss' : 'adds');
    const labelOf = (s) => (s.mc ? `${actorName(s.target)} (${LL('aliado', 'ally')})` : actorName(s.target));
    const KINDS = [['all', LL('Todos', 'All')], ['boss', 'Boss'], ['allies', LL('Aliados', 'Allies')], ['adds', 'Adds']];
    const stat = (k) => { const l = k === 'all' ? all : all.filter((s) => kindOf(s) === k); return { n: l.length, total: l.reduce((x, s) => x + s.total, 0) }; };
    const kind = KINDS.some(([k]) => k === S.shieldKind) ? S.shieldKind : 'all';
    const opts = KINDS.map(([k, label]) => { const st = stat(k); return `<option value="${k}" ${k === kind ? 'selected' : ''} ${k !== 'all' && !st.n ? 'disabled' : ''}>${esc(label)} · ${st.n ? plain(st.total) : '0'}</option>`; }).join('');
    const typeBar = `<div class="sortbar"><span class="muted">${LL('Tipo de daño a escudos', 'Shield damage type')}</span><select data-shield-kind>${opts}</select></div>`;
    const shields = kind === 'all' ? all : all.filter((s) => kindOf(s) === kind);
    if (!shields.length) return headerHTML(f, t('shieldsTitle')) + typeBar + `<div class="empty">${LL('No hay escudos de este tipo en este pull.', 'There are no shields of this type in this pull.')}</div>`;
    const segs = phaseSegments(S.fight);
        const dur = (s) => Math.max(1000, s.end - s.start);
    // Tiempo con escudo activo: unión de los intervalos (los escudos de varios enemigos pueden solaparse)
    const iv = shields.map((s) => [s.start, s.start + dur(s)]).sort((a, b) => a[0] - b[0]);
    let active = 0;
    let curEnd = -Infinity;
    for (const [a, b] of iv) {
      if (a > curEnd) { active += b - a; curEnd = b; } else if (b > curEnd) { active += b - curEnd; curEnd = b; }
    }
    const secs = active / 1000;
    const labels = shields.map((s, i) => {
      const ph = segs.find((p) => s.start >= p.start && s.start < p.end);
      return [t('shieldN', { n: i + 1 }), labelOf(s), ph?.name || ''].filter(Boolean).join(' · ');
    });
    const per = new Map();
    shields.forEach((s, i) => {
      for (const [pid, v] of s.byPlayer) {
        if (!isPlayer(pid)) continue;
        if (!per.has(pid)) per.set(pid, { ...playerInfo(pid), total: 0, vals: shields.map(() => 0), lists: [] });
        const p = per.get(pid);
        p.total += v;
        p.vals[i] += v;
        p.lists.push([...(s.byAbil.get(pid) || new Map())].map(([id, tot]) => ({ name: ability(id).name, total: tot, icon: ability(id).icon })));
      }
    });
    const rows = [...per.values()].map((p) => ({ ...p, rate: p.total / secs, abil: mergeAbil(p.lists) }))
      .sort((a, b) => b.total - a.total);
    const total = shields.reduce((s, x) => s + x.total, 0);
    const bosses = [...new Set(shields.map((s) => actorName(s.target)))].join(', ');
    const sub = t('shieldsSub', { total: plain(total), n: shields.length, boss: esc(bosses), name: esc(rows[0]?.name || ''), val: plain(rows[0]?.total || 0) })
      + ` · ${LL('Raid', 'Raid')} <b>${plain(total / secs)} DPS</b> ${LL('durante', 'over')} ${clock(active)}`;
    const legend = `<div class="legend">${shields.map((s, i) =>
      `<span><i style="background:var(--muted)"></i>${esc(labels[i])} <small>${clock(s.start - f.fightStart)} · ${plain(s.total)} · ${plain(s.total / (dur(s) / 1000))} DPS</small></span>`).join('')}</div>`;
    return headerHTML(f, t('shieldsTitle'), sub) + typeBar + legend + rankedList(rows, { unit: 'DPS' }) + `<p class="foot">${t('shieldsFoot')}</p>`;
  },

  async pi(f) {
    const list = await piData(f);
    if (!list.length) return headerHTML(f, t('piTitle')) + `<div class="empty">${t('noPi')}</div>`;
    const byTarget = new Map();
    for (const p of list) byTarget.set(p.target, (byTarget.get(p.target) || 0) + 1);
    const chips = [...byTarget.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => {
      const p = playerInfo(id);
      return `<span class="chip on ${isMe(p.name) ? 'me' : ''}" style="--cc:${classColor(p.cls)}"><span class="sq"></span>${esc(p.name)} <b>×${n}</b></span>`;
    }).join('');
    const who = (id) => {
      const p = playerInfo(id);
      const cc = classColor(p.cls);
      return `<span class="who ${isMe(p.name) ? 'me' : ''}">${p.icon ? `<img class="spec-ic-sm" src="${specIconUrl(esc(p.icon))}" width="24" height="24" alt="" style="--cc:${cc}">` : `<span class="dot" style="background:${cc}"></span>`}<b style="color:${cc}">${esc(p.name)}</b></span>`;
    };
    const pi = ability(POWER_INFUSION);
    const rows = list.map((p, i) => {
      const dur = Math.max(1, p.end - p.start);
      return `<div class="pirow ${isMe(playerInfo(p.target).name) ? 'me' : ''}">
        <span class="pitime">${clock(p.start - f.fightStart)}${p.cut ? '*' : ''}</span>
        <span class="pifrom">${who(p.source)}${p.selfAlso ? ` <span class="tag" title="${esc(t('selfAlsoTip'))}">${t('selfAlso')}</span>` : ''}</span>
        <span class="piarrow">${iconImg(pi.icon, 26, '', POWER_INFUSION)}<i>→</i></span>
        <span class="pito">${who(p.target)}${p.source === p.target ? ` <span class="tag">${t('selfPi')}</span>` : ''}</span>
        <span class="r"><b>${plain(p.damage || 0)}</b></span>
        <span class="r muted">${plain(((p.damage || 0) / dur) * 1000)}${t('perSec')}</span>
      </div>`;
    }).join('');
    const targets = byTarget.size;
    return headerHTML(f, t('piTitle'), t('piSub', { n: list.length, k: targets }))
      + `<div class="chips">${chips}</div>`
      + `<div class="pitable"><div class="pirow th"><span>${t('minute')}</span><span>${t('giver')}</span><span></span><span>${t('receiver')}</span><span class="r">${t('dmgDuringPi')}</span><span class="r">${t('rate')}</span></div>${rows}</div>`;
  },

  async damage(f) {
    const [d, rk] = await Promise.all([fightData(f), rankings(f)]);
    const dur = fightDur(f) / 1000;
    const m = S.dmgMetric === 'rdps' ? 'dps' : S.dmgMetric;
    const bossOf = (e) => (e.targets || []).filter((x) => x.type === 'Boss').reduce((s, x) => s + x.total, 0);
    const rows = d.dmg.filter((e) => isPlayer(e.id, e))
      .map((e) => {
        const base = { ...playerInfo(e.id, e), ilvl: e.itemLevel, active: activeOf(e, dur * 1000), pets: petsOf(e), abil: abilList(e.abilities) };
        if (m === 'rdps') { const v = Math.max(0, e.total - (e.totalRDPSTaken || 0) + (e.totalRDPSGiven || 0)); return { ...base, pets: 0, total: v, rate: v / dur }; }
        if (m === 'boss') { const v = bossOf(e); return { ...base, pets: 0, total: v, rate: v / dur }; }
        if (m === 'active') return { ...base, total: e.total, rate: e.total / Math.max(1, (e.activeTime || dur * 1000) / 1000) };
        return { ...base, total: e.total, rate: e.total / dur };
      })
      .filter((r) => r.total > 0)
      .sort((x, y) => (m === 'active' ? y.rate - x.rate : y.total - x.total));
    const mchip = (k, label, tip) => `<button class="chip ${m === k ? 'on' : ''}" data-action="metric" data-m="${k}" title="${esc(tip)}">${label}</button>`;
    const pchip = (k, label) => `<button class="chip ${S.parseMode === k ? 'on' : ''}" data-action="pmode" data-m="${k}">${label}</button>`;
    const bar = `<div class="metricbar"><span class="muted">${LL('Métrica', 'Metric')}</span>
      ${mchip('dps', LL('Daño total', 'Total damage'), LL('Todo el daño hecho, sin ajustes', 'All damage done, unadjusted'))}
      ${mchip('boss', LL('Solo jefe', 'Boss only'), LL('Solo el daño al jefe, sin adds', 'Boss damage only, no adds'))}
      ${mchip('active', LL('DPS activo', 'Active DPS'), LL('Daño dividido por el tiempo que estuviste lanzando, no por toda la pelea', 'Damage divided by the time you were actually casting'))}
    </div>`;
    const real = S.parseMode === 'ilvl' ? rk.dpsB : rk.dps;
    const withParse = m === 'dps' || m === 'rdps';
    return headerHTML(f, t('dmgTitle'), leaderSub(rows, f)) + bar + rankedList(rows, { unit: 'DPS', ...(withParse ? parseOptions(f, rows, rk.dps, 'dps', rk.dpsB) : {}) });
  },

  async healing(f) {
    const [d, rk] = await Promise.all([fightData(f), rankings(f)]);
    const dur = fightDur(f) / 1000;
    const rows = d.heal.filter((e) => isPlayer(e.id, e) && e.total > 0)
      .map((e) => {
        const oh = e.overheal || 0;
        const ohp = oh > 0 ? (oh / (oh + e.total)) * 100 : 0;
        return { ...playerInfo(e.id, e), ilvl: e.itemLevel, active: activeOf(e, dur * 1000), pets: petsOf(e), total: e.total, rate: e.total / dur, abil: abilList(e.abilities), note: ohp ? t('overheal', { p: num(ohp, 0) }) : '' };
      })
      .sort((a, b) => b.total - a.total);
    return headerHTML(f, t('healTitle'), leaderSub(rows, f)) + rankedList(rows, { unit: 'HPS', ...parseOptions(f, rows, rk.hps, 'hps', rk.hpsB) });
  },

  async taken(f) {
    const d = await fightData(f);
    const dur = fightDur(f) / 1000;
    const players = d.taken.filter((e) => isPlayer(e.id, e));
    // Todas las habilidades que han golpeado a la banda, para poder ver el daño de una sola
    const byAbil = new Map();
    for (const e of players) for (const a of abilList(e.abilities)) byAbil.set(a.name, (byAbil.get(a.name) || 0) + a.total);
    const abilities = [...byAbil.entries()].sort((x, y) => y[1] - x[1]);
    const sel = byAbil.has(S.takenAbility) ? S.takenAbility : '';
    const opts = `<option value="">${esc(LL('Todas las habilidades (total)', 'All abilities (total)'))} · ${plain(players.reduce((x, e) => x + e.total, 0))}</option>` +
      abilities.map(([name, tot]) => `<option value="${esc(name)}" ${name === sel ? 'selected' : ''}>${esc(name)} · ${plain(tot)}</option>`).join('');
    const picker = abilities.length ? `<div class="sortbar"><span class="muted">${LL('Habilidad', 'Ability')}</span><select data-taken-ability>${opts}</select></div>` : '';
    const rows = players
      .map((e) => {
        const ab = abilList(e.abilities);
        if (!sel) return { ...playerInfo(e.id, e), total: e.total, rate: e.total / dur, abil: ab };
        const v = ab.find((x) => x.name === sel)?.total || 0;
        return { ...playerInfo(e.id, e), total: v, rate: v / dur, abil: ab.filter((x) => x.name === sel) };
      })
      .filter((r) => r.total > 0)
      .sort((x, y) => y.total - x.total);
    const title = sel ? `${t('takenTitle')} · ${sel}` : t('takenTitle');
    return headerHTML(f, title, leaderSub(rows)) + picker + rankedList(rows, { unit: 'DTPS' });
  },

  async enemies(f) {
    const d = await fightData(f);
    const targets = d.tgt.filter((e) => e.total > 0 && !isPlayer(e.id, e)).sort((a, b) => b.total - a.total);
    if (!S.enemySel || S.enemySel.fight !== f.id) S.enemySel = { fight: f.id, ids: targets.slice(0, 1).map((e) => e.id) };
    const ids = S.enemySel.ids.filter((id) => targets.some((e) => e.id === id));
    const colorOf = (id) => SEGMENT_COLORS[ids.indexOf(id) % SEGMENT_COLORS.length];

    const chips = targets.slice(0, 24).map((e) => {
      const on = ids.includes(e.id);
      return `<button class="chip ${on ? 'on' : ''}" data-action="enemy" data-id="${e.id}" ${on ? `style="--cc:${colorOf(e.id)}"` : ''}>
        <span class="sq"></span>${esc(e.name)} <span class="muted">${plain(e.total)}</span></button>`;
    }).join('');

    const tables = await Promise.all(ids.map((id) => enemyTable(f, id)));
    const per = new Map();
    tables.forEach((entries, i) => {
      for (const e of entries) {
        if (!isPlayer(e.id, e)) continue;
        if (!per.has(e.id)) per.set(e.id, { ...playerInfo(e.id, e), total: 0, segs: ids.map(() => 0), lists: [] });
        const p = per.get(e.id);
        p.lists.push(abilList(e.abilities));
        p.pets = (p.pets || 0) + petsOf(e);
        p.total += e.total;
        p.segs[i] += e.total;
      }
    });
    const names = ids.map((id) => targets.find((e) => e.id === id)?.name || '?');
    const rows = [...per.values()].map((p) => ({
      ...p, abil: mergeAbil(p.lists), segs: p.segs.map((v, i) => ({ v, color: colorOf(ids[i]), label: names[i] })),
    })).sort((a, b) => b.total - a.total);

    const total = rows.reduce((s, r) => s + r.total, 0);
    const sub = rows.length
      ? t('enemiesSub', { total: plain(total), n: ids.length, name: esc(rows[0].name), val: plain(rows[0].total) })
      : t('pickEnemies');
    const legend = ids.length > 1
      ? `<div class="legend">${ids.map((id, i) => `<span><i style="background:${colorOf(id)}"></i>${esc(names[i])}</span>`).join('')}</div>` : '';
    return headerHTML(f, t('enemiesTitle'), sub)
      + `<div class="chips">${chips}</div>${legend}`
      + (ids.length ? rankedList(rows, { unit: 'DPS' }) : '');
  },

  async deaths(f) {
    const deaths = await deathsData(f);
    if (!deaths.length) return headerHTML(f, t('deathsTitle')) + `<div class="empty">${t('noDeaths')}</div>`;
    const cards = deaths.map((dd, i) => deathCard(f, dd, i)).join('');
    let wipeHtml = '';
    if (f.full && !f.kill) {
      const fd = await fightData(f);
      const raid = new Set([...fd.dmg, ...fd.heal].filter((e) => isPlayer(e.id, e)).map((e) => e.id)).size;
      const w = wipeAnalysis(f, deaths, raid);
      if (w) wipeHtml = wipeCardHTML(w);
    }
    return headerHTML(f, t('deathsTitle'), t('deathsSub', { n: deaths.length })) + wipeHtml + `<div class="deaths">${cards}</div>`;
  },

  async utility(f) {
    const u = await utilityData(f);
    const section = (title, events, removedTitle) => {
      const byPlayer = new Map();
      const byAura = new Map();
      for (const e of events) {
        byPlayer.set(e.sourceID, (byPlayer.get(e.sourceID) || 0) + 1);
        const k = e.extraAbilityGameID ?? e.abilityGameID;
        byAura.set(k, (byAura.get(k) || 0) + 1);
      }
      const rows = [...byPlayer.entries()].filter(([id]) => isPlayer(id))
        .map(([id, n]) => ({ ...playerInfo(id), total: n })).sort((a, b) => b.total - a.total);
      const auras = [...byAura.entries()].sort((a, b) => b[1] - a[1]);
      const max = Math.max(1, ...rows.map((r) => r.total));
      return `<div class="card"><h2>${title} <span class="muted">${events.length}</span></h2>
        <h3>${t('byPlayer')}</h3>
        ${rows.length ? rows.map((r) => `<div class="mini click" data-action="player" data-id="${r.id}">
          <span class="dot" style="background:${classColor(r.cls)}"></span><span class="name">${esc(r.name)}</span>
          <span class="mbar"><span style="width:${(r.total / max) * 100}%;background:${classColor(r.cls)}"></span></span><b>${r.total}</b></div>`).join('') : `<div class="empty sm">${t('noData')}</div>`}
        <h3>${removedTitle}</h3>
        ${auras.length ? auras.map(([id, n]) => `<div class="mini" data-spell="${id}">${iconImg(ability(id).icon, 20)}<span class="name">${esc(ability(id).name)}</span><span class="grow"></span><b>${n}</b></div>`).join('') : `<div class="empty sm">${t('noData')}</div>`}
      </div>`;
    };
    return headerHTML(f, t('utilTitle'))
      + `<div class="grid2">${section(t('dispels'), u.dispels, t('removed'))}${section(t('interrupts'), u.interrupts, t('interrupted'))}</div>`;
  },

  async buffs(f) {
    const d = await fightData(f);
    const players = d.dmg.concat(d.heal).filter((e) => isPlayer(e.id, e));
    const uniq = [...new Map(players.map((e) => [e.id, playerInfo(e.id, e)])).values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!S.buffsPlayer || !uniq.some((p) => p.id === S.buffsPlayer)) {
      S.buffsPlayer = (uniq.find((p) => isMe(p.name)) || uniq[0])?.id;
    }
    const picker = playerPicker(uniq, S.buffsPlayer, 'buffsPlayer');
    if (!S.buffsPlayer) return headerHTML(f, t('buffsTitle')) + `<div class="empty">${t('noData')}</div>`;
    const pd = await playerData(f, S.buffsPlayer);
    return headerHTML(f, t('buffsTitle'), esc(uniq.find((p) => p.id === S.buffsPlayer)?.name || '')) + picker + aurasTable(pd);
  },

  async rotation(f) {
    const d = await fightData(f);
    const players = d.dmg.concat(d.heal).filter((e) => isPlayer(e.id, e));
    const uniq = [...new Map(players.map((e) => [e.id, playerInfo(e.id, e)])).values()]
      .sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name));
    return headerHTML(f, t('rotationTitle'), t('pickPlayer'))
      + `<div class="pgrid">${uniq.map((p) => `<button class="pcard ${isMe(p.name) ? 'me' : ''}" data-action="player" data-id="${p.id}" data-ptab="rotation" style="--cc:${classColor(p.cls)}">
          <img class="spec-ic" src="${specIconUrl(esc(p.icon))}" alt="">
          <span><b>${esc(p.name)}</b></span></button>`).join('')}</div>`;
  },
};

function playerPicker(players, selected, action) {
  return `<div class="chips">${players.map((p) => `<button class="chip ${p.id === selected ? 'on' : ''}" data-action="${action}" data-id="${p.id}" style="--cc:${classColor(p.cls)}">
    <span class="sq"></span>${esc(p.name)}</button>`).join('')}</div>`;
}

function aurasTable(pd) {
  const auras = [...pd.auras].sort((a, b) => (b.totalUptime || 0) - (a.totalUptime || 0));
  if (!auras.length) return `<div class="empty">${t('noData')}</div>`;
  return `<div class="table"><div class="tr th"><span>${t('ability')}</span><span>${t('uptime')}</span><span class="r">${t('uses')}</span></div>
    ${auras.map((a) => {
      const up = Math.min(100, ((a.totalUptime || 0) / pd.totalTime) * 100);
      return `<div class="tr"><span class="ab" data-spell="${a.guid}">${iconImg(a.abilityIcon, 22)}${esc(a.name)}</span>
        <span class="up"><span class="mbar"><span style="width:${up}%"></span></span>${num(up, 1)} %</span>
        <span class="r">${a.totalUses ?? ''}</span></div>`;
    }).join('')}</div>`;
}

// ============================================================ muertes
function deathCard(f, dd, i) {
  const p = playerInfo(dd.targetID);
  const ab = ability(dd.abilityId);
  const killer = actorName(dd.killerId);
  const winS = dd.windowMs / 1000;
  const timeline = dd.timeline.slice(-30).map((e) => {
    const a = ability(e.abilityGameID);
    const dt = (e.timestamp - dd.timestamp) / 1000;
    const hp = e.hitPoints != null && e.maxHitPoints && e.resourceActor !== 1 ? (e.hitPoints / e.maxHitPoints) * 100 : null;
    const amt = (e.amount || 0) + (e.absorbed || 0);
    const kindCls = e.kind === 'dmg' ? 'neg' : 'pos';
    const sign = e.kind === 'dmg' ? '−' : '+';
    const tag = e.kind === 'shield' ? ` <span class="tag">${t('shield')}</span>` : '';
    return `<div class="ev">
      <span class="evt">${num(dt, 1)} s</span>
      <span class="ab" data-spell="${e.abilityGameID}">${iconImg(a.icon, 18)}${esc(a.name)}${tag}</span>
      <span class="src">${esc(actorName(e.sourceID))}</span>
      <span class="amt ${kindCls}">${sign}${plain(amt)}${e.absorbed && e.kind === 'dmg' ? ` <small>(${plain(e.absorbed)} ${t('absorbed')})</small>` : ''}${e.overkill ? ` <small>${t('overkill', { v: plain(e.overkill) })}</small>` : ''}</span>
      <span class="hp">${hp != null ? `<span class="mbar hpb"><span style="width:${Math.max(0, Math.min(100, hp))}%"></span></span>${num(hp, 0)} %` : ''}</span>
    </div>`;
  }).join('');
  const top = dd.top.map((s) => `<span class="topsrc" data-spell="${s.abilityId}">${iconImg(ability(s.abilityId).icon, 18)}${esc(ability(s.abilityId).name)} <b>${plain(s.total)}</b> <small>×${s.hits}</small></span>`).join('');
  return `<details class="death ${isMe(p.name) ? 'me' : ''}">
    <summary>
      <span class="dnum">${i + 1}</span>
      <span class="dtime">${clock(dd.rel)}</span>
      <img class="spec-ic-sm" src="${p.icon && p.icon.includes('-') ? specIconUrl(esc(p.icon)) : classIconUrl(p.cls)}" width="24" height="24" alt="" style="--cc:${classColor(p.cls)}">
      <span class="name" style="color:${classColor(p.cls)}">${esc(p.name)}</span>
      <span class="grow"></span>
      <span class="kb">${t('killedBy')} <span class="sp" data-spell="${dd.abilityId}">${iconImg(ab.icon, 20)} <b>${esc(ab.name)}</b></span> <span class="muted">${t('from')} ${esc(killer)}</span>
        ${dd.blowAmount ? `<b class="neg">${plain(dd.blowAmount)}</b>` : ''}${dd.overkill ? ` <small class="muted">${t('overkill', { v: plain(dd.overkill) })}</small>` : ''}</span>
    </summary>
    <div class="dbody">
      <div class="dsum">${t('dmgInWindow', { s: winS, v: plain(dd.totalDmg) })} · ${t('healInWindow', { v: plain(dd.totalHeal) })}</div>
      ${top ? `<div class="dtop"><span class="muted">${t('topSources')}:</span> ${top}</div>` : ''}
      <div class="evs"><div class="ev th"><span></span><span>${t('ability')}</span><span></span><span>${t('amount')}</span><span>${t('hp')}</span></div>${timeline || `<div class="empty sm">${t('noData')}</div>`}</div>
    </div>
  </details>`;
}

// ============================================================ vista de jugador
async function viewPlayer(f, id) {
  const [fd, rk] = await Promise.all([fightData(f), rankings(f)]);
  const dmgEntry = fd.dmg.find((e) => e.id === id);
  const healEntry = fd.heal.find((e) => e.id === id);
  const p = playerInfo(id, dmgEntry || healEntry);
  const pd = await playerData(f, id);
  const dur = fightDur(f) / 1000;
  const color = classColor(p.cls);
  let dps = rk.dps.get(p.name);
  let hps = rk.hps.get(p.name);
  const est = !f.kill && f.full;
  if (est && f.encounterID) {
    const healer = HEALER_SPECS.has(p.spec);
    const entry = healer ? healEntry : dmgEntry;
    if (entry) {
      const m = await estimateParses(f, [{ ...p, total: entry.total }], healer ? 'hps' : 'dps');
      if (healer) hps = m.get(p.name); else dps = m.get(p.name);
    }
  }

  const stats = [
    dmgEntry ? `<div class="stat"><small>${t('tabs.damage')}</small><b>${big(dmgEntry.total)}</b><span>${plain(dmgEntry.total / dur)}${t('perSec')}</span>${dps != null ? parsePill(dps, est) : ''}</div>` : '',
    healEntry?.total ? `<div class="stat"><small>${t('tabs.healing')}</small><b>${big(healEntry.total)}</b><span>${plain(healEntry.total / dur)}${t('perSec')}</span>${hps != null ? parsePill(hps, est) : ''}</div>` : '',
    `<div class="stat"><small>${t('casts')}</small><b>${pd.casts.length}</b></div>`,
  ].join('');

  const ptabs = ['analyze', 'abilities', 'healing', 'rotation', 'buffs'].map((k) =>
    `<button class="tab ${S.ptab === k ? 'active' : ''}" data-action="ptab" data-tab="${k}">${t('ptabs.' + k)}</button>`).join('');

  let body = '';
  if (S.ptab === 'analyze') {
    S.post = (seq) => Analysis.mountPlayer(f, id, p, seq);
    body = `<div id="anRoot" class="an"><div class="loading"><span class="spinner"></span><span id="anProg">${t('loading')}</span></div></div>`;
  } else if (S.ptab === 'abilities') body = abilitiesTable(pd.abil, pd.casts, dur, color);
  else if (S.ptab === 'healing') body = abilitiesTable(pd.heal, pd.casts, dur, '#46c28e');
  else if (S.ptab === 'rotation') body = rotationHTML(f, pd.casts);
  else body = aurasTable(pd);

  return `<div class="hdr player-hdr">
      <div class="hdr-row"><button class="btn ghost" data-action="back">${t('back')}</button>
        <button class="btn primary an-btn" data-action="ptab" data-tab="analyze">✦ ${t('analyze')}</button></div>
      <div class="eyebrow">${eyebrow(f)}</div>
      <div class="phead">
        <img class="spec-ic lg" src="${specIconUrl(esc(p.icon))}" alt="">
        <div><h1 style="color:${color}">${esc(p.name)} ${isMe(p.name) ? `<span class="you">${t('you')}</span>` : ''}</h1></div>
        <div class="stats">${stats}</div>
      </div>
    </div>
    <nav class="tabs">${ptabs}</nav>${body}`;
}

function abilitiesTable(entries, casts, dur, color) {
  const rows = [...entries].filter((e) => e.total > 0).sort((a, b) => b.total - a.total);
  if (!rows.length) return `<div class="empty">${t('noData')}</div>`;
  const total = rows.reduce((s, e) => s + e.total, 0);
  const max = rows[0].total;
  const castCount = new Map();
  for (const c of casts) castCount.set(c.abilityGameID, (castCount.get(c.abilityGameID) || 0) + 1);
  return `<div class="table abil"><div class="tr th"><span>${t('ability')}</span><span>${t('amount')}</span><span class="r">${t('share')}</span><span class="r">${t('rate')}</span><span class="r">${t('casts')}</span><span class="r">${t('hits')}</span><span class="r">${t('crit')}</span></div>
    ${rows.map((e) => {
      const hits = (e.hitCount || 0) + (e.tickCount || 0);
      const crits = (e.critHitCount || 0) + (e.critTickCount || 0);
      const icon = e.abilityIcon || ability(e.guid).icon;
      return `<div class="tr"><span class="ab" data-spell="${e.guid}">${iconImg(icon, 22)}${esc(e.name)}</span>
        <span class="up"><span class="mbar"><span style="width:${(e.total / max) * 100}%;background:${color}"></span></span>${plain(e.total)}</span>
        <span class="r">${num((e.total / total) * 100, 1)} %</span>
        <span class="r">${plain(e.total / dur)}</span>
        <span class="r">${castCount.get(e.guid) || e.uses || ''}</span>
        <span class="r">${hits || ''}</span>
        <span class="r">${hits ? num((crits / hits) * 100, 1) + ' %' : ''}</span></div>`;
    }).join('')}</div>`;
}

function rotationHTML(f, casts) {
  if (!casts.length) return `<div class="empty">${t('noData')}</div>`;
  const dur = fightDur(f);
  const px = S.rotZoom;
  const width = Math.ceil((dur / 1000) * px) + 30;
  const x = (c) => ((c.timestamp - f.startTime) / 1000) * px;
  const step = px >= 20 ? 5 : px >= 10 ? 10 : px >= 5 ? 30 : 60;
  let ticks = '';
  for (let s = 0; s <= dur / 1000; s += step) ticks += `<span class="tick" style="left:${s * px}px">${clock(s * 1000 + f.startTime - f.fightStart)}</span>`;

  const controls = `<div class="rot-ctl">
      <button class="chip ${S.rotMode === 'lanes' ? 'on' : ''}" data-action="rotmode" data-mode="lanes">${t('lanes')}</button>
      <button class="chip ${S.rotMode === 'sequence' ? 'on' : ''}" data-action="rotmode" data-mode="sequence">${t('sequence')}</button>
      <span class="grow"></span><span class="muted">${t('totalCasts', { n: casts.length })}</span>
      ${S.rotMode === 'lanes' ? `<span class="muted">${t('zoom')}</span><button class="btn ghost sm" data-action="zoom" data-d="-1">−</button><button class="btn ghost sm" data-action="zoom" data-d="1">+</button>` : ''}
    </div>`;

  if (S.rotMode === 'sequence') {
    return controls + `<div class="seq">${casts.map((c) => {
      const a = ability(c.abilityGameID);
      return `<span class="seq-i">${iconImg(a.icon, 34, clockPrecise(c.timestamp - f.fightStart), c.abilityGameID)}<small>${clock(c.timestamp - f.fightStart)}</small></span>`;
    }).join('')}</div>`;
  }

  const byAbility = new Map();
  for (const c of casts) {
    if (!byAbility.has(c.abilityGameID)) byAbility.set(c.abilityGameID, []);
    byAbility.get(c.abilityGameID).push(c);
  }
  const lanes = [...byAbility.entries()].sort((a, b) => b[1].length - a[1].length);
  const labels = lanes.map(([id, list]) => {
    const a = ability(id);
    return `<div class="lane-label" data-spell="${id}">${iconImg(a.icon, 20)}<span>${esc(a.name)}</span><b>${list.length}</b></div>`;
  }).join('');
  const tracks = lanes.map(([id, list]) => {
    const a = ability(id);
    return `<div class="lane-track">${list.map((c) =>
      `<img class="ai cast" style="left:${x(c)}px" width="22" height="22" src="${abilityIconUrl(a.icon)}" data-spell="${id}" data-spell-extra="${clockPrecise(c.timestamp - f.fightStart)}" alt="">`).join('')}</div>`;
  }).join('');
  return controls + `<div class="rot">
    <div class="rot-labels"><div class="ruler-pad"></div>${labels}</div>
    <div class="rot-scroll"><div style="width:${width}px"><div class="ruler">${ticks}</div>${tracks}</div></div>
  </div>`;
}

// ============================================================ bienvenida, ajustes, utilidades
function renderWelcome() {
  sidebar.hidden = true;
  let recent = [];
  try { recent = JSON.parse(lsGet('recent') || '[]'); } catch { /* vacío */ }
  const exp = S.expansion || FALLBACK_EXPANSION;
  const img = `https://assets.rpglogs.com/img/warcraft/zones/zone-${exp.id}.png`;
  const feats = [
    ['featDamage', 'featDamageText', 'ability_warrior_bladestorm'],
    ['featReplay', 'featReplayText', 'inv_misc_pocketwatch_01'],
    ['featDeaths', 'featDeathsText', 'inv_misc_bone_humanskull_01'],
    ['featPhases', 'featPhasesText', 'inv_misc_spyglass_02'],
  ];
  main.innerHTML = `<div class="welcome">
    <section class="hero surface-dark">
      <div class="hero-glow" style="background-image:url(${img})"></div>
      <div class="hero-stars"></div>
      <div class="hero-in">
        <div class="hero-text">
          <div class="eyebrow">WIPETIME · ${t('heroTag')}</div>
          <h1 class="hero-title">${t('welcomeHello')}<br><span class="grad">WipeTime</span></h1>
          <p class="sub">${t('welcomeText')}</p>
          <form id="heroForm" class="hero-form">
            <input id="heroInput" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(t('urlPlaceholder'))}">
            <button class="btn primary" type="submit">${t('load')}</button>
          </form>
          <button class="btn ghost cmp-cta" data-cmp="open"><img class="wi" src="icons/spell_holy_crusade.jpg" width="18" height="18" alt=""> ${t('cmpOpen')}</button>
        </div>
        <div class="exp-card" id="expCard">
          <img class="exp-img" id="expImg" src="${img}" alt="${esc(exp.name)}">
          <div class="exp-info">
            <small>${t('expLabel')}</small>
            <b>${esc(exp.name)}</b>
            <span class="patch"><small>${t('patchLabel')}</small>${esc(currentPatch())}</span>
            ${typeof Patch115 !== 'undefined' ? Patch115.homeHTML() : ''}
            ${typeof Patch122 !== 'undefined' ? Patch122.homeHTML() : ''}
            ${typeof ClassChanges !== 'undefined' ? ClassChanges.homeHTML() : ''}
          </div>
          <small class="exp-hint" id="expHint"></small>
        </div>
      </div>
    </section>
    ${S.hasCreds ? '' : `<div class="notice">${t('noCreds')}</div>`}
    ${typeof Profile !== 'undefined' ? Profile.sectionHTML() : ''}
    <div class="feats">${feats.map(([h, p, icon]) => `<div class="feat">
      <span class="feat-ic"><img src="wcicon://i/${icon}" width="48" height="48" alt=""></span>
      <div><b>${t(h)}</b><span>${t(p)}</span></div></div>`).join('')}</div>
    ${recent.length ? `<h3 class="recent-h">${t('recent')}<button class="mini-btn" data-action="recent-clear">${LL('Borrar todos', 'Clear all')}</button></h3><div class="recent">${recent.map((r) =>
      `<div class="rwrap"><button class="rcard" data-action="recent" data-code="${esc(r.code)}"><b>${esc(r.title)}</b><small>${esc(zoneName(r.zone))} · ${new Date(r.date).toLocaleDateString(locale())}</small></button><button class="rdel" data-action="recent-del" data-code="${esc(r.code)}" title="${esc(LL('Quitar de la lista', 'Remove from list'))}" aria-label="${esc(LL('Quitar', 'Remove'))}">✕</button></div>`).join('')}</div>` : ''}
    <footer class="made-by">${t('madeBy')} <b>Drakko</b>
      <svg class="heart" viewBox="0 0 24 24" width="16" height="16" aria-label="love"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 2.8 4.5 6.3 4.5c2 0 3.6 1.1 4.4 2.6l1.3 2.2 1.3-2.2c.8-1.5 2.4-2.6 4.4-2.6 3.5 0 5.4 3.7 3.9 7.2C19.500 16.400 12 21 12 21z" fill="currentColor"/></svg>
    </footer>
  </div>`;
  setupPatchArt();
  if (typeof Patch115 !== 'undefined') Patch115.startTimer();
}

// Logo del parche en la tarjeta de la expansión: el que el usuario haya puesto (se guarda) o uno incluido en src/patch/
async function setupPatchArt() {
  const key = patchArtKey();
  const img = $('#expImg');
  const hint = $('#expHint');
  if (!img) return;
  let found = null;
  try { found = (await window.api.artGet(`patch-${key}`))?.dataUrl || null; } catch { /* sin imagen guardada */ }
  if (!found) {
    for (const ext of ['png', 'webp']) {
      found = await new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(`patch/${key}.${ext}`);
        probe.onerror = () => resolve(null);
        probe.src = `patch/${key}.${ext}`;
      });
      if (found) break;
    }
  }
  if (!$('#expImg')) return;
  if (found) {
    img.src = found;
    img.classList.add('art');
    $('#expCard')?.classList.add('has-art');
    if (hint) hint.textContent = '';
  } else if (hint) hint.textContent = t('patchDropHint');
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) { reject(new Error('BAD_TYPE')); return; }
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('BAD_TYPE'));
    r.readAsDataURL(file);
  });
}

async function savePatchArt(file) {
  try {
    const out = await window.api.artSave(`patch-${patchArtKey()}`, await readImageFile(file));
    if (out?.error) throw new Error(out.error);
    toast(t('patchSaved'));
    if (S.home && !S.cmpOpen) renderWelcome();
  } catch (e) { toast(t(e.message === 'TOO_BIG' ? 'mapErrBig' : 'mapErrType')); }
}

// Expansión actual: la más reciente que devuelve Warcraft Logs (viene ordenada de nueva a antigua)
async function loadExpansion() {
  try {
    const cached = JSON.parse(lsGet('expansion') || 'null');
    if (cached?.id != null) S.expansion = cached;
  } catch { /* sin caché */ }
  if (!S.hasCreds) return;
  try {
    const d = await gql('{worldData{expansions{id name}}}');
    const list = d.worldData?.expansions || [];
    const top = list.reduce((m, e) => (m == null || e.id > m.id ? e : m), null);
    if (top) {
      S.expansion = { id: top.id, name: top.name };
      lsSet('expansion', JSON.stringify(S.expansion));
    }
  } catch (e) { console.warn('expansion', e); }
}

const loadingHTML = () => `<div class="loading"><span class="spinner"></span>${t('loading')}</div>`;
const errorHTML = (msg) => `<div class="error"><b>${t('error')}</b><p>${esc(msg)}</p></div>`;

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

async function refreshConfig() {
  const cfg = await window.api.getConfig();
  S.hasCreds = !!cfg.bundled || !!(cfg.clientId && cfg.hasSecret);
  S.meDefault = cfg.me;
  if (!S.code) S.me = cfg.me;
}

// ---- "¿Qué personaje eres tú?" (se recuerda por reporte)
function askWhoAmI() {
  // solo los jugadores que participaron en este log (intentos de jefe; si no hay, cualquier intento)
  const fs = (S.report?.fights || []).filter((x) => x.encounterID > 0);
  const present = new Set((fs.length ? fs : S.report?.fights || []).flatMap((x) => x.friendlyPlayers || []));
  const players = [...S.actors.values()].filter((a) => a.type === 'Player' && (!present.size || present.has(a.id)))
    .map((a) => playerInfo(a.id))
    .sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name));
  const guess = players.find((p) => S.meDefault && p.name.toLocaleLowerCase() === S.meDefault.toLocaleLowerCase());
  const dlg = $('#whoami');
  dlg.innerHTML = `<h2>${t('whoTitle')}</h2>
    <p class="muted">${t('whoText')}</p>
    ${guess ? `<button class="pcard big ${S.me === guess.name ? 'me' : ''}" data-action="iam" data-name="${esc(guess.name)}" style="--cc:${classColor(guess.cls)}">
      <img class="spec-ic" src="${specIconUrl(esc(guess.icon))}" alt=""><span><b>${esc(guess.name)}</b><small>${t('whoGuess')}</small></span></button>` : ''}
    <div class="pgrid">${players.filter((p) => p !== guess).map((p) => `<button class="pcard" data-action="iam" data-name="${esc(p.name)}" style="--cc:${classColor(p.cls)}">
      <img class="spec-ic" src="${specIconUrl(esc(p.icon))}" alt=""><span><b>${esc(p.name)}</b></span></button>`).join('')}</div>
    <div class="dlg-actions"><span class="grow"></span><button class="btn ghost" data-action="iam" data-name="">${t('notInLog')}</button></div>`;
  if (!dlg.open) dlg.showModal();
}

function setMe(name) {
  S.me = name;
  window.api.setMe(S.code, name);
  $('#whoami').close();
  renderSidebar();
  render();
}

function applyStaticText() {
  document.documentElement.lang = S.lang;
  $('#urlInput').placeholder = t('urlPlaceholder');
  $('#loadBtn').textContent = t('load');
  $('#langLabel').textContent = t('langButton');
  renderLangList();
  $('#homeLabel').textContent = t('home');
  $('#cmpLabel').textContent = t('cmpOpen');
  $('#profLabel').textContent = tr('Personajes', 'Characters');
  $('#exportLabel').textContent = tr('Exportar', 'Export');
  $('#brandHome').title = t('home');
}

// ============================================================ eventos
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const id = el.dataset.id != null ? Number(el.dataset.id) : null;
  switch (a) {
    case 'debuff-mode':
      S.debuffMode = el.dataset.m;
      S.debuffId = null;
      render();
      break;
    case 'debuff-pick':
      S.debuffId = Number(el.dataset.id);
      render();
      break;
    case 'copy-summary': {
      if (!S.fight) break;
      try {
        const text = await pullSummaryText(S.fight);
        await navigator.clipboard.writeText(text);
        toast(LL('Resumen copiado: ya puedes pegarlo en Discord', 'Summary copied: you can paste it into Discord now'));
      } catch (e) { console.warn('summary', e); toast(LL('No se pudo copiar el resumen', 'Could not copy the summary')); }
      break;
    }
    case 'export-img':
      await exportRankedImage(el.dataset.m);
      break;
    case 'sort':
      S.sortMode = el.dataset.m;
      lsSet('sortMode', S.sortMode);
      render();
      break;
    case 'metric':
      S.dmgMetric = el.dataset.m;
      render();
      break;
    case 'pmode':
      S.parseMode = el.dataset.m;
      render();
      break;
    case 'refresh-report': {
      if (S.refreshing || !S.code) break;
      S.refreshing = true;
      renderSidebar();
      const before = S.fights.length;
      try {
        await loadReport(S.code, { keepView: true, fightId: S.fight?.id });
      } finally { S.refreshing = false; }
      renderSidebar();
      const added = S.fights.length - before;
      toast(added > 0 ? LL(`${added} pulls nuevos`, `${added} new pulls`) : LL('Sin pulls nuevos', 'No new pulls'));
      break;
    }
    case 'combine-toggle':
      S.combineMode = !S.combineMode;
      if (!S.combineMode) S.combine = [];
      else if (S.fight && !S.combine.length) S.combine = [S.fight.id];
      renderSidebar();
      render();
      break;
    case 'combine-clear':
      S.combineMode = false;
      S.combine = [];
      renderSidebar();
      render();
      break;
    case 'combine-all':
      S.combineMode = true;
      S.combine = S.fights.filter((x) => x.encounterID).map((x) => x.id);
      S.fight = S.fights.find((x) => x.id === S.combine[S.combine.length - 1]) || S.fight;
      renderSidebar();
      render();
      break;
    case 'combine-group':
      S.combineMode = true;
      S.combine = S.fights.filter((x) => x.groupKey === el.dataset.key).map((x) => x.id);
      S.fight = S.fights.find((x) => x.id === S.combine[S.combine.length - 1]);
      renderSidebar();
      render();
      break;
    case 'fight':
      if (S.combineMode) {
        const i = S.combine.indexOf(id);
        if (i >= 0) S.combine.splice(i, 1); else S.combine.push(id);
        S.fight = S.fights.find((f) => f.id === id) || S.fight;
        renderSidebar();
        render();
        break;
      }
      S.fight = S.fights.find((f) => f.id === id);
      carryRange(S.fight);
      renderSidebar();
      render();
      break;
    case 'range': {
      const f = S.fight;
      const ph = el.dataset.phase;
      if (ph === 'full') {
        S.range = null;
      } else {
        const seg = phaseSegments(f).find((s) => s.idx === Number(ph));
        if (seg) S.range = { fight: f.id, start: seg.start, end: seg.end, label: seg.name, phaseIdx: seg.idx };
      }
      render();
      break;
    }
    case 'whoami':
      askWhoAmI();
      break;
    case 'wipe-replay':
      S.tab = 'replay';
      S.replaySeek = Number(el.dataset.t);
      render();
      break;
    case 'iam':
      setMe(el.dataset.name);
      break;
    case 'tab':
      S.tab = el.dataset.tab;
      render();
      break;
    case 'ptab':
      S.ptab = el.dataset.tab;
      render();
      break;
    case 'player':
      S.player = id;
      S.ptab = el.dataset.ptab || (S.tab === 'healing' ? 'healing' : 'abilities');
      render();
      main.scrollTop = 0;
      break;
    case 'back':
      S.player = null;
      render();
      break;
    case 'enemy': {
      const ids = S.enemySel.ids;
      const i = ids.indexOf(id);
      if (i >= 0) ids.splice(i, 1); else ids.push(id);
      render();
      break;
    }
    case 'buffsPlayer':
      S.buffsPlayer = id;
      render();
      break;
    case 'rotmode':
      S.rotMode = el.dataset.mode;
      render();
      break;
    case 'zoom': {
      const levels = [2, 4, 8, 12, 20, 32];
      const cur = levels.indexOf(S.rotZoom);
      const next = levels[Math.max(0, Math.min(levels.length - 1, cur + Number(el.dataset.d)))];
      const sc = $('.rot-scroll');
      if (sc) S._rotScroll = (sc.scrollLeft / S.rotZoom) * next;
      S.rotZoom = next;
      render();
      break;
    }
    case 'recent-del': {
      let l = [];
      try { l = JSON.parse(lsGet('recent') || '[]'); } catch { /* vacío */ }
      lsSet('recent', JSON.stringify(l.filter((x) => x.code !== el.dataset.code)));
      renderWelcome();
      break;
    }
    case 'recent-clear':
      lsSet('recent', '[]');
      renderWelcome();
      break;
    case 'recent':
      loadReport(el.dataset.code);
      break;
    case 'settings':
      openSettings();
      break;
    case 'close':
      $('#settings').close();
      break;
  }
});

document.addEventListener('submit', async (ev) => {
  if (ev.target.id === 'loadForm') {
    ev.preventDefault();
    loadReport($('#urlInput').value);
  } else if (ev.target.id === 'rangeForm') {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const f = S.fight;
    const from = parseClock(fd.get('from'));
    const to = parseClock(fd.get('to'));
    if (from == null || to == null || to <= from || from >= fightDur(f)) return toast(t('badRange'));
    const end = Math.min(to, fightDur(f));
    S.range = { fight: f.id, start: f.startTime + from, end: f.startTime + end, label: '', relFrom: from, relTo: end };
    render();
  } else if (ev.target.id === 'heroForm') {
    ev.preventDefault();
    loadReport($('#heroInput').value);
  } else if (ev.target.id === 'settingsForm') {
    ev.preventDefault(); // los ajustes se guardan al momento; ya no hay credenciales que enviar
  }
});

$('#settingsBtn').addEventListener('click', () => openSettings());
$('#verBadge').addEventListener('click', () => openSettings('version'));

function goHome() {
  if (typeof Replay !== 'undefined') Replay.stop();
  S.seq++; // descarta cargas en curso
  S.home = true;
  S.cmpOpen = false;
  S.guildOpen = false;
  S.profileOpen = false;
  $('#whoami').open && $('#whoami').close();
  renderWelcome();
  main.scrollTop = 0;
}
$('#homeBtn').addEventListener('click', goHome);

// Botón de la barra superior resaltado según la sección abierta (al arrancar, Inicio)
function markNav() {
  const home = S.home && !S.cmpOpen && !S.guildOpen && !S.profileOpen && !!main.querySelector('.welcome');
  $('#homeBtn').classList.toggle('on', home);
  $('#cmpBtn').classList.toggle('on', !!S.cmpOpen);
  $('#guildBtn').classList.toggle('on', !!S.guildOpen && !S.cmpOpen);
  $('#profBtn').classList.toggle('on', !!main.querySelector('.charsearch') || (!!S.profileOpen && !S.cmpOpen && !S.guildOpen));
}
new MutationObserver(markNav).observe(main, { childList: true });

// Evitar que soltar un archivo sobre la ventana la navegue hacia él; la tarjeta del parche sí lo acepta
window.addEventListener('dragover', (ev) => ev.preventDefault());
window.addEventListener('drop', (ev) => ev.preventDefault());
document.addEventListener('drop', (ev) => {
  if (ev.target.closest?.('#expCard')) savePatchArt(ev.dataTransfer?.files?.[0]);
});
document.addEventListener('paste', (ev) => {
  if (!S.home || S.cmpOpen || /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
  const item = [...(ev.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) { ev.preventDefault(); savePatchArt(item.getAsFile()); }
});
// Personajes: pantalla propia solo con el buscador de personajes
function openCharSearch() {
  if (typeof Replay !== 'undefined') Replay.stop();
  S.seq++;
  S.home = false; S.cmpOpen = false; S.guildOpen = false; S.profileOpen = false;
  sidebar.hidden = true;
  $('#whoami').open && $('#whoami').close();
  main.innerHTML = `<div class="charsearch">${typeof Profile !== 'undefined' ? Profile.sectionHTML() : ''}</div>`;
  main.scrollTop = 0;
  const i = document.querySelector('#pfForm input[name="name"]'); if (i) i.focus();
}
$('#profBtn').addEventListener('click', openCharSearch);
$('#cmpBtn').addEventListener('click', () => { S.guildOpen = false; S.profileOpen = false; Compare.open(); });
$('#guildBtn').addEventListener('click', () => Guilds.open());
$('#brandHome').addEventListener('click', goHome);

// Menú «Idioma»: el idioma en uso va resaltado
function renderLangList() {
  $('#langList').innerHTML = LANGS.map((l) =>
    `<button type="button" role="menuitemradio" aria-checked="${l.code === S.lang}" class="lang-item ${l.code === S.lang ? 'on' : ''}" data-lang="${l.code}"><span class="lang-dot"></span>${l.name}</button>`).join('');
}
function toggleLangMenu(open) {
  const list = $('#langList');
  const show = open ?? list.hidden;
  list.hidden = !show;
  $('#langBtn').setAttribute('aria-expanded', String(show));
}
$('#langBtn').addEventListener('click', (ev) => { ev.stopPropagation(); toggleLangMenu(); });
$('#langList').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-lang]');
  if (!b) return;
  toggleLangMenu(false);
  setLang(b.dataset.lang);
});
document.addEventListener('click', (ev) => { if (!ev.target.closest('.lang-menu')) toggleLangMenu(false); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') toggleLangMenu(false); });

function setLang(code) {
  if (!LANGS.some((l) => l.code === code) || code === S.lang) return;
  S.lang = code;
  lsSet('lang', S.lang);
  applyStaticText();
  // Recarga para obtener nombres de habilidades y encuentros en el nuevo idioma
  if (S.profileOpen) Profile.render();
  else if (S.guildOpen) Guilds.render();
  else if (S.cmpOpen) Compare.render();
  else if (main.querySelector('.charsearch')) openCharSearch();
  else if (S.code && !S.home) loadReport(S.code, { keepView: true, fightId: S.fight?.id });
  else renderWelcome();
}

(async function init() {
  // El inicio usa partes de scripts que se cargan después de este (buscador de personajes, cuenta atrás del parche):
  // se espera a que estén todos para que al abrir salga directamente el inicio completo
  if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  applyStaticText();
  await refreshConfig();
  renderWelcome();
  const before = S.expansion?.id;
  await loadExpansion();
  if (!S.report && S.expansion?.id !== before) renderWelcome();
})();

// Enlaces wipetime://report/<código>?fight=<n>
function openDeepLink(link) {
  const m = String(link || '').match(/^wipetime:\/\/report\/([A-Za-z0-9]+)(?:\?fight=(\d+))?/i);
  if (m) loadReport(`https://www.warcraftlogs.com/reports/${m[1]}${m[2] ? `#fight=${m[2]}` : ''}`);
}
window.api.onDeepLink?.(openDeepLink);
window.api.takeDeepLink?.().then((l) => { if (l) setTimeout(() => openDeepLink(l), 600); });

document.addEventListener('change', (ev) => {
  const sel = ev.target.closest?.('select[data-shield-kind]');
  if (!sel) return;
  S.shieldKind = sel.value;
  render();
});

// ---- Tooltip de cada barra: daño (o sanación) por habilidad, como en Warcraft Logs
(() => {
  let tip = null;
  let iconByName = null;
  let iconSrc = null;
  const iconOf = (a) => {
    if (a.icon) return a.icon;
    if (iconSrc !== S.abilities) { iconSrc = S.abilities; iconByName = new Map([...S.abilities.values()].map((x) => [x.name, x.icon])); }
    return iconByName.get(a.name) || '';
  };
  const hide = () => { if (tip) tip.hidden = true; };
  document.addEventListener('mouseover', (ev) => {
    const row = ev.target.closest?.('.ranked .row[data-ri]');
    const r = row && S.lastRanked?.[Number(row.dataset.ri)];
    if (!r || !r.abil?.length) return hide();
    if (!tip) { tip = document.createElement('div'); tip.className = 'bartip surface-dark'; document.body.appendChild(tip); }
    const sum = r.abil.reduce((x, a) => x + a.total, 0) || 1;
    const color = r.segs?.[0]?.color || '#9aa3b2';
    const shown = r.abil.slice(0, 14);
    const more = r.abil.length - shown.length;
    tip.innerHTML = `<div class="bt-h" style="color:${color}"><b>${esc(r.name)}</b><span>${plain(sum)}</span></div>${shown.map((a) =>
      `<div class="bt-r"><span class="bt-n">${iconOf(a) ? iconImg(iconOf(a), 18) : '<i class="bt-i"></i>'}${esc(a.name)}</span><span class="bt-b"><i style="width:${(a.total / r.abil[0].total) * 100}%;background:${color}"></i></span><b>${plain(a.total)}</b><em>${num((a.total / sum) * 100, 1)}%</em></div>`).join('')}${more > 0 ? `<div class="bt-m">+ ${more} ${LL('más', 'more')}</div>` : ''}`;
    tip.hidden = false;
  });
  document.addEventListener('mousemove', (ev) => {
    if (!tip || tip.hidden) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + 16, y = ev.clientY + 16;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 16;
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
  document.addEventListener('mouseout', (ev) => { if (!ev.relatedTarget || !ev.relatedTarget.closest?.('.ranked')) hide(); });
  document.addEventListener('scroll', hide, true);
})();

