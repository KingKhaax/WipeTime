import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, srcFiles } from './helpers.mjs';

test('todos los archivos de src/ y main.js se pueden analizar', () => {
  for (const f of [...srcFiles(), 'main.js', 'preload.js']) {
    assert.doesNotThrow(() => new vm.Script(read(f), { filename: f }), `error de sintaxis en ${f}`);
  }
});

test('index.html solo carga scripts que existen', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { root } = await import('./helpers.mjs');
  const html = read('src/index.html');
  for (const m of html.matchAll(/<script src="([^"]+)"/g)) {
    assert.ok(fs.existsSync(path.join(root, 'src', m[1])), `falta ${m[1]} (referenciado en index.html)`);
  }
});

test('no quedan restos de francés ni alemán en la lista de idiomas', () => {
  const i18n = read('src/i18n.js');
  assert.ok(!/code: 'de'|code: 'fr'/.test(i18n), 'LANGS no debe incluir de ni fr');
});
