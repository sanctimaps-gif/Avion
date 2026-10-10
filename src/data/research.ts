/**
 * Arbre technologique. Les effets sont des modificateurs nommés,
 * additionnés puis appliqués par sim/modifiers.ts.
 */
export type ResearchBranch =
  | 'automation'
  | 'baggage'
  | 'security'
  | 'energy'
  | 'navigation'
  | 'services'
  | 'ground'
  | 'traffic'
  | 'maintenance'
  | 'green';

export interface TechDef {
  id: string;
  branch: ResearchBranch;
  cost: number;
  days: number;
  requires: string[];
  tier: number;
  effects: Record<string, number>;
}

const T: TechDef[] = [
  { id: 'online_checkin', branch: 'automation', cost: 120_000, days: 4, requires: [], tier: 0, effects: { onlineCheckin: 0.2 } },
  { id: 'kiosks', branch: 'automation', cost: 300_000, days: 7, requires: ['online_checkin'], tier: 1, effects: { checkinSpeed: 0.25, staffNeed_checkin: -0.2 } },
  { id: 'biometric', branch: 'automation', cost: 1_200_000, days: 14, requires: ['kiosks', 'scanners'], tier: 3, effects: { checkinSpeed: 0.25, securitySpeed: 0.2, onlineCheckin: 0.15 } },
  { id: 'robots', branch: 'automation', cost: 3_000_000, days: 25, requires: ['biometric', 'auto_baggage'], tier: 5, effects: { staffNeed_all: -0.2 } },
  { id: 'bag_tracking', branch: 'baggage', cost: 150_000, days: 5, requires: [], tier: 0, effects: { baggageSpeed: 0.15, baggageIncident: -0.4 } },
  { id: 'auto_baggage', branch: 'baggage', cost: 900_000, days: 12, requires: ['bag_tracking'], tier: 2, effects: { baggageSpeed: 0.35, staffNeed_baggage: -0.3 } },
  { id: 'scanners', branch: 'security', cost: 400_000, days: 8, requires: [], tier: 1, effects: { securitySpeed: 0.25 } },
  { id: 'threat_ai', branch: 'security', cost: 1_500_000, days: 15, requires: ['scanners'], tier: 3, effects: { securityIncident: -0.5, securitySpeed: 0.1 } },
  { id: 'led', branch: 'energy', cost: 100_000, days: 3, requires: [], tier: 0, effects: { energy: -0.12 } },
  { id: 'smart_grid', branch: 'energy', cost: 600_000, days: 10, requires: ['led'], tier: 2, effects: { energy: -0.15, powerIncident: -0.5 } },
  { id: 'solar', branch: 'energy', cost: 500_000, days: 8, requires: ['led'], tier: 2, effects: {} },
  { id: 'ils_cat3', branch: 'navigation', cost: 700_000, days: 10, requires: [], tier: 1, effects: { fogOps: 0.5 } },
  { id: 'gbas', branch: 'navigation', cost: 2_000_000, days: 18, requires: ['ils_cat3'], tier: 4, effects: { fogOps: 0.4, runwayCap: 0.1 } },
  { id: 'wifi', branch: 'services', cost: 80_000, days: 3, requires: [], tier: 0, effects: { satisfaction: 2 } },
  { id: 'wayfinding', branch: 'services', cost: 200_000, days: 5, requires: ['wifi'], tier: 1, effects: { missed: -0.3, satisfaction: 2 } },
  { id: 'premium_services', branch: 'services', cost: 800_000, days: 10, requires: ['wayfinding'], tier: 3, effects: { spend: 0.15, satisfaction: 3 } },
  { id: 'fast_turn', branch: 'ground', cost: 350_000, days: 7, requires: [], tier: 1, effects: { turnaround: -0.12 } },
  { id: 'e_tugs', branch: 'ground', cost: 900_000, days: 12, requires: ['fast_turn'], tier: 3, effects: { turnaround: -0.1, energy: -0.05, staffNeed_ground: -0.2 } },
  { id: 'amam', branch: 'traffic', cost: 500_000, days: 8, requires: [], tier: 1, effects: { runwayCap: 0.12 } },
  { id: 'acdm', branch: 'traffic', cost: 1_400_000, days: 14, requires: ['amam'], tier: 3, effects: { runwayCap: 0.12, delays: -0.25 } },
  { id: 'predictive', branch: 'maintenance', cost: 450_000, days: 9, requires: [], tier: 1, effects: { wear: -0.3, breakdown: -0.4 } },
  { id: 'digital_twin', branch: 'maintenance', cost: 2_200_000, days: 20, requires: ['predictive', 'smart_grid'], tier: 4, effects: { wear: -0.3, breakdown: -0.3, upkeep: -0.1 } },
  { id: 'green_ops', branch: 'green', cost: 300_000, days: 6, requires: [], tier: 1, effects: { noise: -0.2, reputation: 1 } },
  { id: 'saf', branch: 'green', cost: 1_800_000, days: 16, requires: ['green_ops'], tier: 4, effects: { reputation: 3, airlineSat: 3 } },
];

export const TECHS: Record<string, TechDef> = Object.fromEntries(T.map((x) => [x.id, x]));
export const TECH_LIST = T;
export const BRANCHES: ResearchBranch[] = ['automation', 'baggage', 'security', 'energy', 'navigation', 'services', 'ground', 'traffic', 'maintenance', 'green'];
