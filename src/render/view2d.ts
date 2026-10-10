import { AIRCRAFT } from '../data/aircraft';
import { BUILDINGS, footprint } from '../data/buildings';
import { clamp } from '../core/format';
import { canBuyParcel, parcelCount } from '../sim/construction';
import { visibleFlights } from '../sim/flights';
import { bFootprint, getWorld } from '../sim/world';
import type { GameState, Pt } from '../sim/types';
import { daylight, drawPlane, flightPose, GLYPH, minuteOfDay, serviceVehicles, type Project } from './common';
import { drawGround, FLAT, GroundCache } from './ground';
import { drawLayers } from './overlays';
import { ZOOM_MAX, ZOOM_MIN, type Camera, type FrameInfo, type GameView, type ViewKind } from './view';
import { drawWeather2D } from './weatherfx';

/** Vue 2D du dessus (et base de la vue hybride). */
const CACHE_PX = 24;

export class View2D implements GameView {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private cache = new GroundCache();

  constructor(public kind: ViewKind) {
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

  private P(cam: Camera): Project {
    const z = cam.zoom;
    const ox = this.w / 2 - cam.cx * z;
    const oy = this.h / 2 - cam.cy * z;
    return (x, y) => [x * z + ox, y * z + oy];
  }

  screenToTile(_s: GameState, cam: Camera, x: number, y: number): Pt {
    return { x: (x - this.w / 2) / cam.zoom + cam.cx, y: (y - this.h / 2) / cam.zoom + cam.cy };
  }
  pan(cam: Camera, dx: number, dy: number): void {
    cam.cx -= dx / cam.zoom;
    cam.cy -= dy / cam.zoom;
  }
  zoom(cam: Camera, factor: number, x: number, y: number, s: GameState): void {
    const before = this.screenToTile(s, cam, x, y);
    cam.zoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const after = this.screenToTile(s, cam, x, y);
    cam.cx += before.x - after.x;
    cam.cy += before.y - after.y;
  }
  rotate(): void {
    /* pas de rotation en vue du dessus */
  }
  dispose(): void {
    this.canvas.remove();
  }

  render(s: GameState, cam: Camera, fi: FrameInfo): void {
    const ctx = this.ctx;
    const z = cam.zoom;
    const P = this.P(cam);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#2b4a2a';
    ctx.fillRect(0, 0, this.w, this.h);
    // Sol (mis en cache)
    const W = s.map.w;
    const H = s.map.h;
    const ground = this.cache.get(s, 'top', W * CACHE_PX, H * CACHE_PX, (c) => drawGround(c, s, (x, y) => [x * CACHE_PX, y * CACHE_PX], CACHE_PX));
    const o = P(0, 0);
    ctx.imageSmoothingEnabled = z < CACHE_PX;
    ctx.drawImage(ground as CanvasImageSource, o[0], o[1], W * z, H * z);

    const w = getWorld(s);
    const t = fi.realTime;
    // Bâtiments en relief
    for (const b of s.buildings) {
      const d = BUILDINGS[b.type];
      if (FLAT.has(b.type)) {
        if (b.buildRemaining > 0) this.progress(P, b, z);
        continue;
      }
      const f = bFootprint(b);
      const [x0, y0] = P(b.x, b.y);
      const bw = f.w * z;
      const bh = f.h * z;
      if (x0 > this.w || y0 > this.h || x0 + bw < 0 || y0 + bh < 0) continue;
      if (b.type === 'trees') {
        ctx.fillStyle = '#2f7d4a';
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(x0 + bw * (0.3 + (i % 2) * 0.4), y0 + bh * (0.3 + Math.floor(i / 2) * 0.4), z * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      // Ombre portée
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      const sh = Math.min(z * 0.6, d.height * z * 0.25);
      ctx.fillRect(x0 + sh, y0 + sh, bw, bh);
      ctx.fillStyle = d.roof ?? d.color;
      ctx.fillRect(x0, y0, bw, bh);
      ctx.fillStyle = d.color;
      ctx.fillRect(x0 + bw * 0.08, y0 + bh * 0.08, bw * 0.84, bh * 0.84);
      ctx.strokeStyle = 'rgba(15,23,42,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, bw - 1, bh - 1);
      if (d.isTerminal) {
        // Façade vitrée
        ctx.fillStyle = 'rgba(56,189,248,0.55)';
        ctx.fillRect(x0 + bw * 0.08, y0 + bh * 0.08, bw * 0.84, Math.max(2, bh * 0.12));
      }
      const glyph = GLYPH[b.type];
      if (glyph && z >= 9) {
        ctx.font = `${clamp(Math.min(bw, bh) * 0.55, 8, 34)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#0f172a';
        ctx.fillText(glyph, x0 + bw / 2, y0 + bh / 2);
      }
      if (b.level > 1 && z >= 10) {
        ctx.fillStyle = '#facc15';
        for (let i = 0; i < b.level; i++) ctx.fillRect(x0 + 3 + i * 5, y0 + 3, 3, 3);
      }
      if (b.buildRemaining > 0) this.progress(P, b, z);
      if (b.brokenFor > 0 || w.problems.has(b.id)) {
        ctx.font = `${clamp(z * 0.8, 10, 22)}px system-ui, sans-serif`;
        ctx.fillText(b.brokenFor > 0 ? '🛠️' : '⚠️', x0 + bw - z * 0.4, y0 + z * 0.4);
      }
    }
    // Problèmes sur infrastructures plates (postes non reliés…)
    for (const [id] of w.problems) {
      const b = w.byId.get(id);
      if (!b || !FLAT.has(b.type)) continue;
      const f = bFootprint(b);
      const c = P(b.x + f.w / 2, b.y + f.h / 2);
      ctx.font = `${clamp(z * 0.9, 10, 22)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('⚠️', c[0], c[1]);
    }

    this.vehicles(s, P, z, t);
    if (this.kind === 'hybrid') drawLayers(ctx, s, P, z, fi.layers);

    // Avions
    const flights = visibleFlights(s);
    for (const f of flights) {
      const pose = flightPose(f, fi.prev, fi.frac);
      const a = AIRCRAFT[f.aircraft];
      for (const v of serviceVehicles(f, t)) {
        const p = P(v.x, v.y);
        ctx.fillStyle = v.color;
        ctx.fillRect(p[0] - z * 0.18, p[1] - z * 0.12, z * 0.36, z * 0.24);
      }
      const [sx, sy] = P(pose.x, pose.y);
      const len = a.length * z * (1 + pose.alt * 0.5);
      if (pose.alt > 0.02) {
        ctx.save();
        ctx.translate(sx + pose.alt * z * 3, sy + pose.alt * z * 3);
        ctx.rotate(pose.hdg);
        ctx.globalAlpha = 0.25;
        ctx.scale(1, 1);
        drawPlaneShadow(ctx, len);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(pose.hdg);
      drawPlane(ctx, f, len);
      ctx.restore();
      if (fi.selectedFlight === f.id) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, len * 0.65, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (this.kind === 'hybrid' && fi.layers.has('traffic') && z > 7) {
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillStyle = '#e0f2fe';
        ctx.textAlign = 'left';
        ctx.fillText(f.phase === 'taxi_out' || f.phase === 'takeoff' || f.phase === 'queue' || f.phase === 'ready' ? f.depNo : f.arrNo, sx + len * 0.5, sy - len * 0.3);
      }
    }

    // Nuit, éclairages et météo
    const dl = daylight(minuteOfDay(s, fi.frac));
    if (dl < 0.98) {
      ctx.fillStyle = `rgba(8,16,42,${(1 - dl) * 0.55})`;
      ctx.fillRect(0, 0, this.w, this.h);
      if (dl < 0.6) this.lights(s, P, z, t, 1 - dl);
    }
    drawWeather2D(ctx, s, this.w, this.h, t, fi.quality);

    // Achat de terrain
    if (fi.parcelMode) this.parcels(s, P, z);
    // Sélection
    if (fi.selectedBuilding !== null) {
      const b = w.byId.get(fi.selectedBuilding);
      if (b) {
        const f = bFootprint(b);
        const [x0, y0] = P(b.x, b.y);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(x0 - 2, y0 - 2, f.w * z + 4, f.h * z + 4);
        ctx.setLineDash([]);
      }
    }
    if (fi.ghost) this.ghost(fi.ghost, P, z);
  }

  private progress(P: Project, b: { x: number; y: number; type: string; rot: 0 | 1; buildRemaining: number; level: number }, z: number): void {
    const d = BUILDINGS[b.type];
    const f = footprint(d, b.rot);
    const [x0, y0] = P(b.x, b.y);
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, f.w * z, f.h * z);
    ctx.clip();
    ctx.strokeStyle = 'rgba(250,204,21,0.8)';
    ctx.lineWidth = 2;
    for (let i = -f.h * z; i < f.w * z; i += 8) {
      ctx.beginPath();
      ctx.moveTo(x0 + i, y0 + f.h * z);
      ctx.lineTo(x0 + i + f.h * z, y0);
      ctx.stroke();
    }
    ctx.restore();
    const total = d.buildHours * 60 * (b.level > 1 ? 0.4 : 1);
    const p = clamp(1 - b.buildRemaining / total, 0, 1);
    if (f.w * z > 16) {
      ctx.fillStyle = 'rgba(15,23,42,0.8)';
      ctx.fillRect(x0 + 2, y0 + f.h * z - 7, f.w * z - 4, 5);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x0 + 2, y0 + f.h * z - 7, (f.w * z - 4) * p, 5);
    }
  }

  private vehicles(s: GameState, P: Project, z: number, t: number): void {
    // Flux routier : véhicules sur les routes, densité liée au trafic passagers.
    const ctx = this.ctx;
    const density = clamp(s.pax.live.inTerminal / 400, 0.05, 1);
    const w = getWorld(s);
    let i = 0;
    for (const b of s.buildings) {
      if (b.type !== 'road' || !w.roadOk[b.y * s.map.w + b.x]) continue;
      i++;
      const phase = (t * 0.0008 + i * 0.37) % 1;
      if ((i * 7919) % 100 > density * 100) continue;
      const isRoad = (x: number, y: number) => y >= 0 && y < s.map.h && w.byId.get(w.occ[y * s.map.w + x])?.type === 'road';
      const vertical = isRoad(b.x, b.y - 1) || isRoad(b.x, b.y + 1);
      const p = vertical ? P(b.x + 0.35, b.y + phase) : P(b.x + phase, b.y + 0.35);
      ctx.fillStyle = ['#ef4444', '#3b82f6', '#f8fafc', '#f59e0b'][i % 4];
      ctx.fillRect(p[0] - z * 0.12, p[1] - z * 0.12, z * 0.24, z * 0.24);
    }
  }

  private lights(s: GameState, P: Project, z: number, t: number, night: number): void {
    const ctx = this.ctx;
    const w = getWorld(s);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of w.runways) {
      const b = w.byId.get(r.id)!;
      const f = bFootprint(b);
      ctx.fillStyle = `rgba(255,240,200,${0.8 * night})`;
      if (r.horizontal) {
        for (let x = b.x; x <= b.x + f.w; x += 1) {
          for (const y of [b.y + 0.1, b.y + f.h - 0.1]) {
            const p = P(x, y);
            ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
          }
        }
      } else {
        for (let y = b.y; y <= b.y + f.h; y += 1) {
          for (const x of [b.x + 0.1, b.x + f.w - 0.1]) {
            const p = P(x, y);
            ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
          }
        }
      }
    }
    for (const b of s.buildings) {
      if (b.type !== 'taxiway') continue;
      const p = P(b.x + 0.5, b.y + 0.5);
      ctx.fillStyle = `rgba(80,220,120,${0.6 * night})`;
      ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2);
    }
    for (const b of s.buildings) {
      const d = BUILDINGS[b.type];
      if (FLAT.has(b.type) || d.linear || b.type === 'trees' || b.buildRemaining > 0) continue;
      const f = bFootprint(b);
      const c = P(b.x + f.w / 2, b.y + f.h / 2);
      const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], Math.max(f.w, f.h) * z * 0.7);
      g.addColorStop(0, `rgba(255,214,140,${0.35 * night})`);
      g.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = g;
      ctx.fillRect(c[0] - f.w * z, c[1] - f.h * z, f.w * z * 2, f.h * z * 2);
    }
    for (const f of visibleFlights(s)) {
      const p = P(f.pos.x, f.pos.y);
      if (Math.floor(t / 500) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,60,60,0.95)';
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private parcels(s: GameState, P: Project, z: number): void {
    const ctx = this.ctx;
    const { pw, ph } = parcelCount(s);
    const p = s.map.parcel;
    for (let py = 0; py < ph; py++) {
      for (let px = 0; px < pw; px++) {
        if (!canBuyParcel(s, px, py)) continue;
        const [x0, y0] = P(px * p, py * p);
        ctx.fillStyle = 'rgba(56,189,248,0.25)';
        ctx.fillRect(x0, y0, p * z, p * z);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + 1, y0 + 1, p * z - 2, p * z - 2);
        ctx.font = `600 ${clamp(z * 1.4, 12, 28)}px system-ui, sans-serif`;
        ctx.fillStyle = '#e0f2fe';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', x0 + (p * z) / 2, y0 + (p * z) / 2);
      }
    }
  }

  private ghost(g: NonNullable<FrameInfo['ghost']>, P: Project, z: number): void {
    const ctx = this.ctx;
    if (g.cells) {
      for (const c of g.cells) {
        const [x0, y0] = P(c.p.x, c.p.y);
        ctx.fillStyle = c.ok ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.5)';
        ctx.fillRect(x0, y0, z, z);
      }
      return;
    }
    const d = BUILDINGS[g.type];
    const f = footprint(d, g.rot);
    const [x0, y0] = P(g.x, g.y);
    ctx.fillStyle = g.ok ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)';
    ctx.fillRect(x0, y0, f.w * z, f.h * z);
    ctx.strokeStyle = g.ok ? '#22c55e' : '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, f.w * z, f.h * z);
    const glyph = GLYPH[g.type];
    if (glyph) {
      ctx.font = `${clamp(Math.min(f.w, f.h) * z * 0.5, 10, 32)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(glyph, x0 + (f.w * z) / 2, y0 + (f.h * z) / 2);
    }
  }
}

function drawPlaneShadow(ctx: CanvasRenderingContext2D, len: number): void {
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, 0, len / 2, len * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-len * 0.2, -len * 0.45, len * 0.1, len * 0.9);
}
