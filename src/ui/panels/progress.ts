import { TIERS } from '../../data/tiers';
import { SCENARIO_MAP } from '../../data/scenarios';
import { money, num } from '../../core/format';
import { t } from '../../core/i18n';
import { objectiveProgress, tierCheck } from '../../sim/progression';
import { onTimeRate } from '../../sim/flights';
import type { SlotMeta } from '../../save/saveManager';
import type { App } from '../app';
import { sparkline } from '../chart';
import { bar, h, kv, section, tabs } from '../dom';

/** Statistiques, progression, objectifs et comparaison des aéroports. */
let compareCache: SlotMeta[] = [];

export function progressPanel(app: App): HTMLElement {
  const s = app.s;
  const tab = app.panelTab.progress ?? 'goals';
  const root = h('div');
  root.append(tabs([
    { id: 'goals', label: t('pr.goals') },
    { id: 'stats', label: t('pr.stats') },
    { id: 'sat', label: t('pr.satisfaction') },
    { id: 'compare', label: t('pr.compare') },
  ], tab, (id) => { app.panelTab.progress = id; app.act(); }));

  if (tab === 'goals') {
    if (s.challenge) {
      const def = SCENARIO_MAP[s.challenge.id];
      const left = s.challenge.deadlineDay - Math.floor(s.time / 1440);
      root.append(h('div', { class: 'over-banner' },
        h('b', null, def ? t('sc.' + def.id) : t('mode.daily')),
        h('div', { class: 'meta' }, def ? t('scd.' + def.id) : t('mode.dailyDesc')),
        h('div', null, s.challenge.status === 'running' ? t('pr.daysLeft', { n: left }) : t('pr.status.' + s.challenge.status))));
    }
    const tc = tierCheck(s);
    root.append(section(t('pr.tier'),
      h('div', { class: 'card' },
        h('h4', null, '🏢', t('tier.' + s.tier)),
        tc.next !== null ? h('div', null,
          h('div', { class: 'meta' }, t('pr.next', { tier: t('tier.' + tc.next) })),
          h('div', { class: 'meta' }, `${t('pr.pax30')}: ${num(tc.pax.cur)} / ${num(tc.pax.need)}`), bar(tc.pax.cur / Math.max(1, tc.pax.need)),
          h('div', { class: 'meta' }, `${t('pr.reputation')}: ${Math.round(tc.rep.cur)} / ${tc.rep.need}`), bar(tc.rep.cur / Math.max(1, tc.rep.need)),
          tc.missing.length ? h('div', { class: 'meta warn' }, t('pr.missing') + ' ' + tc.missing.map((m) => t('b.' + m)).join(', ')) : null,
          h('div', { class: 'meta' }, t('pr.reward', { v: money(TIERS[tc.next].reward) }))) : h('div', { class: 'good' }, t('pr.maxTier')))));
    const groups: ['short' | 'medium' | 'long', string][] = [['short', 'pr.short'], ['medium', 'pr.medium'], ['long', 'pr.long']];
    for (const [hz, key] of groups) {
      const list = s.objectives.filter((o) => o.horizon === hz);
      if (!list.length) continue;
      root.append(section(t(key), list.map((o) => {
        const p = objectiveProgress(s, o);
        return h('div', { class: 'card' + (o.done ? ' sel' : '') },
          h('h4', null, o.done ? '✅' : '🎯', t('obj.' + o.kind, { n: o.kind === 'cash' || o.kind === 'profit30' ? money(o.target) : num(o.target), b: o.param ? t('b.' + o.param) : '', tier: t('tier.' + o.target) })),
          !o.done ? bar(p / Math.max(1, o.target)) : null,
          o.reward ? h('div', { class: 'meta' }, t('pr.reward', { v: money(o.reward) })) : null);
      })));
    }
    return root;
  }

  if (tab === 'stats') {
    const hist = s.finance.history.slice(-60);
    const last = hist[hist.length - 1];
    root.append(
      section(t('pr.overview'),
        kv(t('pr.totalPax'), num(s.totals.pax)),
        kv(t('pr.totalMov'), num(s.totals.movements)),
        kv(t('pr.days'), num(s.totals.days)),
        kv(t('pr.paxYesterday'), last ? num(last.pax) : '—'),
        kv(t('pr.onTime7'), `${Math.round(onTimeRate(s, 7) * 100)} %`),
        kv(t('pr.reputation'), `${Math.round(s.reputation)} / 100`),
        kv(t('pr.satisfaction'), `${Math.round(s.satisfaction)} / 100`),
        kv(t('pr.inTerminal'), num(s.pax.live.inTerminal))),
      section(t('pr.paxChart'), sparkline(hist.map((d) => d.pax))),
      section(t('pr.movChart'), sparkline(hist.map((d) => d.movements), { color: '#a78bfa' })),
      section(t('pr.repChart'), sparkline(hist.map((d) => d.reputation), { color: '#facc15' })),
      section(t('pr.missedChart'), sparkline(hist.map((d) => d.missed), { color: '#ef4444' })),
    );
    return root;
  }

  if (tab === 'sat') {
    root.append(section(t('pr.satisfaction'), h('div', { class: 'card' },
      h('h4', null, '😊', `${Math.round(s.satisfaction)} / 100`), bar(s.satisfaction / 100))));
    const parts = s.satisfactionParts;
    const sec = section(t('pr.parts'));
    if (!Object.keys(parts).length) sec.append(h('p', { class: 'hint' }, t('pr.firstDay')));
    for (const [k, v] of Object.entries(parts)) {
      sec.append(h('div', null, h('div', { class: 'row' }, h('span', { class: 'grow' }, t('sat.' + k)), h('b', { class: v < 50 ? 'bad' : v < 75 ? 'warn' : 'good' }, String(Math.round(v)))), bar(v / 100, v < 50 ? 'var(--bad)' : v < 75 ? 'var(--warn)' : 'var(--good)')));
    }
    const today = s.pax.today;
    root.append(sec, section(t('pr.today'),
      kv(t('pr.departed'), num(today.departed)),
      kv(t('pr.arrived'), num(today.arrived)),
      kv(t('pr.missed'), num(today.missed), today.missed > 0 ? 'warn' : ''),
      kv(t('pr.transfers'), num(today.transfers)),
      kv(t('pr.missedConn'), num(today.missedConnections)),
      kv(t('pr.complaints'), num(today.complaints)),
      kv(t('pr.queueCheckin'), num(s.pax.live.checkinQueue)),
      kv(t('pr.queueSecurity'), num(s.pax.live.securityQueue)),
      kv(t('pr.queueBaggage'), num(s.pax.live.baggageQueue)),
      kv(t('pr.congestion'), `${Math.round(s.pax.live.congestion * 100)} %`, s.pax.live.congestion > 1 ? 'bad' : '')));
    return root;
  }

  // Comparaison locale des aéroports (toutes les parties de l'appareil)
  void app.saves.list().then((l) => {
    const changed = JSON.stringify(l.map((x) => x.id + x.updatedAt)) !== JSON.stringify(compareCache.map((x) => x.id + x.updatedAt));
    compareCache = l;
    if (changed && app.panel === 'progress') app.act();
  });
  const rows = [...compareCache].sort((a, b) => b.tier - a.tier || b.reputation - a.reputation);
  root.append(h('p', { class: 'hint' }, t('pr.compareHint')));
  root.append(h('table', { class: 'board' },
    h('tr', null, h('th', null, '#'), h('th', null, t('pr.airport')), h('th', null, t('pr.tierShort')), h('th', null, t('pr.reputation')), h('th', null, t('fin.cash'))),
    rows.map((m, i) => h('tr', null, h('td', null, String(i + 1)), h('td', null, m.name + (m.id === s.id ? ' ★' : '')), h('td', null, String(m.tier)), h('td', null, String(m.reputation)), h('td', null, money(m.cash))))));
  return root;
}
