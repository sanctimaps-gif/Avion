import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import terminalUrl from '../assets/models/terminal.glb?inline';
import towerUrl from '../assets/models/tour_controle.glb?inline';
import hangarUrl from '../assets/models/hangar.glb?inline';
import fireUrl from '../assets/models/caserne_pompiers.glb?inline';
import parkingUrl from '../assets/models/parking.glb?inline';
import hotelUrl from '../assets/models/hotel.glb?inline';
import propUrl from '../assets/models/turbopropulseur.glb?inline';
import mediumUrl from '../assets/models/moyen_courrier.glb?inline';
import heavyUrl from '../assets/models/gros_porteur.glb?inline';
import carUrl from '../assets/models/vehicules/voiture.glb?inline';
import busUrl from '../assets/models/vehicules/bus.glb?inline';
import fuelUrl from '../assets/models/vehicules/camion_citerne.glb?inline';
import tugUrl from '../assets/models/vehicules/tracteur_repoussage.glb?inline';
import bagUrl from '../assets/models/vehicules/train_bagages.glb?inline';
import fireTruckUrl from '../assets/models/vehicules/camion_pompiers.glb?inline';
import plowUrl from '../assets/models/vehicules/chasse_neige.glb?inline';
import deicerUrl from '../assets/models/vehicules/engin_degivrage.glb?inline';
import trainUrl from '../assets/models/vehicules/train.glb?inline';
import towerBigUrl from '../assets/models/sketchfab/tour_controle_bs.glb?inline';
import jetUrl from '../assets/models/sketchfab/avion1_bs.glb?inline';
import rearJetUrl from '../assets/models/sketchfab/avion3_bs.glb?inline';
import stairsUrl from '../assets/models/sketchfab/escalier_bs.glb?inline';
import { nightMats } from './models3d';

/**
 * Modèles 3D importés (.glb, intégrés au fichier du jeu : aucun accès réseau).
 * Chaque modèle est mis à l'échelle de l'emprise du bâtiment dans le jeu ;
 * les bâtiments sans modèle gardent leur version procédurale.
 */
const SOURCES: Record<string, string> = {
  terminal: terminalUrl,
  tour_controle: towerUrl,
  hangar: hangarUrl,
  caserne_pompiers: fireUrl,
  parking: parkingUrl,
  hotel: hotelUrl,
  turbopropulseur: propUrl,
  moyen_courrier: mediumUrl,
  gros_porteur: heavyUrl,
  voiture: carUrl,
  bus: busUrl,
  camion_citerne: fuelUrl,
  tracteur_repoussage: tugUrl,
  train_bagages: bagUrl,
  camion_pompiers: fireTruckUrl,
  chasse_neige: plowUrl,
  engin_degivrage: deicerUrl,
  train: trainUrl,
  // Pièces de « Airport Final Big Scene » (assetfactory, Sketchfab Standard) — voir CREDITS.md
  tour_controle_bs: towerBigUrl,
  avion1_bs: jetUrl,
  avion3_bs: rearJetUrl,
  escalier: stairsUrl,
};

/** Échelle des véhicules : 1 case ≈ 8 m (légèrement exagérée pour rester lisible à côté des avions). */
export const METERS_PER_TILE = 8;

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

/** Bâtiment du jeu → [modèle, rotation pour orienter la façade côté pistes (−Z), hauteur max en cases]. */
const BUILDING_MODELS: Record<string, [string, number, number?]> = {
  terminal_s: ['terminal', Math.PI],
  terminal_m: ['terminal', Math.PI],
  terminal_l: ['terminal', Math.PI],
  tower_s: ['tour_controle', 0],
  tower_l: ['tour_controle_bs', 0, 7],
  hangar: ['hangar', Math.PI],
  fire_station: ['caserne_pompiers', Math.PI],
  parking_m: ['parking', 0],
  hotel: ['hotel', 0],
};

/** Avion du jeu → modèle. */
const AIRCRAFT_MODELS: Record<string, string> = {
  tp70: 'turbopropulseur',
  rj95: 'avion3_bs',
  nb180: 'moyen_courrier',
  nb220: 'moyen_courrier',
  wb300: 'avion1_bs',
  wb380: 'avion1_bs',
  sj550: 'gros_porteur',
};
/** Direction du nez dans le modèle (par défaut +Z). */
const NOSE: Record<string, '+X' | '-X' | '+Z'> = { avion1_bs: '+X', avion3_bs: '-X' };
/** Matériaux portant la couleur de la compagnie. */
const LIVERY = new Set(['red', 'blue', 'navy']);

const templates = new Map<string, { obj: THREE.Object3D; box: THREE.Box3 }>();
let loading: Promise<void> | null = null;

function decode(dataUrl: string): ArrayBuffer {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Charge (une seule fois) tous les modèles ; appelle onReady quand c'est fait. */
export function loadModels(): Promise<void> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  loading = Promise.all(
    Object.entries(SOURCES).map(async ([name, url]) => {
      try {
        const gltf = await loader.parseAsync(decode(url), '');
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
        templates.set(name, { obj, box: new THREE.Box3().setFromObject(obj) });
      } catch (e) {
        console.warn('Modèle 3D illisible :', name, e);
      }
    }),
  ).then(() => undefined);
  return loading;
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
  if (spec[2]) sc = Math.min(sc, spec[2] / size.y);
  const out = new THREE.Group();
  holder.scale.setScalar(sc);
  out.add(holder);
  return out;
}

const liveryCache = new Map<string, THREE.Material>();

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
    if (mat && LIVERY.has(mat.name)) {
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
  const sc = length / (nose === '+Z' ? size.z : size.x);
  const holder = new THREE.Group();
  inner.position.y = -t.box.min.y;
  holder.add(inner);
  holder.scale.setScalar(sc);
  // Nez du modèle orienté vers +X (convention du jeu).
  holder.rotation.y = nose === '+Z' ? Math.PI / 2 : nose === '-X' ? Math.PI : 0;
  const obj = new THREE.Group();
  obj.add(holder);
  const props = ['helice_gauche', 'helice_droite'].map((n) => inner.getObjectByName(n)).filter((x): x is THREE.Object3D => !!x);
  return { obj, props };
}
