import type { StaffCat } from '../sim/types';

/**
 * Événements imprévus. Probabilité quotidienne de base, modulée par la
 * fréquence choisie, la taille de l'aéroport et l'état des installations.
 */
export interface IncidentDef {
  id: string;
  /** Probabilité de base par jour. */
  p: number;
  minTier: number;
  durMin: number; // minutes
  durMax: number;
  /** Réponse possible : coût (multiplié par la sévérité) et réduction de durée. */
  response?: { cost: number; cut: number };
  /** Modificateur de recherche qui réduit la probabilité. */
  reducer?: string;
  /** Saison favorable (multiplie p). */
  season?: [number, number, number, number];
  positive?: boolean;
  staffCat?: StaffCat;
}

const L: IncidentDef[] = [
  { id: 'runway_closure', p: 0.025, minTier: 0, durMin: 90, durMax: 360, response: { cost: 25_000, cut: 0.6 } },
  { id: 'power_outage', p: 0.02, minTier: 0, durMin: 45, durMax: 240, response: { cost: 15_000, cut: 0.5 }, reducer: 'powerIncident', season: [1.3, 1, 1.4, 1] },
  { id: 'baggage_failure', p: 0.03, minTier: 0, durMin: 60, durMax: 300, response: { cost: 12_000, cut: 0.6 }, reducer: 'baggageIncident' },
  { id: 'strike', p: 0.008, minTier: 1, durMin: 720, durMax: 2880, response: { cost: 0, cut: 1 } },
  { id: 'security_alert', p: 0.018, minTier: 0, durMin: 30, durMax: 150, response: { cost: 8_000, cut: 0.5 }, reducer: 'securityIncident' },
  { id: 'breakdown', p: 0.05, minTier: 0, durMin: 240, durMax: 1440, response: { cost: 10_000, cut: 0.8 }, reducer: 'breakdown' },
  { id: 'aircraft_incident', p: 0.012, minTier: 0, durMin: 40, durMax: 150, response: { cost: 10_000, cut: 0.5 } },
  { id: 'chain_delays', p: 0.02, minTier: 1, durMin: 180, durMax: 480, response: { cost: 20_000, cut: 0.5 }, reducer: 'delays' },
  { id: 'earthquake', p: 0.0015, minTier: 1, durMin: 360, durMax: 1440 },
  { id: 'flood', p: 0.003, minTier: 0, durMin: 240, durMax: 1200, season: [0.8, 1.4, 0.6, 1.6] },
  { id: 'seasonal_peak', p: 0.03, minTier: 0, durMin: 4320, durMax: 10080, positive: true, season: [0.6, 0.8, 2.2, 0.5] },
  { id: 'world_crisis', p: 0.0012, minTier: 2, durMin: 14400, durMax: 43200 },
  { id: 'vip_summit', p: 0.006, minTier: 2, durMin: 1440, durMax: 4320, positive: true },
];

export const INCIDENTS: Record<string, IncidentDef> = Object.fromEntries(L.map((d) => [d.id, d]));
export const INCIDENT_LIST = L;
