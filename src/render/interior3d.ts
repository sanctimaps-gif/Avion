import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings';
import { bFootprint } from '../sim/world';
import type { Building, GameState } from '../sim/types';
import { geo, mat } from './models3d';

/**
 * Vue intérieure : les bâtiments de l'aérogare sont dessinés en coupe (sans toit)
 * avec leur mobilier, et une foule animée reflète l'état de la simulation
 * (files d'enregistrement et de sûreté, salles d'embarquement, bagages, commerces).
 * Échelle : 1 case ≈ 6 m, une personne mesure environ 0,3 case.
 */
export const INTERIOR = new Set([
  'terminal_s', 'terminal_m', 'terminal_l', 'pier', 'checkin', 'security', 'baggage_claim', 'info_desk',
  'lounge', 'cafe', 'restaurant', 'shop', 'dutyfree',
]);

const WALL_H = 0.5;

/** Matériaux éclairés la nuit (plafonniers simulés par une légère émission). */
export const interiorNightMats = new Set<THREE.MeshStandardMaterial>();

interface P {
  x: number;
  z: number;
}
/** Emplacements des personnes d'un bâtiment, en coordonnées monde (cases). */
export interface Spots {
  checkin: P[];
  security: P[];
  baggage: P[];
  seats: P[];
  commerce: P[];
  staff: P[];
  walk: { a: P; b: P }[];
}
const registry = new Map<number, Spots>();

function floorMat(color: string): THREE.MeshStandardMaterial {
  const m = mat(color, { roughness: 0.35, metalness: 0.05, emissive: new THREE.Color('#fff4d6'), emissiveIntensity: 0 }, 'ifloor');
  interiorNightMats.add(m);
  return m;
}
const FLOOR: Record<string, string> = {
  lounge: '#6b4f3a', cafe: '#b08968', restaurant: '#9c6644', shop: '#f5f5f4', dutyfree: '#faf7f2',
  security: '#dfe7f1', baggage_claim: '#d6d3d1', checkin: '#e5e9ef',
};

const boxGeo = (): THREE.BufferGeometry => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const cylGeo = (): THREE.BufferGeometry => geo('icyl', () => new THREE.CylinderGeometry(1, 1, 1, 16));

/** Regroupe les petits objets répétés en InstancedMesh (un appel de dessin par type). */
class Inst {
  private sets = new Map<string, { g: THREE.BufferGeometry; m: THREE.Material; list: THREE.Matrix4[] }>();
  private q = new THREE.Quaternion();
  private y = new THREE.Vector3(0, 1, 0);
  add(g: THREE.BufferGeometry, m: THREE.MeshStandardMaterial, x: number, y: number, z: number, sx: number, sy: number, sz: number, rot = 0): void {
    const key = g.uuid + m.uuid;
    let e = this.sets.get(key);
    if (!e) this.sets.set(key, (e = { g, m, list: [] }));
    this.q.setFromAxisAngle(this.y, rot);
    e.list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), this.q.clone(), new THREE.Vector3(sx, sy, sz)));
  }
  box(m: THREE.MeshStandardMaterial, x: number, y: number, z: number, w: number, h: number, d: number, rot = 0): void {
    this.add(boxGeo(), m, x, y + h / 2, z, w, h, d, rot);
  }
  cyl(m: THREE.MeshStandardMaterial, x: number, y: number, z: number, r: number, h: number, rz = r): void {
    this.add(cylGeo(), m, x, y + h / 2, z, r, h, rz);
  }
  build(g: THREE.Group): void {
    for (const e of this.sets.values()) {
      const im = new THREE.InstancedMesh(e.g, e.m, e.list.length);
      e.list.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true;
      im.receiveShadow = true;
      g.add(im);
    }
  }
}

/** Côté piste du bâtiment : direction vers le poste de stationnement le plus proche. */
function airsideDir(s: GameState, b: Building): [number, number] {
  const f = bFootprint(b);
  const cx = b.x + f.w / 2;
  const cz = b.y + f.h / 2;
  let best = Infinity;
  let dir: [number, number] = [0, -1];
  for (const o of s.buildings) {
    if (!BUILDINGS[o.type].standSize) continue;
    const of = bFootprint(o);
    const dx = o.x + of.w / 2 - cx;
    const dz = o.y + of.h / 2 - cz;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      dir = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz) || -1];
    }
  }
  return dir;
}

const C = {
  wall: '#eef2f6', cap: '#94a3b8', counter: '#e2e8f0', counterTop: '#334155', belt: '#1f2937', seat: '#1d4ed8', seat2: '#0f766e',
  metal: '#9ca3af', screen: '#0b1220', plant: '#2f7d4a', pot: '#57534e', wood: '#8b5e3c', table: '#f5f5f4', sofa: '#475569',
  shelfA: '#f59e0b', shelfB: '#ef4444', shelfC: '#22c55e', shelfD: '#6366f1', arch: '#cbd5e1', tape: '#2563eb', ring: '#475569',
};

/**
 * Modèle intérieur d'un bâtiment (groupe positionné dans le monde) ; enregistre
 * aussi les emplacements de la foule pour ce bâtiment.
 */
export function interiorBuilding(s: GameState, b: Building): THREE.Group {
  const f = bFootprint(b);
  const g = new THREE.Group();
  const cx = b.x + f.w / 2;
  const cz = b.y + f.h / 2;
  const [dx, dz] = airsideDir(s, b);
  const th = Math.atan2(dx, dz);
  g.position.set(cx, 0, cz);
  g.rotation.y = th;
  const L = dz !== 0 ? f.w : f.h; // longueur (axe x local)
  const D = dz !== 0 ? f.h : f.w; // profondeur (axe z local, +z = côté piste)
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const W = (x: number, z: number): P => ({ x: cx + x * c + z * sn, z: cz - x * sn + z * c });
  const spots: Spots = { checkin: [], security: [], baggage: [], seats: [], commerce: [], staff: [], walk: [] };
  const I = new Inst();
  const m = (col: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}, k = 'i'): THREE.MeshStandardMaterial => mat(col, o, k);

  // Sol, murs coupés, façade vitrée côté piste
  const floor = new THREE.Mesh(boxGeo(), floorMat(FLOOR[b.type] ?? '#e7e5e4'));
  floor.scale.set(L, 0.04, D);
  floor.position.y = 0.02;
  floor.receiveShadow = true;
  g.add(floor);
  const wallM = m(C.wall, {}, 'iwall');
  const capM = m(C.cap, {}, 'icap');
  const glassM = m('#9fd3f5', { transparent: true, opacity: 0.32, metalness: 0.4, roughness: 0.1, depthWrite: false }, 'iglass');
  const t = 0.05;
  const wall = (x: number, z: number, w: number, d: number, glass: boolean): void => {
    if (glass) {
      I.box(glassM, x, 0.04, z, w, WALL_H, d);
      I.box(capM, x, WALL_H, z, w + 0.01, 0.025, d + 0.01);
      I.box(capM, x, 0.04, z, w + 0.01, 0.03, d + 0.01);
    } else {
      I.box(wallM, x, 0.04, z, w, WALL_H * 0.85, d);
      I.box(capM, x, WALL_H * 0.85, z, w + 0.01, 0.025, d + 0.01);
    }
  };
  wall(0, D / 2 - t / 2, L, t, true); // côté piste
  // côté ville : vitré avec portes (interruptions)
  const doors = Math.max(1, Math.round(L / 4));
  const seg = L / doors;
  for (let i = 0; i < doors; i++) {
    const x0 = -L / 2 + i * seg;
    const gap = Math.min(0.5, seg * 0.3);
    wall(x0 + (seg - gap) / 4, -D / 2 + t / 2, (seg - gap) / 2, t, true);
    wall(x0 + seg - (seg - gap) / 4, -D / 2 + t / 2, (seg - gap) / 2, t, true);
  }
  wall(-L / 2 + t / 2, 0, t, D, false);
  wall(L / 2 - t / 2, 0, t, D, false);
  // Piliers
  const colM = m('#cbd5e1', {}, 'icol');
  for (let x = -L / 2 + 2; x < L / 2 - 0.5; x += 2) for (let z = -D / 2 + 2; z < D / 2 - 0.5; z += 2) I.box(colM, x, 0.04, z, 0.08, WALL_H * 0.85, 0.08);

  const screenM = m('#1e3a8a', { emissive: new THREE.Color('#60a5fa'), emissiveIntensity: 0.6 }, 'iscreen');
  const amberM = m('#111827', { emissive: new THREE.Color('#fbbf24'), emissiveIntensity: 0.7 }, 'iamber');
  const plant = (x: number, z: number): void => {
    I.cyl(m(C.pot, {}, 'ipot'), x, 0.04, z, 0.05, 0.06);
    I.add(geo('ileaf', () => new THREE.IcosahedronGeometry(1, 0)), m(C.plant, { flatShading: true }, 'ileaf'), x, 0.16, z, 0.08, 0.1, 0.08);
  };
  const board = (x: number, z: number, rot = 0): void => {
    I.box(m(C.metal, {}, 'imetal'), x, 0.04, z, 0.02, 0.28, 0.02, rot);
    I.box(amberM, x, 0.28, z, 0.32, 0.1, 0.02, rot);
  };

  // Rangée de comptoirs d'enregistrement le long de x, à la profondeur z0 ; file côté ville.
  const checkinRow = (x0: number, x1: number, z0: number, queueDepth: number): void => {
    const counterM = m(C.counter, {}, 'icounter');
    const topM = m(C.counterTop, {}, 'itop');
    const beltM = m(C.belt, {}, 'ibelt');
    for (let x = x0 + 0.15; x <= x1 - 0.15; x += 0.32) {
      I.box(counterM, x, 0.04, z0, 0.22, 0.17, 0.11);
      I.box(topM, x, 0.21, z0, 0.23, 0.015, 0.12);
      I.box(beltM, x + 0.14, 0.04, z0 + 0.02, 0.06, 0.06, 0.16);
      I.box(screenM, x, 0.23, z0 - 0.05, 0.08, 0.05, 0.01);
      spots.staff.push(W(x, z0 + 0.12));
    }
    I.box(m('#1e3a8a', {}, 'isign'), (x0 + x1) / 2, 0.42, z0 + 0.08, Math.max(0.3, x1 - x0 - 0.2), 0.06, 0.02);
    // Couloirs de file (poteaux et rubans), serpentin
    const rows = Math.max(2, Math.floor(queueDepth / 0.11));
    const postM = m(C.metal, {}, 'imetal');
    const tapeM = m(C.tape, {}, 'itape');
    for (let r = 0; r < rows; r++) {
      const z = z0 - 0.2 - r * 0.11;
      const pts: P[] = [];
      for (let x = x0 + 0.15; x <= x1 - 0.15; x += 0.085) pts.push(W(x, z));
      if (r % 2) pts.reverse();
      spots.checkin.push(...pts);
      if (r < rows - 1) {
        const zt = z - 0.055;
        const gapLeft = r % 2 === 0;
        const xa = x0 + (gapLeft ? 0.35 : 0.1);
        const xb = x1 - (gapLeft ? 0.1 : 0.35);
        I.box(tapeM, (xa + xb) / 2, 0.11, zt, xb - xa, 0.012, 0.008);
        I.box(postM, xa, 0.04, zt, 0.015, 0.08, 0.015);
        I.box(postM, xb, 0.04, zt, 0.015, 0.08, 0.015);
      }
    }
  };
  // Postes d'inspection-filtrage : portiques + tapis à rayons X ; file côté ville.
  const securityRow = (x0: number, x1: number, z0: number, queueDepth: number): void => {
    const n = Math.max(1, Math.floor((x1 - x0) / 0.6));
    const step = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const x = x0 + step * (i + 0.5);
      const archM = m(C.arch, {}, 'iarch');
      I.box(archM, x - 0.07, 0.04, z0, 0.03, 0.34, 0.06);
      I.box(archM, x + 0.07, 0.04, z0, 0.03, 0.34, 0.06);
      I.box(archM, x, 0.36, z0, 0.17, 0.03, 0.06);
      I.box(m('#64748b', {}, 'ixray'), x + 0.22, 0.04, z0, 0.12, 0.13, 0.5);
      I.box(m(C.belt, {}, 'ibelt'), x + 0.22, 0.17, z0, 0.1, 0.01, 0.62);
      spots.staff.push(W(x - 0.15, z0 + 0.12), W(x + 0.34, z0));
      for (let k = 0; k < Math.floor(queueDepth / 0.09); k++) {
        spots.security.push(W(x - 0.04 + ((k % 2) * 0.08), z0 - 0.16 - k * 0.085));
      }
    }
  };
  // Tapis à bagages (ovale) avec passagers autour
  const carousel = (x: number, z: number, len: number): void => {
    I.cyl(m(C.ring, { metalness: 0.5, roughness: 0.4 }, 'iring'), x, 0.04, z, len / 2, 0.08, 0.16);
    I.cyl(m('#cbd5e1', {}, 'iisland'), x, 0.04, z, len / 2 - 0.08, 0.12, 0.08);
    board(x + len / 2 + 0.12, z, Math.PI / 2);
    for (let a = 0; a < Math.PI * 2; a += 0.22) spots.baggage.push(W(x + Math.cos(a) * (len / 2 + 0.1), z + Math.sin(a) * 0.27));
  };
  // Rangées de sièges de salle d'embarquement
  const seating = (x0: number, x1: number, z0: number, z1: number): void => {
    const seatM = m(C.seat, {}, 'iseat');
    const seat2M = m(C.seat2, {}, 'iseat2');
    const legM = m(C.metal, {}, 'imetal');
    let row = 0;
    for (let z = z0; z <= z1; z += 0.26, row++) {
      for (let x = x0; x <= x1 - 0.5; x += 0.62) {
        const sm = row % 2 ? seat2M : seatM;
        for (let k = 0; k < 6; k++) {
          const sx = x + k * 0.075;
          I.box(sm, sx, 0.07, z, 0.065, 0.02, 0.07);
          I.box(sm, sx, 0.09, z + 0.035, 0.065, 0.07, 0.012);
          spots.seats.push(W(sx, z));
        }
        I.box(legM, x + 0.19, 0.04, z, 0.45, 0.03, 0.02);
      }
    }
  };
  const gateDesks = (x0: number, x1: number, z: number): void => {
    for (let x = x0 + 0.6; x < x1 - 0.3; x += 2) {
      I.box(m(C.counter, {}, 'icounter'), x, 0.04, z, 0.3, 0.16, 0.1);
      I.box(screenM, x, 0.2, z + 0.03, 0.12, 0.08, 0.01);
      I.box(m(C.metal, {}, 'imetal'), x + 0.3, 0.04, z + 0.05, 0.02, 0.3, 0.02);
      I.box(amberM, x + 0.3, 0.3, z + 0.05, 0.22, 0.08, 0.02);
      spots.staff.push(W(x, z + 0.1));
    }
  };
  const tables = (x0: number, x1: number, z0: number, z1: number, chairs: number): void => {
    for (let x = x0; x <= x1; x += 0.36) for (let z = z0; z <= z1; z += 0.36) {
      I.cyl(m(C.table, {}, 'itable'), x, 0.04, z, 0.07, 0.12);
      for (let k = 0; k < chairs; k++) {
        const a = (k / chairs) * Math.PI * 2 + 0.4;
        const px = x + Math.cos(a) * 0.11;
        const pz = z + Math.sin(a) * 0.11;
        I.box(m(C.wood, {}, 'iwood'), px, 0.04, pz, 0.05, 0.07, 0.05);
        spots.commerce.push(W(px, pz));
      }
    }
  };
  const shelves = (x0: number, x1: number, z0: number, z1: number, low: boolean): void => {
    const cols = [C.shelfA, C.shelfB, C.shelfC, C.shelfD];
    let i = 0;
    for (let z = z0; z <= z1; z += 0.34, i++) {
      I.box(m(cols[i % 4], {}, 'ishelf'), (x0 + x1) / 2, 0.04, z, x1 - x0, low ? 0.12 : 0.24, 0.1);
      for (let x = x0 + 0.1; x < x1; x += 0.22) spots.commerce.push(W(x, z + 0.14));
    }
  };
  const walkLanes = (zs: number[]): void => {
    for (const z of zs) spots.walk.push({ a: W(-L / 2 + 0.3, z), b: W(L / 2 - 0.3, z) });
  };

  switch (b.type) {
    case 'terminal_s':
    case 'terminal_m':
    case 'terminal_l': {
      // Zone ville : enregistrement ; centre : sûreté ; côté piste : salles d'embarquement.
      const zC = -D / 2 + D * 0.3;
      checkinRow(-L / 2 + 0.4, L / 2 - 0.4, zC, D * 0.18);
      securityRow(-L / 4, L / 4, -D / 2 + D * 0.55, D * 0.12);
      seating(-L / 2 + 0.5, L / 2 - 0.6, D / 2 - D * 0.3, D / 2 - 0.45);
      gateDesks(-L / 2, L / 2, D / 2 - 0.25);
      for (let x = -L / 2 + 1; x < L / 2; x += 3) board(x, -D / 2 + 0.35);
      plant(-L / 2 + 0.25, D / 2 - 0.25);
      plant(L / 2 - 0.25, D / 2 - 0.25);
      plant(-L / 2 + 0.25, -D / 2 + 0.3);
      plant(L / 2 - 0.25, -D / 2 + 0.3);
      walkLanes([-D / 2 + 0.2, -D / 2 + D * 0.42, D / 2 - D * 0.36]);
      break;
    }
    case 'pier':
      seating(-L / 2 + 0.3, L / 2 - 0.2, -D / 2 + 0.3, -D / 2 + 0.6);
      seating(-L / 2 + 0.3, L / 2 - 0.2, D / 2 - 0.85, D / 2 - 0.55);
      gateDesks(-L / 2, L / 2, D / 2 - 0.25);
      I.box(m('#475569', {}, 'iwalkway'), 0, 0.04, 0, L - 0.6, 0.015, 0.22);
      walkLanes([0.15, -0.15]);
      break;
    case 'checkin':
      checkinRow(-L / 2 + 0.2, L / 2 - 0.2, D / 2 - 0.35, D * 0.55);
      walkLanes([-D / 2 + 0.15]);
      break;
    case 'security':
      securityRow(-L / 2 + 0.2, L / 2 - 0.2, D / 2 - 0.45, D * 0.5);
      walkLanes([D / 2 - 0.15]);
      break;
    case 'baggage_claim':
      for (let i = 0, n = Math.max(1, Math.floor(L / 1.6)); i < n; i++) carousel(-L / 2 + (L / n) * (i + 0.5), 0, Math.min(1.1, (L / n) * 0.75));
      walkLanes([-D / 2 + 0.2, D / 2 - 0.2]);
      break;
    case 'info_desk':
      I.cyl(m(C.counter, {}, 'icounter'), 0, 0.04, 0, 0.18, 0.16);
      I.box(m('#0ea5e9', { emissive: new THREE.Color('#0ea5e9'), emissiveIntensity: 0.5 }, 'iinfo'), 0, 0.3, 0, 0.12, 0.12, 0.02);
      I.box(m(C.metal, {}, 'imetal'), 0, 0.2, 0, 0.015, 0.1, 0.015);
      spots.staff.push(W(0, 0.05));
      for (let a = 0; a < 6; a++) spots.commerce.push(W(Math.cos(a) * 0.3, Math.sin(a) * 0.3));
      break;
    case 'lounge': {
      I.box(m('#9a3412', {}, 'irug'), 0, 0.04, 0, L * 0.7, 0.005, D * 0.6);
      for (let x = -L / 2 + 0.3; x < L / 2 - 0.2; x += 0.45) for (let z = -D / 2 + 0.35; z < D / 2 - 0.3; z += 0.5) {
        I.box(m(C.sofa, {}, 'isofa'), x, 0.04, z, 0.3, 0.06, 0.1);
        I.box(m(C.sofa, {}, 'isofa'), x, 0.04, z + 0.06, 0.3, 0.12, 0.03);
        I.cyl(m(C.wood, {}, 'iwood'), x, 0.04, z - 0.14, 0.06, 0.05);
        spots.commerce.push(W(x - 0.08, z), W(x + 0.08, z));
      }
      I.box(m(C.wood, {}, 'iwood'), L / 2 - 0.25, 0.04, 0, 0.12, 0.17, D * 0.6);
      spots.staff.push(W(L / 2 - 0.12, 0));
      plant(-L / 2 + 0.2, D / 2 - 0.2);
      break;
    }
    case 'cafe':
    case 'restaurant':
      I.box(m(C.wood, {}, 'iwood'), 0, 0.04, D / 2 - 0.3, L * 0.7, 0.17, 0.12);
      I.box(m('#111827', {}, 'imachine'), -L * 0.2, 0.21, D / 2 - 0.3, 0.1, 0.08, 0.08);
      I.box(amberM, 0, 0.38, D / 2 - 0.12, L * 0.5, 0.08, 0.02);
      spots.staff.push(W(-L * 0.15, D / 2 - 0.18), W(L * 0.15, D / 2 - 0.18));
      tables(-L / 2 + 0.3, L / 2 - 0.3, -D / 2 + 0.3, D / 2 - 0.65, b.type === 'restaurant' ? 4 : 2);
      break;
    case 'shop':
    case 'dutyfree':
      shelves(-L / 2 + 0.3, L / 2 - 0.6, -D / 2 + 0.35, D / 2 - 0.4, b.type === 'dutyfree');
      I.box(m(C.counter, {}, 'icounter'), L / 2 - 0.3, 0.04, 0, 0.12, 0.16, 0.4);
      spots.staff.push(W(L / 2 - 0.18, 0));
      if (b.type === 'dutyfree') for (let x = -L / 2 + 0.4; x < L / 2 - 0.6; x += 0.6) I.cyl(m('#f472b6', { metalness: 0.4 }, 'iperfume'), x, 0.04, -D / 2 + 0.18, 0.06, 0.18);
      break;
  }
  I.build(g);
  registry.set(b.id, spots);
  return g;
}

/** Oublie les emplacements d'un bâtiment (démoli ou redessiné). */
export function forgetInterior(id: number): void {
  registry.delete(id);
}

const CLOTHES = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#0ea5e9', '#f8fafc', '#334155', '#e11d48', '#14b8a6', '#facc15', '#78716c'];
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const STAFF = '#1e3a5f';

function hash(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/** Foule de l'aérogare (InstancedMesh) mise à jour à chaque image depuis la simulation. */
export class Crowd {
  group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private cap = 1200;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private col = new THREE.Color();
  private n = 0;

  constructor() {
    const bodyG = new THREE.CylinderGeometry(0.032, 0.045, 0.2, 7);
    bodyG.translate(0, 0.1, 0);
    const headG = new THREE.SphereGeometry(0.032, 8, 6);
    this.body = new THREE.InstancedMesh(bodyG, new THREE.MeshStandardMaterial({ roughness: 0.8 }), this.cap);
    this.head = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ roughness: 0.7 }), this.cap);
    for (const im of [this.body, this.head]) {
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
      this.group.add(im);
    }
  }

  private put(x: number, z: number, seated: boolean, seed: number, staff: boolean, bob = 0): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    const sy = seated ? 0.62 : 1;
    const y0 = seated ? 0.06 : 0.04 + bob;
    this.q.identity();
    this.m.compose(this.v.set(x, y0, z), this.q, this.sc.set(1, sy, 1));
    this.body.setMatrixAt(i, this.m);
    this.body.setColorAt(i, this.col.set(staff ? STAFF : CLOTHES[Math.floor(hash(seed) * CLOTHES.length)]));
    this.m.compose(this.v.set(x, y0 + 0.2 * sy + 0.03, z), this.q, this.sc.set(1, 1, 1));
    this.head.setMatrixAt(i, this.m);
    this.head.setColorAt(i, this.col.set(SKIN[Math.floor(hash(seed + 7) * SKIN.length)]));
  }

  /** Répartit les passagers de la simulation sur les emplacements des bâtiments visibles. */
  update(s: GameState, ids: number[], t: number): void {
    this.n = 0;
    const all: Spots[] = ids.map((id) => registry.get(id)).filter((x): x is Spots => !!x);
    const pick = <K extends keyof Spots>(k: K): Spots[K] extends (infer U)[] ? U[] : never => all.flatMap((sp) => sp[k] as never[]) as never;
    const live = s.pax.live;
    const per = 1; // passagers par silhouette (plafonné par les places disponibles)
    const sum = (a: { n: number }[]): number => a.reduce((x, c) => x + c.n, 0);
    const sway = (i: number): number => Math.sin(t * 0.002 + i * 1.7) * 0.006;
    // Personnel
    pick('staff').forEach((p, i) => this.put(p.x, p.z, false, i, true));
    // Files
    const fill = (pts: P[], count: number, seed: number): void => {
      const n = Math.min(pts.length, Math.ceil(count / per));
      for (let i = 0; i < n; i++) this.put(pts[i].x + sway(i + seed), pts[i].z + sway(i + seed + 3), false, i + seed, false);
    };
    fill(pick('checkin'), live.checkinQueue, 1000);
    fill(pick('security'), live.securityQueue, 3000);
    fill(pick('baggage'), Math.max(live.baggageQueue, sum(s.pax.baggage) * 0.3), 5000);
    // Côté piste : assis en salle d'embarquement, et dans les commerces
    const air = sum(s.pax.airside) / per;
    const seats = pick('seats');
    const seated = Math.min(seats.length, Math.round(air * 0.7));
    for (let i = 0; i < seated; i++) {
      const k = Math.floor(hash(i + 11) * seats.length); // places dispersées, stables
      this.put(seats[k].x, seats[k].z, true, i + 7000, false);
    }
    const shops = pick('commerce');
    const shoppers = Math.min(shops.length, Math.round(air * 0.3 + 2));
    for (let i = 0; i < shoppers; i++) {
      const k = Math.floor(hash(i + 97) * shops.length);
      this.put(shops[k].x + sway(i), shops[k].z, false, i + 9000, false);
    }
    // Passants : marchent le long des allées
    const lanes = pick('walk');
    if (lanes.length) {
      const walkers = Math.min(260, Math.round((sum(s.pax.landside) + live.inTerminal * 0.4) / per) + 3 * lanes.length);
      for (let i = 0; i < walkers; i++) {
        const lane = lanes[i % lanes.length];
        const speed = 0.00004 + hash(i + 3) * 0.00004;
        let ph = (hash(i) + t * speed) % 2;
        if (ph > 1) ph = 2 - ph; // aller-retour
        const off = (hash(i + 5) - 0.5) * 0.25;
        const dxl = lane.b.x - lane.a.x;
        const dzl = lane.b.z - lane.a.z;
        const len = Math.hypot(dxl, dzl) || 1;
        const x = lane.a.x + dxl * ph - (dzl / len) * off;
        const z = lane.a.z + dzl * ph + (dxl / len) * off;
        this.put(x, z, false, i + 12000, false, Math.abs(Math.sin(t * 0.012 + i)) * 0.008);
      }
    }
    this.body.count = this.head.count = this.n;
    for (const im of [this.body, this.head]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /** Nombre de silhouettes affichées (tests). */
  get count(): number {
    return this.n;
  }
}

/** Bâtiment intérieur le plus grand (pour centrer la caméra à l'entrée dans la vue). */
export function mainInterior(s: GameState): { x: number; y: number } | null {
  let best: { x: number; y: number; a: number } | null = null;
  for (const b of s.buildings) {
    if (!INTERIOR.has(b.type) || b.buildRemaining > 0) continue;
    const f = bFootprint(b);
    const a = f.w * f.h * (BUILDINGS[b.type].isTerminal ? 4 : 1);
    if (!best || a > best.a) best = { x: b.x + f.w / 2, y: b.y + f.h / 2, a };
  }
  return best;
}

