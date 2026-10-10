import type { StaffCat } from '../sim/types';

export interface StaffDef {
  cat: StaffCat;
  wage: number; // € par jour et par agent
  hireCost: number;
  trainCost: number; // par agent et par niveau
  /** Besoin de base indépendant des bâtiments. */
  base: number;
  /** Besoin supplémentaire par tranche de 10 rotations quotidiennes. */
  perRotations: number;
}

export const STAFF: Record<StaffCat, StaffDef> = {
  checkin: { cat: 'checkin', wage: 95, hireCost: 600, trainCost: 400, base: 0, perRotations: 0 },
  security: { cat: 'security', wage: 115, hireCost: 900, trainCost: 600, base: 0, perRotations: 0 },
  cleaning: { cat: 'cleaning', wage: 80, hireCost: 300, trainCost: 200, base: 0, perRotations: 0.5 },
  baggage: { cat: 'baggage', wage: 90, hireCost: 400, trainCost: 300, base: 0, perRotations: 1 },
  maintenance: { cat: 'maintenance', wage: 130, hireCost: 1000, trainCost: 800, base: 1, perRotations: 0.5 },
  operations: { cat: 'operations', wage: 160, hireCost: 1500, trainCost: 1200, base: 0, perRotations: 1 },
  admin: { cat: 'admin', wage: 120, hireCost: 800, trainCost: 500, base: 1, perRotations: 0.3 },
  rescue: { cat: 'rescue', wage: 125, hireCost: 1200, trainCost: 900, base: 0, perRotations: 0 },
  ground: { cat: 'ground', wage: 100, hireCost: 500, trainCost: 400, base: 1, perRotations: 2 },
};

/** Profil horaire de présence selon le planning choisi (index = heure). */
export function shiftFactor(shift: 'balanced' | 'day' | 'night', hour: number): number {
  const day = hour >= 6 && hour < 22;
  if (shift === 'balanced') return day ? 1 : 0.7;
  if (shift === 'day') return day ? 1.15 : 0.35;
  return day ? 0.9 : 1.05;
}
