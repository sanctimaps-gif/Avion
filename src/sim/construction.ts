import { BUILDINGS, footprint, upgradeCost, type BuildingDef } from '../data/buildings';
import { TECHS } from '../data/research';
import { charge } from './economy';
import { addLog } from './log';
import { getWorld, invalidateWorld } from './world';
import type { Building, GameState, Pt } from './types';

/**
 * Système de construction : validation du placement (limites, terrain,
 * collisions, propriété du terrain, déblocages), construction, amélioration,
 * déplacement et démolition.
 */
export const TERRAIN_GRASS = 0;
export const TERRAIN_WATER = 1;
export const TERRAIN_FOREST = 2;
export const TERRAIN_FIELD = 3;
export const TERRAIN_SAND = 4;
export const TERRAIN_TOWN = 5;
export const FOREST_CLEAR_COST = 3_000;

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
  cost: number;
}

export function isUnlocked(s: GameState, def: BuildingDef): boolean {
  if (s.settings.allUnlocked) return true;
  if (def.tier > s.tier) return false;
  if (def.tech && !s.research.done.includes(def.tech)) return false;
  return true;
}

export function lockReason(s: GameState, def: BuildingDef): string | null {
  if (s.settings.allUnlocked) return null;
  if (def.tier > s.tier) return 'lock.tier';
  if (def.tech && !s.research.done.includes(def.tech)) return 'lock.tech';
  return null;
}

export function ownedAt(s: GameState, x: number, y: number): boolean {
  const p = s.map.parcel;
  const pw = Math.ceil(s.map.w / p);
  return s.map.owned[Math.floor(y / p) * pw + Math.floor(x / p)] === true;
}

export function canPlace(s: GameState, type: string, x: number, y: number, rot: 0 | 1, ignoreId = 0): PlaceCheck {
  const def = BUILDINGS[type];
  if (!def) return { ok: false, reason: 'pb.unknown', cost: 0 };
  const f = footprint(def, rot);
  let cost = def.cost;
  if (!isUnlocked(s, def)) return { ok: false, reason: lockReason(s, def) ?? 'lock.tier', cost };
  if (x < 0 || y < 0 || x + f.w > s.map.w || y + f.h > s.map.h) return { ok: false, reason: 'pb.bounds', cost };
  const world = getWorld(s);
  for (let yy = y; yy < y + f.h; yy++) {
    for (let xx = x; xx < x + f.w; xx++) {
      if (!ownedAt(s, xx, yy)) return { ok: false, reason: 'pb.notOwned', cost };
      const i = yy * s.map.w + xx;
      const t = s.map.terrain[i];
      if (t === TERRAIN_WATER) return { ok: false, reason: 'pb.water', cost };
      if (t === TERRAIN_TOWN) return { ok: false, reason: 'pb.town', cost };
      const o = world.occ[i];
      if (o && o !== ignoreId) return { ok: false, reason: 'pb.occupied', cost };
      if (t === TERRAIN_FOREST) cost += FOREST_CLEAR_COST;
    }
  }
  if (!s.settings.unlimitedMoney && s.finance.cash < cost) return { ok: false, reason: 'pb.money', cost };
  return { ok: true, cost };
}

export function newBuilding(s: GameState, type: string, x: number, y: number, rot: 0 | 1, instant = false): Building {
  const def = BUILDINGS[type];
  return {
    id: s.nextId++,
    type,
    x,
    y,
    rot,
    level: 1,
    condition: 100,
    buildRemaining: instant ? 0 : def.buildHours * 60,
    enabled: true,
    brokenFor: 0,
    revenue30: 0,
    cost30: 0,
    revenueToday: 0,
    costToday: 0,
    totalInvested: def.cost,
  };
}

export function place(s: GameState, type: string, x: number, y: number, rot: 0 | 1): PlaceCheck & { building?: Building } {
  const chk = canPlace(s, type, x, y, rot);
  if (!chk.ok) return chk;
  const def = BUILDINGS[type];
  const f = footprint(def, rot);
  // Défrichage de la forêt.
  for (let yy = y; yy < y + f.h; yy++) for (let xx = x; xx < x + f.w; xx++) {
    const i = yy * s.map.w + xx;
    if (s.map.terrain[i] === TERRAIN_FOREST || s.map.terrain[i] === TERRAIN_FIELD) s.map.terrain[i] = TERRAIN_GRASS;
  }
  const b = newBuilding(s, type, x, y, rot);
  b.totalInvested = chk.cost;
  s.buildings.push(b);
  charge(s, 'construction', chk.cost);
  invalidateWorld();
  return { ...chk, building: b };
}

/** Tracé en L d'un élément linéaire (route, taxiway) entre deux cases. */
export function linePoints(a: Pt, b: Pt): Pt[] {
  const pts: Pt[] = [];
  const sx = Math.sign(b.x - a.x);
  const sy = Math.sign(b.y - a.y);
  let x = a.x;
  let y = a.y;
  pts.push({ x, y });
  while (x !== b.x) {
    x += sx;
    pts.push({ x, y });
  }
  while (y !== b.y) {
    y += sy;
    pts.push({ x, y });
  }
  return pts;
}

export function checkLine(s: GameState, type: string, pts: Pt[]): { cells: { p: Pt; ok: boolean; reason?: string; cost: number }[]; cost: number; count: number } {
  let cost = 0;
  let count = 0;
  const world = getWorld(s);
  const cells = pts.map((p) => {
    const existing = world.occ[p.y * s.map.w + p.x];
    if (existing && world.byId.get(existing)?.type === type) return { p, ok: false, reason: 'pb.exists', cost: 0 };
    const c = canPlace(s, type, p.x, p.y, 0);
    const ok = c.ok;
    if (ok) {
      cost += c.cost;
      count++;
    }
    return { p, ok, reason: c.reason, cost: c.cost };
  });
  return { cells, cost, count };
}

export function placeLine(s: GameState, type: string, pts: Pt[]): number {
  let n = 0;
  for (const p of pts) {
    const r = place(s, type, p.x, p.y, 0);
    if (r.ok) n++;
  }
  return n;
}

export function upgrade(s: GameState, b: Building): boolean {
  const def = BUILDINGS[b.type];
  if (b.level >= def.maxLevel || b.buildRemaining > 0) return false;
  const cost = upgradeCost(def, b.level);
  if (!s.settings.unlimitedMoney && s.finance.cash < cost) return false;
  charge(s, 'construction', cost);
  b.level++;
  b.totalInvested += cost;
  b.buildRemaining = Math.round(def.buildHours * 60 * 0.4);
  b.condition = 100;
  invalidateWorld();
  addLog(s, 'info', 'log.upgraded', { name: 'b.' + b.type, level: b.level });
  return true;
}

/** Un bâtiment est-il utilisé (avion au poste, sur la piste) ? */
export function inUse(s: GameState, b: Building): boolean {
  return s.flights.some(
    (f) =>
      (f.standId === b.id && !['departed', 'diverted', 'cancelled', 'scheduled'].includes(f.phase)) ||
      (f.runwayId === b.id && (f.phase === 'landing' || f.phase === 'takeoff')),
  );
}

export function demolishRefund(b: Building): number {
  return Math.round(b.totalInvested * (b.buildRemaining > 0 ? 0.6 : 0.25));
}

export function demolish(s: GameState, b: Building): boolean {
  if (inUse(s, b)) return false;
  const refund = demolishRefund(b);
  s.buildings = s.buildings.filter((x) => x.id !== b.id);
  s.finance.cash += refund;
  s.finance.today.revenue.sales = (s.finance.today.revenue.sales ?? 0) + refund;
  invalidateWorld();
  return true;
}

export function moveCost(b: Building): number {
  return Math.round(BUILDINGS[b.type].cost * 0.15);
}

export function canMove(s: GameState, b: Building, x: number, y: number, rot: 0 | 1): PlaceCheck {
  if (inUse(s, b)) return { ok: false, reason: 'pb.inUse', cost: 0 };
  const c = canPlace(s, b.type, x, y, rot, b.id);
  const cost = moveCost(b) + (c.cost - BUILDINGS[b.type].cost);
  if (!c.ok && c.reason !== 'pb.money') return { ...c, cost };
  if (!s.settings.unlimitedMoney && s.finance.cash < cost) return { ok: false, reason: 'pb.money', cost };
  return { ok: true, cost };
}

export function move(s: GameState, b: Building, x: number, y: number, rot: 0 | 1): boolean {
  const c = canMove(s, b, x, y, rot);
  if (!c.ok) return false;
  charge(s, 'construction', c.cost);
  b.x = x;
  b.y = y;
  b.rot = rot;
  b.buildRemaining = Math.max(b.buildRemaining, Math.round(BUILDINGS[b.type].buildHours * 60 * 0.25));
  invalidateWorld();
  return true;
}

// ---------- Terrain ----------
export function parcelCount(s: GameState): { pw: number; ph: number } {
  return { pw: Math.ceil(s.map.w / s.map.parcel), ph: Math.ceil(s.map.h / s.map.parcel) };
}
export function parcelPrice(s: GameState): number {
  const owned = s.map.owned.filter(Boolean).length;
  return Math.round(120_000 * Math.pow(1.12, owned - 16));
}
export function canBuyParcel(s: GameState, px: number, py: number): boolean {
  const { pw, ph } = parcelCount(s);
  if (px < 0 || py < 0 || px >= pw || py >= ph) return false;
  if (s.map.owned[py * pw + px]) return false;
  const adj = [
    [px - 1, py],
    [px + 1, py],
    [px, py - 1],
    [px, py + 1],
  ].some(([x, y]) => x >= 0 && y >= 0 && x < pw && y < ph && s.map.owned[y * pw + x]);
  return adj;
}
export function buyParcel(s: GameState, px: number, py: number): boolean {
  if (!canBuyParcel(s, px, py)) return false;
  const price = parcelPrice(s);
  if (!s.settings.unlimitedMoney && s.finance.cash < price) return false;
  charge(s, 'land', price);
  const { pw } = parcelCount(s);
  s.map.owned[py * pw + px] = true;
  invalidateWorld();
  return true;
}

/** Avancement des chantiers (appelé chaque minute de jeu). */
export function constructionTick(s: GameState): void {
  let changed = false;
  for (const b of s.buildings) {
    if (b.buildRemaining > 0) {
      b.buildRemaining--;
      if (b.buildRemaining <= 0) {
        changed = true;
        if (BUILDINGS[b.type].linear) continue;
        addLog(s, 'good', 'log.built', { name: 'b.' + b.type });
      }
    }
    if (b.brokenFor > 0) {
      b.brokenFor--;
      if (b.brokenFor <= 0) changed = true;
    }
  }
  if (changed) invalidateWorld();
}

export function techName(id: string): string {
  return TECHS[id] ? 'tech.' + id : id;
}
