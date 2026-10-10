import { BUILDINGS, type BuildingDef } from '../data/buildings';
import { clamp, money, num } from '../core/format';
import { buildingRoi } from '../sim/economy';
import { activeList } from '../sim/incidents';
import { processingRates } from '../sim/passengers';
import { staffEfficiency } from '../sim/staff';
import { bFootprint, getWorld } from '../sim/world';
import type { Building, GameState, StaffCat } from '../sim/types';
import type { Project } from './common';

/**
 * Couches d'information de la vue hybride. Chaque couche colore les
 * bâtiments ou dessine des flux à partir des données de simulation.
 */
export const LAYERS = ['traffic', 'passengers', 'security', 'finance', 'congestion', 'logistics', 'staff', 'noise'] as const;
export type Layer = (typeof LAYERS)[number];

function heat(v: number): string {
  // 0 = vert, 0,5 = jaune, 1 = rouge
  const t = clamp(v, 0, 1);
  const r = Math.round(t < 0.5 ? 60 + t * 2 * 190 : 250);
  const g = Math.round(t < 0.5 ? 200 : 200 - (t - 0.5) * 2 * 170);
  return `rgba(${r},${g},60,0.55)`;
}

function fillFoot(ctx: CanvasRenderingContext2D, P: Project, b: Building, color: string): void {
  const f = bFootprint(b);
  const pts = [P(b.x, b.y), P(b.x + f.w, b.y), P(b.x + f.w, b.y + f.h), P(b.x, b.y + f.h)];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fill();
}

function label(ctx: CanvasRenderingContext2D, P: Project, b: Building, text: string, scale: number): void {
  const f = bFootprint(b);
  const c = P(b.x + f.w / 2, b.y + f.h / 2);
  ctx.font = `600 ${clamp(scale * 0.45, 9, 14)}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = 'rgba(8,20,40,0.85)';
  ctx.fillRect(c[0] - w / 2, c[1] - 9, w, 18);
  ctx.fillStyle = '#e6f1ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c[0], c[1]);
}

function mainStaff(d: BuildingDef): StaffCat | null {
  const st = d.staff;
  if (!st) return null;
  let best: StaffCat | null = null;
  let n = 0;
  for (const [k, v] of Object.entries(st)) if ((v ?? 0) > n) { n = v!; best = k as StaffCat; }
  return best;
}

export function drawLayers(ctx: CanvasRenderingContext2D, s: GameState, P: Project, scale: number, layers: Set<string>): void {
  if (!layers.size) return;
  const w = getWorld(s);
  const live = s.pax.live;
  const rates = processingRates(s);
  ctx.save();
  for (const b of s.buildings) {
    const d = BUILDINGS[b.type];
    if (d.linear) continue;
    if (layers.has('finance') && (b.revenue30 > 0 || b.cost30 > 0)) {
      const roi = buildingRoi(b);
      fillFoot(ctx, P, b, roi >= 0 ? `rgba(34,197,94,${clamp(0.25 + roi, 0.25, 0.7)})` : `rgba(239,68,68,${clamp(0.25 - roi, 0.25, 0.7)})`);
      if (scale > 10 && !d.runwayLength) label(ctx, P, b, money((b.revenue30 - b.cost30) / 30) + '/j', scale);
    }
    if (layers.has('staff')) {
      const cat = mainStaff(d);
      if (cat && w.active.has(b.id)) fillFoot(ctx, P, b, heat(1 - staffEfficiency(s, cat)));
    }
    if (layers.has('passengers')) {
      if (d.checkin && w.cap.checkin > 0) {
        const q = (live.checkinQueue * (d.checkin / w.cap.checkin));
        fillFoot(ctx, P, b, heat(live.checkinQueue / Math.max(1, rates.checkin * 30)));
        if (scale > 8) label(ctx, P, b, '🧍 ' + num(q), scale);
      }
      if (d.baggage && w.cap.baggage > 0) {
        fillFoot(ctx, P, b, heat(live.baggageQueue / Math.max(1, rates.baggage * 25)));
        if (scale > 8) label(ctx, P, b, '🛄 ' + num(live.baggageQueue * (d.baggage / w.cap.baggage)), scale);
      }
      if (d.isTerminal && !d.needsTerminal && scale > 8) label(ctx, P, b, '👥 ' + num(live.inTerminal), scale);
    }
    if (layers.has('security') && d.security && w.cap.security > 0) {
      fillFoot(ctx, P, b, heat(live.securityQueue / Math.max(1, rates.security * 25)));
      if (scale > 8) label(ctx, P, b, '🛡️ ' + num(live.securityQueue * (d.security / w.cap.security)), scale);
    }
    if (layers.has('congestion') && (d.isTerminal || d.needsTerminal)) {
      fillFoot(ctx, P, b, heat(live.congestion));
    }
    if (layers.has('logistics') && (d.baggage || d.effects?.cargo || d.effects?.fuel || d.effects?.mro || d.effects?.deicing)) {
      fillFoot(ctx, P, b, 'rgba(56,189,248,0.5)');
    }
  }
  // Problèmes de raccordement : toujours visibles en vue hybride.
  for (const [id, key] of w.problems) {
    const b = w.byId.get(id);
    if (!b) continue;
    fillFoot(ctx, P, b, 'rgba(249,115,22,0.45)');
    void key;
  }
  if (layers.has('security')) {
    for (const inc of activeList(s)) {
      if (inc.type === 'security_alert') {
        for (const b of s.buildings) if (BUILDINGS[b.type].security) fillFoot(ctx, P, b, 'rgba(239,68,68,0.6)');
      }
    }
  }
  if (layers.has('noise')) {
    for (const b of s.buildings) {
      const n = BUILDINGS[b.type].noise;
      if (!n || b.buildRemaining > 0) continue;
      const f = bFootprint(b);
      const c = P(b.x + f.w / 2, b.y + f.h / 2);
      const e = P(b.x + f.w / 2 + Math.max(f.w, f.h) / 2 + n, b.y + f.h / 2);
      const r = Math.hypot(e[0] - c[0], e[1] - c[1]);
      const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], r);
      g.addColorStop(0, 'rgba(239,68,68,0.45)');
      g.addColorStop(0.6, 'rgba(249,115,22,0.25)');
      g.addColorStop(1, 'rgba(250,204,21,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (layers.has('traffic')) {
    ctx.lineWidth = 2;
    for (const f of s.flights) {
      if (!['taxi_in', 'taxi_out', 'landing', 'takeoff'].includes(f.phase) || f.path.length < 2) continue;
      ctx.strokeStyle = f.phase === 'taxi_in' || f.phase === 'landing' ? 'rgba(56,189,248,0.9)' : 'rgba(250,204,21,0.9)';
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      const p0 = P(f.path[0].x, f.path[0].y);
      ctx.moveTo(p0[0], p0[1]);
      for (const q of f.path.slice(1)) {
        const p = P(q.x, q.y);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const r of w.runways) {
      const busy = (s.runwayBusy[r.id] ?? 0) > s.time;
      const b = w.byId.get(r.id)!;
      fillFoot(ctx, P, b, busy ? 'rgba(56,189,248,0.35)' : 'rgba(34,197,94,0.2)');
    }
  }
  ctx.restore();
}
