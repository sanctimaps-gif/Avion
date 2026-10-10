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
};

/** Bâtiment du jeu → [modèle, rotation pour orienter la façade côté pistes (−Z)]. */
const BUILDING_MODELS: Record<string, [string, number]> = {
  terminal_s: ['terminal', Math.PI],
  terminal_m: ['terminal', Math.PI],
  terminal_l: ['terminal', Math.PI],
  tower_s: ['tour_controle', 0],
  tower_l: ['tour_controle', 0],
  hangar: ['hangar', Math.PI],
  fire_station: ['caserne_pompiers', Math.PI],
  parking_m: ['parking', 0],
  hotel: ['hotel', 0],
};

/** Avion du jeu → modèle. */
const AIRCRAFT_MODELS: Record<string, string> = {
  tp70: 'turbopropulseur',
  rj95: 'moyen_courrier',
  nb180: 'moyen_courrier',
  nb220: 'moyen_courrier',
  wb300: 'gros_porteur',
  wb380: 'gros_porteur',
  sj550: 'gros_porteur',
};
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
  const sc = Math.min((W * 0.97) / ex, (D * 0.97) / ez);
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
  const sc = length / size.z;
  const holder = new THREE.Group();
  inner.position.y = -t.box.min.y;
  holder.add(inner);
  holder.scale.setScalar(sc);
  // Nez du modèle vers +Z → vers +X dans le jeu.
  holder.rotation.y = Math.PI / 2;
  const obj = new THREE.Group();
  obj.add(holder);
  const props = ['helice_gauche', 'helice_droite'].map((n) => inner.getObjectByName(n)).filter((x): x is THREE.Object3D => !!x);
  return { obj, props };
}
