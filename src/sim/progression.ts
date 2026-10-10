import { BUILDINGS } from '../data/buildings';
import { DESTINATIONS } from '../data/destinations';
import { CAREER_OBJECTIVES } from '../data/objectives';
import { SCENARIO_MAP } from '../data/scenarios';
import { TIERS } from '../data/tiers';
import { clamp } from '../core/format';
import { aggregate, earn, totalDebt } from './economy';
import { onTimeRate } from './flights';
import { addLog } from './log';
import { getWorld } from './world';
import type { GameState, Objective } from './types';

/**
 * Progression : paliers (aéroport régional → hub mondial), objectifs à court,
 * moyen et long terme, et conditions de victoire/défaite des scénarios.
 */
export function pax30(s: GameState): number {
  return s.finance.history.slice(-30).reduce((a, d) => a + d.pax, 0);
}

export function countBuilt(s: GameState, type: string): number {
  const w = getWorld(s);
  return s.buildings.filter((b) => b.type === type && w.active.has(b.id)).length;
}

export function objectiveProgress(s: GameState, o: Objective): number {
  const last = s.finance.history[s.finance.history.length - 1];
  switch (o.kind) {
    case 'contracts': return s.contracts.length;
    case 'build': return countBuilt(s, o.param!);
    case 'paxDay': return last ? last.pax : 0;
    case 'pax30': return pax30(s);
    case 'tier': return s.tier;
    case 'research': return s.research.done.length;
    case 'satisfaction': return Math.round(s.satisfaction);
    case 'reputation': return Math.round(s.reputation);
    case 'onTime': return Math.round(onTimeRate(s, 7) * 100);
    case 'cash': return s.finance.cash;
    case 'profit30': return aggregate(s, 30).profit;
    case 'intlContract': return s.contracts.filter((c) => DESTINATIONS[c.destId].intl).length;
    case 'noDebt': return totalDebt(s) <= 0 && s.finance.history.length > 0 ? 1 : 0;
    default: return 0;
  }
}

export function objectivesFor(tier: number): Objective[] {
  return (CAREER_OBJECTIVES[clamp(tier, 0, CAREER_OBJECTIVES.length - 1)] ?? []).map((o) => ({ ...o, done: false }));
}

export interface TierCheck {
  next: number | null;
  pax: { cur: number; need: number };
  rep: { cur: number; need: number };
  missing: string[];
  ready: boolean;
}

export function tierCheck(s: GameState): TierCheck {
  const nextDef = TIERS[s.tier + 1];
  if (!nextDef) return { next: null, pax: { cur: pax30(s), need: 0 }, rep: { cur: s.reputation, need: 0 }, missing: [], ready: false };
  const missing = nextDef.requires.filter((t) => countBuilt(s, t) === 0);
  const pax = { cur: pax30(s), need: nextDef.pax30 };
  const rep = { cur: s.reputation, need: nextDef.reputation };
  return { next: nextDef.level, pax, rep, missing, ready: pax.cur >= pax.need && rep.cur >= rep.need && missing.length === 0 };
}

export function progressionDaily(s: GameState): void {
  // Passage de palier.
  const tc = tierCheck(s);
  if (tc.ready && tc.next !== null && s.mode !== 'challenge' && s.mode !== 'event') {
    s.tier = tc.next;
    const reward = TIERS[s.tier].reward;
    if (reward) earn(s, 'bonus', reward);
    addLog(s, 'good', 'log.tierUp', { tier: 'tier.' + s.tier });
    if (s.mode === 'career' || s.mode === 'sandbox') {
      for (const o of objectivesFor(s.tier)) if (!s.objectives.some((x) => x.id === o.id)) s.objectives.push(o);
    }
  } else if (tc.ready && tc.next !== null) {
    s.tier = tc.next;
    addLog(s, 'good', 'log.tierUp', { tier: 'tier.' + s.tier });
  }
  // Objectifs.
  for (const o of s.objectives) {
    if (o.done) continue;
    if (objectiveProgress(s, o) >= o.target) {
      o.done = true;
      if (o.reward) earn(s, 'bonus', o.reward);
      s.reputation = clamp(s.reputation + o.rep, 0, 100);
      addLog(s, 'good', 'log.objective', { obj: 'obj.' + o.kind, target: o.target });
    }
  }
  // Scénarios : victoire quand tous les objectifs sont atteints, défaite à l'échéance.
  const ch = s.challenge;
  if (ch && ch.status === 'running') {
    const def = SCENARIO_MAP[ch.id];
    const day = Math.floor(s.time / 1440);
    if (s.objectives.every((o) => o.done)) {
      ch.status = 'won';
      s.gameOver = { won: true, key: 'over.won' };
      addLog(s, 'good', 'log.challengeWon');
    } else if (day >= ch.deadlineDay || (def?.loseCash !== undefined && s.finance.cash < def.loseCash)) {
      ch.status = 'lost';
      s.gameOver = { won: false, key: 'over.lost' };
      addLog(s, 'bad', 'log.challengeLost');
    }
  }
}

/** Le bâtiment requis pour le palier suivant (aide à l'interface). */
export function requiredBuildingNames(types: string[]): string[] {
  return types.filter((t) => BUILDINGS[t]).map((t) => 'b.' + t);
}
