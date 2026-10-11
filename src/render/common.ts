import { AIRCRAFT } from '../data/aircraft';
import { AIRLINES } from '../data/airlines';
import { BUILDINGS } from '../data/buildings';
import { clamp } from '../core/format';
import type { Flight, GameState } from '../sim/types';

/** Utilitaires de rendu partagés par toutes les vues. */
export type Project = (x: number, y: number) => [number, number];

export const GLYPH: Record<string, string> = {
  terminal_s: '✈', terminal_m: '✈', terminal_l: '✈', pier: '🚪', checkin: '🧳', security: '🛡️', baggage_claim: '🛄',
  info_desk: 'ℹ️', lounge: '🛋️', cafe: '☕', restaurant: '🍽️', shop: '🛍️', dutyfree: '💎', ads: '📺', rental: '🚗',
  hotel: '🏨', parking_s: 'P', parking_m: 'P', bus_station: '🚌', train_station: '🚆', power_plant: '⚡', solar: '☀️',
  admin: '🏢', rnd: '🔬', training: '🎓', fire_station: '🚒', deicing: '❄️', snow_depot: '🚜', fuel_depot: '⛽',
  hangar: '🔧', cargo: '📦', ils: '📡', tower_s: '🗼', tower_l: '🗼', trees: '',
  ga_apron: '🛩️', helipad: '🚁', ops_center: '🖥️', staff_parking: 'P',
};

export const TERRAIN_COLORS = ['#5f9e4f', '#3d7fb8', '#2f6b3a'];

/** Lumière du jour : 1 = plein jour, 0 = nuit. */
export function daylight(minuteOfDay: number): number {
  const h = minuteOfDay / 60;
  const elev = Math.sin(((h - 6) / 12) * Math.PI);
  return clamp(elev * 1.6 + 0.25, 0, 1);
}

export function sunAngle(minuteOfDay: number): number {
  return ((minuteOfDay / 60 - 6) / 12) * Math.PI;
}

/** Couleur interpolée (hex) */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

/**
 * Silhouette d'avion vue de dessus, centrée sur (0,0), nez vers +x.
 * `len` = longueur en pixels.
 */
export function drawPlane(ctx: CanvasRenderingContext2D, f: Flight, len: number, alpha = 1): void {
  const a = AIRCRAFT[f.aircraft];
  const al = AIRLINES[f.airlineId];
  const L = len;
  const S = (len * a.span) / a.length;
  ctx.save();
  ctx.globalAlpha = alpha;
  // Ailes
  ctx.fillStyle = '#cfd8e3';
  ctx.beginPath();
  ctx.moveTo(L * 0.08, 0);
  ctx.lineTo(-L * 0.12, S / 2);
  ctx.lineTo(-L * 0.22, S / 2);
  ctx.lineTo(-L * 0.08, 0);
  ctx.lineTo(-L * 0.22, -S / 2);
  ctx.lineTo(-L * 0.12, -S / 2);
  ctx.closePath();
  ctx.fill();
  // Empennage
  ctx.beginPath();
  ctx.moveTo(-L * 0.36, 0);
  ctx.lineTo(-L * 0.47, S * 0.18);
  ctx.lineTo(-L * 0.5, S * 0.18);
  ctx.lineTo(-L * 0.45, 0);
  ctx.lineTo(-L * 0.5, -S * 0.18);
  ctx.lineTo(-L * 0.47, -S * 0.18);
  ctx.closePath();
  ctx.fill();
  // Moteurs
  ctx.fillStyle = '#7b8794';
  const eng = a.engines === 4 ? [0.18, 0.34] : [0.24];
  for (const e of eng) {
    for (const sgn of [1, -1]) {
      ctx.fillRect(-L * 0.06 - (a.prop ? 0 : L * 0.02), sgn * S * e - L * 0.025, L * 0.1, L * 0.05);
    }
  }
  // Fuselage
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.ellipse(0, 0, L / 2, L * 0.065, 0, 0, Math.PI * 2);
  ctx.fill();
  // Livrée
  ctx.fillStyle = al.color;
  ctx.fillRect(-L * 0.5, -L * 0.022, L * 0.7, L * 0.044);
  ctx.beginPath();
  ctx.moveTo(-L * 0.36, 0);
  ctx.lineTo(-L * 0.5, -L * 0.02);
  ctx.lineTo(-L * 0.5, L * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function phaseColor(f: Flight): string {
  switch (f.phase) {
    case 'holding': return '#f59e0b';
    case 'landing':
    case 'takeoff': return '#38bdf8';
    case 'boarding':
    case 'deboarding': return '#22c55e';
    case 'servicing': return '#a78bfa';
    default: return '#e2e8f0';
  }
}

/** Avions visibles avec position interpolée. */
export function flightPose(f: Flight, prev: Map<number, { x: number; y: number; hdg: number; alt: number }>, frac: number) {
  const p = prev.get(f.id);
  if (!p) return f.pos;
  const dx = f.pos.x - p.x;
  const dy = f.pos.y - p.y;
  if (Math.hypot(dx, dy) > 8) return f.pos;
  let dh = f.pos.hdg - p.hdg;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  return { x: p.x + dx * frac, y: p.y + dy * frac, hdg: p.hdg + dh * frac, alt: p.alt + (f.pos.alt - p.alt) * frac };
}

export function buildingHeight(type: string): number {
  return BUILDINGS[type]?.height ?? 1;
}

export function minuteOfDay(s: GameState, frac = 0): number {
  return (s.time % 1440) + frac;
}

/** Positions des véhicules de service autour d'un avion au poste. */
export function serviceVehicles(f: Flight, t: number): { x: number; y: number; color: string }[] {
  if (f.phase !== 'servicing' && f.phase !== 'deboarding' && f.phase !== 'boarding') return [];
  const a = AIRCRAFT[f.aircraft];
  const r = a.length * 0.45;
  const out: { x: number; y: number; color: string }[] = [];
  const n = f.phase === 'servicing' ? 3 : 1;
  for (let i = 0; i < n; i++) {
    const ang = f.pos.hdg + Math.PI / 2 + i * 1.7 + Math.sin(t * 0.05 + i + f.id) * 0.25;
    out.push({ x: f.pos.x + Math.cos(ang) * r * (0.6 + 0.2 * i), y: f.pos.y + Math.sin(ang) * r * (0.6 + 0.2 * i), color: ['#facc15', '#f97316', '#e5e7eb'][i] });
  }
  return out;
}

/** Trajet restant au sol d'un vol (pour le tracé bleu du vol sélectionné), en cases. */
export function remainingRoute(f: Flight): { x: number; y: number }[] {
  const from = (path: { x: number; y: number }[], pos: number): { x: number; y: number }[] => {
    const out = [{ x: f.pos.x, y: f.pos.y }];
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      acc += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (acc > pos) out.push(path[i]);
    }
    return out;
  };
  if (f.phase === 'taxi_in' || f.phase === 'taxi_out') return from(f.path, f.pathPos);
  if (f.phase === 'landing' && f.plan) return [{ x: f.pos.x, y: f.pos.y }, ...f.plan];
  if ((f.phase === 'queue' || f.phase === 'takeoff') && f.path.length >= 2) return [{ x: f.pos.x, y: f.pos.y }, f.path[f.path.length - 1]];
  return [];
}
