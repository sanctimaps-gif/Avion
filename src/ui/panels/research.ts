import { BRANCHES, TECH_LIST, TECHS } from '../../data/research';
import { money } from '../../core/format';
import { t } from '../../core/i18n';
import { canResearch, researchSlots, researchSpeed, startResearch } from '../../sim/research';
import type { App } from '../app';
import { bar, btn, h, section } from '../dom';

/** Recherche & développement : arbre technologique par branche. */
export function researchPanel(app: App): HTMLElement {
  const s = app.s;
  const root = h('div');
  root.append(h('p', { class: 'hint' }, t('res.hint', { slots: researchSlots(s), speed: researchSpeed(s).toFixed(1) })));
  if (s.research.active.length) {
    root.append(section(t('res.active'), s.research.active.map((a) => h('div', { class: 'card' },
      h('h4', null, '🔬', t('tech.' + a.id)),
      bar(a.progress / TECHS[a.id].days),
      h('div', { class: 'meta' }, `${Math.min(TECHS[a.id].days, Math.floor(a.progress))} / ${TECHS[a.id].days} ${t('ui.days')}`)))));
  }
  for (const br of BRANCHES) {
    const techs = TECH_LIST.filter((x) => x.branch === br);
    root.append(section(t('branch.' + br), techs.map((tech) => {
      const done = s.research.done.includes(tech.id);
      const err = canResearch(s, tech.id);
      return h('div', { class: 'card' + (done ? ' sel' : err && err.startsWith('lock') ? ' locked' : '') },
        h('h4', null, done ? '✅' : '🧪', t('tech.' + tech.id)),
        h('div', { class: 'meta' }, t('techd.' + tech.id)),
        h('div', { class: 'meta' }, `${money(tech.cost)} · ${tech.days} ${t('ui.days')}${tech.requires.length ? ' · ' + t('res.requires') + ' ' + tech.requires.map((r) => t('tech.' + r)).join(', ') : ''}`),
        !done ? btn(err ? t(err) : t('res.start'), () => { if (startResearch(s, tech.id)) app.toast(t('res.started'), 'good'); app.act(); }, err ? 'sm' : 'primary sm', !!err) : null);
    })));
  }
  return root;
}
