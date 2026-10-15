import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// mergeRankings vive en app.js (script de navegador): se extrae y se evalúa solo esa función
const src = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const start = src.indexOf('function mergeRankings(');
const end = src.indexOf('\nfunction rankings(', start);
const mergeRankings = new Function(`${src.slice(start, end)}; return mergeRankings;`)();

const mk = (chars) => ({ data: [{ roles: { dps: { characters: chars } } }] });

test('Parse % sale del modo Parses y el Ilvl % del modo por defecto', () => {
  const a = mk([{ name: 'Neerö', rank: 20, totalParses: 68, rankPercent: 71, bracketPercent: 68 }]);
  const b = mk([{ name: 'Neerö', rank: '~14', totalParses: 47, rankPercent: 70, bracketPercent: 69 }]);
  const c = mergeRankings(a, b).data[0].roles.dps.characters[0];
  assert.equal(c.rankPercent, 70);
  assert.equal(c.bracketPercent, 68);
});

test('si el modo Parses da 0 se conserva el valor por defecto', () => {
  const a = mk([{ name: 'X', rank: 5, totalParses: 100, rankPercent: 95, bracketPercent: 90 }]);
  const b = mk([{ name: 'X', rank: '~5', totalParses: 80, rankPercent: 0, bracketPercent: 0 }]);
  assert.equal(mergeRankings(a, b).data[0].roles.dps.characters[0].rankPercent, 95);
});
