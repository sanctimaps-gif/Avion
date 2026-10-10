import { BUILDINGS } from '../../data/buildings';
import { INCIDENTS } from '../../data/incidents';
import { WEATHER, WEATHER_ICON } from '../../data/weather';
import { clock, money } from '../../core/format';
import { t } from '../../core/i18n';
import { activeList, repair, repairCost, respond, responseCost } from '../../sim/incidents';
import { runwayStatus } from '../../sim/flights';
import { forecastSummary } from '../../sim/weather';
import { bFootprint, getWorld } from '../../sim/world';
import type { App } from '../app';
import { bar, btn, h, kv, section, tabs } from '../dom';

/** Centre de contrôle des incidents : crises, météo, diagnostic, maintenance. */
export function incidentsPanel(app: App): HTMLElement {
  const s = app.s;
  const tab = app.panelTab.incidents ?? 'active';
  const root = h('div');
  const w = getWorld(s);
  root.append(tabs([
    { id: 'active', label: `${t('inc.active')} (${activeList(s).length})` },
    { id: 'weather', label: t('inc.weather') },
    { id: 'diag', label: `${t('inc.diag')} (${w.problems.size})` },
    { id: 'maint', label: t('inc.maint') },
  ], tab, (id) => { app.panelTab.incidents = id; app.act(); }));

  if (tab === 'active') {
    const list = activeList(s);
    if (!list.length) root.append(h('p', { class: 'hint' }, t('inc.none')));
    for (const inc of list) {
      const def = INCIDENTS[inc.type];
      const left = Math.max(0, inc.endsAt - s.time);
      const target = inc.targetId ? w.byId.get(inc.targetId) : undefined;
      const cost = responseCost(s, inc);
      root.append(h('div', { class: 'card' },
        h('h4', null, def.positive ? '📈' : '🚨', t('inc.' + inc.type)),
        h('div', { class: 'meta' }, t('incd.' + inc.type)),
        target ? kv(t('inc.target'), t('b.' + target.type)) : null,
        inc.staffCat ? kv(t('inc.target'), t('staff.' + inc.staffCat)) : null,
        kv(t('inc.remaining'), left > 1440 ? `${Math.ceil(left / 1440)} ${t('ui.days')}` : `${Math.floor(left / 60)} h ${left % 60} min`),
        def.response ? btn(t(inc.type === 'strike' ? 'inc.negotiate' : 'inc.respond', { cost: money(cost) }), () => { if (!respond(s, inc)) app.toast(t('pb.money'), 'bad'); app.act(); }, 'primary sm') : null,
        target ? btn(t('ui.locate'), () => { const f = bFootprint(target); app.centerOn(target.x + f.w / 2, target.y + f.h / 2); }, 'sm') : null));
    }
    const past = s.incidents.filter((i) => i.resolved).slice(-8).reverse();
    if (past.length) root.append(section(t('inc.history'), past.map((i) => kv(t('inc.' + i.type), clock(i.startedAt % 1440)))));
    return root;
  }

  if (tab === 'weather') {
    const cur = s.weather.current;
    const def = WEATHER[cur.kind];
    root.append(section(t('inc.now'),
      h('div', { class: 'card' },
        h('h4', null, WEATHER_ICON[cur.kind], t('w.' + cur.kind), ` · ${Math.round(cur.temp)}°C`),
        kv(t('w.wind'), `${cur.wind} kt · ${cur.windDir}°`),
        kv(t('w.runwayCap'), `${Math.round(def.runwayCap * 100)} %`),
        kv(t('w.visibility'), `${Math.round(def.visibility * 100)} %`),
        def.needsDeicing ? kv(t('w.deicing'), w.cap.deicing > 0 ? t('w.equipped') : t('w.missing'), w.cap.deicing > 0 ? 'good' : 'bad') : null,
        def.needsSnow ? kv(t('w.snowRemoval'), w.cap.snow > 0 ? t('w.equipped') : t('w.missing'), w.cap.snow > 0 ? 'good' : 'bad') : null,
        !s.settings.weather ? h('p', { class: 'hint' }, t('w.disabled')) : null)));
    const fc = forecastSummary(s, 24);
    const hour0 = Math.floor((s.time % 1440) / 60);
    root.append(section(t('inc.forecast'), h('table', { class: 'board' },
      h('tr', null, h('th', null, t('fl.time')), h('th', null, ''), h('th', null, '°C'), h('th', null, t('w.wind'))),
      fc.filter((_, i) => i % 2 === 0).map((x, i) => h('tr', null,
        h('td', null, `${String((hour0 + 1 + i * 2) % 24).padStart(2, '0')}:00`),
        h('td', null, `${WEATHER_ICON[x.kind]} ${t('w.' + x.kind)}`),
        h('td', null, String(Math.round(x.temp))),
        h('td', null, `${x.wind} kt`))))));
    return root;
  }

  if (tab === 'diag') {
    if (!w.problems.size) root.append(h('p', { class: 'hint good' }, t('inc.noProblems')));
    for (const [id, key] of w.problems) {
      const b = w.byId.get(id);
      if (!b) continue;
      root.append(h('div', { class: 'card' },
        h('h4', null, '⚠️', t('b.' + b.type)),
        h('div', { class: 'meta' }, t(key)),
        h('div', { class: 'meta small' }, t(key + '.fix')),
        btn(t('ui.locate'), () => { const f = bFootprint(b); app.centerOn(b.x + f.w / 2, b.y + f.h / 2); app.selectedBuilding = b.id; app.openPanel('selection'); }, 'sm')));
    }
    root.append(section(t('fl.runways'), w.runways.map((r) => {
      const st = runwayStatus(s, w, r);
      return kv(`${t('b.' + w.byId.get(r.id)!.type)} #${r.id}`, st ? t(st) : t('rw.open'), st ? 'bad' : 'good');
    })));
    return root;
  }

  // Maintenance préventive
  const list = s.buildings.filter((b) => !BUILDINGS[b.type].linear && b.buildRemaining <= 0).sort((a, b) => a.condition - b.condition).slice(0, 25);
  root.append(h('p', { class: 'hint' }, t('inc.maintHint')));
  for (const b of list) {
    const c = repairCost(b);
    root.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, t('b.' + b.type)), h('span', { class: b.condition < 40 ? 'bad' : b.condition < 70 ? 'warn' : 'good' }, `${Math.round(b.condition)} %`)),
      bar(b.condition / 100, b.condition < 40 ? 'var(--bad)' : b.condition < 70 ? 'var(--warn)' : 'var(--good)'),
      h('div', { class: 'row', style: 'margin-top:6px' },
        btn(t('inc.repair', { cost: money(c) }), () => { if (!repair(s, b.id)) app.toast(t('pb.money'), 'bad'); app.act(); }, 'sm', b.condition >= 99),
        b.brokenFor > 0 ? h('span', { class: 'tag bad' }, t('inc.broken')) : null)));
  }
  return root;
}
