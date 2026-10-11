import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Le code du jeu est compilé dans un fichier HTML unique ; les modèles 3D (.glb) sont
// des fichiers à côté (dossier game-assets/), mis en cache par le service worker et
// inclus dans l'application Android/iOS : le jeu reste 100 % hors ligne.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ useRecommendedBuildConfig: false, removeViteModuleLoader: true })],
  assetsInclude: ['**/*.glb'],
  build: {
    target: 'es2020',
    // Tout est intégré au HTML sauf les modèles 3D, émis comme fichiers séparés.
    assetsInlineLimit: (file: string) => !file.endsWith('.glb'),
    assetsDir: 'game-assets',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    // Point d'entrée de développement : game.html (index.html est le jeu compilé, publié tel quel).
    rollupOptions: { input: 'game.html', output: { inlineDynamicImports: true } },
  },
  // Le code est intégré au HTML : les adresses des modèles sont résolues par rapport à la page.
  experimental: {
    renderBuiltUrl: (filename: string, { hostType }: { hostType: string }) =>
      hostType === 'js' ? { runtime: `new URL(${JSON.stringify(filename)}, document.baseURI).href` } : { relative: true },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
