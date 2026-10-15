// Genera src/classspells.js: nombre inglés de habilidad/talento -> [id de hechizo, nombre en español]
// para que «Cambios de clase» muestre los nombres en el idioma de la app y cada uno con su tooltip.
// Los nombres salen de las tablas SpellName (enUS y esES) de wago.tools; el tooltip lo carga la app en tiempo real
// desde Wowhead con ese id. Entre varios hechizos con el mismo nombre se elige el más reciente que tenga descripción.
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

async function table(arg, url) {
  const text = arg ? fs.readFileSync(arg, 'utf8') : await (await fetch(url)).text();
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d+),(?:"((?:[^"]|"")*)"|([^,\r]*))\r?$/);
    if (m) map.set(Number(m[1]), (m[2] !== undefined ? m[2].replace(/""/g, '"') : m[3]).trim());
  }
  return map;
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

const hasDesc = async (id) => {
  try {
    const r = await fetch(`https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=6`, { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    const t = String(j.tooltip || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > String(j.name || '').length + 30;
  } catch { return false; }
};

const out = {};
let i = 0;
for (const [name, ids] of byName) {
  const cands = ids.sort((a, b) => b - a).slice(0, 6);
  let pick = null;
  for (const id of cands) { if (await hasDesc(id)) { pick = id; break; } }
  if (pick == null) continue;
  const esName = es.get(pick);
  out[name] = [pick, esName && !/\(OLD\)/.test(esName) ? esName : name];
  if (++i % 40 === 0) console.error(`${i}/${byName.size}`);
}
console.error('resueltos', Object.keys(out).length);
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(new URL('../src/classspells.js', import.meta.url), `'use strict';\n// Generado por tools/build-classspells.mjs: nombre inglés -> [id de hechizo, nombre en español]\nconst CLASS_SPELLS = ${JSON.stringify(sorted, null, 1)};\n`);
