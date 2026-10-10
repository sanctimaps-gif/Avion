import './ui/styles.css';
import { App } from './ui/app';

/**
 * Point d'entrée : le jeu démarre directement sur l'aéroport (dernière
 * partie jouée, ou nouvelle carrière au tout premier lancement).
 * Aucune ressource réseau n'est utilisée : le jeu fonctionne hors ligne.
 */
const app = new App();
app.start().catch((e: unknown) => {
  const m = document.getElementById('boot-msg');
  if (m) m.textContent = 'Erreur au démarrage : ' + (e instanceof Error ? e.message : String(e));
  console.error(e);
});

// Mise en cache hors ligne quand le jeu est servi en HTTPS (PWA installable).
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* le fichier unique reste jouable hors ligne même sans service worker */
  });
}

// Accès de débogage depuis la console.
(window as unknown as { game: App }).game = app;
