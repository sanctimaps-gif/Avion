import { AIRCRAFT } from '../../data/aircraft';
import { AIRLINES, AIRLINE_LIST } from '../../data/airlines';
import { DESTINATIONS } from '../../data/destinations';
import { clock, money, num } from '../../core/format';
import { t } from '../../core/i18n';
import { acceptOffer, airlineState, cancelContract, cancelPenalty, dedicatedCost, grantDedicated, longestRunway, negotiate, rejectOffer, shiftSlot } from '../../sim/airlines';
import { maxContracts, STANDARD_FEES } from '../../sim/economy';
import { loadFactor } from '../../sim/flights';
import { getWorld } from '../../sim/world';
import { fits } from '../../data/aircraft';
import type { App } from '../app';
import { bar, btn, h, kv, section, tabs } from '../dom';

/** Compagnies aériennes : offres, contrats, relations, redevances. */
export function airlinesPanel(app: App): HTMLElement {
  const s = app.s;
  const tab = app.panelTab.airlines ?? 'offers';
  const root = h('div');
  root.append(tabs([
    { id: 'offers', label: `${t('al.offers')} (${s.offers.length})` },
    { id: 'contracts', label: `${t('al.contracts')} (${s.contracts.length}/${maxContracts(s)})` },
    { id: 'airlines', label: t('al.companies') },
    { id: 'fees', label: t('al.fees') },
  ], tab, (id) => { app.panelTab.airlines = id; app.act(); }));
  const w = getWorld(s);
  const maxRw = longestRunway(s);

  if (tab === 'offers') {
    if (!s.offers.length) root.append(h('p', { class: 'hint' }, t('al.noOffers')));
    for (const o of s.offers) {
      const al = AIRLINES[o.airlineId];
      const ac = AIRCRAFT[o.aircraft];
      const dest = DESTINATIONS[o.destId];
      const standOk = w.stands.some((st) => st.reachable && fits(st.size, ac.size));
      const rwOk = maxRw >= ac.minRunway;
      root.append(h('div', { class: 'card' },
        h('h4', null, h('span', { style: `color:${al.color}` }, '■'), `${al.name} → ${dest.city}`),
        h('div', { class: 'meta' }, `${ac.name} (${ac.seats} ${t('ui.seats')}, ${ac.size}) · ${t('al.rotations', { n: o.rotations })} · ${o.durationDays} ${t('ui.days')}`),
        h('div', { class: 'meta' }, `${t('al.slots')}: ${o.slots.map((x) => clock(x)).join(', ')}`),
        h('div', { class: 'meta' }, `${t('al.discount')}: ${Math.round(o.feeDiscount * 100)} % · ${t('al.minOnTime')}: ${o.minOnTime} %${o.signingBonus ? ' · ' + t('al.bonus') + ' ' + money(o.signingBonus) : ''}`),
        h('div', { class: 'meta' }, `${t('al.profile')}: ${t('profile.' + al.profile)} · ${t('al.expires')} ${o.expiresDay - Math.floor(s.time / 1440)} ${t('ui.days')}`),
        !rwOk ? h('div', { class: 'meta bad' }, t('al.needRunway', { m: num(ac.minRunway) })) : null,
        !standOk ? h('div', { class: 'meta warn' }, t('al.needStand', { s: ac.size })) : null,
        h('div', { class: 'row', style: 'margin-top:8px' },
          btn(t('al.accept'), () => { const err = acceptOffer(s, o); if (err) app.toast(t(err), 'bad'); app.act(); }, 'primary sm', s.contracts.length >= maxContracts(s)),
          btn(t('al.negDiscount'), () => { const r = negotiate(s, o, 'discount'); app.toast(t('neg.' + r), r === 'ok' ? 'good' : 'warn'); app.act(); }, 'sm', o.negotiated >= 2 || o.feeDiscount <= 0),
          btn(t('al.negRotation'), () => { const r = negotiate(s, o, 'rotation'); app.toast(t('neg.' + r), r === 'ok' ? 'good' : 'warn'); app.act(); }, 'sm', o.negotiated >= 2),
          btn(t('al.reject'), () => { rejectOffer(s, o); app.act(); }, 'danger sm'))));
    }
    root.append(h('p', { class: 'hint' }, t('al.offersHint')));
    return root;
  }

  if (tab === 'contracts') {
    if (!s.contracts.length) root.append(h('p', { class: 'hint' }, t('al.noContracts')));
    for (const c of s.contracts) {
      const al = AIRLINES[c.airlineId];
      const ac = AIRCRAFT[c.aircraft];
      const st = airlineState(s, c.airlineId);
      const done = c.stats.onTime + c.stats.delayed + c.stats.cancelled + c.stats.diverted;
      const ot = done ? Math.round((c.stats.onTime / done) * 100) : 100;
      const day = Math.floor(s.time / 1440);
      root.append(h('div', { class: 'card' },
        h('h4', null, h('span', { style: `color:${al.color}` }, '■'), `${al.name} → ${DESTINATIONS[c.destId].city}`, c.dedicated ? h('span', { class: 'tag good' }, t('al.dedicated')) : null),
        h('div', { class: 'meta' }, `${ac.name} · ${t('al.rotations', { n: c.slots.length })} · ${t('al.loadFactor')} ${Math.round(loadFactor(s, c) * 100)} %`),
        kv(t('al.onTime'), `${ot} % (${t('al.min')} ${c.minOnTime} %)`, ot < c.minOnTime ? 'bad' : 'good'),
        kv(t('al.flights'), `${done} · ${c.stats.delayed} ${t('al.delayedShort')} · ${c.stats.cancelled + c.stats.diverted} ${t('al.lostShort')}`),
        kv(t('al.ends'), day >= c.startDay ? `${c.endDay - day} ${t('ui.days')}` : t('al.startsTomorrow')),
        kv(t('al.satisfaction'), `${Math.round(st.satisfaction)}`),
        h('div', { class: 'meta', style: 'margin:6px 0 4px' }, t('al.schedule')),
        h('div', { class: 'row' }, c.slots.map((x, i) => h('div', { class: 'row', style: 'gap:2px' },
          btn('−', () => { shiftSlot(s, c, i, -30); app.act(); }, 'sm'),
          h('span', { class: 'mono', style: 'min-width:46px;text-align:center' }, clock(x)),
          btn('+', () => { shiftSlot(s, c, i, 30); app.act(); }, 'sm')))),
        h('div', { class: 'row', style: 'margin-top:8px' },
          btn(t('al.giveDedicated', { cost: money(dedicatedCost(c)) }), () => { if (!grantDedicated(s, c)) app.toast(t('pb.money'), 'bad'); app.act(); }, 'sm', c.dedicated),
          btn(t('al.cancel'), () => app.confirm(t('al.cancelConfirm', { cost: money(cancelPenalty(c)) }), () => cancelContract(s, c), t('al.cancel'), true), 'danger sm'))));
    }
    return root;
  }

  if (tab === 'airlines') {
    for (const al of AIRLINE_LIST) {
      const st = airlineState(s, al.id);
      const locked = al.tier > s.tier && !s.settings.allUnlocked;
      const n = s.contracts.filter((c) => c.airlineId === al.id).length;
      root.append(h('div', { class: 'card' + (locked ? ' locked' : '') },
        h('h4', null, h('span', { style: `color:${al.color}` }, '■'), al.name, h('span', { class: 'tag' }, t('profile.' + al.profile))),
        h('div', { class: 'meta' }, `${t('al.fleet')}: ${al.fleet.map((f) => AIRCRAFT[f].name).join(', ')}`),
        locked ? h('div', { class: 'meta warn' }, '🔒 ' + t('lock.tierName', { tier: t('tier.' + al.tier) })) : null,
        kv(t('al.contracts'), String(n)),
        h('div', { class: 'meta' }, t('al.satisfaction')), bar(st.satisfaction / 100, st.satisfaction < 40 ? 'var(--bad)' : undefined),
        h('div', { class: 'meta' }, t('al.relation')), bar(st.relation / 100),
        kv(t('al.sensitivity'), al.feeSens > 0.7 ? t('ui.high') : al.feeSens > 0.4 ? t('ui.medium') : t('ui.low'))));
    }
    return root;
  }

  // Redevances aéroportuaires
  const fees = s.finance.fees;
  const slider = (key: 'landing' | 'pax' | 'parking', min: number, max: number, step: number, unit: string) => {
    const val = h('b', null, `${fees[key]} ${unit}`);
    const input = h('input', { type: 'range', min, max, step, value: fees[key] });
    input.addEventListener('input', () => {
      fees[key] = Number(input.value);
      val.textContent = `${fees[key]} ${unit}`;
    });
    input.addEventListener('change', () => app.act());
    return h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'grow' }, t('fee.' + key)), val), input,
      h('div', { class: 'meta' }, t('fee.standard', { v: STANDARD_FEES[key], unit })));
  };
  root.append(section(t('al.fees'),
    slider('landing', 3, 25, 0.5, '€/t'),
    slider('pax', 4, 40, 1, '€/pax'),
    slider('parking', 0, 40, 1, '€/j'),
    h('p', { class: 'hint' }, t('fee.hint'))));
  return root;
}
