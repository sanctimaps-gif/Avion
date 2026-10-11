// Variante « aperçu claude.ai » : l'hébergeur de l'aperçu ne sert pas les fichiers .glb ;
// les modèles sont regroupés dans des scripts (URL data: en base64) chargés avant le jeu.
// Usage : node scripts/artifact-pack.mjs <dossier de sortie>
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'artifact';
mkdirSync(join(out, 'game-assets'), { recursive: true });
const files = readdirSync('game-assets').filter((f) => f.endsWith('.glb'));
const packs = [];
let cur = '';
for (const f of files) {
  const line = `(window.__GLB = window.__GLB || {})[${JSON.stringify(f)}] = "data:application/octet-stream;base64,${readFileSync(join('game-assets', f)).toString('base64')}";\n`;
  if (cur.length + line.length > 12_000_000 && cur) {
    packs.push(cur);
    cur = '';
  }
  cur += line;
}
if (cur) packs.push(cur);
const names = packs.map((p, i) => {
  const n = `game-assets/modeles-${i + 1}.js`;
  writeFileSync(join(out, n), p);
  return n;
});
const tags = names.map((n) => `<script src="./${n}"></script>`).join('');
const html = readFileSync('index.html', 'utf8').replace('<head>', `<head>${tags}`);
writeFileSync(join(out, 'index.html'), html);
for (const f of readdirSync('game-assets').filter((f) => !f.endsWith('.glb'))) writeFileSync(join(out, 'game-assets', f), readFileSync(join('game-assets', f)));
console.log(`${files.length} modèles regroupés dans ${names.length} scripts → ${out}/`);
