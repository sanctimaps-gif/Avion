import { STAFF } from '../../data/staff';
import { money, num, pct } from '../../core/format';
import { t } from '../../core/i18n';
import { canTrain, hire, staffEfficiency, staffRequired, startTraining, trainingCost, trainingDays } from '../../sim/staff';
import { STAFF_CATS } from '../../sim/types';
import type { App } from '../app';
import { bar, btn, h, kv } from '../dom';

/** Personnel : recrutement, planning, salaires, formation. */
export function staffPanel(app: App): HTMLElement {
  const s = app.s;
  const root = h('div');
  let total = 0;
  for (const c of STAFF_CATS) total += s.staff[c].count;
  root.append(h('p', { class: 'hint' }, t('staff.total', { n: total }) + ' · ' + t('staff.hint')));
  for (const cat of STAFF_CATS) {
    const st = s.staff[cat];
    const req = staffRequired(s, cat);
    const eff = staffEfficiency(s, cat, 12);
    const cov = req > 0 ? st.count / req : 1;
    const shiftSeg = h('div', { class: 'seg', style: 'margin:6px 0' }, (['balanced', 'day', 'night'] as const).map((sh) =>
      h('button', { class: st.shift === sh ? 'on' : '', onclick: () => { st.shift = sh; app.act(); } }, t('shift.' + sh))));
    const wageLbl = h('b', null, pct(st.wageMult));
    const wage = h('input', { type: 'range', min: 0.8, max: 1.5, step: 0.05, value: st.wageMult });
    wage.addEventListener('input', () => { st.wageMult = Number(wage.value); wageLbl.textContent = pct(st.wageMult); });
    wage.addEventListener('change', () => app.act());
    root.append(h('div', { class: 'card' },
      h('h4', null, t('staff.' + cat), st.onStrike > 0 ? h('span', { class: 'tag bad' }, t('staff.strike')) : null, st.training > 0 ? h('span', { class: 'tag' }, t('staff.training', { d: st.training })) : null),
      h('div', { class: 'row' },
        h('span', { class: 'grow' }, `${st.count} / ${req} ${t('staff.needed')}`),
        btn('−1', () => { hire(s, cat, -1); app.act(); }, 'sm', st.count <= 0),
        btn('+1', () => { if (!hire(s, cat, 1)) app.toast(t('pb.money'), 'bad'); app.act(); }, 'sm'),
        btn('+5', () => { if (!hire(s, cat, 5)) app.toast(t('pb.money'), 'bad'); app.act(); }, 'sm')),
      bar(Math.min(1, cov), cov < 0.9 ? 'var(--bad)' : cov < 1 ? 'var(--warn)' : 'var(--good)'),
      kv(t('staff.efficiency'), pct(eff), eff < 0.8 ? 'bad' : eff < 0.95 ? 'warn' : 'good'),
      kv(t('staff.skill'), `${num(st.skill, 1)} / 5`),
      kv(t('staff.morale'), `${Math.round(st.morale)}`, st.morale < 40 ? 'bad' : ''),
      kv(t('staff.cost'), `${money(STAFF[cat].wage * st.wageMult)} / ${t('ui.dayShort')} · ${t('staff.hireCost')} ${money(STAFF[cat].hireCost)}`),
      h('div', { class: 'meta' }, t('staff.shift')), shiftSeg,
      h('div', { class: 'row' }, h('span', { class: 'grow' }, t('staff.wage')), wageLbl), wage,
      btn(t('staff.train', { cost: money(trainingCost(s, cat)), d: trainingDays(s) }), () => { if (!startTraining(s, cat)) app.toast(t('staff.cantTrain'), 'bad'); app.act(); }, 'sm', !canTrain(s, cat)),
      h('div', { class: 'meta small' }, t('staffd.' + cat))));
  }
  return root;
}
