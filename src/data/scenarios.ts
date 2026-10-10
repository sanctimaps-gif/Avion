import type { Objective } from '../sim/types';

/** Scénarios des modes Défis et Événements. */
export interface ScenarioDef {
  id: string;
  kind: 'challenge' | 'event';
  days: number;
  tier: number;
  layout: 'small' | 'medium';
  cash: number;
  debt: number;
  startDay: number; // jour de l'année
  eventsFreq: number;
  contracts: number;
  goals: Omit<Objective, 'done'>[];
  /** Incidents imposés : [type, jour relatif, durée en minutes]. */
  forced?: [string, number, number][];
  /** Défaite si la trésorerie passe sous ce seuil. */
  loseCash?: number;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'summer_rush', kind: 'challenge', days: 30, tier: 1, layout: 'medium', cash: 1_500_000, debt: 0, startDay: 170, eventsFreq: 1, contracts: 7,
    goals: [
      { id: 'g_pax', kind: 'paxDay', target: 1400, horizon: 'short', reward: 0, rep: 0 },
      { id: 'g_sat', kind: 'satisfaction', target: 60, horizon: 'short', reward: 0, rep: 0 },
    ],
    forced: [['seasonal_peak', 2, 20000]],
  },
  {
    id: 'turnaround', kind: 'challenge', days: 90, tier: 1, layout: 'medium', cash: 250_000, debt: 4_000_000, startDay: 60, eventsFreq: 1, contracts: 5,
    goals: [
      { id: 'g_profit', kind: 'profit30', target: 150_000, horizon: 'short', reward: 0, rep: 0 },
      { id: 'g_cash', kind: 'cash', target: 1_500_000, horizon: 'short', reward: 0, rep: 0 },
    ],
    loseCash: -1_500_000,
  },
  {
    id: 'new_route', kind: 'challenge', days: 75, tier: 1, layout: 'medium', cash: 3_000_000, debt: 0, startDay: 90, eventsFreq: 1, contracts: 5,
    goals: [
      { id: 'g_tier', kind: 'tier', target: 2, horizon: 'short', reward: 0, rep: 0 },
      { id: 'g_intl', kind: 'intlContract', target: 1, horizon: 'short', reward: 0, rep: 0 },
    ],
  },
  {
    id: 'hard_winter', kind: 'challenge', days: 25, tier: 1, layout: 'medium', cash: 1_200_000, debt: 0, startDay: 350, eventsFreq: 2, contracts: 6,
    goals: [
      { id: 'g_ontime', kind: 'onTime', target: 75, horizon: 'short', reward: 0, rep: 0 },
      { id: 'g_rep', kind: 'reputation', target: 50, horizon: 'short', reward: 0, rep: 0 },
    ],
  },
  {
    id: 'world_summit', kind: 'event', days: 14, tier: 2, layout: 'medium', cash: 2_500_000, debt: 0, startDay: 120, eventsFreq: 1, contracts: 8,
    goals: [
      { id: 'g_sat', kind: 'satisfaction', target: 62, horizon: 'short', reward: 0, rep: 0 },
      { id: 'g_paxday', kind: 'paxDay', target: 1800, horizon: 'short', reward: 0, rep: 0 },
    ],
    forced: [['vip_summit', 1, 7200], ['security_alert', 3, 120]],
  },
  {
    id: 'storm_century', kind: 'event', days: 10, tier: 1, layout: 'medium', cash: 1_500_000, debt: 0, startDay: 300, eventsFreq: 1, contracts: 6,
    goals: [
      { id: 'g_rep', kind: 'reputation', target: 45, horizon: 'short', reward: 0, rep: 0 },
      { id: 'g_cash', kind: 'cash', target: 1_000_000, horizon: 'short', reward: 0, rep: 0 },
    ],
    forced: [['flood', 2, 900], ['power_outage', 2, 180], ['runway_closure', 4, 300]],
  },
  {
    id: 'crisis', kind: 'event', days: 60, tier: 2, layout: 'medium', cash: 1_800_000, debt: 0, startDay: 30, eventsFreq: 1, contracts: 8,
    goals: [{ id: 'g_cash', kind: 'cash', target: 500_000, horizon: 'short', reward: 0, rep: 0 }],
    forced: [['world_crisis', 1, 43200]],
    loseCash: -500_000,
  },
];

export const SCENARIO_MAP: Record<string, ScenarioDef> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

/** Défi quotidien / hebdomadaire : objectifs tirés à partir de la date. */
export const DAILY_TEMPLATES: Omit<Objective, 'done'>[] = [
  { id: 'd_pax', kind: 'paxDay', target: 900, horizon: 'short', reward: 0, rep: 0 },
  { id: 'd_ontime', kind: 'onTime', target: 85, horizon: 'short', reward: 0, rep: 0 },
  { id: 'd_sat', kind: 'satisfaction', target: 68, horizon: 'short', reward: 0, rep: 0 },
  { id: 'd_contracts', kind: 'contracts', target: 7, horizon: 'short', reward: 0, rep: 0 },
  { id: 'd_profit', kind: 'profit30', target: 120_000, horizon: 'short', reward: 0, rep: 0 },
];
