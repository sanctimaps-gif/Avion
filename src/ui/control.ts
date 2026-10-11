import { AIRCRAFT } from '../data/aircraft';
import { AIRLINES } from '../data/airlines';
import { DESTINATIONS } from '../data/destinations';
import { t } from '../core/i18n';
import { assignStand, clearTakeoff, clearTaxi, standNo, standOptions, stripFlights } from '../sim/control';
import { pendingAction, SERVICES, startService, type CtlNeed } from '../sim/flights';
import { CONTROL_TIME, SPEEDS } from '../sim/simulation';
import { getWorld } from '../sim/world';
import type { Flight, ServiceKind } from '../sim/types';
import type { App } from './app';
import { bar, btn, h } from './dom';

/**
 * Interface du mode contrôleur : colonne des strips de vol et bloc d'ordres
 * dans la fiche de l'avion (choix du poste, services, autorisations).
 */
const NEED_ICON: Record<CtlNeed, string> = { stand: '🅿️', services: '🧰', taxi: '➡️', takeoff: '🛫' };
const SVC_ICON: Record<ServiceKind, string> = { fuel: '⛽', bags: '🧳', catering: '🍱', cleaning: '🧹' };

/** Code court du type d'avion (« TP-70 »). */
export function acCode(id: string): string {
  const n = AIRCRAFT[id].name.split(' ');
  return n[n.length - 1];
}

function arriving(f: Flight): boolean {
  return ['scheduled', 'inbound', 'holding', 'landing', 'taxi_in', 'deboarding'].includes(f.phase);
}

/** Temps réel restant (secondes) avant la limite d'assistance, à la vitesse actuelle. */
export function realSeconds(app: App, gameMin: number): number | null {
  const rate = (SPEEDS[app.clock.speed] ?? 0) * (app.s.settings.control === 'manual' ? CONTROL_TIME : 1);
  return rate > 0 ? Math.max(0, gameMin) / rate : null;
}

function countdown(app: App, gameMin: number): string {
  const sec = realSeconds(app, gameMin);
  if (sec === null) return `${Math.max(0, Math.ceil(gameMin))} min`;
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

const stripCache = new WeakMap<HTMLElement, { head: HTMLElement; empty: HTMLElement; items: Map<number, { el: HTMLElement; l1: HTMLElement; l2: HTMLElement; l3: HTMLElement; key: string }> }>();

/** Met à jour la colonne des strips sans recréer les éléments (un toucher n'est jamais perdu). */
export function renderStrips(app: App, el: HTMLElement): void {
  const s = app.s;
  const on = s.settings.control === 'manual';
  el.style.display = on ? 'flex' : 'none';
  if (!on) return;
  let c = stripCache.get(el);
  if (!c) {
    c = { head: h('div', { class: 'strips-head' }), empty: h('div', { class: 'strip muted' }, t('ctl.none')), items: new Map() };
    stripCache.set(el, c);
  }
  const list = stripFlights(s).slice(0, 14);
  const pending = list.filter((x) => x.need).length;
  c.head.replaceChildren(t('ctl.title'), pending ? h('span', { class: 'badge' }, String(pending)) : '');
  const want: HTMLElement[] = [c.head];
  const seen = new Set<number>();
  for (const { f, need } of list) {
    seen.add(f.id);
    let it = c.items.get(f.id);
    if (!it) {
      const l1 = h('div', { class: 'l1' });
      const l2 = h('div', { class: 'l2' });
      const l3 = h('div', { class: 'l3' });
      const id = f.id;
      const b = h('button', { class: 'strip', onclick: () => app.selectFlight(id, true) }, l1, l2, l3);
      it = { el: b, l1, l2, l3, key: '' };
      c.items.set(f.id, it);
    }
    const arr = arriving(f);
    const left = need ? need.deadline - s.time : 0;
    const frac = need ? left / Math.max(1, need.deadline - need.since) : 1;
    const cls = 'strip' + (need ? (frac < 0.3 ? ' urgent' : ' need') : '') + (app.selectedFlight === f.id ? ' sel' : '');
    if (it.el.className !== cls) it.el.className = cls;
    const key = `${arr}|${f.phase}`;
    if (it.key !== key) {
      it.key = key;
      it.l1.replaceChildren(h('span', { class: 'ic' }, arr ? '🛬' : '🛫'), h('b', null, arr ? f.arrNo : f.depNo), h('i', { style: `background:${AIRLINES[f.airlineId].color}` }));
      it.l2.textContent = `${acCode(f.aircraft)} · ${DESTINATIONS[f.destId].code}`;
    }
    const txt = need ? `${NEED_ICON[need.need]} ${countdown(app, left)}` : t('ph.' + f.phase);
    if (it.l3.textContent !== txt) it.l3.textContent = txt;
    it.l3.className = need ? 'l3' : 'l3 muted';
    want.push(it.el);
  }
  for (const id of [...c.items.keys()]) if (!seen.has(id)) c.items.delete(id);
  if (list.length === 0) want.push(c.empty);
  // Réordonne seulement si nécessaire (déplacer un élément pendant un toucher annulerait le clic).
  const cur = [...el.children];
  if (cur.length !== want.length || cur.some((n, i) => n !== want[i])) el.replaceChildren(...want);
}

/** Message radio de la tour selon la phase du vol. */
function atcMessage(app: App, f: Flight): string {
  const s = app.s;
  const st = f.standId !== null ? standNo(s, f.standId) : 0;
  switch (f.phase) {
    case 'scheduled':
    case 'inbound':
      return st ? t('atc.approachStand', { n: st }) : t('atc.approach');
    case 'holding':
      return t('atc.holding');
    case 'landing':
      return t('atc.landing');
    case 'taxi_in':
      return t('atc.taxiIn', { n: st });
    case 'deboarding':
      return t('atc.deboarding');
    case 'servicing':
      return t('atc.servicing');
    case 'boarding':
      return t('atc.boarding');
    case 'ready':
      return t('atc.ready');
    case 'taxi_out':
      return t('atc.taxiOut');
    case 'queue':
      return f.clrTakeoff ? t('atc.lineUp') : t('atc.holdShort');
    case 'takeoff':
      return t('atc.takeoff');
    default:
      return t('ph.' + f.phase);
  }
}

/** Bloc « ordres » en tête de la fiche d'un avion (mode contrôleur). */
export function controlBlock(app: App, f: Flight): HTMLElement | null {
  const s = app.s;
  if (s.settings.control !== 'manual') return null;
  const need = pendingAction(s, f);
  const parts: (HTMLElement | null)[] = [h('div', { class: 'atc' }, '🎧 ', atcMessage(app, f))];
  if (need) {
    const left = need.deadline - s.time;
    const frac = left / Math.max(1, need.deadline - need.since);
    parts.push(h('div', { class: 'ctl-need' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', null, NEED_ICON[need.need] + ' ' + t('need.' + need.need)), h('span', { class: frac < 0.3 ? 'bad' : 'warn' }, `${t('ctl.limit')} ${countdown(app, left)}`)),
      bar(frac, frac < 0.3 ? 'var(--bad)' : 'var(--warn)')));
  }
  if (need?.need === 'stand') {
    const opts = standOptions(s, f);
    const size = AIRCRAFT[f.aircraft].size;
    if (app.ctlPick !== null && !opts.find((o) => o.id === app.ctlPick && o.ok)) app.ctlPick = null;
    const cards = opts.map((o) => h('button', {
      class: 'standcard' + (o.ok ? '' : ' off') + (app.ctlPick === o.id ? ' on' : ''),
      disabled: !o.ok,
      onclick: () => { app.ctlPick = o.id; const c = getWorld(s).stands.find((x) => x.id === o.id)?.center; if (c) app.centerOn(c.x, c.y); app.act(); },
    },
    h('b', null, `${t('ctl.stand')} ${o.no}`),
    h('div', { class: 'sizes' }, (['S', 'M', 'L', 'XL'] as const).map((z) => h('span', { class: (z === o.size ? 'cur' : '') + (z === size ? ' ac' : '') }, z))),
    h('div', { class: 'small' }, o.contact ? '🚪 ' + t('fl.contact') : '🚌 ' + t('fl.remote')),
    h('div', { class: 'small ' + (o.ok ? 'good' : 'bad') }, o.ok ? t('ctl.free') : !o.fits ? t('ctl.tooSmall') : o.takenBy && o.takenBy !== '—' ? t('ctl.taken', { f: o.takenBy }) : t('ctl.unusable'))));
    parts.push(h('div', { class: 'standcards' }, cards.length ? cards : h('p', { class: 'hint' }, t('ctl.noStand'))));
    parts.push(h('div', { class: 'row' },
      btn(t('ctl.confirm'), () => {
        if (app.ctlPick !== null && assignStand(s, f, app.ctlPick)) {
          app.toast(t('ctl.assigned', { f: f.arrNo, n: standNo(s, app.ctlPick) }), 'good');
          app.ctlPick = null;
        }
        app.act();
      }, 'primary', app.ctlPick === null),
      h('span', { class: 'hint' }, t('ctl.standHint'))));
  }
  if (f.phase === 'servicing' && f.svc) {
    const grid = SERVICES.map((k) => {
      const end = f.svc![k];
      const total = Math.max(2, Math.ceil((f.svcDur ?? 20) * ({ bags: 1, fuel: 0.7, catering: 0.6, cleaning: 0.5 } as const)[k]));
      const done = end !== undefined && s.time >= end;
      const run = end !== undefined && !done;
      return h('button', { class: 'svc' + (done ? ' done' : run ? ' run' : ''), disabled: end !== undefined, onclick: () => { startService(s, f, k); app.act(); } },
        h('span', { class: 'ic' }, SVC_ICON[k]), h('span', null, t('svc.' + k)),
        done ? h('span', { class: 'good' }, '✓') : run ? bar(1 - (end! - s.time) / total) : h('span', { class: 'small' }, t('ctl.start')));
    });
    parts.push(h('div', { class: 'svcgrid' }, grid));
    if (need?.need === 'services') parts.push(btn(t('ctl.startAll'), () => { for (const k of SERVICES) startService(s, f, k); app.act(); }, 'primary'));
  }
  if (need?.need === 'taxi') parts.push(btn('➡️ ' + t('ctl.clearTaxi'), () => { clearTaxi(s, f); app.act(); }, 'primary'));
  if (need?.need === 'takeoff') parts.push(btn('🛫 ' + t('ctl.clearTakeoff'), () => { clearTakeoff(s, f); app.act(); }, 'primary'));
  return h('div', { class: 'ctl' }, parts);
}
