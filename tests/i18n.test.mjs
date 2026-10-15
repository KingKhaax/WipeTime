import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const keysOf = (o, pre = '') => Object.entries(o || {}).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keysOf(v, `${pre}${k}.`) : [`${pre}${k}`]));

test('español e inglés tienen las mismas claves de texto', () => {
  const { $ } = load(['src/data.js', 'src/i18n.js']);
  const es = new Set(keysOf($('STRINGS').es));
  const en = new Set(keysOf($('STRINGS').en));
  const onlyEs = [...es].filter((k) => !en.has(k));
  const onlyEn = [...en].filter((k) => !es.has(k));
  assert.deepEqual({ onlyEs, onlyEn }, { onlyEs: [], onlyEn: [] });
});

test('tr() elige español o inglés (y cualquier otro idioma cae en inglés)', () => {
  const { S, ctx } = load(['src/data.js', 'src/i18n.js']);
  S.lang = 'es';
  assert.equal(ctx.tr('hola', 'hello'), 'hola');
  S.lang = 'en';
  assert.equal(ctx.tr('hola', 'hello'), 'hello');
  S.lang = 'fr';
  assert.equal(ctx.tr('hola', 'hello'), 'hello');
});

test('solo hay dos idiomas', () => {
  const { $ } = load(['src/data.js', 'src/i18n.js']);
  assert.equal($('LANGS').map((l) => l.code).join(','), 'es,en');
});
