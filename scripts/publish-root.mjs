// Après la compilation : dist/game.html devient dist/index.html (Capacitor, PWA),
// le service worker reçoit la liste des fichiers à mettre en cache (jeu hors ligne),
// et une copie du jeu compilé est placée à la racine du dépôt pour GitHub Pages.
import { copyFileSync, cpSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

renameSync('dist/game.html', 'dist/index.html');
const assets = readdirSync('dist/game-assets').map((f) => `./game-assets/${f}`);
const sw = readFileSync('dist/sw.js', 'utf8').replace(/const ASSETS = \[[^\]]*\];/, (m) => m.replace('];', `, ${assets.map((a) => JSON.stringify(a)).join(', ')}];`));
// Nouvelle version du cache à chaque compilation (les anciens fichiers sont supprimés).
const version = Date.now().toString(36);
writeFileSync('dist/sw.js', sw.replace(/const CACHE = '([^']*)';/, `const CACHE = '$1-${version}';`));
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) copyFileSync(`dist/${f}`, f);
rmSync('game-assets', { recursive: true, force: true });
cpSync('dist/game-assets', 'game-assets', { recursive: true });
console.log(`Jeu compilé copié à la racine (index.html + ${assets.length} fichiers dans game-assets/) pour GitHub Pages.`);
