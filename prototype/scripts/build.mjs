// Empaqueta index.html + src/ en un solo HTML autocontenido.
//   dist/fleetmap.html          -> documento completo, se abre con doble clic
//   dist/fleetmap.artifact.html -> mismo contenido sin <html>/<head>/<body> (vista previa en Claude)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');
let html = read('index.html')
  .replace(/<link rel="stylesheet" href="(src\/[^"]+)">/g, (_, p) => `<style>\n${read(p)}</style>`)
  .replace(/<script src="(src\/[^"]+)"><\/script>\n?/g, (_, p) => `<script>\n${read(p)}</script>\n`);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/fleetmap.html'), html);

const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\n?/, '').replace(/<meta name="viewport"[^>]*>\n?/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync(join(root, 'dist/fleetmap.artifact.html'), head.trim() + '\n' + body.trim() + '\n');
console.log('ok', html.length, 'bytes');
