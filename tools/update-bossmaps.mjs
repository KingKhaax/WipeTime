// Genera src/bossmaps.json y src/bossmaps.js con el catálogo de mapas de jefes publicado por RaidPlan.io
// (datos públicos de su página: jefe, mapa, tamaño en yardas y posición/rotación en el mundo).
// Las imágenes NO se incluyen en el programa: WipeTime las descarga bajo demanda a la carpeta de datos del usuario.
// Uso:  node tools/update-bossmaps.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const BASE = 'https://raidplan.io';
const CDN = 'https://cdn.raidplan.io';
const PAGES = ['wow.midnight.venomabyss', 'wow.midnight.voidspire', 'wow.midnight.dreamrift', 'wow.midnight.marchonqueldanas',
  'wow.midnight.sporefall', 'wow.midnight.tidebound', 'wow.midnight.kithix'];

function extractRaids(html) {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => JSON.parse('"' + m[1] + '"'));
  const flight = chunks.join('');
  const start = flight.indexOf('"initialRaids":');
  if (start < 0) return [];
  const arrStart = flight.indexOf('[', start);
  let depth = 0; let inStr = false; let esc = false; let end = -1;
  for (let i = arrStart; i < flight.length; i++) {
    const ch = flight[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  return JSON.parse(flight.slice(arrStart, end + 1));
}

const entries = new Map();
for (const p of PAGES) {
  const res = await fetch(`${BASE}/plan/create?raid=${p}`, { headers: { 'user-agent': UA } });
  if (!res.ok) { console.warn('no se pudo leer', p, res.status); continue; }
  for (const r of extractRaids(await res.text())) {
    for (const b of r.bosses || []) {
      for (const m of b.maps || []) {
        if (m.hidden) continue;
        const key = `${r.cdnId}|${b.cdnId}|${m.slug}`;
        const prev = entries.get(key);
        if (prev && (prev.world || !m.world)) continue;
        entries.set(key, {
          raid: r.name, raidCdn: r.cdnId, boss: b.name, bossCdn: b.cdnId, encounter: b.encounter ?? null,
          map: m.name, slug: m.slug, yards: m.yards ?? null,
          world: m.world ? { x: m.world.x, y: m.world.y, yaw: m.world.yaw } : null,
        });
      }
    }
  }
}

// Comprobar qué imagen existe (con la ruta que usa la web: <jefe>-<slug>.jpg, o <jefe>.jpg)
const out = [];
for (const e of entries.values()) {
  const cands = [`${e.bossCdn}${e.slug ? '-' + e.slug : ''}.jpg`, `${e.bossCdn}.jpg`];
  let file = null;
  for (const c of cands) {
    const r = await fetch(`${CDN}/raid/${e.raidCdn}/map/${c}`, { method: 'HEAD', headers: { 'user-agent': UA } }).catch(() => null);
    if (r && r.ok) { file = c; break; }
  }
  if (file) out.push({ ...e, path: `raid/${e.raidCdn}/map/${file}` });
  else console.warn('sin imagen:', e.boss, e.slug);
}
out.sort((a, b) => (a.encounter ?? 0) - (b.encounter ?? 0) || a.slug.localeCompare(b.slug));
fs.writeFileSync(path.join(here, '..', 'src', 'bossmaps.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(here, '..', 'src', 'bossmaps.js'), `'use strict';\n// Generado por tools/update-bossmaps.mjs (catálogo de mapas de RaidPlan.io)\nconst BOSS_MAPS = ${JSON.stringify(out)};\n`);
console.log(`${out.length} mapas de ${new Set(out.map((o) => o.boss)).size} jefes`);
