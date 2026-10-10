# Airport Manager

Jeu de gestion d'aéroport pour téléphone (Android, iOS) et navigateur, **100 % hors ligne**.
Le jeu s'ouvre directement sur l'aéroport : pas d'écran de présentation. Au premier lancement,
une partie Carrière est créée ; ensuite, la dernière partie jouée reprend automatiquement.

## Jouer

| Plateforme | Comment |
|---|---|
| GitHub Pages | Le fichier `index.html` à la racine du dépôt est le jeu compilé : avec Pages réglé sur la branche `main` (dossier racine), le jeu est jouable à l'adresse du site. |
| N'importe quel appareil | `npm run build`, puis ouvrir `dist/index.html` dans Safari/Chrome (fichier unique autonome, fonctionne sans réseau ; l'aperçu de l'app Fichiers ne lance pas le jeu). |
| Web installable (PWA) | Servir `dist/` en HTTPS (ex. workflow « Publier la version web » sur GitHub Pages) → « Ajouter à l'écran d'accueil ». Le service worker met le jeu en cache pour le hors-ligne. |
| Android | `npm run android` (Android Studio requis) ou télécharger l'APK de débogage produit par la CI (artefact `airport-manager-android-debug`). |
| iOS | `npm run ios` sur un Mac avec Xcode + CocoaPods (`cd ios/App && pod install` la première fois). |

### Commandes tactiles
- 1 doigt : déplacer la caméra · pincement : zoom · 2 doigts en rotation : pivoter (3D, isométrique).
- Appui court : sélectionner un bâtiment ou un avion (fiche contextuelle).
- Construction : choisir un élément, toucher l'emplacement (ou faire glisser le fantôme), ⟳ pour pivoter, ✓ pour valider.
  Routes et taxiways : toucher la case de départ puis la case d'arrivée (tracé en L).
- Souris : molette = zoom, clic droit + glisser = rotation / inclinaison.

## Développement

```bash
npm install
npm run dev        # serveur de développement (ouvrir /game.html)
# index.html (racine) = jeu compilé, régénéré par npm run build : à committer après chaque build
npm test           # tests unitaires et de simulation (Vitest)
npm run build      # vérification TypeScript + fichier unique dist/index.html
npm run test:e2e   # tests navigateur (Chromium, réseau bloqué) + captures dans screenshots/
```

## Choix techniques

Unity n'est pas disponible dans cet environnement de développement (ni SDK mobile).
Le jeu est donc écrit en **TypeScript** avec **Canvas 2D** (vues 2D, isométrique, hybride) et
**Three.js** (vue 3D), compilé par **Vite** en un seul fichier HTML sans dépendance réseau,
et empaqueté pour Android/iOS avec **Capacitor**. Avantages : un seul code pour toutes les
plateformes, démarrage instantané, tests automatisés de la simulation sans moteur.
Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## État des fonctionnalités

Fonctionnel et testé (tests automatisés et/ou parcours dans Chromium) :
- Carte 96×72 aux limites naturelles : mer et plage à l'est, rivière, forêts, champs, village voisin
  (eau et village non constructibles), clôture du périmètre, caméra bornée à la carte.
- Modèles 3D importés (`src/assets/models/*.glb`, intégrés au fichier unique) : terminal, tour, hangar,
  caserne, parking, hôtel, turbopropulseur (hélices animées), moyen-courrier, gros-porteur (couleurs
  de la compagnie). Les autres bâtiments utilisent des modèles procéduraux.
- Véhicules 3D instanciés (`src/assets/models/vehicules/`, allégés par `scripts/lowpoly_vehicles.py`) :
  voitures et bus sur les routes et l'autoroute, camion-citerne, train de bagages, bus de piste,
  tracteur de repoussage, engin de dégivrage, camions de pompiers (sur la piste en cas d'incident),
  chasse-neige sur les pistes enneigées, train en gare. Qualité « Faible » : cubes simples.
- Simulation unique minute par minute, déterministe (même sauvegarde ⇒ mêmes événements).
- 4 vues sur la même simulation : 2D, 3D réaliste (ombres, cycle jour/nuit, brouillard, pluie/neige,
  fenêtres éclairées la nuit), isométrique (rotation par quarts de tour), hybride (8 couches : trafic,
  passagers, sûreté, finances, congestion, logistique, personnel, nuisances).
- Construction : ~45 bâtiments (pistes, taxiways, postes S→XL, tours, ILS, terminaux, jetées, modules,
  commerces, parkings, gares, énergie, R&D…), prix, durée de chantier, entretien, capacités, personnel
  requis, contraintes de placement (collisions, eau, terrain acquis, raccordement terminal/route/taxiway/piste),
  amélioration, déplacement, démolition, achat de terrain.
- Trafic aérien : approche, attente, atterrissage, roulage (plus court chemin sur les taxiways), débarquement,
  escale, embarquement, roulage, file d'attente piste, décollage ; déroutements, annulations, retards
  causés (piste, poste, météo, dégivrage, personnel, itinéraire) ; capacité ATC, vent de travers, ILS.
- Compagnies (12 profils fictifs) : offres, négociation, contrats, horaires modifiables, installations dédiées,
  renouvellement / extension / réduction / départ selon la qualité de service et les redevances.
- Passagers agrégés par cohortes : files d'enregistrement, sûreté, bagages, vols manqués, correspondances
  (hubs), dépenses en commerces, parkings, satisfaction détaillée (9 composantes).
- Économie : grand livre, coûts fixes/variables, emprunts, impôts, faillite, prévisions, compte de résultat
  jour/semaine/mois/année, rentabilité et ROI par bâtiment, exploitation directe ou concession.
- Personnel : 9 catégories, recrutement, planning, salaires, moral, formation, grèves.
- Météo dynamique (12 conditions, saisons, prévisions 48 h) avec effets opérationnels ; 13 types d'incidents
  configurables avec interventions d'urgence ; usure et maintenance préventive.
- Recherche : 24 technologies en 10 branches. Progression : 7 paliers, objectifs court/moyen/long terme.
- Modes : Carrière, Bac à sable, Défis (4), Événements (3), Défi de la semaine.
- Parties multiples : créer, charger, renommer, supprimer (avec confirmation), exporter/importer, miniature ;
  sauvegarde automatique, transactionnelle (IndexedDB), copie de secours, somme de contrôle, migrations.
- Interface mobile FR/EN (portrait et paysage), tailles de texte, qualité graphique.

Non réalisé / limites (honnêtement) :
- **Multijoueur et services en ligne : non implémentés** (le jeu est volontairement 100 % hors ligne).
  Le classement compare uniquement les aéroports présents sur l'appareil.
- Pas de son. Les modèles 3D sont procéduraux (pas d'assets artistiques).
- L'APK Android et le projet iOS n'ont pas pu être compilés ici (SDK Android inaccessible, pas de macOS) :
  la CI GitHub compile l'APK de débogage ; la publication sur les stores reste à faire (signature, comptes développeur).
- La vue isométrique pivote par quarts de tour ; les passagers ne sont pas dessinés individuellement
  (simulation agrégée, visible par les files et la couche « Passagers »).
