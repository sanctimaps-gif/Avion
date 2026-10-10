/**
 * Compagnies aériennes fictives. Chaque profil influence la demande,
 * le mix de passagers, la sensibilité aux redevances et les exigences.
 */
export type AirlineProfile = 'regional' | 'lowcost' | 'flag' | 'premium' | 'charter' | 'global';

export interface AirlineDef {
  id: string;
  name: string;
  code: string;
  color: string;
  color2: string;
  profile: AirlineProfile;
  fleet: string[];
  tier: number;
  /** Sensibilité aux redevances (0 = indifférente, 1 = très sensible). */
  feeSens: number;
  /** Exigence de qualité/ponctualité. */
  quality: number;
  /** Mix passagers : affaires, loisirs, petit budget, correspondance. */
  mix: [number, number, number, number];
  growth: number;
}

const L: AirlineDef[] = [
  { id: 'azur', name: 'Azur Régional', code: 'AZ', color: '#0ea5e9', color2: '#ffffff', profile: 'regional', fleet: ['tp70', 'rj95'], tier: 0, feeSens: 0.5, quality: 0.4, mix: [0.35, 0.45, 0.15, 0.05], growth: 0.6 },
  { id: 'hop', name: 'Hopla Air', code: 'HP', color: '#f97316', color2: '#1e293b', profile: 'lowcost', fleet: ['rj95', 'nb180'], tier: 0, feeSens: 0.9, quality: 0.25, mix: [0.1, 0.55, 0.33, 0.02], growth: 0.9 },
  { id: 'cap', name: 'Cap Liaisons', code: 'CL', color: '#16a34a', color2: '#f8fafc', profile: 'regional', fleet: ['tp70'], tier: 0, feeSens: 0.6, quality: 0.35, mix: [0.4, 0.4, 0.15, 0.05], growth: 0.5 },
  { id: 'sol', name: 'SolJet', code: 'SJ', color: '#eab308', color2: '#7c2d12', profile: 'charter', fleet: ['nb180', 'nb220'], tier: 1, feeSens: 0.7, quality: 0.3, mix: [0.05, 0.8, 0.13, 0.02], growth: 0.7 },
  { id: 'eur', name: 'EuroWings Union', code: 'EU', color: '#1d4ed8', color2: '#fde047', profile: 'flag', fleet: ['nb180', 'nb220'], tier: 1, feeSens: 0.45, quality: 0.6, mix: [0.35, 0.4, 0.1, 0.15], growth: 0.7 },
  { id: 'bud', name: 'BudgetSky', code: 'BS', color: '#db2777', color2: '#ffffff', profile: 'lowcost', fleet: ['nb180', 'nb220'], tier: 2, feeSens: 1, quality: 0.2, mix: [0.05, 0.55, 0.38, 0.02], growth: 1 },
  { id: 'tri', name: 'Tricolore International', code: 'TI', color: '#1e3a8a', color2: '#dc2626', profile: 'flag', fleet: ['nb220', 'wb300'], tier: 3, feeSens: 0.4, quality: 0.7, mix: [0.35, 0.35, 0.05, 0.25], growth: 0.7 },
  { id: 'atl', name: 'Atlantica', code: 'AT', color: '#0f766e', color2: '#f8fafc', profile: 'flag', fleet: ['wb300', 'wb380'], tier: 4, feeSens: 0.35, quality: 0.75, mix: [0.3, 0.4, 0.05, 0.25], growth: 0.6 },
  { id: 'des', name: 'Desert Pearl', code: 'DP', color: '#a16207', color2: '#fef3c7', profile: 'premium', fleet: ['wb380', 'sj550'], tier: 4, feeSens: 0.25, quality: 0.9, mix: [0.45, 0.25, 0.0, 0.3], growth: 0.8 },
  { id: 'ori', name: 'Orient Express Air', code: 'OE', color: '#b91c1c', color2: '#fde68a', profile: 'premium', fleet: ['wb300', 'wb380'], tier: 5, feeSens: 0.3, quality: 0.85, mix: [0.4, 0.3, 0.0, 0.3], growth: 0.6 },
  { id: 'glb', name: 'Globe Alliance', code: 'GA', color: '#334155', color2: '#38bdf8', profile: 'global', fleet: ['wb380', 'sj550'], tier: 5, feeSens: 0.3, quality: 0.85, mix: [0.35, 0.3, 0.0, 0.35], growth: 0.9 },
  { id: 'aus', name: 'Southern Cross', code: 'SC', color: '#7c3aed', color2: '#f8fafc', profile: 'global', fleet: ['wb380', 'sj550'], tier: 6, feeSens: 0.35, quality: 0.8, mix: [0.3, 0.4, 0.0, 0.3], growth: 0.6 },
];

export const AIRLINES: Record<string, AirlineDef> = Object.fromEntries(L.map((a) => [a.id, a]));
export const AIRLINE_LIST = L;
