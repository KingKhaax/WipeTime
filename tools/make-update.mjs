// Genera dist/latest.json para el sistema de actualización de WipeTime.
// Uso:  node tools/make-update.mjs <url-base>  [notas]
//   <url-base> = carpeta pública donde subirás los .exe, p. ej. https://miservidor.com/wipetime
//                (en GitHub Releases no hace falta: el programa lee las Releases directamente con "usuario/repositorio")
// Después sube a esa carpeta los dos .exe de dist/ y el latest.json, y en WipeTime > Ajustes > Versión
// pon como fuente la dirección de latest.json (https://miservidor.com/wipetime/latest.json).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const base = (process.argv[2] || '').replace(/\/$/, '');
const notes = process.argv.slice(3).join(' ');
if (!base) { console.error('Falta la URL base. Ejemplo: node tools/make-update.mjs https://miservidor.com/wipetime'); process.exit(1); }

const setup = `WipeTime v${pkg.version} Setup.exe`;
const portable = `WipeTime v${pkg.version}.exe`;
const sha = (f) => createHash('sha256').update(readFileSync(join(root, 'dist', f))).digest('hex');
for (const f of [setup, portable]) if (!existsSync(join(root, 'dist', f))) { console.error(`No existe dist/${f}: ejecuta antes "npm run dist".`); process.exit(1); }

const manifest = {
  version: pkg.version,
  notes,
  setup: `${base}/${encodeURIComponent(setup)}`,
  portable: `${base}/${encodeURIComponent(portable)}`,
  sha256: sha(setup),
  sha256Portable: sha(portable),
};
writeFileSync(join(root, 'dist', 'latest.json'), JSON.stringify(manifest, null, 2));
console.log('dist/latest.json creado para la versión', pkg.version);
