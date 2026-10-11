import { BUILDINGS } from '../data/buildings';
import { ownedAt } from '../sim/construction';
import { bFootprint, getWorld } from '../sim/world';
import type { Building, GameState } from '../sim/types';
import type { Project } from './common';

/**
 * Dessin de la couche "sol" (terrain + infrastructures plates : pistes,
 * taxiways, routes, postes, parkings) dans une projection quelconque.
 * Utilisé en 2D (projection plane), en isométrique (projection losange)
 * et comme texture du sol en 3D : les trois vues partagent exactement
 * le même rendu des données.
 */
/** Largeur (cases) des accotements de chaque côté d'une piste. */
export const SHOULDER = 0.6;

export const FLAT = new Set(['runway_s', 'runway_m', 'runway_l', 'taxiway', 'road', 'service_road', 'ga_apron', 'helipad', 'staff_parking', 'stand_s', 'stand_m', 'stand_l', 'stand_xl', 'parking_s', 'deicing', 'solar']);

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

/** Hachage déterministe d'une case (0..1). */
export function tileHash(x: number, y: number, k = 0): number {
  let n = (x * 374761393 + y * 668265263 + k * 1442695041) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const GRASS = ['#5d9c46', '#66a84d', '#6fae52', '#78b358'];
const CROPS = ['#c9b458', '#9fbf4f', '#b9a26a', '#86b24c', '#d8c47c', '#a8c060'];
const ROOFS = ['#b5523b', '#c46a3c', '#8f4a3a', '#d08a4e', '#6d7480', '#a4553f'];

export type GroundStyle = 'top' | 'iso' | '3d';

/**
 * Dessine le terrain. `style` adapte les détails : en 3D et en isométrique,
 * les arbres et les maisons sont des objets en volume, donc seul leur sol est peint.
 */
export function drawGround(ctx: CanvasRenderingContext2D, s: GameState, P: Project, scale: number, style: GroundStyle = 'top'): void {
  const W = s.map.w;
  const H = s.map.h;
  const w = getWorld(s);
  const T = s.map.terrain;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : T[y * W + x]);
  // Profondeur de l'eau (distance à la rive, plafonnée)
  const depth = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (T[y * W + x] !== 1) continue;
    let d = 5;
    for (let r = 1; r <= 4 && d === 5; r++) {
      for (let dy = -r; dy <= r && d === 5; dy++) for (let dx = -r; dx <= r; dx++) {
        const v = at(x + dx, y + dy);
        if (v !== 1 && v !== -1) { d = r; break; }
      }
    }
    depth[y * W + x] = d;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = T[y * W + x];
      const h1 = tileHash(x, y);
      let col: string;
      switch (t) {
        case 1: {
          const d = depth[y * W + x];
          col = ['#5bb0dc', '#4aa0d2', '#3e90c6', '#3381ba', '#2b72ab', '#256599'][Math.min(5, d)];
          break;
        }
        case 2: col = h1 < 0.5 ? '#3b733a' : '#407a3e'; break;
        case 3: {
          const fx = Math.floor(x / 5);
          const fy = Math.floor(y / 4);
          col = CROPS[Math.floor(tileHash(fx, fy, 3) * CROPS.length)];
          break;
        }
        case 4: col = h1 < 0.5 ? '#e3d4a3' : '#ddcd98'; break;
        case 5: col = (x % 4 === 0 || y % 4 === 0) ? '#7c8088' : '#b9b3a8'; break;
        default: col = GRASS[Math.floor(h1 * GRASS.length)];
      }
      ctx.fillStyle = col;
      quad(ctx, P, x, y, x + 1.02, y + 1.02);
      ctx.fill();
      // Détails par type de terrain
      if (t === 3) {
        // Sillons de culture, orientés par parcelle agricole
        const vertical = tileHash(Math.floor(x / 5), Math.floor(y / 4), 9) < 0.5;
        ctx.strokeStyle = 'rgba(70,60,20,0.22)';
        ctx.lineWidth = Math.max(0.5, scale * 0.05);
        for (let k = 0.25; k < 1; k += 0.25) {
          if (vertical) line(ctx, P, x + k, y, x + k, y + 1);
          else line(ctx, P, x, y + k, x + 1, y + k);
        }
        if (x % 5 === 0) { ctx.strokeStyle = 'rgba(60,90,40,0.5)'; line(ctx, P, x, y, x, y + 1); }
        if (y % 4 === 0) { ctx.strokeStyle = 'rgba(60,90,40,0.5)'; line(ctx, P, x, y, x + 1, y); }
      } else if (t === 1) {
        // Écume le long des rives et reflets
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = Math.max(1, scale * 0.08);
        if (at(x, y - 1) !== 1 && at(x, y - 1) !== -1) line(ctx, P, x, y + 0.05, x + 1, y + 0.05);
        if (at(x, y + 1) !== 1 && at(x, y + 1) !== -1) line(ctx, P, x, y + 0.95, x + 1, y + 0.95);
        if (at(x - 1, y) !== 1 && at(x - 1, y) !== -1) line(ctx, P, x + 0.05, y, x + 0.05, y + 1);
        if (at(x + 1, y) !== 1 && at(x + 1, y) !== -1) line(ctx, P, x + 0.95, y, x + 0.95, y + 1);
        if (h1 < 0.25) {
          ctx.strokeStyle = 'rgba(255,255,255,0.22)';
          ctx.lineWidth = Math.max(0.5, scale * 0.04);
          line(ctx, P, x + 0.2, y + 0.5, x + 0.6, y + 0.45);
        }
      } else if (t === 0 && h1 > 0.93) {
        // Touffes de fleurs / buissons
        const c = P(x + 0.3 + h1 * 0.4, y + 0.5);
        ctx.fillStyle = tileHash(x, y, 5) < 0.5 ? '#4f8a3c' : '#e8d15a';
        ctx.beginPath();
        ctx.arc(c[0], c[1], scale * 0.08, 0, Math.PI * 2);
        ctx.fill();
      } else if (t === 5 && style === 'top' && !(x % 4 === 0 || y % 4 === 0)) {
        // Toits des maisons du village
        const rc = ROOFS[Math.floor(tileHash(x, y, 2) * ROOFS.length)];
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        quad(ctx, P, x + 0.2, y + 0.22, x + 0.9, y + 0.92);
        ctx.fill();
        ctx.fillStyle = rc;
        quad(ctx, P, x + 0.12, y + 0.12, x + 0.82, y + 0.82);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = Math.max(0.5, scale * 0.04);
        line(ctx, P, x + 0.12, y + 0.47, x + 0.82, y + 0.47);
      }
      if (t === 2 && style === 'top') {
        // Canopées des arbres avec ombre portée
        const n = 2 + Math.floor(h1 * 2);
        for (let k = 0; k < n; k++) {
          const ox = 0.25 + tileHash(x, y, 10 + k) * 0.5;
          const oy = 0.25 + tileHash(x, y, 20 + k) * 0.5;
          const r = scale * (0.28 + tileHash(x, y, 30 + k) * 0.14);
          const c = P(x + ox, y + oy);
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.beginPath();
          ctx.arc(c[0] + r * 0.35, c[1] + r * 0.35, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = ['#2c6334', '#357540', '#2f6b38', '#3f8448'][(k + Math.floor(h1 * 4)) % 4];
          ctx.beginPath();
          ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.beginPath();
          ctx.arc(c[0] - r * 0.3, c[1] - r * 0.3, r * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!ownedAt(s, x, y) && t !== 1) {
        ctx.fillStyle = 'rgba(30,40,30,0.13)';
        quad(ctx, P, x, y, x + 1.02, y + 1.02);
        ctx.fill();
      }
    }
  }
  // Clôture du périmètre de l'aéroport
  ctx.strokeStyle = '#eef2f4';
  ctx.lineWidth = Math.max(1, scale * 0.09);
  ctx.fillStyle = '#9aa3ab';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = ownedAt(s, x, y);
    if (!o) continue;
    const edges: [number, number, number, number][] = [];
    if (x === 0 || !ownedAt(s, x - 1, y)) edges.push([x, y, x, y + 1]);
    if (x === W - 1 || !ownedAt(s, x + 1, y)) edges.push([x + 1, y, x + 1, y + 1]);
    if (y === 0 || !ownedAt(s, x, y - 1)) edges.push([x, y, x + 1, y]);
    if (y === H - 1 || !ownedAt(s, x, y + 1)) edges.push([x, y + 1, x + 1, y + 1]);
    for (const [ax, ay, bx, by] of edges) {
      line(ctx, P, ax, ay, bx, by);
      const c = P(ax, ay);
      ctx.fillRect(c[0] - scale * 0.07, c[1] - scale * 0.07, scale * 0.14, scale * 0.14);
    }
  }

  // Dalles / trottoirs sous les bâtiments
  for (const b of s.buildings) {
    if (FLAT.has(b.type) || b.type === 'trees' || b.type === 'ils') continue;
    const f = bFootprint(b);
    ctx.fillStyle = '#c7cbd1';
    quad(ctx, P, b.x, b.y, b.x + f.w, b.y + f.h);
    ctx.fill();
  }
  // Infrastructures plates (routes et taxiways d'abord, puis le reste)
  const flat = s.buildings.filter((b) => FLAT.has(b.type));
  flat.sort((a, b) => order(a) - order(b));
  for (const b of flat) drawFlat(ctx, s, b, P, scale, w.occ);
}

function order(b: Building): number {
  if (b.type === 'road' || b.type === 'service_road') return 0;
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
  if (b.type === 'road' || b.type === 'service_road') {
    // Voie de service : axe blanc continu et rives jaunes (côté piste).
    const svc = b.type === 'service_road';
    const same = [svc ? 'service_road' : 'road'];
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    if (!svc) ctx.setLineDash([scale * 0.2, scale * 0.2]);
    const cx = x0 + 0.5;
    const cy = y0 + 0.5;
    if (sameAt(s, occ, b.x - 1, b.y, same)) line(ctx, P, x0, cy, cx, cy);
    if (sameAt(s, occ, b.x + 1, b.y, same)) line(ctx, P, cx, cy, x1, cy);
    if (sameAt(s, occ, b.x, b.y - 1, same)) line(ctx, P, cx, y0, cx, cy);
    if (sameAt(s, occ, b.x, b.y + 1, same)) line(ctx, P, cx, cy, cx, y1);
    ctx.setLineDash([]);
    if (svc) {
      ctx.strokeStyle = 'rgba(250,204,21,0.7)';
      ctx.lineWidth = Math.max(0.5, scale * 0.035);
      if (!sameAt(s, occ, b.x, b.y - 1, same)) line(ctx, P, x0, y0 + 0.08, x1, y0 + 0.08);
      if (!sameAt(s, occ, b.x, b.y + 1, same)) line(ctx, P, x0, y1 - 0.08, x1, y1 - 0.08);
      if (!sameAt(s, occ, b.x - 1, b.y, same)) line(ctx, P, x0 + 0.08, y0, x0 + 0.08, y1);
      if (!sameAt(s, occ, b.x + 1, b.y, same)) line(ctx, P, x1 - 0.08, y0, x1 - 0.08, y1);
    }
  } else if (b.type === 'taxiway') {
    ctx.strokeStyle = 'rgba(250,204,21,0.45)';
    ctx.lineWidth = Math.max(0.5, scale * 0.04);
    const tw = ['taxiway', 'runway', 'stand', 'deicing', 'hangar', 'cargo', 'ga_apron'];
    if (!sameAt(s, occ, b.x, b.y - 1, tw)) line(ctx, P, x0, y0 + 0.06, x1, y0 + 0.06);
    if (!sameAt(s, occ, b.x, b.y + 1, tw)) line(ctx, P, x0, y1 - 0.06, x1, y1 - 0.06);
    if (!sameAt(s, occ, b.x - 1, b.y, tw)) line(ctx, P, x0 + 0.06, y0, x0 + 0.06, y1);
    if (!sameAt(s, occ, b.x + 1, b.y, tw)) line(ctx, P, x1 - 0.06, y0, x1 - 0.06, y1);
    ctx.lineWidth = Math.max(1, scale * 0.06);
    ctx.strokeStyle = '#facc15';
    const cx = x0 + 0.5;
    const cy = y0 + 0.5;
    const t = ['taxiway', 'runway', 'stand', 'deicing', 'hangar', 'cargo', 'ga_apron'];
    let any = false;
    if (sameAt(s, occ, b.x - 1, b.y, t)) { line(ctx, P, x0, cy, cx, cy); any = true; }
    if (sameAt(s, occ, b.x + 1, b.y, t)) { line(ctx, P, cx, cy, x1, cy); any = true; }
    if (sameAt(s, occ, b.x, b.y - 1, t)) { line(ctx, P, cx, y0, cx, cy); any = true; }
    if (sameAt(s, occ, b.x, b.y + 1, t)) { line(ctx, P, cx, cy, cx, y1); any = true; }
    if (!any) line(ctx, P, x0 + 0.2, cy, x1 - 0.2, cy);
  } else if (d.runwayLength) {
    const horiz = f.w >= f.h;
    const L = horiz ? f.w : f.h;
    const Wd = horiz ? f.h : f.w;
    // Repère de la piste : u le long de l'axe, v en travers (0 = bord).
    const R = (u0: number, v0: number, u1: number, v1: number) => (horiz ? quad(ctx, P, x0 + u0, y0 + v0, x0 + u1, y0 + v1) : quad(ctx, P, x0 + v0, y0 + u0, x0 + v1, y0 + u1));
    const Ln = (u0: number, v0: number, u1: number, v1: number) => (horiz ? line(ctx, P, x0 + u0, y0 + v0, x0 + u1, y0 + v1) : line(ctx, P, x0 + v0, y0 + u0, x0 + v1, y0 + u1));
    // Accotements stabilisés de chaque côté : les véhicules d'intervention y circulent.
    const sh = SHOULDER;
    ctx.fillStyle = '#5b6271';
    R(0, 0, L, sh);
    ctx.fill();
    R(0, Wd - sh, L, Wd);
    ctx.fill();
    ctx.strokeStyle = 'rgba(250,204,21,0.55)';
    ctx.lineWidth = Math.max(0.5, scale * 0.03);
    for (let u = 0.5; u < L; u += 1.5) {
      Ln(u, 0.08, u + 0.5, sh - 0.08);
      Ln(u, Wd - 0.08, u + 0.5, Wd - sh + 0.08);
    }
    const pw = Wd - 2 * sh;
    const mid = Wd / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, scale * 0.08);
    // Axe central en pointillés
    ctx.setLineDash([scale * 0.8, scale * 0.6]);
    Ln(2.6, mid, L - 2.6, mid);
    ctx.setLineDash([]);
    // Seuils (« piano »)
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const n = Math.max(4, Math.round(pw * 2.4));
    for (let i = 0; i < n; i++) {
      const o = sh + 0.15 + ((i + 0.2) / n) * (pw - 0.3);
      const w2 = ((pw - 0.3) / n) * 0.6;
      for (const tu of [0.2, L - 1.0]) {
        R(tu, o, tu + 0.8, o + w2);
        ctx.fill();
      }
    }
    // Points de visée et zones de toucher des roues
    for (const [u, len] of [[3.4, 1.1], [L - 4.5, 1.1]] as const) {
      R(u, mid - pw * 0.32, u + len, mid - pw * 0.17);
      ctx.fill();
      R(u, mid + pw * 0.17, u + len, mid + pw * 0.32);
      ctx.fill();
    }
    // Numéros de piste (QFU) aux deux seuils, orientés vers l'avion à l'atterrissage
    const labels: [number, number, string, number][] = horiz
      ? [[x0 + 1.9, (y0 + y1) / 2, '09', -Math.PI / 2], [x1 - 1.9, (y0 + y1) / 2, '27', Math.PI / 2]]
      : [[(x0 + x1) / 2, y0 + 1.9, '18', 0], [(x0 + x1) / 2, y1 - 1.9, '36', Math.PI]];
    for (const [lx, ly, txt, rot] of labels) {
      const o = P(lx, ly);
      const ex = P(lx + 1, ly);
      const ey = P(lx, ly + 1);
      ctx.save();
      ctx.transform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
      ctx.rotate(rot);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = `bold ${pw * 0.42}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    }
    // Bords de la chaussée
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(1, scale * 0.05);
    Ln(0, sh + 0.06, L, sh + 0.06);
    Ln(0, Wd - sh - 0.06, L, Wd - sh - 0.06);
  } else if (d.standSize) {
    // Tarmac en dalles de béton
    ctx.fillStyle = '#a3a9b1';
    quad(ctx, P, x0, y0, x1, y1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,88,100,0.35)';
    ctx.lineWidth = Math.max(0.5, scale * 0.025);
    for (let x = x0 + 1; x < x1; x++) line(ctx, P, x, y0, x, y1);
    for (let y = y0 + 1; y < y1; y++) line(ctx, P, x0, y, x1, y);
    // Ligne de guidage vers le centre du poste + barre d'arrêt
    const occ2 = getWorld(s).occ;
    const cxm = (x0 + x1) / 2;
    const cym = (y0 + y1) / 2;
    const taxiSide = [[cxm, y0 - 0.5, cxm, y0], [cxm, y1 + 0.5, cxm, y1], [x0 - 0.5, cym, x0, cym], [x1 + 0.5, cym, x1, cym]].find(([tx, ty]) => {
      const ix = Math.floor(tx);
      const iy = Math.floor(ty);
      if (ix < 0 || iy < 0 || ix >= s.map.w || iy >= s.map.h) return false;
      return getWorld(s).byId.get(occ2[iy * s.map.w + ix])?.type === 'taxiway';
    });
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = Math.max(1, scale * 0.07);
    if (taxiSide) {
      line(ctx, P, taxiSide[2], taxiSide[3], cxm, cym);
      const vert = taxiSide[2] === cxm;
      if (vert) line(ctx, P, cxm - 0.6, cym + (taxiSide[3] < cym ? 0.9 : -0.9), cxm + 0.6, cym + (taxiSide[3] < cym ? 0.9 : -0.9));
      else line(ctx, P, cxm + (taxiSide[2] < cxm ? 0.9 : -0.9), cym - 0.6, cxm + (taxiSide[2] < cxm ? 0.9 : -0.9), cym + 0.6);
    }
    ctx.strokeStyle = 'rgba(220,38,38,0.7)';
    ctx.setLineDash([scale * 0.25, scale * 0.15]);
    quad(ctx, P, x0 + 0.12, y0 + 0.12, x1 - 0.12, y1 - 0.12);
    ctx.stroke();
    ctx.setLineDash([]);
    const c = P(x1 - 0.5, y1 - 0.5);
    ctx.fillStyle = 'rgba(250,204,21,0.9)';
    ctx.font = `bold ${Math.max(8, scale * 0.7)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.max(7, scale * 0.5)}px system-ui, sans-serif`;
    ctx.fillText(d.standSize, c[0], c[1]);
  } else if (b.type === 'ga_apron') {
    // Aire en béton, emplacements en T jaunes et petits avions stationnés
    ctx.fillStyle = '#a3a9b1';
    quad(ctx, P, x0, y0, x1, y1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,88,100,0.35)';
    ctx.lineWidth = Math.max(0.5, scale * 0.025);
    for (let x = x0 + 1; x < x1; x++) line(ctx, P, x, y0, x, y1);
    for (let y = y0 + 1; y < y1; y++) line(ctx, P, x0, y, x1, y);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = Math.max(1, scale * 0.05);
    for (const [px, py] of gaSpots(f.w, f.h)) {
      line(ctx, P, x0 + px - 0.45, y0 + py + 0.5, x0 + px + 0.45, y0 + py + 0.5);
      line(ctx, P, x0 + px, y0 + py - 0.5, x0 + px, y0 + py + 0.5);
    }
    // Silhouettes des avions stationnés (mêmes emplacements qu'en 3D)
    ctx.strokeStyle = '#f8fafc';
    gaSpots(f.w, f.h).forEach(([px, py], i) => {
      if ((b.id * 7 + i * 3) % 5 === 4) return;
      const dir = py < f.h / 2 ? -1 : 1;
      const cx = x0 + px;
      const cy = y0 + py;
      ctx.lineWidth = Math.max(1, scale * 0.12);
      line(ctx, P, cx, cy - dir * 0.5, cx, cy + dir * 0.45);
      ctx.lineWidth = Math.max(1, scale * 0.09);
      line(ctx, P, cx - 0.5, cy - dir * 0.1, cx + 0.5, cy - dir * 0.1);
      line(ctx, P, cx - 0.2, cy + dir * 0.4, cx + 0.2, cy + dir * 0.4);
    });
  } else if (b.type === 'helipad') {
    // Aire d'atterrissage : cercle jaune et « H » blanc
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const r = Math.min(f.w, f.h) * 0.38;
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = Math.max(1, scale * 0.09);
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const p = P(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      if (i) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
    }
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, scale * 0.12);
    const k = r * 0.5;
    line(ctx, P, cx - k * 0.7, cy - k, cx - k * 0.7, cy + k);
    line(ctx, P, cx + k * 0.7, cy - k, cx + k * 0.7, cy + k);
    line(ctx, P, cx - k * 0.7, cy, cx + k * 0.7, cy);
  } else if (b.type === 'parking_s' || b.type === 'staff_parking') {
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

/** Emplacements (centre, en cases depuis le coin) des avions d'aviation générale. */
export function gaSpots(W: number, D: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = 0.9; x < W - 0.4; x += 1.3) for (const y of [0.95, D - 0.95]) out.push([x, y]);
  return out;
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
