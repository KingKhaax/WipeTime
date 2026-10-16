// Genera la versión web de WipeTime (carpeta web-dist/) para publicarla en GitHub Pages.
// Copia src/, cambia los protocolos propios de Electron (wcicon://, wcmap://, wcmedia://) por rutas web, añade web-api.js
// (el equivalente web de preload.js/main.js) y un service worker para los iconos.
//   node tools/build-web.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'web-dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const proxy = JSON.parse(fs.readFileSync(path.join(root, 'build', 'proxy.json'), 'utf8')).url.replace(/\/+$/, '');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const specKeys = [...mainJs.matchAll(/'([A-Za-z]+-[A-Za-z]+)': \[/g)].map((m) => m[1]);
if (specKeys.length < 30) throw new Error('No se encontraron las especializaciones en main.js');

// esbuild se instala aparte en CI (carpeta .esb) para no descargar todo el árbol de dependencias de la app
function loadEsbuild() {
  for (const base of [root, path.join(root, '.esb')]) {
    try { return createRequire(path.join(base, 'noop.js'))('esbuild'); } catch { /* siguiente sitio */ }
  }
  return null;
}

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
// ---- Optimización de la carga: un solo paquete de scripts minificado, un solo CSS minificado, fuentes precargadas y conexiones tempranas.
// Sin esbuild instalado la web se publica igual, solo que sin minificar (npm i --no-save esbuild).
const esbuild = loadEsbuild();
if (!esbuild) console.log('esbuild no está instalado: la web se publica sin minificar');
if (esbuild) {
  const indexPath = path.join(out, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const keepSync = new Set(['web-api.js', 'boot.js']); // web-api y boot (tema) siguen cargándose antes de pintar
  const tags = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const bundleFiles = tags.filter((f) => !keepSync.has(f));
  if (!bundleFiles.length) throw new Error('No hay scripts que empaquetar');
  // todos los scripts son «use strict» y comparten el ámbito global (const/let de nivel superior): se concatenan en ese mismo orden
  const strict = (s) => /^\s*(['"])use strict\1/.test(s);
  const sources = bundleFiles.map((f) => { const s = fs.readFileSync(path.join(out, f), 'utf8'); if (!strict(s)) throw new Error(f + ' no es use strict'); return s.replace(/^\s*(['"])use strict\1;?/, ''); });
  const bundle = esbuild.transformSync("'use strict';\n" + sources.join(';\n'), { minify: true, target: 'es2020', legalComments: 'none' }).code;
  fs.writeFileSync(path.join(out, 'app.bundle.js'), bundle);
  const css = ['fonts.css', 'styles.css'].map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
  fs.writeFileSync(path.join(out, 'app.css'), esbuild.transformSync(css, { loader: 'css', minify: true, legalComments: 'none' }).code);
  const v = pkg.version;
  for (const f of bundleFiles) html = html.replace(new RegExp('\\s*<script src="' + f.replace('.', '\\.') + '"></script>'), '');
  html = html.replace('<link rel="stylesheet" href="fonts.css">', '').replace('<link rel="stylesheet" href="styles.css">', '<link rel="stylesheet" href="app.css?v=' + v + '">')
    .replace('<script src="web-api.js"></script>', '<script src="web-api.js?v=' + v + '"></script>').replace('<script src="boot.js"></script>', '<script src="boot.js?v=' + v + '"></script>\n  <script defer src="app.bundle.js?v=' + v + '"></script>');
  const hints = ['<link rel="preconnect" href="' + proxy + '" crossorigin>', '<link rel="preconnect" href="https://wow.zamimg.com" crossorigin>',
    ...['400', '600', '700'].map((w) => '<link rel="preload" href="fonts/noto-sans-latin-' + w + '-normal.woff2" as="font" type="font/woff2" crossorigin>')].join('\n  ');
  html = html.replace('<title>', hints + '\n  <title>');
  fs.writeFileSync(indexPath, html);
  const before = bundleFiles.reduce((s, f) => s + fs.statSync(path.join(out, f)).size, 0) + fs.statSync(path.join(out, 'styles.css')).size + fs.statSync(path.join(out, 'fonts.css')).size;
  console.log(`optimizada: ${bundleFiles.length} scripts → app.bundle.js (${(bundle.length / 1024).toFixed(0)} KB), CSS → app.css; ${(before / 1024).toFixed(0)} KB → ${((bundle.length + fs.statSync(path.join(out, 'app.css')).size) / 1024).toFixed(0)} KB`);
}
console.log(`web-dist listo: v${pkg.version}, proxy ${proxy}, ${specKeys.length} specs, ${left} sustituciones`);
