// Genera src/classspells.js: nombre inglés de habilidad/talento -> [id de hechizo, nombre en español]
// para que «Cambios de clase» muestre los nombres en el idioma de la app y cada uno con su tooltip.
// Los nombres salen de las tablas SpellName (enUS y esES) de wago.tools y se contrastan con el nombre en español de Wowhead;
// el tooltip lo carga la app en tiempo real desde Wowhead con ese id. Los árboles de talentos de héroe (TraitSubTree) y la
// banda (JournalInstance) no son hechizos: se traducen con id 0 (sin tooltip). Los hechizos sin descripción también (id 0). Entre varios hechizos con el mismo nombre se elige el más reciente que tenga descripción.
// Uso: node tools/build-classspells.mjs [spellname_en.csv spellname_es.csv]   (sin argumentos, las descarga)
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/classchanges.js', import.meta.url), 'utf8');
const stubs = { tr: (a) => a, locale: () => 'es-ES', esc: (s) => s, classIconUrl: () => '', document: { addEventListener() {} } };
const D = new Function(...Object.keys(stubs), `${src}; return ClassChanges.D;`)(...Object.values(stubs));

const STOP = new Set(['All', 'Fixed', 'Fix', 'Many', 'No', 'New', 'Several', 'Now', 'The', 'Mythic', 'Aspect', 'Class', 'Mastery', 'Blood', 'Frost', 'Fire', 'Unholy', 'Venomous', 'Abyss', 'Rank', 'Magic', 'Intellect', 'Fury', 'Energy', 'Rage', 'Cooldown', 'Manager', 'Spell', 'Density', 'Cobra', 'Pet', 'Imp']);
const found = new Set();
const re = /[A-Z][A-Za-z'’-]*(?:(?:: | of the | of | the | in | to | )[A-Z][A-Za-z'’-]*)*/g;
for (const k of Object.keys(D)) {
  for (const rows of Object.values(D[k].specs)) {
    for (const r of rows) {
      for (const m of r[3].matchAll(re)) {
        const n = m[0].replace(/[:.]$/, '').trim();
        if (n.length < 4 || STOP.has(n)) continue;
        found.add(n);
        for (const p of n.split(': ')) if (p.length >= 4 && !STOP.has(p)) found.add(p);
      }
    }
  }
}
console.error('candidatos', found.size);

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (r.ok) return await r.text();
    } catch { /* reintento */ }
  }
  throw new Error('no se pudo descargar ' + url);
}

async function table(arg, url) {
  const text = arg ? fs.readFileSync(arg, 'utf8') : await get(url);
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d+),(?:"((?:[^"]|"")*)"|([^,\r]*))\r?$/);
    if (m) map.set(Number(m[1]), (m[2] !== undefined ? m[2].replace(/""/g, '"') : m[3]).trim());
  }
  return map;
}

// CSV genérico con comillas y saltos de línea dentro de campos (TraitSubTree, JournalInstance)
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
async function names(tableName, col = 'Name_lang') {
  const read = async (loc) => {
    const rows = parseCsv(await get(`https://wago.tools/db2/${tableName}/csv?locale=${loc}`));
    const head = rows[0];
    const iN = head.indexOf(col), iI = head.indexOf('ID');
    const m = new Map();
    for (const r of rows.slice(1)) if (r.length > iN && r[iI]) m.set(Number(r[iI]), r[iN].trim());
    return m;
  };
  const [en, es] = await Promise.all([read('enUS'), read('esES')]);
  const out = new Map();
  for (const [id, n] of en) if (n && es.get(id) && !/\[DNT\]/.test(n)) out.set(n, es.get(id));
  return out;
}

const en = await table(process.argv[2], 'https://wago.tools/db2/SpellName/csv');
const es = await table(process.argv[3], 'https://wago.tools/db2/SpellName/csv?locale=esES');
const byName = new Map();
for (const [id, n] of en) {
  if (!n || /\(OLD\)|\[DNT\]|^zz|^DNT/i.test(n)) continue;
  if (!found.has(n)) continue;
  if (!byName.has(n)) byName.set(n, []);
  byName.get(n).push(id);
}

const EN_W = /\b(the|your|and|damage|increases?|reduces?|chance|seconds?|for|when|by|of|to|an?|is|are)\b/gi;
const ES_W = /\b(el|la|los|las|tu|y|daño|aumenta|reduce|probabilidad|segundos?|durante|cuando|por|de|un|una|es|son)\b/gi;
const englishy = (t) => { const e = (t.match(EN_W) || []).length; return e >= 2 && e > (t.match(ES_W) || []).length; };

// Tooltip de Wowhead en español: nombre y descripción real (segunda tabla del HTML)
const info = async (id) => {
  try {
    const r = await fetch(`https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=6`, { signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    const parts = String(j.tooltip || '').split(/<table/i);
    const last = parts.length > 3 ? parts[parts.length - 1] : parts[2];   // con la cabecera partida en dos tablas, la descripción es la última
    const desc = (last || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    return { name: j.name ? String(j.name).trim() : null, desc: desc.length >= 25 ? desc : '' };
  } catch { return { name: null, desc: '' }; }
};

const out = {};
const sinTooltip = [];
const ingles = [];
const entries = [...byName];
let done = 0;
async function work([name, ids]) {
  const cands = ids.sort((a, b) => b - a).slice(0, 40);
  let pick = null, pickEn = null, esName = null;
  for (const id of cands) {
    const r = await info(id);
    if (!r.desc) continue;
    if (!englishy(r.desc)) { pick = id; esName = r.name; break; }
    if (pickEn == null) { pickEn = id; esName = esName || r.name; }
  }
  if (pick == null && pickEn != null) { pick = pickEn; ingles.push(name); }
  if (pick != null) esName = esName || es.get(pick);
  else { esName = es.get(cands[0]); sinTooltip.push(name); }   // sin descripción útil: se traduce el nombre, sin tooltip (id 0)
  if (!esName || /\(OLD\)/.test(esName)) return;
  out[name] = [pick ?? 0, esName];
  if (++done % 40 === 0) console.error(done + '/' + byName.size);
}
const pool = Array.from({ length: 10 }, async () => { while (entries.length) await work(entries.shift()); });
await Promise.all(pool);

// Nombres que no son hechizos: árboles de talentos de héroe y la banda (siempre sin tooltip)
const extra = new Map([...(await names('TraitSubTree')), ...(await names('JournalInstance'))]);
let extras = 0;
for (const [n, esN] of extra) {
  if (!found.has(n) || out[n]) continue;
  out[n] = [0, esN];
  extras++;
}
// La banda se llama «The Venomous Abyss» en la base de datos y en los textos solo «Venomous Abyss»
for (const [n, esN] of extra) {
  const short = n.replace(/^The /, '');
  if (short !== n && found.has(short) && !out[short]) { out[short] = [0, esN.replace(/^(El|La|Los|Las) /, '')]; extras++; }
}
console.error('resueltos', Object.keys(out).length, '| descripción en inglés en Wowhead', ingles.length, '| sin tooltip', sinTooltip.length, '| extra (héroe/banda)', extras);
if (ingles.length) console.error('con descripción en inglés:', ingles.join(', '));
if (sinTooltip.length) console.error('sin descripción:', sinTooltip.join(', '));
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(new URL('../src/classspells.js', import.meta.url), `'use strict';\n// Generado por tools/build-classspells.mjs: nombre inglés -> [id de hechizo (0 = sin tooltip), nombre en español]\nconst CLASS_SPELLS = ${JSON.stringify(sorted, null, 1)};\n`);
