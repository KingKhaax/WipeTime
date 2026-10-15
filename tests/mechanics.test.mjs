import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { read, root } from './helpers.mjs';

const data = JSON.parse(read('tools/mechanics_es.json'));
const icons = JSON.parse(read('tools/mech_icons.json'));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

test('las mecánicas tienen tipos y dificultades válidos', () => {
  for (const b of data.bosses) for (const p of b.phases) for (const m of p.mechanics) {
    assert.ok(data.types[m.type], `${b.name} / ${m.name}: tipo «${m.type}» desconocido`);
    assert.ok(Array.isArray(m.diffs) && m.diffs.length && m.diffs.every((d) => ['N', 'H', 'M'].includes(d)), `${b.name} / ${m.name}: dificultades`);
    assert.ok(m.note && m.note.length > 10, `${b.name} / ${m.name}: sin nota`);
  }
});

test('src/mechanics.js está generado a partir de tools/mechanics_es.json', () => {
  const src = read('src/mechanics.js');
  const m = src.match(/const MECH_DATA = (\{.*\});/s);
  assert.ok(m, 'formato de mechanics.js');
  const built = JSON.parse(m[1]);
  assert.deepEqual(built.bosses, data.bosses, 'ejecuta «node tools/build-mechanics.mjs»: mechanics.js no coincide con el JSON');
});

test('src/mechicons.js coincide con tools/mech_icons.json', () => {
  assert.ok(read('src/mechicons.js').includes(JSON.stringify(icons)), 'mechicons.js desactualizado respecto a mech_icons.json');
});

test('todas las mecánicas de Kith\'ix tienen icono propio', () => {
  const b = data.bosses.find((x) => x.slug === 'kithix');
  assert.ok(b, 'falta Kith\'ix');
  for (const p of b.phases) for (const m of p.mechanics) {
    const keys = m.name.split('/').map((x) => norm(x.replace(/\(.*?\)/g, ''))).filter(Boolean);
    assert.ok(keys.some((k) => icons[k]), `sin icono: ${m.name}`);
  }
});

test('cada jefe tiene al menos una mecánica', () => {
  for (const b of data.bosses) assert.ok(b.phases.some((p) => p.mechanics.length), `${b.name} sin mecánicas`);
});
