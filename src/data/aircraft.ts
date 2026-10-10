import type { SizeClass } from '../sim/types';

/** Types d'avions fictifs. Ajout possible sans toucher aux mécaniques. */
export interface AircraftDef {
  id: string;
  name: string;
  size: SizeClass;
  seats: number;
  mtow: number; // tonnes
  minRunway: number; // mètres
  turnaround: number; // minutes au sol minimum
  range: number; // km
  tier: number;
  length: number; // en cases (rendu)
  span: number;
  engines: 2 | 4;
  prop?: boolean;
}

const A: AircraftDef[] = [
  { id: 'tp70', name: 'Aerion TP-70', size: 'S', seats: 70, mtow: 23, minRunway: 1200, turnaround: 35, range: 1500, tier: 0, length: 2.2, span: 2.4, engines: 2, prop: true },
  { id: 'rj95', name: 'Corvus RJ-95', size: 'S', seats: 96, mtow: 45, minRunway: 1500, turnaround: 40, range: 3000, tier: 0, length: 2.7, span: 2.6, engines: 2 },
  { id: 'nb180', name: 'Stratos NB-180', size: 'M', seats: 180, mtow: 78, minRunway: 2000, turnaround: 50, range: 5500, tier: 1, length: 3.4, span: 3.4, engines: 2 },
  { id: 'nb220', name: 'Stratos NB-220', size: 'M', seats: 220, mtow: 95, minRunway: 2300, turnaround: 55, range: 6500, tier: 2, length: 3.8, span: 3.5, engines: 2 },
  { id: 'wb300', name: 'Meridian WB-300', size: 'L', seats: 300, mtow: 250, minRunway: 2800, turnaround: 80, range: 13000, tier: 3, length: 4.6, span: 4.6, engines: 2 },
  { id: 'wb380', name: 'Meridian WB-380', size: 'L', seats: 380, mtow: 330, minRunway: 3000, turnaround: 90, range: 14000, tier: 4, length: 4.9, span: 4.8, engines: 2 },
  { id: 'sj550', name: 'Titan SJ-550', size: 'XL', seats: 550, mtow: 560, minRunway: 3300, turnaround: 110, range: 15000, tier: 5, length: 5.6, span: 5.7, engines: 4 },
];

export const AIRCRAFT: Record<string, AircraftDef> = Object.fromEntries(A.map((a) => [a.id, a]));
export const AIRCRAFT_LIST = A;

export const SIZE_RANK: Record<SizeClass, number> = { S: 0, M: 1, L: 2, XL: 3 };
/** Un poste de taille X accepte les avions de taille ≤ X. */
export function fits(standSize: SizeClass, aircraftSize: SizeClass): boolean {
  return SIZE_RANK[standSize] >= SIZE_RANK[aircraftSize];
}
