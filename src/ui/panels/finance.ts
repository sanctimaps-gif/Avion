import { BUILDINGS } from '../../data/buildings';
import { clamp, money, num, pct } from '../../core/format';
import { t } from '../../core/i18n';
import { aggregate, buildingRoi, CAPEX, energyCostPerDay, FINANCING_IN, FINANCING_OUT, forecast, loanRate, maxDebt, operatingProfit, repayLoan, takeLoan, totalDebt } from '../../sim/economy';
import { dailyWages } from '../../sim/staff';
import { getWorld } from '../../sim/world';
import type { CommerceKind, Ledger } from '../../sim/types';
import type { App } from '../app';
import { sparkline } from '../chart';
import { btn, h, kv, section, tabs } from '../dom';

/** Tableau de bord financier : résultats, emprunts, commerces, rentabilité. */
export function financePanel(app: App): HTMLElement {
  const s = app.s;
  const tab = app.panelTab.finance ?? 'summary';
  const root = h('div');
  root.append(tabs([
    { id: 'summary', label: t('fin.summary') },
    { id: 'pnl', label: t('fin.pnl') },
    { id: 'loans', label: t('fin.loans') },
    { id: 'commerce', label: t('fin.commerce') },
    { id: 'roi', label: t('fin.roi') },
  ], tab, (id) => { app.panelTab.finance = id; app.act(); }));

  if (tab === 'summary') {
    const today = s.finance.today;
    const d7 = aggregate(s, 7);
    const d30 = aggregate(s, 30);
    const f30 = forecast(s, 30);
    const hist = s.finance.history;
    root.append(
      section(t('fin.position'),
        kv(t('fin.cash'), money(s.finance.cash), s.finance.cash < 0 ? 'bad' : ''),
        kv(t('fin.debt'), money(totalDebt(s))),
        kv(t('fin.todayProfit'), money(operatingProfit(today)), operatingProfit(today) < 0 ? 'bad' : 'good'),
        kv(t('fin.profit7'), money(d7.profit), d7.profit < 0 ? 'bad' : 'good'),
        kv(t('fin.profit30'), money(d30.profit), d30.profit < 0 ? 'bad' : 'good'),
        kv(t('fin.forecast30'), money(f30.cash)),
        s.finance.bankruptcyDays > 0 ? kv(t('fin.bankruptcy'), `${30 - s.finance.bankruptcyDays} ${t('ui.days')}`, 'bad') : null),
      section(t('fin.cashChart'), sparkline(hist.slice(-60).map((d) => d.cash), { zero: true })),
      section(t('fin.profitChart'), sparkline(hist.slice(-60).map((d) => operatingProfit(d)), { zero: true, color: '#22c55e' })),
      section(t('fin.fixedCosts'),
        kv(t('exp.wages'), money(dailyWages(s)) + ' / ' + t('ui.dayShort')),
        kv(t('exp.energy'), money(energyCostPerDay(s)) + ' / ' + t('ui.dayShort')),
        kv(t('exp.upkeep'), money(s.buildings.reduce((a, b) => a + BUILDINGS[b.type].upkeep, 0)) + ' / ' + t('ui.dayShort'))),
      maintenanceCard(app),
    );
    return root;
  }

  if (tab === 'pnl') {
    const period = app.panelTab.pnl ?? '1';
    const days = Number(period);
    root.append(h('div', { class: 'seg', style: 'margin-bottom:8px' }, [['0', t('fin.today')], ['1', t('fin.day')], ['7', t('fin.week')], ['30', t('fin.month')], ['360', t('fin.year')]].map(([id, label]) =>
      h('button', { class: period === id ? 'on' : '', onclick: () => { app.panelTab.pnl = id; app.act(); } }, label))));
    const data = days === 0 ? { ...s.finance.today, days: 1, pax: 0, movements: 0, profit: operatingProfit(s.finance.today) } : aggregate(s, days);
    const rev = data.revenue;
    const exp = data.expenses;
    const lines = (l: Ledger, prefix: string, skip: Set<string>) =>
      Object.entries(l).filter(([k, v]) => !skip.has(k) && Math.abs(v) >= 1).sort((a, b) => b[1] - a[1]).map(([k, v]) => kv(t(prefix + k), money(v)));
    const opRev = Object.entries(rev).filter(([k]) => !FINANCING_IN.has(k) && k !== 'sales').reduce((a, [, v]) => a + v, 0);
    const opExp = Object.entries(exp).filter(([k]) => !CAPEX.has(k) && !FINANCING_OUT.has(k)).reduce((a, [, v]) => a + v, 0);
    const fixed = (exp.wages ?? 0) + (exp.upkeep ?? 0) + (exp.energy ?? 0) + (exp.interest ?? 0);
    root.append(
      section(t('fin.revenue'), lines(rev, 'rev.', new Set([...FINANCING_IN, 'sales'])), kv(t('fin.totalRevenue'), money(opRev), 'good')),
      section(t('fin.expenses'), lines(exp, 'exp.', new Set([...CAPEX, ...FINANCING_OUT])), kv(t('fin.totalExpenses'), money(opExp), 'bad')),
      section(t('fin.result'),
        kv(t('fin.operating'), money(opRev - opExp), opRev - opExp < 0 ? 'bad' : 'good'),
        kv(t('fin.fixed'), money(fixed)),
        kv(t('fin.variable'), money(opExp - fixed)),
        kv(t('fin.capex'), money((exp.construction ?? 0) + (exp.land ?? 0))),
        kv(t('fin.financing'), money((rev.loan ?? 0) - (exp.repayment ?? 0))),
        days >= 1 && data.days > 0 ? kv(t('fin.perPax'), data.pax > 0 ? money(opRev / data.pax) : '—') : null),
    );
    if (days >= 1 && data.days < days) root.append(h('p', { class: 'hint' }, t('fin.partial', { n: data.days })));
    return root;
  }

  if (tab === 'loans') {
    const max = maxDebt(s);
    const avail = Math.max(0, max - totalDebt(s));
    const rate = loanRate(s);
    let amount = Math.min(avail, Math.round(avail / 2 / 50_000) * 50_000);
    let months = 60;
    const amountLbl = h('b', null, money(amount));
    const range = h('input', { type: 'range', min: 0, max: Math.max(50_000, avail), step: 50_000, value: amount });
    range.addEventListener('input', () => { amount = Number(range.value); amountLbl.textContent = money(amount); });
    const monthsSel = h('select', null, [24, 60, 120].map((m) => h('option', { value: m, selected: m === months }, `${m} ${t('ui.months')}`)));
    monthsSel.addEventListener('change', () => (months = Number(monthsSel.value)));
    root.append(section(t('fin.newLoan'),
      kv(t('fin.capacity'), money(avail)),
      kv(t('fin.rate'), `${rate} %`),
      h('div', { class: 'row' }, h('span', { class: 'grow' }, t('fin.amount')), amountLbl), range,
      h('label', { class: 'field' }, h('span', null, t('fin.duration')), monthsSel),
      btn(t('fin.borrow'), () => { if (amount > 0 && takeLoan(s, amount, months)) app.toast(t('fin.borrowed'), 'good'); else app.toast(t('fin.loanRefused'), 'bad'); app.act(); }, 'primary', avail <= 0),
      h('p', { class: 'hint' }, t('fin.loanHint'))));
    const list = section(t('fin.loans'));
    if (!s.finance.loans.length) list.append(h('p', { class: 'hint' }, t('fin.noLoans')));
    for (const l of s.finance.loans) {
      list.append(h('div', { class: 'card' },
        kv(t('fin.remaining'), money(l.remaining)),
        kv(t('fin.rate'), `${l.ratePct} %`),
        kv(t('fin.monthly'), money(l.monthlyPayment)),
        kv(t('fin.monthsLeft'), String(l.monthsLeft)),
        h('div', { class: 'row' },
          btn(t('fin.repay100k'), () => { if (!repayLoan(s, l, 100_000)) app.toast(t('pb.money'), 'bad'); app.act(); }, 'sm', s.finance.cash < Math.min(100_000, l.remaining)),
          btn(t('fin.repayAll'), () => { if (!repayLoan(s, l)) app.toast(t('pb.money'), 'bad'); app.act(); }, 'sm', s.finance.cash < l.remaining))));
    }
    root.append(list);
    return root;
  }

  if (tab === 'commerce') {
    const w = getWorld(s);
    const kinds: CommerceKind[] = ['cafe', 'restaurant', 'shop', 'dutyfree', 'lounge', 'ads', 'hotel', 'parking', 'transport', 'rental'];
    const d30 = aggregate(s, 30);
    root.append(kv(t('fin.commerceRev30'), money((d30.revenue.commerce ?? 0) + (d30.revenue.rent ?? 0) + (d30.revenue.parking ?? 0))));
    for (const k of kinds) {
      const c = w.cap.commerce[k];
      const used = s.pax.today.use[k] ?? 0;
      root.append(h('div', { class: 'card' + (c ? '' : ' locked') },
        h('h4', null, t('com.' + k), c ? h('span', { class: 'tag' }, `×${c.count}`) : h('span', { class: 'tag warn' }, t('com.none'))),
        c && k !== 'parking' ? h('div', { class: 'meta' }, t('com.usage', { used: num(used), cap: num(c.capacity) })) : null,
        k === 'parking' ? h('div', { class: 'meta' }, t('com.parkingUse', { cars: num(s.pax.parkedCars), cap: num(w.cap.parking) })) : null,
        k !== 'parking' ? h('div', { class: 'seg', style: 'margin:6px 0' }, [0, 1, 2].map((lvl) =>
          h('button', { class: s.commerce.price[k] === lvl ? 'on' : '', onclick: () => { s.commerce.price[k] = lvl; app.act(); } }, t('price.' + lvl)))) : null,
        h('div', { class: 'seg' },
          h('button', { class: !s.commerce.lease[k] ? 'on' : '', onclick: () => { s.commerce.lease[k] = false; app.act(); } }, t('com.direct')),
          h('button', { class: s.commerce.lease[k] ? 'on' : '', onclick: () => { s.commerce.lease[k] = true; app.act(); } }, t('com.lease')))));
    }
    root.append(h('p', { class: 'hint' }, t('com.hint')));
    return root;
  }

  // Rentabilité par infrastructure
  const list = s.buildings.filter((b) => !BUILDINGS[b.type].linear && (b.revenue30 > 0 || b.cost30 > 0)).sort((a, b) => buildingRoi(b) - buildingRoi(a));
  root.append(h('table', { class: 'board' },
    h('tr', null, h('th', null, t('fin.building')), h('th', null, t('fin.net30')), h('th', null, 'ROI')),
    list.map((b) => {
      const net = b.revenue30 - b.cost30;
      return h('tr', { class: 'click', onclick: () => { app.selectedBuilding = b.id; app.openPanel('selection'); } },
        h('td', null, t('b.' + b.type)),
        h('td', { class: net < 0 ? 'bad' : 'good' }, money(net)),
        h('td', { class: buildingRoi(b) < 0 ? 'bad' : 'good' }, pct(clamp(buildingRoi(b), -9.99, 9.99))));
    })));
  root.append(h('p', { class: 'hint' }, t('fin.roiHint')));
  return root;
}

function maintenanceCard(app: App): HTMLElement {
  const s = app.s;
  const lbl = h('b', null, pct(s.maintenanceBudget));
  const r = h('input', { type: 'range', min: 0.5, max: 2, step: 0.1, value: s.maintenanceBudget });
  r.addEventListener('input', () => { s.maintenanceBudget = Number(r.value); lbl.textContent = pct(s.maintenanceBudget); });
  r.addEventListener('change', () => app.act());
  return section(t('fin.maintenance'), h('div', { class: 'row' }, h('span', { class: 'grow' }, t('fin.maintBudget')), lbl), r, h('p', { class: 'hint' }, t('fin.maintHint')));
}
