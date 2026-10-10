// Convierte tools/mechanics_es.json (la guía de mecánicas, editable a mano) en src/mechanics.js, que carga la app.
// Uso: node tools/build-mechanics.mjs   (después de editar el JSON)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'tools', 'mechanics_es.json'), 'utf8'));
for (const b of data.bosses) {
  for (const p of b.phases) {
    for (const m of p.mechanics) {
      if (!data.types[m.type]) throw new Error(`Tipo desconocido "${m.type}" en ${b.name} / ${m.name}`);
      if (!Array.isArray(m.diffs) || !m.diffs.every((d) => ['N', 'H', 'M'].includes(d))) throw new Error(`Dificultades inválidas en ${b.name} / ${m.name}`);
    }
  }
}
const slim = { raid: data.raid, types: Object.fromEntries(Object.entries(data.types).map(([k, v]) => [k, { color: v.color, label: v.label }])), bosses: data.bosses };
writeFileSync(join(root, 'src', 'mechanics.js'), `'use strict';\n// Generado por tools/build-mechanics.mjs a partir de tools/mechanics_es.json\nconst MECH_DATA = ${JSON.stringify(slim)};\n`);
console.log(`src/mechanics.js creado: ${data.bosses.length} jefes, ${data.bosses.reduce((s, b) => s + b.phases.reduce((t, p) => t + p.mechanics.length, 0), 0)} mecánicas`);
