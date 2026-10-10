import { BUILDINGS, footprint } from '../data/buildings';
import { WEATHER_ICON } from '../data/weather';
import { clock, money, clamp } from '../core/format';
import { getLang, setLang, t, type Lang } from '../core/i18n';
import { canMove, canPlace, checkLine, linePoints, move, place, placeLine, canBuyParcel, buyParcel, parcelPrice } from '../sim/construction';
import { visibleFlights } from '../sim/flights';
import { activeList } from '../sim/incidents';
import { onLog } from '../sim/log';
import { Clock } from '../sim/simulation';
import { createGame, type NewGameOptions } from '../sim/state';
import { getWorld, invalidateWorld } from '../sim/world';
import type { GameState, LogEntry, Pt } from '../sim/types';
import { SaveManager } from '../save/saveManager';
import { openBestStore } from '../save/storage';
import { Controls } from '../render/input';
import { View2D } from '../render/view2d';
import { ViewIso } from '../render/viewIso';
import { View3D } from '../render/view3d';
import { LAYERS } from '../render/overlays';
import type { Camera, FrameInfo, GameView, Ghost, Quality, ViewKind } from '../render/view';
import { btn, clear, h } from './dom';
import { renderPanel, PANELS, type PanelId } from './panels';
import { selectionCard } from './panels/selection';
import { dateLabel, logText } from './text';

/**
 * Application : boucle principale, caméra, vues, modes d'interaction
 * (sélection, placement, tracé, déplacement, achat de terrain),
 * sauvegardes automatiques et interface.
 */
export type Mode =
  | { kind: 'none' }
  | { kind: 'place'; type: string; x: number; y: number; rot: 0 | 1 }
  | { kind: 'line'; type: string; a: Pt | null; b: Pt | null }
  | { kind: 'move'; id: number; x: number; y: number; rot: 0 | 1 }
  | { kind: 'parcel' };

export interface DeviceSettings {
  lang: Lang;
  text: 's' | 'm' | 'l' | 'xl';
  quality: Quality;
  autosaveMin: number;
  showFps: boolean;
  view: ViewKind;
}

const DEFAULT_SETTINGS: DeviceSettings = { lang: 'fr', text: 'm', quality: 'medium', autosaveMin: 1, showFps: false, view: 'iso' };

function loadDeviceSettings(): DeviceSettings {
  try {
    const raw = localStorage.getItem('am:device');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* stockage indisponible */
  }
  const lang = (navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en';
  return { ...DEFAULT_SETTINGS, lang };
}

export class App {
  s!: GameState;
  saves!: SaveManager;
  clock = new Clock();
  settings: DeviceSettings = loadDeviceSettings();
  cam: Camera = { cx: 37, cy: 34, zoom: 22, rot: 0, pitch: 0.9 };
  viewKind: ViewKind = 'iso';
  private views: Partial<Record<ViewKind, GameView>> = {};
  view!: GameView;
  mode: Mode = { kind: 'none' };
  selectedBuilding: number | null = null;
  selectedFlight: number | null = null;
  layers = new Set<string>(['traffic', 'passengers']);
  panel: PanelId | null = null;
  panelTab: Record<string, string> = {};
  private prev = new Map<number, { x: number; y: number; hdg: number; alt: number }>();
  private lastFrame = performance.now();
  private lastSave = performance.now();
  private saving = false;
  private lastPanelRefresh = 0;
  private lastHud = 0;
  private touchedAt = 0;
  private fps = 0;
  private dragGhost = false;

  // DOM
  root = h('div', { id: 'app' });
  stage = h('div', { id: 'stage' });
  topbar = h('div', { class: 'topbar' });
  viewbar = h('div', { class: 'viewbar' });
  layerbar = h('div', { class: 'layers' });
  nav = h('div', { class: 'bottomnav' });
  placebar = h('div', { class: 'placebar' });
  toasts = h('div', { class: 'toasts' });
  panelEl: HTMLElement | null = null;
  fpsEl = h('div', { class: 'fps' });

  async start(): Promise<void> {
    setLang(this.settings.lang);
    this.applyTextSize();
    document.body.append(this.root);
    this.root.append(this.stage, this.topbar, this.viewbar, this.layerbar, this.nav, this.placebar, this.toasts, this.fpsEl);
    this.placebar.style.display = 'none';
    this.saves = new SaveManager(await openBestStore());
    // Démarrage direct dans la dernière partie (ou une nouvelle carrière).
    const last = await this.saves.lastPlayed();
    let state: GameState | null = null;
    if (last) {
      const r = await this.saves.load(last);
      if ('state' in r) {
        state = r.state;
        if (r.recovered) setTimeout(() => this.toast(t('toast.recovered'), 'warn'), 500);
      }
    }
    if (!state) {
      state = createGame({ name: t('default.airportName'), mode: 'career' });
      await this.saves.save(state, this.thumbnail(state));
    }
    this.setGame(state);
    this.setView(this.settings.view);
    document.getElementById('boot')?.remove();
    new Controls(this.stage, {
      pan: (dx, dy) => { this.touchedAt = performance.now(); this.view.pan(this.cam, dx, dy); },
      zoom: (f, x, y) => this.view.zoom(this.cam, f, x, y, this.s),
      rotate: (d) => { if (this.viewKind === '3d' || this.viewKind === 'iso') this.view.rotate(this.cam, d); },
      tilt: (d) => { this.cam.pitch = clamp(this.cam.pitch + d, 0.35, 1.45); },
      tap: (x, y) => this.onTap(x, y),
      dragStart: (x, y) => this.onDragStart(x, y),
      drag: (x, y) => this.onDrag(x, y),
      dragEnd: () => { this.dragGhost = false; },
    });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) void this.saveNow(); });
    window.addEventListener('pagehide', () => void this.saveNow());
    onLog((e) => this.onLogEntry(e));
    this.buildNav();
    this.resize();
    requestAnimationFrame(this.loop);
  }

  // ---------- Parties ----------
  setGame(s: GameState): void {
    this.s = s;
    invalidateWorld();
    this.mode = { kind: 'none' };
    this.selectedBuilding = null;
    this.selectedFlight = null;
    this.prev.clear();
    this.clock.acc = 0;
    this.gameOverShown = false;
    // Centre la caméra sur le terminal principal.
    const term = s.buildings.find((b) => b.type.startsWith('terminal')) ?? s.buildings[0];
    if (term) {
      this.cam.cx = term.x + 3;
      this.cam.cy = term.y;
    }
    this.closePanel();
    this.updatePlacebar();
    this.renderTop();
  }

  async newGame(opts: NewGameOptions): Promise<void> {
    await this.saveNow();
    const s = createGame(opts);
    await this.saves.save(s, this.thumbnail(s));
    this.setGame(s);
    this.toast(t('toast.newGame', { name: s.name }), 'good');
  }

  async loadGame(id: string): Promise<void> {
    if (this.s && id === this.s.id) {
      this.closePanel();
      return;
    }
    await this.saveNow();
    const r = await this.saves.load(id);
    if ('error' in r) {
      this.toast(t(r.error), 'bad');
      return;
    }
    this.setGame(r.state);
    // Mémorise la partie active.
    await this.saves.save(r.state, this.thumbnail(r.state));
    if (r.recovered) this.toast(t('toast.recovered'), 'warn');
    else this.toast(t('toast.loaded', { name: r.state.name }), 'good');
  }

  async saveNow(manual = false): Promise<void> {
    if (!this.s || this.saving) return;
    this.saving = true;
    try {
      await this.saves.save(this.s, this.thumbnail(this.s));
      this.lastSave = performance.now();
      if (manual) this.toast(t('toast.saved'), 'good');
    } catch (e) {
      this.toast(t('toast.saveError'), 'bad');
      console.error(e);
    } finally {
      this.saving = false;
    }
  }

  /** Miniature de l'aéroport pour le menu des parties. */
  thumbnail(s: GameState): string | undefined {
    try {
      const c = document.createElement('canvas');
      const k = 2;
      c.width = s.map.w * k;
      c.height = s.map.h * k;
      const ctx = c.getContext('2d')!;
      for (let y = 0; y < s.map.h; y++) for (let x = 0; x < s.map.w; x++) {
        const tt = s.map.terrain[y * s.map.w + x];
        ctx.fillStyle = tt === 1 ? '#3d7fb8' : tt === 2 ? '#2f6b3a' : '#5f9e4f';
        ctx.fillRect(x * k, y * k, k, k);
      }
      for (const b of s.buildings) {
        const f = footprint(BUILDINGS[b.type], b.rot);
        ctx.fillStyle = BUILDINGS[b.type].roof ?? BUILDINGS[b.type].color;
        ctx.fillRect(b.x * k, b.y * k, f.w * k, f.h * k);
      }
      return c.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }

  // ---------- Vues ----------
  setView(kind: ViewKind): void {
    if (this.view) this.view.canvas.remove();
    let v = this.views[kind];
    if (!v) {
      if (kind === '3d') {
        try {
          // Le contexte WebGL n'est créé que lorsque la vue 3D est demandée.
          v = new View3D();
        } catch (e) {
          console.error(e);
          this.toast(t('toast.no3d'), 'bad');
          kind = 'iso';
          v = this.views.iso ?? new ViewIso();
        }
      } else if (kind === 'iso') v = new ViewIso();
      else v = new View2D(kind);
      this.views[kind] = v;
    }
    this.viewKind = kind;
    this.view = v;
    this.stage.append(v.canvas);
    this.settings.view = kind;
    this.persistSettings();
    this.resize();
    this.renderViewbar();
    this.renderLayerbar();
  }

  resize(): void {
    const w = window.innerWidth;
    const hh = window.innerHeight;
    this.view?.resize(w, hh, Math.min(window.devicePixelRatio || 1, 2));
    const top = this.topbar.getBoundingClientRect().height || 56;
    const navH = this.nav.getBoundingClientRect().height || 64;
    this.root.style.setProperty('--nav-h', navH + 'px');
    this.root.style.setProperty('--top-h', top + 'px');
    this.viewbar.style.top = top + 8 + 'px';
    this.layerbar.style.top = top + 8 + 'px';
    this.toasts.style.top = top + 8 + (this.viewKind === 'hybrid' ? 46 : 0) + 'px';
    this.placebar.style.bottom = navH + 10 + 'px';
    this.fpsEl.style.bottom = navH + 8 + 'px';
  }

  // ---------- Boucle principale ----------
  private loop = (now: number): void => {
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    if (this.s && !this.s.gameOver) {
      const paused = this.panel === 'saves' || this.panel === 'newgame';
      if (!paused) {
        const frac = this.clock.advance(this.s, dt, () => this.snapshot());
        this.s.playSeconds += dt;
        this.frac = frac;
      }
    }
    if (this.s?.gameOver && !this.gameOverShown) this.showGameOver();
    this.renderFrame(now);
    if (now - this.lastHud > 250) {
      this.lastHud = now;
      this.renderTop();
      this.updateBadges();
    }
    if (this.panel && now - this.lastPanelRefresh > 1000 && now - this.touchedAt > 1500 && !this.inputFocused()) {
      this.refreshPanel();
    }
    if (now - this.lastSave > this.settings.autosaveMin * 60_000) void this.saveNow();
    this.fpsEl.style.display = this.settings.showFps ? 'block' : 'none';
    if (this.settings.showFps) this.fpsEl.textContent = `${Math.round(this.fps)} FPS`;
    requestAnimationFrame(this.loop);
  };
  private frac = 0;
  private gameOverShown = false;

  private snapshot(): void {
    this.prev.clear();
    for (const f of this.s.flights) this.prev.set(f.id, { ...f.pos });
  }

  private renderFrame(now: number): void {
    const fi: FrameInfo = {
      frac: this.frac,
      prev: this.prev,
      ghost: this.currentGhost(),
      selectedBuilding: this.selectedBuilding,
      selectedFlight: this.selectedFlight,
      layers: this.viewKind === 'hybrid' ? this.layers : new Set(),
      parcelMode: this.mode.kind === 'parcel',
      quality: this.settings.quality,
      realTime: now,
    };
    try {
      this.view.render(this.s, this.cam, fi);
    } catch (e) {
      console.error(e);
    }
  }

  private inputFocused(): boolean {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA');
  }

  // ---------- Interaction ----------
  private tileAt(x: number, y: number): Pt | null {
    return this.view.screenToTile(this.s, this.cam, x, y);
  }

  private onTap(x: number, y: number): void {
    const p = this.tileAt(x, y);
    if (!p) return;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    const m = this.mode;
    if (m.kind === 'place' || m.kind === 'move') {
      const def = BUILDINGS[m.kind === 'place' ? m.type : this.s.buildings.find((b) => b.id === m.id)!.type];
      const f = footprint(def, m.rot);
      m.x = Math.round(p.x - f.w / 2);
      m.y = Math.round(p.y - f.h / 2);
      this.updatePlacebar();
      return;
    }
    if (m.kind === 'line') {
      if (!m.a || m.b) {
        m.a = { x: tx, y: ty };
        m.b = null;
      } else m.b = { x: tx, y: ty };
      this.updatePlacebar();
      return;
    }
    if (m.kind === 'parcel') {
      const px = Math.floor(tx / this.s.map.parcel);
      const py = Math.floor(ty / this.s.map.parcel);
      if (canBuyParcel(this.s, px, py)) {
        const price = parcelPrice(this.s);
        this.confirm(t('land.confirm', { price: money(price) }), () => {
          if (buyParcel(this.s, px, py)) this.toast(t('land.bought'), 'good');
          else this.toast(t('pb.money'), 'bad');
        });
      }
      return;
    }
    // Sélection : avion le plus proche, sinon bâtiment.
    let best: number | null = null;
    let bd = 1.6;
    for (const f of visibleFlights(this.s)) {
      const d = Math.hypot(f.pos.x - p.x, f.pos.y - p.y);
      if (d < bd) {
        bd = d;
        best = f.id;
      }
    }
    if (best !== null) {
      this.selectedFlight = best;
      this.selectedBuilding = null;
      this.openPanel('selection');
      return;
    }
    const w = getWorld(this.s);
    if (tx >= 0 && ty >= 0 && tx < this.s.map.w && ty < this.s.map.h) {
      const id = w.occ[ty * this.s.map.w + tx];
      if (id) {
        this.selectedBuilding = id;
        this.selectedFlight = null;
        this.openPanel('selection');
        return;
      }
    }
    this.selectedBuilding = null;
    this.selectedFlight = null;
    if (this.panel === 'selection') this.closePanel();
  }

  private onDragStart(x: number, y: number): boolean {
    const m = this.mode;
    if (m.kind !== 'place' && m.kind !== 'move') return false;
    const p = this.tileAt(x, y);
    if (!p) return false;
    const type = m.kind === 'place' ? m.type : this.s.buildings.find((b) => b.id === m.id)!.type;
    const f = footprint(BUILDINGS[type], m.rot);
    const inside = p.x >= m.x - 1 && p.x <= m.x + f.w + 1 && p.y >= m.y - 1 && p.y <= m.y + f.h + 1;
    this.dragGhost = inside;
    return inside;
  }
  private onDrag(x: number, y: number): void {
    const m = this.mode;
    if (!this.dragGhost || (m.kind !== 'place' && m.kind !== 'move')) return;
    const p = this.tileAt(x, y);
    if (!p) return;
    const type = m.kind === 'place' ? m.type : this.s.buildings.find((b) => b.id === m.id)!.type;
    const f = footprint(BUILDINGS[type], m.rot);
    const nx = Math.round(p.x - f.w / 2);
    const ny = Math.round(p.y - f.h / 2);
    if (nx !== m.x || ny !== m.y) {
      m.x = nx;
      m.y = ny;
      this.updatePlacebar();
    }
  }

  private currentGhost(): Ghost | null {
    const m = this.mode;
    if (m.kind === 'place') {
      return { type: m.type, x: m.x, y: m.y, rot: m.rot, ok: canPlace(this.s, m.type, m.x, m.y, m.rot).ok };
    }
    if (m.kind === 'move') {
      const b = this.s.buildings.find((q) => q.id === m.id);
      if (!b) return null;
      return { type: b.type, x: m.x, y: m.y, rot: m.rot, ok: canMove(this.s, b, m.x, m.y, m.rot).ok };
    }
    if (m.kind === 'line' && m.a) {
      const pts = linePoints(m.a, m.b ?? m.a);
      const chk = checkLine(this.s, m.type, pts);
      return { type: m.type, x: m.a.x, y: m.a.y, rot: 0, ok: true, cells: chk.cells.map((c) => ({ p: c.p, ok: c.ok })) };
    }
    return null;
  }

  startPlacement(type: string): void {
    const def = BUILDINGS[type];
    this.closePanel();
    this.selectedBuilding = null;
    if (def.linear) this.mode = { kind: 'line', type, a: null, b: null };
    else {
      const rot: 0 | 1 = 0;
      const f = footprint(def, rot);
      this.mode = { kind: 'place', type, x: Math.round(this.cam.cx - f.w / 2), y: Math.round(this.cam.cy - f.h / 2), rot };
    }
    this.updatePlacebar();
  }

  startMove(id: number): void {
    const b = this.s.buildings.find((q) => q.id === id);
    if (!b) return;
    this.closePanel();
    this.mode = { kind: 'move', id, x: b.x, y: b.y, rot: b.rot };
    this.updatePlacebar();
  }

  startParcelMode(): void {
    this.closePanel();
    this.mode = { kind: 'parcel' };
    this.updatePlacebar();
  }

  cancelMode(): void {
    this.mode = { kind: 'none' };
    this.updatePlacebar();
  }

  private confirmPlacement(): void {
    const m = this.mode;
    if (m.kind === 'place') {
      const r = place(this.s, m.type, m.x, m.y, m.rot);
      if (r.ok) {
        this.toast(t('toast.building', { name: t('b.' + m.type), cost: money(r.cost) }), 'good');
        // On reste en mode placement pour enchaîner (déplacé d'un cran).
        const f = footprint(BUILDINGS[m.type], m.rot);
        m.x += f.w;
      } else this.toast(t(r.reason ?? 'pb.unknown'), 'bad');
    } else if (m.kind === 'line' && m.a) {
      const pts = linePoints(m.a, m.b ?? m.a);
      const n = placeLine(this.s, m.type, pts);
      if (n > 0) this.toast(t('toast.line', { n, name: t('b.' + m.type) }), 'good');
      else this.toast(t('toast.lineNone'), 'bad');
      m.a = m.b ?? m.a;
      m.b = null;
    } else if (m.kind === 'move') {
      const b = this.s.buildings.find((q) => q.id === m.id);
      if (b && move(this.s, b, m.x, m.y, m.rot)) {
        this.toast(t('toast.moved'), 'good');
        this.cancelMode();
        return;
      }
      const c = b ? canMove(this.s, b, m.x, m.y, m.rot) : null;
      this.toast(t(c?.reason ?? 'pb.unknown'), 'bad');
    }
    this.updatePlacebar();
  }

  updatePlacebar(): void {
    const pb = this.placebar;
    clear(pb);
    const m = this.mode;
    if (m.kind === 'none') {
      pb.style.display = 'none';
      return;
    }
    pb.style.display = 'flex';
    const cancel = h('button', { class: 'iconbtn', onclick: () => this.cancelMode(), title: t('ui.cancel') }, '✕');
    if (m.kind === 'parcel') {
      pb.append(h('div', { class: 'info' }, h('b', null, t('land.title')), t('land.hint', { price: money(parcelPrice(this.s)) })), cancel);
      return;
    }
    if (m.kind === 'line') {
      const pts = m.a ? linePoints(m.a, m.b ?? m.a) : [];
      const chk = checkLine(this.s, m.type, pts);
      const info = h('div', { class: 'info' }, h('b', null, t('b.' + m.type)), !m.a ? t('place.lineStart') : !m.b ? t('place.lineEnd') : t('place.lineCost', { n: chk.count, cost: money(chk.cost) }));
      pb.append(info, cancel, h('button', { class: 'iconbtn active', onclick: () => this.confirmPlacement(), disabled: !m.a || chk.count === 0 }, '✓'));
      return;
    }
    const type = m.kind === 'place' ? m.type : this.s.buildings.find((b) => b.id === m.id)?.type ?? 'road';
    const chk = m.kind === 'place' ? canPlace(this.s, type, m.x, m.y, m.rot) : canMove(this.s, this.s.buildings.find((b) => b.id === m.id)!, m.x, m.y, m.rot);
    const def = BUILDINGS[type];
    const info = h('div', { class: 'info' }, h('b', null, (m.kind === 'move' ? t('ui.move') + ' · ' : '') + t('b.' + type)), chk.ok ? money(chk.cost) : h('span', { class: 'bad' }, t(chk.reason ?? 'pb.unknown')));
    const rotate = h('button', { class: 'iconbtn', onclick: () => { if (m.kind === 'place' || m.kind === 'move') { m.rot = m.rot === 0 ? 1 : 0; this.updatePlacebar(); } }, disabled: def.w === def.h, title: t('ui.rotate') }, '⟳');
    pb.append(info, rotate, cancel, h('button', { class: 'iconbtn active', onclick: () => this.confirmPlacement(), disabled: !chk.ok }, '✓'));
  }

  // ---------- Panneaux ----------
  openPanel(id: PanelId): void {
    if (this.panel === id && id !== 'selection') {
      this.closePanel();
      return;
    }
    this.panel = id;
    if (id !== 'selection') {
      this.selectedBuilding = null;
      this.selectedFlight = null;
    }
    if (this.mode.kind !== 'none' && id !== 'selection') this.cancelMode();
    this.refreshPanel(true);
    this.buildNav();
  }

  closePanel(): void {
    this.panel = null;
    this.panelEl?.remove();
    this.panelEl = null;
    this.buildNav();
  }

  refreshPanel(fresh = false): void {
    this.lastPanelRefresh = performance.now();
    if (!this.panel) return;
    const id = this.panel;
    const spec = PANELS[id];
    let body: HTMLElement;
    let title: string;
    if (id === 'selection') {
      const card = selectionCard(this);
      if (!card) {
        this.closePanel();
        return;
      }
      body = card.body;
      title = card.title;
    } else {
      body = renderPanel(id, this);
      title = t(spec.title);
    }
    const scroll = this.panelEl?.querySelector('.panel-body')?.scrollTop ?? 0;
    const el = h('div', { class: 'panel' + (spec.tall ? ' tall' : '') + (id === 'selection' ? ' selcard' : '') },
      h('div', { class: 'grip' }),
      h('div', { class: 'panel-head' }, h('h2', null, title), h('button', { class: 'iconbtn', onclick: () => { this.selectedBuilding = null; this.selectedFlight = null; this.closePanel(); } }, '✕')),
      h('div', { class: 'panel-body' }, body),
    );
    el.addEventListener('pointerdown', () => (this.touchedAt = performance.now()));
    el.addEventListener('scroll', () => (this.touchedAt = performance.now()), true);
    if (this.panelEl) this.panelEl.replaceWith(el);
    else this.root.append(el);
    this.panelEl = el;
    if (!fresh) el.querySelector('.panel-body')!.scrollTop = scroll;
    else el.style.animation = '';
    if (!fresh) el.style.animation = 'none';
  }

  /** À appeler après une action du joueur pour rafraîchir immédiatement. */
  act(): void {
    this.touchedAt = 0;
    this.refreshPanel();
    this.renderTop();
  }

  private buildNav(): void {
    clear(this.nav);
    const items: [PanelId, string, string][] = [
      ['build', '🏗️', 'nav.build'],
      ['flights', '✈️', 'nav.flights'],
      ['airlines', '🤝', 'nav.airlines'],
      ['finance', '💶', 'nav.finance'],
      ['staff', '👥', 'nav.staff'],
      ['incidents', '⚠️', 'nav.incidents'],
      ['research', '🔬', 'nav.research'],
      ['progress', '🏆', 'nav.progress'],
    ];
    for (const [id, ic, key] of items) {
      const b = h('button', { class: 'navbtn' + (this.panel === id ? ' active' : ''), onclick: () => this.openPanel(id), 'data-id': id }, h('span', { class: 'ic' }, ic), t(key));
      this.nav.append(b);
    }
    this.updateBadges();
  }

  private updateBadges(): void {
    if (!this.s) return;
    const set = (id: string, n: number, cls = '') => {
      const b = this.nav.querySelector(`[data-id="${id}"]`);
      if (!b) return;
      b.querySelector('.badge')?.remove();
      if (n > 0) b.append(h('span', { class: 'badge ' + cls }, String(n)));
    };
    set('incidents', activeList(this.s).length + getWorld(this.s).problems.size);
    set('airlines', this.s.offers.length, 'info');
  }

  renderTop(): void {
    if (!this.s) return;
    const s = this.s;
    clear(this.topbar);
    const wk = s.weather.current;
    const sp = this.clock.speed;
    this.topbar.append(
      h('button', { class: 'iconbtn', onclick: () => this.openPanel('menu'), title: t('menu.title') }, '☰'),
      h('div', { class: 'grow' },
        h('div', { class: 'name' }, s.name),
        h('div', { class: 'sub' }, `${clock(s.time % 1440)} · ${dateLabel(s.time)} · ${t('tier.' + s.tier)}`)),
      h('button', { class: 'chip cash clickable' + (s.finance.cash < 0 ? ' neg' : ''), onclick: () => this.openPanel('finance') }, s.settings.unlimitedMoney ? '∞' : money(s.finance.cash)),
      h('button', { class: 'chip clickable wx', onclick: () => { this.panelTab.incidents = 'weather'; this.openPanel('incidents'); } }, `${s.settings.weather ? WEATHER_ICON[wk.kind] : '☀️'}`, h('span', { class: 'temp' }, ` ${Math.round(wk.temp)}°`)),
      h('div', { class: 'speed' },
        h('button', { class: 'iconbtn' + (sp === 0 ? ' active' : ''), onclick: () => { if (this.clock.speed === 0) this.clock.speed = this.lastSpeed || 1; else { this.lastSpeed = this.clock.speed; this.clock.speed = 0; } this.renderTop(); }, title: t('ui.pause') }, sp === 0 ? '▶' : '⏸'),
        h('button', { class: 'iconbtn spd', onclick: () => { this.clock.speed = sp === 0 ? 1 : (sp % 4) + 1; this.renderTop(); }, title: t('ui.speed') }, `×${Math.max(1, sp === 0 ? this.lastSpeed || 1 : sp)}`)),
    );
  }
  private lastSpeed = 1;

  private renderViewbar(): void {
    clear(this.viewbar);
    const items: [ViewKind, string][] = [['top', '2D'], ['3d', '3D'], ['iso', 'ISO'], ['hybrid', 'HYB']];
    for (const [k, label] of items) {
      this.viewbar.append(h('button', { class: 'iconbtn' + (this.viewKind === k ? ' active' : ''), onclick: () => this.setView(k), title: t('view.' + k) }, label));
    }
    if (this.viewKind === '3d' || this.viewKind === 'iso') {
      this.viewbar.append(h('button', { class: 'iconbtn', onclick: () => { this.cam.rot += Math.PI / 2; }, title: t('ui.rotate') }, '⟳'));
    }
    this.viewbar.append(h('button', { class: 'iconbtn', onclick: () => this.view.zoom(this.cam, 1.25, innerWidth / 2, innerHeight / 2, this.s) }, '＋'));
    this.viewbar.append(h('button', { class: 'iconbtn', onclick: () => this.view.zoom(this.cam, 0.8, innerWidth / 2, innerHeight / 2, this.s) }, '－'));
  }

  private renderLayerbar(): void {
    clear(this.layerbar);
    this.layerbar.style.display = this.viewKind === 'hybrid' ? 'flex' : 'none';
    for (const l of LAYERS) {
      this.layerbar.append(h('button', { class: 'chip' + (this.layers.has(l) ? ' on' : ''), onclick: () => { if (this.layers.has(l)) this.layers.delete(l); else this.layers.add(l); this.renderLayerbar(); } }, t('layer.' + l)));
    }
    this.resize();
  }

  // ---------- Notifications & dialogues ----------
  toast(msg: string, level: 'info' | 'good' | 'warn' | 'bad' = 'info'): void {
    const el = h('div', { class: 'toast ' + level }, msg);
    this.toasts.append(el);
    while (this.toasts.children.length > 3) this.toasts.firstChild?.remove();
    setTimeout(() => el.remove(), level === 'bad' ? 5000 : 3200);
  }

  private onLogEntry(e: LogEntry): void {
    if (e.level === 'info' && !['log.newOffer', 'log.tax'].includes(e.key)) return;
    this.toast(logText(e), e.level);
  }

  confirm(msg: string, onYes: () => void, yesLabel = t('ui.confirm'), danger = false): void {
    const bg = h('div', { class: 'modal-bg' });
    const close = () => bg.remove();
    bg.append(h('div', { class: 'modal' }, h('h2', null, t('ui.confirmTitle')), h('p', null, msg),
      h('div', { class: 'row end' }, btn(t('ui.cancel'), close), btn(yesLabel, () => { close(); onYes(); this.act(); }, danger ? 'danger' : 'primary'))));
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    this.root.append(bg);
  }

  prompt(title: string, value: string, onOk: (v: string) => void): void {
    const bg = h('div', { class: 'modal-bg' });
    const input = h('input', { type: 'text', value, maxlength: 40 });
    const close = () => bg.remove();
    bg.append(h('div', { class: 'modal' }, h('h2', null, title), input,
      h('div', { class: 'row end', style: 'margin-top:12px' }, btn(t('ui.cancel'), close), btn(t('ui.ok'), () => { const v = input.value.trim(); if (v) { close(); onOk(v); } }, 'primary'))));
    this.root.append(bg);
    setTimeout(() => input.focus(), 50);
  }

  private showGameOver(): void {
    this.gameOverShown = true;
    const o = this.s.gameOver!;
    const bg = h('div', { class: 'modal-bg' });
    const close = () => { bg.remove(); };
    bg.append(h('div', { class: 'modal' },
      h('h2', null, o.won ? '🏆 ' + t('over.titleWon') : '⚠️ ' + t('over.titleLost')),
      h('p', null, t(o.key)),
      h('div', { class: 'row end' },
        btn(t('menu.saves'), () => { close(); this.openPanel('saves'); }),
        btn(t('menu.new'), () => { close(); this.openPanel('newgame'); }, 'primary'),
        o.won || this.s.mode === 'sandbox' ? btn(t('over.continue'), () => { this.s.gameOver = null; this.gameOverShown = false; close(); }) : null)));
    this.root.append(bg);
  }

  // ---------- Réglages de l'appareil ----------
  persistSettings(): void {
    try {
      localStorage.setItem('am:device', JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }
  applyTextSize(): void {
    document.documentElement.dataset.text = this.settings.text;
  }
  setLanguage(l: Lang): void {
    this.settings.lang = l;
    setLang(l);
    this.persistSettings();
    this.buildNav();
    this.renderViewbar();
    this.renderLayerbar();
    this.renderTop();
    this.refreshPanel();
  }
  get lang(): Lang {
    return getLang();
  }

  centerOn(x: number, y: number): void {
    this.cam.cx = x;
    this.cam.cy = y;
  }
}
