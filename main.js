const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, protocol, nativeImage } = require('electron');
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');

// Migración desde las versiones que se llamaban LogLens y WipeCraft: conserva credenciales, mapas, iconos y preferencias
(function migrateOldProfile() {
  const SKIP = /^(Cache|Code Cache|GPUCache|DawnCache|Network|Session Storage|blob_storage|Crashpad|Singleton.*|lockfile|Cookies.*|SharedStorage.*|Shared Dictionary|Service Worker)$/i;
  try {
    const newDir = app.getPath('userData');
    if (fs.existsSync(path.join(newDir, 'config.json'))) return;
    for (const old of ['Wipecraft', 'LogLens']) {
      const oldDir = path.join(app.getPath('appData'), old);
      if (oldDir.toLowerCase() === newDir.toLowerCase() || !fs.existsSync(path.join(oldDir, 'config.json'))) continue;
      fs.mkdirSync(newDir, { recursive: true });
      for (const name of fs.readdirSync(oldDir)) {
        if (SKIP.test(name)) continue;
        try { fs.cpSync(path.join(oldDir, name), path.join(newDir, name), { recursive: true }); } catch (e) { console.warn('migración', name, e.message); }
      }
      return;
    }
  } catch (e) { console.warn('migración', e); }
}());

const WCL = 'https://www.warcraftlogs.com';
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}
function encrypt(s) {
  if (!s) return '';
  return safeStorage.isEncryptionAvailable()
    ? 'enc:' + safeStorage.encryptString(s).toString('base64')
    : 'raw:' + s;
}
function decrypt(s) {
  if (!s) return '';
  try {
    if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
    return s.slice(4);
  } catch {
    return ''; // cifrado con otra clave: se trata como "sin secreto" y la app lo vuelve a pedir
  }
}

// ---- Credenciales incluidas en el programa (opcional): resources/secrets.json al empaquetar, build/secrets.json en desarrollo.
// Si existen, quien instala el programa no tiene que crear sus propias credenciales. Las propias, si las configura, tienen prioridad.
let bundledCache;
function bundled() {
  if (bundledCache !== undefined) return bundledCache;
  bundledCache = null;
  for (const p of [path.join(process.resourcesPath || '', 'secrets.json'), path.join(__dirname, 'build', 'secrets.json')]) {
    try { bundledCache = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch { /* no hay archivo */ }
  }
  return bundledCache;
}
const hasBundled = (k) => !!(bundled()?.[k]?.id && bundled()?.[k]?.secret);

// ---- Servidor intermedio (opcional): un Cloudflare Worker propio (carpeta server/) guarda las claves de Warcraft Logs y Blizzard;
// la app solo conoce su dirección, así que nadie que la instale puede extraer ninguna clave. Dirección en resources/proxy.json
// ({"url":"https://..."}), build/proxy.json en desarrollo, o "proxyUrl" en la configuración. Las claves propias del usuario tienen prioridad.
let proxyCache;
function proxyUrl() {
  if (proxyCache !== undefined) return proxyCache;
  proxyCache = null;
  try { const u = readConfig().proxyUrl; if (u) proxyCache = String(u).replace(/\/+$/, ''); } catch { /* sin config */ }
  if (!proxyCache) {
    for (const p of [path.join(process.resourcesPath || '', 'proxy.json'), path.join(__dirname, 'build', 'proxy.json')]) {
      try { const u = JSON.parse(fs.readFileSync(p, 'utf8')).url; if (/^https:\/\//.test(u)) { proxyCache = u.replace(/\/+$/, ''); break; } } catch { /* no hay archivo */ }
    }
  }
  return proxyCache;
}
const ownWcl = () => { const c = readConfig(); return !!(c.clientId && decrypt(c.clientSecret)); };
const useWclProxy = () => !ownWcl() && !hasBundled('wcl') && !!proxyUrl();

// ---- Warcraft Logs API (client credentials) ----
let token = null;
let tokenExpires = 0;

async function getToken() {
  if (token && Date.now() < tokenExpires - 60_000) return token;
  const cfg = readConfig();
  const own = !!(cfg.clientId && decrypt(cfg.clientSecret));
  const id = own ? cfg.clientId : bundled()?.wcl?.id;
  const secret = own ? decrypt(cfg.clientSecret) : bundled()?.wcl?.secret;
  if (!id || !secret) throw new Error('NO_CREDENTIALS');
  const res = await fetch(`${WCL}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`AUTH_FAILED:${res.status}`);
  const json = await res.json();
  token = json.access_token;
  tokenExpires = Date.now() + json.expires_in * 1000;
  return token;
}

// Idiomas de la app: subdominio de Warcraft Logs, locale de Wowhead y de Blizzard
const WCL_SUBDOMAIN = { es: 'es' };
const WOWHEAD_LOCALE = { es: 6, en: 0 };
const BNET_LOCALE = { es: 'es_ES', en: 'en_US' };

// The localized subdomain returns translated fight/ability names; fall back to www if it fails.
async function query(gql, variables, lang) {
  if (useWclProxy()) {
    const res = await fetch(`${proxyUrl()}/wcl`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: gql, variables, lang }) });
    if (res.status === 429) throw new Error('RATE_LIMIT');
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return res.json();
  }
  const bearer = await getToken();
  const sub = WCL_SUBDOMAIN[lang];
  const hosts = sub ? [`https://${sub}.warcraftlogs.com`, WCL] : [WCL];
  let lastError;
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/api/v2/client`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: gql, variables }),
      });
      if (res.status === 401) { token = null; throw new Error('AUTH_FAILED:401'); }
      if (res.status === 429) throw new Error('RATE_LIMIT');
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      return await res.json();
    } catch (e) {
      lastError = e;
      if (/AUTH_FAILED|RATE_LIMIT/.test(e.message)) break;
    }
  }
  throw lastError;
}

// Caché en disco (comprimida) de las respuestas de Warcraft Logs: reabrir un log, una pestaña o un replay no vuelve a pedir nada.
// Duración: 7 días para tablas/eventos/gráficas de logs terminados, 12 h para rankings, 5 min para la cabecera del reporte
// y nada si la app marca el log como "en directo" (terminó hace menos de 3 h).
const qcacheDir = () => path.join(app.getPath('userData'), 'qcache');
const QCACHE_MAX = 500 * 1024 * 1024;
let qcacheWrites = 0;
function qcacheTtl(gql) {
  if (/rateLimitData/.test(gql)) return 0;
    if (/reportData/.test(gql)) return 0; // todo lo de un informe (parses, intentos, kills) siempre en vivo desde Warcraft Logs
  if (/fights\s*\{\s*id name/.test(gql)) return 5 * 60 * 1000;
  if (/rankings|zoneRanking|guildData|characterData/.test(gql)) return 12 * 3600 * 1000;
  if (/worldData/.test(gql)) return 3600 * 1000; // zonas y jefes de la raid: pueden cambiar con un parche, no se guardan una semana
  return 7 * 24 * 3600 * 1000;
}
function qcachePrune() {
  try {
    const files = fs.readdirSync(qcacheDir()).map((f) => { const p = path.join(qcacheDir(), f); const s = fs.statSync(p); return { p, t: s.mtimeMs, size: s.size }; });
    let total = 0;
    for (const f of files) { if (Date.now() - f.t > 7 * 24 * 3600 * 1000) fs.rmSync(f.p, { force: true }); else total += f.size; }
    if (total > QCACHE_MAX) {
      for (const f of files.sort((a, b) => a.t - b.t)) { if (!fs.existsSync(f.p)) continue; fs.rmSync(f.p, { force: true }); total -= f.size; if (total <= QCACHE_MAX * 0.8) break; }
    }
  } catch { /* sin caché */ }
}
const inflightQ = new Map();
ipcMain.handle('wcl:query', async (_e, gql, variables, lang, noCache) => {
  try {
    const ttl = noCache ? 0 : qcacheTtl(gql);
    if (!ttl) return await query(gql, variables, lang);
    const key = require('crypto').createHash('sha1').update(JSON.stringify([gql, variables, WCL_SUBDOMAIN[lang] ? lang : 'en', useWclProxy() ? 'p' : 'd'])).digest('hex');
    const file = path.join(qcacheDir(), key + '.json.gz');
    try {
      const st = fs.statSync(file);
      if (Date.now() - st.mtimeMs < ttl) return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    } catch { /* no está en caché */ }
    if (!inflightQ.has(key)) {
      inflightQ.set(key, query(gql, variables, lang).then((res) => {
        if (res && res.data && !res.errors) {
          try {
            fs.mkdirSync(qcacheDir(), { recursive: true });
            fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(res)), { level: 3 }));
            if (++qcacheWrites % 150 === 0) qcachePrune();
          } catch { /* disco lleno o sin permisos */ }
        }
        return res;
      }).finally(() => inflightQ.delete(key)));
    }
    return await inflightQ.get(key);
  } catch (e) { return { error: e.message }; }
});
app.whenReady().then(() => setTimeout(qcachePrune, 15000));

ipcMain.handle('qcache:clear', () => {
  let n = 0;
  try { for (const f of fs.readdirSync(qcacheDir())) { fs.rmSync(path.join(qcacheDir(), f), { force: true }); n++; } } catch { /* vacío */ }
  return n;
});

ipcMain.handle('config:get', () => {
  const cfg = readConfig();
  return { clientId: cfg.clientId || '', hasSecret: !!decrypt(cfg.clientSecret), bundled: hasBundled('wcl') || !!proxyUrl(), me: cfg.me || '', hdIcons: cfg.hdIcons !== false };
});

ipcMain.handle('config:set', (_e, { clientId, clientSecret, me }) => {
  const cfg = readConfig();
  if (clientId !== undefined) cfg.clientId = clientId.trim();
  if (clientSecret) cfg.clientSecret = encrypt(clientSecret.trim());
  if (me !== undefined) cfg.me = me.trim();
  writeConfig(cfg);
  token = null;
  return true;
});

// Personaje elegido por reporte (null = aún no preguntado, '' = "no estoy en el log")
ipcMain.handle('me:get', (_e, code) => {
  const v = readConfig().meByReport?.[code];
  return v === undefined ? null : v;
});

ipcMain.handle('me:set', (_e, code, name) => {
  const cfg = readConfig();
  cfg.meByReport = { ...(cfg.meByReport || {}), [code]: name };
  writeConfig(cfg);
  return true;
});

// ---- Imágenes de mapa de boss (las pone el usuario) + calibración guardada
const MAP_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAP_MAX_BYTES = 25 * 1024 * 1024;
const mapsDir = () => path.join(app.getPath('userData'), 'maps');
const mapKeyOk = (k) => typeof k === 'string' && /^\d+-\d+$/.test(k);

function findMapFile(key) {
  for (const ext of Object.keys(MAP_MIME)) {
    const file = path.join(mapsDir(), key + ext);
    if (fs.existsSync(file)) return { file, ext };
  }
  return null;
}

function readCalib(key) {
  try { return JSON.parse(fs.readFileSync(path.join(mapsDir(), key + '.json'), 'utf8')); } catch { return null; }
}

function cleanCalib(c) {
  const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  return {
    zoom: n(c?.zoom, 0.2, 4, 1), dx: n(c?.dx, -200, 200, 0), dy: n(c?.dy, -200, 200, 0),
    rot: Math.round(n(c?.rot, 0, 3, 0)), flipH: !!c?.flipH, flipV: !!c?.flipV, opacity: n(c?.opacity, 0.1, 1, 0.9),
  };
}

function mapPayload(key) {
  const f = findMapFile(key);
  if (!f) return null;
  const data = fs.readFileSync(f.file);
  return { dataUrl: `data:${MAP_MIME[f.ext]};base64,${data.toString('base64')}`, calib: readCalib(key) };
}

ipcMain.handle('map:get', (_e, key) => (mapKeyOk(key) ? mapPayload(key) : null));

ipcMain.handle('map:pick', async (e, key) => {
  if (!mapKeyOk(key)) return { error: 'BAD_KEY' };
  const win = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  const src = res.filePaths[0];
  const ext = path.extname(src).toLowerCase();
  if (!MAP_MIME[ext]) return { error: 'BAD_TYPE' };
  if (fs.statSync(src).size > MAP_MAX_BYTES) return { error: 'TOO_BIG' };
  fs.mkdirSync(mapsDir(), { recursive: true });
  for (const x of Object.keys(MAP_MIME)) fs.rmSync(path.join(mapsDir(), key + x), { force: true });
  fs.copyFileSync(src, path.join(mapsDir(), key + ext));
  return mapPayload(key);
});

ipcMain.handle('map:calib', (_e, key, calib) => {
  if (!mapKeyOk(key)) return false;
  fs.mkdirSync(mapsDir(), { recursive: true });
  fs.writeFileSync(path.join(mapsDir(), key + '.json'), JSON.stringify(cleanCalib(calib)));
  return true;
});

ipcMain.handle('map:remove', (_e, key) => {
  if (!mapKeyOk(key)) return false;
  for (const x of [...Object.keys(MAP_MIME), '.json']) fs.rmSync(path.join(mapsDir(), key + x), { force: true });
  return true;
});

// Guardado de imágenes pegadas o arrastradas (mapa de un boss y arte del parche)
function parseImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAP_MAX_BYTES * 1.4) return null;
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const type = { 'data:image/png;base64': '.png', 'data:image/jpeg;base64': '.jpg', 'data:image/webp;base64': '.webp' }[head];
  if (!type || comma < 0) return null;
  const buf = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  return buf.length && buf.length <= MAP_MAX_BYTES ? { ext: type, buf } : null;
}

ipcMain.handle('map:savedata', (_e, key, dataUrl) => {
  if (!mapKeyOk(key)) return { error: 'BAD_KEY' };
  const img = parseImageDataUrl(dataUrl);
  if (!img) return { error: 'BAD_TYPE' };
  fs.mkdirSync(mapsDir(), { recursive: true });
  for (const x of Object.keys(MAP_MIME)) fs.rmSync(path.join(mapsDir(), key + x), { force: true });
  fs.writeFileSync(path.join(mapsDir(), key + img.ext), img.buf);
  return mapPayload(key);
});

const artDir = () => path.join(app.getPath('userData'), 'art');
const artKeyOk = (k) => typeof k === 'string' && /^[a-z0-9.\-]{1,40}$/.test(k);

ipcMain.handle('art:get', (_e, key) => {
  if (!artKeyOk(key)) return null;
  for (const ext of Object.keys(MAP_MIME)) {
    const file = path.join(artDir(), key + ext);
    if (fs.existsSync(file)) return { dataUrl: `data:${MAP_MIME[ext]};base64,${fs.readFileSync(file).toString('base64')}` };
  }
  return null;
});

ipcMain.handle('art:save', (_e, key, dataUrl) => {
  if (!artKeyOk(key)) return { error: 'BAD_KEY' };
  const img = parseImageDataUrl(dataUrl);
  if (!img) return { error: 'BAD_TYPE' };
  fs.mkdirSync(artDir(), { recursive: true });
  for (const x of Object.keys(MAP_MIME)) fs.rmSync(path.join(artDir(), key + x), { force: true });
  fs.writeFileSync(path.join(artDir(), key + img.ext), img.buf);
  return { ok: true };
});

// ---- Iconos HD (Clean Icons - Mechagnome Edition, TGA 128x128).
// No se incluyen en el programa: se leen bajo demanda del zip publicado en GitHub con peticiones por rango
// (solo los iconos que se usan), se convierten a PNG y se guardan en la carpeta de datos del usuario.
protocol.registerSchemesAsPrivileged([
  { scheme: 'wcicon', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'wcmap', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'wcmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const PACK_URL = 'https://github.com/AcidWeb/Clean-Icons-Mechagnome-Edition/releases/download/12.1.0.69299-V5-1/CleanIcons-MechagnomeEdition-12.1.0.69299-V5-1.zip';
const iconDir = () => path.join(app.getPath('userData'), 'icons-hd');
const WCL_ABILITY_CDN = 'https://assets.rpglogs.com/img/warcraft/abilities/';
const WCL_SPEC_CDN = 'https://assets.rpglogs.com/img/warcraft/icons/';

// Iconos de especialización (los de la interfaz de talentos); si alguno no existe en el paquete se usa el de WCL
const SPEC_ICONS = {
  'DeathKnight-Blood': ['spell_deathknight_bloodpresence'], 'DeathKnight-Frost': ['spell_deathknight_frostpresence'], 'DeathKnight-Unholy': ['spell_deathknight_unholypresence'],
  'DemonHunter-Havoc': ['ability_demonhunter_specdps'], 'DemonHunter-Vengeance': ['ability_demonhunter_spectank'], 'DemonHunter-Devourer': ['classicon_demonhunter_void_256', 'classicon_demonhunter_void'],
  'Druid-Balance': ['spell_nature_starfall'], 'Druid-Feral': ['ability_druid_catform'], 'Druid-Guardian': ['ability_racial_bearform'], 'Druid-Restoration': ['spell_nature_healingtouch'],
  'Evoker-Devastation': ['classicon_evoker_devastation'], 'Evoker-Preservation': ['classicon_evoker_preservation'], 'Evoker-Augmentation': ['classicon_evoker_augmentation'],
  'Hunter-BeastMastery': ['ability_hunter_bestialdiscipline'], 'Hunter-Marksmanship': ['ability_hunter_focusedaim'], 'Hunter-Survival': ['ability_hunter_camouflage'],
  'Mage-Arcane': ['spell_holy_magicalsentry'], 'Mage-Fire': ['spell_fire_firebolt02'], 'Mage-Frost': ['spell_frost_frostbolt02'],
  'Monk-Brewmaster': ['spell_monk_brewmaster_spec'], 'Monk-Mistweaver': ['spell_monk_mistweaver_spec'], 'Monk-Windwalker': ['spell_monk_windwalker_spec'],
  'Paladin-Holy': ['spell_holy_holybolt'], 'Paladin-Protection': ['ability_paladin_shieldofthetemplar'], 'Paladin-Retribution': ['spell_holy_auraoflight'],
  'Priest-Discipline': ['spell_holy_powerwordshield'], 'Priest-Holy': ['spell_holy_guardianspirit'], 'Priest-Shadow': ['spell_shadow_shadowwordpain'],
  'Rogue-Assassination': ['ability_rogue_eviscerate'], 'Rogue-Outlaw': ['inv_sword_30'], 'Rogue-Subtlety': ['ability_stealth'],
  'Shaman-Elemental': ['spell_nature_lightning'], 'Shaman-Enhancement': ['spell_shaman_improvedstormstrike'], 'Shaman-Restoration': ['spell_nature_magicimmunity'],
  'Warlock-Affliction': ['spell_shadow_deathcoil'], 'Warlock-Demonology': ['spell_shadow_metamorphosis'], 'Warlock-Destruction': ['spell_shadow_rainoffire'],
  'Warrior-Arms': ['ability_warrior_savageblow'], 'Warrior-Fury': ['ability_warrior_innerrage'], 'Warrior-Protection': ['ability_warrior_defensivestance'],
};

let packIndex = null;
let packIndexPromise = null;
let packRedirect = { url: null, at: 0 };
let netSlots = 0;
const netWaiters = [];
const inflight = new Map();

async function withNetSlot(fn) { // máximo 6 descargas a la vez
  while (netSlots >= 6) await new Promise((r) => netWaiters.push(r));
  netSlots++;
  try { return await fn(); } finally { netSlots--; netWaiters.shift()?.(); }
}

async function packUrl(force) {
  if (!force && packRedirect.url && Date.now() - packRedirect.at < 3 * 60 * 1000) return packRedirect.url;
  const r = await fetch(PACK_URL, { redirect: 'manual', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) });
  packRedirect = { url: r.headers.get('location') || PACK_URL, at: Date.now() };
  return packRedirect.url;
}

async function packRange(from, to) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(await packUrl(attempt > 0), { headers: { Range: `bytes=${from}-${to}` }, signal: AbortSignal.timeout(20000) });
    if (res.status === 206) return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('RANGE_FAILED');
}

// Directorio central del zip (zip64): [nombre_en_minúsculas, offset, tamaño_comprimido, método, largo_del_nombre]
async function readZipIndex() {
  const head = await fetch(await packUrl(true), { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) });
  const total = Number(head.headers.get('content-range').split('/')[1]);
  const tail = await packRange(total - 262144, total - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('ZIP_EOCD');
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOff = tail.readUInt32LE(eocd + 16);
  const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
  if (loc >= 0) {
    const z64 = Number(tail.readBigUInt64LE(loc + 8));
    const z = await packRange(z64, z64 + 55);
    cdSize = Number(z.readBigUInt64LE(40));
    cdOff = Number(z.readBigUInt64LE(48));
  }
  const parts = [];
  for (let o = 0; o < cdSize; o += 8 * 1024 * 1024) parts.push(await packRange(cdOff + o, cdOff + Math.min(o + 8 * 1024 * 1024, cdSize) - 1));
  const cd = Buffer.concat(parts);
  const out = [];
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
    const method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20);
    const nlen = cd.readUInt16LE(p + 28);
    const xlen = cd.readUInt16LE(p + 30);
    const clen = cd.readUInt16LE(p + 32);
    let lho = cd.readUInt32LE(p + 42);
    const name = cd.slice(p + 46, p + 46 + nlen).toString('utf8');
    for (let xp = p + 46 + nlen, xend = xp + xlen; xp + 4 <= xend; xp += 4 + cd.readUInt16LE(xp + 2)) {
      if (cd.readUInt16LE(xp) === 1) {
        let q = xp + 4;
        if (cd.readUInt32LE(p + 24) === 0xffffffff) q += 8;
        if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (lho === 0xffffffff) lho = Number(cd.readBigUInt64LE(q));
      }
    }
    if (/^icons\/.+\.tga$/i.test(name)) out.push([name.slice(6, -4).toLowerCase(), lho, csize, method, nlen]);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

function loadPackIndex() {
  if (packIndex) return Promise.resolve(packIndex);
  if (!packIndexPromise) {
    packIndexPromise = (async () => {
      const file = path.join(iconDir(), 'index.v1.json');
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (saved.url === PACK_URL && saved.entries?.length) { packIndex = new Map(saved.entries.map((e) => [e[0], e])); return packIndex; }
      } catch { /* se descarga el índice */ }
      const entries = await readZipIndex();
      fs.mkdirSync(iconDir(), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ url: PACK_URL, entries }));
      packIndex = new Map(entries.map((e) => [e[0], e]));
      return packIndex;
    })().catch((e) => { packIndexPromise = null; throw e; });
  }
  return packIndexPromise;
}

function tgaToPng(tga) {
  const idLen = tga[0];
  const type = tga[2];
  const w = tga.readUInt16LE(12);
  const h = tga.readUInt16LE(14);
  const bpp = tga[16];
  const topLeft = !!(tga[17] & 0x20);
  if (tga[1] !== 0 || type !== 2 || (bpp !== 32 && bpp !== 24)) throw new Error('TGA_UNSUPPORTED');
  const bytes = bpp / 8;
  const off = 18 + idLen;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = topLeft ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      const s = off + (sy * w + x) * bytes;
      const d = (y * w + x) * 4;
      const a = bytes === 4 ? tga[s + 3] : 255;
      out[d] = Math.round((tga[s] * a) / 255);
      out[d + 1] = Math.round((tga[s + 1] * a) / 255);
      out[d + 2] = Math.round((tga[s + 2] * a) / 255);
      out[d + 3] = a;
    }
  }
  return nativeImage.createFromBitmap(out, { width: w, height: h }).toPNG();
}

async function fetchFromPack(entry) {
  const [, lho, csize, method, nlen] = entry;
  const want = 30 + nlen + 160 + csize;
  let buf = await packRange(lho, lho + want - 1);
  const dataStart = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  if (dataStart + csize > buf.length) buf = await packRange(lho, lho + dataStart + csize - 1);
  const raw = buf.slice(dataStart, dataStart + csize);
  return method === 8 ? zlib.inflateRawSync(raw) : raw;
}

const aliasesOf = (name) => [name, name.replace(/^inv_(\d+)_/, 'inv$1_'), name.replace(/^inv(\d+)_/, 'inv_$1_')];
const safeFile = (name) => name.replace(/[^a-z0-9_.\-]/g, '_').slice(0, 120);

// Warcraft Logs sirve los iconos desde Cloudflare, que en España se bloquea a ratos (fútbol): si falla se prueban
// los de Wowhead y los de Blizzard, que no pasan por Cloudflare.
async function fetchCdn(urls, cacheFile) {
  let lastErr;
  for (const url of [].concat(urls)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error('CDN_' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) throw new Error('CDN_EMPTY');
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, buf);
      return { buf, type: 'image/jpeg' };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('CDN_NONE');
}
const mirrors = (name) => name ? [`https://wow.zamimg.com/images/wow/icons/large/${name}.jpg`, `https://render.worldofwarcraft.com/us/icons/56/${name}.jpg`] : [];

async function resolveIcon(name) {
  const bundled = path.join(__dirname, 'src', 'icons', safeFile(name) + '.jpg');
  if (fs.existsSync(bundled)) return { buf: fs.readFileSync(bundled), type: 'image/jpeg' };
  const hd = readConfig().hdIcons !== false;
  const png = path.join(iconDir(), safeFile(name) + '.png');
  const cdn = path.join(iconDir(), safeFile(name) + '.cdn.jpg');
  if (hd && fs.existsSync(png)) return { buf: fs.readFileSync(png), type: 'image/png' };
  if (fs.existsSync(cdn)) return { buf: fs.readFileSync(cdn), type: 'image/jpeg' };

  const isSpec = name.startsWith('spec-');
  const isClass = name.startsWith('class-');
  let candidates;
  let cdnUrl;
  if (isClass) {
    const cls = name.slice(6).replace(/[^a-z]/g, '');
    candidates = [`classicon_${cls}`, `classicon_${cls}_256`, `classicon_${cls}_64`];
    // el CDN distingue mayúsculas: Priest.jpg, DeathKnight.jpg, DemonHunter.jpg (en minúsculas devuelve 403)
    const proper = { deathknight: 'DeathKnight', demonhunter: 'DemonHunter' }[cls] || (cls.charAt(0).toUpperCase() + cls.slice(1));
    cdnUrl = [`https://assets.rpglogs.com/img/warcraft/icons/${proper}.jpg`];
  } else if (isSpec) {
    const specKey = Object.keys(SPEC_ICONS).find((k) => k.toLowerCase() === name.slice(5));
    candidates = specKey ? SPEC_ICONS[specKey] : [];
    cdnUrl = [`${WCL_SPEC_CDN}${specKey || name.slice(5)}.jpg`, ...mirrors(candidates.find((c) => !c.startsWith('classicon_')))];
  } else {
    candidates = aliasesOf(name);
    cdnUrl = [`${WCL_ABILITY_CDN}${name}.jpg`, ...mirrors(name)];
  }
  try {
    const index = hd ? await loadPackIndex() : new Map();
    for (const c of candidates) {
      const entry = index.get(c);
      if (!entry) continue;
      const pngBuf = tgaToPng(await withNetSlot(() => fetchFromPack(entry)));
      fs.mkdirSync(iconDir(), { recursive: true });
      fs.writeFileSync(png, pngBuf);
      return { buf: pngBuf, type: 'image/png' };
    }
  } catch (e) { console.warn('icono HD', name, e.message); }
  return withNetSlot(() => fetchCdn(cdnUrl, cdn));
}

function registerIconProtocol() {
  protocol.handle('wcicon', async (req) => {
    try {
      const name = decodeURIComponent(new URL(req.url).pathname.slice(1)).toLowerCase().replace(/\.(jpg|png|tga|blp)$/, '');
      if (!/^[a-z0-9_\-+. ']{1,120}$/.test(name)) return new Response('bad', { status: 400 });
      if (!inflight.has(name)) inflight.set(name, resolveIcon(name).finally(() => inflight.delete(name)));
      const { buf, type } = await inflight.get(name);
      return new Response(buf, { headers: { 'content-type': type, 'cache-control': 'max-age=86400' } });
    } catch { return new Response('not found', { status: 404 }); }
  });
}

// Preferencias que necesita el proceso principal, caché de iconos y utilidades de ajustes
ipcMain.handle('app:info', () => ({ electron: process.versions.electron, chrome: process.versions.chrome, version: app.getVersion() }));

ipcMain.handle('pref:set', (_e, key, value) => {
  if (key !== 'hdIcons') return false;
  const cfg = readConfig();
  cfg.hdIcons = !!value;
  writeConfig(cfg);
  return true;
});

ipcMain.handle('icons:clear', () => {
  let n = 0;
  try {
    for (const f of fs.readdirSync(iconDir())) {
      if (f === 'index.v1.json') continue;
      fs.rmSync(path.join(iconDir(), f), { force: true });
      n++;
    }
  } catch { /* sin caché */ }
  return n;
});

ipcMain.handle('app:opendata', () => shell.openPath(app.getPath('userData')));

// ---- Mapas de jefes (RaidPlan.io): se descargan bajo demanda a la carpeta de datos del usuario; no van en el instalador.
const BOSSMAP_CDN = 'https://cdn.raidplan.io/';
const bossMapDir = () => path.join(app.getPath('userData'), 'bossmaps');
let bossMapPaths = null;
function bossMapAllowed() {
  if (!bossMapPaths) {
    try { bossMapPaths = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'bossmaps.json'), 'utf8')).map((e) => e.path)); } catch { bossMapPaths = new Set(); }
  }
  return bossMapPaths;
}
const bossMapInflight = new Map();

async function resolveBossMap(rel) {
  if (!bossMapAllowed().has(rel)) throw new Error('NOT_ALLOWED'); // solo rutas del catálogo
  const file = path.join(bossMapDir(), rel.split('/').pop());
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const res = await fetch(BOSSMAP_CDN + rel, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WipeTime' } });
  if (!res.ok) throw new Error('HTTP_' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(bossMapDir(), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf;
}

function registerBossMapProtocol() {
  protocol.handle('wcmap', async (req) => {
    try {
      const rel = decodeURIComponent(new URL(req.url).pathname.slice(1));
      if (!bossMapInflight.has(rel)) bossMapInflight.set(rel, resolveBossMap(rel).finally(() => bossMapInflight.delete(rel)));
      const buf = await bossMapInflight.get(rel);
      return new Response(buf, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400', 'access-control-allow-origin': '*' } });
    } catch { return new Response('not found', { status: 404 }); }
  });
}

// ---- Imágenes de personajes y escudos de guild (solo del CDN de Blizzard), con caché de 7 días en disco
const mediaDir = () => path.join(app.getPath('userData'), 'media');
function registerMediaProtocol() {
  protocol.handle('wcmedia', async (req) => {
    try {
      const url = decodeURIComponent(new URL(req.url).pathname.slice(1));
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.hostname !== 'render.worldofwarcraft.com') return new Response('forbidden', { status: 403 });
      const file = path.join(mediaDir(), require('crypto').createHash('sha1').update(url).digest('hex') + path.extname(u.pathname));
      let buf;
      if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 7 * 24 * 3600 * 1000) buf = fs.readFileSync(file);
      else {
        const r = await fetch(url);
        if (!r.ok) return new Response('not found', { status: 404 });
        buf = Buffer.from(await r.arrayBuffer());
        fs.mkdirSync(mediaDir(), { recursive: true });
        fs.writeFileSync(file, buf);
      }
      return new Response(buf, { headers: { 'content-type': file.endsWith('.png') ? 'image/png' : 'image/jpeg', 'cache-control': 'max-age=86400', 'access-control-allow-origin': '*' } });
    } catch { return new Response('not found', { status: 404 }); }
  });
}

ipcMain.handle('bossmaps:clear', () => {
  let n = 0;
  try { for (const f of fs.readdirSync(bossMapDir())) { fs.rmSync(path.join(bossMapDir(), f), { force: true }); n++; } } catch { /* sin mapas */ }
  return n;
});

// ---- Descripciones de habilidades (tooltips públicos de Wowhead), con caché en disco de 30 días
const spellDir = () => path.join(app.getPath('userData'), 'spells');
ipcMain.handle('spell:tip', async (_e, id, lang) => {
  id = Number(id);
  if (!Number.isInteger(id) || id < 1 || id > 99999999) return { error: 'BAD_ID' };
  const loc = WOWHEAD_LOCALE[lang] ?? 0;
  const file = path.join(spellDir(), `${loc}-${id}.json`);
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < 30 * 24 * 3600 * 1000) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* sin caché */ }
  try {
    const res = await fetch(`https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=${loc}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WipeTime', accept: 'application/json' },
    });
    if (!res.ok) return { error: 'HTTP_' + res.status };
    const j = await res.json();
    const out = { name: j.name || '', icon: j.icon || '', tooltip: j.tooltip || '', buff: j.buff || '' };
    fs.mkdirSync(spellDir(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out));
    return out;
  } catch (e) { return { error: String(e.message || e) }; }
});

// ---- Mapa de talentos (id de entrada de WCL -> nombre, icono y hechizo), de los datos públicos de Raidbots; caché de 7 días
let talentMapMem = null;
ipcMain.handle('talents:map', async () => {
  if (talentMapMem) return talentMapMem;
  const file = path.join(app.getPath('userData'), 'talents-map.json');
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < 7 * 24 * 3600 * 1000) { talentMapMem = JSON.parse(fs.readFileSync(file, 'utf8')); return talentMapMem; }
  } catch { /* sin caché */ }
  try {
    const res = await fetch('https://www.raidbots.com/static/data/live/talents.json', { headers: { 'user-agent': 'WipeTime' } });
    if (!res.ok) throw new Error('HTTP_' + res.status);
    const j = await res.json();
    const map = {};
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o.entries)) for (const e of o.entries) if (e && e.id && e.name) map[e.id] = [e.name, e.icon || '', e.spellId || 0];
      for (const k in o) walk(o[k]);
    };
    walk(j);
    fs.writeFileSync(file, JSON.stringify(map));
    talentMapMem = map;
    return map;
  } catch (err) {
    try { talentMapMem = JSON.parse(fs.readFileSync(file, 'utf8')); return talentMapMem; } catch { return {}; }
  }
});

ipcMain.handle('spells:clear', () => {
  let n = 0;
  try { for (const f of fs.readdirSync(spellDir())) { fs.rmSync(path.join(spellDir(), f), { force: true }); n++; } } catch { /* sin caché */ }
  return n;
});

// ---- Actualizaciones: fuente = "usuario/repositorio" de GitHub (Releases) o la URL de un latest.json
//      latest.json: { "version": "1.7.0", "notes": "...", "setup": "https://.../Setup.exe", "portable": "https://.../app.exe", "sha256": "..." }
const semver = (v) => String(v || '').replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
function cmpVer(a, b) {
  const x = semver(a);
  const y = semver(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; }
  return 0;
}
let pendingUpdate = null;

async function fetchManifest(source) {
  source = String(source || '').trim();
  if (!source) throw new Error('NO_SOURCE');
  const headers = { 'user-agent': 'WipeTime-updater', accept: 'application/json' };
  if (/^[\w.-]+\/[\w.-]+$/.test(source)) {
    // Primero latest.json de la última release (descarga normal de github.com, sin el límite de 60 consultas/hora de la API)
    try {
      const r = await fetch(`https://github.com/${source}/releases/latest/download/latest.json`, { headers });
      if (r.ok) {
        const lj = await r.json(), v = String(lj.version || '').replace(/^v/i, '');
        if (v) {
          const base = `https://github.com/${source}/releases/download/v${v}/`;
          return { version: v, notes: '', setup: `${base}WipeTime.v${v}.Setup.exe`, portable: `${base}WipeTime.v${v}.exe`, sha256: lj.sha256 || '', sha256Portable: lj.sha256Portable || '' };
        }
      }
    } catch { /* se intenta con la API */ }
    const res = await fetch(`https://api.github.com/repos/${source}/releases/latest`, { headers });
    if (!res.ok) throw new Error('HTTP_' + res.status);
    const j = await res.json();
    const assets = j.assets || [];
    const setup = assets.find((a) => /setup.*\.exe$/i.test(a.name));
    const portable = assets.find((a) => /\.exe$/i.test(a.name) && !/setup/i.test(a.name));
    const sums = assets.find((a) => /sha256|latest\.json/i.test(a.name));
    let sha = {};
    if (sums) { try { sha = await (await fetch(sums.browser_download_url, { headers })).json(); } catch { /* sin suma */ } }
    return { version: j.tag_name, notes: j.body || '', setup: setup && setup.browser_download_url, portable: portable && portable.browser_download_url, sha256: sha.sha256 || '', sha256Portable: sha.sha256Portable || '' };
  }
  if (!/^https:\/\//i.test(source)) throw new Error('BAD_SOURCE');
  const res = await fetch(source, { headers });
  if (!res.ok) throw new Error('HTTP_' + res.status);
  return res.json();
}

// Fuente fija: las Releases del repositorio de WipeTime (no hay que escribir ninguna dirección)
const UPDATE_SOURCE = 'KingKhaax/WipeTime';

ipcMain.handle('update:check', async () => {
  const current = app.getVersion();
  try {
    const mf = await fetchManifest(UPDATE_SOURCE);
    const latest = String(mf.version || '').replace(/^v/i, '');
    if (!latest) throw new Error('BAD_MANIFEST');
    const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
    pendingUpdate = { mf, portable };
    return { current, latest, outdated: cmpVer(latest, current) > 0, notes: mf.notes || '', portable, canInstall: !!(portable ? mf.portable : mf.setup) };
  } catch (e) { return { current, error: String(e.message || e) }; }
});

// Instalado con el Setup: electron-updater descarga solo las partes que han cambiado (latest.yml + .blockmap de la release),
// instala en silencio y vuelve a abrir el programa. Devuelve false si no se puede (portable, release sin latest.yml...).
async function quickUpdate(sender) {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return false;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  const onProgress = (p) => { if (!sender.isDestroyed()) sender.send('update:progress', p.percent / 100); };
  autoUpdater.on('download-progress', onProgress);
  try {
    const r = await autoUpdater.checkForUpdates();
    if (!r || !r.isUpdateAvailable) return false;
    await autoUpdater.downloadUpdate();
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  } catch (err) {
    console.warn('electron-updater', err);
    return false;
  } finally {
    autoUpdater.removeListener('download-progress', onProgress);
  }
}

ipcMain.handle('update:install', async (e) => {
  if (!pendingUpdate) return { error: 'NO_CHECK' };
  const { mf, portable } = pendingUpdate;
  if (!portable && await quickUpdate(e.sender)) return { ok: true };
  const url = portable ? mf.portable : mf.setup;
  if (!url || !/^https:\/\//i.test(url)) return { error: 'NO_ASSET' };
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'WipeTime-updater' } });
    if (!res.ok) throw new Error('HTTP_' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    const chunks = [];
    let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) e.sender.send('update:progress', got / total);
    }
    const buf = Buffer.concat(chunks);
    const want = String((portable ? mf.sha256Portable || mf.sha256 : mf.sha256) || '').toLowerCase();
    if (want && require('crypto').createHash('sha256').update(buf).digest('hex') !== want) throw new Error('BAD_HASH');
    const dir = path.join(app.getPath('temp'), 'wipetime-update');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, portable ? 'WipeTime-new.exe' : 'WipeTime-Setup.exe');
    fs.writeFileSync(file, buf);
    if (portable) {
      const target = process.env.PORTABLE_EXECUTABLE_FILE;
      const bat = path.join(dir, 'apply.cmd');
      fs.writeFileSync(bat, `@echo off\r\nping 127.0.0.1 -n 4 >nul\r\ncopy /y "${file}" "${target}" >nul\r\nstart "" "${target}"\r\n`);
      require('child_process').spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      // Instalación silenciosa y reapertura automática del programa (los mismos argumentos que usa electron-updater)
      require('child_process').spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    }
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  } catch (err) { return { error: String(err.message || err) }; }
});

// ---- Exportar: captura completa de la vista (PNG) y archivos de texto (CSV)
ipcMain.handle('export:png', async (e, rect, name) => {
  const wc = e.sender;
  try {
    const { dialog } = require('electron');
    const win = BrowserWindow.fromWebContents(wc);
    const pick = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('pictures'), String(name || 'wipetime.png')), filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (pick.canceled || !pick.filePath) return { canceled: true };
    wc.debugger.attach('1.3');
    try {
      const w = Math.max(100, Math.min(4000, Math.round(rect.width)));
      const h = Math.max(100, Math.min(20000, Math.round(rect.height)));
      const shot = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: Math.round(rect.x), y: Math.round(rect.y), width: w, height: h, scale: 1 } });
      fs.writeFileSync(pick.filePath, Buffer.from(shot.data, 'base64'));
    } finally { try { wc.debugger.detach(); } catch { /* ya soltado */ } }
    return { ok: true, file: pick.filePath };
  } catch (err) { return { error: String(err.message || err) }; }
});

ipcMain.handle('export:text', async (e, text, name, ext) => {
  try {
    const { dialog } = require('electron');
    const win = BrowserWindow.fromWebContents(e.sender);
    const pick = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), String(name || 'wipetime.' + ext)), filters: [{ name: String(ext).toUpperCase(), extensions: [ext] }] });
    if (pick.canceled || !pick.filePath) return { canceled: true };
    fs.writeFileSync(pick.filePath, String(text), 'utf8');
    return { ok: true, file: pick.filePath };
  } catch (err) { return { error: String(err.message || err) }; }
});

// ---- Enlaces wipetime://report/<código>?fight=<n>
let pendingLink = null;
const linkFrom = (argv) => (argv || []).find((a) => /^wipetime:\/\//i.test(a)) || null;
function sendLink(link) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.webContents.isLoading()) { win.webContents.send('deeplink', link); if (win.isMinimized()) win.restore(); win.focus(); } else pendingLink = link;
}
ipcMain.handle('deeplink:take', () => { const l = pendingLink; pendingLink = null; return l; });

// ---- Blizzard: inicio de sesión (OAuth, código de autorización) y datos públicos de guilds
// La aplicación del portal de Blizzard debe tener registrada esta dirección de redirección exacta.
const BNET_REDIRECT = 'http://localhost:8721/callback';
const BNET_REGIONS = ['eu', 'us', 'kr', 'tw'];
const bnetRegion = () => { const r = readConfig().bnetRegion; return BNET_REGIONS.includes(r) ? r : 'eu'; };
let bnetApp = { token: null, exp: 0 };

function bnetClient() {
  const c = readConfig();
  const own = !!(c.bnetId && decrypt(c.bnetSecret));
  return own ? { id: c.bnetId, secret: decrypt(c.bnetSecret) } : { id: bundled()?.bnet?.id || '', secret: bundled()?.bnet?.secret || '' };
}

async function bnetAppToken() {
  if (!bnetClient().id && proxyUrl()) return '__proxy__';
  if (bnetApp.token && Date.now() < bnetApp.exp - 60_000) return bnetApp.token;
  const { id, secret } = bnetClient();
  if (!id || !secret) throw new Error('NO_BNET_CLIENT');
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('BNET_AUTH_' + res.status);
  const j = await res.json();
  bnetApp = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return bnetApp.token;
}

function bnetUser() {
  const u = readConfig().bnetUser;
  if (!u || !u.token || Date.now() > u.exp - 60_000) return null;
  return { token: decrypt(u.token), exp: u.exp, battletag: u.battletag || '' };
}

async function bnetApi(pathQuery, token, region = bnetRegion()) {
  if (token === '__proxy__') {
    const res = await fetch(`${proxyUrl()}/bnet?region=${region}&path=${encodeURIComponent(pathQuery)}`);
    if (!res.ok) throw new Error('BNET_HTTP_' + res.status);
    return res.json();
  }
  const res = await fetch(`https://${region}.api.blizzard.com${pathQuery}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('BNET_HTTP_' + res.status);
  return res.json();
}

ipcMain.handle('bnet:status', () => {
  const c = readConfig();
  const u = bnetUser();
  return { clientId: c.bnetId || '', hasSecret: !!decrypt(c.bnetSecret), bundled: hasBundled('bnet'), hasClient: !!(c.bnetId && decrypt(c.bnetSecret)) || hasBundled('bnet') || !!proxyUrl(), canLogin: !!(c.bnetId && decrypt(c.bnetSecret)) || hasBundled('bnet'), proxy: !!proxyUrl(), region: bnetRegion(), loggedIn: !!u, battletag: u?.battletag || c.bnetUser?.battletag || '', expired: !u && !!c.bnetUser, cachedGuilds: c.bnetGuilds || null, redirect: BNET_REDIRECT };
});

ipcMain.handle('bnet:set', (_e, { clientId, clientSecret, region }) => {
  const cfg = readConfig();
  if (clientId !== undefined) cfg.bnetId = String(clientId).trim();
  if (clientSecret) cfg.bnetSecret = encrypt(String(clientSecret).trim());
  if (region && BNET_REGIONS.includes(region)) cfg.bnetRegion = region;
  writeConfig(cfg);
  bnetApp = { token: null, exp: 0 };
  return true;
});

ipcMain.handle('bnet:logout', () => {
  const cfg = readConfig();
  delete cfg.bnetUser;
  delete cfg.bnetGuilds;
  writeConfig(cfg);
  return true;
});

ipcMain.handle('bnet:login', async (e) => {
  const { id, secret } = bnetClient();
  if (!id || !secret) return { error: 'NO_BNET_CLIENT' };
  const state = require('crypto').randomBytes(12).toString('hex');
  const url = `https://oauth.battle.net/authorize?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(BNET_REDIRECT)}&response_type=code&scope=${encodeURIComponent('openid wow.profile')}&state=${state}`;
  const parent = BrowserWindow.fromWebContents(e.sender);
  const code = await new Promise((resolve) => {
    const win = new BrowserWindow({ width: 520, height: 720, parent, modal: true, autoHideMenuBar: true, title: 'Blizzard', webPreferences: { partition: 'bnet-login', contextIsolation: true } });
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); if (!win.isDestroyed()) win.destroy(); };
    const check = (ev, u) => {
      if (!u.startsWith(BNET_REDIRECT)) return;
      ev.preventDefault();
      const q = new URL(u).searchParams;
      finish(q.get('state') === state && q.get('code') ? q.get('code') : { error: q.get('error') || 'BAD_STATE' });
    };
    win.webContents.on('will-redirect', check);
    win.webContents.on('will-navigate', check);
    win.on('closed', () => finish({ error: 'CLOSED' }));
    win.loadURL(url).catch(() => finish({ error: 'LOAD_FAILED' }));
  });
  if (typeof code !== 'string') return { error: code.error };
  try {
    const res = await fetch('https://oauth.battle.net/token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(BNET_REDIRECT)}`,
    });
    if (!res.ok) return { error: 'TOKEN_' + res.status };
    const j = await res.json();
    let battletag = '';
    try {
      const ui = await (await fetch('https://oauth.battle.net/userinfo', { headers: { Authorization: `Bearer ${j.access_token}` } })).json();
      battletag = ui.battletag || '';
    } catch { /* sin battletag */ }
    const cfg = readConfig();
    cfg.bnetUser = { token: encrypt(j.access_token), exp: Date.now() + j.expires_in * 1000, battletag };
    writeConfig(cfg);
    return { ok: true, battletag };
  } catch (err) { return { error: String(err.message || err) }; }
});

// Guilds de tus personajes: se leen los personajes de la cuenta y la guild de los de mayor nivel
// Datos de un personaje (nivel, raza, clase, facción, guild y foto) con la API de perfil
async function charInfo(realmSlug, name, lang, token, region = bnetRegion()) {
  const ns = `profile-${region}`;
  const loc = BNET_LOCALE[lang] || 'en_US';
  const base = `/profile/wow/character/${encodeURIComponent(String(realmSlug).toLowerCase())}/${encodeURIComponent(String(name).toLowerCase())}`;
  const [p, md] = await Promise.all([bnetApi(`${base}?namespace=${ns}&locale=${loc}`, token, region), bnetApi(`${base}/character-media?namespace=${ns}`, token, region).catch(() => null)]);
  return {
    name: p.name, level: p.level, race: p.race?.name, cls: p.character_class?.name, classId: p.character_class?.id, faction: p.faction?.type,
    guild: p.guild ? { name: p.guild.name, realmSlug: p.guild.realm.slug, realmName: p.guild.realm.name, faction: p.guild.faction?.type } : null,
    realmSlug: p.realm?.slug || realmSlug, realmName: p.realm?.name || realmSlug, region,
    avatar: md?.assets?.find((x) => x.key === 'avatar')?.value || md?.assets?.[0]?.value || '',
  };
}

// Armería: equipo, estadísticas (valor y %) y datos básicos de un personaje con la API de perfil de Blizzard
const itemIconCache = new Map();
async function itemIcon(id, token, region = bnetRegion()) {
  if (!id) return '';
  if (!itemIconCache.has(id)) {
    itemIconCache.set(id, bnetApi(`/data/wow/media/item/${Number(id)}?namespace=static-${region}`, token, region)
      .then((j) => j.assets?.find((a) => a.key === 'icon')?.value || '').catch(() => { itemIconCache.delete(id); return ''; }));
  }
  return itemIconCache.get(id);
}

async function armory(realmSlug, name, lang, region = bnetRegion()) {
  if (!BNET_REGIONS.includes(region)) region = bnetRegion();
  const token = await bnetAppToken();
  const ns = `profile-${region}`;
  const loc = BNET_LOCALE[lang] || 'en_US';
  const base = `/profile/wow/character/${encodeURIComponent(String(realmSlug).toLowerCase())}/${encodeURIComponent(String(name).toLowerCase())}`;
  const get = (sub) => bnetApi(`${base}${sub}?namespace=${ns}&locale=${loc}`, token, region);
  const [sum, eq, st, md] = await Promise.all([get(''), get('/equipment').catch(() => null), get('/statistics').catch(() => null), get('/character-media').catch(() => null)]);
  const equipped = eq?.equipped_items || [];
  const icons = await Promise.all(equipped.map((i) => itemIcon(i.item?.id, token, region)));
  const items = equipped.map((i, k) => ({
    slot: i.slot?.type || '', slotName: i.slot?.name || '', id: i.item?.id, name: i.name || '', ilvl: i.level?.value || 0,
    quality: i.quality?.type || 'COMMON', icon: icons[k], binding: i.binding?.name || '',
    enchant: (i.enchantments || []).map((e) => e.display_string).filter(Boolean),
    gems: (i.sockets || []).map((sk) => ({ name: sk.item?.name || '', stat: sk.display_string || '' })),
    set: i.set?.item_set?.name || '', armorType: i.item_subclass?.name || '',
  }));
  // Blizzard da el número del rating en rating_normalized (antes rating); en velocidad y evitación solo viene rating_bonus
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
    avatar: md?.assets?.find((a) => a.key === 'avatar')?.value || '', lastLogin: sum.last_login_timestamp || 0, gender: sum.gender?.type || '', faction: sum.faction?.type || '',
    guildRealm: sum.guild?.realm?.slug || '', guildRealmName: sum.guild?.realm?.name || '', realmSlug: sum.realm?.slug || realmSlug, region,
    items, stats, at: Date.now(),
  };
}

ipcMain.handle('bnet:armory', async (_e, realmSlug, name, lang, region) => {
  try { return await armory(realmSlug, name, lang, region); } catch (err) { return { error: String(err.message || err) }; }
});

ipcMain.handle('bnet:char', async (_e, realmSlug, name, lang, region) => {
  try { return await charInfo(realmSlug, name, lang, await bnetAppToken(), BNET_REGIONS.includes(region) ? region : bnetRegion()); } catch (err) { return { error: String(err.message || err) }; }
});

// Escudo de una guild: emblema, borde y fondo con sus colores
ipcMain.handle('bnet:crest', async (_e, realmSlug, guildName) => {
  try {
    const t = await bnetAppToken();
    const slug = encodeURIComponent(String(guildName).trim().toLowerCase().replace(/\s+/g, '-'));
    const g = await bnetApi(`/data/wow/guild/${encodeURIComponent(String(realmSlug).toLowerCase())}/${slug}?namespace=profile-${bnetRegion()}&locale=en_US`, t);
    const c = g.crest;
    if (!c) return { error: 'NO_CREST' };
    const img = async (href) => {
      try { const u = new URL(href); return (await bnetApi(u.pathname + u.search, t)).assets?.[0]?.value || ''; } catch { return ''; }
    };
    const col = (x) => `rgba(${x.rgba.r},${x.rgba.g},${x.rgba.b},${x.rgba.a})`;
    const [em, bo] = await Promise.all([img(c.emblem.media.key.href), img(c.border.media.key.href)]);
    return { faction: g.faction?.type, bg: col(c.background.color), emblem: { url: em, color: col(c.emblem.color) }, border: { url: bo, color: col(c.border.color) } };
  } catch (err) { return { error: String(err.message || err) }; }
});

ipcMain.handle('bnet:guilds', async (_e, lang) => {
  const u = bnetUser();
  if (!u) return { error: 'NOT_LOGGED' };
  try {
    const ns = `profile-${bnetRegion()}`;
    const prof = await bnetApi(`/profile/user/wow?namespace=${ns}&locale=en_US`, u.token);
    const chars = (prof.wow_accounts || []).flatMap((a) => a.characters || []).filter((c) => c.level >= 60)
      .sort((a, b) => b.level - a.level).slice(0, 24);
    const found = new Map();
    const cards = [];
    for (let i = 0; i < chars.length; i += 6) {
      await Promise.all(chars.slice(i, i + 6).map(async (c) => {
        try {
          const info = await charInfo(c.realm.slug, c.name, lang, u.token);
          cards.push(info);
          if (!info.guild) return;
          const key = `${info.guild.realmSlug}/${info.guild.name}`;
          if (!found.has(key)) found.set(key, { name: info.guild.name, realmSlug: info.guild.realmSlug, realmName: info.guild.realmName, chars: [] });
          found.get(key).chars.push(c.name);
        } catch { /* personaje sin perfil público */ }
      }));
    }
    cards.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
    const guilds = [...found.values()];
    const cfg = readConfig();
    cfg.bnetGuilds = { at: Date.now(), region: bnetRegion(), list: guilds, chars: cards, lang: BNET_LOCALE[lang] ? lang : 'en' };
    writeConfig(cfg); // la sesión caduca a las 24 h: guilds y personajes se recuerdan
    return { guilds, chars: cards, region: bnetRegion() };
  } catch (err) { return { error: String(err.message || err) }; }
});

// Plantilla de una guild (datos públicos: no hace falta iniciar sesión)
ipcMain.handle('bnet:roster', async (_e, realmSlug, guildName) => {
  try {
    const slug = encodeURIComponent(String(guildName).trim().toLowerCase().replace(/\s+/g, '-'));
    const realm = encodeURIComponent(String(realmSlug).trim().toLowerCase().replace(/\s+/g, '-'));
    const j = await bnetApi(`/data/wow/guild/${realm}/${slug}/roster?namespace=profile-${bnetRegion()}&locale=en_US`, await bnetAppToken());
    return {
      guild: j.guild?.name || guildName, realmSlug: j.guild?.realm?.slug || realmSlug, region: bnetRegion(),
      members: (j.members || []).map((x) => ({ name: x.character.name, realmSlug: x.character.realm.slug, level: x.character.level, classId: x.character.playable_class?.id, rank: x.rank })),
    };
  } catch (err) { return { error: String(err.message || err) }; }
});

// ---- Raider.io: posición de una guild en el ranking de una banda (mundo, región, reino y España).
// Se recorre el ranking de la región de 100 en 100 hasta encontrarla; "España" cuenta solo guilds de reinos españoles (es_ES).
ipcMain.handle('rio:rank', async (_e, { raid, difficulty, region, realmSlug, guildName, needWorld }) => {
  try {
    const regionOk = ['eu', 'us', 'kr', 'tw'].includes(region) ? region : 'eu';
    const diffOk = ['normal', 'heroic', 'mythic'].includes(difficulty) ? difficulty : 'mythic';
    if (!/^[a-z0-9-]+$/.test(raid || '')) return { error: 'BAD_RAID' };
    const norm = (s) => String(s || '').toLowerCase();
    const slugs = (r) => [norm(r.slug), norm(r.altSlug)].filter(Boolean);
    const page = async (reg, n) => {
      const res = await fetch(`https://raider.io/api/v1/raiding/raid-rankings?raid=${raid}&difficulty=${diffOk}&region=${reg}&limit=100&page=${n}`, { headers: { 'user-agent': 'WipeTime' } });
      if (!res.ok) throw new Error('HTTP_' + res.status);
      return (await res.json()).raidRankings || [];
    };
    // 1) ranking de la región: puesto en la región, en el reino y en España (solo guilds de reinos es_ES)
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
    // 2) ranking mundial (solo si hace falta: en Mítico el mundial sale de Warcraft Logs)
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
  } catch (err) { return { error: String(err.message || err) }; }
});

// ---- Buscar guilds solo por nombre (sin saber el reino) en el buscador público de Raider.io
// Buscar personajes por nombre en todos los reinos (Raider.IO). Devuelve reino, país del reino (locale), clase y foto.
ipcMain.handle('rio:search', async (_e, term) => {
  try {
    const q = String(term || '').trim();
    if (q.length < 2) return { list: [], hidden: 0 };
    const res = await fetch(`https://raider.io/api/search?term=${encodeURIComponent(q)}&type=character`, { headers: { 'user-agent': 'WipeTime', accept: 'application/json' } });
    if (!res.ok) return { error: 'HTTP_' + res.status };
    const j = await res.json();
    const low = q.toLowerCase();
    const order = { eu: 0, us: 1, kr: 2, tw: 3 };
    let hidden = 0;
    const list = [];
    for (const x of j.matches || []) {
      const d = x.data;
      if (x.type !== 'character' || !d?.realm || !d?.name) continue;
      if (!(d.region?.slug in order)) { hidden++; continue; } // los reinos de China no se pueden consultar
      list.push({
        name: d.name, realmSlug: d.realm.slug, realmName: d.realm.name, altName: d.realm.altName || '', region: d.region.slug, regionShort: d.region.short_name || '',
        locale: d.realm.locale || '', faction: d.faction || '', classId: d.class?.id || 0,
        thumb: d.thumbnail_url ? 'https:' + String(d.thumbnail_url).replace(/^https?:/, '').split('?')[0] : '',
      });
    }
    list.sort((a, b) => (a.name.toLowerCase() === low ? 0 : 1) - (b.name.toLowerCase() === low ? 0 : 1) || order[a.region] - order[b.region] || a.realmName.localeCompare(b.realmName));
    return { list: list.slice(0, 80), hidden };
  } catch (err) { return { error: String(err.message || err) }; }
});

ipcMain.handle('rio:char', async (_e, region, realmSlug, name) => {
  try {
    if (!['eu', 'us', 'kr', 'tw'].includes(region)) region = 'eu';
    const fields = 'mythic_plus_scores_by_season:current,mythic_plus_ranks,gear,talents';
    const res = await fetch(`https://raider.io/api/v1/characters/profile?region=${region}&realm=${encodeURIComponent(realmSlug)}&name=${encodeURIComponent(name)}&fields=${encodeURIComponent(fields)}`, { headers: { 'user-agent': 'WipeTime', accept: 'application/json' } });
    if (!res.ok) return { error: 'HTTP_' + res.status };
    const j = await res.json();
    // Talentos que lleva ahora (los gratuitos del árbol no se muestran) y el texto para importarlos en el juego
    const lo = j.talentLoadout;
    const talents = lo && Array.isArray(lo.loadout) ? {
      text: lo.loadout_text || '', spec: j.active_spec_name || '',
      nodes: lo.loadout.filter((x) => !x.grantedNode && x.rank > 0).map((x) => { const e = (x.node?.entries || [])[x.entryIndex || 0] || {}; return e.spell ? { spell: e.spell.id, name: e.spell.name, icon: String(e.spell.icon || '').toLowerCase(), rank: x.rank, max: e.maxRanks || 1, hero: (x.node.subTreeId || 0) > 0 } : null; }).filter(Boolean),
    } : null;
    return { season: j.mythic_plus_scores_by_season?.[0] || null, ranks: j.mythic_plus_ranks || null, ilvl: j.gear?.item_level_equipped || 0, crawled: j.last_crawled_at || '', url: j.profile_url || '', talents };
  } catch (err) { return { error: String(err.message || err) }; }
});

// Spec activa de un personaje (para el icono en los resultados del buscador)
ipcMain.handle('rio:spec', async (_e, region, realmSlug, name) => {
  try {
    if (!['eu', 'us', 'kr', 'tw'].includes(region)) region = 'eu';
    const res = await fetch(`https://raider.io/api/v1/characters/profile?region=${region}&realm=${encodeURIComponent(realmSlug)}&name=${encodeURIComponent(name)}`, { headers: { 'user-agent': 'WipeTime', accept: 'application/json' } });
    if (!res.ok) return { error: 'HTTP_' + res.status };
    const j = await res.json();
    return { spec: j.active_spec_name || '', cls: j.class || '' };
  } catch (err) { return { error: String(err.message || err) }; }
});

ipcMain.handle('rio:guilds', async (_e, term) => {
  try {
    const q = String(term || '').trim();
    if (q.length < 2) return { list: [] };
    const res = await fetch(`https://raider.io/api/search?term=${encodeURIComponent(q)}&type=guild`, { headers: { 'user-agent': 'WipeTime', accept: 'application/json' } });
    if (!res.ok) return { error: 'HTTP_' + res.status };
    const j = await res.json();
    const low = q.toLowerCase();
    const list = (j.matches || []).filter((x) => x.type === 'guild' && x.data?.realm && ['eu', 'us', 'kr', 'tw'].includes(x.data.region?.slug))
      .map((x) => ({ name: x.data.name, realmSlug: x.data.realm.slug, realmName: x.data.realm.name, region: x.data.region.slug, faction: x.data.faction }))
      .sort((a, b) => (a.name.toLowerCase() === low ? 0 : 1) - (b.name.toLowerCase() === low ? 0 : 1) || (a.region === 'eu' ? 0 : 1) - (b.region === 'eu' ? 0 : 1) || a.name.localeCompare(b.name))
      .slice(0, 24);
    return { list };
  } catch (err) { return { error: String(err.message || err) }; }
});

ipcMain.handle('open:external', (_e, url) => {
  if (/^https:\/\/(([a-z]+\.)?warcraftlogs\.com|worldofwarcraft\.blizzard\.com|news\.blizzard\.com)\//.test(url)) shell.openExternal(url);
});

// Modo silencioso para pruebas automáticas: con WIPETIME_QUIET=1 la ventana no se muestra ni roba el foco.
const QUIET = process.env.WIPETIME_QUIET === '1';

function createWindow() {
  const win = new BrowserWindow({
    show: !QUIET,
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0e1117',
    title: 'WipeTime',
    icon: path.join(__dirname, 'src', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !QUIET, // en modo silencioso la página sigue animándose aunque no se vea
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// Una sola instancia (solo instalada): un enlace wipetime:// abre el reporte en la ventana que ya existe
if (app.isPackaged) {
  if (!app.requestSingleInstanceLock()) app.quit();
  else {
    app.on('second-instance', (_e, argv) => {
      const l = linkFrom(argv);
      const win = BrowserWindow.getAllWindows()[0];
      if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
      if (l) sendLink(l);
    });
    app.setAsDefaultProtocolClient('wipetime', process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, []);
  }
}
pendingLink = linkFrom(process.argv);

app.whenReady().then(() => { registerIconProtocol(); registerBossMapProtocol(); registerMediaProtocol(); createWindow(); });
app.on('window-all-closed', () => app.quit());
