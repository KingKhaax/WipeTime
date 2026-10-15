import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load, read, root, srcFiles } from './helpers.mjs';

test('cada clase tiene color y nombre en español e inglés', () => {
  const { $ } = load(['src/data.js']);
  const classes = $('CLASSES');
  assert.ok(Object.keys(classes).length >= 13, 'faltan clases');
  for (const [k, c] of Object.entries(classes)) {
    assert.ok(/^#[0-9a-f]{6}$/i.test(c.color), `${k}: color`);
    assert.ok(c.es && c.en, `${k}: falta nombre es/en`);
  }
});

test('hay icono incluido para cada clase y para las especializaciones', () => {
  const { $ } = load(['src/data.js']);
  for (const k of Object.keys($('CLASSES'))) {
    const file = $(`classIconUrl(${JSON.stringify(k)})`);
    assert.ok(fs.existsSync(path.join(root, 'src', file)), `falta el icono de clase ${file}`);
  }
  const specs = fs.readdirSync(path.join(root, 'src', 'specs'));
  assert.ok(specs.length >= 36, `solo hay ${specs.length} iconos de especialización`);
});

test('los iconos fijos que usa el código existen', () => {
  const missing = [];
  for (const f of srcFiles()) {
    for (const m of read(f).matchAll(/["'`(]((?:icons|classes|specs)\/[a-z0-9_\-]+\.(?:jpg|png))/g)) {
      if (!fs.existsSync(path.join(root, 'src', m[1]))) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
