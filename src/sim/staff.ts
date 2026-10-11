import { BUILDINGS, levelMult } from '../data/buildings';
import { STAFF, shiftFactor } from '../data/staff';
import { clamp } from '../core/format';
import { getWorld } from './world';
import { tech, weatherDef } from './modifiers';
import { charge } from './economy';
import { STAFF_CATS, type GameState, type StaffCat } from './types';

/** Rotations quotidiennes programmées (somme des créneaux des contrats actifs). */
export function dailyRotations(s: GameState): number {
  let n = 0;
  for (const c of s.contracts) n += c.slots.length;
  return n;
}

/** Effectif requis pour une catégorie (mémorisé par minute de jeu et état des infrastructures). */
const reqMemo = { s: null as GameState | null, rev: -1, rot: -1, tech: -1, wx: '', vals: {} as Partial<Record<StaffCat, number>> };
export function staffRequired(s: GameState, cat: StaffCat): number {
  const w = getWorld(s);
  const rot = dailyRotations(s);
  const wx = s.settings.weather ? s.weather.current.kind : 'clear';
  const m = reqMemo;
  if (m.s !== s || m.rev !== w.rev || m.rot !== rot || m.tech !== s.research.done.length || m.wx !== wx) {
    m.s = s;
    m.rev = w.rev;
    m.rot = rot;
    m.tech = s.research.done.length;
    m.wx = wx;
    m.vals = {};
  }
  const hit = reqMemo.vals[cat];
  if (hit !== undefined) return hit;
  const v = computeRequired(s, cat);
  reqMemo.vals[cat] = v;
  return v;
}

function computeRequired(s: GameState, cat: StaffCat): number {
  const w = getWorld(s);
  let req = STAFF[cat].base + (STAFF[cat].perRotations * dailyRotations(s)) / 10;
  for (const b of s.buildings) {
    if (!w.active.has(b.id)) continue;
    const need = BUILDINGS[b.type].staff?.[cat];
    if (need) req += need * Math.sqrt(levelMult(b.level));
  }
  const reduce = tech(s, 'staffNeed_' + cat) + tech(s, 'staffNeed_all');
  req *= Math.max(0.3, 1 + reduce);
  req *= 1 + weatherDef(s).staffLoad;
  return Math.ceil(req);
}

/** Effectif présent à une heure donnée (planning + grève). */
export function staffAvailable(s: GameState, cat: StaffCat, hour: number): number {
  const st = s.staff[cat];
  let n = st.count * shiftFactor(st.shift, hour);
  if (st.onStrike > 0) n *= 0.3;
  return n;
}

/** Efficacité 0..~1,3 d'une catégorie : couverture × compétence × moral. */
export function staffEfficiency(s: GameState, cat: StaffCat, hour?: number): number {
  const h = hour ?? Math.floor((s.time % 1440) / 60);
  const req = staffRequired(s, cat);
  const avail = staffAvailable(s, cat, h);
  const coverage = req <= 0 ? 1.1 : avail / req;
  const st = s.staff[cat];
  const skill = 0.85 + 0.075 * st.skill;
  const morale = 0.8 + 0.4 * (st.morale / 100);
  return clamp(Math.pow(clamp(coverage, 0, 1.15), 0.85) * skill * morale, 0, 1.4);
}

export function staffCoverage(s: GameState, cat: StaffCat): number {
  const req = staffRequired(s, cat);
  return req <= 0 ? 1 : s.staff[cat].count / req;
}

export function dailyWages(s: GameState): number {
  let total = 0;
  for (const c of STAFF_CATS) total += s.staff[c].count * STAFF[c].wage * s.staff[c].wageMult;
  return total;
}

/** Mise à jour quotidienne : moral, formation, grèves. */
export function staffDaily(s: GameState): void {
  for (const c of STAFF_CATS) {
    const st = s.staff[c];
    const cov = staffCoverage(s, c);
    let target = 60 + (st.wageMult - 1) * 120 + (cov >= 1 ? 10 : -35 * (1 - cov)) + getWorld(s).cap.staffMorale;
    target = clamp(target, 5, 100);
    st.morale += (target - st.morale) * 0.25;
    if (st.training > 0) {
      st.training--;
      if (st.training === 0) st.skill = Math.min(5, Math.floor(st.skill + 1e-6) + 1);
    }
    if (st.onStrike > 0) st.onStrike = Math.max(0, st.onStrike - 1);
  }
}

export function hire(s: GameState, cat: StaffCat, n: number): boolean {
  const cost = STAFF[cat].hireCost * n;
  if (n > 0 && s.finance.cash < cost && !s.settings.unlimitedMoney) return false;
  const st = s.staff[cat];
  if (n < 0) {
    const fire = Math.min(st.count, -n);
    st.count -= fire;
    st.morale = Math.max(0, st.morale - 4 * fire);
    charge(s, 'hiring', STAFF[cat].wage * 10 * fire);
    return fire > 0;
  }
  charge(s, 'hiring', cost);
  // Les nouvelles recrues diluent le niveau moyen de compétence.
  st.skill = (st.skill * st.count + 1 * n) / (st.count + n);
  st.count += n;
  return true;
}

export function trainingCost(s: GameState, cat: StaffCat): number {
  const st = s.staff[cat];
  return Math.round(STAFF[cat].trainCost * st.count * Math.max(1, Math.floor(st.skill)));
}
export function startTraining(s: GameState, cat: StaffCat): boolean {
  if (!canTrain(s, cat)) return false;
  const cost = trainingCost(s, cat);
  if (!s.settings.unlimitedMoney && s.finance.cash < cost) return false;
  charge(s, 'training', cost);
  s.staff[cat].training = trainingDays(s);
  return true;
}
export function trainingDays(s: GameState): number {
  return getWorld(s).cap.training > 0 ? 3 : 6;
}
export function canTrain(s: GameState, cat: StaffCat): boolean {
  const st = s.staff[cat];
  const max = getWorld(s).cap.training > 0 ? 5 : 3;
  return st.training === 0 && st.skill < max - 0.01 && st.count > 0;
}
