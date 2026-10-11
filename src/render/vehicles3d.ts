import * as THREE from 'three';
import { vehicleParts } from './gltfModels';

/**
 * Flotte de véhicules instanciés : chaque modèle est découpé en pièces,
 * chaque pièce devient un InstancedMesh partagé par tous les véhicules du
 * même modèle. Une voiture ou cent voitures coûtent le même nombre
 * d'appels de dessin, ce qui reste léger sur mobile.
 */
export type VehicleModel =
  | 'voiture'
  | 'bus'
  | 'bus_piste'
  | 'police'
  | 'voiture_s13'
  | 'tapis_bagages'
  | 'catering'
  | 'camion_citerne'
  | 'tracteur_repoussage'
  | 'train_bagages'
  | 'camion_pompiers'
  | 'chasse_neige'
  | 'engin_degivrage'
  | 'train'
  | 'escalier';

const CAPACITY: Record<VehicleModel, number> = {
  voiture: 90,
  bus: 16,
  bus_piste: 12,
  police: 12,
  voiture_s13: 90,
  tapis_bagages: 16,
  catering: 16,
  camion_citerne: 24,
  tracteur_repoussage: 16,
  train_bagages: 24,
  camion_pompiers: 8,
  chasse_neige: 8,
  engin_degivrage: 12,
  train: 2,
  escalier: 16,
};

interface Pool {
  meshes: { im: THREE.InstancedMesh; local: THREE.Matrix4; tint: boolean }[];
  count: number;
  cap: number;
}

export class VehicleFleet {
  group = new THREE.Group();
  private pools = new Map<VehicleModel, Pool>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private yAxis = new THREE.Vector3(0, 1, 0);
  private col = new THREE.Color();
  ready = false;

  /** Construit les pools quand les modèles sont chargés. */
  build(): boolean {
    if (this.ready) return true;
    for (const name of Object.keys(CAPACITY) as VehicleModel[]) {
      const parts = vehicleParts(name, name === 'voiture' || name === 'voiture_s13' ? 'red' : undefined);
      if (!parts) return false;
      const cap = CAPACITY[name];
      const meshes = parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geometry, p.material, cap);
        im.count = 0;
        im.castShadow = true;
        im.frustumCulled = false;
        if (p.tint) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        this.group.add(im);
        return { im, local: p.matrix, tint: p.tint };
      });
      this.pools.set(name, { meshes, count: 0, cap });
    }
    this.ready = true;
    return true;
  }

  begin(): void {
    for (const p of this.pools.values()) p.count = 0;
  }

  /**
   * Place un véhicule. (x, z) en cases, `hdg` = direction de marche dans le plan
   * de la carte (même convention que les avions : atan2(dy, dx)).
   */
  add(name: VehicleModel, x: number, z: number, hdg: number, color?: string, y = 0): void {
    const p = this.pools.get(name);
    if (!p || p.count >= p.cap) return;
    this.q.setFromAxisAngle(this.yAxis, Math.PI / 2 - hdg);
    this.m.compose(this.v.set(x, y, z), this.q, this.one);
    const i = p.count++;
    const tmp = new THREE.Matrix4();
    for (const part of p.meshes) {
      part.im.setMatrixAt(i, tmp.multiplyMatrices(this.m, part.local));
      if (part.tint) part.im.setColorAt(i, this.col.set(color ?? '#dc2626'));
    }
  }

  end(): void {
    for (const p of this.pools.values()) {
      for (const part of p.meshes) {
        part.im.count = p.count;
        part.im.instanceMatrix.needsUpdate = true;
        if (part.im.instanceColor) part.im.instanceColor.needsUpdate = true;
      }
    }
  }

  setShadows(on: boolean): void {
    for (const p of this.pools.values()) for (const part of p.meshes) part.im.castShadow = on;
  }
}
