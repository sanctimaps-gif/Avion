import { BUILDINGS } from '../data/buildings';
import { ownedAt } from '../sim/construction';
import { bFootprint, getWorld } from '../sim/world';
import type { Building, GameState } from '../sim/types';
import { TERRAIN_COLORS, type Project } from './common';

/**
 * Dessin de la couche "sol" (terrain + infrastructures plates : pistes,
 * taxiways, routes, postes, parkings) dans une projection quelconque.
 * Utilisé en 2D (projection plane), en isométrique (projection losange)
 * et comme texture du sol en 3D : les trois vues partagent exactement
 * le même rendu des données.
 */
export const FLAT = new Set(['runway_s', 'runway_m', 'runway_l', 'taxiway', 'road', 'stand_s', 'stand_m', 'stand_l', 'stand_xl', 'parking_s', 'deicing', 'solar']);

function quad(ctx: CanvasRenderingContext2D, P: Project, x0: number, y0: number, x1: number, y1: number): void {
  const a = P(x0, y0);
  const b = P(x1, y0);
  const c = P(x1, y1);
  const d = P(x0, y1);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]);
  ctx.lineTo(d[0], d[1]);
  ctx.closePath();
}

function line(ctx: CanvasRenderingContext2D, P: Project, x0: number, y0: number, x1: number, y1: number): void {
  const a = P(x0, y0);
  const b = P(x1, y1);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

export function drawGround(ctx: CanvasRenderingContext2D, s: GameState, P: Project, scale: number): void {
  const W = s.map.w;
  const H = s.map.h;
  const w = getWorld(s);
  // Terrain
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = s.map.terrain[y * W + x];
      const owned = ownedAt(s, x, y);
      let col = TERRAIN_COLORS[t] ?? TERRAIN_COLORS[0];
      if (t === 0 && (x * 7 + y * 13) % 5 === 0) col = '#62a352';
      ctx.fillStyle = col;
      quad(ctx, P, x, y, x + 1.02, y + 1.02);
      ctx.fill();
      if (!owned) {
        ctx.fillStyle = 'rgba(20,30,45,0.32)';
        quad(ctx, P, x, y, x + 1.02, y + 1.02);
        ctx.fill();
      }
      if (t === 2) {
        ctx.fillStyle = '#245a2e';
        const c = P(x + 0.5, y + 0.5);
        ctx.beginPath();
        ctx.arc(c[0], c[1], scale * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Limites de parcelles possédées
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(1, scale * 0.06);
  ctx.setLineDash([scale * 0.4, scale * 0.3]);
  const p = s.map.parcel;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x % p !== 0 && y % p !== 0) continue;
    const o = ownedAt(s, x, y);
    if (x % p === 0 && x > 0 && o !== ownedAt(s, x - 1, y)) line(ctx, P, x, y, x, y + 1);
    if (y % p === 0 && y > 0 && o !== ownedAt(s, x, y - 1)) line(ctx, P, x, y, x + 1, y);
  }
  ctx.setLineDash([]);

  // Infrastructures plates (routes et taxiways d'abord, puis le reste)
  const flat = s.buildings.filter((b) => FLAT.has(b.type));
  flat.sort((a, b) => order(a) - order(b));
  for (const b of flat) drawFlat(ctx, s, b, P, scale, w.occ);
}

function order(b: Building): number {
  if (b.type === 'road') return 0;
  if (b.type === 'taxiway') return 1;
  if (b.type.startsWith('runway')) return 3;
  return 2;
}

function sameAt(s: GameState, occ: Int32Array, x: number, y: number, types: string[]): boolean {
  if (x < 0 || y < 0 || x >= s.map.w || y >= s.map.h) return false;
  const id = occ[y * s.map.w + x];
  if (!id) return false;
  const b = getWorld(s).byId.get(id);
  return !!b && types.some((t) => b.type.startsWith(t));
}

function drawFlat(ctx: CanvasRenderingContext2D, s: GameState, b: Building, P: Project, scale: number, occ: Int32Array): void {
  const d = BUILDINGS[b.type];
  const f = bFootprint(b);
  const x0 = b.x;
  const y0 = b.y;
  const x1 = b.x + f.w;
  const y1 = b.y + f.h;
  const building = b.buildRemaining > 0;
  ctx.fillStyle = d.color;
  quad(ctx, P, x0, y0, x1, y1);
  ctx.fill();
  ctx.lineWidth = Math.max(1, scale * 0.06);
  if (b.type === 'road') {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.setLineDash([scale * 0.2, scale * 0.2]);
    const cx = x0 + 0.5;
    const cy = y0 + 0.5;
    if (sameAt(s, occ, b.x - 1, b.y, ['road'])) line(ctx, P, x0, cy, cx, cy);
    if (sameAt(s, occ, b.x + 1, b.y, ['road'])) line(ctx, P, cx, cy, x1, cy);
    if (sameAt(s, occ, b.x, b.y - 1, ['road'])) line(ctx, P, cx, y0, cx, cy);
    if (sameAt(s, occ, b.x, b.y + 1, ['road'])) line(ctx, P, cx, cy, cx, y1);
    ctx.setLineDash([]);
  } else if (b.type === 'taxiway') {
    ctx.strokeStyle = '#facc15';
    const cx = x0 + 0.5;
    const cy = y0 + 0.5;
    const t = ['taxiway', 'runway', 'stand', 'deicing', 'hangar', 'cargo'];
    let any = false;
    if (sameAt(s, occ, b.x - 1, b.y, t)) { line(ctx, P, x0, cy, cx, cy); any = true; }
    if (sameAt(s, occ, b.x + 1, b.y, t)) { line(ctx, P, cx, cy, x1, cy); any = true; }
    if (sameAt(s, occ, b.x, b.y - 1, t)) { line(ctx, P, cx, y0, cx, cy); any = true; }
    if (sameAt(s, occ, b.x, b.y + 1, t)) { line(ctx, P, cx, cy, cx, y1); any = true; }
    if (!any) line(ctx, P, x0 + 0.2, cy, x1 - 0.2, cy);
  } else if (d.runwayLength) {
    const horiz = f.w >= f.h;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, scale * 0.08);
    // Axe central en pointillés
    ctx.setLineDash([scale * 0.8, scale * 0.6]);
    if (horiz) line(ctx, P, x0 + 2, (y0 + y1) / 2, x1 - 2, (y0 + y1) / 2);
    else line(ctx, P, (x0 + x1) / 2, y0 + 2, (x0 + x1) / 2, y1 - 2);
    ctx.setLineDash([]);
    // Seuils ("piano")
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const n = Math.max(2, Math.round((horiz ? f.h : f.w) * 2));
    for (let i = 0; i < n; i++) {
      const o = (i + 0.25) / n;
      const w2 = 0.5 / n;
      if (horiz) {
        for (const tx of [x0 + 0.2, x1 - 1.0]) {
          quad(ctx, P, tx, y0 + o * f.h, tx + 0.8, y0 + (o + w2) * f.h);
          ctx.fill();
        }
      } else {
        for (const ty of [y0 + 0.2, y1 - 1.0]) {
          quad(ctx, P, x0 + o * f.w, ty, x0 + (o + w2) * f.w, ty + 0.8);
          ctx.fill();
        }
      }
    }
    // Bords
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1, scale * 0.04);
    if (horiz) {
      line(ctx, P, x0, y0 + 0.1, x1, y0 + 0.1);
      line(ctx, P, x0, y1 - 0.1, x1, y1 - 0.1);
    } else {
      line(ctx, P, x0 + 0.1, y0, x0 + 0.1, y1);
      line(ctx, P, x1 - 0.1, y0, x1 - 0.1, y1);
    }
  } else if (d.standSize) {
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = Math.max(1, scale * 0.07);
    quad(ctx, P, x0 + 0.15, y0 + 0.15, x1 - 0.15, y1 - 0.15);
    ctx.stroke();
    const c = P((x0 + x1) / 2, (y0 + y1) / 2);
    ctx.fillStyle = 'rgba(250,204,21,0.9)';
    ctx.font = `bold ${Math.max(8, scale * 0.7)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.standSize, c[0], c[1]);
  } else if (b.type === 'parking_s') {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(1, scale * 0.04);
    for (let i = 1; i < f.w * 2; i++) line(ctx, P, x0 + i / 2, y0 + 0.3, x0 + i / 2, y0 + f.h / 2 - 0.3);
    for (let i = 1; i < f.w * 2; i++) line(ctx, P, x0 + i / 2, y0 + f.h / 2 + 0.3, x0 + i / 2, y1 - 0.3);
  } else if (b.type === 'solar') {
    ctx.strokeStyle = 'rgba(191,219,254,0.7)';
    for (let i = 0; i <= f.h * 2; i++) line(ctx, P, x0, y0 + i / 2, x1, y0 + i / 2);
  } else if (b.type === 'deicing') {
    ctx.strokeStyle = '#e0f2fe';
    quad(ctx, P, x0 + 0.3, y0 + 0.3, x1 - 0.3, y1 - 0.3);
    ctx.stroke();
  }
  if (building) {
    ctx.fillStyle = 'rgba(250,204,21,0.35)';
    quad(ctx, P, x0, y0, x1, y1);
    ctx.fill();
  }
}

/** Cache hors écran de la couche sol, reconstruit à chaque modification. */
export class GroundCache {
  canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  key = '';
  get(s: GameState, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    const k = `${s.id}|${getWorld(s).rev}|${key}`;
    if (this.canvas && this.key === k) return this.canvas;
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      this.canvas = c;
    }
    const ctx = (this.canvas as HTMLCanvasElement).getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    draw(ctx);
    this.key = k;
    return this.canvas;
  }
}
