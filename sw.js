// Service worker : met en cache le jeu pour un fonctionnement 100 % hors ligne
// lorsqu'il est servi en HTTPS (PWA). Le jeu est un fichier unique autonome.
const CACHE = 'airport-manager-v3-mv481300';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', "./game-assets/a320-DLCzQv5A.glb", "./game-assets/a330-Bm2VZL_p.glb", "./game-assets/a380-CvtDf-Be.glb", "./game-assets/abribus-yX2nBrmY.glb", "./game-assets/apple-touch-icon-DiCqYbwx.png", "./game-assets/avion3_bs-BqBN5rG8.glb", "./game-assets/b777-BywEK912.glb", "./game-assets/batiment_marin-B8HvV9sx.glb", "./game-assets/boutique-CcW9ofDM.glb", "./game-assets/bus_piste_pack-CNDbZa8u.glb", "./game-assets/bus_ville-D6B6R-zO.glb", "./game-assets/cafe-DfYOyTi9.glb", "./game-assets/camion_citerne-gKC_aC2n.glb", "./game-assets/camion_pompiers_pack-CY8XqJrA.glb", "./game-assets/caserne_pompiers-11yIaJGk.glb", "./game-assets/catering-Cb8NjLtg.glb", "./game-assets/centrale-ChUl2zV9.glb", "./game-assets/chasse_neige-BVf2qjN9.glb", "./game-assets/comptoir-CAZEFG-D.glb", "./game-assets/dab--QuZ7ngJ.glb", "./game-assets/engin_degivrage-RkN1OFzG.glb", "./game-assets/escalier_pack-a_KvoT-g.glb", "./game-assets/foret-Cg5i2cno.glb", "./game-assets/gare-D9pvtL_T.glb", "./game-assets/gpu-BTzkqdCB.glb", "./game-assets/hangar-D1Ju35YQ.glb", "./game-assets/hangar_fret-CZR_nDMy.glb", "./game-assets/hors_taxes-B7R7lw4E.glb", "./game-assets/hotel-CyXGlnTr.glb", "./game-assets/immeuble-BR0S4cjA.glb", "./game-assets/kiosque-C0KgwKZr.glb", "./game-assets/location-CkegeGVK.glb", "./game-assets/locomotive-BOsggH1p.glb", "./game-assets/manifest-CqJT0rU9.webmanifest", "./game-assets/moto-C-va1Ash.glb", "./game-assets/moyen_courrier-CXftl_Uy.glb", "./game-assets/panneau-DejrT8G6.glb", "./game-assets/parking-DGPZ0-A7.glb", "./game-assets/parking-DQanNqp2.glb", "./game-assets/passerelle-ZFVh_d2V.glb", "./game-assets/plante-BWS6OrUh.glb", "./game-assets/police-DdcT6688.glb", "./game-assets/porte-DpTSNKaw.glb", "./game-assets/poteau-Bm8W69yq.glb", "./game-assets/poubelle-DuNZYN_H.glb", "./game-assets/pub-D8HD9bNA.glb", "./game-assets/q400-c7u04bnE.glb", "./game-assets/restaurant_pack-BHP4eWeJ.glb", "./game-assets/sieges-xYaaHebt.glb", "./game-assets/solaire-C10bjwwY.glb", "./game-assets/station-V9JeWMxe.glb", "./game-assets/surete-Bc3KSpRg.glb", "./game-assets/tapis_bagages-CKhTomw-.glb", "./game-assets/terminal-ZITfnF5i.glb", "./game-assets/terminal_pack1-jUYLPcWv.glb", "./game-assets/terminal_pack2-VRkUvj44.glb", "./game-assets/tour_controle-CFOqCYfl.glb", "./game-assets/tour_controle_bs-BSi6V0Z7.glb", "./game-assets/tracteur_repoussage-CHYFULsB.glb", "./game-assets/train_bagages_pack-D4fycgph.glb", "./game-assets/train_sf-BiYkKnop.glb", "./game-assets/valise-CSCVDIcB.glb", "./game-assets/voiture-CRLsYxX9.glb", "./game-assets/voiture_ferrari-Dwx_mxjs.glb", "./game-assets/voiture_merco-9sz7WAye.glb", "./game-assets/voiture_s13-3aq0jJX9.glb", "./game-assets/voiture_shelby-BAYDdd6K.glb"];
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Réseau d'abord (toujours la dernière version), cache en secours hors ligne.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
