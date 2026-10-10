import { AIRCRAFT } from '../../data/aircraft';
import { AIRLINES } from '../../data/airlines';
import { BUILDINGS, levelMult, upgradeCost } from '../../data/buildings';
import { DESTINATIONS } from '../../data/destinations';
import { clock, money, num, pct } from '../../core/format';
import { t } from '../../core/i18n';
import { demolish, demolishRefund, inUse, moveCost, upgrade } from '../../sim/construction';
import { buildingRoi, upkeepPerDay } from '../../sim/economy';
import { repair, repairCost } from '../../sim/incidents';
import { getWorld, invalidateWorld } from '../../sim/world';
import type { App } from '../app';
import { bar, btn, h, kv } from '../dom';

/** Fiche contextuelle d'un bâtiment ou d'un avion sélectionné. */
export function selectionCard(app: App): { title: string; body: HTMLElement } | null {
  const s = app.s;
  if (app.selectedFlight !== null) {
    const f = s.flights.find((x) => x.id === app.selectedFlight);
    if (!f) return null;
    const a = AIRCRAFT[f.aircraft];
    const al = AIRLINES[f.airlineId];
    const dest = DESTINATIONS[f.destId];
    const stand = f.standId !== null ? getWorld(s).byId.get(f.standId) : undefined;
    return {
      title: `${f.arrNo} / ${f.depNo}`,
      body: h('div', null,
        h('div', { class: 'meta' }, h('span', { style: `color:${al.color}` }, '■ '), `${al.name} · ${a.name}`),
        kv(t('fl.route'), `${dest.city} (${dest.code}) ⇄ ${s.name}`),
        kv(t('fl.status'), t('ph.' + f.phase)),
        kv(t('fl.schedArr'), clock(f.schedArr % 1440) + (f.actArr !== null ? ` → ${clock(f.actArr % 1440)}` : ` (${t('fl.est')} ${clock(f.estArr % 1440)})`)),
        kv(t('fl.schedDep'), clock(f.schedDep % 1440) + (f.actDep !== null ? ` → ${clock(f.actDep % 1440)}` : '')),
        kv(t('fl.paxArr'), `${f.paxArr}${f.transferIn ? ` (${f.transferIn} ${t('fl.transfers')})` : ''}`),
        kv(t('fl.paxDep'), `${f.paxBoarded || f.paxDep}${f.transferOut ? ` (${f.transferOut} ${t('fl.transfers')})` : ''}`),
        kv(t('fl.stand'), stand ? `#${stand.id} ${f.contact ? '🚪 ' + t('fl.contact') : '🚌 ' + t('fl.remote')}` : '—'),
        f.delayReason ? kv(t('fl.delayReason'), t(f.delayReason), 'warn') : null,
        f.revenue ? kv(t('fl.revenue'), money(f.revenue)) : null,
        h('div', { class: 'meta small' }, `${a.seats} ${t('ui.seats')} · ${a.mtow} t · ${t('fl.minRunway')} ${num(a.minRunway)} m`)),
    };
  }
  if (app.selectedBuilding === null) return null;
  const w = getWorld(s);
  const b = w.byId.get(app.selectedBuilding);
  if (!b) return null;
  const d = BUILDINGS[b.type];
  const m = levelMult(b.level);
  const caps: [string, string][] = [];
  if (d.runwayLength) caps.push([t('cap.length'), `${num(d.runwayLength)} m`]);
  if (d.standSize) caps.push([t('cap.stand'), d.standSize]);
  if (d.checkin) caps.push([t('cap.checkin'), `${num(d.checkin * m)} pax/h`]);
  if (d.security) caps.push([t('cap.security'), `${num(d.security * m)} pax/h`]);
  if (d.baggage) caps.push([t('cap.baggage'), `${num(d.baggage * m)} pax/h`]);
  if (d.gates) caps.push([t('cap.gates'), `${Math.round(d.gates * m)}`]);
  if (d.hall) caps.push([t('cap.hall'), `${num(d.hall * m)} pax`]);
  if (d.parking) caps.push([t('cap.parking'), `${num(d.parking * m)}`]);
  if (d.power) caps.push([t('cap.power'), `${num(d.power * m)}`]);
  if (d.commerce) caps.push([t('cap.customers'), `${num(d.commerce.capacity * m)} / ${t('ui.dayShort')}`]);
  if (d.staff) caps.push([t('cap.staff'), Object.entries(d.staff).map(([k, v]) => `${v} ${t('staff.' + k)}`).join(', ')]);
  const problem = w.problems.get(b.id);
  const busy = inUse(s, b);
  const total = d.buildHours * 60 * (b.level > 1 ? 0.4 : 1);
  return {
    title: `${t('b.' + b.type)}${d.maxLevel > 1 ? ' · ' + t('ui.level') + ' ' + b.level : ''}`,
    body: h('div', null,
      h('div', { class: 'meta' }, t('bd.' + b.type)),
      b.buildRemaining > 0 ? h('div', null, kv(t('sel.construction'), `${Math.ceil(b.buildRemaining / 60)} h`), bar(1 - b.buildRemaining / total)) : null,
      problem ? h('div', { class: 'card', style: 'border-color:var(--warn)' }, h('b', { class: 'warn' }, '⚠️ ' + t(problem)), h('div', { class: 'meta' }, t(problem + '.fix'))) : null,
      b.brokenFor > 0 ? kv(t('inc.broken'), `${Math.ceil(b.brokenFor / 60)} h`, 'bad') : null,
      caps.map(([k, v]) => kv(k, v)),
      !d.linear ? kv(t('sel.condition'), `${Math.round(b.condition)} %`, b.condition < 40 ? 'bad' : b.condition < 70 ? 'warn' : '') : null,
      kv(t('sel.upkeep'), `${money(upkeepPerDay(s, b))} / ${t('ui.dayShort')}`),
      b.revenue30 || b.cost30 ? kv(t('sel.net30'), money(b.revenue30 - b.cost30), b.revenue30 - b.cost30 < 0 ? 'bad' : 'good') : null,
      b.revenue30 || b.cost30 ? kv('ROI', pct(buildingRoi(b))) : null,
      h('div', { class: 'row', style: 'margin-top:10px' },
        b.level < d.maxLevel ? btn(t('sel.upgrade', { cost: money(upgradeCost(d, b.level)) }), () => { if (!upgrade(s, b)) app.toast(t('pb.money'), 'bad'); app.act(); }, 'primary sm', b.buildRemaining > 0) : null,
        !d.linear && b.condition < 99 ? btn(t('inc.repair', { cost: money(repairCost(b)) }), () => { if (!repair(s, b.id)) app.toast(t('pb.money'), 'bad'); app.act(); }, 'sm') : null,
        !d.linear ? btn(t('ui.move') + ' (' + money(moveCost(b)) + ')', () => app.startMove(b.id), 'sm', busy) : null,
        btn(b.enabled ? t('sel.disable') : t('sel.enable'), () => { b.enabled = !b.enabled; invalidateWorld(); app.act(); }, 'sm', busy && b.enabled),
        btn(t('sel.demolish'), () => app.confirm(t('sel.demolishConfirm', { refund: money(demolishRefund(b)) }), () => {
          if (demolish(s, b)) { app.selectedBuilding = null; app.closePanel(); } else app.toast(t('pb.inUse'), 'bad');
        }, t('sel.demolish'), true), 'danger sm', busy)),
      busy ? h('p', { class: 'hint' }, t('sel.inUse')) : null),
  };
}
