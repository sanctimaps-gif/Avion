import { clamp } from '../core/format';
import { onFlightDone, airlinesDaily } from './airlines';
import { constructionTick } from './construction';
import { charge, dailyClose, economyMinute, monthlyClose } from './economy';
import { createDayFlights, flightHooks, flightsTick } from './flights';
import { incidentsHourly, incidentsTick, startIncident, wearDaily } from './incidents';
import { tech } from './modifiers';
import { dailySatisfaction, emptyPaxToday, landsideDaily, onBoardingClosed, onDeboard, paxTick } from './passengers';
import { progressionDaily } from './progression';
import { researchDaily } from './research';
import { dailyWages, staffCoverage, staffDaily } from './staff';
import { weatherHourly } from './weather';
import { getWorld } from './world';
import type { GameState } from './types';

/**
 * Orchestrateur : fait avancer la simulation minute par minute.
 * Un seul système de simulation, partagé par les quatre vues graphiques.
 */
flightHooks.onDeboard = onDeboard;
flightHooks.onBoardingClosed = onBoardingClosed;
flightHooks.onFlightDone = onFlightDone;

/** Minutes de jeu simulées par seconde réelle selon la vitesse choisie. */
export const SPEEDS = [0, 2, 6, 20, 60];
export const CONTROL_TIME = 0.28;

export function tick(s: GameState): void {
  if (s.gameOver) return;
  s.time++;
  if (s.time % 1440 === 0) newDay(s);
  if (s.time % 60 === 0) {
    weatherHourly(s);
    incidentsHourly(s);
  }
  constructionTick(s);
  economyMinute(s);
  charge(s, 'wages', dailyWages(s) / 1440);
  flightsTick(s);
  paxTick(s);
  incidentsTick(s);
}

export function dayIndex(s: GameState): number {
  return Math.floor(s.time / 1440);
}

function newDay(s: GameState): void {
  const day = dayIndex(s);
  // ----- Clôture de la veille -----
  landsideDaily(s);
  const dc = s.dayCounters;
  const done = dc.onTime + dc.delayed + dc.cancelled + dc.diverted;
  const onTime = done ? dc.onTime / done : 1;
  const sat = dailySatisfaction(s, onTime);
  s.satisfaction = s.satisfaction * 0.7 + sat.score * 0.3;
  s.satisfactionParts = sat.parts;
  const w = getWorld(s);
  const safety = w.cap.safety > 0 ? clamp(staffCoverage(s, 'rescue'), 0, 1) * 100 : s.tier === 0 ? 70 : 35;
  const repTarget = 0.45 * s.satisfaction + 0.3 * onTime * 100 + 0.15 * safety + 0.1 * 70 + tech(s, 'reputation') * 3;
  s.reputation = clamp(s.reputation + (repTarget - s.reputation) * 0.06, 0, 100);
  const t = s.pax.today;
  const pax = Math.round(t.departed + t.arrived);
  dailyClose(s, {
    day: day - 1,
    pax,
    movements: dc.movements,
    onTime: dc.onTime,
    delayed: dc.delayed,
    cancelled: dc.cancelled,
    diverted: dc.diverted,
    satisfaction: Math.round(s.satisfaction),
    reputation: Math.round(s.reputation),
    missed: Math.round(t.missed),
  });
  s.totals.pax += pax;
  s.totals.movements += dc.movements;
  s.totals.days++;
  s.pax.today = emptyPaxToday();
  s.dayCounters = { onTime: 0, delayed: 0, cancelled: 0, diverted: 0, movements: 0 };
  s.pax.transferPool *= 0.3;
  // ----- Nouvelle journée -----
  staffDaily(s);
  wearDaily(s);
  researchDaily(s);
  airlinesDaily(s);
  progressionDaily(s);
  if (day % 30 === 0) monthlyClose(s);
  for (const f of s.forced.filter((x) => x.day === day)) startIncident(s, f.type, f.dur);
  createDayFlights(s, day);
}

/**
 * Avance la simulation d'une durée réelle. Renvoie la fraction de minute
 * écoulée (pour l'interpolation des animations).
 */
export class Clock {
  acc = 0;
  speed = 1;
  lastTicks = 0;
  /** Avance la simulation ; `before` est appelé juste avant le dernier tick (interpolation). */
  advance(s: GameState, dtSec: number, before?: () => void, maxTicks = 240): number {
    // Mode contrôleur : le temps passe 3,5 fois moins vite pour laisser le temps de donner les ordres.
    const rate = (SPEEDS[this.speed] ?? 0) * (s.settings.control === 'manual' ? CONTROL_TIME : 1);
    this.acc += Math.min(dtSec, 0.25) * rate;
    let n = 0;
    while (this.acc >= 1 && n < maxTicks) {
      if (this.acc < 2 || n === maxTicks - 1) before?.();
      tick(s);
      this.acc -= 1;
      n++;
    }
    if (n >= maxTicks) this.acc = 0;
    this.lastTicks = n;
    return this.acc;
  }
}
