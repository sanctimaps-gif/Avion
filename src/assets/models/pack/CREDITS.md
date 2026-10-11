# Modèles tiers (archives fournies par le propriétaire du dépôt)

Les archives ne contenaient pas de fichier de licence et les pages d'origine n'ont pas été
retrouvées. Ces modèles sont inclus à la demande du propriétaire du dépôt, pour un usage privé.

| Fichier | Source (archive) | Pièce |
|---|---|---|
| `terminal_pack1.glb` | airport-pack-total (`Airport_PackTotal.obj`) | 07.Modulo1 (terminal « AIRPORT ») |
| `terminal_pack2.glb` | airport-pack-total | 07.Modulo2 |
| `escalier_pack.glb` | airport-pack-total | 03.AirplaneStairs |
| `camion_pompiers_pack.glb` | airport-pack-total | 19.Firetruck |
| `bus_piste_pack.glb` | airport-pack-total | 20.PassengerBus |
| `train_bagages_pack.glb` | airport-pack-total | 21.1 + 21.2 + 21.3 (tracteur et deux chariots) |
| `a320.glb` | airbus-a320-s7-airlines (`model.dae`) | avion complet (arêtes supprimées) |
| `a330.glb` | airbus-a330-300 (`Airbus A330-300.glb`) | avion complet |

Chaîne de conversion : `scripts/pack_export.html` (chargement OBJ/DAE dans Three.js, recentrage,
export glTF), puis `scripts/pack_simplify.mjs` et `scripts/pack_sloppy.mjs` (glTF-Transform +
meshoptimizer : fusion, simplification, quantification, textures réduites).

Non retenus : airbus-a220-300 (FBX cassé, pièces déplacées), airport-and-interior et
beaver-county-airport (scènes complètes sans pièces séparables utiles, textures manquantes),
airport (3DS : quelques plaques de piste seulement).
