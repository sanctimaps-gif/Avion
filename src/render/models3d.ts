import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings';

/**
 * Modèles 3D procéduraux « low-poly » des bâtiments (style maquette claire :
 * murs blancs, toits gris, vitrages, accents de couleur). Géométries et
 * matériaux sont partagés pour limiter la mémoire sur mobile.
 */
const geoCache = new Map<string, THREE.BufferGeometry>();
export function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}
const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}, key = ''): THREE.MeshStandardMaterial {
  const k = color + key;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...opts });
    matCache.set(k, m);
  }
  return m;
}

// ---------- Textures procédurales ----------
function canvasTex(draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let facade: THREE.CanvasTexture | null = null;
let glow: THREE.CanvasTexture | null = null;
let curtain: THREE.CanvasTexture | null = null;
function facadeTexture() {
  return (facade ??= canvasTex((g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#34495e';
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) g.fillRect(5 + x * 32, 9 + y * 32, 22, 13);
    g.fillStyle = '#dfe5ec';
    g.fillRect(0, 28, 64, 3);
    g.fillRect(0, 60, 64, 3);
  }));
}
function glowTexture() {
  return (glow ??= canvasTex((g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#fff';
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) if ((x + y * 3) % 4 !== 3) g.fillRect(5 + x * 32, 9 + y * 32, 22, 13);
  }, false));
}
function curtainTexture() {
  return (curtain ??= canvasTex((g) => {
    g.fillStyle = '#5aa9dc';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#8fd0f2';
    g.fillRect(0, 0, 64, 20);
    g.fillStyle = '#e8eef4';
    for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 2, 64);
    g.fillRect(0, 30, 64, 2);
  }));
}

/** Boîte dont les UV suivent les dimensions réelles (fenêtres non déformées). */
function uvBox(w: number, h: number, d: number, su = 1.2, sv = 1.4): THREE.BufferGeometry {
  return geo(`uvbox:${w.toFixed(2)}:${h.toFixed(2)}:${d.toFixed(2)}:${su}:${sv}`, () => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] * su, uv.getY(k) * dims[f][1] * sv);
    }
    uv.needsUpdate = true;
    return g;
  });
}

/** Matériaux dont l'éclairage nocturne est piloté par la vue 3D. */
export const nightMats = new Set<THREE.MeshStandardMaterial>();
function windowWall(color = '#f3f5f8'): THREE.MeshStandardMaterial {
  const m = mat(color, { map: facadeTexture(), emissive: new THREE.Color('#ffc66b'), emissiveMap: glowTexture(), emissiveIntensity: 0 }, 'wall');
  nightMats.add(m);
  return m;
}
function curtainWall(): THREE.MeshStandardMaterial {
  const m = mat('#ffffff', { map: curtainTexture(), metalness: 0.35, roughness: 0.25, emissive: new THREE.Color('#ffe2a8'), emissiveIntensity: 0 }, 'curtain');
  nightMats.add(m);
  return m;
}

const WHITE = '#f1f4f7';
const ROOF = '#6f7884';
const CONCRETE = '#c9cdd3';

// ---------- Primitives ----------
type G = THREE.Group;
const unitBox = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const unitCyl = () => geo('cyl12', () => new THREE.CylinderGeometry(1, 1, 1, 12));

function add(g: G, m: THREE.Object3D, shadow = true): THREE.Object3D {
  m.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = shadow;
      o.receiveShadow = true;
    }
  });
  g.add(m);
  return m;
}
function box(g: G, w: number, h: number, d: number, m: THREE.Material, x = 0, y = h / 2, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(unitBox(), m);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  add(g, mesh);
  return mesh;
}
function wbox(g: G, w: number, h: number, d: number, m: THREE.Material, x = 0, y = h / 2, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(uvBox(w, h, d), m);
  mesh.position.set(x, y, z);
  add(g, mesh);
  return mesh;
}
function cyl(g: G, r: number, h: number, m: THREE.Material, x = 0, y = h / 2, z = 0, rTop = r): THREE.Mesh {
  const mesh = new THREE.Mesh(rTop === r ? unitCyl() : geo(`cone:${(rTop / r).toFixed(2)}`, () => new THREE.CylinderGeometry(rTop / r, 1, 1, 12)), m);
  mesh.scale.set(r, h, r);
  mesh.position.set(x, y, z);
  add(g, mesh);
  return mesh;
}
/** Toit plat avec acrotère et équipements techniques. */
function flatRoof(g: G, w: number, d: number, y: number, units = 2): void {
  box(g, w, 0.06, d, mat('#e6eaef'), 0, y + 0.03);
  box(g, w - 0.16, 0.04, d - 0.16, mat(ROOF), 0, y + 0.06);
  for (let i = 0; i < units; i++) {
    const ux = (i / Math.max(1, units - 1) - 0.5) * w * 0.5;
    box(g, 0.45, 0.22, 0.35, mat('#c3cad3'), ux, y + 0.17, d * 0.15);
  }
}
function car(g: G, x: number, z: number, rot: number, color: string): void {
  const c = new THREE.Group();
  box(c, 0.38, 0.12, 0.2, mat(color, { metalness: 0.4, roughness: 0.4 }), 0, 0.08);
  box(c, 0.2, 0.08, 0.18, mat('#1f2937'), -0.02, 0.18);
  c.position.set(x, 0, z);
  c.rotation.y = rot;
  add(g, c);
}
const CAR_COLORS = ['#e5e7eb', '#1f2937', '#dc2626', '#2563eb', '#9ca3af', '#f8fafc', '#0f766e', '#f59e0b'];

function rnd(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * Construit le modèle d'un bâtiment. W×D = empreinte (x, z), centré sur l'origine.
 */
export function buildingModel(type: string, W: number, D: number, level: number, seed: number): THREE.Group {
  const d = BUILDINGS[type];
  const g = new THREE.Group();
  const H = Math.max(0.2, d.height * (1 + 0.15 * (level - 1)));
  const accent = mat(d.roof ?? d.color);
  const long = W >= D;
  const r = rnd(seed);
  // Dalle / trottoir
  if (type !== 'trees' && type !== 'ils') box(g, W * 0.98, 0.04, D * 0.98, mat(CONCRETE), 0, 0.02);
  switch (type) {
    case 'terminal_s':
    case 'terminal_m':
    case 'terminal_l': {
      // Socle, façade vitrée, grand toit ondulé débordant, verrières
      const bw = W * 0.9;
      const bd = D * 0.8;
      wbox(g, bw, H * 0.35, bd, windowWall(WHITE));
      wbox(g, bw * 0.96, H * 0.5, bd * 0.92, curtainWall(), 0, H * 0.35 + H * 0.25);
      const roof = new THREE.Mesh(geo('wave', () => new THREE.CylinderGeometry(1, 1, 1, 24, 1, false, 0, Math.PI)), mat('#f7f9fb', { roughness: 0.4, metalness: 0.2 }));
      roof.rotation.set(0, long ? 0 : Math.PI / 2, Math.PI / 2);
      roof.scale.set(H * 0.28, (long ? W : D) * 0.98, (long ? D : W) * 0.5);
      roof.position.y = H * 0.85;
      add(g, roof);
      // Verrières sur le toit
      const n = Math.max(2, Math.round((long ? W : D) / 2));
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n - 0.5) * (long ? W : D) * 0.85;
        box(g, long ? 0.25 : D * 0.7, 0.05, long ? D * 0.7 : 0.25, mat('#5aa9dc', { metalness: 0.5, roughness: 0.2 }), long ? t : 0, H * 0.85 + H * 0.28 + 0.01, long ? 0 : t);
      }
      // Auvent côté ville (+z) sur piliers
      box(g, bw * 0.7, 0.06, 0.6, mat('#e2e8f0'), 0, H * 0.32, bd / 2 + 0.3);
      for (const px of [-0.3, 0, 0.3]) cyl(g, 0.04, H * 0.32, mat('#94a3b8'), px * bw, H * 0.16, bd / 2 + 0.55);
      break;
    }
    case 'pier': {
      wbox(g, W * 0.85, H * 0.7, D * 0.95, curtainWall());
      box(g, W * 0.95, 0.1, D, mat('#f1f5f9'), 0, H * 0.75);
      break;
    }
    case 'tower_s':
    case 'tower_l': {
      const R = Math.min(W, D) * 0.16;
      // Bâtiment de base
      wbox(g, W * 0.85, 0.7, D * 0.6, windowWall(), 0, 0.35, D * 0.15);
      flatRoof(g, W * 0.85, D * 0.6, 0.7, 1);
      cyl(g, R, H, mat('#f1f5f9'), 0, H / 2, -D * 0.05, R * 0.75);
      // Vigie
      const cab = new THREE.Mesh(geo('cab8', () => new THREE.CylinderGeometry(1, 0.8, 1, 8)), mat('#5fb2e6', { metalness: 0.6, roughness: 0.15, emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 0 }, 'cab'));
      nightMats.add(cab.material as THREE.MeshStandardMaterial);
      cab.scale.set(R * 2.4, 0.55, R * 2.4);
      cab.position.set(0, H + 0.35, -D * 0.05);
      add(g, cab);
      cyl(g, R * 2.1, 0.12, mat('#e2e8f0'), 0, H + 0.03, -D * 0.05);
      cyl(g, R * 2.7, 0.1, mat('#f8fafc'), 0, H + 0.68, -D * 0.05);
      cyl(g, 0.03, 0.7, mat('#94a3b8'), 0, H + 1.05, -D * 0.05);
      box(g, 0.08, 0.08, 0.08, mat('#ef4444', { emissive: new THREE.Color('#ef4444'), emissiveIntensity: 1 }, 'beacon'), 0, H + 1.42, -D * 0.05);
      break;
    }
    case 'hangar': {
      const L = long ? W : D;
      const S = long ? D : W;
      const holder = new THREE.Group();
      box(holder, L * 0.96, H * 0.35, S * 0.9, mat('#d5dbe2'));
      const roof = new THREE.Mesh(geo('halfcyl', () => new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, 0, Math.PI)), mat('#8a98ab', { metalness: 0.3, roughness: 0.5 }));
      roof.rotation.z = Math.PI / 2;
      roof.scale.set(H * 0.75, L * 0.96, S * 0.45);
      roof.position.y = H * 0.33;
      add(holder, roof);
      // Grande porte rayée côté piste
      box(holder, L * 0.08, H * 0.6, S * 0.8, mat('#475569'), L * 0.485, H * 0.3);
      for (let i = 0; i < 6; i++) box(holder, 0.03, 0.06, S * 0.8, mat(i % 2 ? '#facc15' : '#111827'), L * 0.53, 0.05 + i * 0.06);
      if (!long) holder.rotation.y = Math.PI / 2;
      add(g, holder);
      break;
    }
    case 'fire_station': {
      wbox(g, W * 0.9, H, D * 0.75, windowWall('#f8f8f8'), 0, H / 2, -D * 0.08);
      box(g, W * 0.92, 0.12, D * 0.77, mat('#b91c1c'), 0, H + 0.06, -D * 0.08);
      for (let i = 0; i < 3; i++) box(g, W * 0.22, H * 0.6, 0.04, mat('#dc2626'), (i - 1) * W * 0.28, H * 0.3, D * 0.3);
      box(g, 0.5, H * 1.8, 0.5, mat('#f1f5f9'), W * 0.35, H * 0.9, -D * 0.3);
      for (let i = 0; i < 2; i++) {
        const tr = new THREE.Group();
        box(tr, 0.7, 0.25, 0.3, mat('#dc2626'), 0, 0.17);
        box(tr, 0.2, 0.12, 0.28, mat('#e5e7eb'), 0.2, 0.35);
        tr.position.set((i - 0.5) * W * 0.4, 0, D * 0.42);
        add(g, tr);
      }
      break;
    }
    case 'fuel_depot': {
      box(g, W * 0.95, 0.15, D * 0.95, mat('#9ca3af'), 0, 0.08);
      const rr = Math.min(W, D) * 0.18;
      for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
        cyl(g, rr, H * 0.9, mat('#f8fafc', { metalness: 0.3, roughness: 0.4 }), x * W, H * 0.45, z * D);
        cyl(g, rr * 1.02, 0.05, mat('#94a3b8'), x * W, H * 0.9, z * D);
      }
      break;
    }
    case 'cargo': {
      wbox(g, W * 0.92, H, D * 0.6, windowWall('#e5e7eb'), 0, H / 2, -D * 0.15);
      flatRoof(g, W * 0.92, D * 0.6, H, 3);
      for (let i = 0; i < Math.floor(W); i++) box(g, 0.5, H * 0.45, 0.06, mat('#475569'), (i + 0.5 - W / 2) * 0.92, H * 0.22, D * 0.15);
      const cols = ['#c2410c', '#1d4ed8', '#15803d', '#a16207', '#7c3aed'];
      for (let i = 0; i < Math.floor(W * 1.1); i++) for (let j = 0; j < 1 + (i % 2); j++) box(g, 0.7, 0.28, 0.3, mat(cols[(i + j + seed) % cols.length]), -W / 2 + 0.5 + i * 0.85, 0.14 + j * 0.29, D * 0.36);
      break;
    }
    case 'hotel': {
      wbox(g, W * 0.92, 0.8, D * 0.92, curtainWall(), 0, 0.4);
      wbox(g, W * 0.55, H, D * 0.6, windowWall(), 0, 0.8 + H / 2);
      flatRoof(g, W * 0.55, D * 0.6, 0.8 + H, 2);
      box(g, W * 0.3, 0.3, 0.05, mat('#0ea5e9', { emissive: new THREE.Color('#0ea5e9'), emissiveIntensity: 0.6 }, 'sign'), 0, 0.8 + H - 0.3, D * 0.3 + 0.03);
      break;
    }
    case 'parking_m': {
      const floors = 3;
      for (let i = 0; i <= floors; i++) box(g, W * 0.95, 0.08, D * 0.95, mat('#d1d5db'), 0, (H / floors) * i + 0.04);
      for (const x of [-0.42, 0, 0.42]) for (const z of [-0.42, 0, 0.42]) box(g, 0.15, H, 0.15, mat('#9ca3af'), x * W, H / 2, z * D);
      for (let i = 1; i <= floors; i++) for (let k = 0; k < 6; k++) car(g, (r() - 0.5) * W * 0.8, (r() - 0.5) * D * 0.8, r() > 0.5 ? 0 : Math.PI / 2, CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]);
      box(g, W * 0.95, 0.35, 0.05, mat('#6b7280'), 0, H + 0.2, D * 0.47);
      break;
    }
    case 'power_plant': {
      wbox(g, W * 0.7, H, D * 0.8, windowWall('#d6d3d1'), -W * 0.1, H / 2);
      flatRoof(g, W * 0.7, D * 0.8, H, 2);
      for (const z of [-0.25, 0.25]) cyl(g, 0.22, H * 2.2, mat('#a8a29e'), W * 0.35, H * 1.1, z * D, 0.17);
      for (const z of [-0.25, 0.25]) cyl(g, 0.23, 0.15, mat('#dc2626'), W * 0.35, H * 2.1, z * D);
      break;
    }
    case 'admin':
    case 'rnd':
    case 'training': {
      wbox(g, W * 0.88, H, D * 0.75, windowWall(), 0, H / 2, -D * 0.05);
      flatRoof(g, W * 0.88, D * 0.75, H, 2);
      box(g, W * 0.5, 0.08, 0.7, accent, 0, H * 0.45, D * 0.38);
      if (type === 'rnd') {
        const dome = new THREE.Mesh(geo('dome', () => new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mat('#f8fafc'));
        dome.scale.setScalar(Math.min(W, D) * 0.25);
        dome.position.set(W * 0.2, H + 0.1, -D * 0.05);
        add(g, dome);
      }
      break;
    }
    case 'checkin':
    case 'security':
    case 'baggage_claim':
    case 'info_desk': {
      wbox(g, W * 0.94, H, D * 0.94, windowWall(), 0, H / 2);
      flatRoof(g, W * 0.94, D * 0.94, H, W >= 2 ? 2 : 0);
      box(g, W * 0.95, 0.12, D * 0.95, accent, 0, H * 0.92);
      break;
    }
    case 'cafe':
    case 'restaurant':
    case 'shop':
    case 'dutyfree':
    case 'lounge':
    case 'rental': {
      wbox(g, W * 0.9, H * 0.85, D * 0.85, curtainWall(), 0, H * 0.425, -D * 0.04);
      flatRoof(g, W * 0.9, D * 0.85, H * 0.85, 1);
      // Auvent coloré
      const aw = box(g, W * 0.9, 0.05, 0.5, accent, 0, H * 0.6, D * 0.42);
      aw.rotation.x = 0.25;
      if (type === 'rental') for (let i = 0; i < 2; i++) car(g, (i - 0.5) * 0.8, D * 0.45, 0, CAR_COLORS[(seed + i) % CAR_COLORS.length]);
      break;
    }
    case 'ads': {
      for (const x of [-0.25, 0.25]) box(g, 0.05, H, 0.05, mat('#64748b'), x * W, H / 2);
      box(g, W * 0.9, 0.5, 0.06, mat('#0f172a'), 0, H - 0.1);
      box(g, W * 0.82, 0.4, 0.02, mat('#22d3ee', { emissive: new THREE.Color('#22d3ee'), emissiveIntensity: 0.5 }, 'ads'), 0, H - 0.1, 0.04);
      break;
    }
    case 'bus_station': {
      box(g, W * 0.9, 0.08, D * 0.5, mat('#16a34a'), 0, H, -D * 0.15);
      for (const x of [-0.4, 0, 0.4]) cyl(g, 0.05, H, mat('#94a3b8'), x * W, H / 2, -D * 0.15);
      for (let i = 0; i < 2; i++) {
        const bus = new THREE.Group();
        box(bus, 1.1, 0.4, 0.32, mat('#facc15'), 0, 0.25);
        box(bus, 1.0, 0.12, 0.33, mat('#334155'), 0, 0.32);
        bus.position.set((i - 0.5) * W * 0.45, 0, D * 0.3);
        add(g, bus);
      }
      break;
    }
    case 'train_station': {
      wbox(g, W * 0.5, H, D * 0.5, curtainWall(), -W * 0.2, H / 2, -D * 0.2);
      const roof = new THREE.Mesh(geo('halfcyl', () => new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, 0, Math.PI)), mat('#0284c7', { metalness: 0.3 }));
      roof.rotation.z = Math.PI / 2;
      roof.scale.set(0.5, W * 0.95, D * 0.25);
      roof.position.set(0, H * 0.6, D * 0.25);
      add(g, roof);
      for (const z of [0.15, 0.35]) box(g, W, 0.03, 0.04, mat('#57534e'), 0, 0.06, z * D);
      const train = new THREE.Group();
      box(train, W * 0.7, 0.35, 0.3, mat('#f8fafc'), 0, 0.25);
      box(train, W * 0.7, 0.08, 0.31, mat('#dc2626'), 0, 0.3);
      train.position.set(0, 0, D * 0.25);
      add(g, train);
      break;
    }
    case 'snow_depot': {
      wbox(g, W * 0.9, H, D * 0.7, windowWall('#e2e8f0'), 0, H / 2, -D * 0.1);
      flatRoof(g, W * 0.9, D * 0.7, H, 1);
      for (let i = 0; i < 3; i++) box(g, W * 0.24, H * 0.65, 0.04, mat('#f97316'), (i - 1) * W * 0.29, H * 0.32, D * 0.26);
      break;
    }
    case 'ils': {
      for (let i = 0; i < 6; i++) cyl(g, 0.025, H, mat('#f2c94c'), 0, H / 2, (i / 5 - 0.5) * D * 0.8);
      box(g, 0.06, 0.05, D * 0.85, mat('#f2c94c'), 0, H);
      box(g, 0.4, 0.3, 0.4, mat('#e5e7eb'), 0.2, 0.15, D * 0.45);
      break;
    }
    case 'trees': {
      for (let i = 0; i < 5; i++) {
        const tx = (r() - 0.5) * W * 0.8;
        const tz = (r() - 0.5) * D * 0.8;
        const s = 0.6 + r() * 0.5;
        cyl(g, 0.07 * s, 0.5 * s, mat('#5b3a1e'), tx, 0.25 * s, tz);
        const crown = new THREE.Mesh(r() > 0.4 ? geo('crown', () => new THREE.IcosahedronGeometry(1, 0)) : geo('cone', () => new THREE.ConeGeometry(1, 2, 7)), mat(r() > 0.5 ? '#2f7d4a' : '#3d9157', { flatShading: true }, 'tree'));
        crown.scale.setScalar(0.42 * s);
        crown.position.set(tx, 0.85 * s, tz);
        add(g, crown);
      }
      break;
    }
    default: {
      wbox(g, W * 0.92, H, D * 0.92, windowWall(), 0, H / 2);
      flatRoof(g, W * 0.92, D * 0.92, H, 2);
    }
  }
  return g;
}

/** Décor 3D des éléments plats : voitures sur les parkings, panneaux solaires, engins de dégivrage. */
export function flatDecor(type: string, W: number, D: number, seed: number): THREE.Group | null {
  const g = new THREE.Group();
  const r = rnd(seed);
  if (type === 'parking_s') {
    for (let x = -W / 2 + 0.3; x < W / 2 - 0.2; x += 0.5) for (const z of [-D * 0.3, D * 0.3]) if (r() < 0.65) car(g, x + 0.2, z, Math.PI / 2, CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]);
    for (const [x, z] of [[-W / 2 + 0.2, -D / 2 + 0.2], [W / 2 - 0.2, D / 2 - 0.2]]) {
      cyl(g, 0.03, 0.9, mat('#94a3b8'), x, 0.45, z);
      box(g, 0.25, 0.04, 0.08, mat('#fef3c7', { emissive: new THREE.Color('#fde68a'), emissiveIntensity: 0.4 }, 'lamp'), x, 0.9, z);
    }
    return g;
  }
  if (type === 'solar') {
    for (let z = -D / 2 + 0.35; z < D / 2 - 0.2; z += 0.6) {
      const p = box(g, W * 0.9, 0.04, 0.42, mat('#1e3a8a', { metalness: 0.6, roughness: 0.25 }), 0, 0.25, z);
      p.rotation.x = -0.45;
    }
    return g;
  }
  if (type === 'deicing') {
    for (let i = 0; i < 2; i++) {
      const t = new THREE.Group();
      box(t, 0.6, 0.25, 0.3, mat('#f97316'), 0, 0.17);
      const boom = box(t, 0.06, 0.8, 0.06, mat('#e5e7eb'), 0.15, 0.6);
      boom.rotation.z = -0.5;
      t.position.set((i - 0.5) * W * 0.7, 0, (i - 0.5) * D * 0.7);
      add(g, t);
    }
    return g;
  }
  return null;
}

/** Passerelle télescopique reliant un poste au terminal (direction : vecteur unitaire vers le poste). */
export function jetway(len: number): THREE.Group {
  const g = new THREE.Group();
  box(g, len, 0.22, 0.24, mat('#e5e7eb'), len / 2, 0.55);
  box(g, len, 0.04, 0.26, mat('#64748b'), len / 2, 0.68);
  box(g, 0.3, 0.3, 0.32, mat('#cbd5e1'), len, 0.55);
  cyl(g, 0.05, 0.45, mat('#475569'), len * 0.75, 0.22);
  box(g, 0.25, 0.12, 0.2, mat('#334155'), len * 0.75, 0.06);
  return g;
}
