import { SCENARIOS } from '../../data/scenarios';
import { money } from '../../core/format';
import { LANGS, t } from '../../core/i18n';
import type { GameMode } from '../../sim/types';
import type { SlotMeta } from '../../save/saveManager';
import type { App } from '../app';
import { btn, h, section } from '../dom';
import { webglInfo } from '../../render/view3d';
import { dateLabel, logText } from '../text';
import { clock } from '../../core/format';

/** Menu principal (accessible en jeu), parties, nouvelle partie, réglages, journal. */
export function menuPanel(app: App): HTMLElement {
  const item = (ic: string, label: string, fn: () => void) => h('div', { class: 'card build-item', onclick: fn }, h('h4', null, h('span', { class: 'ic' }, ic), label));
  return h('div', null,
    item('💾', t('menu.saveNow'), () => void app.saveNow(true)),
    item('📂', t('menu.saves'), () => app.openPanel('saves')),
    item('✨', t('menu.new'), () => app.openPanel('newgame')),
    item('📜', t('menu.log'), () => app.openPanel('log')),
    item('⚙️', t('menu.settings'), () => app.openPanel('settings')),
    h('p', { class: 'hint' }, t('menu.offline')));
}

let slotsCache: SlotMeta[] | null = null;

export function savesPanel(app: App): HTMLElement {
  const root = h('div');
  root.append(h('div', { class: 'row', style: 'margin-bottom:10px' },
    btn('✨ ' + t('menu.new'), () => app.openPanel('newgame'), 'primary'),
    btn('📥 ' + t('saves.import'), () => importFile(app))));
  const list = h('div');
  root.append(list, h('p', { class: 'hint' }, t('saves.hint')));
  const render = (slots: SlotMeta[]) => {
    list.replaceChildren();
    if (!slots.length) list.append(h('p', { class: 'hint' }, t('saves.empty')));
    for (const m of slots) {
      const current = m.id === app.s.id;
      list.append(h('div', { class: 'card' + (current ? ' sel' : '') },
        h('div', { class: 'slot' },
          m.thumb ? h('img', { class: 'minimap', src: m.thumb, alt: '' }) : h('div', { class: 'minimap', style: 'height:75px' }),
          h('div', null,
            h('h4', null, m.name, current ? h('span', { class: 'tag good' }, t('saves.current')) : null),
            h('div', { class: 'meta' }, `${t('mode.' + m.mode)} · ${t('tier.' + m.tier)}`),
            h('div', { class: 'meta' }, `${dateLabel(m.day * 1440)} · ${money(m.cash)} · ⭐ ${m.reputation}`),
            h('div', { class: 'meta small' }, `${t('saves.played')} ${Math.round(m.playSeconds / 60)} min · ${new Date(m.updatedAt).toLocaleString()}`),
            m.over ? h('span', { class: 'tag warn' }, t('saves.over')) : null)),
        h('div', { class: 'row', style: 'margin-top:8px' },
          !current ? btn(t('saves.load'), () => void app.loadGame(m.id), 'primary sm') : btn(t('saves.resume'), () => app.closePanel(), 'primary sm'),
          btn(t('saves.rename'), () => app.prompt(t('saves.rename'), m.name, async (v) => {
            if (current) { app.s.name = v; await app.saveNow(); } else await app.saves.rename(m.id, v);
            slotsCache = null;
            app.act();
          }), 'sm'),
          btn(t('saves.export'), () => void exportSave(app, m), 'sm'),
          btn(t('saves.delete'), () => app.confirm(t('saves.deleteConfirm', { name: m.name }), async () => {
            await app.saves.remove(m.id);
            slotsCache = null;
            if (current) {
              const rest = await app.saves.list();
              if (rest.length) await app.loadGame(rest[0].id);
              else await app.newGame({ name: t('default.airportName'), mode: 'career', control: 'manual' });
            }
            app.act();
          }, t('saves.delete'), true), 'danger sm'))));
    }
  };
  if (slotsCache) render(slotsCache);
  void app.saves.list().then((l) => {
    const changed = JSON.stringify(l.map((x) => [x.id, x.name, x.updatedAt])) !== JSON.stringify((slotsCache ?? []).map((x) => [x.id, x.name, x.updatedAt]));
    slotsCache = l;
    if (changed || !list.childElementCount) render(l);
  });
  return root;
}

async function exportSave(app: App, m: SlotMeta): Promise<void> {
  if (m.id === app.s.id) await app.saveNow();
  const raw = await app.saves.exportSave(m.id);
  if (!raw) return;
  const blob = new Blob([raw], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${m.name.replace(/[^\w-]+/g, '_')}.amsave` });
  document.body.append(a);
  a.click();
  a.remove();
}

function importFile(app: App): void {
  const input = h('input', { type: 'file', accept: '.amsave,.json,application/json' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    const s = await app.saves.importSave(await f.text());
    if (!s) app.toast(t('err.saveCorrupt'), 'bad');
    else {
      slotsCache = null;
      app.toast(t('saves.imported'), 'good');
      app.act();
    }
  });
  input.click();
}

/** Formulaire de nouvelle partie. */
const form = {
  name: '',
  mode: 'career' as GameMode,
  difficulty: 'normal' as 'easy' | 'normal' | 'hard',
  scenario: 'summer_rush',
  eventsFreq: 2,
  weather: true,
  unlimitedMoney: false,
  allUnlocked: false,
  startCash: 5_000_000,
  control: 'manual' as 'auto' | 'manual',
};

export function newGamePanel(app: App): HTMLElement {
  if (!form.name) form.name = t('default.airportName');
  const root = h('div');
  const name = h('input', { type: 'text', value: form.name, maxlength: 40 });
  name.addEventListener('input', () => (form.name = name.value));
  root.append(h('label', { class: 'field' }, h('span', null, t('ng.name')), name));
  const modes: GameMode[] = ['career', 'sandbox', 'challenge', 'event', 'daily'];
  root.append(section(t('ng.mode'), modes.map((m) => h('div', { class: 'card build-item' + (form.mode === m ? ' sel' : ''), onclick: () => { form.mode = m; if (m === 'event') form.scenario = 'world_summit'; if (m === 'challenge') form.scenario = 'summer_rush'; app.act(); } },
    h('h4', null, t('mode.' + m)), h('div', { class: 'meta' }, t('mode.' + m + 'Desc'))))));
  const seg = <T extends string | number | boolean>(label: string, options: [T, string][], get: () => T, set: (v: T) => void) =>
    h('label', { class: 'field' }, h('span', null, label), h('div', { class: 'seg' }, options.map(([v, l]) => h('button', { class: get() === v ? 'on' : '', onclick: () => { set(v); app.act(); } }, l))));
  if (form.mode === 'career' || form.mode === 'sandbox') {
    root.append(seg(t('ng.difficulty'), [['easy', t('diff.easy')], ['normal', t('diff.normal')], ['hard', t('diff.hard')]], () => form.difficulty, (v) => (form.difficulty = v)));
    root.append(seg(t('ng.events'), [[0, t('freq.0')], [1, t('freq.1')], [2, t('freq.2')], [3, t('freq.3')]], () => form.eventsFreq, (v) => (form.eventsFreq = v)));
    root.append(seg(t('ng.weather'), [[true, t('ui.yes')], [false, t('ui.no')]], () => form.weather, (v) => (form.weather = v)));
  }
  if (form.mode === 'sandbox') {
    const cash = h('input', { type: 'number', value: form.startCash, min: 100000, step: 100000 });
    cash.addEventListener('input', () => (form.startCash = Math.max(0, Number(cash.value) || 0)));
    root.append(h('label', { class: 'field' }, h('span', null, t('ng.startCash')), cash));
    root.append(seg(t('ng.unlimited'), [[false, t('ui.no')], [true, t('ui.yes')]], () => form.unlimitedMoney, (v) => (form.unlimitedMoney = v)));
    root.append(seg(t('ng.allUnlocked'), [[false, t('ui.no')], [true, t('ui.yes')]], () => form.allUnlocked, (v) => (form.allUnlocked = v)));
  }
  if (form.mode === 'challenge' || form.mode === 'event') {
    const list = SCENARIOS.filter((x) => x.kind === form.mode);
    root.append(section(t('ng.scenario'), list.map((sc) => h('div', { class: 'card build-item' + (form.scenario === sc.id ? ' sel' : ''), onclick: () => { form.scenario = sc.id; app.act(); } },
      h('h4', null, t('sc.' + sc.id)), h('div', { class: 'meta' }, t('scd.' + sc.id)), h('div', { class: 'meta' }, `${sc.days} ${t('ui.days')} · ${money(sc.cash)}`)))));
  }
  root.append(seg(t('ctl.mode'), [['manual', t('ctl.manual')], ['auto', t('ctl.auto')]], () => form.control, (v) => (form.control = v)));
  root.append(h('p', { class: 'hint' }, t('ctl.modeHint')));
  root.append(h('div', { class: 'row end', style: 'margin-top:10px' },
    btn(t('ui.cancel'), () => app.openPanel('saves')),
    btn(t('ng.start'), () => {
      const scenario = form.mode === 'challenge' || form.mode === 'event' ? form.scenario : undefined;
      void app.newGame({
        name: form.name.trim() || t('default.airportName'),
        mode: form.mode,
        difficulty: form.difficulty,
        eventsFreq: form.eventsFreq,
        weather: form.weather,
        unlimitedMoney: form.unlimitedMoney,
        allUnlocked: form.allUnlocked,
        startCash: form.mode === 'sandbox' ? form.startCash : undefined,
        scenario,
        control: form.control,
      });
      form.name = '';
    }, 'primary')));
  root.append(h('p', { class: 'hint' }, t('ng.hint')));
  return root;
}

export function settingsPanel(app: App): HTMLElement {
  const st = app.settings;
  const seg = <T extends string | number | boolean>(label: string, options: [T, string][], get: () => T, set: (v: T) => void) =>
    h('label', { class: 'field' }, h('span', null, label), h('div', { class: 'seg' }, options.map(([v, l]) => h('button', { class: get() === v ? 'on' : '', onclick: () => { set(v); app.persistSettings(); app.act(); } }, l))));
  return h('div', null,
    seg(t('set.lang'), LANGS.map((l) => [l.id, l.label] as [typeof l.id, string]), () => st.lang, (v) => app.setLanguage(v)),
    seg(t('set.text'), [['s', 'A−'], ['m', 'A'], ['l', 'A+'], ['xl', 'A++']], () => st.text, (v) => { st.text = v; app.applyTextSize(); }),
    seg(t('set.quality'), [['low', t('ui.low')], ['medium', t('ui.medium')], ['high', t('ui.high')]], () => st.quality, (v) => (st.quality = v)),
    seg(t('set.autosave'), [[1, '1 min'], [3, '3 min'], [10, '10 min']], () => st.autosaveMin, (v) => (st.autosaveMin = v)),
    seg(t('set.fps'), [[false, t('ui.no')], [true, t('ui.yes')]], () => st.showFps, (v) => (st.showFps = v)),
    section(t('set.game'),
      seg(t('ng.events'), [[0, t('freq.0')], [1, t('freq.1')], [2, t('freq.2')], [3, t('freq.3')]], () => app.s.settings.eventsFreq, (v) => (app.s.settings.eventsFreq = v)),
      seg(t('ng.weather'), [[true, t('ui.yes')], [false, t('ui.no')]], () => app.s.settings.weather, (v) => (app.s.settings.weather = v)),
      seg(t('ctl.mode'), [['manual', t('ctl.manual')], ['auto', t('ctl.auto')]], () => app.s.settings.control ?? 'auto', (v) => (app.s.settings.control = v)),
      h('p', { class: 'hint' }, t('ctl.modeHint'))),
    h('p', { class: 'hint' }, t('set.hint')),
    section(t('set.diag'), (() => {
      const wi = webglInfo();
      return h('div', { class: 'small muted', style: 'user-select:text' },
        h('div', null, `WebGL 2 : ${wi.webgl2 ? '✔' : '✘'} ${wi.renderer}`),
        h('div', null, `${innerWidth}×${innerHeight} @${devicePixelRatio}x`),
        h('div', null, navigator.userAgent));
    })()),
    section(t('set.credits'), h('div', { class: 'small muted', style: 'user-select:text' }, MODEL_CREDITS.map((c) => h('div', null, c)))));
}

/** Modèles 3D tiers (attribution exigée par les licences CC-BY). */
const MODEL_CREDITS = [
  '« Airport Final Big Scene » — assetfactory (Sketchfab Standard)',
  '« Caffè Bernini » — Jellepostma (CC-BY 4.0)',
  '« Corner Shop – Stylized Tier I » — Mrigua Mohamed (CC-BY 4.0)',
  '« Batiment Marin » — abertin (CC-BY 4.0)',
  '« Modern Parking Area » — Vertex (CC-BY 4.0)',
  '« Abribus, Bus stop, bus station » — Configcars / maxipub (CC-BY 4.0)',
  '« Train Station » — How2 Series (CC-BY 4.0)',
  '« Forest » — rhfqcntrkf (CC-BY 4.0)',
  '« Police car » — Mateusz Woliński (CC-BY 4.0)',
  '« Train » — abhayexe (CC-BY 4.0)',
  '« Japanese bus "Nagoya City Bus" » — VRC-IW (CC-BY-NC 4.0)',
  '« Woolworths Big W Australian Commercial Building » — JoTrain The Aussie (Sketchfab Standard)',
  '« Aircraft Hangar » — jimbogies (CC-BY 4.0)',
  'Airport Pack Total, Airbus A320, Airbus A330-300, A380, centrale géothermique, station-service, panneaux solaires, immeuble — archives fournies',
];

export function logPanel(app: App): HTMLElement {
  const list = [...app.s.log].reverse().slice(0, 120);
  return h('div', null, list.length ? list.map((e) => h('div', { class: 'kv' },
    h('span', { class: 'k mono' }, `${dateLabel(e.t).split(' ').slice(0, 2).join(' ')} ${clock(e.t % 1440)}`),
    h('span', { class: 'v ' + (e.level === 'bad' ? 'bad' : e.level === 'warn' ? 'warn' : e.level === 'good' ? 'good' : '') }, logText(e)))) : h('p', { class: 'hint' }, t('log.empty')));
}
