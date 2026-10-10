// Après la compilation : dist/game.html devient dist/index.html (Capacitor, PWA)
// et une copie du jeu compilé est placée à la racine du dépôt, afin que
// GitHub Pages (publication depuis la branche) serve directement le jeu jouable.
import { copyFileSync, renameSync } from 'node:fs';

renameSync('dist/game.html', 'dist/index.html');
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg']) copyFileSync(`dist/${f}`, f);
console.log('Jeu compilé copié à la racine (index.html) pour GitHub Pages.');
