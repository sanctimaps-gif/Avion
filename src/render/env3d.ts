import * as THREE from 'three';
import { ownedAt } from '../sim/construction';
import type { GameState } from '../sim/types';
import { tileHash } from './ground';
import { mat } from './models3d';

/**
 * Décor 3D autour et sur la carte : monde extérieur (champs, mer, collines,
 * autoroute), arbres des forêts et maisons du village (instanciés pour rester
 * légers sur mobile), clôture du périmètre, nuages et ciel dégradé.
 */
const ROOFS = ['#b5523b', '#c46a3c', '#8f4a3a', '#d08a4e', '#6d7480', '#a4553f'];

function fieldsTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const cols = ['#7aa456', '#93ad5a', '#a9a85a', '#6f9d4d', '#b8b16a', '#86a85a'];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = cols[(x * 7 + y * 3 + ((x * y) % 5)) % cols.length];
    g.fillRect(x * 32, y * 32, 32, 32);
    g.strokeStyle = 'rgba(60,80,40,0.35)';
    g.lineWidth = 1;
    for (let k = 4; k < 32; k += 6) {
      g.beginPath();
      if ((x + y) % 2) { g.moveTo(x * 32 + k, y * 32); g.lineTo(x * 32 + k, y * 32 + 32); } else { g.moveTo(x * 32, y * 32 + k); g.lineTo(x * 32 + 32, y * 32 + k); }
      g.stroke();
    }
  }
  g.strokeStyle = 'rgba(50,80,40,0.8)';
  g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * 32); g.lineTo(256, i * 32); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(30, 30);
  return t;
}

function roadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4b4f57';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e5e7eb';
  g.fillRect(0, 2, 64, 2);
  g.fillRect(0, 60, 64, 2);
  g.fillRect(0, 31, 30, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SKY_VERT = `varying vec3 vPos; void main(){ vPos = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos,1.0); }`;
const SKY_FRAG = `uniform vec3 top; uniform vec3 horizon; uniform vec3 center; varying vec3 vPos;
void main(){ float h = clamp((vPos.y - center.y) / 220.0, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.6)), 1.0); }`;

export class Environment {
  group = new THREE.Group();
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private key = '';
  private dynamic = new THREE.Group();
  private clouds = new THREE.Group();
  private highwayCars: THREE.InstancedMesh;
  private carSpeeds: number[] = [];
  private mapW = 96;
  private mapH = 72;

  constructor() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color('#3f86d6') }, horizon: { value: new THREE.Color('#cfe6f7') }, center: { value: new THREE.Vector3() } },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(480, 24, 12), this.skyMat);
    this.sky.renderOrder = -10;
    this.group.add(this.sky);
    this.highwayCars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.22, 0.22), new THREE.MeshStandardMaterial({ color: '#ffffff' }), 60);
    this.highwayCars.castShadow = true;
    this.group.add(this.dynamic, this.clouds, this.highwayCars);
  }

  /** (Re)construit le décor quand la carte change (terrain défriché, achat de parcelle…). */
  sync(s: GameState, rev: number, quality: string): void {
    const key = `${s.id}|${rev}|${quality}`;
    if (key === this.key) return;
    this.key = key;
    this.mapW = s.map.w;
    this.mapH = s.map.h;
    this.dynamic.clear();
    const W = s.map.w;
    const H = s.map.h;
    const T = s.map.terrain;

    // Monde extérieur : champs, mer à l'est, autoroute au sud
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: fieldsTexture(), roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(W / 2, -0.06, H / 2);
    outer.receiveShadow = true;
    this.dynamic.add(outer);
    const eastWater = T[Math.floor(H / 2) * W + W - 1] === 1;
    if (eastWater) {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 900), new THREE.MeshStandardMaterial({ color: '#2a6fa8', roughness: 0.18, metalness: 0.25 }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(W + 200 - 0.5, -0.03, H / 2);
      this.dynamic.add(sea);
    }
    const hwTex = roadTexture();
    hwTex.repeat.set(140, 1);
    const hw = new THREE.Mesh(new THREE.PlaneGeometry(eastWater ? W + 300 : 600, 2.4), new THREE.MeshStandardMaterial({ map: hwTex, roughness: 0.9 }));
    hw.rotation.x = -Math.PI / 2;
    hw.position.set(eastWater ? (W - 300) / 2 : W / 2, -0.02, H + 1.8);
    hw.receiveShadow = true;
    this.dynamic.add(hw);
    this.carSpeeds = Array.from({ length: 60 }, (_, i) => (i % 2 ? 1 : -1) * (0.012 + tileHash(i, 1) * 0.01));

    // Collines basses à l'horizon (sauf côté mer)
    const hillMat = mat('#5c8a4c', { flatShading: true, roughness: 1 }, 'hill');
    const hillGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2;
      const dx = Math.cos(a);
      if (eastWater && dx > 0.35) continue;
      const r = 120 + tileHash(i, 7) * 70;
      const hill = new THREE.Mesh(hillGeo, hillMat);
      hill.scale.set(25 + tileHash(i, 2) * 30, 6 + tileHash(i, 3) * 16, 25 + tileHash(i, 4) * 25);
      hill.position.set(W / 2 + dx * r, -2, H / 2 + Math.sin(a) * r);
      hill.rotation.y = a;
      this.dynamic.add(hill);
    }

    // Arbres des forêts (deux formes, instanciées)
    const conePos: THREE.Matrix4[] = [];
    const roundPos: THREE.Matrix4[] = [];
    const housePos: THREE.Matrix4[] = [];
    const roofPos: THREE.Matrix4[] = [];
    const roofCol: THREE.Color[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const maxTrees = quality === 'low' ? 1 : 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = T[y * W + x];
      if (t === 2) {
        const n = Math.min(maxTrees, 1 + Math.floor(tileHash(x, y) * 2));
        for (let k = 0; k < n; k++) {
          const ox = 0.25 + tileHash(x, y, 10 + k) * 0.5;
          const oy = 0.25 + tileHash(x, y, 20 + k) * 0.5;
          const s0 = 0.7 + tileHash(x, y, 30 + k) * 0.6;
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tileHash(x, y, 40 + k) * 6);
          if (tileHash(x, y, 50 + k) < 0.5) conePos.push(m.compose(v.set(x + ox, 0.75 * s0, y + oy), q, sc.set(0.42 * s0, 0.75 * s0, 0.42 * s0)).clone());
          else roundPos.push(m.compose(v.set(x + ox, 0.75 * s0, y + oy), q, sc.set(0.5 * s0, 0.55 * s0, 0.5 * s0)).clone());
        }
      } else if (t === 5 && !(x % 4 === 0 || y % 4 === 0)) {
        const hgt = 0.45 + tileHash(x, y, 4) * 0.3;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tileHash(x, y, 6) < 0.5 ? 0 : Math.PI / 2);
        housePos.push(m.compose(v.set(x + 0.5, hgt / 2, y + 0.5), q, sc.set(0.68, hgt, 0.68)).clone());
        roofPos.push(m.compose(v.set(x + 0.5, hgt + 0.16, y + 0.5), q, sc.set(0.75, 0.32, 0.76)).clone());
        roofCol.push(new THREE.Color(ROOFS[Math.floor(tileHash(x, y, 2) * ROOFS.length)]));
      }
    }
    // Village et bois prolongés hors carte (sud-ouest et ouest)
    for (let i = 0; i < 70; i++) {
      const x = -4 - tileHash(i, 11) * 30;
      const y = H - 20 + tileHash(i, 12) * 34;
      const hgt = 0.45 + tileHash(i, 13) * 0.3;
      housePos.push(m.compose(v.set(x, hgt / 2, y), q.identity(), sc.set(0.68, hgt, 0.68)).clone());
      roofPos.push(m.compose(v.set(x, hgt + 0.16, y), q, sc.set(0.75, 0.32, 0.76)).clone());
      roofCol.push(new THREE.Color(ROOFS[i % ROOFS.length]));
    }
    for (let i = 0; i < 260; i++) {
      const x = -3 - tileHash(i, 21) * 35;
      const y = -10 + tileHash(i, 22) * (H - 15);
      const s0 = 0.8 + tileHash(i, 23) * 0.6;
      conePos.push(m.compose(v.set(x, 0.75 * s0, y), q.identity(), sc.set(0.42 * s0, 0.75 * s0, 0.42 * s0)).clone());
    }
    const inst = (geo: THREE.BufferGeometry, material: THREE.Material, list: THREE.Matrix4[], colors?: THREE.Color[]) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      if (colors) colors.forEach((c, i) => im.setColorAt(i, c));
      im.castShadow = quality !== 'low';
      im.receiveShadow = true;
      this.dynamic.add(im);
    };
    inst(new THREE.ConeGeometry(1, 2, 7), mat('#2f6e3b', { flatShading: true }, 'tree'), conePos);
    inst(new THREE.IcosahedronGeometry(1, 0), mat('#3f8a45', { flatShading: true }, 'tree'), roundPos);
    inst(new THREE.BoxGeometry(1, 1, 1), mat('#efe6d8', { roughness: 0.9 }, 'house'), housePos);
    const roofGeo = new THREE.CylinderGeometry(0.6, 0.6, 1, 3);
    roofGeo.rotateZ(Math.PI / 2);
    roofGeo.rotateX(Math.PI / 6);
    inst(roofGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.8 }), roofPos, roofCol);

    // Clôture du périmètre (poteaux + lisses)
    const posts: THREE.Matrix4[] = [];
    const rails: THREE.Matrix4[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!ownedAt(s, x, y)) continue;
      const edges: [number, number, boolean][] = [];
      if (x === 0 || !ownedAt(s, x - 1, y)) edges.push([x, y + 0.5, false]);
      if (x === W - 1 || !ownedAt(s, x + 1, y)) edges.push([x + 1, y + 0.5, false]);
      if (y === 0 || !ownedAt(s, x, y - 1)) edges.push([x + 0.5, y, true]);
      if (y === H - 1 || !ownedAt(s, x, y + 1)) edges.push([x + 0.5, y + 1, true]);
      for (const [ex, ey, horiz] of edges) {
        posts.push(m.compose(v.set(horiz ? ex - 0.5 : ex, 0.18, horiz ? ey : ey - 0.5), q.identity(), sc.set(0.05, 0.36, 0.05)).clone());
        rails.push(m.compose(v.set(ex, 0.3, ey), q.identity(), sc.set(horiz ? 1 : 0.025, 0.12, horiz ? 0.025 : 1)).clone());
      }
    }
    inst(new THREE.BoxGeometry(1, 1, 1), mat('#9aa3ab', {}, 'fence'), posts);
    inst(new THREE.BoxGeometry(1, 1, 1), mat('#dfe5ea', { transparent: true, opacity: 0.85 }, 'fencemesh'), rails);

    // Nuages
    this.clouds.clear();
    if (quality !== 'low') {
      const cm = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, transparent: true, opacity: 0.92 });
      const cg = new THREE.IcosahedronGeometry(1, 0);
      for (let i = 0; i < 14; i++) {
        const cl = new THREE.Group();
        const n = 3 + Math.floor(tileHash(i, 31) * 3);
        for (let k = 0; k < n; k++) {
          const p = new THREE.Mesh(cg, cm);
          p.scale.set(3 + tileHash(i, 40 + k) * 3, 1.6 + tileHash(i, 50 + k) * 1.2, 2.5 + tileHash(i, 60 + k) * 2);
          p.position.set(k * 3 - n * 1.5, tileHash(i, 70 + k), tileHash(i, 80 + k) * 2);
          cl.add(p);
        }
        cl.position.set(-60 + tileHash(i, 32) * (W + 120), 26 + tileHash(i, 33) * 12, -40 + tileHash(i, 34) * (H + 80));
        this.clouds.add(cl);
      }
    }
  }

  /** Animation : nuages poussés par le vent, voitures sur l'autoroute, couleurs du ciel. */
  update(s: GameState, t: number, daylight: number, overcast: boolean, camTarget: THREE.Vector3): void {
    const wind = s.weather.current;
    const wx = Math.sin((wind.windDir * Math.PI) / 180) * (0.002 + wind.wind * 0.0004);
    const wz = -Math.cos((wind.windDir * Math.PI) / 180) * (0.002 + wind.wind * 0.0004);
    for (const c of this.clouds.children) {
      c.position.x -= wx * 16;
      c.position.z -= wz * 16;
      if (c.position.x < -90) c.position.x = this.mapW + 90;
      if (c.position.x > this.mapW + 90) c.position.x = -90;
      if (c.position.z < -70) c.position.z = this.mapH + 70;
      if (c.position.z > this.mapH + 70) c.position.z = -70;
    }
    this.clouds.visible = !['fog', 'blizzard'].includes(wind.kind);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const span = this.mapW + 120;
    for (let i = 0; i < 60; i++) {
      const sp = this.carSpeeds[i] ?? 0.015;
      let x = ((tileHash(i, 5) * span + t * sp) % span + span) % span - 60;
      if (sp < 0) x = this.mapW + 60 - (x + 60);
      m.makeTranslation(x, 0.12, this.mapH + 1.2 + (sp > 0 ? 0 : 1.2));
      this.highwayCars.setMatrixAt(i, m);
      this.highwayCars.setColorAt(i, col.set(['#ef4444', '#3b82f6', '#f8fafc', '#111827', '#f59e0b', '#9ca3af'][i % 6]));
    }
    this.highwayCars.instanceMatrix.needsUpdate = true;
    if (this.highwayCars.instanceColor) this.highwayCars.instanceColor.needsUpdate = true;
    // Ciel
    const top = new THREE.Color('#0a1530').lerp(new THREE.Color(overcast ? '#7f8ea3' : '#3d84d4'), daylight);
    const hor = new THREE.Color('#1b2a4a').lerp(new THREE.Color(overcast ? '#c3ccd6' : '#d6ebf8'), daylight);
    this.skyMat.uniforms.top.value.copy(top);
    this.skyMat.uniforms.horizon.value.copy(hor);
    this.sky.position.copy(camTarget);
    this.skyMat.uniforms.center.value.copy(camTarget);
  }
}
