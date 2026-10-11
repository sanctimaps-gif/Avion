import { BUILDINGS } from '../data/buildings';
import { bFootprint, getWorld } from '../sim/world';
import type { GameState } from '../sim/types';

/**
 * Circulation routière (visuelle) : les véhicules suivent le réseau de routes, roulent à droite,
 * gardent leurs distances, s'arrêtent au dépose-minute du terminal, puis repartent.
 * Ils arrivent et repartent par des tunnels au bord de la carte (vers l'autoroute) ou entrent
 * et sortent des parkings souterrains par une rampe qui descend sous le sol.
 */
export interface Portal {
  kind: 'tunnel' | 'parking';
  /** Case de route desservie. */
  road: number;
  /** Point au bout de la rampe (sous terre) et direction de la descente. */
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export interface CarPose {
  x: number;
  y: number;
  /** Hauteur (négative : sous terre, cachée par le sol). */
  h: number;
  hdg: number;
  kind: 'car' | 'bus' | 'taxi';
  seed: number;
}

interface Car {
  pts: { x: number; y: number }[];
  /** Hauteur de chaque point (rampes). */
  hs: number[];
  len: number[];
  s: number;
  total: number;
  speed: number;
  /** Arrêt au dépose-minute : abscisse et durée restante (s). */
  stopAt: number;
  stopLeft: number;
  kind: CarPose['kind'];
  seed: number;
  lane: string[];
}

const LANE = 0.2;
const DEPTH = -0.45;

export class Traffic {
  private key = '';
  private W = 0;
  private H = 0;
  private road = new Uint8Array(0);
  portals: Portal[] = [];
  private curbs: number[] = [];
  private busStops: number[] = [];
  private cars: Car[] = [];
  private spawnAcc = 0;
  private seed = 1;
  private last = 0;
  private paths = new Map<string, number[] | null>();

  /** Reconstruit le graphe routier si l'infrastructure a changé. */
  private sync(s: GameState): void {
    const w = getWorld(s);
    const key = `${s.id}|${w.rev}`;
    if (key === this.key) return;
    this.key = key;
    this.W = s.map.w;
    this.H = s.map.h;
    const W = this.W;
    this.road = new Uint8Array(W * this.H);
    for (let i = 0; i < W * this.H; i++) this.road[i] = w.roadOk[i];
    this.paths.clear();
    this.portals = [];
    this.curbs = [];
    this.busStops = [];
    // Tunnels : routes qui sortent par le bas de la carte (vers l'autoroute).
    for (let x = 0; x < W; x++) {
      const i = (this.H - 1) * W + x;
      if (this.road[i]) this.portals.push({ kind: 'tunnel', road: i, x: x + 0.5, y: this.H + 0.9, dx: 0, dy: 1 });
    }
    // Parkings souterrains, dépose-minute des terminaux, gares routières.
    for (const b of s.buildings) {
      if (b.buildRemaining > 0) continue;
      const d = BUILDINGS[b.type];
      const f = bFootprint(b);
      const border: { i: number; ox: number; oy: number }[] = [];
      for (let x = b.x; x < b.x + f.w; x++) {
        border.push({ i: (b.y - 1) * W + x, ox: 0, oy: 1 }, { i: (b.y + f.h) * W + x, ox: 0, oy: -1 });
      }
      for (let y = b.y; y < b.y + f.h; y++) {
        border.push({ i: y * W + b.x - 1, ox: 1, oy: 0 }, { i: y * W + b.x + f.w, ox: -1, oy: 0 });
      }
      const touching = border.filter((c) => c.i >= 0 && c.i < W * this.H && this.road[c.i]);
      if (!touching.length) continue;
      if (b.type === 'parking_s' || b.type === 'parking_m') {
        const c = touching[0];
        const rx = (c.i % W) + 0.5;
        const ry = Math.floor(c.i / W) + 0.5;
        // La rampe part du bord du parking et s'enfonce d'une case vers l'intérieur.
        this.portals.push({ kind: 'parking', road: c.i, x: rx + c.ox * 1.6, y: ry + c.oy * 1.6, dx: c.ox, dy: c.oy });
      } else if (d.isTerminal) for (const c of touching) this.curbs.push(c.i);
      else if (b.type === 'bus_station' || b.type === 'hotel') for (const c of touching) this.busStops.push(c.i);
    }
    // Les véhicules dont le trajet n'existe plus disparaissent.
    this.cars = this.cars.filter((c) => c.pts.every((p) => this.inMapOrPortal(p)));
  }

  private inMapOrPortal(p: { x: number; y: number }): boolean {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return true;
    return !!this.road[y * this.W + x] || this.portals.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 2.2);
  }

  private rnd(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /** Plus court chemin sur les cases de route (largeur d'abord). */
  private path(a: number, b: number): number[] | null {
    const k = a + ':' + b;
    if (this.paths.has(k)) return this.paths.get(k)!;
    const W = this.W;
    const prev = new Int32Array(W * this.H).fill(-1);
    prev[a] = a;
    const q = [a];
    let found = a === b;
    for (let h = 0; h < q.length && !found; h++) {
      const c = q[h];
      const x = c % W;
      const y = (c / W) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= this.H) continue;
        const n = ny * W + nx;
        if (!this.road[n] || prev[n] !== -1) continue;
        prev[n] = c;
        if (n === b) {
          found = true;
          break;
        }
        q.push(n);
      }
    }
    let out: number[] | null = null;
    if (found) {
      out = [b];
      while (out[out.length - 1] !== a) out.push(prev[out[out.length - 1]]);
      out.reverse();
    }
    this.paths.set(k, out);
    return out;
  }

  /** Trajet décalé sur la voie de droite, avec les rampes de début et de fin. */
  private build(cells: number[], from: Portal | null, to: Portal | null): Pick<Car, 'pts' | 'hs' | 'len' | 'total' | 'lane'> {
    const W = this.W;
    const c = cells.map((i) => ({ x: (i % W) + 0.5, y: ((i / W) | 0) + 0.5 }));
    const center: { x: number; y: number; h: number }[] = [];
    if (from) center.push({ x: from.x, y: from.y, h: DEPTH }, { x: from.x - from.dx * 0.9, y: from.y - from.dy * 0.9, h: 0 });
    for (const p of c) center.push({ ...p, h: 0 });
    if (to) center.push({ x: to.x - to.dx * 0.9, y: to.y - to.dy * 0.9, h: 0 }, { x: to.x, y: to.y, h: DEPTH });
    // Décalage à droite : normale (-dy, dx) dans le repère de la carte (y vers le bas).
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < center.length; i++) {
      const a = center[Math.max(0, i - 1)];
      const b = center[Math.min(center.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      pts.push({ x: center[i].x - (dy / l) * LANE, y: center[i].y + (dx / l) * LANE });
    }
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const lane: string[] = [];
    for (let i = 1; i < center.length; i++) lane.push(`${center[i - 1].x.toFixed(1)},${center[i - 1].y.toFixed(1)}>${center[i].x.toFixed(1)},${center[i].y.toFixed(1)}`);
    return { pts, hs: center.map((p) => p.h), len, total: len[len.length - 1], lane };
  }

  private spawn(): void {
    const tunnels = this.portals.filter((p) => p.kind === 'tunnel');
    const parks = this.portals.filter((p) => p.kind === 'parking');
    if (!tunnels.length && !parks.length) return;
    const pick = <T,>(a: T[]): T => a[Math.floor(this.rnd() * a.length)];
    const r = this.rnd();
    let from: Portal;
    let to: Portal;
    let stop: number | null = null;
    let kind: Car['kind'] = this.rnd() < 0.15 ? 'taxi' : 'car';
    if (r < 0.35 && parks.length) {
      // Arrivée : tunnel → parking souterrain
      from = tunnels.length ? pick(tunnels) : pick(parks);
      to = pick(parks);
    } else if (r < 0.6 && parks.length) {
      // Départ : parking → (dépose-minute) → tunnel
      from = pick(parks);
      to = tunnels.length ? pick(tunnels) : pick(parks);
    } else if (r < 0.9 && this.curbs.length) {
      // Dépose-minute : tunnel → terminal → tunnel
      from = tunnels.length ? pick(tunnels) : pick(parks);
      to = tunnels.length ? pick(tunnels) : pick(parks);
      stop = pick(this.curbs);
    } else if (this.busStops.length) {
      from = tunnels.length ? pick(tunnels) : pick(parks);
      to = tunnels.length ? pick(tunnels) : pick(parks);
      stop = pick(this.busStops);
      kind = 'bus';
    } else return;
    let cells: number[] | null;
    let stopIdx = -1;
    if (stop !== null) {
      const p1 = this.path(from.road, stop);
      const p2 = this.path(stop, to.road);
      if (!p1 || !p2) return;
      cells = [...p1, ...p2.slice(1)];
      stopIdx = p1.length - 1;
    } else cells = this.path(from.road, to.road);
    if (!cells || (from === to && stop === null)) return;
    const geo = this.build(cells, from, to);
    const stopAt = stopIdx >= 0 ? geo.len[stopIdx + 2] : -1;
    this.cars.push({ ...geo, s: 0, speed: kind === 'bus' ? 0.9 : 1.1 + this.rnd() * 0.5, stopAt, stopLeft: 2 + this.rnd() * 4, kind, seed: Math.floor(this.rnd() * 1e6) });
  }

  /** Avance la circulation de `dt` secondes ; `target` = nombre de véhicules souhaité. */
  update(s: GameState, realTime: number, simSpeed: number): void {
    this.sync(s);
    const dt = this.last ? Math.min(0.1, (realTime - this.last) / 1000) : 0;
    this.last = realTime;
    if (simSpeed <= 0) return;
    const k = dt * (1 + 0.6 * (simSpeed - 1));
    // Densité : liée à l'affluence du terminal, réduite la nuit.
    const mod = s.time % 1440;
    const night = mod < 330 || mod > 1350 ? 0.35 : 1;
    const target = Math.round(Math.min(70, 6 + s.pax.live.inTerminal / 6 + s.flights.length * 0.4) * night);
    this.spawnAcc += k;
    if (this.cars.length < target && this.spawnAcc > 0.35) {
      this.spawnAcc = 0;
      this.spawn();
    }
    // Distances de sécurité : on regarde le véhicule devant sur le même tronçon.
    const occupancy = new Map<string, number[]>();
    for (const c of this.cars) {
      const seg = this.segIndex(c);
      if (seg < 0) continue;
      const key = c.lane[seg];
      (occupancy.get(key) ?? occupancy.set(key, []).get(key)!).push(c.s - c.len[seg]);
    }
    for (const c of this.cars) {
      if (c.stopAt >= 0 && c.s >= c.stopAt && c.stopLeft > 0) {
        c.stopLeft -= k;
        continue;
      }
      let v = c.speed;
      const seg = this.segIndex(c);
      if (seg >= 0) {
        const mine = c.s - c.len[seg];
        const others = occupancy.get(c.lane[seg]) ?? [];
        const segLen = c.len[seg + 1] - c.len[seg];
        let gap = Infinity;
        for (const o of others) if (o > mine + 1e-4) gap = Math.min(gap, o - mine);
        // Véhicule au début du tronçon suivant
        if (seg + 1 < c.lane.length) for (const o of occupancy.get(c.lane[seg + 1]) ?? []) gap = Math.min(gap, segLen - mine + o);
        if (gap < 0.55) v = 0;
        else if (gap < 1) v *= (gap - 0.55) / 0.45;
      }
      let next = c.s + v * k;
      if (c.stopAt >= 0 && c.s < c.stopAt && next > c.stopAt) next = c.stopAt;
      c.s = next;
    }
    this.cars = this.cars.filter((c) => c.s < c.total);
  }

  private segIndex(c: Car): number {
    for (let i = 0; i < c.len.length - 1; i++) if (c.s < c.len[i + 1]) return i;
    return -1;
  }

  poses(): CarPose[] {
    const out: CarPose[] = [];
    for (const c of this.cars) {
      const i = this.segIndex(c);
      if (i < 0) continue;
      const a = c.pts[i];
      const b = c.pts[i + 1];
      const t = (c.s - c.len[i]) / Math.max(1e-6, c.len[i + 1] - c.len[i]);
      const h = c.hs[i] + (c.hs[i + 1] - c.hs[i]) * t;
      if (h < -0.32) continue; // entièrement sous terre
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h, hdg: Math.atan2(b.y - a.y, b.x - a.x), kind: c.kind, seed: c.seed });
    }
    return out;
  }

  get count(): number {
    return this.cars.length;
  }
}
