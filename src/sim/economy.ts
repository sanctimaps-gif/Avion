import { BUILDINGS, levelMult } from '../data/buildings';
import { TIERS } from '../data/tiers';
import { clamp } from '../core/format';
import { addLog } from './log';
import { tech, weatherDef } from './modifiers';
import { getWorld } from './world';
import type { Building, DayRecord, GameState, Ledger, Loan } from './types';

/**
 * Système économique : grand livre quotidien, coûts fixes (entretien,
 * énergie, salaires), emprunts, impôts, historique et indicateurs.
 */

/** Catégories hors compte de résultat (investissement / financement). */
export const CAPEX = new Set(['construction', 'land']);
export const FINANCING_IN = new Set(['loan']);
export const FINANCING_OUT = new Set(['repayment']);

export const STANDARD_FEES = { landing: 9, pax: 14, parking: 12 };
export const ENERGY_PRICE = 2.4; // € par unité et par jour (réseau)
export const OWN_POWER_PRICE = 0.9; // € par unité produite sur place
export const TAX_RATE = 0.25;

export function charge(s: GameState, cat: string, amount: number, b?: Building): void {
  if (amount === 0) return;
  if (!s.settings.unlimitedMoney) s.finance.cash -= amount;
  s.finance.today.expenses[cat] = (s.finance.today.expenses[cat] ?? 0) + amount;
  if (b) b.costToday += amount;
}

export function earn(s: GameState, cat: string, amount: number, b?: Building): void {
  if (amount === 0) return;
  s.finance.cash += amount;
  s.finance.today.revenue[cat] = (s.finance.today.revenue[cat] ?? 0) + amount;
  if (b) b.revenueToday += amount;
}

/** Premier bâtiment opérationnel d'un type donné (pour imputer revenus/coûts). */
export function firstActive(s: GameState, pred: (type: string) => boolean): Building | undefined {
  const w = getWorld(s);
  return s.buildings.find((b) => w.active.has(b.id) && pred(b.type));
}

export function sumLedger(l: Ledger, exclude?: Set<string>): number {
  let t = 0;
  for (const [k, v] of Object.entries(l)) if (!exclude?.has(k)) t += v;
  return t;
}

export function operatingProfit(r: { revenue: Ledger; expenses: Ledger }): number {
  return sumLedger(r.revenue, new Set([...FINANCING_IN, 'sales'])) - sumLedger(r.expenses, new Set([...CAPEX, ...FINANCING_OUT]));
}

export function totalDebt(s: GameState): number {
  return s.finance.loans.reduce((a, l) => a + l.remaining, 0);
}

// ---------- Énergie et entretien ----------
export function energyCostPerDay(s: GameState): number {
  const w = getWorld(s);
  const demand = w.cap.energyDemand * weatherDef(s).energy * Math.max(0.4, 1 + tech(s, 'energy'));
  const own = Math.min(demand, w.cap.power);
  return own * OWN_POWER_PRICE + (demand - own) * ENERGY_PRICE;
}

export function upkeepPerDay(s: GameState, b: Building): number {
  const d = BUILDINGS[b.type];
  if (b.buildRemaining > 0) return 0;
  return d.upkeep * Math.pow(levelMult(b.level), 0.7) * Math.max(0.5, 1 + tech(s, 'upkeep')) * (0.5 + 0.5 * s.maintenanceBudget);
}

/** Coût d'entretien journalier total (mémorisé tant que rien ne change). */
const upkeepMemo = { key: '', total: 0, energy: 0 };
function dailyFixed(s: GameState): { total: number; energy: number } {
  const w = getWorld(s);
  const key = `${s.id}|${w.rev}|${s.maintenanceBudget}|${s.research.done.length}|${s.weather.current.kind}|${s.settings.weather}`;
  if (upkeepMemo.key !== key) {
    let total = 0;
    for (const b of s.buildings) total += upkeepPerDay(s, b);
    upkeepMemo.key = key;
    upkeepMemo.total = total;
    upkeepMemo.energy = energyCostPerDay(s);
  }
  return upkeepMemo;
}

/** Coûts fixes répartis minute par minute (1/1440 du coût journalier). */
export function economyMinute(s: GameState): void {
  const d = dailyFixed(s);
  charge(s, 'upkeep', d.total / 1440);
  charge(s, 'energy', d.energy / 1440);
}

/** Impute l'entretien de la journée à chaque bâtiment (rentabilité). */
function allocateUpkeep(s: GameState): void {
  for (const b of s.buildings) b.costToday += upkeepPerDay(s, b);
}

// ---------- Emprunts ----------
export function maxDebt(s: GameState): number {
  return Math.round((2_000_000 * Math.pow(s.tier + 1, 1.7) * (0.6 + s.reputation / 100)) / 1000) * 1000;
}
export function loanRate(s: GameState): number {
  const ratio = totalDebt(s) / Math.max(1, maxDebt(s));
  return Math.round((3.5 + (100 - s.reputation) / 25 + ratio * 4) * 10) / 10;
}
export function loanPayment(amount: number, ratePct: number, months: number): number {
  const r = ratePct / 100 / 12;
  return r === 0 ? amount / months : (amount * r) / (1 - Math.pow(1 + r, -months));
}
export function takeLoan(s: GameState, amount: number, months: number): Loan | null {
  if (amount <= 0 || totalDebt(s) + amount > maxDebt(s)) return null;
  const rate = loanRate(s);
  const loan: Loan = {
    id: s.finance.nextLoanId++,
    principal: amount,
    remaining: amount,
    ratePct: rate,
    monthlyPayment: Math.round(loanPayment(amount, rate, months)),
    monthsLeft: months,
  };
  s.finance.loans.push(loan);
  earn(s, 'loan', amount);
  addLog(s, 'info', 'log.loan', { amount: Math.round(amount) });
  return loan;
}
export function repayLoan(s: GameState, loan: Loan, amount?: number): boolean {
  const pay = Math.min(amount ?? loan.remaining, loan.remaining);
  if (s.finance.cash < pay) return false;
  charge(s, 'repayment', pay);
  loan.remaining -= pay;
  if (loan.remaining <= 1) s.finance.loans = s.finance.loans.filter((l) => l !== loan);
  else loan.monthlyPayment = Math.round(loanPayment(loan.remaining, loan.ratePct, Math.max(1, loan.monthsLeft)));
  return true;
}

/** Échéances mensuelles : intérêts, remboursement, impôt sur le bénéfice. */
export function monthlyClose(s: GameState): void {
  for (const loan of [...s.finance.loans]) {
    const interest = (loan.remaining * loan.ratePct) / 100 / 12;
    const principal = Math.min(loan.remaining, Math.max(0, loan.monthlyPayment - interest));
    charge(s, 'interest', interest);
    charge(s, 'repayment', principal);
    loan.remaining -= principal;
    loan.monthsLeft--;
    if (loan.remaining <= 1 || loan.monthsLeft <= 0) {
      if (loan.remaining > 1) charge(s, 'repayment', loan.remaining);
      s.finance.loans = s.finance.loans.filter((l) => l !== loan);
    }
  }
  const last30 = s.finance.history.slice(-30);
  const profit = last30.reduce((a, d) => a + operatingProfit(d), 0);
  if (profit > 0) {
    const tax = profit * TAX_RATE;
    charge(s, 'taxes', tax);
    addLog(s, 'info', 'log.tax', { amount: Math.round(tax) });
  }
}

/** Clôture de la journée : enregistrement de l'historique et rentabilité. */
export function dailyClose(s: GameState, record: Omit<DayRecord, 'revenue' | 'expenses' | 'cash' | 'debt'>): void {
  const fin = s.finance;
  const rec: DayRecord = { ...record, revenue: fin.today.revenue, expenses: fin.today.expenses, cash: fin.cash, debt: totalDebt(s) };
  fin.history.push(rec);
  if (fin.history.length > 400) fin.history.splice(0, fin.history.length - 400);
  fin.today = { revenue: {}, expenses: {} };
  allocateUpkeep(s);
  for (const b of s.buildings) {
    b.revenue30 = b.revenue30 * (29 / 30) + b.revenueToday;
    b.cost30 = b.cost30 * (29 / 30) + b.costToday;
    b.revenueToday = 0;
    b.costToday = 0;
  }
  // Faillite : 30 jours consécutifs de trésorerie négative.
  if (!s.settings.unlimitedMoney) {
    if (fin.cash < 0) {
      fin.bankruptcyDays++;
      if (fin.bankruptcyDays === 1 || fin.bankruptcyDays % 7 === 0) addLog(s, 'bad', 'log.negativeCash', { days: 30 - fin.bankruptcyDays });
      if (fin.bankruptcyDays >= 30) s.gameOver = { won: false, key: 'over.bankrupt' };
    } else fin.bankruptcyDays = 0;
  }
}

/** Agrégation des historiques sur une période (jours). */
export function aggregate(s: GameState, days: number) {
  const h = s.finance.history.slice(-days);
  const revenue: Ledger = {};
  const expenses: Ledger = {};
  let pax = 0;
  let movements = 0;
  for (const d of h) {
    for (const [k, v] of Object.entries(d.revenue)) revenue[k] = (revenue[k] ?? 0) + v;
    for (const [k, v] of Object.entries(d.expenses)) expenses[k] = (expenses[k] ?? 0) + v;
    pax += d.pax;
    movements += d.movements;
  }
  return { revenue, expenses, pax, movements, days: h.length, profit: operatingProfit({ revenue, expenses }) };
}

/** Prévision simple : moyenne mobile sur 7 jours projetée. */
export function forecast(s: GameState, days: number): { profit: number; cash: number } {
  const a = aggregate(s, 7);
  const perDay = a.days ? a.profit / a.days : 0;
  const loans = s.finance.loans.reduce((x, l) => x + l.monthlyPayment, 0);
  const net = perDay * days - (loans * days) / 30;
  return { profit: perDay * days, cash: s.finance.cash + net };
}

/** Retour sur investissement annualisé d'un bâtiment (sur 30 jours). */
export function buildingRoi(b: Building): number {
  const yearly = (b.revenue30 - b.cost30) * (365 / 30);
  return b.totalInvested > 0 ? yearly / b.totalInvested : 0;
}

export function maxContracts(s: GameState): number {
  return TIERS[clamp(s.tier, 0, TIERS.length - 1)].maxContracts + Math.floor(getWorld(s).cap.contracts);
}
