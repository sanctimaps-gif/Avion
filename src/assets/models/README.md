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

## Régénérer / modifier

`python generate_assets.py [dossier]` — nécessite seulement numpy.
Les couleurs sont dans `PALETTE`, chaque modèle a sa fonction (`terminal()`, `hangar()`, …).
