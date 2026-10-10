import { BUILDINGS, footprint, levelMult, type BuildingDef } from '../data/buildings';
import type { Building, GameState, Pt, SizeClass } from './types';

/**
 * Structures dérivées de l'état (jamais sauvegardées) :
 * grille d'occupation, réseau de taxiways, réseau routier,
 * groupes de terminaux, postes de stationnement accessibles, capacités.
 * Recalculées à chaque modification d'infrastructure (cache par "révision").
 */
export interface StandInfo {
  id: number;
  size: SizeClass;
  contact: boolean;
  access: Pt[]; // cases de taxiway adjacentes
  reachable: boolean;
  center: Pt;
  rot: 0 | 1;
}

export interface RunwayInfo {
  id: number;
  length: number;
  horizontal: boolean;
  /** Extrémités (centre de la piste en largeur). */
  a: Pt;
  b: Pt;
  connected: boolean;
  cells: Set<number>;
  hasIls: boolean;
}

export interface Capacities {
  checkin: number; // pax / heure (avant effets personnel)
  security: number;
  baggage: number;
  gates: number;
  hall: number;
  parking: number;
  power: number;
  energyDemand: number;
  runwayCapBase: number;
  catchment: number;
  info: number;
  deicing: number;
  snow: number;
  fuel: number;
  mro: number;
  cargo: number;
  safety: number;
  contracts: number;
  research: number;
  training: number;
  green: number;
  commerce: Record<string, { capacity: number; spend: number; count: number }>;
}

export interface World {
  rev: number;
  occ: Int32Array;
  byId: Map<number, Building>;
  taxi: Uint8Array; // 1 = taxiway praticable
  taxiComp: Int32Array; // composante connexe du taxiway (-1 = aucune)
  runwayComps: Set<number>;
  roadOk: Uint8Array; // route reliée à l'entrée
  terminalGroup: Int32Array; // par bâtiment index → groupe
  connectedTerminal: Set<number>; // ids des bâtiments de terminal desservis
  stands: StandInfo[];
  runways: RunwayInfo[];
  cap: Capacities;
  active: Set<number>; // bâtiments opérationnels
  problems: Map<number, string>; // id → clé de problème (non relié…)
}

let cache: { state: GameState | null; rev: number; world: World | null } = { state: null, rev: -1, world: null };
let revision = 0;

/** À appeler après toute modification d'infrastructure. */
export function invalidateWorld(): void {
  revision++;
}

export function getWorld(s: GameState): World {
  if (cache.state === s && cache.rev === revision && cache.world) return cache.world;
  const w = buildWorld(s);
  cache = { state: s, rev: revision, world: w };
  return w;
}

export function idx(s: GameState, x: number, y: number): number {
  return y * s.map.w + x;
}

export function bFootprint(b: Building): { w: number; h: number } {
  return footprint(BUILDINGS[b.type], b.rot);
}

export function isOperational(b: Building): boolean {
  return b.buildRemaining <= 0 && b.enabled && b.brokenFor <= 0;
}

function neighbors4(s: GameState, x: number, y: number): Pt[] {
  const r: Pt[] = [];
  if (x > 0) r.push({ x: x - 1, y });
  if (x < s.map.w - 1) r.push({ x: x + 1, y });
  if (y > 0) r.push({ x, y: y - 1 });
  if (y < s.map.h - 1) r.push({ x, y: y + 1 });
  return r;
}

/** Cases bordant l'empreinte d'un bâtiment. */
export function borderCells(s: GameState, b: { x: number; y: number }, w: number, h: number): Pt[] {
  const r: Pt[] = [];
  for (let x = b.x; x < b.x + w; x++) {
    if (b.y - 1 >= 0) r.push({ x, y: b.y - 1 });
    if (b.y + h < s.map.h) r.push({ x, y: b.y + h });
  }
  for (let y = b.y; y < b.y + h; y++) {
    if (b.x - 1 >= 0) r.push({ x: b.x - 1, y });
    if (b.x + w < s.map.w) r.push({ x: b.x + w, y });
  }
  return r;
}

function buildWorld(s: GameState): World {
  const W = s.map.w;
  const H = s.map.h;
  const occ = new Int32Array(W * H);
  const byId = new Map<number, Building>();
  for (const b of s.buildings) {
    byId.set(b.id, b);
    const f = bFootprint(b);
    for (let y = b.y; y < b.y + f.h; y++) for (let x = b.x; x < b.x + f.w; x++) occ[y * W + x] = b.id;
  }
  const typeAt = (x: number, y: number): BuildingDef | null => {
    const id = occ[y * W + x];
    if (!id) return null;
    return BUILDINGS[byId.get(id)!.type];
  };
  const built = (b: Building) => b.buildRemaining <= 0;

  // ---- Pistes ----
  const runways: RunwayInfo[] = [];
  for (const b of s.buildings) {
    const d = BUILDINGS[b.type];
    if (!d.runwayLength || !built(b)) continue;
    const f = bFootprint(b);
    const horizontal = f.w >= f.h;
    const cells = new Set<number>();
    for (let y = b.y; y < b.y + f.h; y++) for (let x = b.x; x < b.x + f.w; x++) cells.add(y * W + x);
    const a = horizontal ? { x: b.x, y: b.y + f.h / 2 } : { x: b.x + f.w / 2, y: b.y };
    const e = horizontal ? { x: b.x + f.w, y: b.y + f.h / 2 } : { x: b.x + f.w / 2, y: b.y + f.h };
    runways.push({ id: b.id, length: d.runwayLength * levelMult(b.level) ** 0.3, horizontal, a, b: e, connected: false, cells, hasIls: false });
  }

  // ---- Taxiways ----
  const taxi = new Uint8Array(W * H);
  for (const b of s.buildings) {
    if (b.type === 'taxiway' && built(b)) taxi[b.y * W + b.x] = 1;
  }
  const taxiComp = new Int32Array(W * H).fill(-1);
  let comp = 0;
  for (let i = 0; i < W * H; i++) {
    if (!taxi[i] || taxiComp[i] >= 0) continue;
    const stack = [i];
    taxiComp[i] = comp;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % W;
      const cy = (c / W) | 0;
      for (const n of neighbors4(s, cx, cy)) {
        const ni = n.y * W + n.x;
        if (taxi[ni] && taxiComp[ni] < 0) {
          taxiComp[ni] = comp;
          stack.push(ni);
        }
      }
    }
    comp++;
  }
  const runwayComps = new Set<number>();
  for (const r of runways) {
    const b = byId.get(r.id)!;
    const f = bFootprint(b);
    for (const p of borderCells(s, b, f.w, f.h)) {
      const c = taxiComp[p.y * W + p.x];
      if (c >= 0) {
        runwayComps.add(c);
        r.connected = true;
      }
    }
  }

  // ---- Routes reliées à l'entrée (bord inférieur de la carte) ----
  const road = new Uint8Array(W * H);
  for (const b of s.buildings) if (b.type === 'road' && built(b)) road[b.y * W + b.x] = 1;
  const roadOk = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) {
    const i = (H - 1) * W + x;
    if (road[i]) {
      roadOk[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const c = stack.pop()!;
    for (const n of neighbors4(s, c % W, (c / W) | 0)) {
      const ni = n.y * W + n.x;
      if (road[ni] && !roadOk[ni]) {
        roadOk[ni] = 1;
        stack.push(ni);
      }
    }
  }
  const touchesRoad = (b: Building) => {
    const f = bFootprint(b);
    return borderCells(s, b, f.w, f.h).some((p) => roadOk[p.y * W + p.x]);
  };

  // ---- Groupes de terminal (bâtiments adjacents à un terminal, de proche en proche) ----
  const termLike = (d: BuildingDef) => d.isTerminal || d.needsTerminal;
  const terminalGroup = new Int32Array(s.buildings.length).fill(-1);
  const indexOf = new Map<number, number>();
  s.buildings.forEach((b, i) => indexOf.set(b.id, i));
  const connectedTerminal = new Set<number>();
  let group = 0;
  s.buildings.forEach((b, i) => {
    const d = BUILDINGS[b.type];
    if (!(d.isTerminal && !d.needsTerminal) || terminalGroup[i] >= 0 || !built(b)) return;
    const members: Building[] = [];
    const q = [b];
    terminalGroup[i] = group;
    while (q.length) {
      const cur = q.pop()!;
      members.push(cur);
      const f = bFootprint(cur);
      for (const p of borderCells(s, cur, f.w, f.h)) {
        const nid = occ[p.y * W + p.x];
        if (!nid) continue;
        const nb = byId.get(nid)!;
        const ni = indexOf.get(nid)!;
        if (terminalGroup[ni] >= 0 || !termLike(BUILDINGS[nb.type]) || !built(nb)) continue;
        terminalGroup[ni] = group;
        q.push(nb);
      }
    }
    // Le groupe est desservi si au moins un membre touche une route reliée.
    if (members.some(touchesRoad)) for (const m of members) connectedTerminal.add(m.id);
    group++;
  });

  // ---- Problèmes de placement / raccordement & bâtiments actifs ----
  const problems = new Map<number, string>();
  const active = new Set<number>();
  for (const b of s.buildings) {
    const d = BUILDINGS[b.type];
    if (!built(b)) continue;
    let ok = true;
    if (d.isTerminal || d.needsTerminal) {
      if (!connectedTerminal.has(b.id)) {
        ok = false;
        problems.set(b.id, d.needsTerminal && terminalGroup[indexOf.get(b.id)!] < 0 ? 'pb.noTerminal' : 'pb.noRoad');
      }
    } else if (d.needsRoad && !touchesRoad(b)) {
      ok = false;
      problems.set(b.id, 'pb.noRoad');
    }
    if (d.needsRunway) {
      const f = bFootprint(b);
      const near = borderCells(s, b, f.w, f.h).some((p) => {
        const t = typeAt(p.x, p.y);
        return !!t?.runwayLength;
      });
      if (!near) {
        ok = false;
        problems.set(b.id, 'pb.noRunway');
      }
    }
    if (ok && isOperational(b)) active.add(b.id);
  }

  // ILS : rattaché à la piste adjacente.
  for (const b of s.buildings) {
    if (b.type !== 'ils' || !active.has(b.id)) continue;
    const f = bFootprint(b);
    for (const p of borderCells(s, b, f.w, f.h)) {
      const r = runways.find((r) => r.cells.has(p.y * W + p.x));
      if (r) r.hasIls = true;
    }
  }

  // ---- Postes de stationnement ----
  const stands: StandInfo[] = [];
  for (const b of s.buildings) {
    const d = BUILDINGS[b.type];
    if (!d.standSize || !built(b)) continue;
    const f = bFootprint(b);
    const border = borderCells(s, b, f.w, f.h);
    const access = border.filter((p) => taxi[p.y * W + p.x]);
    const reachable = access.some((p) => runwayComps.has(taxiComp[p.y * W + p.x]));
    const contact = border.some((p) => {
      const nid = occ[p.y * W + p.x];
      return nid > 0 && connectedTerminal.has(nid) && !!BUILDINGS[byId.get(nid)!.type].isTerminal;
    });
    if (!reachable) problems.set(b.id, 'pb.noTaxiway');
    stands.push({ id: b.id, size: d.standSize, contact, access, reachable, center: { x: b.x + f.w / 2, y: b.y + f.h / 2 }, rot: b.rot });
  }
  for (const b of s.buildings) {
    const d = BUILDINGS[b.type];
    if (d.needsTaxiway && !d.standSize && built(b)) {
      const f = bFootprint(b);
      const ok = borderCells(s, b, f.w, f.h).some((p) => taxi[p.y * W + p.x] && runwayComps.has(taxiComp[p.y * W + p.x]));
      if (!ok) {
        problems.set(b.id, 'pb.noTaxiway');
        active.delete(b.id);
      }
    }
  }

  // ---- Capacités ----
  const cap: Capacities = {
    checkin: 0, security: 0, baggage: 0, gates: 0, hall: 0, parking: 0, power: 0, energyDemand: 0,
    runwayCapBase: 0, catchment: 0, info: 0, deicing: 0, snow: 0, fuel: 0, mro: 0, cargo: 0, safety: 0,
    contracts: 0, research: 0, training: 0, green: 0, commerce: {},
  };
  for (const b of s.buildings) {
    const d = BUILDINGS[b.type];
    if (built(b) && b.enabled) cap.energyDemand += d.energy * (1 + 0.3 * (b.level - 1));
    if (!active.has(b.id)) continue;
    const m = levelMult(b.level);
    cap.checkin += (d.checkin ?? 0) * m;
    cap.security += (d.security ?? 0) * m;
    cap.baggage += (d.baggage ?? 0) * m;
    cap.gates += Math.round((d.gates ?? 0) * m);
    cap.hall += (d.hall ?? 0) * m;
    cap.parking += (d.parking ?? 0) * m;
    cap.power += (d.power ?? 0) * m;
    const e = d.effects ?? {};
    cap.runwayCapBase += (e.runwayCap ?? 0) * m;
    cap.catchment += (e.catchment ?? 0) * m;
    cap.info += e.info ?? 0;
    cap.deicing += (e.deicing ?? 0) * m;
    cap.snow += (e.snow ?? 0) * m;
    cap.fuel += (e.fuel ?? 0) * m;
    cap.mro += (e.mro ?? 0) * m;
    cap.cargo += (e.cargo ?? 0) * m;
    cap.safety += (e.safety ?? 0) * m;
    cap.contracts += (e.contracts ?? 0) * m;
    cap.research += (e.research ?? 0) * m;
    cap.training += (e.training ?? 0) * m;
    cap.green += e.green ?? 0;
    if (d.commerce) {
      const c = (cap.commerce[d.commerce.kind] ??= { capacity: 0, spend: d.commerce.spend, count: 0 });
      c.capacity += d.commerce.capacity * m;
      c.count++;
    }
  }

  return { rev: revision, occ, byId, taxi, taxiComp, runwayComps, roadOk, terminalGroup, connectedTerminal, stands, runways, cap, active, problems };
}

/**
 * Plus court chemin (BFS) sur le réseau de taxiways entre deux ensembles de cases.
 * Renvoie la liste des centres de cases, ou null si aucun chemin n'existe.
 */
export function taxiPath(s: GameState, world: World, from: Pt[], to: Pt[]): Pt[] | null {
  const W = s.map.w;
  const goal = new Set(to.map((p) => p.y * W + p.x));
  const prev = new Int32Array(W * s.map.h).fill(-2);
  const q: number[] = [];
  for (const p of from) {
    const i = p.y * W + p.x;
    if (!world.taxi[i]) continue;
    prev[i] = -1;
    q.push(i);
  }
  let head = 0;
  let found = -1;
  while (head < q.length) {
    const c = q[head++];
    if (goal.has(c)) {
      found = c;
      break;
    }
    for (const n of neighbors4(s, c % W, (c / W) | 0)) {
      const ni = n.y * W + n.x;
      if (world.taxi[ni] && prev[ni] === -2) {
        prev[ni] = c;
        q.push(ni);
      }
    }
  }
  if (found < 0) return null;
  const path: Pt[] = [];
  for (let c = found; c !== -1; c = prev[c]) path.push({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 });
  return path.reverse();
}

/** Cases de taxiway adjacentes à une piste, triées par distance à un point. */
export function runwayAccess(s: GameState, world: World, r: RunwayInfo, near: Pt): Pt[] {
  const b = world.byId.get(r.id)!;
  const f = bFootprint(b);
  const W = s.map.w;
  return borderCells(s, b, f.w, f.h)
    .filter((p) => world.taxi[p.y * W + p.x] && world.runwayComps.has(world.taxiComp[p.y * W + p.x]))
    .sort((p, q) => Math.hypot(p.x - near.x, p.y - near.y) - Math.hypot(q.x - near.x, q.y - near.y));
}
