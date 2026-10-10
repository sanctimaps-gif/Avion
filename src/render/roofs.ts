import { BUILDINGS } from '../data/buildings';

/**
 * Toits détaillés vus du dessus, dessinés en unités de case (0..W × 0..D).
 * Utilisé par la vue 2D (échelle simple) et la vue isométrique
 * (transformation affine) : les deux vues montrent les mêmes détails.
 */
type C = CanvasRenderingContext2D;

const ROOF = '#7b8591';
const ROOF_DARK = '#5d6672';
const PARAPET = '#e9edf2';

function rect(ctx: C, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function hvac(ctx: C, x: number, y: number, s = 0.5): void {
  rect(ctx, x, y, s, s * 0.7, '#c3cad3');
  rect(ctx, x + s * 0.12, y + s * 0.12, s * 0.32, s * 0.32, '#8e98a4');
  ctx.strokeStyle = '#6f7a86';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.arc(x + s * 0.72, y + s * 0.35, s * 0.17, 0, Math.PI * 2);
  ctx.stroke();
}

function circle(ctx: C, x: number, y: number, r: number, fill: string, stroke?: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.05;
    ctx.stroke();
  }
}

/** Toit plat standard : acrotère clair, membrane grise, équipements techniques. */
function flatRoof(ctx: C, W: number, D: number, roof = ROOF, units = true): void {
  rect(ctx, 0, 0, W, D, PARAPET);
  rect(ctx, 0.12, 0.12, W - 0.24, D - 0.24, roof);
  if (units && W >= 2 && D >= 2) {
    hvac(ctx, W * 0.18, D * 0.22, 0.55);
    if (W >= 3) hvac(ctx, W * 0.6, D * 0.55, 0.55);
  }
}

const CAR_COLORS = ['#e5e7eb', '#1f2937', '#dc2626', '#2563eb', '#9ca3af', '#f8fafc', '#0f766e'];

export function drawRoof(ctx: C, type: string, W: number, D: number, level: number, seed: number): void {
  const d = BUILDINGS[type];
  const accent = d.roof ?? d.color;
  ctx.save();
  switch (type) {
    case 'terminal_s':
    case 'terminal_m':
    case 'terminal_l':
    case 'pier': {
      rect(ctx, 0, 0, W, D, '#f4f6f9');
      // Toit ondulé clair avec bandes de verrières
      const long = W >= D;
      const n = Math.max(2, Math.round((long ? W : D) / 1.5));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        ctx.fillStyle = 'rgba(56,139,200,0.75)';
        if (long) ctx.fillRect(t * W - 0.1, 0.35, 0.2, D - 0.7);
        else ctx.fillRect(0.35, t * D - 0.1, W - 0.7, 0.2);
      }
      ctx.strokeStyle = '#c7cfd9';
      ctx.lineWidth = 0.06;
      ctx.strokeRect(0.08, 0.08, W - 0.16, D - 0.16);
      if (type !== 'pier') {
        // Verrière centrale
        rect(ctx, W * 0.35, D * 0.3, W * 0.3, D * 0.4, 'rgba(125,196,232,0.85)');
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.04;
        for (let i = 1; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(W * 0.35 + (W * 0.3 * i) / 4, D * 0.3);
          ctx.lineTo(W * 0.35 + (W * 0.3 * i) / 4, D * 0.7);
          ctx.stroke();
        }
      }
      break;
    }
    case 'tower_s':
    case 'tower_l': {
      rect(ctx, 0, 0, W, D, '#d9dee5');
      circle(ctx, W / 2, D / 2, Math.min(W, D) * 0.44, '#6fb7e3', '#ffffff');
      circle(ctx, W / 2, D / 2, Math.min(W, D) * 0.3, '#e8edf3');
      circle(ctx, W / 2, D / 2, 0.08, '#ef4444');
      break;
    }
    case 'hangar': {
      const long = W >= D;
      rect(ctx, 0, 0, W, D, '#8796a8');
      ctx.strokeStyle = '#6c7a8c';
      ctx.lineWidth = 0.05;
      const n = Math.round((long ? W : D) * 3);
      for (let i = 1; i < n; i++) {
        ctx.beginPath();
        if (long) { ctx.moveTo((i / n) * W, 0); ctx.lineTo((i / n) * W, D); } else { ctx.moveTo(0, (i / n) * D); ctx.lineTo(W, (i / n) * D); }
        ctx.stroke();
      }
      // Faîtage
      ctx.strokeStyle = '#b8c3d0';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      if (long) { ctx.moveTo(0, D / 2); ctx.lineTo(W, D / 2); } else { ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, D); }
      ctx.stroke();
      break;
    }
    case 'cargo': {
      flatRoof(ctx, W, D, '#a7adb5', false);
      ctx.strokeStyle = '#8c939c';
      ctx.lineWidth = 0.04;
      for (let x = 0.5; x < W; x += 0.5) { ctx.beginPath(); ctx.moveTo(x, 0.15); ctx.lineTo(x, D * 0.65); ctx.stroke(); }
      // Conteneurs sur l'aire de chargement
      const cols = ['#c2410c', '#1d4ed8', '#15803d', '#a16207', '#7c3aed'];
      for (let i = 0; i < Math.floor(W * 1.2); i++) rect(ctx, 0.25 + i * 0.8, D * 0.72, 0.65, 0.22, cols[(i + seed) % cols.length]);
      break;
    }
    case 'fuel_depot': {
      rect(ctx, 0, 0, W, D, '#b9bfc7');
      ctx.strokeStyle = '#8f98a3';
      ctx.lineWidth = 0.08;
      ctx.strokeRect(0.1, 0.1, W - 0.2, D - 0.2);
      const r = Math.min(W, D) * 0.2;
      for (const [cx, cy] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
        circle(ctx, cx * W, cy * D, r, '#f8fafc', '#94a3b8');
        circle(ctx, cx * W, cy * D, r * 0.35, '#cbd5e1');
      }
      break;
    }
    case 'power_plant': {
      flatRoof(ctx, W, D, '#6b7280', false);
      rect(ctx, 0.3, 0.3, W * 0.45, D * 0.4, '#facc15');
      circle(ctx, W * 0.72, D * 0.3, 0.32, '#9ca3af', '#4b5563');
      circle(ctx, W * 0.72, D * 0.72, 0.32, '#9ca3af', '#4b5563');
      break;
    }
    case 'parking_m': {
      rect(ctx, 0, 0, W, D, '#9ca3af');
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 0.04;
      for (let x = 0.4; x < W - 0.2; x += 0.45) { ctx.beginPath(); ctx.moveTo(x, 0.3); ctx.lineTo(x, D * 0.4); ctx.moveTo(x, D * 0.6); ctx.lineTo(x, D - 0.3); ctx.stroke(); }
      let i = seed;
      for (let x = 0.45; x < W - 0.3; x += 0.45) for (const y of [0.4, D - 0.75]) {
        i = (i * 7 + 3) % 11;
        if (i < 7) rect(ctx, x + 0.06, y, 0.32, 0.36, CAR_COLORS[i]);
      }
      rect(ctx, W - 0.9, D * 0.42, 0.7, D * 0.16, '#6b7280');
      break;
    }
    case 'solar': {
      rect(ctx, 0, 0, W, D, '#5f9e4f');
      for (let y = 0.2; y < D - 0.2; y += 0.55) rect(ctx, 0.15, y, W - 0.3, 0.38, '#1e3a8a');
      ctx.strokeStyle = 'rgba(147,197,253,0.6)';
      ctx.lineWidth = 0.03;
      for (let x = 0.5; x < W; x += 0.4) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, D); ctx.stroke(); }
      break;
    }
    case 'fire_station': {
      flatRoof(ctx, W, D, '#b91c1c', false);
      rect(ctx, 0.25, D - 0.6, W - 0.5, 0.35, '#fca5a5');
      hvac(ctx, 0.4, 0.4, 0.6);
      circle(ctx, W - 0.6, 0.6, 0.3, '#e5e7eb', '#9ca3af');
      break;
    }
    case 'hotel': {
      flatRoof(ctx, W, D, '#475569', false);
      rect(ctx, W * 0.2, D * 0.2, W * 0.6, D * 0.35, '#38bdf8');
      hvac(ctx, W * 0.25, D * 0.65, 0.6);
      hvac(ctx, W * 0.6, D * 0.65, 0.6);
      break;
    }
    case 'rnd': {
      flatRoof(ctx, W, D, ROOF, false);
      circle(ctx, W * 0.7, D * 0.5, Math.min(W, D) * 0.28, '#f1f5f9', '#cbd5e1');
      hvac(ctx, 0.4, 0.4, 0.6);
      break;
    }
    case 'deicing': {
      // Plate-forme plate : quelques véhicules de dégivrage
      rect(ctx, 0.3, 0.3, 0.5, 0.3, '#f97316');
      rect(ctx, W - 0.8, D - 0.6, 0.5, 0.3, '#f97316');
      break;
    }
    case 'snow_depot': {
      flatRoof(ctx, W, D, '#64748b', false);
      for (let i = 0; i < 3; i++) rect(ctx, 0.3 + i * (W - 0.6) / 3, D - 0.45, (W - 0.9) / 3, 0.3, '#f97316');
      break;
    }
    case 'bus_station': {
      rect(ctx, 0, 0, W, D, '#d1d5db');
      rect(ctx, 0.2, 0.2, W - 0.4, D * 0.45, '#16a34a');
      rect(ctx, 0.4, D * 0.65, 1.1, 0.35, '#facc15');
      rect(ctx, 1.8, D * 0.65, 1.1, 0.35, '#facc15');
      break;
    }
    case 'train_station': {
      rect(ctx, 0, 0, W, D, '#cbd5e1');
      rect(ctx, 0.2, 0.2, W - 0.4, D * 0.35, '#0284c7');
      ctx.strokeStyle = '#57534e';
      ctx.lineWidth = 0.06;
      for (const y of [D * 0.68, D * 0.86]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      rect(ctx, 0.5, D * 0.62, W * 0.45, 0.14, '#e2e8f0');
      break;
    }
    case 'cafe':
    case 'restaurant':
    case 'shop':
    case 'dutyfree':
    case 'lounge':
    case 'rental': {
      // Pavillon vitré avec auvent coloré rayé
      rect(ctx, 0, 0, W, D, '#eef2f6');
      for (let i = 0; i < Math.ceil(W / 0.35); i++) rect(ctx, i * 0.35, D * 0.62, 0.35, D * 0.38, i % 2 ? '#ffffff' : accent);
      rect(ctx, 0.2, 0.2, W - 0.4, D * 0.35, 'rgba(56,139,200,0.55)');
      break;
    }
    case 'ads': {
      rect(ctx, 0.15, 0.35, W - 0.3, 0.3, '#0f172a');
      rect(ctx, 0.2, 0.38, W - 0.4, 0.24, '#22d3ee');
      break;
    }
    case 'ils': {
      rect(ctx, 0, 0, W, D, '#5f9e4f');
      for (let i = 0; i < 5; i++) rect(ctx, 0.15 + i * 0.15, 0.2, 0.08, D - 0.4, '#f2c94c');
      break;
    }
    case 'checkin':
    case 'security':
    case 'baggage_claim':
    case 'info_desk': {
      flatRoof(ctx, W, D, '#8a94a1', W >= 2);
      rect(ctx, 0.12, 0.12, W - 0.24, 0.18, accent);
      break;
    }
    default:
      flatRoof(ctx, W, D, d.roof ? ROOF : ROOF_DARK);
      rect(ctx, 0.12, 0.12, W - 0.24, 0.16, accent);
  }
  if (level > 1) {
    for (let i = 0; i < level; i++) circle(ctx, 0.3 + i * 0.28, D - 0.3, 0.1, '#facc15');
  }
  ctx.restore();
}

/** Couleur des murs (style clair des références, avec l'accent du bâtiment). */
export function wallColor(type: string): string {
  if (['hangar', 'cargo'].includes(type)) return '#cfd6df';
  if (type === 'fire_station') return '#f1f1f1';
  if (type === 'power_plant') return '#a8a29e';
  return '#eef1f5';
}
