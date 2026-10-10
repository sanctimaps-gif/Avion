import { AIRCRAFT, fits } from '../data/aircraft';
import { AIRLINES } from '../data/airlines';
import { DESTINATIONS } from '../data/destinations';
import { clamp } from '../core/format';
import { Rng } from '../core/rng';
import { earn, firstActive, STANDARD_FEES } from './economy';
import { addLog } from './log';
import { demandMult, hasIncident, activeIncidents, tech, weatherDef } from './modifiers';
import { staffEfficiency } from './staff';
import { getWorld, runwayAccess, taxiPath, type RunwayInfo, type StandInfo, type World } from './world';
import type { Contract, Flight, GameState, Pt } from './types';

/**
 * Trafic aérien. Chaque rotation suit les étapes opérationnelles :
 * approche → (attente) → atterrissage → roulage → débarquement → services
 * au sol → embarquement → repoussage/roulage → file d'attente → décollage.
 * Les étapes dépendent des capacités réelles : pistes (longueur, vent,
 * visibilité, fermeture), postes compatibles, portes, personnel, météo.
 */
export const TAXI_SPEED = 2.5; // cases par minute
export const APPROACH_MIN = 10;
export const RUNWAY_ROLL_MIN = 2;
export const HOLD_DIVERT_MIN = 45;
export const ONTIME_LIMIT = 15;

const ACTIVE_PHASES = new Set(['taxi_in', 'deboarding', 'servicing', 'boarding', 'ready', 'taxi_out', 'queue']);

export function rng(s: GameState): Rng {
  return new Rng(s.rng);
}
function withRng<T>(s: GameState, f: (r: Rng) => T): T {
  const r = new Rng(s.rng);
  const v = f(r);
  s.rng = r.state;
  return v;
}

// ---------- Capacité des pistes ----------
/** Mouvements par heure autorisés par le contrôle aérien (toutes pistes). */
export function atcCapacity(s: GameState): number {
  const w = getWorld(s);
  const base = 8 + w.cap.runwayCapBase;
  return base * clamp(staffEfficiency(s, 'operations'), 0.35, 1.2) * (1 + tech(s, 'runwayCap'));
}

export function crosswind(s: GameState, r: RunwayInfo): { xw: number; forward: boolean } {
  const wind = s.weather.current;
  const rwHdg = r.horizontal ? 90 : 180; // a → b
  const diff = ((wind.windDir - rwHdg) * Math.PI) / 180;
  return { xw: Math.abs(wind.wind * Math.sin(diff)), forward: Math.cos(diff) >= 0 };
}

/** La piste est-elle utilisable maintenant pour cet avion ? Renvoie une clé de raison sinon. */
export function runwayStatus(s: GameState, w: World, r: RunwayInfo, aircraftId?: string): string | null {
  if (!w.active.has(r.id)) return 'rw.inactive';
  if (!r.connected) return 'rw.noTaxi';
  if (activeIncidents(s, 'runway_closure').some((i) => i.targetId === r.id)) return 'rw.closed';
  if (activeIncidents(s, 'aircraft_incident').some((i) => i.targetId === r.id)) return 'rw.closed';
  if (hasIncident(s, 'flood')) return 'rw.flood';
  const wd = weatherDef(s);
  if (s.settings.weather) {
    if (wd.needsSnow && w.cap.snow <= 0) return 'rw.snow';
    const fogOps = tech(s, 'fogOps');
    if (wd.visibility < 0.3 && !r.hasIls && fogOps < 0.5) return 'rw.visibility';
    const limit = 32 + (wd.kind === 'gusts' ? -6 : 0);
    if (crosswind(s, r).xw > limit) return 'rw.crosswind';
  }
  if (aircraftId) {
    const a = AIRCRAFT[aircraftId];
    if (r.length < a.minRunway) return 'rw.short';
  }
  return null;
}

function runwaySeparation(s: GameState, w: World): number {
  const usable = Math.max(1, w.runways.filter((r) => !runwayStatus(s, w, r)).length);
  const perRunway = Math.min(36, atcCapacity(s) / usable) * weatherDef(s).runwayCap;
  return Math.max(1.5, 60 / Math.max(1, perRunway));
}

function pickRunway(s: GameState, w: World, aircraftId: string): RunwayInfo | null {
  let best: RunwayInfo | null = null;
  for (const r of w.runways) {
    if (runwayStatus(s, w, r, aircraftId)) continue;
    if ((s.runwayBusy[r.id] ?? 0) > s.time) continue;
    if (!best || crosswind(s, r).xw < crosswind(s, best).xw) best = r;
  }
  return best;
}

export function hasAnyUsableRunway(s: GameState, aircraftId: string): boolean {
  const w = getWorld(s);
  return w.runways.some((r) => !runwayStatus(s, w, r, aircraftId));
}

// ---------- Postes et portes ----------
function gatesInUse(s: GameState): number {
  return s.flights.filter((f) => f.contact && ACTIVE_PHASES.has(f.phase)).length;
}
function standTaken(s: GameState, id: number, self: number): boolean {
  return s.flights.some((f) => f.id !== self && f.standId === id && !['departed', 'diverted', 'cancelled', 'scheduled', 'taxi_out', 'queue', 'takeoff'].includes(f.phase));
}

function pickStand(s: GameState, w: World, f: Flight): StandInfo | null {
  const size = AIRCRAFT[f.aircraft].size;
  const gatesFree = w.cap.gates - gatesInUse(s) > 0;
  const cands = w.stands.filter((st) => st.reachable && w.active.has(st.id) && fits(st.size, size) && !standTaken(s, st.id, f.id));
  if (!cands.length) return null;
  const order = ['S', 'M', 'L', 'XL'];
  cands.sort((a, b) => {
    const ca = a.contact && gatesFree ? 0 : 1;
    const cb = b.contact && gatesFree ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return order.indexOf(a.size) - order.indexOf(b.size);
  });
  return cands[0];
}

// ---------- Création des vols ----------
export function loadFactor(s: GameState, c: Contract): number {
  const al = AIRLINES[c.airlineId];
  const dest = DESTINATIONS[c.destId];
  const w = getWorld(s);
  const feeIdx = s.finance.fees.pax / STANDARD_FEES.pax;
  let lf = 0.5 + 0.3 * (s.reputation / 100);
  lf *= 0.85 + 0.15 * dest.demand;
  lf *= demandMult(s);
  lf *= 1 - al.feeSens * (feeIdx - 1) * 0.25 * (1 - c.feeDiscount);
  lf *= 1 + Math.min(0.35, w.cap.catchment);
  // Concurrence interne : plusieurs contrats vers la même destination se partagent la demande.
  const same = s.contracts.filter((x) => x.destId === c.destId).reduce((a, x) => a + x.slots.length, 0);
  lf *= 1 / (1 + Math.max(0, same - 3) * 0.06);
  return clamp(lf, 0.2, 0.97);
}

export function transferShare(s: GameState, airlineId: string): number {
  if (s.tier < 3) return 0;
  return AIRLINES[airlineId].mix[3] * Math.min(1, (s.tier - 2) / 3);
}

export function createDayFlights(s: GameState, day: number): void {
  for (const c of s.contracts) {
    if (day < c.startDay || day >= c.endDay) continue;
    const a = AIRCRAFT[c.aircraft];
    const turn = Math.round((a.turnaround * Math.max(0.6, 1 + tech(s, 'turnaround')) + 15) / 5) * 5;
    c.slots.forEach((slot, i) => {
      const lf = loadFactor(s, c);
      const schedArr = day * 1440 + slot;
      const al = AIRLINES[c.airlineId];
      const f: Flight = withRng(s, (r) => ({
        id: s.nextId++,
        contractId: c.id,
        airlineId: c.airlineId,
        destId: c.destId,
        aircraft: c.aircraft,
        arrNo: `${al.code}${c.flightBase + i * 2}`,
        depNo: `${al.code}${c.flightBase + i * 2 + 1}`,
        schedArr,
        schedDep: schedArr + turn,
        estArr: schedArr + Math.round(clamp(r.gauss(2, 7), -12, 40)),
        actArr: null,
        actDep: null,
        phase: 'scheduled',
        phaseStart: s.time,
        phaseEnd: 0,
        standId: null,
        runwayId: null,
        contact: false,
        paxArr: Math.round(a.seats * clamp(lf + r.range(-0.08, 0.08), 0.15, 1)),
        paxDep: Math.round(a.seats * clamp(lf + r.range(-0.08, 0.08), 0.15, 1)),
        paxBoarded: 0,
        paxToCome: 0,
        transferIn: 0,
        transferOut: 0,
        path: [],
        pathPos: 0,
        pos: { x: -10, y: -10, hdg: 0, alt: 1 },
        delayReason: '',
        revenue: 0,
        served: false,
        holdingSince: 0,
      }));
      const ts = transferShare(s, c.airlineId);
      f.transferIn = Math.round(f.paxArr * ts);
      f.transferOut = Math.round(f.paxDep * ts);
      f.paxToCome = f.paxDep - f.transferOut;
      s.flights.push(f);
    });
  }
}

// ---------- Trajectoires ----------
function runwayEnds(s: GameState, r: RunwayInfo): { from: Pt; to: Pt } {
  return crosswind(s, r).forward ? { from: r.a, to: r.b } : { from: r.b, to: r.a };
}
function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function hdg(a: Pt, b: Pt): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}
function pathLength(p: Pt[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return l;
}
function pointOnPath(p: Pt[], dist: number): { pt: Pt; hdg: number } {
  if (p.length === 1) return { pt: p[0], hdg: 0 };
  for (let i = 1; i < p.length; i++) {
    const seg = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    if (dist <= seg || i === p.length - 1) {
      const t = seg > 0 ? clamp(dist / seg, 0, 1) : 1;
      return { pt: lerpPt(p[i - 1], p[i], t), hdg: hdg(p[i - 1], p[i]) };
    }
    dist -= seg;
  }
  return { pt: p[p.length - 1], hdg: 0 };
}

function buildTaxiIn(s: GameState, w: World, r: RunwayInfo, st: StandInfo, exitPt: Pt): Pt[] | null {
  const starts = runwayAccess(s, w, r, exitPt).slice(0, 6);
  const route = taxiPath(s, w, starts, st.access);
  if (!route) return null;
  return [exitPt, ...route, st.center];
}
function buildTaxiOut(s: GameState, w: World, r: RunwayInfo, st: StandInfo, threshold: Pt): Pt[] | null {
  const ends = runwayAccess(s, w, r, threshold).slice(0, 4);
  const route = taxiPath(s, w, st.access, ends);
  if (!route) return null;
  return [st.center, ...route, threshold];
}

// ---------- Boucle minute ----------
export function flightsTick(s: GameState): void {
  const w = getWorld(s);
  const now = s.time;
  const wd = weatherDef(s);
  const sep = runwaySeparation(s, w);
  const groundEff = Math.max(0.3, staffEfficiency(s, 'ground'));
  const bagEff = Math.max(0.35, staffEfficiency(s, 'baggage'));
  const chainDelay = hasIncident(s, 'chain_delays') ? 25 : 0;

  for (const f of s.flights) {
    const a = AIRCRAFT[f.aircraft];
    switch (f.phase) {
      case 'scheduled': {
        if (!f.checked && now >= f.schedArr - 90) {
          f.checked = true;
          // Annulation possible pour météo grave, ou si aucune piste ne peut accueillir l'avion.
          const cancelP = s.settings.weather ? wd.cancel : 0;
          if (withRng(s, (r) => r.chance(cancelP))) {
            cancelFlight(s, f, 'delay.weather');
            break;
          }
          f.estArr += Math.round(wd.delay * 0.5 + chainDelay);
        }
        if (now >= f.estArr - APPROACH_MIN) setPhase(s, f, 'inbound');
        break;
      }
      case 'inbound':
      case 'holding': {
        if (f.standId === null) {
          const st = pickStand(s, w, f);
          if (st) {
            f.standId = st.id;
            f.contact = st.contact && w.cap.gates - gatesInUse(s) > 0;
          }
        }
        const t = clamp(1 - (f.estArr - now) / APPROACH_MIN, 0, 1);
        const r = w.runways.find((x) => !runwayStatus(s, w, x, f.aircraft)) ?? w.runways[0];
        if (r) {
          const { from, to } = runwayEnds(s, r);
          const dir = Math.atan2(to.y - from.y, to.x - from.x);
          const far = { x: from.x - Math.cos(dir) * 26, y: from.y - Math.sin(dir) * 26 };
          if (f.phase === 'inbound') {
            const p = lerpPt(far, from, t);
            f.pos = { x: p.x, y: p.y, hdg: dir, alt: 1 - t * 0.95 };
          } else {
            // Circuit d'attente : cercle autour d'un point d'attente.
            const ang = (now - f.holdingSince) * 0.5 + f.id;
            f.pos = { x: far.x + Math.cos(ang) * 5, y: far.y + Math.sin(ang) * 5, hdg: ang + Math.PI / 2, alt: 0.9 };
          }
        }
        if (now >= f.estArr) {
          const runway = f.standId !== null ? pickRunway(s, w, f.aircraft) : null;
          const st = f.standId !== null ? w.stands.find((x) => x.id === f.standId) : undefined;
          if (runway && st) {
            const { from, to } = runwayEnds(s, runway);
            const exitPt = lerpPt(from, to, 0.62);
            const path = buildTaxiIn(s, w, runway, st, exitPt);
            if (path) {
              f.runwayId = runway.id;
              s.runwayBusy[runway.id] = now + sep;
              f.path = [from, exitPt];
              f.pathPos = 0;
              f.actArr = now;
              setPhase(s, f, 'landing', now + RUNWAY_ROLL_MIN);
              f.plan = path;
              f.delayReason = f.delayReason || (now - f.schedArr > ONTIME_LIMIT ? 'delay.inbound' : '');
              break;
            }
          }
          if (f.phase === 'inbound') {
            setPhase(s, f, 'holding');
            f.holdingSince = now;
            f.delayReason = !st ? 'delay.noStand' : 'delay.runway';
          } else if (now - f.holdingSince > HOLD_DIVERT_MIN) {
            divertFlight(s, f);
          }
        }
        break;
      }
      case 'landing': {
        const t = clamp((now - f.phaseStart) / RUNWAY_ROLL_MIN, 0, 1);
        const p = lerpPt(f.path[0], f.path[1], t);
        f.pos = { x: p.x, y: p.y, hdg: hdg(f.path[0], f.path[1]), alt: 0 };
        if (now >= f.phaseEnd) {
          const st = w.stands.find((x) => x.id === f.standId);
          const r = w.runways.find((x) => x.id === f.runwayId);
          const path = f.plan ?? (st && r ? buildTaxiIn(s, w, r, st, f.path[1]) : null);
          delete f.plan;
          f.runwayId = null;
          if (!path) {
            // Réseau modifié pendant l'atterrissage : l'avion attend sur place.
            f.path = [f.path[1], f.path[1]];
          } else f.path = path;
          f.pathPos = 0;
          setPhase(s, f, 'taxi_in');
        }
        break;
      }
      case 'taxi_in':
      case 'taxi_out': {
        f.pathPos += TAXI_SPEED;
        const total = pathLength(f.path);
        const { pt, hdg: h } = pointOnPath(f.path, Math.min(f.pathPos, total));
        f.pos = { x: pt.x, y: pt.y, hdg: h, alt: 0 };
        if (f.pathPos >= total) {
          if (f.phase === 'taxi_in') {
            const rate = f.contact ? 22 : 13;
            setPhase(s, f, 'deboarding', now + Math.max(4, Math.ceil(f.paxArr / rate)));
          } else {
            setPhase(s, f, 'queue');
          }
        }
        break;
      }
      case 'deboarding': {
        if (now >= f.phaseEnd) {
          arrivalsDeboarded(s, f);
          // Services au sol : nettoyage, avitaillement, catering, bagages, dégivrage si besoin.
          let dur = a.turnaround * 0.45 * Math.max(0.6, 1 + tech(s, 'turnaround'));
          dur /= Math.pow(groundEff, 0.8) * Math.pow(bagEff, 0.4);
          if (s.settings.weather && wd.needsDeicing) {
            dur += w.cap.deicing > 0 ? 10 : 35;
            if (w.cap.deicing <= 0 && !f.delayReason) f.delayReason = 'delay.deicing';
          }
          if (groundEff < 0.75 && !f.delayReason) f.delayReason = 'delay.staff';
          setPhase(s, f, 'servicing', now + Math.ceil(dur));
        }
        break;
      }
      case 'servicing': {
        if (now >= f.phaseEnd && now >= f.schedDep - 35) {
          const rate = f.contact ? 20 : 12;
          setPhase(s, f, 'boarding', now + Math.max(8, Math.ceil(f.paxDep / rate)));
        }
        break;
      }
      case 'boarding': {
        if (now >= f.phaseEnd && now >= f.schedDep - 2) {
          boardingClosed(s, f);
          setPhase(s, f, 'ready');
        }
        break;
      }
      case 'ready': {
        const st = w.stands.find((x) => x.id === f.standId);
        const runway = pickRunwayForDeparture(s, w, f.aircraft);
        if (st && runway) {
          const { from } = runwayEnds(s, runway);
          const path = buildTaxiOut(s, w, runway, st, from);
          if (path) {
            f.path = path;
            f.pathPos = 0;
            f.runwayId = runway.id;
            setPhase(s, f, 'taxi_out');
            break;
          }
        }
        if (!f.delayReason) f.delayReason = runway ? 'delay.noRoute' : 'delay.runway';
        // Blocage prolongé : le départ est annulé pour libérer le poste.
        if (now - f.phaseStart > 240) cancelFlight(s, f, f.delayReason, true);
        break;
      }
      case 'queue': {
        const r = w.runways.find((x) => x.id === f.runwayId);
        if (!r || runwayStatus(s, w, r, f.aircraft)) {
          // Piste devenue indisponible : on attend (ou on bascule sur une autre piste reliée au même réseau).
          if (!f.delayReason) f.delayReason = 'delay.runway';
          const alt = pickRunwayForDeparture(s, w, f.aircraft);
          if (alt) f.runwayId = alt.id;
          break;
        }
        if ((s.runwayBusy[r.id] ?? 0) <= now) {
          s.runwayBusy[r.id] = now + sep;
          const { from, to } = runwayEnds(s, r);
          f.path = [from, to];
          f.pathPos = 0;
          setPhase(s, f, 'takeoff', now + RUNWAY_ROLL_MIN + 1);
        }
        break;
      }
      case 'takeoff': {
        const t = clamp((now - f.phaseStart) / (RUNWAY_ROLL_MIN + 1), 0, 1);
        const p = lerpPt(f.path[0], f.path[1], Math.min(1, t * 1.1));
        f.pos = { x: p.x, y: p.y, hdg: hdg(f.path[0], f.path[1]), alt: Math.max(0, (t - 0.6) * 1.5) };
        if (now >= f.phaseEnd) departFlight(s, f);
        break;
      }
      case 'departed': {
        // Montée initiale visible quelques minutes.
        const dir = hdg(f.path[0], f.path[1]);
        f.pos = { x: f.pos.x + Math.cos(dir) * 3, y: f.pos.y + Math.sin(dir) * 3, hdg: dir, alt: Math.min(1, f.pos.alt + 0.2) };
        break;
      }
      default:
        break;
    }
  }
  // Nettoyage des vols terminés depuis plus de 3 heures.
  s.flights = s.flights.filter((f) => !(['departed', 'diverted', 'cancelled'].includes(f.phase) && now - f.phaseStart > 180));
}

function pickRunwayForDeparture(s: GameState, w: World, aircraftId: string): RunwayInfo | null {
  let best: RunwayInfo | null = null;
  for (const r of w.runways) {
    if (runwayStatus(s, w, r, aircraftId)) continue;
    if (!best || crosswind(s, r).xw < crosswind(s, best).xw) best = r;
  }
  return best;
}

function setPhase(s: GameState, f: Flight, p: Flight['phase'], end = 0): void {
  f.phase = p;
  f.phaseStart = s.time;
  f.phaseEnd = end;
}

// ---------- Événements de vol (liens passagers / économie / compagnies) ----------
type Hooks = {
  onDeboard?: (s: GameState, f: Flight) => void;
  onBoardingClosed?: (s: GameState, f: Flight) => void;
  onFlightDone?: (s: GameState, f: Flight, outcome: 'ontime' | 'delayed' | 'cancelled' | 'diverted', ourFault: boolean) => void;
};
export const flightHooks: Hooks = {};

function arrivalsDeboarded(s: GameState, f: Flight) {
  flightHooks.onDeboard?.(s, f);
}
function boardingClosed(s: GameState, f: Flight) {
  flightHooks.onBoardingClosed?.(s, f);
}

export function cancelFlight(s: GameState, f: Flight, reason: string, ourFault = false): void {
  f.delayReason = reason;
  setPhase(s, f, 'cancelled');
  f.paxToCome = 0;
  f.standId = null;
  addLog(s, 'warn', 'log.cancelled', { flight: f.arrNo, reason });
  flightHooks.onFlightDone?.(s, f, 'cancelled', ourFault);
}

function divertFlight(s: GameState, f: Flight): void {
  f.standId = null;
  f.paxToCome = 0;
  setPhase(s, f, 'diverted');
  addLog(s, 'bad', 'log.diverted', { flight: f.arrNo, reason: f.delayReason || 'delay.runway' });
  flightHooks.onFlightDone?.(s, f, 'diverted', !['delay.weather'].includes(f.delayReason));
}

function departFlight(s: GameState, f: Flight): void {
  const a = AIRCRAFT[f.aircraft];
  const c = s.contracts.find((x) => x.id === f.contractId);
  const disc = c ? c.feeDiscount : 0;
  const fees = s.finance.fees;
  const w = getWorld(s);
  f.actDep = s.time;
  f.served = true;
  const landing = a.mtow * fees.landing * (1 - disc);
  const pax = f.paxBoarded * fees.pax * (1 - disc);
  const runwayB = firstActive(s, (t) => t.startsWith('runway'));
  const termB = firstActive(s, (t) => t.startsWith('terminal'));
  const standB = f.standId !== null ? w.byId.get(f.standId) : undefined;
  earn(s, 'landing', landing, runwayB);
  earn(s, 'pax', pax, termB);
  earn(s, 'handling', (120 + a.mtow * 3) * Math.min(1, staffEfficiency(s, 'ground')), standB);
  if (w.cap.fuel > 0) earn(s, 'fuel', a.mtow * 9, firstActive(s, (t) => t === 'fuel_depot'));
  if (w.cap.mro > 0) earn(s, 'mro', Math.sqrt(a.mtow) * 60, firstActive(s, (t) => t === 'hangar'));
  if (w.cap.cargo > 0) earn(s, 'cargo', a.mtow * 7 * Math.min(1, w.cap.cargo), firstActive(s, (t) => t === 'cargo'));
  if (f.transferOut > 0) earn(s, 'transfer', f.transferOut * 6, termB);
  f.revenue = landing + pax;
  const delay = s.time - f.schedDep;
  setPhase(s, f, 'departed');
  f.standId = null;
  f.runwayId = null;
  const outcome = delay <= ONTIME_LIMIT ? 'ontime' : 'delayed';
  flightHooks.onFlightDone?.(s, f, outcome, outcome === 'delayed' && !['delay.weather', 'delay.inbound'].includes(f.delayReason));
}

/** Vols visibles (pour le rendu). */
export function visibleFlights(s: GameState): Flight[] {
  return s.flights.filter((f) => {
    if (f.phase === 'scheduled' || f.phase === 'cancelled' || f.phase === 'diverted') return false;
    if (f.phase === 'departed') return s.time - f.phaseStart < 5;
    return true;
  });
}

export function flightStatusKey(f: Flight): string {
  return 'ph.' + f.phase;
}

export function onTimeRate(s: GameState, days = 7): number {
  const h = s.finance.history.slice(-days);
  let ok = 0;
  let total = 0;
  for (const d of h) {
    ok += d.onTime;
    total += d.onTime + d.delayed + d.cancelled + d.diverted;
  }
  return total ? ok / total : 1;
}

export function warnFlight(s: GameState, f: Flight, key: string): void {
  addLog(s, 'warn', key, { flight: f.arrNo });
}
