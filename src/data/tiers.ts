/** Paliers de progression de l'aéroport. */
export interface TierDef {
  level: number;
  pax30: number;
  reputation: number;
  requires: string[];
  /** Nombre maximal de contrats simultanés de base. */
  maxContracts: number;
  reward: number;
}

export const TIERS: TierDef[] = [
  { level: 0, pax30: 0, reputation: 0, requires: [], maxContracts: 4, reward: 0 },
  { level: 1, pax30: 14_000, reputation: 45, requires: [], maxContracts: 7, reward: 400_000 },
  { level: 2, pax30: 40_000, reputation: 50, requires: ['fire_station'], maxContracts: 11, reward: 1_000_000 },
  { level: 3, pax30: 110_000, reputation: 55, requires: ['runway_m'], maxContracts: 16, reward: 2_500_000 },
  { level: 4, pax30: 260_000, reputation: 60, requires: ['terminal_m', 'tower_l'], maxContracts: 22, reward: 6_000_000 },
  { level: 5, pax30: 600_000, reputation: 65, requires: ['runway_l'], maxContracts: 30, reward: 15_000_000 },
  { level: 6, pax30: 1_300_000, reputation: 70, requires: ['terminal_l'], maxContracts: 40, reward: 40_000_000 },
];
