import { SCENARIO_MAP, DAILY_TEMPLATES } from '../data/scenarios';
import { AIRLINE_LIST } from '../data/airlines';
import { Rng, hashString } from '../core/rng';
import { acceptOffer, airlineState, generateOffer } from './airlines';
import { newBuilding, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_WATER } from './construction';
import { createDayFlights } from './flights';
import { emptyPaxToday } from './passengers';
import { objectivesFor } from './progression';
import { staffRequired } from './staff';
import { initWeather } from './weather';
import { invalidateWorld } from './world';
import { STAFF_CATS, type CommerceKind, type GameMode, type GameSettings, type GameState, type Offer, type StaffCat, type StaffState } from './types';

/** Version du format de sauvegarde (voir save/migrations.ts). */
export const SAVE_VERSION = 1;

export const MAP_W = 72;
export const MAP_H = 56;
export const PARCEL = 8;

export interface NewGameOptions {
  name: string;
  mode: GameMode;
  difficulty?: GameSettings['difficulty'];
  eventsFreq?: number;
  weather?: boolean;
  unlimitedMoney?: boolean;
  allUnlocked?: boolean;
  startCash?: number;
  scenario?: string;
  seed?: number;
  startTier?: number;
}

const START_CASH = { easy: 4_000_000, normal: 2_500_000, hard: 1_200_000 };
const COMMERCE: CommerceKind[] = ['cafe', 'restaurant', 'shop', 'dutyfree', 'lounge', 'hotel', 'parking', 'ads', 'transport', 'rental'];

function genTerrain(r: Rng, ownedFn: (x: number, y: number) => boolean): number[] {
  const t = new Array(MAP_W * MAP_H).fill(TERRAIN_GRASS);
  // Lac hors de la zone initiale.
  const lakes = r.int(1, 2);
  for (let k = 0; k < lakes; k++) {
    const cx = r.chance(0.5) ? r.int(4, 16) : r.int(58, 68);
    const cy = r.int(6, 40);
    const rx = r.range(3, 6);
    const ry = r.range(2.5, 5);
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d < 1 + Math.sin(x * 0.9 + y * 0.7) * 0.15 && !ownedFn(x, y)) t[y * MAP_W + x] = TERRAIN_WATER;
    }
  }
  // Bosquets.
  for (let k = 0; k < 26; k++) {
    const cx = r.int(0, MAP_W - 1);
    const cy = r.int(0, MAP_H - 6);
    const rad = r.range(1.5, 4);
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      if (Math.hypot(x - cx, y - cy) > rad + r.range(-0.6, 0.6)) continue;
      // La zone de départ reste dégagée (sauf la bordure est).
      if (ownedFn(x, y) && x < 50) continue;
      if (t[y * MAP_W + x] === TERRAIN_GRASS) t[y * MAP_W + x] = TERRAIN_FOREST;
    }
  }
  return t;
}

function staffInit(): Record<StaffCat, StaffState> {
  const o = {} as Record<StaffCat, StaffState>;
  for (const c of STAFF_CATS) o[c] = { count: 0, skill: 2, morale: 70, shift: 'balanced', wageMult: 1, training: 0, onStrike: 0 };
  return o;
}

type Placement = [string, number, number, 0 | 1];

const SMALL_LAYOUT: Placement[] = [
  ['runway_s', 28, 26, 0],
  ['stand_s', 30, 29, 0],
  ['stand_s', 34, 29, 0],
  ['terminal_s', 30, 32, 0],
  ['checkin', 30, 36, 0],
  ['security', 33, 36, 0],
  ['baggage_claim', 36, 32, 1],
  ['info_desk', 36, 35, 0],
  ['cafe', 38, 33, 0],
  ['parking_s', 41, 40, 0],
  ['tower_s', 45, 29, 0],
  ['trees', 46, 36, 0],
  ['trees', 26, 40, 0],
  ['trees', 48, 44, 0],
];

const MEDIUM_EXTRA: Placement[] = [
  ['stand_m', 38, 29, 0],
  ['fire_station', 47, 29, 0],
  ['shop', 36, 36, 0],
  ['checkin', 24, 36, 0],
  ['terminal_s', 24, 32, 0],
  ['security', 27, 36, 0],
  ['deicing', 44, 33, 0],
];

function applyLayout(s: GameState, layout: Placement[]): void {
  for (const [type, x, y, rot] of layout) s.buildings.push(newBuilding(s, type, x, y, rot, true));
  // Taxiway parallèle à la piste et route d'accès depuis le bord sud.
  for (let x = 29; x <= 42; x++) s.buildings.push(newBuilding(s, 'taxiway', x, 28, 0, true));
  for (let y = 38; y < MAP_H; y++) s.buildings.push(newBuilding(s, 'road', 40, y, 0, true));
  for (let x = 30; x < 40; x++) s.buildings.push(newBuilding(s, 'road', x, 38, 0, true));
  if (layout.some((p) => p[1] === 24)) {
    for (let x = 24; x < 30; x++) s.buildings.push(newBuilding(s, 'road', x, 38, 0, true));
    s.buildings.push(newBuilding(s, 'taxiway', 43, 28, 0, true));
    s.buildings.push(newBuilding(s, 'taxiway', 44, 28, 0, true));
  }
  for (const b of s.buildings) {
    // Les parcelles occupées par l'aménagement initial sont acquises.
    b.totalInvested = Math.round(b.totalInvested * 0.5);
  }
}

function fixedOffer(s: GameState, airlineId: string, destId: string, aircraft: string, slots: number[]): Offer {
  return { id: s.nextId++, airlineId, destId, aircraft, rotations: slots.length, slots, feeDiscount: 0, durationDays: 120, minOnTime: 65, expiresDay: 9999, negotiated: 0, signingBonus: 0 };
}

export function createGame(opts: NewGameOptions): GameState {
  const seed = opts.seed ?? (Date.now() ^ hashString(opts.name)) >>> 0;
  const r = new Rng(seed);
  const scenario = opts.scenario ? SCENARIO_MAP[opts.scenario] : undefined;
  const difficulty = opts.difficulty ?? 'normal';
  const pw = Math.ceil(MAP_W / PARCEL);
  const ph = Math.ceil(MAP_H / PARCEL);
  const owned = new Array(pw * ph).fill(false);
  for (let py = 3; py < ph; py++) for (let px = 3; px <= 6; px++) owned[py * pw + px] = true;
  const ownedFn = (x: number, y: number) => owned[Math.floor(y / PARCEL) * pw + Math.floor(x / PARCEL)];
  const terrain = genTerrain(r, ownedFn);
  const startDay = scenario?.startDay ?? 90;
  const settings: GameSettings = {
    difficulty,
    eventsFreq: scenario?.eventsFreq ?? opts.eventsFreq ?? 2,
    weather: opts.weather ?? true,
    unlimitedMoney: opts.mode === 'sandbox' && !!opts.unlimitedMoney,
    allUnlocked: opts.mode === 'sandbox' && !!opts.allUnlocked,
    startCash: opts.startCash ?? scenario?.cash ?? START_CASH[difficulty],
  };
  const now = Date.now();
  const s: GameState = {
    version: SAVE_VERSION,
    id: `g${now.toString(36)}${r.int(0, 1e6).toString(36)}`,
    name: opts.name,
    mode: opts.mode,
    createdAt: now,
    updatedAt: now,
    playSeconds: 0,
    settings,
    rng: r.state,
    time: startDay * 1440 + 6 * 60 + 40,
    map: { w: MAP_W, h: MAP_H, parcel: PARCEL, terrain, owned },
    buildings: [],
    nextId: 1,
    finance: {
      cash: settings.startCash,
      loans: [],
      nextLoanId: 1,
      fees: { landing: 9, pax: 14, parking: 12 },
      today: { revenue: {}, expenses: {} },
      history: [],
      bankruptcyDays: 0,
      taxAccrued: 0,
    },
    airlines: AIRLINE_LIST.map((a) => ({ id: a.id, satisfaction: 60, relation: 50, active: true })),
    contracts: [],
    offers: [],
    flights: [],
    pax: {
      landside: [],
      checkin: [],
      security: [],
      airside: [],
      baggage: [],
      parkedCars: 0,
      transferPool: 0,
      today: emptyPaxToday(),
      live: { checkinQueue: 0, securityQueue: 0, baggageQueue: 0, inTerminal: 0, congestion: 0 },
    },
    staff: staffInit(),
    weather: { current: { kind: 'clear', temp: 12, wind: 8, windDir: 270 }, forecast: [], lastHour: 0 },
    incidents: [],
    research: { done: [], active: [] },
    tier: scenario?.tier ?? opts.startTier ?? 0,
    objectives: [],
    reputation: scenario ? 50 : 42,
    satisfaction: 65,
    satisfactionParts: {},
    commerce: {
      price: Object.fromEntries(COMMERCE.map((k) => [k, 1])) as Record<CommerceKind, number>,
      lease: Object.fromEntries(COMMERCE.map((k) => [k, false])) as Record<CommerceKind, boolean>,
    },
    log: [],
    challenge: null,
    maintenanceBudget: 1,
    runwayBusy: {},
    dayCounters: { onTime: 0, delayed: 0, cancelled: 0, diverted: 0, movements: 0 },
    totals: { pax: 0, movements: 0, days: 0 },
    forced: [],
    gameOver: null,
  };
  invalidateWorld();
  const layout = scenario?.layout === 'medium' || (opts.startTier ?? 0) >= 1 ? [...SMALL_LAYOUT, ...MEDIUM_EXTRA] : SMALL_LAYOUT;
  applyLayout(s, layout);
  invalidateWorld();
  initWeather(s);
  // Personnel initial dimensionné sur les besoins.
  const baseContracts: Offer[] = [
    fixedOffer(s, 'azur', 'lyo', 'tp70', [7 * 60, 12 * 60, 17 * 60 + 30]),
    fixedOffer(s, 'cap', 'nte', 'tp70', [8 * 60 + 15, 14 * 60 + 30, 19 * 60]),
  ];
  for (const o of baseContracts) {
    s.offers.push(o);
    acceptOffer(s, o);
  }
  // Contrats supplémentaires pour les scénarios.
  const extra = (scenario?.contracts ?? 2) - 2;
  for (let i = 0; i < extra; i++) {
    const o = generateOffer(s);
    if (o) {
      o.slots = o.slots.slice(0, 2);
      o.rotations = o.slots.length;
      s.offers.push(o);
      acceptOffer(s, o);
    }
  }
  // Les contrats initiaux démarrent immédiatement.
  const day = Math.floor(s.time / 1440);
  for (const c of s.contracts) {
    c.startDay = day;
    c.endDay = day + 120;
  }
  for (const c of STAFF_CATS) {
    const need = staffRequired(s, c);
    s.staff[c].count = need;
  }
  s.log = [];
  // Quelques offres en attente.
  for (let i = 0; i < 2; i++) {
    const o = generateOffer(s);
    if (o) s.offers.push(o);
  }
  if (scenario) {
    s.objectives = scenario.goals.map((g) => ({ ...g, done: false }));
    s.challenge = { id: scenario.id, status: 'running', deadlineDay: day + scenario.days };
    if (scenario.debt > 0) {
      s.finance.loans.push({ id: s.finance.nextLoanId++, principal: scenario.debt, remaining: scenario.debt, ratePct: 6, monthlyPayment: Math.round(scenario.debt / 60), monthsLeft: 72 });
    }
    s.forced = (scenario.forced ?? []).map(([type, d, dur]) => ({ type, day: day + d, dur }));
  } else if (opts.mode === 'daily') {
    const dr = new Rng(hashString(new Date().toISOString().slice(0, 10)));
    const picks = [...DAILY_TEMPLATES].sort(() => dr.next() - 0.5).slice(0, 2);
    s.objectives = picks.map((g) => ({ ...g, done: false }));
    s.challenge = { id: 'daily', status: 'running', deadlineDay: day + 7 };
  } else {
    s.objectives = objectivesFor(s.tier);
  }
  for (const a of s.airlines) airlineState(s, a.id);
  createDayFlights(s, day);
  // Les rotations déjà passées à l'heure de démarrage sont retirées.
  s.flights = s.flights.filter((f) => f.schedArr > s.time + 15);
  return s;
}
