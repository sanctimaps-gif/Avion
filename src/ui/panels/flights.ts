import { AIRCRAFT } from '../../data/aircraft';
import { AIRLINES } from '../../data/airlines';
import { DESTINATIONS } from '../../data/destinations';
import { clock, num } from '../../core/format';
import { t } from '../../core/i18n';
import { atcCapacity, crosswind, ONTIME_LIMIT, onTimeRate, runwayStatus } from '../../sim/flights';
import { getWorld } from '../../sim/world';
import type { Flight } from '../../sim/types';
import type { App } from '../app';
import { h, kv, section, tabs } from '../dom';

/** Centre de gestion des vols : tableaux d'arrivées/départs, pistes, postes. */
export function flightsPanel(app: App): HTMLElement {
  const s = app.s;
  const tab = app.panelTab.flights ?? 'arr';
  const root = h('div');
  root.append(tabs([
    { id: 'arr', label: t('fl.arrivals') },
    { id: 'dep', label: t('fl.departures') },
    { id: 'ground', label: t('fl.ground') },
    { id: 'ops', label: t('fl.ops') },
  ], tab, (id) => { app.panelTab.flights = id; app.act(); }));

  const select = (f: Flight) => {
    app.selectedFlight = f.id;
    app.selectedBuilding = null;
    if (f.phase !== 'scheduled') app.centerOn(f.pos.x, f.pos.y);
    app.openPanel('selection');
  };
  const status = (f: Flight) => {
    const cls = ['diverted', 'cancelled'].includes(f.phase) ? 'bad' : f.phase === 'holding' ? 'warn' : '';
    return h('span', { class: cls }, t('ph.' + f.phase));
  };

  if (tab === 'arr' || tab === 'dep') {
    const arr = tab === 'arr';
    const list = [...s.flights]
      .filter((f) => (arr ? ['scheduled', 'inbound', 'holding', 'landing', 'taxi_in', 'diverted', 'cancelled', 'deboarding'].includes(f.phase) : !['departed'].includes(f.phase) || s.time - f.phaseStart < 60))
      .sort((a, b) => (arr ? a.schedArr - b.schedArr : a.schedDep - b.schedDep))
      .slice(0, 60);
    const table = h('table', { class: 'board mono' },
      h('tr', null, h('th', null, t('fl.time')), h('th', null, t('fl.flight')), h('th', null, arr ? t('fl.from') : t('fl.to')), h('th', null, t('fl.status')), h('th', null, t('fl.delay'))),
      list.map((f) => {
        const sched = arr ? f.schedArr : f.schedDep;
        const actual = arr ? (f.actArr ?? f.estArr) : (f.actDep ?? Math.max(f.schedDep, s.time));
        const delay = Math.max(0, Math.round(actual - sched));
        return h('tr', { class: 'click', onclick: () => select(f) },
          h('td', null, clock(sched % 1440)),
          h('td', null, h('span', { style: `color:${AIRLINES[f.airlineId].color}` }, '■ '), arr ? f.arrNo : f.depNo),
          h('td', null, DESTINATIONS[f.destId].city),
          h('td', null, status(f)),
          h('td', { class: delay > ONTIME_LIMIT ? 'warn' : 'muted' }, delay > 0 ? `+${delay}′` : '—'));
      }));
    root.append(list.length ? table : h('p', { class: 'hint' }, t('fl.none')));
    root.append(h('p', { class: 'hint' }, t('fl.hintSchedule')));
    return root;
  }

  if (tab === 'ground') {
    const w = getWorld(s);
    const rows = w.stands.map((st) => {
      const f = s.flights.find((x) => x.standId === st.id && !['departed', 'diverted', 'cancelled', 'scheduled'].includes(x.phase));
      return h('tr', { class: 'click', onclick: () => { app.selectedBuilding = st.id; app.centerOn(st.center.x, st.center.y); app.openPanel('selection'); } },
        h('td', null, `#${st.id}`),
        h('td', null, st.size + (st.contact ? ' 🚪' : ' 🚌')),
        h('td', null, f ? `${f.arrNo} · ${AIRCRAFT[f.aircraft].name.split(' ')[1]}` : h('span', { class: 'muted' }, t('fl.free'))),
        h('td', null, f ? t('ph.' + f.phase) : !st.reachable ? h('span', { class: 'bad' }, t('pb.noTaxiway')) : ''));
    });
    root.append(h('table', { class: 'board' }, h('tr', null, h('th', null, t('fl.stand')), h('th', null, t('fl.type')), h('th', null, t('fl.flight')), h('th', null, t('fl.status'))), rows));
    root.append(h('p', { class: 'hint' }, t('fl.hintStands')));
    return root;
  }

  // Opérations : pistes, contrôle aérien, performance
  const w = getWorld(s);
  const ops = section(t('fl.runways'));
  if (!w.runways.length) ops.append(h('p', { class: 'bad' }, t('fl.noRunway')));
  for (const r of w.runways) {
    const st = runwayStatus(s, w, r);
    const xw = crosswind(s, r);
    ops.append(h('div', { class: 'card' },
      h('h4', null, '🛬 ', t('b.' + w.byId.get(r.id)!.type), ` · ${num(r.length)} m`),
      kv(t('fl.status'), st ? h('span', { class: 'bad' }, t(st)) : h('span', { class: 'good' }, t('rw.open'))),
      kv(t('fl.crosswind'), `${Math.round(xw.xw)} kt`),
      kv('ILS', r.hasIls ? '✔' : '✘'),
      kv(t('fl.busy'), (s.runwayBusy[r.id] ?? 0) > s.time ? t('ui.yes') : t('ui.no'))));
  }
  root.append(ops);
  const holding = s.flights.filter((f) => f.phase === 'holding').length;
  root.append(section(t('fl.atc'),
    kv(t('fl.atcCap'), `${Math.round(atcCapacity(s))} ${t('fl.movH')}`),
    kv(t('fl.holding'), String(holding), holding > 0 ? 'warn' : ''),
    kv(t('fl.onTime7'), `${Math.round(onTimeRate(s, 7) * 100)} %`),
    kv(t('fl.gates'), `${w.cap.gates}`),
    kv(t('fl.stands'), `${w.stands.length}`)));
  return root;
}
