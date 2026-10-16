// Corrige src/classspells.js: para cada habilidad/talento de «Cambios de clase» busca el hechizo EXACTO (el que sale en el árbol
// de talentos o en el libro de hechizos de la clase) en vez de uno cualquiera con el mismo nombre. Así el tooltip lleva
// el icono, el nombre y el texto originales. Fuentes: árboles de talentos de Raidbots (id de hechizo oficial de cada talento)
// y, para lo que no está en los árboles, el tooltip de Wowhead en español filtrado por la clase («Requiere Pícaro»).
// Uso: node tools/fix-classspells.mjs [--write]
import fs from 'node:fs';

const WRITE = process.argv.includes('--write');
const root = new URL('../', import.meta.url);
const csSrc = fs.readFileSync(new URL('src/classspells.js', root), 'utf8');
const NAMES = new Function(`${csSrc}; return CLASS_SPELLS;`)();
// Nombres que aparecían sin traducir en los textos: se buscan igual que el resto (id -1 = por resolver)
const MANUAL_ES0 = { Serenity: 1, 'Holy Word': 1, 'Spell Density': 1 };
const ADD = ['Deadly Reach', 'Painful Strength', 'Virulent Plague', 'Reattribution', 'Epidemic', 'Rebirth', 'Lifebloom', 'Double-time', 'Dream Simulacrum', 'Kill Command', 'Dire Beast', 'Spell Density', 'Linked Spirits', 'Words of the Wise', 'Serenity', 'Preventive Measures', 'Prayer of Mending', 'Blade Flurry', 'Darkglare Eye Beam', 'Revenge', 'Void Reaver', 'Thrill of Blood', 'Holy Word', 'Prompt Prognosis', 'Specialized Arsenal'];
// Criaturas y recursos (sin tooltip): nombre oficial en español
const MANUAL_ES = { Serenity: 'Serenidad', 'Holy Word': 'Palabra sagrada', 'Spell Density': 'Densidad de hechizos', Imp: 'Diablillo', Sayaad: 'Sayaad', Felhunter: 'Manáfago', Hydra: 'Hidra', 'Lesser Ghoul': 'Necrófago menor', 'Lesser Ghouls': 'Necrófagos menores', Fury: 'Furia', 'Kill Commands': 'Órdenes de matar' };
for (const n of ADD) if (!NAMES[n] && !Object.hasOwn(MANUAL_ES0, n)) NAMES[n] = [-1, ''];
for (const [n, e] of Object.entries(MANUAL_ES)) if (!NAMES[n]) NAMES[n] = [0, e];
const ccSrc = fs.readFileSync(new URL('src/classchanges.js', root), 'utf8');
const stubs = { tr: (a) => a, locale: () => 'es-ES', esc: (s) => s, classIconUrl: () => '', document: { addEventListener() {} } };
const D = new Function(...Object.keys(stubs), `${ccSrc}; return ClassChanges.D;`)(...Object.values(stubs));

const CLASS_ES = { deathknight: 'Caballero de la Muerte', demonhunter: 'Cazador de demonios', druid: 'Druida', evoker: 'Evocador', hunter: 'Cazador', mage: 'Mago', monk: 'Monje', paladin: 'Paladín', priest: 'Sacerdote', rogue: 'Pícaro', shaman: 'Chamán', warlock: 'Brujo', warrior: 'Guerrero' };
const CLASS_RB = { deathknight: 'Death Knight', demonhunter: 'Demon Hunter', druid: 'Druid', evoker: 'Evoker', hunter: 'Hunter', mage: 'Mage', monk: 'Monk', paladin: 'Paladin', priest: 'Priest', rogue: 'Rogue', shaman: 'Shaman', warlock: 'Warlock', warrior: 'Warrior' };

// Clases (y especializaciones) que usan cada nombre en los textos
const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keys = Object.keys(NAMES).sort((a, b) => b.length - a.length).map(esc);
const RE = new RegExp(`(?<![\\w'’-])(${keys.join('|')})(?![\\w'’-])`, 'g');
const usage = new Map();
for (const [k, c] of Object.entries(D)) for (const [sk, rows] of Object.entries(c.specs)) for (const r of rows) {
  for (const m of String(r[3]).matchAll(RE)) {
    if (!usage.has(m[1])) usage.set(m[1], new Map());
    const u = usage.get(m[1]);
    if (!u.has(k)) u.set(k, new Set());
    u.get(k).add(sk);
  }
}

// Clase de los nombres con apóstrofo o plural en el texto («Blade Flurry's», «Kill Commands»), que la búsqueda de arriba no detecta
const HINT = { Lifebloom: ['druid'], 'Blade Flurry': ['rogue'], 'Kill Command': ['hunter'], 'Prayer of Mending': ['priest'], Epidemic: ['deathknight'], 'Virulent Plague': ['deathknight'], Reattribution: ['evoker'], 'Painful Strength': ['deathknight'], 'Darkglare Eye Beam': ['warlock'], 'Linked Spirits': ['monk'], 'Specialized Arsenal': ['hunter'], 'Prompt Prognosis': ['priest'], Rebirth: ['druid'] };
for (const [n, cs] of Object.entries(HINT)) { if (!usage.has(n)) usage.set(n, new Map()); for (const c of cs) if (!usage.get(n).has(c)) usage.get(n).set(c, new Set()); }

// Árboles de talentos (Raidbots): clase -> nombre -> [{ spec, spellId, icon }]
const rb = await (await fetch('https://www.raidbots.com/static/data/live/talents.json', { headers: { 'user-agent': 'WipeTime' } })).json();
const tree = new Map();
for (const t of rb) {
  const cls = Object.keys(CLASS_RB).find((k) => CLASS_RB[k] === t.className);
  if (!cls) continue;
  if (!tree.has(cls)) tree.set(cls, new Map());
  const m = tree.get(cls);
  const spec = String(t.specName || '').toLowerCase().replace(/[^a-z]/g, '');
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o.entries)) for (const e of o.entries) if (e?.name) { if (!m.has(e.name)) m.set(e.name, []); m.get(e.name).push({ spec, spellId: e.spellId || 0, icon: String(e.icon || '').toLowerCase() }); }
    for (const kk in o) walk(o[kk]);
  };
  walk(t);
}

async function wh(id) {
  try {
    const r = await fetch(`https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=6`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const plain = String(j.tooltip || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
    return { name: String(j.name || '').trim(), icon: j.icon || '', text: plain };
  } catch { return null; }
}

// Palabras sueltas que no son un hechizo concreto (salen de la detección de nombres): se traducen pero sin tooltip
// Ids oficiales que el filtro por clase no elige bien
const MANUAL = { Mangle: 33917 };
const GENERIC = new Set(['Death', 'Pain', 'Healing', 'Melee', 'Protection', 'Strike', 'Shadow', 'Swift', 'Transfer', 'Timewalker', 'Grace', 'Death Knight', 'Discipline', 'Madness', 'Insanity', 'Fazed', 'Splinters', 'Corruption', 'Maelstrom', 'Execute']);

let wagoNames = null;
async function byName(name) {
  if (!wagoNames) {
    const text = await (await fetch('https://wago.tools/db2/SpellName/csv')).text();
    wagoNames = new Map();
    for (const line of text.split('\n')) {
      const m = line.match(/^(\d+),(?:"((?:[^"]|"")*)"|([^,\r]*))\r?$/);
      if (!m) continue;
      const n = (m[2] !== undefined ? m[2].replace(/""/g, '"') : m[3]).trim();
      if (!wagoNames.has(n)) wagoNames.set(n, []);
      wagoNames.get(n).push(Number(m[1]));
    }
  }
  return wagoNames.get(name) || [];
}

const out = {};
const changes = [];
const entries = Object.entries(NAMES);
let idx = 0;
async function work() {
  while (idx < entries.length) {
    const [name, [oldId, oldEs]] = entries[idx++];
    const use = usage.get(name) || new Map();
    const classes = [...use.keys()];
    let id = oldId, how = 'igual';
    if (GENERIC.has(name)) { id = 0; how = 'palabra suelta'; }
    else if (oldId) {
      // 1) árbol de talentos de las clases que usan el nombre
      let hit = null;
      for (const cls of classes) {
        const list = tree.get(cls)?.get(name);
        if (!list) continue;
        const specs = use.get(cls);
        hit = list.find((x) => specs.has(x.spec) && x.spellId) || list.find((x) => x.spellId) || (list.every((x) => !x.spellId) ? { spellId: 0 } : null);
        if (hit) break;
      }
      if (hit) { id = hit.spellId; how = id ? 'árbol de talentos' : 'subárbol/héroe (sin tooltip)'; }
      else {
        // 2) Wowhead filtrado por clase: el hechizo con ese nombre que «Requiere <clase>»
        const cur = await wh(oldId);
        const okCur = cur && classes.some((c) => cur.text.includes(`Requiere ${CLASS_ES[c]}`) || cur.text.includes(CLASS_ES[c]));
        if (!okCur) {
          const cands = (await byName(name)).sort((a, b) => a - b).slice(0, 80); // el id más bajo con esa clase suele ser el hechizo original del libro de hechizos
          for (const cid of cands) {
            const r = await wh(cid);
            if (!r || !r.icon || /questionmark|trade_engineering/.test(r.icon)) continue;
            if (classes.some((c) => r.text.includes(`Requiere ${CLASS_ES[c]}`))) { id = cid; how = 'Wowhead por clase'; break; }
          }
        }
      }
    }
    if (MANUAL[name]) { id = MANUAL[name]; how = 'manual'; }
    if (id === -1) { id = 0; how = 'sin hechizo'; }
    let es = oldEs;
    if (id) {
      const r = await wh(id);
      if (r?.name && r.icon) es = r.name; else if (id !== oldId) { id = oldId; how = 'igual (sin datos)'; }
    }
    if (process.env.DBG && process.env.DBG.split(",").includes(name)) console.error("DBG0", name, JSON.stringify([...use.keys()]), id, how, JSON.stringify(es));
    if (!es) continue;
    if (process.env.DBG && process.env.DBG.split(",").includes(name)) console.error("DBG", name, JSON.stringify([...use.keys()]), id, how, es);
    out[name] = [id, es];
    if (id !== oldId || es !== oldEs) changes.push({ name, old: [oldId, oldEs], now: [id, es], how });
  }
}
await Promise.all(Array.from({ length: 8 }, work));

console.error(`cambios: ${changes.length} de ${entries.length}`);
for (const c of changes) console.error(`${c.name}: ${c.old.join(' ')} → ${c.now.join(' ')}  (${c.how})`);

if (WRITE) {
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, 'en')));
  const head = csSrc.slice(0, csSrc.indexOf('const CLASS_SPELLS'));
  fs.writeFileSync(new URL('src/classspells.js', root), `${head}const CLASS_SPELLS = ${JSON.stringify(sorted, null, 1)};\n`);
  console.error('escrito src/classspells.js');
}
