import { SCENARIO_MAP, DAILY_TEMPLATES } from '../data/scenarios';
import { AIRLINE_LIST } from '../data/airlines';
import { Rng, hashString } from '../core/rng';
import { acceptOffer, airlineState, generateOffer } from './airlines';
import { newBuilding, TERRAIN_FIELD, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_SAND, TERRAIN_TOWN, TERRAIN_WATER } from './construction';
import { BUILDINGS, footprint } from '../data/buildings';
import { createDayFlights } from './flights';
import { emptyPaxToday } from './passengers';
import { objectivesFor } from './progression';
import { staffRequired } from './staff';
import { initWeather } from './weather';
import { invalidateWorld } from './world';
import { STAFF_CATS, type CommerceKind, type GameMode, type GameSettings, type GameState, type Offer, type StaffCat, type StaffState } from './types';

/** Version du format de sauvegarde (voir save/migrations.ts). */
export const SAVE_VERSION = 2;

export const MAP_W = 96;
export const MAP_H = 72;
/** Décalage de l'aménagement initial (zone de départ : parcelles 4..7 × 5..8). */
const OX = 8;
const OY = 16;
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
  control?: 'auto' | 'manual';
}

const START_CASH = { easy: 4_000_000, normal: 2_500_000, hard: 1_200_000 };
const COMMERCE: CommerceKind[] = ['cafe', 'restaurant', 'shop', 'dutyfree', 'lounge', 'hotel', 'parking', 'ads', 'transport', 'rental'];

/** Bruit de valeur lissé (0..1), déterministe. */
function valueNoise(seed: number): (x: number, y: number) => number {
  const h = (ix: number, iy: number) => {
    let n = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = sm(x - ix);
    const fy = sm(y - iy);
    const a = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * fx;
    const b = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/**
 * Carte naturelle aux limites lisibles : mer et plage à l'est, rivière au nord,
 * forêts à l'ouest, village au sud-ouest (non constructibles : eau, village),
 * champs cultivés autour de la zone de départ.
 */
function genTerrain(r: Rng, ownedFn: (x: number, y: number) => boolean): number[] {
  const W = MAP_W;
  const H = MAP_H;
  const t = new Array(W * H).fill(TERRAIN_GRASS);
  const seed = r.int(1, 1e9);
  const n1 = valueNoise(seed);
  const n2 = valueNoise(seed + 7);
  const ph1 = r.range(0, 6);
  const ph2 = r.range(0, 6);
  const set = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) t[y * W + x] = v;
  };
  // Littoral (est)
  const shore = (y: number) => W - 13 + 3 * Math.sin(y * 0.11 + ph1) + 1.5 * Math.sin(y * 0.31 + ph2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = shore(y);
    if (x >= sx) set(x, y, TERRAIN_WATER);
    else if (x >= sx - 2.2) set(x, y, TERRAIN_SAND);
  }
  // Rivière : de la lisière nord jusqu'à la mer
  const pts: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const k = i / 40;
    const x = 18 + k * (shore(26) - 18 + 2);
    const y = 2 + k * 24 + 5 * Math.sin(k * Math.PI * 2.2 + ph1);
    pts.push([x, y]);
  }
  for (let y = 0; y < 40; y++) for (let x = 0; x < W; x++) {
    let d = 99;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const vx = bx - ax;
      const vy = by - ay;
      const tt = Math.max(0, Math.min(1, ((x + 0.5 - ax) * vx + (y + 0.5 - ay) * vy) / (vx * vx + vy * vy)));
      d = Math.min(d, Math.hypot(x + 0.5 - ax - vx * tt, y + 0.5 - ay - vy * tt));
    }
    if (d < 1.4) set(x, y, TERRAIN_WATER);
    else if (d < 2.1 && t[y * W + x] === TERRAIN_GRASS) set(x, y, TERRAIN_SAND);
  }
  // Rivière amont : de la lisière nord jusqu'au départ du méandre
  for (let y = 0; y < 3; y++) for (let x = 17; x < 20; x++) set(x, y, TERRAIN_WATER);
  // Petit étang à l'ouest
  const lx = r.int(5, 10);
  const ly = r.int(30, 40);
  for (let y = ly - 4; y <= ly + 4; y++) for (let x = lx - 5; x <= lx + 5; x++) {
    const d = ((x - lx) / 4.2) ** 2 + ((y - ly) / 3.2) ** 2 + (n1(x * 0.5, y * 0.5) - 0.5) * 0.6;
    if (d < 1) set(x, y, TERRAIN_WATER);
  }
  // Village (sud-ouest)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cx = (x - 6) / 12;
    const cy = (y - (H - 7)) / 9;
    if (cx * cx + cy * cy + (n2(x * 0.3, y * 0.3) - 0.5) * 0.5 < 1 && !ownedFn(x, y) && t[y * W + x] === TERRAIN_GRASS) set(x, y, TERRAIN_TOWN);
  }
  // Forêts et champs
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (t[i] !== TERRAIN_GRASS) continue;
    const owned = ownedFn(x, y);
    const westBias = Math.max(0, 1 - x / 26) * 0.35;
    const f = n1(x * 0.16, y * 0.16) + westBias;
    if (f > 0.66 && (!owned || x >= W - 40)) {
      t[i] = TERRAIN_FOREST;
      continue;
    }
    if (!owned && n2(x * 0.09, y * 0.09) > 0.48 && f < 0.6) t[i] = TERRAIN_FIELD;
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
  ['runway_s', 28, 24, 0],
  ['stand_s', 30, 29, 0],
  ['stand_s', 34, 29, 0],
  ['terminal_s', 30, 33, 0],
  ['checkin', 30, 37, 0],
  ['security', 33, 37, 0],
  ['baggage_claim', 36, 33, 1],
  ['info_desk', 36, 36, 0],
  ['cafe', 38, 34, 0],
  ['parking_s', 41, 41, 0],
  ['tower_s', 45, 29, 0],
  ['trees', 46, 37, 0],
  ['trees', 26, 41, 0],
  ['trees', 48, 45, 0],
];

const MEDIUM_EXTRA: Placement[] = [
  ['stand_m', 38, 29, 0],
  ['fire_station', 47, 29, 0],
  ['shop', 36, 37, 0],
  ['checkin', 24, 37, 0],
  ['terminal_s', 24, 33, 0],
  ['security', 27, 37, 0],
  ['deicing', 44, 34, 0],
];

function applyLayout(s: GameState, layout: Placement[]): void {
  const add = (type: string, x: number, y: number, rot: 0 | 1 = 0) => {
    const b = newBuilding(s, type, x + OX, y + OY, rot, true);
    s.buildings.push(b);
    // Le terrain sous l'aménagement initial est dégagé.
    const f = footprint(BUILDINGS[type], rot);
    for (let yy = b.y; yy < b.y + f.h; yy++) for (let xx = b.x; xx < b.x + f.w; xx++) s.map.terrain[yy * s.map.w + xx] = TERRAIN_GRASS;
  };
  for (const [type, x, y, rot] of layout) add(type, x, y, rot);
  // Taxiway parallèle à la piste et route d'accès depuis le bord sud.
  for (let x = 29; x <= 42; x++) add('taxiway', x, 28);
  for (let y = 39; y < MAP_H - OY; y++) add('road', 40, y);
  for (let x = 30; x < 40; x++) add('road', x, 39);
  if (layout.some((p) => p[1] === 24)) {
    for (let x = 24; x < 30; x++) add('road', x, 39);
    add('taxiway', 43, 28);
    add('taxiway', 44, 28);
    for (let y = 29; y < 37; y++) add('taxiway', 43, y);
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
  for (let py = 5; py < ph; py++) for (let px = 4; px <= 7; px++) owned[py * pw + px] = true;
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
    control: opts.control ?? 'auto',
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
