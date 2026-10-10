import { BUILDING_LIST, BUILD_CATS, footprint } from '../../data/buildings';
import { TECHS } from '../../data/research';
import { money, num } from '../../core/format';
import { t } from '../../core/i18n';
import { isUnlocked, lockReason, parcelPrice } from '../../sim/construction';
import type { App } from '../app';
import { GLYPH } from '../../render/common';
import { h, tabs } from '../dom';

/** Menu de construction par catégories + outils (terrain). */
export function buildPanel(app: App): HTMLElement {
  const s = app.s;
  const cat = app.panelTab.build ?? 'airside';
  const root = h('div');
  root.append(tabs([...BUILD_CATS.map((c) => ({ id: c, label: t('cat.' + c) })), { id: 'tools', label: t('cat.tools') }], cat, (id) => { app.panelTab.build = id; app.act(); }));
  if (cat === 'tools') {
    root.append(
      h('div', { class: 'card build-item', onclick: () => app.startParcelMode() }, h('h4', null, h('span', { class: 'ic' }, '🗺️'), t('land.title')), h('div', { class: 'meta' }, t('land.desc', { price: money(parcelPrice(s)) }))),
      h('p', { class: 'hint' }, t('build.toolsHint')),
    );
    return root;
  }
  const grid = h('div', { class: 'grid2' });
  for (const d of BUILDING_LIST.filter((x) => x.cat === cat)) {
    const unlocked = isUnlocked(s, d);
    const reason = lockReason(s, d);
    const f = footprint(d, 0);
    const caps: string[] = [];
    if (d.runwayLength) caps.push(`${num(d.runwayLength)} m`);
    if (d.standSize) caps.push(t('build.standSize', { s: d.standSize }));
    if (d.checkin) caps.push(t('build.capH', { n: d.checkin }));
    if (d.security) caps.push(t('build.capH', { n: d.security }));
    if (d.baggage) caps.push(t('build.capH', { n: d.baggage }));
    if (d.gates) caps.push(t('build.gates', { n: d.gates }));
    if (d.parking) caps.push(t('build.spaces', { n: d.parking }));
    if (d.power) caps.push(`⚡ ${d.power}`);
    grid.append(
      h('div', { class: 'card build-item' + (unlocked ? '' : ' locked'), onclick: () => { if (unlocked) app.startPlacement(d.id); else app.toast(lockText(d.tier, d.tech, reason), 'warn'); } },
        h('h4', null, h('span', { class: 'ic' }, GLYPH[d.id] || (d.linear ? '▦' : '■')), t('b.' + d.id)),
        h('div', { class: 'meta' }, `${money(d.cost)}${d.linear ? ' / ' + t('build.tile') : ''} · ${f.w}×${f.h}`),
        h('div', { class: 'meta' }, caps.join(' · ')),
        h('div', { class: 'meta small' }, t('bd.' + d.id)),
        !unlocked ? h('div', { class: 'meta warn' }, '🔒 ' + lockText(d.tier, d.tech, reason)) : null,
      ),
    );
  }
  root.append(grid);
  return root;
}

function lockText(tier: number, tech: string | undefined, reason: string | null): string {
  if (reason === 'lock.tech' && tech && TECHS[tech]) return t('lock.techName', { tech: t('tech.' + tech) });
  return t('lock.tierName', { tier: t('tier.' + tier) });
}
