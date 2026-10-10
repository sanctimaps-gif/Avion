import { AIRLINES } from '../data/airlines';
import { DESTINATIONS } from '../data/destinations';
import { BUILDINGS } from '../data/buildings';
import { clamp } from '../core/format';
import { charge, earn, firstActive, STANDARD_FEES } from './economy';
import { hasIncident, tech, weatherDef } from './modifiers';
import { staffEfficiency } from './staff';
import { getWorld } from './world';
import type { CommerceKind, Flight, GameState, PaxCohort } from './types';

/**
 * Simulation agrégée des passagers : les voyageurs sont regroupés en
 * cohortes (par vol) qui traversent des files d'attente à capacité limitée
 * (enregistrement → sûreté → zone d'embarquement ; bagages à l'arrivée).
 * C'est performant sur mobile tout en rendant visibles les files, temps
 * d'attente, vols manqués, correspondances et dépenses en boutiques.
 */
export const PRICE_MULT = [0.8, 1, 1.25];
export const PRICE_PROPENSITY = [1.2, 1, 0.75];
const AIRSIDE_KINDS: CommerceKind[] = ['cafe', 'restaurant', 'shop', 'dutyfree', 'lounge', 'ads'];
/** Propension de dépense par profil [affaires, loisirs, petit budget, correspondance]. */
const PROPENSITY: Partial<Record<CommerceKind, [number, number, number, number]>> = {
  cafe: [0.45, 0.5, 0.35, 0.55],
  restaurant: [0.3, 0.28, 0.12, 0.4],
  shop: [0.18, 0.35, 0.2, 0.35],
  dutyfree: [0.2, 0.35, 0.15, 0.5],
  lounge: [0.55, 0.03, 0, 0.2],
  ads: [1, 1, 1, 1],
};

export function emptyPaxToday(): GameState['pax']['today'] {
  return { departed: 0, arrived: 0, missed: 0, transfers: 0, missedConnections: 0, waitCheckin: 0, waitSecurity: 0, waitBaggage: 0, waitSamples: 0, complaints: 0, parkingTurnedAway: 0, spend: 0, use: {} };
}

function push(q: PaxCohort[], flightId: number, n: number, now: number): void {
  if (n <= 0) return;
  const last = q[q.length - 1];
  if (last && last.flightId === flightId && now - last.since < 5) last.n += n;
  else q.push({ flightId, n, since: now });
}

/** Retire les passagers d'un vol d'une file ; renvoie le nombre retiré. */
function removeFlight(q: PaxCohort[], flightId: number): number {
  let n = 0;
  for (let i = q.length - 1; i >= 0; i--) {
    if (q[i].flightId === flightId) {
      n += q[i].n;
      q.splice(i, 1);
    }
  }
  return n;
}

function processQueue(q: PaxCohort[], capacity: number, now: number, onDone: (c: PaxCohort, n: number, wait: number) => void): number {
  let cap = capacity;
  let waitSum = 0;
  let processed = 0;
  while (cap > 1e-6 && q.length) {
    const c = q[0];
    const take = Math.min(c.n, cap);
    c.n -= take;
    cap -= take;
    const wait = now - c.since;
    waitSum += wait * take;
    processed += take;
    onDone(c, take, wait);
    if (c.n <= 1e-6) q.shift();
  }
  return processed ? waitSum / processed : 0;
}

function queueSize(q: PaxCohort[]): number {
  let n = 0;
  for (const c of q) n += c.n;
  return n;
}

export function powerFactor(s: GameState): number {
  if (!hasIncident(s, 'power_outage')) return 1;
  const w = getWorld(s);
  return w.cap.power >= w.cap.energyDemand * 0.5 ? 0.85 : 0.35;
}

export function processingRates(s: GameState) {
  const w = getWorld(s);
  const P = s.pax;
  const power = powerFactor(s);
  const congF = P.live.congestion > 1 ? 1 / Math.sqrt(P.live.congestion) : 1;
  const checkin = (w.cap.checkin / 60) * staffEfficiency(s, 'checkin') * (1 + tech(s, 'checkinSpeed')) * power * congF;
  let security = (w.cap.security / 60) * staffEfficiency(s, 'security') * (1 + tech(s, 'securitySpeed')) * power * congF;
  if (hasIncident(s, 'security_alert')) security *= 0.15;
  if (hasIncident(s, 'vip_summit')) security *= 0.85;
  let baggage = (w.cap.baggage / 60) * staffEfficiency(s, 'baggage') * (1 + tech(s, 'baggageSpeed')) * power;
  if (hasIncident(s, 'baggage_failure')) baggage *= 0.3;
  return { checkin, security, baggage };
}

function onlineShare(s: GameState, airlineId: string): number {
  const mix = AIRLINES[airlineId].mix;
  return clamp(0.15 + 0.35 * mix[0] + 0.1 * mix[2] + tech(s, 'onlineCheckin'), 0, 0.85);
}

export function paxTick(s: GameState): void {
  const P = s.pax;
  const now = s.time;
  // 1. Arrivée progressive des passagers au départ (de 150 à 40 min avant le vol).
  for (const f of s.flights) {
    if (f.paxToCome <= 0) continue;
    const local = f.paxDep - f.transferOut;
    const start = f.schedDep - 150;
    if (now < start) continue;
    const target = local * clamp((now - start) / 110, 0, 1);
    const n = Math.min(f.paxToCome, target - (local - f.paxToCome));
    if (n <= 0) continue;
    f.paxToCome -= n;
    const online = n * onlineShare(s, f.airlineId);
    push(P.checkin, f.id, n - online, now);
    push(P.security, f.id, online, now);
  }
  // 2. Traitement des files.
  const r = processingRates(s);
  const t = P.today;
  const wc = processQueue(P.checkin, r.checkin, now, (c, n) => push(P.security, c.flightId, n, now));
  const ws = processQueue(P.security, r.security, now, (c, n) => push(P.airside, c.flightId, n, now));
  const wb = processQueue(P.baggage, r.baggage, now, () => undefined);
  // Moyennes des attentes (échantillonnées chaque minute, pondérées par les files).
  const cq = queueSize(P.checkin);
  const sq = queueSize(P.security);
  const bq = queueSize(P.baggage);
  if (cq + sq + bq > 0 || wc + ws + wb > 0) {
    t.waitCheckin += Math.max(wc, cq / Math.max(0.01, r.checkin)) * 1;
    t.waitSecurity += Math.max(ws, sq / Math.max(0.01, r.security));
    t.waitBaggage += Math.max(wb, bq / Math.max(0.01, r.baggage));
    t.waitSamples++;
  }
  const w = getWorld(s);
  const inTerminal = cq + sq + bq + queueSize(P.airside);
  P.live = {
    checkinQueue: cq,
    securityQueue: sq,
    baggageQueue: bq,
    inTerminal,
    congestion: w.cap.hall > 0 ? inTerminal / w.cap.hall : inTerminal > 0 ? 3 : 0,
  };
}

/** Débarquement : arrivées locales (bagages) et correspondances. */
export function onDeboard(s: GameState, f: Flight): void {
  const P = s.pax;
  const local = f.paxArr - f.transferIn;
  const bags = local * (0.75 - 0.35 * AIRLINES[f.airlineId].mix[0]);
  push(P.baggage, f.id, bags, s.time);
  P.today.arrived += f.paxArr;
  if (f.transferIn > 0) {
    const late = (f.actArr ?? s.time) - f.schedArr > 45;
    const missed = late ? f.transferIn * 0.4 : 0;
    P.today.missedConnections += missed;
    P.today.complaints += missed;
    P.transferPool += f.transferIn - missed;
  }
  commerceArrivals(s, local);
}

/** Fermeture de l'embarquement : passagers embarqués, manqués, dépenses. */
export function onBoardingClosed(s: GameState, f: Flight): void {
  const P = s.pax;
  let dwellSum = 0;
  let boarded = 0;
  for (let i = P.airside.length - 1; i >= 0; i--) {
    const c = P.airside[i];
    if (c.flightId !== f.id) continue;
    boarded += c.n;
    dwellSum += c.n * (s.time - c.since);
    P.airside.splice(i, 1);
  }
  const missed = removeFlight(P.checkin, f.id) + removeFlight(P.security, f.id) + f.paxToCome;
  f.paxToCome = 0;
  const tr = Math.min(P.transferPool, f.transferOut);
  P.transferPool -= tr;
  P.today.transfers += tr;
  f.paxBoarded = Math.round(boarded + tr);
  P.today.departed += f.paxBoarded;
  P.today.missed += missed;
  P.today.complaints += missed * 0.8;
  const dwell = boarded > 0 ? dwellSum / boarded : 0;
  commerceAirside(s, f, boarded, dwell, tr);
}

// ---------- Commerces ----------
function commerceAirside(s: GameState, f: Flight, boarded: number, dwell: number, transfers: number): void {
  const w = getWorld(s);
  const mix = AIRLINES[f.airlineId].mix;
  const intl = DESTINATIONS[f.destId].intl;
  const dwellF = clamp(dwell / 60, 0.2, 1.6);
  const total = boarded + transfers;
  const spendBoost = 1 + tech(s, 'spend');
  for (const kind of AIRSIDE_KINDS) {
    const c = w.cap.commerce[kind];
    if (!c) continue;
    if (kind === 'dutyfree' && !intl) continue;
    const prop = PROPENSITY[kind]!;
    const share = (prop[0] * mix[0] + prop[1] * mix[1] + prop[2] * mix[2] + prop[3] * mix[3]) * PRICE_PROPENSITY[s.commerce.price[kind]];
    const demand = total * share * (kind === 'ads' ? 1 : dwellF);
    const used = s.pax.today.use[kind] ?? 0;
    const served = Math.max(0, Math.min(demand, c.capacity - used));
    s.pax.today.use[kind] = used + served;
    const revenue = served * c.spend * PRICE_MULT[s.commerce.price[kind]] * spendBoost;
    bookCommerce(s, kind, revenue);
  }
}

function commerceArrivals(s: GameState, local: number): void {
  const w = getWorld(s);
  const ads = w.cap.commerce.ads;
  if (ads) bookCommerce(s, 'ads', Math.min(local, ads.capacity) * ads.spend * 0.5);
  const cafe = w.cap.commerce.cafe;
  if (cafe) bookCommerce(s, 'cafe', local * 0.08 * cafe.spend * PRICE_MULT[s.commerce.price.cafe]);
}

/** Exploitation directe : 100 % du CA mais 35 % de coûts ; concession : 45 % du CA. */
export function bookCommerce(s: GameState, kind: CommerceKind, revenue: number): void {
  if (revenue <= 0) return;
  s.pax.today.spend += revenue;
  const b = firstActive(s, (t) => BUILDINGS[t].commerce?.kind === kind);
  if (s.commerce.lease[kind]) earn(s, 'rent', revenue * 0.45, b);
  else {
    earn(s, 'commerce', revenue, b);
    charge(s, 'goods', revenue * 0.35, b);
  }
}

/** Revenus quotidiens côté ville : parkings, hôtels, transports, location. */
export function landsideDaily(s: GameState): void {
  const w = getWorld(s);
  const t = s.pax.today;
  const paxDay = t.departed + t.arrived;
  // Parking : voitures en stationnement ≈ départs/jour × part de conducteurs × durée moyenne (2 jours).
  const parkPrice = s.finance.fees.parking;
  const driveShare = clamp(0.4 - Math.min(0.25, w.cap.catchment) - (parkPrice / STANDARD_FEES.parking - 1) * 0.12, 0.08, 0.55);
  const demandCars = (t.departed * driveShare * 2) / 1.5;
  const parked = Math.min(demandCars, w.cap.parking);
  s.pax.parkedCars = parked;
  t.parkingTurnedAway = Math.max(0, demandCars - w.cap.parking) * 1.5;
  if (parked > 0) {
    const b = firstActive(s, (x) => x.startsWith('parking'));
    const rev = parked * parkPrice;
    if (s.commerce.lease.parking) earn(s, 'rent', rev * 0.45, b);
    else earn(s, 'parking', rev, b);
  }
  // Hôtel : clients liés au trafic, aux correspondances et aux passagers bloqués.
  const hotel = w.cap.commerce.hotel;
  if (hotel) {
    const stranded = s.flights.filter((f) => f.phase === 'cancelled' && s.time - f.phaseStart < 1440).reduce((a, f) => a + f.paxDep, 0);
    const guests = Math.min(hotel.capacity, (paxDay * 0.012 + t.transfers * 0.04 + stranded * 0.3) * PRICE_PROPENSITY[s.commerce.price.hotel]);
    bookCommerce(s, 'hotel', guests * hotel.spend * PRICE_MULT[s.commerce.price.hotel]);
  }
  const tr = w.cap.commerce.transport;
  if (tr) bookCommerce(s, 'transport', Math.min(tr.capacity, paxDay * 0.25) * tr.spend * PRICE_MULT[s.commerce.price.transport]);
  const rental = w.cap.commerce.rental;
  if (rental) bookCommerce(s, 'rental', Math.min(rental.capacity, t.arrived * 0.04 * PRICE_PROPENSITY[s.commerce.price.rental]) * rental.spend * PRICE_MULT[s.commerce.price.rental]);
}

// ---------- Satisfaction ----------
function lin(v: number, good: number, bad: number): number {
  return clamp(((bad - v) / (bad - good)) * 100, 0, 100);
}

/** Calcule la satisfaction du jour (0..100) et ses composantes. */
export function dailySatisfaction(s: GameState, onTime: number): { score: number; parts: Record<string, number> } {
  const t = s.pax.today;
  const w = getWorld(s);
  const n = Math.max(1, t.waitSamples);
  const pax = Math.max(1, t.departed + t.arrived);
  const parts: Record<string, number> = {
    checkin: lin(t.waitCheckin / n, 8, 50),
    security: lin(t.waitSecurity / n, 8, 45),
    baggage: lin(t.waitBaggage / n, 8, 40),
    punctuality: clamp(onTime * 100, 0, 100),
    comfort: clamp(100 - Math.max(0, s.pax.live.congestion - 0.7) * 120, 0, 100) * clamp(staffEfficiency(s, 'cleaning', 12), 0.4, 1),
    services: 0,
    reliability: lin((t.missed + t.missedConnections) / pax, 0, 0.06),
    parking: lin(t.parkingTurnedAway / pax, 0, 0.2),
    prices: 0,
  };
  // Offre de services : capacité commerciale côté piste rapportée au trafic.
  let shopCap = 0;
  for (const k of ['cafe', 'restaurant', 'shop', 'dutyfree']) shopCap += w.cap.commerce[k]?.capacity ?? 0;
  parts.services = clamp((shopCap / Math.max(50, t.departed)) * 70 + (w.cap.info > 0 ? 15 : 0) + (w.cap.commerce.lounge ? 10 : 0), 0, 100);
  let priceAvg = 0;
  const kinds = Object.keys(s.commerce.price) as CommerceKind[];
  for (const k of kinds) priceAvg += s.commerce.price[k];
  priceAvg /= kinds.length;
  parts.prices = clamp(100 - (priceAvg - 1) * 40 - (s.finance.fees.parking / STANDARD_FEES.parking - 1) * 40 - 20, 0, 100);
  const weights: Record<string, number> = { checkin: 1.2, security: 1.3, baggage: 1, punctuality: 1.6, comfort: 1, services: 0.8, reliability: 1.2, parking: 0.5, prices: 0.5 };
  let sum = 0;
  let wsum = 0;
  for (const k of Object.keys(parts)) {
    sum += parts[k] * weights[k];
    wsum += weights[k];
  }
  let score = sum / wsum;
  score += tech(s, 'satisfaction') + weatherDef(s).satisfaction * 0.5 + Math.min(3, w.cap.green * 0.5);
  return { score: clamp(score, 0, 100), parts };
}
