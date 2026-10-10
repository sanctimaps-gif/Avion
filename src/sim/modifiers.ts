import { TECHS } from '../data/research';
import { WEATHER } from '../data/weather';
import type { GameState } from './types';

/**
 * Agrège les effets des technologies recherchées.
 * Les clés (checkinSpeed, energy, runwayCap…) sont documentées dans data/research.ts.
 */
let cacheKey = '';
let cacheVal: Record<string, number> = {};
export function tech(s: GameState, key: string): number {
  // Les technologies ne font que s'ajouter : le nombre suffit comme clé.
  const k = s.id + ':' + s.research.done.length;
  if (k !== cacheKey) {
    cacheVal = {};
    for (const id of s.research.done) {
      const def = TECHS[id];
      if (!def) continue;
      for (const [e, v] of Object.entries(def.effects)) cacheVal[e] = (cacheVal[e] ?? 0) + v;
    }
    cacheKey = k;
  }
  return cacheVal[key] ?? 0;
}

export function activeIncidents(s: GameState, type: string) {
  return s.incidents.filter((i) => !i.resolved && i.type === type && i.startedAt <= s.time && i.endsAt > s.time);
}
export function hasIncident(s: GameState, type: string): boolean {
  return activeIncidents(s, type).length > 0;
}

export function weatherDef(s: GameState) {
  return WEATHER[s.settings.weather ? s.weather.current.kind : 'clear'];
}

/** Multiplicateur de demande (saison, événements). */
export function demandMult(s: GameState): number {
  let m = 1;
  const doy = Math.floor(s.time / 1440) % 360;
  // Saisonnalité : pic en été, creux en fin d'hiver.
  m *= 1 + 0.18 * Math.sin(((doy - 80) / 360) * Math.PI * 2);
  if (hasIncident(s, 'seasonal_peak')) m *= 1.35;
  if (hasIncident(s, 'vip_summit')) m *= 1.4;
  if (hasIncident(s, 'world_crisis')) m *= 0.5;
  return m;
}
