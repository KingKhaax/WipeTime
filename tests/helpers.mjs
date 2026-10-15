import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
export const srcFiles = () => fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`);

/**
 * Ejecuta uno o varios archivos de src/ en un contexto aislado (sin navegador).
 * Devuelve { S, $ }: S es el estado simulado y $(expr) evalúa una expresión dentro del contexto
 * (las constantes de nivel superior, como CLASSES o STRINGS, solo se alcanzan así).
 */
export function load(files, extra = {}) {
  const S = { lang: 'es' };
  const noop = () => {};
  const el = () => ({ style: {}, classList: { add: noop, remove: noop }, appendChild: noop, addEventListener: noop, setAttribute: noop });
  const ctx = vm.createContext({
    console, S, window: {}, localStorage: { getItem: () => null, setItem: noop },
    document: { createElement: el, head: { appendChild: noop }, body: { appendChild: noop }, addEventListener: noop, getElementById: () => null, querySelector: () => null },
    ...extra,
  });
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  return { S, ctx, $: (expr) => vm.runInContext(expr, ctx) };
}
