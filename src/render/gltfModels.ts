import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import terminalUrl from '../assets/models/terminal.glb?url';
import towerUrl from '../assets/models/tour_controle.glb?url';
import hangarUrl from '../assets/models/hangar.glb?url';
import fireUrl from '../assets/models/caserne_pompiers.glb?url';
import parkingUrl from '../assets/models/parking.glb?url';
import hotelUrl from '../assets/models/hotel.glb?url';
import mediumUrl from '../assets/models/moyen_courrier.glb?url';
import carUrl from '../assets/models/vehicules/voiture.glb?url';
import fuelUrl from '../assets/models/vehicules/camion_citerne.glb?url';
import tugUrl from '../assets/models/vehicules/tracteur_repoussage.glb?url';
import plowUrl from '../assets/models/vehicules/chasse_neige.glb?url';
import deicerUrl from '../assets/models/vehicules/engin_degivrage.glb?url';
import towerBigUrl from '../assets/models/sketchfab/tour_controle_bs.glb?url';
import rearJetUrl from '../assets/models/sketchfab/avion3_bs.glb?url';
import shopUrl from '../assets/models/sketchfab/boutique.glb?url';
import cafeUrl from '../assets/models/sketchfab/cafe.glb?url';
import dutyFreeUrl from '../assets/models/sketchfab/hors_taxes.glb?url';
import officeUrl from '../assets/models/sketchfab/batiment_marin.glb?url';
import carParkUrl from '../assets/models/sketchfab/parking.glb?url';
import busStopUrl from '../assets/models/sketchfab/abribus.glb?url';
import stationUrl from '../assets/models/sketchfab/gare.glb?url';
import forestUrl from '../assets/models/sketchfab/foret.glb?url';
import cityBusUrl from '../assets/models/sketchfab/bus_ville.glb?url';
import policeUrl from '../assets/models/sketchfab/police.glb?url';
import trainUrl from '../assets/models/sketchfab/train_sf.glb?url';
import q400Url from '../assets/models/sketchfab/q400.glb?url';
import beltUrl from '../assets/models/sketchfab/tapis_bagages.glb?url';
import cateringUrl from '../assets/models/sketchfab/catering.glb?url';
import carS13Url from '../assets/models/sketchfab/voiture_s13.glb?url';
import b777Url from '../assets/models/sketchfab/b777.glb?url';
import gpuUrl from '../assets/models/sketchfab/gpu.glb?url';
import jetwayUrl from '../assets/models/sketchfab/passerelle.glb?url';
import locoUrl from '../assets/models/sketchfab/locomotive.glb?url';
import carMercoUrl from '../assets/models/sketchfab/voiture_merco.glb?url';
import carFerrariUrl from '../assets/models/sketchfab/voiture_ferrari.glb?url';
import carShelbyUrl from '../assets/models/sketchfab/voiture_shelby.glb?url';
import motoUrl from '../assets/models/sketchfab/moto.glb?url';
import rentalUrl from '../assets/models/sketchfab/location.glb?url';
import restaurantUrl from '../assets/models/sketchfab/restaurant_pack.glb?url';
import a380Url from '../assets/models/sketchfab/a380.glb?url';
import powerUrl from '../assets/models/sketchfab/centrale.glb?url';
import fuelStationUrl from '../assets/models/sketchfab/station.glb?url';
import solarUrl from '../assets/models/sketchfab/solaire.glb?url';
import cargoUrl from '../assets/models/sketchfab/hangar_fret.glb?url';
import adminUrl from '../assets/models/sketchfab/immeuble.glb?url';
import termPack1Url from '../assets/models/pack/terminal_pack1.glb?url';
import termPack2Url from '../assets/models/pack/terminal_pack2.glb?url';
import stairsUrl from '../assets/models/pack/escalier_pack.glb?url';
import fireTruckPackUrl from '../assets/models/pack/camion_pompiers_pack.glb?url';
import apronBusUrl from '../assets/models/pack/bus_piste_pack.glb?url';
import bagPackUrl from '../assets/models/pack/train_bagages_pack.glb?url';
import a320Url from '../assets/models/pack/a320.glb?url';
import a330Url from '../assets/models/pack/a330.glb?url';
import { nightMats } from './models3d';

/**
 * Modèles 3D importés (.glb, intégrés au fichier du jeu : aucun accès réseau).
 * Chaque modèle est mis à l'échelle de l'emprise du bâtiment dans le jeu ;
 * les bâtiments sans modèle gardent leur version procédurale.
 */
/** Mobilier de la vue intérieure (« int_comptoir », « int_sieges »…). */
const INTERIOR_PROPS = import.meta.glob('../assets/models/interieur/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const SOURCES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(INTERIOR_PROPS).map(([k, v]) => ['int_' + k.split('/').pop()!.replace('.glb', ''), v])),
  terminal: terminalUrl,
  tour_controle: towerUrl,
  hangar: hangarUrl,
  caserne_pompiers: fireUrl,
  parking: parkingUrl,
  hotel: hotelUrl,
  moyen_courrier: mediumUrl,
  voiture: carUrl,
  bus: cityBusUrl,
  police: policeUrl,
  camion_citerne: fuelUrl,
  tracteur_repoussage: tugUrl,
  train_bagages: bagPackUrl,
  bus_piste: apronBusUrl,
  camion_pompiers: fireTruckPackUrl,
  chasse_neige: plowUrl,
  engin_degivrage: deicerUrl,
  train: trainUrl,
  // Pièces de « Airport Final Big Scene » (assetfactory, Sketchfab Standard) — voir CREDITS.md
  tour_controle_bs: towerBigUrl,
  avion3_bs: rearJetUrl,
  // Modèles Sketchfab sous licence CC-BY (sauf mention) — voir sketchfab/CREDITS.md
  boutique: shopUrl,
  cafe: cafeUrl,
  hors_taxes: dutyFreeUrl,
  batiment_marin: officeUrl,
  parking_sf: carParkUrl,
  abribus: busStopUrl,
  gare: stationUrl,
  foret: forestUrl,
  a380: a380Url,
  q400: q400Url,
  location: rentalUrl,
  restaurant_pack: restaurantUrl,
  b777: b777Url,
  gpu: gpuUrl,
  passerelle: jetwayUrl,
  locomotive: locoUrl,
  voiture_merco: carMercoUrl,
  voiture_ferrari: carFerrariUrl,
  voiture_shelby: carShelbyUrl,
  moto: motoUrl,
  tapis_bagages: beltUrl,
  catering: cateringUrl,
  voiture_s13: carS13Url,
  centrale: powerUrl,
  station_carburant: fuelStationUrl,
  solaire: solarUrl,
  hangar_fret: cargoUrl,
  immeuble: adminUrl,
  // Pièces de « Airport Pack Total », Airbus A320 et A330-300 (archives fournies) — voir pack/CREDITS.md
  terminal_pack1: termPack1Url,
  terminal_pack2: termPack2Url,
  escalier: stairsUrl,
  a320: a320Url,
  a330: a330Url,
};

/** Échelle des véhicules : 1 case ≈ 11 m, comme les avions (un A320 de 38 m mesure environ 3,4 cases). */
export const METERS_PER_TILE = 11;

export interface VehiclePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Transformation de la pièce dans le repère du véhicule (déjà à l'échelle du jeu). */
  matrix: THREE.Matrix4;
  /** Pièce recolorable (carrosserie). */
  tint: boolean;
}

/**
 * Pièces d'un véhicule pour l'instanciation : une géométrie partagée par
 * pièce, posée au sol, avant vers +Z, à l'échelle du jeu.
 */
export function vehicleParts(name: string, tintMaterial?: string): VehiclePart[] | null {
  const t = templates.get(name);
  if (!t) return null;
  const root = t.obj;
  root.updateMatrixWorld(true);
  const s = 1 / METERS_PER_TILE;
  const base = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(0, -t.box.min.y, 0));
  const parts: VehiclePart[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let material = m.material as THREE.Material;
    const tint = !!tintMaterial && material.name === tintMaterial;
    if (tint) {
      // Base blanche : la couleur de chaque instance est appliquée par multiplication.
      material = (material as THREE.MeshStandardMaterial).clone();
      (material as THREE.MeshStandardMaterial).color.set('#ffffff');
    }
    parts.push({ geometry: m.geometry, material, matrix: base.clone().multiply(m.matrixWorld), tint });
  });
  return parts;
}

/** Passerelle télescopique importée : de l'origine (rotonde, côté terminal) vers +X, longueur `len` cases. */
export function importedJetway(len: number): THREE.Object3D | null {
  const t = templates.get('passerelle');
  if (!t) return null;
  const inner = t.obj.clone(true);
  const size = t.box.getSize(new THREE.Vector3());
  const c = t.box.getCenter(new THREE.Vector3());
  inner.position.set(-t.box.min.x, -t.box.min.y, -c.z);
  const g = new THREE.Group();
  g.add(inner);
  const k = len / size.x;
  g.scale.set(k, Math.min(k, 0.75 / size.y), k);
  return g;
}

/**
 * Pièces d'un objet de décor pour l'instanciation : centré sur l'origine, posé au sol,
 * en unités du modèle ; `size` donne ses dimensions (pour la mise à l'échelle).
 */
export function propParts(name: string): { parts: { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }[]; size: THREE.Vector3 } | null {
  const t = templates.get(name);
  if (!t) return null;
  t.obj.updateMatrixWorld(true);
  const c = t.box.getCenter(new THREE.Vector3());
  const base = new THREE.Matrix4().makeTranslation(-c.x, -t.box.min.y, -c.z);
  const parts: { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }[] = [];
  t.obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) parts.push({ geometry: m.geometry, material: m.material as THREE.Material, matrix: base.clone().multiply(m.matrixWorld) });
  });
  return { parts, size: t.box.getSize(new THREE.Vector3()) };
}

/**
 * Bâtiment du jeu → [modèle, rotation pour orienter la façade côté pistes (−Z),
 * hauteur max en cases, écrasement vertical autorisé pour respecter cette hauteur, hauteur min en cases (étirement)].
 */
const BUILDING_MODELS: Record<string, [string, number, number?, boolean?, number?]> = {
  terminal_s: ['terminal', Math.PI],
  // Terminaux du pack : façade (enseigne) vers +X, côté long selon Z.
  terminal_m: ['terminal_pack2', 0, 2.4, true],
  terminal_l: ['terminal_pack1', 0, 3.2, true],
  tower_s: ['tour_controle', 0],
  tower_l: ['tour_controle_bs', 0, 7],
  hangar: ['hangar', Math.PI],
  fire_station: ['caserne_pompiers', Math.PI],
  parking_m: ['parking', 0],
  hotel: ['hotel', 0],
  shop: ['boutique', 0],
  cafe: ['cafe', 0],
  restaurant: ['restaurant_pack', 0],
  rental: ['location', 0],
  dutyfree: ['hors_taxes', 0],
  rnd: ['batiment_marin', 0],
  training: ['batiment_marin', 0],
  parking_s: ['parking_sf', 0],
  bus_station: ['abribus', 0],
  train_station: ['gare', 0],
  trees: ['foret', 0, undefined, undefined, 0.9],
  power_plant: ['centrale', 0],
  fuel_depot: ['station_carburant', 0],
  solar: ['solaire', 0],
  cargo: ['hangar_fret', 0],
  admin: ['immeuble', 0],
};

/** Avion du jeu → modèle. */
const AIRCRAFT_MODELS: Record<string, string> = {
  tp70: 'q400',
  rj95: 'avion3_bs',
  nb180: 'moyen_courrier',
  nb220: 'a320',
  wb300: 'a330',
  wb380: 'b777',
  sj550: 'a380',
};
/** Direction du nez dans le modèle (par défaut +Z). */
const NOSE: Record<string, '+X' | '-X' | '+Z' | '-Z'> = { avion3_bs: '-X', a380: '-X', b777: '-Z' };
/** Matériaux portant la couleur de la compagnie. */
const LIVERY = new Set(['red', 'blue', 'navy']);

const templates = new Map<string, { obj: THREE.Object3D; box: THREE.Box3 }>();
let loading: Promise<void> | null = null;

/** Lit un modèle (fichier à côté du jeu, ou URL data: en développement). */
async function fetchModel(url: string): Promise<ArrayBuffer> {
  // Aperçu en ligne : les modèles peuvent être fournis par des scripts (window.__GLB, URL data:).
  const packed = (window as unknown as { __GLB?: Record<string, string> }).__GLB?.[url.split('/').pop() ?? ''];
  if (packed) {
    const bin = atob(packed.slice(packed.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.arrayBuffer();
}

/** Charge (une seule fois) tous les modèles ; appelle onReady quand c'est fait. */
export function loadModels(): Promise<void> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  loading = Promise.all(
    Object.entries(SOURCES).map(async ([name, url]) => {
      try {
        const gltf = await loader.parseAsync(await fetchModel(url), '');
        const obj = gltf.scene;
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          const mat = m.material as THREE.MeshStandardMaterial;
          // Vitrages éclairés la nuit.
          if (mat && /^glass/.test(mat.name) && !nightMats.has(mat)) {
            mat.emissive = new THREE.Color(mat.name === 'glass' ? '#ffd9a0' : '#ffc66b');
            mat.emissiveIntensity = 0;
            nightMats.add(mat);
          }
        });
        templates.set(name, { obj, box: new THREE.Box3().setFromObject(obj, true) });
      } catch (e) {
        console.warn('Modèle 3D illisible :', name, e);
      }
    }),
  ).then(() => undefined);
  return loading;
}

/** Le modèle importé de ce bâtiment inclut ses propres passerelles d'embarquement. */
export function hasOwnJetways(type: string): boolean {
  return BUILDING_MODELS[type]?.[0] === 'terminal' && templates.has('terminal');
}

export function modelsLoaded(): boolean {
  return templates.size > 0;
}

/**
 * Modèle importé d'un bâtiment, ajusté à l'emprise W×D (cases), centré
 * sur l'origine et posé au sol. null si aucun modèle n'existe pour ce type.
 */
export function importedBuilding(type: string, W: number, D: number): THREE.Object3D | null {
  const spec = BUILDING_MODELS[type];
  if (!spec) return null;
  const t = templates.get(spec[0]);
  if (!t) return null;
  const inner = t.obj.clone(true);
  const size = t.box.getSize(new THREE.Vector3());
  const center = t.box.getCenter(new THREE.Vector3());
  // Centre le modèle sur l'origine, au sol.
  inner.position.set(-center.x, -t.box.min.y, -center.z);
  const holder = new THREE.Group();
  holder.add(inner);
  // Le côté long du modèle suit le côté long de l'emprise.
  const modelLongX = size.x >= size.z;
  const footLongX = W >= D;
  let rot = spec[1];
  let ex = size.x;
  let ez = size.z;
  if (modelLongX !== footLongX && Math.abs(size.x - size.z) > 0.15 * Math.max(size.x, size.z)) {
    rot += Math.PI / 2;
    ex = size.z;
    ez = size.x;
  }
  holder.rotation.y = rot;
  let sc = Math.min((W * 0.97) / ex, (D * 0.97) / ez);
  let sy = sc;
  if (spec[2] && spec[3]) sy = Math.min(sc, spec[2] / size.y);
  else if (spec[2]) sc = sy = Math.min(sc, spec[2] / size.y);
  if (spec[4]) sy = Math.max(sy, spec[4] / size.y);
  const out = new THREE.Group();
  holder.scale.set(sc, sy, sc);
  out.add(holder);
  return out;
}

const liveryCache = new Map<string, THREE.Material>();

/** Matériau texturé dont le canal alpha (masque) reçoit la couleur de la compagnie. */
function liveryMaterial(base: THREE.MeshStandardMaterial, color: string): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.transparent = false;
  m.alphaTest = 0;
  const livery = new THREE.Color(color);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLivery = { value: livery };
    sh.fragmentShader = 'uniform vec3 uLivery;\n' + sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 texel = texture2D( map, vMapUv );
        diffuseColor.rgb *= mix( texel.rgb, uLivery, texel.a );
      #endif`,
    );
  };
  m.customProgramCacheKey = () => 'livery';
  return m;
}

/**
 * Avion importé : nez vers +X (convention du jeu), longueur = `length` cases,
 * couleurs de la compagnie. Renvoie aussi les hélices à animer.
 */
export function importedAircraft(aircraft: string, length: number, color: string): { obj: THREE.Group; props: THREE.Object3D[] } | null {
  const name = AIRCRAFT_MODELS[aircraft];
  const t = name ? templates.get(name) : undefined;
  if (!t) return null;
  const inner = t.obj.clone(true);
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat && mat.name === 'livtex') {
      // Texture dont l'alpha marque la zone de livrée : peinte à la couleur de la compagnie.
      const key = mat.uuid + color;
      let lm = liveryCache.get(key);
      if (!lm) {
        lm = liveryMaterial(mat, color);
        liveryCache.set(key, lm);
      }
      m.material = lm;
    } else if (mat && LIVERY.has(mat.name)) {
      const key = mat.name + color;
      let lm = liveryCache.get(key);
      if (!lm) {
        lm = mat.clone();
        (lm as THREE.MeshStandardMaterial).color.set(color);
        liveryCache.set(key, lm);
      }
      m.material = lm;
    }
  });
  const size = t.box.getSize(new THREE.Vector3());
  const nose = NOSE[name] ?? '+Z';
  const sc = length / (nose === '+Z' || nose === '-Z' ? size.z : size.x);
  const holder = new THREE.Group();
  inner.position.y = -t.box.min.y;
  holder.add(inner);
  holder.scale.setScalar(sc);
  // Nez du modèle orienté vers +X (convention du jeu).
  holder.rotation.y = nose === '+Z' ? Math.PI / 2 : nose === '-Z' ? -Math.PI / 2 : nose === '-X' ? Math.PI : 0;
  const obj = new THREE.Group();
  obj.add(holder);
  const props = ['helice_gauche', 'helice_droite'].map((n) => inner.getObjectByName(n)).filter((x): x is THREE.Object3D => !!x);
  return { obj, props };
}
