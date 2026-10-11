import * as THREE from 'three';
import { AIRCRAFT } from '../data/aircraft';
import { AIRLINES } from '../data/airlines';
import { BUILDINGS, footprint } from '../data/buildings';
import { clamp } from '../core/format';
import { canBuyParcel, parcelCount } from '../sim/construction';
import { visibleFlights } from '../sim/flights';
import { bFootprint, getWorld } from '../sim/world';
import type { Building, Flight, GameState, Pt } from '../sim/types';
import { daylight, flightPose, minuteOfDay, remainingRoute, serviceVehicles, sunAngle } from './common';
import { drawGround, FLAT } from './ground';
import { ZOOM_MAX, ZOOM_MIN, type Camera, type FrameInfo, type GameView, type ViewKind } from './view';

/**
 * Vue 3D réaliste (Three.js) : bâtiments en volume, avions animés,
 * éclairage dynamique avec ombres, cycle jour-nuit, brouillard et
 * précipitations. Le sol utilise le même rendu que la vue 2D (texture).
 */
const TEX_PX = 24;

import { buildingModel, flatDecor, geo, jetway, mat, nightMats } from './models3d';
import { hasOwnJetways, importedAircraft, importedBuilding, importedJetway, loadModels, modelsLoaded } from './gltfModels';
import { Environment } from './env3d';
import { VehicleFleet } from './vehicles3d';
import { WEATHER } from '../data/weather';
import { activeList } from '../sim/incidents';
import detailAsphaltUrl from '../assets/textures/detail_asphalte.jpg?url';
import detailConcreteUrl from '../assets/textures/detail_beton.jpg?url';
import { Traffic } from './traffic';
import { Crowd, forgetInterior, INTERIOR, interiorBuilding, interiorNightMats } from './interior3d';

/** Informations de diagnostic WebGL (affichées dans les paramètres). */
export function webglInfo(): { webgl2: boolean; renderer: string } {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return { webgl2: false, renderer: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true, renderer: r };
  } catch {
    return { webgl2: false, renderer: '' };
  }
}

const CAR_COLORS = ['#ef4444', '#3b82f6', '#f8fafc', '#f59e0b', '#111827', '#9ca3af', '#16a34a', '#7c3aed'];
/** Modèles de la circulation routière (variété). */
const CARS = ['voiture', 'voiture_s13', 'voiture_merco', 'voiture', 'voiture_s13', 'voiture_ferrari', 'voiture_shelby', 'moto'] as const;

export class View3D implements GameView {
  kind: ViewKind = '3d';
  /** Mode « intérieur » : aérogare en coupe, mobilier et foule. */
  interior = false;
  private crowd = new Crowd();
  private interiorIds: number[] = [];
  private traffic = new Traffic();
  private portals = new THREE.Group();
  private portalKey = '';
  /** Tracé bleu du roulage du vol sélectionné. */
  private route = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#2563eb', transparent: true, opacity: 0.85, depthWrite: false }));
  private routeKey = '';
  canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1100);
  private env = new Environment();
  private fleet = new VehicleFleet();
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private hemi = new THREE.HemisphereLight(0xbfdcff, 0x3a5a2a, 1.1);
  private ground: THREE.Mesh;
  private groundCanvas = document.createElement('canvas');
  private groundTex: THREE.CanvasTexture;
  private groundKey = '';
  private buildings = new Map<number, { obj: THREE.Object3D; key: string }>();
  private planes = new Map<number, THREE.Group>();
  private vehicles: THREE.InstancedMesh;
  private ghost = new THREE.Group();
  private selection: THREE.LineSegments;
  private parcels = new THREE.Group();
  private runwayLights: THREE.Points;
  private precip: THREE.Points;
  private precipKind = '';
  private windowMat = mat('#1e293b', { emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 0 }, 'win');
  private glassMat = mat('#7dd3fc', { transparent: true, opacity: 0.75, metalness: 0.3, roughness: 0.2, emissive: new THREE.Color('#ffe0a0'), emissiveIntensity: 0 }, 'glass');
  private w = 1;
  private h = 1;
  private quality: string = '';
  private ray = new THREE.Raycaster();
  private mapW = 72;
  private mapH = 56;

  /** Appelé si le contexte WebGL est perdu (mémoire saturée sur mobile) ou restauré. */
  onContextChange: ((lost: boolean) => void) | null = null;
  lost = false;

  constructor() {
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints ?? 0) > 1;
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile || (window.devicePixelRatio || 1) < 2, powerPreference: 'default', preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false });
    this.canvas = this.renderer.domElement;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.onContextChange?.(true);
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      // Tout reconstruire : textures et maillages sont à recréer.
      this.groundKey = '';
      for (const v of this.buildings.values()) this.scene.remove(v.obj);
      this.buildings.clear();
      for (const g of this.planes.values()) this.scene.remove(g);
      this.planes.clear();
      this.onContextChange?.(false);
    });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.add(this.hemi);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 60;
    sc.bottom = -60;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.bias = -0.0008;

    this.groundCanvas.width = 72 * TEX_PX;
    this.groundCanvas.height = 56 * TEX_PX;
    this.groundTex = new THREE.CanvasTexture(this.groundCanvas);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.anisotropy = 4;
    const groundMat = new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 0.95 });
    this.setupGroundDetail(groundMat);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.scene.add(this.env.group);
    this.scene.add(this.fleet.group);
    this.crowd.group.visible = false;
    this.scene.add(this.crowd.group);
    this.route.renderOrder = 2;
    this.scene.add(this.route);
    this.scene.add(this.portals);

    this.vehicles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.25, 0.22), new THREE.MeshStandardMaterial({ color: '#ffffff' }), 400);
    this.vehicles.count = 0;
    this.vehicles.castShadow = true;
    this.scene.add(this.vehicles);
    this.scene.add(this.ghost);
    this.scene.add(this.parcels);
    this.selection = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#38bdf8' }));
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.runwayLights = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#fff3c4', size: 0.35, sizeAttenuation: true, transparent: true }));
    this.scene.add(this.runwayLights);
    // Flocons / gouttes ronds (texture de disque)
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const dg = dot.getContext('2d')!;
    const grad = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    dg.fillStyle = grad;
    dg.fillRect(0, 0, 32, 32);
    this.precip = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#dbeafe', size: 0.12, transparent: true, opacity: 0.85, map: new THREE.CanvasTexture(dot), depthWrite: false }));
    this.scene.add(this.precip);
    this.scene.fog = new THREE.Fog('#9cc7e8', 80, 400);
    // Les modèles importés arrivent de façon asynchrone : on reconstruit ensuite.
    void loadModels().then(() => {
      for (const v of this.buildings.values()) this.scene.remove(v.obj);
      this.buildings.clear();
      for (const g of this.planes.values()) this.scene.remove(g);
      this.planes.clear();
    });
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.renderer.setPixelRatio(Math.min(dpr, this.quality === 'high' ? 2 : this.quality === 'low' ? 1 : 1.25));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.renderer.dispose();
    this.canvas.remove();
  }

  /**
   * Grain photographique du sol : asphalte sur pistes, taxiways et routes, dalles de béton
   * sur les postes. Un masque (1 pixel par case) dit quelle texture appliquer ; les
   * textures de détail (moyenne 0,5) modulent la couleur du sol dessiné, marquages compris.
   */
  private surfData = new Uint8Array(4);
  private surfTex = new THREE.DataTexture(this.surfData, 1, 1);
  private groundUniforms = { uSurf: { value: this.surfTex as THREE.Texture }, uAsph: { value: null as THREE.Texture | null }, uConc: { value: null as THREE.Texture | null }, uMapSize: { value: new THREE.Vector2(96, 72) } };
  private setupGroundDetail(m: THREE.MeshStandardMaterial): void {
    const load = (url: string) => {
      const t = new THREE.TextureLoader().load(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      return t;
    };
    this.groundUniforms.uAsph.value = load(detailAsphaltUrl);
    this.groundUniforms.uConc.value = load(detailConcreteUrl);
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.groundUniforms);
      sh.fragmentShader = 'uniform sampler2D uSurf; uniform sampler2D uAsph; uniform sampler2D uConc; uniform vec2 uMapSize;\n' + sh.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          vec2 surf = texture2D( uSurf, vMapUv ).rg;
          vec2 wp = vMapUv * uMapSize;
          float da = texture2D( uAsph, wp / 2.0 ).r * 2.0;
          float dc = texture2D( uConc, wp / 3.0 ).r * 2.0;
          diffuseColor.rgb *= mix( 1.0, da, surf.r * 0.7 ) * mix( 1.0, dc, surf.g * 0.45 );
        #endif`,
      );
    };
  }

  private updateSurfaceMask(s: GameState): void {
    const W = s.map.w;
    const H = s.map.h;
    if (this.surfData.length !== W * H * 4) {
      this.surfData = new Uint8Array(W * H * 4);
      this.surfTex.dispose();
      this.surfTex = new THREE.DataTexture(this.surfData, W, H);
      this.surfTex.magFilter = THREE.NearestFilter;
      this.surfTex.minFilter = THREE.NearestFilter;
      this.groundUniforms.uSurf.value = this.surfTex;
      this.groundUniforms.uMapSize.value.set(W, H);
    }
    this.surfData.fill(0);
    for (const b of s.buildings) {
      const t = b.type;
      const asph = t.startsWith('runway') || t === 'taxiway' || t === 'road' || t === 'parking_s';
      const conc = t.startsWith('stand') || t === 'deicing';
      if (!asph && !conc) continue;
      const f = bFootprint(b);
      for (let y = b.y; y < b.y + f.h; y++) for (let x = b.x; x < b.x + f.w; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        // Ligne 0 de la texture = bas du sol (v = 0) : on inverse y.
        const i = ((H - 1 - y) * W + x) * 4;
        this.surfData[i] = asph ? 255 : 0;
        this.surfData[i + 1] = conc ? 255 : 0;
      }
    }
    this.surfTex.needsUpdate = true;
  }

  /** Passe en vue intérieure (ou en revient) : les bâtiments concernés sont redessinés. */
  setInterior(on: boolean): void {
    this.interior = on;
    this.kind = on ? 'inside' : '3d';
    this.crowd.group.visible = on;
    this.camera.near = on ? 0.05 : 0.5;
    this.camera.updateProjectionMatrix();
  }

  private distance(cam: Camera): number {
    return 1100 / cam.zoom;
  }

  private placeCamera(cam: Camera): void {
    const d = this.distance(cam);
    const p = clamp(cam.pitch, 0.35, 1.45);
    this.camera.position.set(cam.cx + Math.sin(cam.rot) * Math.cos(p) * d, Math.sin(p) * d, cam.cy + Math.cos(cam.rot) * Math.cos(p) * d);
    this.camera.lookAt(cam.cx, 0, cam.cy);
  }

  screenToTile(_s: GameState, cam: Camera, x: number, y: number): Pt | null {
    this.placeCamera(cam);
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x, y: hit.z };
  }
  pan(cam: Camera, dx: number, dy: number): void {
    const k = (this.distance(cam) / this.h) * 1.1;
    const c = Math.cos(cam.rot);
    const s = Math.sin(cam.rot);
    cam.cx += (-dx * c - dy * s / Math.max(0.5, Math.sin(cam.pitch))) * k;
    cam.cy += (dx * s - dy * c / Math.max(0.5, Math.sin(cam.pitch))) * k;
    cam.cx = clamp(cam.cx, -10, this.mapW + 10);
    cam.cy = clamp(cam.cy, -10, this.mapH + 10);
  }
  zoom(cam: Camera, factor: number): void {
    cam.zoom = clamp(cam.zoom * factor, ZOOM_MIN, this.interior ? ZOOM_MAX * 3 : ZOOM_MAX);
  }
  rotate(cam: Camera, d: number): void {
    cam.rot -= d;
  }

  // ---------- Bâtiments ----------
  private makeBuilding(b: Building): THREE.Object3D {
    const d = BUILDINGS[b.type];
    const f = bFootprint(b);
    const g = new THREE.Group();
    const built = b.buildRemaining <= 0;
    const hgt = Math.max(0.2, d.height * (1 + 0.15 * (b.level - 1)));
    g.position.set(b.x + f.w / 2, 0, b.y + f.h / 2);
    if (!built) {
      const total = d.buildHours * 60 * (b.level > 1 ? 0.4 : 1);
      const p = clamp(1 - b.buildRemaining / total, 0.05, 1);
      const box = new THREE.Mesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), mat('#a3a3a3'));
      box.scale.set(f.w * 0.9, hgt * p, f.h * 0.9);
      box.position.y = (hgt * p) / 2;
      box.castShadow = true;
      g.add(box);
      const scaf = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(f.w * 0.95, hgt, f.h * 0.95)), new THREE.LineBasicMaterial({ color: '#facc15' }));
      scaf.position.y = hgt / 2;
      g.add(scaf);
      return g;
    }
    // Modèle importé (.glb) s'il existe, sinon modèle procédural.
    const model = importedBuilding(b.type, f.w, f.h) ?? buildingModel(b.type, f.w, f.h, b.level, b.id);
    g.add(model);
    if (b.brokenFor > 0) {
      const warn = new THREE.Mesh(geo('warncone', () => new THREE.ConeGeometry(0.3, 0.8, 6)), mat('#ef4444', { emissive: new THREE.Color('#ef4444'), emissiveIntensity: 0.8 }, 'warn'));
      warn.rotation.x = Math.PI;
      warn.position.y = hgt + 1.3;
      g.add(warn);
    }
    return g;
  }

  /** Décor des éléments plats et passerelles d'embarquement des postes au contact. */
  private makeDecor(s: GameState, b: Building): THREE.Object3D | null {
    const f = bFootprint(b);
    if (b.buildRemaining > 0) return null;
    const d = BUILDINGS[b.type];
    if (d.standSize) {
      const w = getWorld(s);
      const st = w.stands.find((x) => x.id === b.id);
      if (!st?.contact) return null;
      // Côté du poste touchant un bâtiment de terminal
      const W = s.map.w;
      const sides: [number, number, number, number][] = [];
      for (let x = b.x; x < b.x + f.w; x++) { sides.push([x, b.y - 1, 0, -1]); sides.push([x, b.y + f.h, 0, 1]); }
      for (let y = b.y; y < b.y + f.h; y++) { sides.push([b.x - 1, y, -1, 0]); sides.push([b.x + f.w, y, 1, 0]); }
      const hit = sides.find(([x, y]) => {
        if (x < 0 || y < 0 || x >= W || y >= s.map.h) return false;
        const nb = w.byId.get(w.occ[y * W + x]);
        return !!nb && !!BUILDINGS[nb.type].isTerminal;
      });
      if (!hit) return null;
      // Le terminal importé de base possède déjà ses passerelles.
      if (hasOwnJetways(w.byId.get(w.occ[hit[1] * W + hit[0]])!.type)) return null;
      const g = new THREE.Group();
      const jw = importedJetway(Math.min(f.w, f.h) * 0.42) ?? jetway(Math.min(f.w, f.h) * 0.42);
      // La passerelle part du bord du terminal vers le centre du poste.
      const cx = b.x + f.w / 2;
      const cz = b.y + f.h / 2;
      const ex = hit[2] !== 0 ? (hit[2] < 0 ? b.x : b.x + f.w) : cx + f.w * 0.25;
      const ez = hit[3] !== 0 ? (hit[3] < 0 ? b.y : b.y + f.h) : cz + f.h * 0.25;
      jw.position.set(ex, 0, ez);
      if (hit[3] !== 0) jw.rotation.y = hit[3] < 0 ? -Math.PI / 2 : Math.PI / 2;
      if (hit[2] !== 0) jw.rotation.y = hit[2] < 0 ? 0 : Math.PI;
      g.add(jw);
      return g;
    }
    const imp = importedBuilding(b.type, f.w, f.h);
    // Le parking importé garde ses voitures procédurales ; les autres modèles remplacent le décor.
    const dec = imp && b.type !== 'parking_s' ? null : flatDecor(b.type, f.w, f.h, b.id);
    if (imp) {
      imp.position.y = 0.01;
      const holder = dec ?? new THREE.Group();
      holder.add(imp);
      holder.position.set(b.x + f.w / 2, 0, b.y + f.h / 2);
      return holder;
    }
    if (!dec) return null;
    dec.position.set(b.x + f.w / 2, 0, b.y + f.h / 2);
    return dec;
  }

  private syncBuildings(s: GameState): void {
    const seen = new Set<number>();
    const ids: number[] = [];
    for (const b of s.buildings) {
      if (BUILDINGS[b.type].linear) continue;
      const flat = FLAT.has(b.type);
      seen.add(b.id);
      const inside = this.interior && INTERIOR.has(b.type) && b.buildRemaining <= 0;
      if (inside) ids.push(b.id);
      const key = `${b.type}|${b.x}|${b.y}|${b.rot}|${b.level}|${b.buildRemaining > 0 ? Math.floor(b.buildRemaining / 60) : 'ok'}|${b.brokenFor > 0}|${flat || inside ? getWorld(s).rev : ''}|${inside ? 'in' : ''}`;
      const cur = this.buildings.get(b.id);
      if (cur && cur.key === key) continue;
      if (cur) this.scene.remove(cur.obj);
      const obj = inside ? interiorBuilding(s, b) : flat ? this.makeDecor(s, b) ?? new THREE.Group() : this.makeBuilding(b);
      this.scene.add(obj);
      this.buildings.set(b.id, { obj, key });
    }
    this.interiorIds = ids;
    for (const [id, v] of this.buildings) {
      if (!seen.has(id)) {
        this.scene.remove(v.obj);
        forgetInterior(id);
        this.buildings.delete(id);
      }
    }
  }

  // ---------- Avions ----------
  private makePlane(f: Flight): THREE.Group {
    const a = AIRCRAFT[f.aircraft];
    const al = AIRLINES[f.airlineId];
    const imp = importedAircraft(f.aircraft, a.length, al.color);
    if (imp) {
      imp.obj.userData.props = imp.props;
      imp.obj.userData.imported = true;
      return imp.obj;
    }
    const g = new THREE.Group();
    const L = a.length;
    const R = L * 0.065;
    const white = mat('#f8fafc', { metalness: 0.3, roughness: 0.4 }, 'plane');
    const grey = mat('#cbd5e1', { metalness: 0.3, roughness: 0.5 }, 'plane');
    const livery = mat(al.color, { metalness: 0.2, roughness: 0.5 }, 'liv');
    const fus = new THREE.Mesh(geo('fus', () => new THREE.CapsuleGeometry(1, 1, 4, 10)), white);
    fus.rotation.z = Math.PI / 2;
    fus.scale.set(R, (L - 2 * R) / 1, R);
    const stripe = new THREE.Mesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), livery);
    stripe.scale.set(L * 0.8, R * 0.35, R * 2.05);
    stripe.position.set(-L * 0.05, 0, 0);
    // Ailes en flèche (une demi-aile par côté)
    const sweep = a.prop ? 0.05 : 0.45;
    const wings: THREE.Mesh[] = [];
    for (const sgn of [1, -1]) {
      const wgt = new THREE.Mesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), grey);
      wgt.scale.set(L * 0.13, R * 0.22, a.span / 2);
      wgt.rotation.y = sgn * sweep;
      wgt.position.set(-L * 0.08 - Math.sin(sweep) * a.span * 0.22, -R * 0.35, sgn * a.span * 0.24);
      wings.push(wgt);
    }
    const wing = new THREE.Group();
    wing.add(...wings);
    const stab = new THREE.Mesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), grey);
    stab.scale.set(L * 0.1, R * 0.2, a.span * 0.36);
    stab.position.set(-L * 0.44, R * 0.4, 0);
    const fin = new THREE.Mesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), livery);
    fin.scale.set(L * 0.14, L * 0.16, R * 0.25);
    fin.position.set(-L * 0.42, R + L * 0.07, 0);
    g.add(fus, stripe, wing, stab, fin);
    const engs = a.engines === 4 ? [0.18, 0.34] : [0.25];
    for (const e of engs) for (const sgn of [1, -1]) {
      const en = new THREE.Mesh(geo('eng', () => new THREE.CylinderGeometry(1, 1, 1, 8)), mat('#64748b'));
      en.rotation.z = Math.PI / 2;
      en.scale.set(R * 0.45, L * 0.11, R * 0.45);
      en.position.set(-L * 0.02, -R * 0.75, sgn * a.span * e);
      g.add(en);
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    return g;
  }

  private syncPlanes(s: GameState, fi: FrameInfo): void {
    const vis = visibleFlights(s);
    const seen = new Set<number>();
    let vi = 0;
    const useFleet = fi.quality !== 'low' && modelsLoaded() && this.fleet.build();
    this.fleet.group.visible = useFleet;
    if (useFleet) this.fleet.begin();
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    for (const f of vis) {
      seen.add(f.id);
      let g = this.planes.get(f.id);
      if (!g) {
        g = this.makePlane(f);
        this.planes.set(f.id, g);
        this.scene.add(g);
      }
      const p = flightPose(f, fi.prev, fi.frac);
      g.position.set(p.x, (g.userData.imported ? 0.02 : 0.32) + p.alt * 9, p.y);
      g.rotation.order = 'YXZ';
      g.rotation.set(p.alt > 0.02 && f.phase === 'holding' ? -0.35 : 0, -p.hdg, 0);
      for (const pr of (g.userData.props ?? []) as THREE.Object3D[]) pr.rotation.z += 0.9;
      if (f.phase === 'takeoff' || f.phase === 'departed') g.rotation.z = Math.min(0.25, p.alt * 0.6);
      if (f.phase === 'inbound') g.rotation.z = -0.05;
      if (!useFleet) {
        for (const v of serviceVehicles(f, fi.realTime)) {
          if (vi >= 400) break;
          m.makeTranslation(v.x, 0.15, v.y);
          this.vehicles.setMatrixAt(vi, m);
          this.vehicles.setColorAt(vi, col.set(v.color));
          vi++;
        }
      } else this.serviceFleet(s, f, p, fi.realTime);
    }
    // Circulation routière : trajets sur le réseau, tunnels et parkings souterrains.
    this.traffic.update(s, fi.realTime, fi.simSpeed ?? 1);
    this.syncPortals(s);
    for (const c of this.traffic.poses()) {
      const color = CAR_COLORS[c.seed % CAR_COLORS.length];
      if (useFleet) {
        const model = c.kind === 'bus' ? 'bus' : c.kind === 'taxi' ? 'voiture' : c.seed % 23 === 0 ? 'police' : CARS[c.seed % CARS.length];
        this.fleet.add(model, c.x, c.y, c.hdg, c.kind === 'taxi' ? '#facc15' : color, c.h);
        continue;
      }
      if (vi >= 400) continue;
      m.makeRotationY(-c.hdg).setPosition(c.x, 0.13 + c.h, c.y);
      this.vehicles.setMatrixAt(vi, m);
      this.vehicles.setColorAt(vi, col.set(color));
      vi++;
    }
    if (useFleet) {
      this.staticFleet(s, fi.realTime);
      this.env.highwayPoses(fi.realTime).forEach((c, k) => this.fleet.add(CARS[(k * 3) % CARS.length], c.x, c.z, c.hdg, c.color));
      this.fleet.end();
    }
    this.env.boxCars = !useFleet;
    this.vehicles.count = vi;
    this.vehicles.instanceMatrix.needsUpdate = true;
    if (this.vehicles.instanceColor) this.vehicles.instanceColor.needsUpdate = true;
    for (const [id, g] of this.planes) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.planes.delete(id);
      }
    }
  }

  /** Véhicules de piste autour d'un avion (modèles 3D). */
  private serviceFleet(s: GameState, f: Flight, p: { x: number; y: number; hdg: number; alt: number }, t: number): void {
    const a = AIRCRAFT[f.aircraft];
    if (f.phase === 'taxi_out' && f.pathPos < 2.5) {
      // Tracteur de repoussage devant le nez
      this.fleet.add('tracteur_repoussage', p.x + Math.cos(p.hdg) * a.length * 0.62, p.y + Math.sin(p.hdg) * a.length * 0.62, p.hdg + Math.PI);
      return;
    }
    const deice = s.settings.weather && WEATHER[s.weather.current.kind].needsDeicing && getWorld(s).cap.deicing > 0;
    if (f.phase === 'servicing' || f.phase === 'deboarding' || f.phase === 'boarding') {
      // Groupe électrique de parc branché sous le nez pendant toute l'escale.
      const gx = p.x + Math.cos(p.hdg) * a.length * 0.36 + Math.sin(p.hdg) * a.length * 0.1;
      const gy = p.y + Math.sin(p.hdg) * a.length * 0.36 - Math.cos(p.hdg) * a.length * 0.1;
      this.fleet.add('gpu', gx, gy, p.hdg + Math.PI / 2);
    }
    if (f.phase === 'servicing') {
      // Chaque service a son véhicule à sa place autour de l'avion ; en mode contrôleur,
      // seuls les services lancés et en cours sont visibles.
      const L = a.length;
      const fx = Math.cos(p.hdg);
      const fy = Math.sin(p.hdg);
      // Côté passagers (portes, escalier) : (-fy, fx) ; côté service : l'opposé.
      const at = (fwd: number, side: number) => ({ x: p.x + fx * fwd * L - fy * side * L, y: p.y + fy * fwd * L + fx * side * L });
      const toward = (side: number) => Math.atan2(-Math.sign(side) * fx, Math.sign(side) * fy);
      const on = (k: 'fuel' | 'bags' | 'catering' | 'cleaning') => !f.svc || (f.svc[k] !== undefined && s.time < f.svc[k]!);
      if (on('fuel')) { const q = at(0.0, -0.45); this.fleet.add('camion_citerne', q.x, q.y, p.hdg); }
      if (on('bags')) {
        const q = at(-0.3, -0.17); this.fleet.add('tapis_bagages', q.x, q.y, toward(-0.17));
        const q2 = at(-0.42, -0.4); this.fleet.add('train_bagages', q2.x, q2.y, p.hdg + Math.PI);
      }
      if (on('catering')) { const q = at(0.3, -0.24); this.fleet.add('catering', q.x, q.y, toward(-0.24) + Math.PI); }
      if (on('cleaning')) { const q = at(-0.05, 0.42); this.fleet.add('voiture', q.x, q.y, p.hdg, '#f8fafc'); }
      if (deice) { const q = at(0.1, 0.55); this.fleet.add('engin_degivrage', q.x, q.y, p.hdg); }
    } else {
      serviceVehicles(f, t).forEach((v) => {
        const hdg = Math.atan2(v.y - p.y, v.x - p.x) + Math.PI / 2;
        this.fleet.add(f.contact ? 'train_bagages' : 'bus_piste', v.x, v.y, hdg);
      });
    }
    // Poste éloigné : escalier mobile contre la porte avant
    if (!f.contact && (f.phase === 'boarding' || f.phase === 'deboarding')) {
      const fwd = a.length * 0.28;
      const side = a.length * 0.07 + 0.35;
      const nx = Math.cos(p.hdg);
      const nz = Math.sin(p.hdg);
      this.fleet.add('escalier', p.x + nx * fwd - nz * side, p.y + nz * fwd + nx * side, p.hdg);
    }
  }

  /** Véhicules liés aux installations : pompiers, chasse-neige, train. */
  private staticFleet(s: GameState, t: number): void {
    const w = getWorld(s);
    const incident = activeList(s).find((i) => i.type === 'aircraft_incident');
    const snow = s.settings.weather && WEATHER[s.weather.current.kind].needsSnow && w.cap.snow > 0;
    for (const b of s.buildings) {
      if (!w.active.has(b.id)) continue;
      const f = bFootprint(b);
      if (b.type === 'fire_station') {
        const target = incident?.targetId ? w.runways.find((r) => r.id === incident.targetId) : undefined;
        for (let k = 0; k < 2; k++) {
          if (target) {
            const cx = (target.a.x + target.b.x) / 2;
            const cz = (target.a.y + target.b.y) / 2;
            this.fleet.add('camion_pompiers', cx + (k - 0.5) * 1.6, cz + 0.9, target.horizontal ? 0 : Math.PI / 2);
          } else this.fleet.add('camion_pompiers', b.x + f.w / 2 + (k - 0.5) * 0.9, b.y + 0.55, -Math.PI / 2);
        }
      } else if (b.type === 'bus_station') {
        // Bus de ville à quai devant les abris.
        const along = f.w >= f.h;
        for (let k = 0; k < 2; k++) {
          const u = (k + 0.5) / 2;
          if (along) this.fleet.add('bus', b.x + f.w * u + 0.45, b.y + f.h - 0.35, 0, '#ffffff');
          else this.fleet.add('bus', b.x + f.w - 0.35, b.y + f.h * u + 0.45, Math.PI / 2, '#ffffff');
        }
      } else if (b.type === 'train_station') {
        const along = f.w >= f.h;
        const ph = Math.sin(t * 0.00015 + b.id) * 0.5 + 0.5;
        const x = along ? b.x + f.w * (0.15 + 0.7 * ph) : b.x + f.w - 0.5;
        const z = along ? b.y + f.h - 0.5 : b.y + f.h * (0.15 + 0.7 * ph);
        const h = along ? 0 : Math.PI / 2;
        // Locomotive en tête (21,8 m ≈ 2 cases), voitures derrière.
        this.fleet.add('locomotive', x + Math.cos(h) * 0.99, z + Math.sin(h) * 0.99, h);
        this.fleet.add('train', x, z, h);
      }
    }
    if (snow) {
      for (const r of w.runways) {
        for (let k = 0; k < 2; k++) {
          const u = (Math.sin(t * 0.0002 + k * 2.1 + r.id) + 1) / 2;
          const x = r.a.x + (r.b.x - r.a.x) * u + (r.horizontal ? 0 : (k - 0.5) * 0.8);
          const z = r.a.y + (r.b.y - r.a.y) * u + (r.horizontal ? (k - 0.5) * 0.8 : 0);
          const dir = Math.cos(t * 0.0002 + k * 2.1 + r.id) >= 0 ? 0 : Math.PI;
          this.fleet.add('chasse_neige', x, z, (r.horizontal ? 0 : Math.PI / 2) + dir);
        }
      }
    }
  }

  private syncRunwayLights(s: GameState): void {
    const w = getWorld(s);
    const pts: number[] = [];
    for (const r of w.runways) {
      const b = w.byId.get(r.id)!;
      const f = bFootprint(b);
      const n = r.horizontal ? f.w : f.h;
      for (let i = 0; i <= n; i++) {
        if (r.horizontal) pts.push(b.x + i, 0.08, b.y + 0.1, b.x + i, 0.08, b.y + f.h - 0.1);
        else pts.push(b.x + 0.1, 0.08, b.y + i, b.x + f.w - 0.1, 0.08, b.y + i);
      }
    }
    this.runwayLights.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }

  private syncPrecip(s: GameState, cam: Camera, q: string, t: number): void {
    const k = s.settings.weather ? s.weather.current.kind : 'clear';
    const kind = ['rain', 'thunder', 'storm'].includes(k) ? 'rain' : ['snow', 'blizzard'].includes(k) ? 'snow' : '';
    const n = q === 'low' ? 0 : q === 'medium' ? 1200 : 2500;
    if (kind !== this.precipKind || !this.precip.geometry.getAttribute('position')) {
      this.precipKind = kind;
      const arr = new Float32Array((kind ? n : 0) * 3);
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = Math.random() * 80 - 40;
        arr[i + 1] = Math.random() * 30;
        arr[i + 2] = Math.random() * 80 - 40;
      }
      this.precip.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const m = this.precip.material as THREE.PointsMaterial;
      m.size = kind === 'snow' ? 0.18 : 0.08;
      m.color.set(kind === 'snow' ? '#ffffff' : '#a5c8ff');
    }
    if (!kind) return;
    const pos = this.precip.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const speed = kind === 'snow' ? 0.06 : 0.6;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] -= speed;
      if (kind === 'snow') arr[i] += Math.sin(t * 0.001 + i) * 0.02;
      if (arr[i + 1] < 0) arr[i + 1] += 30;
    }
    pos.needsUpdate = true;
    this.precip.position.set(cam.cx, 0, cam.cy);
  }

  private syncOverlays(s: GameState, fi: FrameInfo): void {
    this.ghost.clear();
    const g = fi.ghost;
    const boxG = geo('box', () => new THREE.BoxGeometry(1, 1, 1));
    if (g) {
      const ok = mat('#22c55e', { transparent: true, opacity: 0.5 }, 'ghostok');
      const bad = mat('#ef4444', { transparent: true, opacity: 0.5 }, 'ghostbad');
      if (g.cells) {
        for (const c of g.cells) {
          const m = new THREE.Mesh(boxG, c.ok ? ok : bad);
          m.scale.set(1, 0.1, 1);
          m.position.set(c.p.x + 0.5, 0.05, c.p.y + 0.5);
          this.ghost.add(m);
        }
      } else {
        const d = BUILDINGS[g.type];
        const f = footprint(d, g.rot);
        const hgt = Math.max(0.15, d.height);
        const m = new THREE.Mesh(boxG, g.ok ? ok : bad);
        m.scale.set(f.w, hgt, f.h);
        m.position.set(g.x + f.w / 2, hgt / 2, g.y + f.h / 2);
        this.ghost.add(m);
      }
    }
    this.selection.visible = false;
    if (fi.selectedBuilding !== null) {
      const b = getWorld(s).byId.get(fi.selectedBuilding);
      if (b) {
        const f = bFootprint(b);
        const hgt = Math.max(0.3, BUILDINGS[b.type].height + 0.2);
        this.selection.scale.set(f.w + 0.2, hgt, f.h + 0.2);
        this.selection.position.set(b.x + f.w / 2, hgt / 2, b.y + f.h / 2);
        this.selection.visible = true;
      }
    }
    this.syncRoute(s, fi);
    if (fi.selectedFlight !== null) {
      const p = this.planes.get(fi.selectedFlight);
      if (p) {
        const a = AIRCRAFT[s.flights.find((f) => f.id === fi.selectedFlight)?.aircraft ?? 'tp70'];
        this.selection.scale.set(a.length + 0.4, 1, a.length + 0.4);
        this.selection.position.copy(p.position);
        this.selection.visible = true;
      }
    }
    this.parcels.clear();
    if (fi.parcelMode) {
      const { pw, ph } = parcelCount(s);
      const p = s.map.parcel;
      const pm = mat('#38bdf8', { transparent: true, opacity: 0.35 }, 'parcel');
      for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
        if (!canBuyParcel(s, px, py)) continue;
        const m = new THREE.Mesh(boxG, pm);
        m.scale.set(p - 0.3, 0.1, p - 0.3);
        m.position.set(px * p + p / 2, 0.06, py * p + p / 2);
        this.parcels.add(m);
      }
    }
  }

  /** Entrées de tunnel et rampes de parking souterrain (là où les véhicules disparaissent). */
  private syncPortals(s: GameState): void {
    const key = this.traffic.portals.map((p) => `${p.kind}${p.x},${p.y}`).join(';') + s.id;
    if (key === this.portalKey) return;
    this.portalKey = key;
    this.portals.clear();
    const concrete = mat('#a8a29e', {}, 'portal');
    const dark = mat('#0b0f14', { roughness: 1 }, 'portalDark');
    const stripe = mat('#facc15', {}, 'portalStripe');
    const boxG = geo('box', () => new THREE.BoxGeometry(1, 1, 1));
    for (const p of this.traffic.portals) {
      const g = new THREE.Group();
      // Repère local : +Z = sens de la descente.
      g.rotation.y = Math.atan2(p.dx, p.dy);
      const tunnel = p.kind === 'tunnel';
      const w = 0.95;
      const d = tunnel ? 0.9 : 0.95;
      // Fond sombre de la trémie (au ras du sol) et murets latéraux
      const pit = new THREE.Mesh(boxG, dark);
      pit.scale.set(w * 0.9, 0.01, d);
      pit.position.set(0, 0.012, d / 2);
      g.add(pit);
      for (const sx of [-1, 1]) {
        const wall = new THREE.Mesh(boxG, concrete);
        wall.scale.set(0.06, 0.12, d);
        wall.position.set((sx * w) / 2, 0.06, d / 2);
        wall.castShadow = true;
        g.add(wall);
      }
      // Portique d'entrée (tunnel : linteau de béton ; parking : panneau « P »)
      const lintel = new THREE.Mesh(boxG, concrete);
      lintel.scale.set(w + 0.06, tunnel ? 0.22 : 0.08, 0.12);
      lintel.position.set(0, tunnel ? 0.3 : 0.32, d);
      lintel.castShadow = true;
      g.add(lintel);
      const band = new THREE.Mesh(boxG, tunnel ? stripe : mat('#1d4ed8', { emissive: new THREE.Color('#1d4ed8'), emissiveIntensity: 0.4 }, 'portalP'));
      band.scale.set(tunnel ? w : 0.22, tunnel ? 0.04 : 0.18, 0.13);
      band.position.set(0, tunnel ? 0.22 : 0.45, d);
      g.add(band);
      if (tunnel) {
        const back = new THREE.Mesh(boxG, dark);
        back.scale.set(w, 0.3, 0.02);
        back.position.set(0, 0.15, d + 0.07);
        g.add(back);
      }
      // Point de départ de la rampe : 0,9 case avant le point sous terre.
      g.position.set(p.x - p.dx * 0.9, 0, p.y - p.dy * 0.9);
      this.portals.add(g);
    }
  }

  /** Ruban posé au sol le long du trajet restant du vol sélectionné. */
  private syncRoute(s: GameState, fi: FrameInfo): void {
    const f = fi.selectedFlight !== null ? s.flights.find((x) => x.id === fi.selectedFlight) : undefined;
    const pts = f ? remainingRoute(f) : [];
    this.route.visible = pts.length > 1;
    if (!this.route.visible) return;
    const key = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';');
    if (key === this.routeKey) return;
    this.routeKey = key;
    const w = 0.12;
    const pos: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = (-(b.y - a.y) / len) * w;
      const nz = ((b.x - a.x) / len) * w;
      const y = 0.06;
      pos.push(a.x + nx, y, a.y + nz, b.x + nx, y, b.y + nz, b.x - nx, y, b.y - nz);
      pos.push(a.x + nx, y, a.y + nz, b.x - nx, y, b.y - nz, a.x - nx, y, a.y - nz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.route.geometry.dispose();
    this.route.geometry = g;
    (this.route.material as THREE.Material).side = THREE.DoubleSide;
  }

  render(s: GameState, cam: Camera, fi: FrameInfo): void {
    if (this.lost) return;
    this.mapW = s.map.w;
    this.mapH = s.map.h;
    if (this.quality !== fi.quality) {
      this.quality = fi.quality;
      this.renderer.shadowMap.enabled = fi.quality !== 'low';
      this.sun.castShadow = fi.quality !== 'low';
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.needsUpdate = true;
      });
      this.resize(this.w, this.h, window.devicePixelRatio || 1);
    }
    const w = getWorld(s);
    const gk = `${s.id}|${w.rev}`;
    if (gk !== this.groundKey) {
      this.groundKey = gk;
      if (this.groundCanvas.width !== s.map.w * TEX_PX) {
        this.groundCanvas.width = s.map.w * TEX_PX;
        this.groundCanvas.height = s.map.h * TEX_PX;
      }
      const ctx = this.groundCanvas.getContext('2d')!;
      drawGround(ctx, s, (x, y) => [x * TEX_PX, y * TEX_PX], TEX_PX, '3d');
      this.groundTex.needsUpdate = true;
      this.updateSurfaceMask(s);
      this.ground.scale.set(s.map.w, s.map.h, 1);
      this.ground.position.set(s.map.w / 2, 0, s.map.h / 2);
      this.syncRunwayLights(s);
    }
    this.syncBuildings(s);
    this.syncPlanes(s, fi);
    this.syncOverlays(s, fi);

    // Éclairage : soleil, cycle jour-nuit, météo
    const mod = minuteOfDay(s, fi.frac);
    const dl = daylight(mod);
    const ang = sunAngle(mod);
    const wk = s.settings.weather ? s.weather.current.kind : 'clear';
    const overcast = ['cloudy', 'rain', 'fog', 'snow', 'thunder', 'storm', 'blizzard'].includes(wk);
    const cx = s.map.w / 2;
    const cy = s.map.h / 2;
    this.sun.position.set(cx + Math.cos(ang) * 80, Math.max(8, Math.sin(ang) * 90), cy + 30);
    this.sun.target.position.set(cx, 0, cy);
    const dawn = clamp(1 - Math.abs(Math.sin(ang)) * 2.5, 0, 1);
    this.sun.color.set(dl < 0.25 ? '#9fb4ff' : dawn > 0.2 && dl > 0.2 ? '#ffc38a' : '#fff7e8');
    this.sun.intensity = (overcast ? 0.9 : 2.6) * dl + 0.45 * (1 - dl);
    this.hemi.intensity = 0.7 + 0.7 * dl;
    this.hemi.color.set(dl > 0.3 ? '#cfe5ff' : '#4a5a88');
    const night = 1 - dl;
    this.windowMat.emissiveIntensity = night * 1.4;
    for (const m of nightMats) m.emissiveIntensity = night * 1.2;
    this.glassMat.emissiveIntensity = night * 0.9;
    (this.runwayLights.material as THREE.PointsMaterial).opacity = clamp(night * 1.4, 0, 1);
    this.runwayLights.visible = night > 0.2;
    const skyDay = new THREE.Color(overcast ? '#9aa7b6' : '#8ec5f0');
    const sky = new THREE.Color('#081428').lerp(skyDay, dl);
    if (dawn > 0.3 && dl > 0.15 && dl < 0.9) sky.lerp(new THREE.Color('#f4a36b'), 0.25 * dawn);
    this.scene.background = sky;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky);
    const vis = { fog: 0.12, blizzard: 0.15, snow: 0.45, storm: 0.4, thunder: 0.55, rain: 0.7 }[wk as 'fog'] ?? 1;
    fog.near = 20 + 60 * vis;
    fog.far = 60 + 340 * vis;
    this.syncPrecip(s, cam, fi.quality, fi.realTime);
    // Manteau neigeux : la texture du sol est éclaircie (multiplication de couleur).
    const snowy = s.settings.weather && ['snow', 'blizzard'].includes(wk) ? 1 : s.settings.weather && wk === 'frost' ? 0.4 : 0;
    this.env.setSnow(snowy);
    this.env.sync(s, w.rev, fi.quality);
    this.env.update(s, fi.realTime, dl, overcast, new THREE.Vector3(cam.cx, 0, cam.cy));

    if (this.interior) {
      this.crowd.update(s, this.interiorIds, fi.realTime);
      for (const m of interiorNightMats) m.emissiveIntensity = night * 0.35;
    }

    this.placeCamera(cam);
    this.renderer.render(this.scene, this.camera);
  }
}
