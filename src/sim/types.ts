/**
 * Types de l'état de jeu. L'état (GameState) est un objet JSON pur :
 * il est entièrement sérialisable et ne contient aucune référence graphique.
 * Les structures dérivées (grilles d'occupation, réseaux, capacités) sont
 * recalculées à la volée dans sim/world.ts.
 */

export type GameMode = 'career' | 'sandbox' | 'challenge' | 'event' | 'daily';
export type SizeClass = 'S' | 'M' | 'L' | 'XL';
export type StaffCat =
  | 'checkin'
  | 'security'
  | 'cleaning'
  | 'baggage'
  | 'maintenance'
  | 'operations'
  | 'admin'
  | 'rescue'
  | 'ground';
export const STAFF_CATS: StaffCat[] = [
  'checkin',
  'security',
  'cleaning',
  'baggage',
  'maintenance',
  'operations',
  'admin',
  'rescue',
  'ground',
];

export type CommerceKind =
  | 'cafe'
  | 'restaurant'
  | 'shop'
  | 'dutyfree'
  | 'lounge'
  | 'hotel'
  | 'parking'
  | 'ads'
  | 'transport'
  | 'rental';

export type WeatherKind =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'fog'
  | 'snow'
  | 'frost'
  | 'wind'
  | 'gusts'
  | 'thunder'
  | 'storm'
  | 'heat'
  | 'blizzard';

export interface Building {
  id: number;
  type: string;
  x: number;
  y: number;
  /** Rotation : 0 = orientation de base, 1 = tourné de 90°. */
  rot: 0 | 1;
  level: number;
  /** État 0..100 ; un bâtiment trop usé tombe en panne. */
  condition: number;
  /** Minutes de construction restantes (0 = opérationnel). */
  buildRemaining: number;
  enabled: boolean;
  /** Panne en cours (minutes restantes), causée par un incident. */
  brokenFor: number;
  /** Revenus / coûts cumulés sur les 30 derniers jours (pour la rentabilité). */
  revenue30: number;
  cost30: number;
  revenueToday: number;
  costToday: number;
  totalInvested: number;
}

export interface Loan {
  id: number;
  principal: number;
  remaining: number;
  ratePct: number;
  monthlyPayment: number;
  monthsLeft: number;
}

export interface Ledger {
  [category: string]: number;
}

export interface DayRecord {
  day: number;
  revenue: Ledger;
  expenses: Ledger;
  cash: number;
  debt: number;
  pax: number;
  movements: number;
  onTime: number;
  delayed: number;
  cancelled: number;
  diverted: number;
  satisfaction: number;
  reputation: number;
  missed: number;
}

export interface FinanceState {
  cash: number;
  loans: Loan[];
  nextLoanId: number;
  fees: { landing: number; pax: number; parking: number };
  today: { revenue: Ledger; expenses: Ledger };
  history: DayRecord[];
  bankruptcyDays: number;
  taxAccrued: number;
}

export interface AirlineState {
  id: string;
  satisfaction: number;
  relation: number;
  active: boolean;
}

export interface Contract {
  id: number;
  airlineId: string;
  destId: string;
  aircraft: string;
  /** Heures d'arrivée prévues (minute de la journée) pour chaque rotation. */
  slots: number[];
  feeDiscount: number;
  startDay: number;
  endDay: number;
  flightBase: number;
  minOnTime: number;
  stats: { flights: number; onTime: number; delayed: number; cancelled: number; diverted: number };
  /** Installation dédiée demandée/négociée (bonus de satisfaction). */
  dedicated: boolean;
}

export interface Offer {
  id: number;
  airlineId: string;
  destId: string;
  aircraft: string;
  rotations: number;
  slots: number[];
  feeDiscount: number;
  durationDays: number;
  minOnTime: number;
  expiresDay: number;
  negotiated: number;
  signingBonus: number;
}

export type FlightPhase =
  | 'scheduled'
  | 'inbound'
  | 'holding'
  | 'landing'
  | 'taxi_in'
  | 'deboarding'
  | 'servicing'
  | 'boarding'
  | 'ready'
  | 'taxi_out'
  | 'queue'
  | 'takeoff'
  | 'departed'
  | 'diverted'
  | 'cancelled';

export interface Pt {
  x: number;
  y: number;
}

export interface Flight {
  id: number;
  contractId: number;
  airlineId: string;
  destId: string;
  aircraft: string;
  arrNo: string;
  depNo: string;
  schedArr: number;
  schedDep: number;
  estArr: number;
  actArr: number | null;
  actDep: number | null;
  phase: FlightPhase;
  phaseStart: number;
  phaseEnd: number;
  standId: number | null;
  runwayId: number | null;
  contact: boolean;
  paxArr: number;
  paxDep: number;
  paxBoarded: number;
  /** Passagers au départ pas encore arrivés à l'aéroport. */
  paxToCome: number;
  transferIn: number;
  transferOut: number;
  /** Trajectoire au sol (centres de cases) et progression. */
  path: Pt[];
  pathPos: number;
  pos: { x: number; y: number; hdg: number; alt: number };
  delayReason: string;
  revenue: number;
  served: boolean;
  holdingSince: number;
  /** Contrôle pré-arrivée (annulation météo / retard) effectué. */
  checked?: boolean;
  /** Itinéraire de roulage prévu après l'atterrissage. */
  plan?: Pt[];
}

export interface PaxCohort {
  flightId: number;
  n: number;
  since: number;
}

export interface PaxState {
  landside: PaxCohort[];
  checkin: PaxCohort[];
  security: PaxCohort[];
  airside: PaxCohort[];
  baggage: PaxCohort[];
  /** Voitures garées (stationnement). */
  parkedCars: number;
  transferPool: number;
  today: {
    departed: number;
    arrived: number;
    missed: number;
    transfers: number;
    missedConnections: number;
    waitCheckin: number;
    waitSecurity: number;
    waitBaggage: number;
    waitSamples: number;
    complaints: number;
    parkingTurnedAway: number;
    spend: number;
    /** Clients servis aujourd'hui par type de commerce. */
    use: Record<string, number>;
  };
  /** Indicateurs instantanés (pour l'interface et la vue hybride). */
  live: {
    checkinQueue: number;
    securityQueue: number;
    baggageQueue: number;
    inTerminal: number;
    congestion: number;
  };
}

export interface StaffState {
  count: number;
  skill: number;
  morale: number;
  shift: 'balanced' | 'day' | 'night';
  wageMult: number;
  training: number;
  onStrike: number;
}

export interface WeatherHour {
  kind: WeatherKind;
  temp: number;
  wind: number;
  windDir: number;
}

export interface WeatherState {
  current: WeatherHour;
  forecast: WeatherHour[];
  lastHour: number;
}

export interface Incident {
  id: number;
  type: string;
  startedAt: number;
  endsAt: number;
  severity: number;
  targetId: number | null;
  resolved: boolean;
  staffCat?: StaffCat;
}

export interface ResearchState {
  done: string[];
  active: { id: string; progress: number }[];
}

export interface Objective {
  id: string;
  kind: string;
  target: number;
  param?: string;
  horizon: 'short' | 'medium' | 'long';
  reward: number;
  rep: number;
  done: boolean;
}

export interface LogEntry {
  t: number;
  level: 'info' | 'good' | 'warn' | 'bad';
  key: string;
  params?: Record<string, string | number>;
}

export interface GameSettings {
  difficulty: 'easy' | 'normal' | 'hard';
  eventsFreq: number;
  weather: boolean;
  unlimitedMoney: boolean;
  allUnlocked: boolean;
  startCash: number;
}

export interface ChallengeState {
  id: string;
  status: 'running' | 'won' | 'lost';
  deadlineDay: number;
}

export interface CommerceSettings {
  price: Record<CommerceKind, number>;
  lease: Record<CommerceKind, boolean>;
}

export interface GameState {
  version: number;
  id: string;
  name: string;
  mode: GameMode;
  createdAt: number;
  updatedAt: number;
  playSeconds: number;
  settings: GameSettings;
  rng: number;
  time: number;
  map: {
    w: number;
    h: number;
    parcel: number;
    terrain: number[];
    owned: boolean[];
  };
  buildings: Building[];
  nextId: number;
  finance: FinanceState;
  airlines: AirlineState[];
  contracts: Contract[];
  offers: Offer[];
  flights: Flight[];
  pax: PaxState;
  staff: Record<StaffCat, StaffState>;
  weather: WeatherState;
  incidents: Incident[];
  research: ResearchState;
  tier: number;
  objectives: Objective[];
  reputation: number;
  satisfaction: number;
  satisfactionParts: Record<string, number>;
  commerce: CommerceSettings;
  log: LogEntry[];
  challenge: ChallengeState | null;
  maintenanceBudget: number;
  /** Piste occupée jusqu'à (minute de jeu), par id de piste. */
  runwayBusy: Record<number, number>;
  /** Compteurs opérationnels de la journée en cours. */
  dayCounters: { onTime: number; delayed: number; cancelled: number; diverted: number; movements: number };
  totals: { pax: number; movements: number; days: number };
  /** Incidents imposés par un scénario. */
  forced: { type: string; day: number; dur: number }[];
  gameOver: null | { won: boolean; key: string };
}
