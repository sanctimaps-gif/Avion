import { AIRCRAFT, AIRCRAFT_LIST } from '../data/aircraft';
import { AIRLINES, AIRLINE_LIST } from '../data/airlines';
import { DESTINATIONS, DEST_LIST } from '../data/destinations';
import { clamp } from '../core/format';
import { Rng } from '../core/rng';
import { charge, earn, maxContracts, STANDARD_FEES } from './economy';
import { addLog } from './log';
import { tech } from './modifiers';
import { getWorld } from './world';
import type { Contract, Flight, GameState, Offer } from './types';

/**
 * Compagnies aériennes : offres de contrats, négociation, renouvellement,
 * extension ou retrait selon la qualité de service, la ponctualité,
 * la demande et le niveau des redevances.
 */
function withRng<T>(s: GameState, f: (r: Rng) => T): T {
  const r = new Rng(s.rng);
  const v = f(r);
  s.rng = r.state;
  return v;
}

export function airlineState(s: GameState, id: string) {
  let a = s.airlines.find((x) => x.id === id);
  if (!a) {
    a = { id, satisfaction: 60, relation: 50, active: true };
    s.airlines.push(a);
  }
  return a;
}

/** Plus longue piste utilisable (pour filtrer les avions compatibles). */
export function longestRunway(s: GameState): number {
  const w = getWorld(s);
  let m = 0;
  for (const r of w.runways) if (w.active.has(r.id)) m = Math.max(m, r.length);
  return m;
}

function feeIndex(s: GameState): number {
  const f = s.finance.fees;
  return 0.6 * (f.pax / STANDARD_FEES.pax) + 0.4 * (f.landing / STANDARD_FEES.landing);
}

function randomSlots(r: Rng, n: number, profile: string): number[] {
  const slots: number[] = [];
  for (let i = 0; i < n; i++) {
    // Les compagnies préfèrent les heures de pointe du matin et du soir.
    const peak = r.chance(0.6);
    let h = peak ? (r.chance(0.5) ? r.int(6, 9) : r.int(16, 20)) : r.int(6, 22);
    if (profile === 'lowcost' && r.chance(0.3)) h = r.int(5, 7);
    slots.push(h * 60 + r.pick([0, 15, 30, 45]));
  }
  return slots.sort((a, b) => a - b);
}

export function generateOffer(s: GameState, forceAirline?: string, forceDest?: string): Offer | null {
  const maxRw = longestRunway(s);
  return withRng(s, (r) => {
    const tierCap = s.settings.allUnlocked ? 6 : s.tier;
    const airlines = AIRLINE_LIST.filter((a) => a.tier <= tierCap && (forceAirline ? a.id === forceAirline : true) && airlineState(s, a.id).relation > 10);
    if (!airlines.length) return null;
    const al = r.weighted(airlines, (a) => 1 + airlineState(s, a.id).relation / 50);
    const fleet = al.fleet.map((id) => AIRCRAFT[id]).filter((a) => a.tier <= tierCap + 1 && (maxRw === 0 || a.minRunway <= Math.max(maxRw, 1600)));
    const ac = fleet.length ? r.pick(fleet) : AIRCRAFT_LIST[0];
    const dests = DEST_LIST.filter((d) => d.tier <= tierCap && d.dist <= ac.range && d.dist >= Math.min(300, ac.range * 0.1) && (forceDest ? d.id === forceDest : true));
    if (!dests.length) return null;
    const dest = r.weighted(dests, (d) => d.demand * (ac.size === 'L' || ac.size === 'XL' ? (d.dist > 3000 ? 3 : 0.3) : d.dist < 2500 ? 2 : 0.4));
    const rotations = clamp(r.int(1, al.profile === 'lowcost' ? 4 : 3) - (ac.size === 'XL' ? 1 : 0), 1, 4);
    const quality = al.quality;
    const offer: Offer = {
      id: s.nextId++,
      airlineId: al.id,
      destId: dest.id,
      aircraft: ac.id,
      rotations,
      slots: randomSlots(r, rotations, al.profile),
      feeDiscount: Math.round(clamp(r.range(0, 0.3) * al.feeSens * (feeIndex(s) > 1.1 ? 1.4 : 1), 0, 0.35) * 20) / 20,
      durationDays: r.pick([60, 90, 120, 180]),
      minOnTime: Math.round(55 + quality * 30),
      expiresDay: Math.floor(s.time / 1440) + 7,
      negotiated: 0,
      signingBonus: al.profile === 'premium' || al.profile === 'global' ? Math.round(r.range(50, 200)) * 1000 : 0,
    };
    return offer;
  });
}

export function acceptOffer(s: GameState, offer: Offer): string | null {
  if (s.contracts.length >= maxContracts(s)) return 'err.maxContracts';
  const day = Math.floor(s.time / 1440);
  const used = new Set(s.contracts.filter((c) => c.airlineId === offer.airlineId).map((c) => c.flightBase));
  let base = 0;
  withRng(s, (r) => {
    do base = r.int(10, 440) * 2; while (used.has(base));
  });
  const c: Contract = {
    id: s.nextId++,
    airlineId: offer.airlineId,
    destId: offer.destId,
    aircraft: offer.aircraft,
    slots: [...offer.slots],
    feeDiscount: offer.feeDiscount,
    startDay: day + 1,
    endDay: day + 1 + offer.durationDays,
    flightBase: base,
    minOnTime: offer.minOnTime,
    stats: { flights: 0, onTime: 0, delayed: 0, cancelled: 0, diverted: 0 },
    dedicated: false,
  };
  s.contracts.push(c);
  s.offers = s.offers.filter((o) => o.id !== offer.id);
  if (offer.signingBonus) earn(s, 'bonus', offer.signingBonus);
  const st = airlineState(s, offer.airlineId);
  st.relation = clamp(st.relation + 5, 0, 100);
  addLog(s, 'good', 'log.contractSigned', { airline: AIRLINES[c.airlineId].name, dest: DESTINATIONS[c.destId].city });
  return null;
}

export function rejectOffer(s: GameState, offer: Offer): void {
  s.offers = s.offers.filter((o) => o.id !== offer.id);
  const st = airlineState(s, offer.airlineId);
  st.relation = clamp(st.relation - 2, 0, 100);
}

/** Négociation : réduire la remise demandée ou obtenir une rotation de plus. */
export function negotiate(s: GameState, offer: Offer, ask: 'discount' | 'rotation'): 'ok' | 'fail' | 'withdrawn' {
  const al = AIRLINES[offer.airlineId];
  const st = airlineState(s, offer.airlineId);
  if (offer.negotiated >= 2) return 'fail';
  offer.negotiated++;
  const p = 0.3 + st.relation / 220 + s.reputation / 300 - (ask === 'discount' ? al.feeSens * 0.25 : al.growth * -0.05 + 0.1);
  const ok = withRng(s, (r) => r.chance(clamp(p, 0.05, 0.9)));
  if (ok) {
    if (ask === 'discount') offer.feeDiscount = Math.max(0, Math.round((offer.feeDiscount - 0.1) * 20) / 20);
    else {
      offer.rotations++;
      offer.slots = withRng(s, (r) => randomSlots(r, offer.rotations, al.profile));
    }
    return 'ok';
  }
  st.relation = clamp(st.relation - 4, 0, 100);
  if (withRng(s, (r) => r.chance(0.25))) {
    s.offers = s.offers.filter((o) => o.id !== offer.id);
    return 'withdrawn';
  }
  return 'fail';
}

export function cancelPenalty(c: Contract): number {
  return 40_000 * c.slots.length * (AIRCRAFT[c.aircraft].size === 'S' ? 1 : AIRCRAFT[c.aircraft].size === 'M' ? 2 : 4);
}

export function cancelContract(s: GameState, c: Contract): void {
  charge(s, 'penalties', cancelPenalty(c));
  s.contracts = s.contracts.filter((x) => x.id !== c.id);
  const st = airlineState(s, c.airlineId);
  st.relation = clamp(st.relation - 20, 0, 100);
  st.satisfaction = clamp(st.satisfaction - 10, 0, 100);
  addLog(s, 'warn', 'log.contractCancelled', { airline: AIRLINES[c.airlineId].name, dest: DESTINATIONS[c.destId].city });
}

/** Modifie l'horaire d'une rotation (appliqué dès le lendemain). */
export function shiftSlot(s: GameState, c: Contract, i: number, delta: number): void {
  c.slots[i] = clamp(c.slots[i] + delta, 0, 1440 - 30);
  c.slots.sort((a, b) => a - b);
  const st = airlineState(s, c.airlineId);
  st.satisfaction = clamp(st.satisfaction - 0.5, 0, 100);
}

/** Installation dédiée : investissement contre fidélité accrue. */
export function dedicatedCost(c: Contract): number {
  return 150_000 * c.slots.length;
}
export function grantDedicated(s: GameState, c: Contract): boolean {
  const cost = dedicatedCost(c);
  if (c.dedicated || (!s.settings.unlimitedMoney && s.finance.cash < cost)) return false;
  charge(s, 'construction', cost);
  c.dedicated = true;
  const st = airlineState(s, c.airlineId);
  st.relation = clamp(st.relation + 15, 0, 100);
  st.satisfaction = clamp(st.satisfaction + 8, 0, 100);
  return true;
}

/** Retour d'expérience après chaque vol. */
export function onFlightDone(s: GameState, f: Flight, outcome: 'ontime' | 'delayed' | 'cancelled' | 'diverted', ourFault: boolean): void {
  const c = s.contracts.find((x) => x.id === f.contractId);
  if (c) {
    c.stats.flights++;
    if (outcome === 'ontime') c.stats.onTime++;
    else if (outcome === 'delayed') c.stats.delayed++;
    else if (outcome === 'cancelled') c.stats.cancelled++;
    else c.stats.diverted++;
  }
  const st = airlineState(s, f.airlineId);
  const q = AIRLINES[f.airlineId].quality;
  let d = 0;
  if (outcome === 'ontime') d = 0.5;
  else if (outcome === 'delayed') d = ourFault ? -1.5 - 2 * q : -0.4;
  else if (outcome === 'diverted') d = ourFault ? -6 : -2;
  else d = ourFault ? -4 : -0.6;
  st.satisfaction = clamp(st.satisfaction + d, 0, 100);
  const today = s.dayCounters;
  if (outcome === 'ontime') today.onTime++;
  else if (outcome === 'delayed') today.delayed++;
  else if (outcome === 'cancelled') today.cancelled++;
  else today.diverted++;
  if (outcome === 'ontime' || outcome === 'delayed') today.movements += 2;
}

/** Mise à jour quotidienne : satisfaction, offres, renouvellements. */
export function airlinesDaily(s: GameState): void {
  const day = Math.floor(s.time / 1440);
  const fi = feeIndex(s);
  for (const st of s.airlines) {
    const al = AIRLINES[st.id];
    if (!al) continue;
    const contracts = s.contracts.filter((c) => c.airlineId === st.id);
    if (!contracts.length) {
      st.relation += (50 - st.relation) * 0.02;
      continue;
    }
    // Dérive vers un niveau dépendant des redevances, de la satisfaction passagers et des installations.
    const ded = contracts.some((c) => c.dedicated) ? 8 : 0;
    const target = 55 + (s.satisfaction - 60) * 0.6 - al.feeSens * (fi - 1) * 70 + ded + tech(s, 'airlineSat') + (s.reputation - 50) * 0.2;
    st.satisfaction = clamp(st.satisfaction + (clamp(target, 0, 100) - st.satisfaction) * 0.04, 0, 100);
    st.relation = clamp(st.relation + (st.satisfaction - 55) * 0.02, 0, 100);
  }
  // Renouvellements, extensions, retraits.
  for (const c of [...s.contracts]) {
    const st = airlineState(s, c.airlineId);
    const al = AIRLINES[c.airlineId];
    const done = c.stats.onTime + c.stats.delayed + c.stats.cancelled + c.stats.diverted;
    const ot = done ? (c.stats.onTime / done) * 100 : 100;
    if (st.satisfaction < 22 && done > 10) {
      s.contracts = s.contracts.filter((x) => x !== c);
      st.relation = clamp(st.relation - 10, 0, 100);
      addLog(s, 'bad', 'log.airlineLeft', { airline: al.name, dest: DESTINATIONS[c.destId].city });
      continue;
    }
    if (day >= c.endDay) {
      if (st.satisfaction >= 50 && ot >= c.minOnTime - 5) {
        const grow = st.satisfaction > 72 && withRng(s, (r) => r.chance(al.growth * 0.6));
        if (grow && c.slots.length < 6) c.slots = withRng(s, (r) => [...c.slots, ...randomSlots(r, 1, al.profile)].sort((a, b) => a - b));
        c.startDay = day;
        c.endDay = day + 120;
        c.stats = { flights: 0, onTime: 0, delayed: 0, cancelled: 0, diverted: 0 };
        addLog(s, 'good', grow ? 'log.contractGrown' : 'log.contractRenewed', { airline: al.name, dest: DESTINATIONS[c.destId].city });
      } else if (st.satisfaction >= 35 && c.slots.length > 1) {
        c.slots = c.slots.slice(0, -1);
        c.startDay = day;
        c.endDay = day + 90;
        c.stats = { flights: 0, onTime: 0, delayed: 0, cancelled: 0, diverted: 0 };
        addLog(s, 'warn', 'log.contractReduced', { airline: al.name, dest: DESTINATIONS[c.destId].city });
      } else {
        s.contracts = s.contracts.filter((x) => x !== c);
        addLog(s, 'bad', 'log.contractEnded', { airline: al.name, dest: DESTINATIONS[c.destId].city });
      }
    }
  }
  // Nouvelles offres.
  s.offers = s.offers.filter((o) => o.expiresDay > day);
  const attract = 0.3 + s.reputation / 180 - Math.max(0, fi - 1) * 0.4;
  const maxOffers = 3 + Math.min(3, s.tier);
  if (s.offers.length < maxOffers && withRng(s, (r) => r.chance(clamp(attract, 0.1, 0.9)))) {
    const o = generateOffer(s);
    if (o) {
      s.offers.push(o);
      addLog(s, 'info', 'log.newOffer', { airline: AIRLINES[o.airlineId].name, dest: DESTINATIONS[o.destId].city });
    }
  }
}
