# Architecture

```
src/
  core/      rng (aléatoire déterministe), i18n, formatage, bus d'événements
  data/      catalogues configurables : bâtiments, avions, compagnies, destinations,
             météo, incidents, recherche, paliers, objectifs, scénarios, personnel
  sim/       simulation (aucune dépendance graphique)
  save/      stockage local, gestion des parties, migrations
  render/    vues graphiques + contrôles tactiles
  ui/        interface (barre, navigation, panneaux, dialogues)
  locales/   fr.ts, en.ts
tests/       Vitest : simulation, sauvegardes, gameplay, complétude des traductions
scripts/     tests navigateur Playwright (réseau bloqué)
android/ ios/  projets natifs Capacitor
```

## Principes

1. **Un seul état, une seule simulation.** `GameState` (`sim/types.ts`) est un objet JSON pur :
   il est sauvegardé tel quel. Les quatre vues lisent cet état sans le modifier.
2. **Données séparées des mécaniques.** Ajouter un bâtiment, un avion, une compagnie, un incident
   ou une technologie = ajouter une entrée dans `src/data/*` et ses traductions.
3. **Structures dérivées recalculées.** `sim/world.ts` construit (et met en cache par révision)
   la grille d'occupation, les réseaux taxiway/route, les groupes de terminal, les postes accessibles,
   les capacités. Toute modification d'infrastructure appelle `invalidateWorld()`.
4. **Déterminisme.** Tout tirage passe par `core/rng.ts` dont l'état est dans la sauvegarde.

## Modules de simulation (`src/sim`)

| Module | Rôle | Dépend de |
|---|---|---|
| `simulation.ts` | Boucle minute (`tick`), clôture de journée, horloge réelle → jeu | tous |
| `world.ts` | Grille, réseaux, raccordements, capacités, BFS de roulage | data/buildings |
| `construction.ts` | Placement, collisions, terrain, amélioration, déplacement, démolition | world, economy |
| `flights.ts` | Création des vols, cycle opérationnel, pistes, postes, ATC | world, staff, modifiers |
| `passengers.ts` | Cohortes, files, vols manqués, correspondances, commerces, satisfaction | flights (hooks), staff |
| `airlines.ts` | Offres, négociation, contrats, renouvellements | economy |
| `economy.ts` | Grand livre, coûts fixes, emprunts, impôts, historique, ROI | world |
| `staff.ts` | Besoins, présence (planning, grèves), efficacité, formation | world, modifiers |
| `weather.ts` | Chaîne de Markov saisonnière, prévisions | data/weather |
| `incidents.ts` | Tirages, effets, interventions, usure, réparations | world, economy |
| `research.ts` / `modifiers.ts` | Technologies et agrégation des effets | data/research |
| `progression.ts` | Paliers, objectifs, victoire/défaite des scénarios | economy, flights |

Les liens flights → passengers/airlines passent par `flightHooks` (pas d'import circulaire).

## Rendu (`src/render`)

- `ground.ts` dessine le sol et les infrastructures plates **dans n'importe quelle projection**
  (plane, isométrique) ; la même image sert de texture au sol 3D. Mise en cache hors écran.
- `view2d.ts` (vues 2D et hybride), `viewIso.ts`, `view3d.ts` implémentent `GameView`
  (`render`, `screenToTile`, `pan`, `zoom`, `rotate`). La caméra (`Camera`) est partagée :
  changer de vue conserve la position.
- `interior3d.ts` : vue intérieure, mode de `View3D` (même contexte WebGL) ; bâtiments de l'aérogare en coupe
  (mobilier instancié) et foule (`Crowd`, InstancedMesh) placée chaque image selon `s.pax`.
- Mode contrôleur : `sim/flights.ts` (`pendingAction`, limites d'assistance, services), `sim/control.ts` (ordres du
  joueur), `ui/control.ts` (strips et bloc d'ordres de la fiche avion). Test : `tests/control.test.ts`.
- `overlays.ts` : couches de la vue hybride. `input.ts` : gestes tactiles (Pointer Events).
- Les positions des avions sont interpolées entre deux minutes de simulation.

### Échelle

Une case vaut 11 m pour tout ce qui se voit : avions (dimensions réelles, ex. A380 6,6 × 7,3 cases),
véhicules, bâtiments, postes (S 4, M 5, L 7, XL 8 cases) et largeur des pistes (chaussée + accotements
de 0,6 case, `SHOULDER` dans `render/ground.ts`, où circulent pompiers, chasse-neige et véhicule
d'inspection). Seule la longueur des pistes est raccourcie, sinon la carte serait dix fois plus grande.

### Aéroport de départ

`SMALL_LAYOUT` (`sim/state.ts`) pose le minimum d'un aéroport régional : piste, taxiway parallèle,
trois postes devant l'aérogare, hangar, aire de carburant, caserne SSLIA, aviation générale, hélistation,
tour, centre des opérations, bâtiment administratif, voies de service, dépose-minute, parkings
(voyageurs, personnel, loueurs). Les engins d'escale circulent sur les voies de service
(`render/serviceTraffic.ts`).

## Sauvegardes (`src/save`)

- `storage.ts` : IndexedDB (transactions atomiques) → repli localStorage (écriture via clés
  temporaires) → mémoire (tests).
- `saveManager.ts` : emplacement par partie `save:<id>`, copie de secours `save:<id>:bak`
  (remplacée seulement si l'ancienne est saine), index et dernière partie dans **la même transaction**.
  Enveloppe `{format, version, checksum, data}` ; à la lecture, une somme invalide bascule sur la copie.
- `migrations.ts` : `MIGRATIONS[v]` convertit v → v+1 ; incrémenter `SAVE_VERSION` dans `sim/state.ts`.
- Sauvegarde automatique (intervalle réglable), à la mise en arrière-plan et à la fermeture.

## Performances

- Passagers simulés en cohortes (pas d'agents individuels) ; besoins en personnel et coûts fixes
  mémorisés tant que l'infrastructure ne change pas (≈ 27 µs par minute simulée sur un aéroport de départ).
- Sol pré-rendu en cache ; 3D : géométries/matériaux partagés, véhicules en `InstancedMesh`,
  ombres et particules désactivées en qualité « faible ».

## Ajouter une langue

Créer `src/locales/xx.ts` (mêmes clés que `fr.ts`), l'enregistrer dans `core/i18n.ts`.
Le test `tests/i18n.test.ts` vérifie que chaque clé utilisée existe dans chaque langue.

## Évolutions possibles (non implémentées)

Multijoueur/services en ligne : l'état étant sérialisable et la simulation déterministe, une future
couche `online/` pourrait synchroniser des sauvegardes ou des défis communs sans toucher à `sim/`.
Aucune clé ni secret ne doit être embarqué dans le client.
