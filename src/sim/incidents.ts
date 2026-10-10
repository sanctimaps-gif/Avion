import { BUILDINGS } from '../data/buildings';
import { INCIDENTS, INCIDENT_LIST, type IncidentDef } from '../data/incidents';
import { STAFF } from '../data/staff';
import { clamp } from '../core/format';
import { Rng } from '../core/rng';
import { charge } from './economy';
import { addLog } from './log';
import { tech } from './modifiers';
import { season } from './weather';
import { getWorld, invalidateWorld } from './world';
import { STAFF_CATS, type GameState, type Incident, type StaffCat } from './types';

/**
 * Événements imprévus et gestion de crise. Les probabilités sont
 * configurables (fréquence choisie dans la partie), proportionnées à la taille
 * de l'aéroport et réduites par la recherche, l'entretien et les équipements.
 */
export const FREQ_MULT = [0, 0.5, 1, 2];

function withRng<T>(s: GameState, f: (r: Rng) => T): T {
  const r = new Rng(s.rng);
  const v = f(r);
  s.rng = r.state;
  return v;
}

export function incidentProbability(s: GameState, def: IncidentDef): number {
  if (def.minTier > s.tier) return 0;
  let p = def.p * FREQ_MULT[clamp(s.settings.eventsFreq, 0, 3)];
  if (!def.positive) p *= 1 + 0.15 * s.tier;
  if (def.reducer) p *= Math.max(0.1, 1 + tech(s, def.reducer));
  if (def.season) p *= def.season[season(Math.floor(s.time / 1440))];
  const w = getWorld(s);
  switch (def.id) {
    case 'runway_closure':
    case 'aircraft_incident':
      p *= Math.max(1, w.runways.length);
      if (!w.runways.length) p = 0;
      break;
    case 'breakdown': {
      // Plus les installations sont usées, plus les pannes sont fréquentes.
      const worn = s.buildings.filter((b) => !BUILDINGS[b.type].linear && b.condition < 70).length;
      p *= 0.3 + worn * 0.5;
      break;
    }
    case 'strike': {
      const avgMorale = STAFF_CATS.reduce((a, c) => a + s.staff[c].morale, 0) / STAFF_CATS.length;
      p *= clamp((100 - avgMorale) / 30, 0.2, 4);
      break;
    }
    case 'power_outage':
      if (w.cap.power >= w.cap.energyDemand) p *= 0.5;
      break;
  }
  return p;
}

export function startIncident(s: GameState, type: string, duration?: number): Incident | null {
  const def = INCIDENTS[type];
  if (!def) return null;
  const w = getWorld(s);
  const dur = duration ?? withRng(s, (r) => r.int(def.durMin, def.durMax));
  const inc: Incident = {
    id: s.nextId++,
    type,
    startedAt: s.time,
    endsAt: s.time + dur,
    severity: 1 + s.tier * 0.4,
    targetId: null,
    resolved: false,
  };
  switch (type) {
    case 'runway_closure':
    case 'aircraft_incident': {
      const rws = w.runways.filter((r) => w.active.has(r.id));
      if (!rws.length) return null;
      inc.targetId = withRng(s, (r) => r.pick(rws).id);
      if (type === 'aircraft_incident') {
        // Sans caserne de pompiers, l'intervention est bien plus longue.
        if (w.cap.safety <= 0) {
          inc.endsAt = s.time + dur * 2.2;
          s.reputation = clamp(s.reputation - 3, 0, 100);
        }
      }
      break;
    }
    case 'breakdown': {
      const cands = s.buildings.filter((b) => !BUILDINGS[b.type].linear && b.buildRemaining <= 0 && b.brokenFor <= 0 && BUILDINGS[b.type].cat !== 'airside');
      if (!cands.length) return null;
      const b = withRng(s, (r) => r.weighted(cands, (x) => Math.pow(105 - x.condition, 2)));
      b.brokenFor = inc.endsAt - s.time;
      inc.targetId = b.id;
      invalidateWorld();
      break;
    }
    case 'strike': {
      const cat = withRng(s, (r) => r.weighted(STAFF_CATS.filter((c) => s.staff[c].count > 0), (c) => 105 - s.staff[c].morale));
      if (!cat) return null;
      inc.staffCat = cat;
      s.staff[cat].onStrike = Math.ceil(dur / 1440);
      break;
    }
    case 'earthquake': {
      withRng(s, (r) => {
        for (const b of s.buildings) b.condition = Math.max(5, b.condition - r.range(10, 45));
      });
      const rws = w.runways.filter((r) => w.active.has(r.id));
      if (rws.length) {
        const closure = startIncident(s, 'runway_closure', Math.round(dur * 0.6));
        if (closure) closure.severity = inc.severity;
      }
      break;
    }
  }
  s.incidents.push(inc);
  addLog(s, def.positive ? 'info' : 'bad', 'log.incident', { inc: 'inc.' + type });
  return inc;
}

export function responseCost(s: GameState, inc: Incident): number {
  const def = INCIDENTS[inc.type];
  if (!def.response) return 0;
  if (inc.type === 'strike' && inc.staffCat) {
    const st = s.staff[inc.staffCat];
    return Math.round(st.count * STAFF[inc.staffCat].wage * 6);
  }
  return Math.round(def.response.cost * inc.severity);
}

/** Intervention d'urgence : paie pour raccourcir l'incident. */
export function respond(s: GameState, inc: Incident): boolean {
  const def = INCIDENTS[inc.type];
  if (!def.response || inc.resolved) return false;
  const cost = responseCost(s, inc);
  if (!s.settings.unlimitedMoney && s.finance.cash < cost) return false;
  charge(s, 'incidents', cost);
  if (inc.type === 'strike' && inc.staffCat) {
    const st = s.staff[inc.staffCat];
    st.onStrike = 0;
    st.morale = clamp(st.morale + 25, 0, 100);
    st.wageMult = Math.round((st.wageMult + 0.05) * 100) / 100;
    endIncident(s, inc);
    return true;
  }
  inc.endsAt = Math.round(s.time + (inc.endsAt - s.time) * (1 - def.response.cut));
  inc.resolved = inc.endsAt <= s.time;
  if (inc.type === 'breakdown' && inc.targetId) {
    const b = s.buildings.find((x) => x.id === inc.targetId);
    if (b) {
      b.brokenFor = Math.max(0, inc.endsAt - s.time);
      b.condition = Math.min(100, b.condition + 30);
      invalidateWorld();
    }
  }
  addLog(s, 'good', 'log.responded', { inc: 'inc.' + inc.type });
  return true;
}

function endIncident(s: GameState, inc: Incident) {
  inc.resolved = true;
  inc.endsAt = Math.min(inc.endsAt, s.time);
  if (inc.type === 'strike' && inc.staffCat) s.staff[inc.staffCat].onStrike = 0;
}

/** Tirage horaire des incidents et expiration. */
export function incidentsHourly(s: GameState): void {
  for (const def of INCIDENT_LIST) {
    if (s.incidents.some((i) => i.type === def.id && !i.resolved && i.endsAt > s.time)) continue;
    const p = incidentProbability(s, def) / 24;
    if (p > 0 && withRng(s, (r) => r.chance(p))) startIncident(s, def.id);
  }
}

export function incidentsTick(s: GameState): void {
  for (const inc of s.incidents) {
    if (!inc.resolved && inc.endsAt <= s.time) {
      endIncident(s, inc);
      if (!INCIDENTS[inc.type].positive) addLog(s, 'good', 'log.incidentOver', { inc: 'inc.' + inc.type });
    }
  }
  // Historique limité aux 30 derniers incidents terminés.
  const over = s.incidents.filter((i) => i.resolved);
  if (over.length > 30) {
    const drop = new Set(over.slice(0, over.length - 30).map((i) => i.id));
    s.incidents = s.incidents.filter((i) => !drop.has(i.id));
  }
}

export function activeList(s: GameState): Incident[] {
  return s.incidents.filter((i) => !i.resolved && i.endsAt > s.time && i.startedAt <= s.time);
}

// ---------- Maintenance ----------
export function wearDaily(s: GameState): void {
  const maintEff = Math.min(1.2, staffCoverageMaint(s));
  for (const b of s.buildings) {
    if (b.buildRemaining > 0 || BUILDINGS[b.type].linear) continue;
    const wear = (0.35 + 0.08 * b.level) * Math.max(0.2, 1 + tech(s, 'wear')) * (1.6 / (0.6 + s.maintenanceBudget));
    const repair = maintEff * 0.25 * s.maintenanceBudget;
    b.condition = clamp(b.condition - wear + repair, 0, 100);
  }
}
function staffCoverageMaint(s: GameState): number {
  const c = s.staff.maintenance;
  const need = Math.max(1, s.buildings.filter((b) => !BUILDINGS[b.type].linear).length / 6);
  return (c.count * (c.onStrike > 0 ? 0.3 : 1)) / need;
}

export function repairCost(b: { type: string; condition: number }): number {
  return Math.round(BUILDINGS[b.type].cost * 0.12 * ((100 - b.condition) / 100));
}
export function repair(s: GameState, id: number): boolean {
  const b = s.buildings.find((x) => x.id === id);
  if (!b) return false;
  const cost = repairCost(b);
  if (!s.settings.unlimitedMoney && s.finance.cash < cost) return false;
  charge(s, 'repairs', cost, b);
  b.condition = 100;
  return true;
}

export const STAFF_CATEGORIES: StaffCat[] = STAFF_CATS;
