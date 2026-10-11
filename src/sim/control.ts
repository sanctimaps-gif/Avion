import { AIRCRAFT, fits } from '../data/aircraft';
import { ctlGood, gatesInUse, pendingAction, standTakenBy } from './flights';
import { getWorld } from './world';
import type { Flight, GameState, SizeClass } from './types';

/**
 * Mode contrôleur : ordres du joueur (attribution des postes, autorisations).
 * Les services au sol sont lancés par `startService` (flights.ts).
 */
export interface StandOption {
  id: number;
  /** Numéro affiché (« Poste 3 »). */
  no: number;
  size: SizeClass;
  contact: boolean;
  fits: boolean;
  /** Vol qui occupe déjà le poste (ou l'a réservé). */
  takenBy: string | null;
  ok: boolean;
}

/** Numéro stable d'un poste (ordre de construction). */
export function standNo(s: GameState, id: number): number {
  const i = getWorld(s).stands.findIndex((st) => st.id === id);
  return i + 1;
}

export function standOptions(s: GameState, f: Flight): StandOption[] {
  const w = getWorld(s);
  const size = AIRCRAFT[f.aircraft].size;
  return w.stands
    .map((st, i) => {
      const other = standTakenBy(s, st.id, f.id);
      const usable = st.reachable && w.active.has(st.id);
      const ok = usable && fits(st.size, size) && !other;
      return { id: st.id, no: i + 1, size: st.size, contact: st.contact, fits: fits(st.size, size), takenBy: other ? other.arrNo : usable ? null : '—', ok };
    })
    .sort((a, b) => Number(b.ok) - Number(a.ok) || a.no - b.no);
}

export function assignStand(s: GameState, f: Flight, standId: number): boolean {
  const req = pendingAction(s, f);
  if (!req || req.need !== 'stand') return false;
  const opt = standOptions(s, f).find((o) => o.id === standId);
  if (!opt?.ok) return false;
  const w = getWorld(s);
  f.standId = standId;
  f.contact = opt.contact && w.cap.gates - gatesInUse(s) > 0;
  ctlGood(s, f);
  return true;
}

export function clearTaxi(s: GameState, f: Flight): boolean {
  const req = pendingAction(s, f);
  if (!req || req.need !== 'taxi') return false;
  f.clrTaxi = true;
  ctlGood(s, f);
  return true;
}

export function clearTakeoff(s: GameState, f: Flight): boolean {
  const req = pendingAction(s, f);
  if (!req || req.need !== 'takeoff') return false;
  f.clrTakeoff = true;
  ctlGood(s, f);
  return true;
}

/** Vols affichés dans la colonne des strips : ordres en attente d'abord (par urgence), puis vols en cours. */
export function stripFlights(s: GameState): { f: Flight; need: ReturnType<typeof pendingAction> }[] {
  const out: { f: Flight; need: ReturnType<typeof pendingAction> }[] = [];
  for (const f of s.flights) {
    if (['cancelled', 'diverted'].includes(f.phase)) continue;
    if (f.phase === 'departed' && s.time - f.phaseStart > 3) continue;
    const need = pendingAction(s, f);
    if (f.phase === 'scheduled' && !need && f.estArr - s.time > 60) continue;
    out.push({ f, need });
  }
  out.sort((a, b) => {
    if (!!a.need !== !!b.need) return a.need ? -1 : 1;
    if (a.need && b.need) return a.need.deadline - b.need.deadline;
    return (a.f.phase === 'scheduled' ? a.f.estArr : a.f.schedDep) - (b.f.phase === 'scheduled' ? b.f.estArr : b.f.schedDep);
  });
  return out;
}
