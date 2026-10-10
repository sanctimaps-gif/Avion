# Assets aéroport — low-poly 3D (.glb)

Format glTF 2.0 binaire, lisible par Three.js, Godot, Unity (via glTFast), Blender.

- Unités : mètres, axe Y vers le haut, origine au sol.
- Avions : le nez pointe vers +Z.
- Matériaux PBR à couleur unie (pas de textures), ombrage plat.

## Fichiers

| Fichier | Taille approx. (L × H × P) | Triangles |
|---|---|---|
| batiments/terminal.glb | 84 × 16 × 58 m | 624 |
| batiments/tour_controle.glb | 14 × 47 × 10 m | 312 |
| batiments/hangar.glb | 55 × 17 × 60 m | 252 |
| batiments/caserne_pompiers.glb | 37 × 19 × 32 m | 520 |
| batiments/parking.glb | 45 × 14 × 30 m | 3 680 |
| batiments/hotel.glb | 38 × 51 × 31 m | 432 |
| avions/turbopropulseur.glb | envergure 27, long. 27 m | 1 144 |
| avions/moyen_courrier.glb | envergure 35, long. 38 m | 1 184 |
| avions/gros_porteur.glb | envergure 65, long. 69 m | 1 872 |

### Véhicules (avant vers +Z)

| Fichier | Taille approx. (l × H × L) | Nœuds animables |
|---|---|---|
| vehicules/voiture.glb | 1,9 × 1,5 × 4,5 m | `roues` (matériau `red` recolorable) |
| vehicules/bus.glb | 3,0 × 3,3 × 12 m | `roues` |
| vehicules/camion_citerne.glb | 2,6 × 3,6 × 10 m | `roues` |
| vehicules/tracteur_repoussage.glb | 3,4 × 2,4 × 11 m (barre incluse) | `barre_remorquage`, `roues` |
| vehicules/train_bagages.glb | 1,6 × 2,2 × 14 m | `tracteur`, `chariot_1` à `chariot_3` |
| vehicules/camion_pompiers.glb | 3,1 × 4,0 × 11 m | `lance` (canon à mousse), `roues` |
| vehicules/chasse_neige.glb | 4,0 × 3,2 × 12,5 m | `lame`, `roues` |
| vehicules/engin_degivrage.glb | 2,6 × 11 × 10 m | `fleche` (pivot à la base) |
| vehicules/train.glb | 3,0 × 4,5 × 62 m | `voiture_1` à `voiture_3` |

Les éléments au sol (pistes, taxiways, routes, postes, parkings au sol,
panneaux solaires, aires de dégivrage) sont dessinés à plat dans la scène.

## Nœuds des avions

`fuselage`, `ailes`, `empennage`, `moteurs`, `train` — et pour le turbopropulseur
`helice_gauche` / `helice_droite`, dont le pivot est au moyeu : une rotation
sur l'axe Z local fait tourner l'hélice.

Exemple Three.js :

```js
const gltf = await new GLTFLoader().loadAsync('avions/turbopropulseur.glb');
const props = ['helice_gauche', 'helice_droite'].map(n => gltf.scene.getObjectByName(n));
// dans la boucle de rendu :
props.forEach(p => p.rotation.z += 0.6);
```

## Scène de démo (Three.js)

`scene.html` place les 9 modèles sur un aéroport : piste 09/27, taxiway B,
aire de trafic, deux avions au contact, un turbopropulseur sur poste éloigné,
un autre qui roule (hélices animées) et un moyen-courrier qui décolle en boucle.

```bash
python -m http.server 8000   # depuis ce dossier, puis http://localhost:8000/scene.html
```

Le placement et les animations sont dans `scene_template.html` ;
`python build_scene.py` régénère `scene.html` (`--embed fichier.html` produit
une version autonome avec les modèles intégrés).

## Régénérer / modifier

`python generate_assets.py [dossier]` — nécessite seulement numpy.
Les couleurs sont dans `PALETTE`, chaque modèle a sa fonction (`terminal()`, `hangar()`, …).
