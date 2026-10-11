import type { CommerceKind, SizeClass, StaffCat } from '../sim/types';

/**
 * Catalogue des bâtiments. Ajouter un bâtiment = ajouter une entrée ici
 * (+ ses traductions b.<id> / bd.<id>) ; aucune mécanique n'est à réécrire.
 */
export type BuildCat = 'airside' | 'terminal' | 'landside' | 'commerce' | 'tech';

export interface BuildingDef {
  id: string;
  cat: BuildCat;
  w: number;
  h: number;
  cost: number;
  /** Durée de construction en heures de jeu. */
  buildHours: number;
  upkeep: number;
  energy: number;
  tier: number;
  /** Technologie requise pour débloquer. */
  tech?: string;
  staff?: Partial<Record<StaffCat, number>>;
  height: number;
  color: string;
  roof?: string;
  linear?: boolean;
  maxLevel: number;
  /** Capacités (par niveau 1, multipliées par 1 + 0,5 × (niveau − 1)). */
  runwayLength?: number;
  standSize?: SizeClass;
  checkin?: number;
  security?: number;
  baggage?: number;
  gates?: number;
  hall?: number;
  parking?: number;
  power?: number;
  commerce?: { kind: CommerceKind; capacity: number; spend: number };
  /** Contraintes de placement. */
  needsTerminal?: boolean;
  needsRoad?: boolean;
  needsTaxiway?: boolean;
  needsRunway?: boolean;
  isTerminal?: boolean;
  /** Effets divers (consommés par sim/modifiers.ts). */
  effects?: Record<string, number>;
  /** Rayon de nuisance sonore / pollution. */
  noise?: number;
  demolishRefund?: number;
}

const D: BuildingDef[] = [
  // ---------- Côté piste ----------
  { id: 'runway_s', cat: 'airside', w: 16, h: 4, cost: 450_000, buildHours: 72, upkeep: 600, energy: 120, tier: 0, height: 0.05, color: '#3b4250', maxLevel: 2, runwayLength: 1600, staff: { maintenance: 1 }, noise: 7 },
  { id: 'runway_m', cat: 'airside', w: 24, h: 4, cost: 1_400_000, buildHours: 120, upkeep: 1100, energy: 200, tier: 2, height: 0.05, color: '#363c48', maxLevel: 2, runwayLength: 2500, staff: { maintenance: 2 }, noise: 9 },
  { id: 'runway_l', cat: 'airside', w: 32, h: 5, cost: 3_800_000, buildHours: 200, upkeep: 2000, energy: 320, tier: 4, height: 0.05, color: '#30353f', maxLevel: 2, runwayLength: 3600, staff: { maintenance: 3 }, noise: 12 },
  { id: 'taxiway', cat: 'airside', w: 1, h: 1, cost: 5_000, buildHours: 2, upkeep: 6, energy: 1, tier: 0, height: 0.03, color: '#4d5462', maxLevel: 1, linear: true },
  { id: 'stand_s', cat: 'airside', w: 4, h: 4, cost: 70_000, buildHours: 12, upkeep: 60, energy: 10, tier: 0, height: 0.04, color: '#59606c', maxLevel: 2, standSize: 'S', needsTaxiway: true, staff: { ground: 1 } },
  { id: 'stand_m', cat: 'airside', w: 5, h: 5, cost: 180_000, buildHours: 24, upkeep: 120, energy: 18, tier: 1, height: 0.04, color: '#59606c', maxLevel: 2, standSize: 'M', needsTaxiway: true, staff: { ground: 2 } },
  { id: 'stand_l', cat: 'airside', w: 7, h: 7, cost: 420_000, buildHours: 36, upkeep: 220, energy: 30, tier: 3, height: 0.04, color: '#59606c', maxLevel: 2, standSize: 'L', needsTaxiway: true, staff: { ground: 3 } },
  { id: 'stand_xl', cat: 'airside', w: 8, h: 8, cost: 950_000, buildHours: 48, upkeep: 400, energy: 45, tier: 5, height: 0.04, color: '#59606c', maxLevel: 2, standSize: 'XL', needsTaxiway: true, staff: { ground: 4 } },
  { id: 'tower_s', cat: 'airside', w: 2, h: 2, cost: 280_000, buildHours: 48, upkeep: 300, energy: 60, tier: 0, height: 3.2, color: '#d9e2ec', roof: '#5ab4ff', maxLevel: 3, staff: { operations: 2 }, effects: { runwayCap: 14 } },
  { id: 'tower_l', cat: 'airside', w: 3, h: 3, cost: 1_600_000, buildHours: 120, upkeep: 900, energy: 160, tier: 3, height: 6, color: '#e6edf5', roof: '#5ab4ff', maxLevel: 3, staff: { operations: 5 }, effects: { runwayCap: 34 } },
  { id: 'ils', cat: 'airside', w: 1, h: 2, cost: 220_000, buildHours: 24, upkeep: 90, energy: 25, tier: 1, height: 0.8, color: '#f2c94c', maxLevel: 2, needsRunway: true, effects: { ils: 1 } },
  { id: 'fire_station', cat: 'airside', w: 3, h: 3, cost: 260_000, buildHours: 36, upkeep: 250, energy: 30, tier: 0, height: 1.2, color: '#e05555', roof: '#b23b3b', maxLevel: 2, staff: { rescue: 4 }, effects: { safety: 1 } },
  { id: 'deicing', cat: 'airside', w: 3, h: 3, cost: 300_000, buildHours: 24, upkeep: 150, energy: 60, tier: 1, height: 0.4, color: '#7dd3fc', maxLevel: 2, needsTaxiway: true, staff: { ground: 2 }, effects: { deicing: 1 } },
  { id: 'snow_depot', cat: 'airside', w: 3, h: 2, cost: 240_000, buildHours: 24, upkeep: 140, energy: 25, tier: 1, height: 1, color: '#cbd5e1', roof: '#f97316', maxLevel: 2, staff: { maintenance: 2 }, effects: { snow: 1 } },
  { id: 'fuel_depot', cat: 'airside', w: 3, h: 3, cost: 350_000, buildHours: 36, upkeep: 200, energy: 25, tier: 1, height: 1, color: '#f8fafc', roof: '#94a3b8', maxLevel: 3, staff: { ground: 1 }, effects: { fuel: 1 } },
  { id: 'hangar', cat: 'airside', w: 7, h: 6, cost: 900_000, buildHours: 72, upkeep: 450, energy: 90, tier: 2, height: 2.2, color: '#94a3b8', roof: '#64748b', maxLevel: 3, needsTaxiway: true, staff: { maintenance: 4 }, effects: { mro: 1 } },
  { id: 'cargo', cat: 'airside', w: 5, h: 4, cost: 1_200_000, buildHours: 96, upkeep: 500, energy: 80, tier: 2, height: 1.8, color: '#c8a26a', roof: '#8a6b3c', maxLevel: 3, needsTaxiway: true, staff: { baggage: 3, ground: 2 }, effects: { cargo: 1 } },

  // ---------- Terminal ----------
  { id: 'terminal_s', cat: 'terminal', w: 6, h: 4, cost: 600_000, buildHours: 96, upkeep: 500, energy: 140, tier: 0, height: 1.4, color: '#e2e8f0', roof: '#9fb3c8', maxLevel: 3, isTerminal: true, gates: 2, hall: 450, staff: { cleaning: 2, admin: 1 } },
  { id: 'terminal_m', cat: 'terminal', w: 9, h: 6, cost: 2_600_000, buildHours: 168, upkeep: 1500, energy: 380, tier: 2, height: 2, color: '#e2e8f0', roof: '#7f9cbc', maxLevel: 3, isTerminal: true, gates: 6, hall: 1600, staff: { cleaning: 5, admin: 2 } },
  { id: 'terminal_l', cat: 'terminal', w: 13, h: 8, cost: 8_500_000, buildHours: 300, upkeep: 4200, energy: 1000, tier: 4, height: 2.8, color: '#eef2f7', roof: '#6b8db5', maxLevel: 3, isTerminal: true, gates: 14, hall: 5000, staff: { cleaning: 12, admin: 4 } },
  { id: 'pier', cat: 'terminal', w: 2, h: 7, cost: 1_100_000, buildHours: 96, upkeep: 500, energy: 120, tier: 2, height: 1.2, color: '#e2e8f0', roof: '#9fb3c8', maxLevel: 2, isTerminal: true, needsTerminal: true, gates: 4, hall: 400, staff: { cleaning: 2 } },
  { id: 'checkin', cat: 'terminal', w: 3, h: 2, cost: 160_000, buildHours: 24, upkeep: 110, energy: 30, tier: 0, height: 1.1, color: '#bfdbfe', roof: '#93c5fd', maxLevel: 3, needsTerminal: true, checkin: 140, staff: { checkin: 3 } },
  { id: 'security', cat: 'terminal', w: 3, h: 2, cost: 240_000, buildHours: 24, upkeep: 160, energy: 40, tier: 0, height: 1.1, color: '#c4b5fd', roof: '#a78bfa', maxLevel: 3, needsTerminal: true, security: 110, staff: { security: 3 } },
  { id: 'baggage_claim', cat: 'terminal', w: 3, h: 2, cost: 200_000, buildHours: 24, upkeep: 130, energy: 40, tier: 0, height: 1.1, color: '#fde68a', roof: '#fbbf24', maxLevel: 3, needsTerminal: true, baggage: 180, staff: { baggage: 3 } },
  { id: 'info_desk', cat: 'terminal', w: 1, h: 1, cost: 30_000, buildHours: 6, upkeep: 30, energy: 4, tier: 0, height: 0.9, color: '#5ab4ff', maxLevel: 1, needsTerminal: true, staff: { admin: 1 }, effects: { info: 1 } },
  { id: 'lounge', cat: 'commerce', w: 2, h: 2, cost: 350_000, buildHours: 36, upkeep: 220, energy: 30, tier: 2, height: 1.1, color: '#1e3a5f', roof: '#c9a227', maxLevel: 3, needsTerminal: true, commerce: { kind: 'lounge', capacity: 400, spend: 30 }, staff: { cleaning: 1 } },

  // ---------- Commerces ----------
  { id: 'cafe', cat: 'commerce', w: 2, h: 2, cost: 80_000, buildHours: 12, upkeep: 40, energy: 12, tier: 0, height: 1, color: '#a16207', roof: '#d97706', maxLevel: 3, needsTerminal: true, commerce: { kind: 'cafe', capacity: 900, spend: 4.5 } },
  { id: 'restaurant', cat: 'commerce', w: 3, h: 2, cost: 190_000, buildHours: 24, upkeep: 80, energy: 25, tier: 1, height: 1, color: '#b45309', roof: '#ea580c', maxLevel: 3, needsTerminal: true, commerce: { kind: 'restaurant', capacity: 700, spend: 12 }, staff: { cleaning: 1 } },
  { id: 'shop', cat: 'commerce', w: 2, h: 2, cost: 120_000, buildHours: 12, upkeep: 50, energy: 12, tier: 0, height: 1, color: '#be185d', roof: '#ec4899', maxLevel: 3, needsTerminal: true, commerce: { kind: 'shop', capacity: 900, spend: 6 } },
  { id: 'dutyfree', cat: 'commerce', w: 3, h: 3, cost: 650_000, buildHours: 48, upkeep: 200, energy: 40, tier: 3, height: 1.1, color: '#7c3aed', roof: '#a78bfa', maxLevel: 3, needsTerminal: true, commerce: { kind: 'dutyfree', capacity: 1500, spend: 16 } },
  { id: 'ads', cat: 'commerce', w: 1, h: 1, cost: 25_000, buildHours: 4, upkeep: 8, energy: 3, tier: 0, height: 1.3, color: '#22d3ee', maxLevel: 2, needsTerminal: true, commerce: { kind: 'ads', capacity: 3000, spend: 0.35 } },
  { id: 'rental', cat: 'commerce', w: 2, h: 2, cost: 90_000, buildHours: 12, upkeep: 40, energy: 6, tier: 1, height: 0.8, color: '#0f766e', roof: '#14b8a6', maxLevel: 2, needsRoad: true, commerce: { kind: 'rental', capacity: 300, spend: 10 } },
  { id: 'hotel', cat: 'commerce', w: 4, h: 4, cost: 2_200_000, buildHours: 168, upkeep: 700, energy: 120, tier: 2, height: 4, color: '#f1f5f9', roof: '#0ea5e9', maxLevel: 3, needsRoad: true, commerce: { kind: 'hotel', capacity: 180, spend: 95 }, staff: { cleaning: 3 } },

  // ---------- Côté ville ----------
  { id: 'road', cat: 'landside', w: 1, h: 1, cost: 2_500, buildHours: 1, upkeep: 3, energy: 0, tier: 0, height: 0.02, color: '#6b7280', maxLevel: 1, linear: true },
  { id: 'parking_s', cat: 'landside', w: 4, h: 4, cost: 90_000, buildHours: 12, upkeep: 30, energy: 4, tier: 0, height: 0.03, color: '#717784', maxLevel: 2, needsRoad: true, parking: 160, commerce: { kind: 'parking', capacity: 160, spend: 0 } },
  { id: 'parking_m', cat: 'landside', w: 5, h: 5, cost: 1_100_000, buildHours: 96, upkeep: 300, energy: 60, tier: 2, height: 2.2, color: '#9ca3af', roof: '#6b7280', maxLevel: 3, needsRoad: true, parking: 1400, commerce: { kind: 'parking', capacity: 1400, spend: 0 } },
  { id: 'bus_station', cat: 'landside', w: 3, h: 2, cost: 200_000, buildHours: 24, upkeep: 90, energy: 10, tier: 1, height: 0.7, color: '#16a34a', roof: '#22c55e', maxLevel: 2, needsRoad: true, commerce: { kind: 'transport', capacity: 1200, spend: 0.6 }, effects: { catchment: 0.08 } },
  { id: 'train_station', cat: 'landside', w: 6, h: 3, cost: 4_500_000, buildHours: 240, upkeep: 900, energy: 150, tier: 3, height: 1.4, color: '#64748b', roof: '#0284c7', maxLevel: 2, needsRoad: true, commerce: { kind: 'transport', capacity: 6000, spend: 1 }, effects: { catchment: 0.25 } },
  { id: 'power_plant', cat: 'tech', w: 3, h: 3, cost: 700_000, buildHours: 72, upkeep: 350, energy: 0, tier: 1, height: 1.8, color: '#78716c', roof: '#facc15', maxLevel: 3, power: 1500, staff: { maintenance: 2 }, noise: 3 },
  { id: 'solar', cat: 'tech', w: 4, h: 4, cost: 900_000, buildHours: 72, upkeep: 60, energy: 0, tier: 2, tech: 'solar', height: 0.2, color: '#1d4ed8', maxLevel: 3, power: 900 },
  { id: 'admin', cat: 'tech', w: 3, h: 3, cost: 300_000, buildHours: 48, upkeep: 160, energy: 30, tier: 0, height: 1.6, color: '#cbd5e1', roof: '#475569', maxLevel: 3, needsRoad: true, staff: { admin: 2 }, effects: { contracts: 3 } },
  { id: 'rnd', cat: 'tech', w: 4, h: 3, cost: 1_000_000, buildHours: 96, upkeep: 450, energy: 90, tier: 2, height: 1.6, color: '#e0f2fe', roof: '#38bdf8', maxLevel: 3, needsRoad: true, staff: { admin: 2 }, effects: { research: 1 } },
  { id: 'training', cat: 'tech', w: 3, h: 3, cost: 450_000, buildHours: 48, upkeep: 200, energy: 30, tier: 1, height: 1.3, color: '#fef3c7', roof: '#d97706', maxLevel: 2, needsRoad: true, staff: { admin: 1 }, effects: { training: 1 } },
  { id: 'trees', cat: 'landside', w: 2, h: 2, cost: 8_000, buildHours: 2, upkeep: 2, energy: 0, tier: 0, height: 1, color: '#2f7d4a', maxLevel: 1, effects: { green: 1 } },
];

export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries(D.map((d) => [d.id, d]));
export const BUILDING_LIST = D;
export const BUILD_CATS: BuildCat[] = ['airside', 'terminal', 'commerce', 'landside', 'tech'];

export function levelMult(level: number): number {
  return 1 + 0.5 * (level - 1);
}
export function upgradeCost(def: BuildingDef, level: number): number {
  return Math.round(def.cost * 0.6 * level);
}
export function footprint(def: BuildingDef, rot: 0 | 1): { w: number; h: number } {
  return rot === 0 ? { w: def.w, h: def.h } : { w: def.h, h: def.w };
}
