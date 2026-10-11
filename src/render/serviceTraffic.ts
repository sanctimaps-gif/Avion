import { getWorld } from '../sim/world';
import type { GameState } from '../sim/types';
import type { VehicleModel } from './vehicles3d';

/**
 * Engins d'escale qui circulent sur les voies de service côté piste (visuel) :
 * chacun va d'une case à une autre du réseau par le plus court chemin, en roulant à droite.
 */
export interface ServicePose {
  x: number;
  y: number;
  hdg: number;
  model: VehicleModel;
  color?: string;
}

interface Veh {
  pts: { x: number; y: number }[];
  s: number;
  total: number;
  model: VehicleModel;
  color?: string;
}

const MODELS: [VehicleModel, string?][] = [['tapis_bagages'], ['catering'], ['camion_citerne'], ['voiture', '#f8fafc'], ['voiture', '#facc15'], ['tapis_bagages']];
const LANE = 0.18;

export class ServiceTraffic {
  private key = '';
  private W = 0;
  private cells: number[] = [];
  private set = new Set<number>();
  private vehs: Veh[] = [];
  private seed = 7;
  private last = 0;

  private rnd(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  private sync(s: GameState): void {
    const w = getWorld(s);
    const key = `${s.id}|${w.rev}`;
    if (key === this.key) return;
    this.key = key;
    this.W = s.map.w;
    this.cells = s.buildings.filter((b) => b.type === 'service_road' && b.buildRemaining <= 0).map((b) => b.y * this.W + b.x);
    this.set = new Set(this.cells);
    this.vehs = [];
  }

  /** Plus court chemin sur la voie de service (null si non reliées). */
  private path(a: number, b: number): number[] | null {
    const W = this.W;
    const prev = new Map<number, number>([[a, -1]]);
    const q = [a];
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      if (c === b) break;
      for (const n of [c - 1, c + 1, c - W, c + W]) {
        if (Math.abs((n % W) - (c % W)) > 1 || !this.set.has(n) || prev.has(n)) continue;
        prev.set(n, c);
        q.push(n);
      }
    }
    if (!prev.has(b)) return null;
    const out: number[] = [];
    for (let c = b; c !== -1; c = prev.get(c)!) out.push(c);
    return out.reverse();
  }

  /** Trajet à partir de la case `from` vers une case au hasard, décalé sur la voie de droite. */
  private trip(from: number, model: VehicleModel, color?: string): Veh | null {
    const W = this.W;
    for (let k = 0; k < 6; k++) {
      const to = this.cells[Math.floor(this.rnd() * this.cells.length)];
      const p = to === from ? null : this.path(from, to);
      if (!p || p.length < 3) continue;
      const c = p.map((i) => ({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 }));
      const pts = c.map((pt, i) => {
        const a = c[Math.max(0, i - 1)];
        const b = c[Math.min(c.length - 1, i + 1)];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        return { x: pt.x - (dy / l) * LANE, y: pt.y + (dx / l) * LANE };
      });
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return { pts, s: 0, total, model, color };
    }
    return null;
  }

  /** `realTime` en millisecondes. */
  update(s: GameState, realTime: number, simSpeed: number): void {
    const dt = this.last ? Math.max(0, (realTime - this.last) / 1000) : 0;
    this.last = realTime;
    this.sync(s);
    if (this.cells.length < 3 || simSpeed <= 0) return;
    const target = Math.min(8, Math.floor(this.cells.length / 5) + 1);
    while (this.vehs.length < target) {
      const [m, col] = MODELS[this.vehs.length % MODELS.length];
      const v = this.trip(this.cells[Math.floor(this.rnd() * this.cells.length)], m, col);
      if (!v) break;
      this.vehs.push(v);
    }
    const speed = 0.9 * (1 + 0.6 * (simSpeed - 1));
    for (let i = 0; i < this.vehs.length; i++) {
      const v = this.vehs[i];
      v.s += speed * Math.min(dt, 0.1);
      if (v.s >= v.total) {
        const end = v.pts[v.pts.length - 1];
        const cell = Math.floor(end.y) * this.W + Math.floor(end.x);
        this.vehs[i] = this.trip(cell, v.model, v.color) ?? { ...v, s: 0, pts: [...v.pts].reverse() };
      }
    }
  }

  poses(): ServicePose[] {
    return this.vehs.map((v) => {
      let d = v.s;
      for (let i = 1; i < v.pts.length; i++) {
        const a = v.pts[i - 1];
        const b = v.pts[i];
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        if (d <= l || i === v.pts.length - 1) {
          const t = l > 0 ? Math.min(1, d / l) : 0;
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, hdg: Math.atan2(b.y - a.y, b.x - a.x), model: v.model, color: v.color };
        }
        d -= l;
      }
      const p = v.pts[v.pts.length - 1];
      return { x: p.x, y: p.y, hdg: 0, model: v.model, color: v.color };
    });
  }
}
