import { TECHS } from '../data/research';
import { charge } from './economy';
import { addLog } from './log';
import { getWorld } from './world';
import type { GameState } from './types';

/** Recherche & développement : coût payé au lancement, durée en jours. */
export function researchSlots(s: GameState): number {
  return 1 + (getWorld(s).cap.research > 0 ? 1 : 0);
}

export function canResearch(s: GameState, id: string): string | null {
  const t = TECHS[id];
  if (!t) return 'err.unknown';
  if (s.research.done.includes(id)) return 'err.done';
  if (s.research.active.some((a) => a.id === id)) return 'err.active';
  if (!s.settings.allUnlocked && t.tier > s.tier) return 'lock.tier';
  if (t.requires.some((r) => !s.research.done.includes(r))) return 'lock.prereq';
  if (s.research.active.length >= researchSlots(s)) return 'err.slots';
  if (!s.settings.unlimitedMoney && s.finance.cash < t.cost) return 'pb.money';
  return null;
}

export function startResearch(s: GameState, id: string): boolean {
  if (canResearch(s, id)) return false;
  charge(s, 'research', TECHS[id].cost);
  s.research.active.push({ id, progress: 0 });
  return true;
}

export function researchSpeed(s: GameState): number {
  return 1 + 0.6 * getWorld(s).cap.research;
}

export function researchDaily(s: GameState): void {
  const speed = researchSpeed(s);
  for (const a of [...s.research.active]) {
    a.progress += speed;
    if (a.progress >= TECHS[a.id].days) {
      s.research.active = s.research.active.filter((x) => x !== a);
      s.research.done.push(a.id);
      addLog(s, 'good', 'log.researchDone', { tech: 'tech.' + a.id });
    }
  }
}
