import { AIRCRAFT } from '../data/aircraft';
import { BUILDINGS, footprint } from '../data/buildings';
import { clamp } from '../core/format';
import { canBuyParcel, parcelCount } from '../sim/construction';
import { visibleFlights } from '../sim/flights';
import { bFootprint, getWorld } from '../sim/world';
import type { Building, GameState, Pt } from '../sim/types';
import { daylight, drawPlane, flightPose, GLYPH, mix, minuteOfDay, serviceVehicles, type Project } from './common';
import { drawGround, FLAT, GroundCache } from './ground';
import { drawLayers } from './overlays';
import { ZOOM_MAX, ZOOM_MIN, type Camera, type FrameInfo, type GameView } from './view';
import { drawWeather2D } from './weatherfx';

/** Vue isométrique (rotation par quarts de tour). */
const K0 = 16;

export class ViewIso implements GameView {
  kind = 'iso' as const;
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private W = 72;
  private H = 56;
  private cache = new GroundCache();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
  }
  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }
  dispose(): void {
    this.canvas.remove();
  }

  private q(cam: Camera): number {
    return ((Math.round(cam.rot / (Math.PI / 2)) % 4) + 4) % 4;
  }
  private rotT(q: number, x: number, y: number): [number, number] {
    const { W, H } = this;
    switch (q) {
      case 1: return [H - y, x];
      case 2: return [W - x, H - y];
      case 3: return [y, W - x];
      default: return [x, y];
    }
  }
  private unrotT(q: number, rx: number, ry: number): [number, number] {
    const { W, H } = this;
    switch (q) {
      case 1: return [ry, H - rx];
      case 2: return [W - rx, H - ry];
      case 3: return [W - ry, rx];
      default: return [rx, ry];
    }
  }
  private k(cam: Camera): number {
    return cam.zoom * 0.75;
  }
  /** Projection case → écran, avec élévation z (en cases). */
  private proj(cam: Camera): (x: number, y: number, z?: number) => [number, number] {
    const q = this.q(cam);
    const k = this.k(cam);
    const [crx, cry] = this.rotT(q, cam.cx, cam.cy);
    const csx = (crx - cry) * k;
    const csy = ((crx + cry) * k) / 2;
    return (x, y, z = 0) => {
      const [rx, ry] = this.rotT(q, x, y);
      return [(rx - ry) * k - csx + this.w / 2, ((rx + ry) * k) / 2 - csy + this.h / 2 - z * k * 0.9];
    };
  }

  screenToTile(s: GameState, cam: Camera, x: number, y: number): Pt {
    this.W = s.map.w;
    this.H = s.map.h;
    const q = this.q(cam);
    const k = this.k(cam);
    const [crx, cry] = this.rotT(q, cam.cx, cam.cy);
    const sx = x - this.w / 2 + (crx - cry) * k;
    const sy = y - this.h / 2 + ((crx + cry) * k) / 2;
    const a = sx / k;
    const b = (2 * sy) / k;
    const rx = (a + b) / 2;
    const ry = (b - a) / 2;
    const [tx, ty] = this.unrotT(q, rx, ry);
    return { x: tx, y: ty };
  }
  pan(cam: Camera, dx: number, dy: number): void {
    const fake = { map: { w: this.W, h: this.H } } as GameState;
    const p = this.screenToTile(fake, cam, this.w / 2 - dx, this.h / 2 - dy);
    cam.cx = clamp(p.x, -10, this.W + 10);
    cam.cy = clamp(p.y, -10, this.H + 10);
  }
  zoom(cam: Camera, factor: number, x: number, y: number, s: GameState): void {
    const before = this.screenToTile(s, cam, x, y);
    cam.zoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const after = this.screenToTile(s, cam, x, y);
    cam.cx += before.x - after.x;
    cam.cy += before.y - after.y;
  }
  private rotAcc = 0;
  rotate(cam: Camera, d: number): void {
    // Rotation par quarts de tour, déclenchée après un geste suffisant.
    this.rotAcc += d;
    if (Math.abs(this.rotAcc) > 0.6) {
      cam.rot += Math.sign(this.rotAcc) * (Math.PI / 2);
      this.rotAcc = 0;
    }
  }

  render(s: GameState, cam: Camera, fi: FrameInfo): void {
    this.W = s.map.w;
    this.H = s.map.h;
    const ctx = this.ctx;
    const q = this.q(cam);
    const k = this.k(cam);
    const pr = this.proj(cam);
    const P: Project = (x, y) => pr(x, y, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const dl = daylight(minuteOfDay(s, fi.frac));
    ctx.fillStyle = mix('#0b1a33', '#9cc7e8', dl);
    ctx.fillRect(0, 0, this.w, this.h);

    // Sol isométrique en cache (une version par orientation)
    const W = this.W;
    const H = this.H;
    const [Wr, Hr] = q % 2 === 0 ? [W, H] : [H, W];
    const cw = (W + H) * K0;
    const ch = ((W + H) * K0) / 2;
    const ground = this.cache.get(s, 'iso' + q, cw, ch + 2, (c) =>
      drawGround(c, s, (x, y) => {
        const [rx, ry] = this.rotT(q, x, y);
        return [(rx - ry) * K0 + Hr * K0, ((rx + ry) * K0) / 2];
      }, K0),
    );
    void Wr;
    const origin = pr(...this.unrotT(q, 0, 0));
    // Le pixel (0,0) du cache correspond au point iso (sx = -Hr·K0, sy = 0).
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ground as CanvasImageSource, origin[0] - Hr * k, origin[1], (W + H) * k, ((W + H) * k) / 2);
    // Épaisseur du plateau
    const c1 = pr(...this.unrotT(q, 0, Hr));
    const c2 = pr(...this.unrotT(q, Wr, Hr));
    const c3 = pr(...this.unrotT(q, Wr, 0));
    ctx.fillStyle = '#4a3b2a';
    ctx.beginPath();
    ctx.moveTo(c1[0], c1[1]);
    ctx.lineTo(c2[0], c2[1]);
    ctx.lineTo(c3[0], c3[1]);
    ctx.lineTo(c3[0], c3[1] + k);
    ctx.lineTo(c2[0], c2[1] + k);
    ctx.lineTo(c1[0], c1[1] + k);
    ctx.closePath();
    ctx.fill();

    const w = getWorld(s);
    // Liste à trier par profondeur : bâtiments en relief + avions
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [];
    for (const b of s.buildings) {
      if (FLAT.has(b.type)) continue;
      const f = bFootprint(b);
      const [rx, ry] = this.rotT(q, b.x + f.w / 2, b.y + f.h / 2);
      items.push({ depth: rx + ry, draw: () => this.drawBox(s, b, pr, k, dl, w.problems.has(b.id)) });
    }
    const t = fi.realTime;
    for (const f of visibleFlights(s)) {
      const pose = flightPose(f, fi.prev, fi.frac);
      const [rx, ry] = this.rotT(q, pose.x, pose.y);
      items.push({
        depth: rx + ry + (pose.alt > 0.05 ? 1000 : 0),
        draw: () => {
          for (const v of serviceVehicles(f, t)) {
            const p = pr(v.x, v.y, 0.15);
            ctx.fillStyle = v.color;
            ctx.fillRect(p[0] - k * 0.2, p[1] - k * 0.12, k * 0.4, k * 0.24);
          }
          this.drawPlaneIso(f, pose, pr, q, k, fi.selectedFlight === f.id);
        },
      });
    }
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw();

    if (dl < 0.98) {
      ctx.fillStyle = `rgba(8,16,42,${(1 - dl) * 0.5})`;
      ctx.fillRect(0, 0, this.w, this.h);
      if (dl < 0.6) this.lights(s, pr, 1 - dl);
    }
    drawWeather2D(ctx, s, this.w, this.h, t, fi.quality);
    if (fi.layers.size) drawLayers(ctx, s, P, k, fi.layers);
    if (fi.parcelMode) this.parcels(s, P);
    if (fi.selectedBuilding !== null) {
      const b = w.byId.get(fi.selectedBuilding);
      if (b) {
        const f = bFootprint(b);
        this.outline(P, b.x, b.y, f.w, f.h, '#38bdf8', 3);
      }
    }
    if (fi.ghost) {
      const g = fi.ghost;
      if (g.cells) for (const c of g.cells) this.fillQuad(P, c.p.x, c.p.y, 1, 1, c.ok ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.5)');
      else {
        const f = footprint(BUILDINGS[g.type], g.rot);
        this.fillQuad(P, g.x, g.y, f.w, f.h, g.ok ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)');
        this.outline(P, g.x, g.y, f.w, f.h, g.ok ? '#22c55e' : '#ef4444', 2);
      }
    }
  }

  private fillQuad(P: Project, x: number, y: number, w: number, h: number, color: string): void {
    const ctx = this.ctx;
    const pts = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fill();
  }
  private outline(P: Project, x: number, y: number, w: number, h: number, color: string, lw: number): void {
    const ctx = this.ctx;
    const pts = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.stroke();
  }

  private drawBox(s: GameState, b: Building, pr: (x: number, y: number, z?: number) => [number, number], k: number, dl: number, problem: boolean): void {
    const ctx = this.ctx;
    const d = BUILDINGS[b.type];
    const f = bFootprint(b);
    if (b.type === 'trees') {
      for (let i = 0; i < 4; i++) {
        const tx = b.x + 0.5 + (i % 2);
        const ty = b.y + 0.5 + Math.floor(i / 2);
        const base = pr(tx, ty, 0);
        const top = pr(tx, ty, 1.4);
        ctx.fillStyle = '#5b3a1e';
        ctx.fillRect(base[0] - 1.5, top[1] + k * 0.5, 3, base[1] - top[1] - k * 0.5);
        ctx.fillStyle = mix('#1f5130', '#3f9a5a', dl);
        ctx.beginPath();
        ctx.moveTo(top[0], top[1]);
        ctx.lineTo(top[0] - k * 0.45, base[1] - k * 0.35);
        ctx.lineTo(top[0] + k * 0.45, base[1] - k * 0.35);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    const built = b.buildRemaining <= 0;
    let hgt = d.height * (1 + 0.15 * (b.level - 1));
    if (!built) hgt *= 0.35;
    const x0 = b.x;
    const y0 = b.y;
    const x1 = b.x + f.w;
    const y1 = b.y + f.h;
    const base = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const;
    const faces: { pts: [number, number][]; shade: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const a = base[i];
      const c = base[(i + 1) % 4];
      const pts: [number, number][] = [pr(a[0], a[1], 0), pr(c[0], c[1], 0), pr(c[0], c[1], hgt), pr(a[0], a[1], hgt)];
      faces.push({ pts, shade: i % 2 === 0 ? 0.78 : 0.62 });
    }
    faces.sort((a, b) => (a.pts[0][1] + a.pts[1][1]) - (b.pts[0][1] + b.pts[1][1]));
    const wall = built ? d.color : '#a3a3a3';
    for (const fc of faces) {
      ctx.fillStyle = mix('#000000', wall, fc.shade * (0.55 + 0.45 * dl));
      ctx.beginPath();
      ctx.moveTo(fc.pts[0][0], fc.pts[0][1]);
      for (const p of fc.pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
      ctx.fill();
      if (d.isTerminal && built) {
        // Bande vitrée
        ctx.strokeStyle = `rgba(56,189,248,${0.5 + (1 - dl) * 0.4})`;
        ctx.lineWidth = Math.max(1, k * 0.15);
        const m1 = [(fc.pts[0][0] + fc.pts[3][0]) / 2, (fc.pts[0][1] + fc.pts[3][1]) / 2];
        const m2 = [(fc.pts[1][0] + fc.pts[2][0]) / 2, (fc.pts[1][1] + fc.pts[2][1]) / 2];
        ctx.beginPath();
        ctx.moveTo(m1[0], m1[1]);
        ctx.lineTo(m2[0], m2[1]);
        ctx.stroke();
      }
    }
    // Toit
    const roof = base.map((p) => pr(p[0], p[1], hgt));
    ctx.fillStyle = built ? mix('#000000', d.roof ?? d.color, 0.55 + 0.45 * dl) : 'rgba(250,204,21,0.8)';
    ctx.beginPath();
    ctx.moveTo(roof[0][0], roof[0][1]);
    for (const p of roof.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Tour de contrôle : vigie vitrée
    if (b.type.startsWith('tower') && built) {
      const c = pr(x0 + f.w / 2, y0 + f.h / 2, hgt);
      ctx.fillStyle = 'rgba(56,189,248,0.85)';
      ctx.fillRect(c[0] - k * 0.6, c[1] - k * 0.9, k * 1.2, k * 0.7);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(c[0] - k * 0.7, c[1] - k * 1.05, k * 1.4, k * 0.2);
    }
    const glyph = GLYPH[b.type];
    const c = pr(x0 + f.w / 2, y0 + f.h / 2, hgt);
    if (glyph && k > 7) {
      ctx.font = `${clamp(Math.min(f.w, f.h) * k * 0.5, 9, 30)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(glyph, c[0], c[1]);
    }
    if (b.brokenFor > 0 || problem) {
      ctx.font = `${clamp(k, 10, 22)}px system-ui, sans-serif`;
      ctx.fillText(b.brokenFor > 0 ? '🛠️' : '⚠️', c[0], c[1] - k);
    }
    void s;
  }

  private drawPlaneIso(f: Parameters<typeof drawPlane>[1], pose: { x: number; y: number; hdg: number; alt: number }, pr: (x: number, y: number, z?: number) => [number, number], q: number, k: number, selected: boolean): void {
    const ctx = this.ctx;
    const a = AIRCRAFT[f.aircraft];
    const o = pr(pose.x, pose.y, 0);
    const ex = pr(pose.x + 1, pose.y, 0);
    const ey = pr(pose.x, pose.y + 1, 0);
    const bx = [ex[0] - o[0], ex[1] - o[1]];
    const by = [ey[0] - o[0], ey[1] - o[1]];
    const altPx = pose.alt * k * 9;
    const drawAt = (dy: number, shadow: boolean) => {
      ctx.save();
      ctx.setTransform(this.dpr * bx[0], this.dpr * bx[1], this.dpr * by[0], this.dpr * by[1], this.dpr * o[0], this.dpr * (o[1] - dy));
      ctx.rotate(pose.hdg);
      if (shadow) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(0, 0, a.length / 2, a.length * 0.07, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(-a.length * 0.2, -a.span / 2, a.length * 0.1, a.span);
      } else drawPlane(ctx, f, a.length);
      ctx.restore();
    };
    void q;
    if (altPx > 1) drawAt(0, true);
    drawAt(altPx + k * 0.15, false);
    if (selected) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(o[0], o[1] - altPx, a.length * k * 0.7, a.length * k * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private lights(s: GameState, pr: (x: number, y: number, z?: number) => [number, number], night: number): void {
    const ctx = this.ctx;
    const w = getWorld(s);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,240,200,${0.8 * night})`;
    for (const r of w.runways) {
      const b = w.byId.get(r.id)!;
      const f = bFootprint(b);
      for (let i = 0; i <= (r.horizontal ? f.w : f.h); i++) {
        const pts = r.horizontal ? [[b.x + i, b.y + 0.1], [b.x + i, b.y + f.h - 0.1]] : [[b.x + 0.1, b.y + i], [b.x + f.w - 0.1, b.y + i]];
        for (const p of pts) {
          const sp = pr(p[0], p[1], 0);
          ctx.fillRect(sp[0] - 1.5, sp[1] - 1.5, 3, 3);
        }
      }
    }
    for (const b of s.buildings) {
      const d = BUILDINGS[b.type];
      if (FLAT.has(b.type) || d.linear || b.type === 'trees' || b.buildRemaining > 0) continue;
      const f = bFootprint(b);
      const c = pr(b.x + f.w / 2, b.y + f.h / 2, d.height * 0.5);
      const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], Math.max(f.w, f.h) * 14);
      g.addColorStop(0, `rgba(255,214,140,${0.3 * night})`);
      g.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = g;
      ctx.fillRect(c[0] - 200, c[1] - 200, 400, 400);
    }
    ctx.restore();
  }

  private parcels(s: GameState, P: Project): void {
    const { pw, ph } = parcelCount(s);
    const p = s.map.parcel;
    for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      if (!canBuyParcel(s, px, py)) continue;
      this.fillQuad(P, px * p, py * p, p, p, 'rgba(56,189,248,0.3)');
      this.outline(P, px * p, py * p, p, p, '#38bdf8', 2);
    }
  }
}
