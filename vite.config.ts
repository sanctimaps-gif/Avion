import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Le jeu est compilé en un unique fichier HTML autonome : aucun accès réseau
// n'est nécessaire à l'exécution (jeu 100 % hors ligne).
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 4000,
    // Point d'entrée de développement : game.html (index.html est le jeu compilé, publié tel quel).
    rollupOptions: { input: 'game.html' },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
