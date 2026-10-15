// Genera la versión web de WipeTime (carpeta web-dist/) para publicarla en GitHub Pages.
// Copia src/, cambia los protocolos propios de Electron (wcicon://, wcmap://, wcmedia://) por rutas web, añade web-api.js
// (el equivalente web de preload.js/main.js) y un service worker para los iconos.
//   node tools/build-web.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'web-dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const proxy = JSON.parse(fs.readFileSync(path.join(root, 'build', 'proxy.json'), 'utf8')).url.replace(/\/+$/, '');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const specKeys = [...mainJs.matchAll(/'([A-Za-z]+-[A-Za-z]+)': \[/g)].map((m) => m[1]);
if (specKeys.length < 30) throw new Error('No se encontraron las especializaciones en main.js');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'src'), out, { recursive: true });

const fill = (s) => s.replaceAll('__PROXY__', proxy).replaceAll('__VERSION__', pkg.version).replaceAll('__SPEC_KEYS__', specKeys.join(','));
fs.writeFileSync(path.join(out, 'web-api.js'), fill(fs.readFileSync(path.join(root, 'tools/web/web-api.js'), 'utf8')));
fs.writeFileSync(path.join(out, 'sw.js'), fill(fs.readFileSync(path.join(root, 'tools/web/sw.js'), 'utf8')));
fs.writeFileSync(path.join(out, '.nojekyll'), '');

let left = 0;
const swap = (s, from, to, file) => {
  if (!s.includes(from)) return s;
  left++;
  return s.split(from).join(to);
};
for (const f of fs.readdirSync(out)) {
  if (!/\.(js|html|css)$/.test(f) || f === 'web-api.js' || f === 'sw.js') continue;
  const p = path.join(out, f);
  let s = fs.readFileSync(p, 'utf8');
  s = swap(s, 'wcicon://i/', 'ic/');
  s = swap(s, 'wcmedia://m/${encodeURIComponent(u)}', '${u}');
  s = swap(s, 'wcmap://m/${e.path}', '${window.WT_PROXY}/map?p=${encodeURIComponent(e.path)}');
  if (f === 'index.html') {
    s = s.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/,
      `<meta http-equiv="Content-Security-Policy"\n        content="default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ${proxy} https://raider.io https://nether.wowhead.com https://www.raidbots.com; worker-src 'self'; frame-src 'self'">`);
    s = s.replace('<script src="boot.js"></script>', '<script src="web-api.js"></script>\n  <script src="boot.js"></script>');
    s = s.replace('<title>WipeTime</title>', '<title>WipeTime</title>\n  <link rel="icon" href="icon.png">');
  }
  fs.writeFileSync(p, s);
}
const bad = [];
for (const f of fs.readdirSync(out)) {
  if (!/\.(js|html|css)$/.test(f) || f === 'web-api.js' || f === 'sw.js') continue;
  if (/wc(icon|map|media):\/\//.test(fs.readFileSync(path.join(out, f), 'utf8'))) bad.push(f);
}
if (bad.length) throw new Error('Quedan protocolos de Electron sin sustituir en: ' + bad.join(', '));
console.log(`web-dist listo: v${pkg.version}, proxy ${proxy}, ${specKeys.length} specs, ${left} sustituciones`);
