import type { Objective } from '../sim/types';

type ObjTemplate = Omit<Objective, 'done'>;

/** Objectifs de carrière : courts, moyens et longs termes, par palier. */
export const CAREER_OBJECTIVES: ObjTemplate[][] = [
  [
    { id: 't0_contract', kind: 'contracts', target: 3, horizon: 'short', reward: 60_000, rep: 2 },
    { id: 't0_stand', kind: 'build', param: 'stand_s', target: 3, horizon: 'short', reward: 40_000, rep: 1 },
    { id: 't0_fire', kind: 'build', param: 'fire_station', target: 1, horizon: 'medium', reward: 80_000, rep: 3 },
    { id: 't0_pax', kind: 'paxDay', target: 500, horizon: 'medium', reward: 120_000, rep: 2 },
    { id: 't0_tier', kind: 'tier', target: 1, horizon: 'long', reward: 0, rep: 3 },
  ],
  [
    { id: 't1_shop', kind: 'build', param: 'cafe', target: 2, horizon: 'short', reward: 50_000, rep: 1 },
    { id: 't1_research', kind: 'research', target: 2, horizon: 'short', reward: 80_000, rep: 1 },
    { id: 't1_sat', kind: 'satisfaction', target: 65, horizon: 'medium', reward: 150_000, rep: 3 },
    { id: 't1_ontime', kind: 'onTime', target: 85, horizon: 'medium', reward: 150_000, rep: 3 },
    { id: 't1_tier', kind: 'tier', target: 2, horizon: 'long', reward: 0, rep: 3 },
  ],
  [
    { id: 't2_intl', kind: 'intlContract', target: 1, horizon: 'short', reward: 200_000, rep: 2 },
    { id: 't2_paxday', kind: 'paxDay', target: 2000, horizon: 'medium', reward: 300_000, rep: 2 },
    { id: 't2_profit', kind: 'profit30', target: 500_000, horizon: 'medium', reward: 250_000, rep: 2 },
    { id: 't2_tier', kind: 'tier', target: 3, horizon: 'long', reward: 0, rep: 3 },
  ],
  [
    { id: 't3_cash', kind: 'cash', target: 10_000_000, horizon: 'short', reward: 300_000, rep: 1 },
    { id: 't3_contracts', kind: 'contracts', target: 12, horizon: 'medium', reward: 500_000, rep: 2 },
    { id: 't3_rep', kind: 'reputation', target: 62, horizon: 'medium', reward: 600_000, rep: 2 },
    { id: 't3_tier', kind: 'tier', target: 4, horizon: 'long', reward: 0, rep: 3 },
  ],
  [
    { id: 't4_paxday', kind: 'paxDay', target: 10_000, horizon: 'short', reward: 800_000, rep: 2 },
    { id: 't4_research', kind: 'research', target: 14, horizon: 'medium', reward: 1_000_000, rep: 2 },
    { id: 't4_nodebt', kind: 'noDebt', target: 1, horizon: 'medium', reward: 1_500_000, rep: 3 },
    { id: 't4_tier', kind: 'tier', target: 5, horizon: 'long', reward: 0, rep: 3 },
  ],
  [
    { id: 't5_paxday', kind: 'paxDay', target: 25_000, horizon: 'medium', reward: 2_000_000, rep: 2 },
    { id: 't5_sat', kind: 'satisfaction', target: 75, horizon: 'medium', reward: 2_000_000, rep: 3 },
    { id: 't5_tier', kind: 'tier', target: 6, horizon: 'long', reward: 0, rep: 3 },
  ],
  [
    { id: 't6_paxday', kind: 'paxDay', target: 60_000, horizon: 'long', reward: 10_000_000, rep: 5 },
    { id: 't6_research', kind: 'research', target: 24, horizon: 'long', reward: 5_000_000, rep: 3 },
    { id: 't6_profit', kind: 'profit30', target: 50_000_000, horizon: 'long', reward: 10_000_000, rep: 5 },
  ],
];
