// Estadísticas públicas del repo: descargas de cada release y visitas/clones de los últimos 14 días.
//   node tools/stats.mjs            (necesita `gh` con sesión iniciada como dueño del repo)
//   node tools/stats.mjs --mine 3   (resta de las visitas únicas las tuyas, si sabes cuántas son)
import { execFileSync } from 'node:child_process';

const repo = 'KingKhaax/WipeTime';
const gh = (p) => JSON.parse(execFileSync('gh', ['api', `repos/${repo}/${p}`], { encoding: 'utf8' }));
const mine = Number(process.argv[process.argv.indexOf('--mine') + 1]) || 0;

console.log(`\n== Descargas (instalador y portable; sin latest.json/yml/blockmap, que usa el actualizador) ==`);
let total = 0;
for (const r of gh('releases')) {
  const files = r.assets.filter((a) => /\.exe$/.test(a.name));
  const n = files.reduce((s, a) => s + a.download_count, 0);
  total += n;
  console.log(`${r.tag_name}: ${n}  ${files.map((a) => `${a.name} (${a.download_count})`).join(', ')}`);
}
console.log(`Total en las releases que existen: ${total}`);
console.log('(las releases antiguas se borran, así que sus descargas ya no cuentan)');

const views = gh('traffic/views');
console.log(`\n== Visitas al repositorio y a la web, últimos 14 días ==`);
console.log(`Vistas: ${views.count} · visitantes únicos: ${Math.max(0, views.uniques - mine)}${mine ? ` (restados ${mine} tuyos)` : ''}`);
const clones = gh('traffic/clones');
console.log(`Clones: ${clones.count} · únicos: ${clones.uniques}`);
console.log('\nPor día (vistas/únicos):');
for (const v of views.views.filter((x) => x.count)) console.log(`  ${v.timestamp.slice(0, 10)}  ${v.count}/${v.uniques}`);
console.log('\nDe dónde vienen:');
for (const r of gh('traffic/popular/referrers')) console.log(`  ${r.referrer}: ${r.count} (${r.uniques} únicos)`);
console.log('\nPáginas más vistas:');
for (const p of gh('traffic/popular/paths')) console.log(`  ${p.path}: ${p.count} (${p.uniques} únicos)`);
console.log('\nNota: GitHub no distingue tus propias visitas ni descargas; usa --mine N para restar tus visitantes únicos.');
