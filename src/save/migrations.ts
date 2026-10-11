import { BUILDINGS, footprint } from '../data/buildings';
import { newBuilding } from '../sim/construction';
import { SAVE_VERSION } from '../sim/state';

/**
 * Migrations du format de sauvegarde. Quand le format évolue :
 * 1. incrémenter SAVE_VERSION (sim/state.ts) ;
 * 2. ajouter ici une fonction MIGRATIONS[ancienneVersion] qui convertit
 *    les données vers la version suivante.
 * Les migrations s'enchaînent : une sauvegarde v1 passe par v2, v3…
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;

export const MIGRATIONS: Record<number, (d: Data) => Data> = {
  // v0 (prototype) → v1 : ajout des compteurs journaliers et incidents imposés.
  0: (d) => {
    d.dayCounters ??= { onTime: 0, delayed: 0, cancelled: 0, diverted: 0, movements: 0 };
    d.forced ??= [];
    d.runwayBusy ??= {};
    d.version = 1;
    return d;
  },
  // v1 → v2 : échelle réelle (pistes plus larges, postes et hangars agrandis).
  1: (d) => {
    rescale(d);
    d.version = 2;
    return d;
  },
};

/** Anciennes emprises (w × h) des bâtiments agrandis en v2. */
const OLD_SIZE: Record<string, [number, number]> = {
  runway_s: [16, 2], runway_m: [24, 2], runway_l: [32, 3],
  stand_s: [3, 3], stand_m: [4, 4], stand_l: [5, 5], stand_xl: [6, 6], hangar: [5, 4],
};

/**
 * Agrandit sur place les bâtiments redimensionnés : chaque nouvelle emprise
 * contient l'ancienne et ne touche ni un autre bâtiment ni l'eau ou la ville,
 * en gardant de préférence le contact avec les taxiways et le terminal.
 * Un poste coincé entre taxiway et terminal fait de la place en décalant d'une
 * rangée tout ce qui se trouve derrière lui (routes prolongées).
 * En dernier recours, le bâtiment est retiré et remboursé.
 */
function rescale(d: Data): void {
  const W: number = d.map.w;
  const H: number = d.map.h;
  const all = () => d.buildings as Data[];
  const pw = Math.ceil(W / d.map.parcel);
  const owned = (x: number, y: number) => d.map.owned[Math.floor(y / d.map.parcel) * pw + Math.floor(x / d.map.parcel)] === true;
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && owned(x, y) && d.map.terrain[y * W + x] !== 1 && d.map.terrain[y * W + x] !== 5;
  const size = (b: Data) => footprint(BUILDINGS[b.type], b.rot);
  const pending = new Set<Data>(all().filter((b) => OLD_SIZE[b.type] && BUILDINGS[b.type]));
  const queue = [...pending].sort((a, b) => size(b).w * size(b).h - size(a).w * size(a).h);
  const occ = new Int32Array(W * H);
  const rebuild = () => {
    occ.fill(0);
    for (const b of all()) {
      if (pending.has(b) || !BUILDINGS[b.type]) continue;
      const f = size(b);
      for (let y = b.y; y < b.y + f.h; y++) for (let x = b.x; x < b.x + f.w; x++) occ[y * W + x] = b.id;
    }
  };
  const typeAt = (x: number, y: number): string => {
    if (x < 0 || y < 0 || x >= W || y >= H || !occ[y * W + x]) return '';
    return all().find((o) => o.id === occ[y * W + x])?.type ?? '';
  };
  const oldSize = (b: Data): [number, number] => (b.rot ? [OLD_SIZE[b.type][1], OLD_SIZE[b.type][0]] : OLD_SIZE[b.type]);

  /** Meilleur emplacement dans la zone ; `eat` autorise à recouvrir taxiways et routes. */
  const search = (b: Data, x0: number, x1: number, y0: number, y1: number, eat: boolean) => {
    const f = size(b);
    const [ow, oh] = oldSize(b);
    const cx = b.x - (f.w - ow) / 2;
    const cy = b.y - (f.h - oh) / 2;
    let best: { x: number; y: number; score: number; eaten: number[] } | null = null;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let ok = x >= 0 && y >= 0 && x + f.w <= W && y + f.h <= H;
        const eaten: number[] = [];
        for (let yy = y; yy < y + f.h && ok; yy++) for (let xx = x; xx < x + f.w; xx++) {
          const o = occ[yy * W + xx];
          const t = o ? typeAt(xx, yy) : '';
          if ((o && !(eat && (t === 'taxiway' || t === 'road'))) || !free(xx, yy)) { ok = false; break; }
          if (o) eaten.push(o);
        }
        if (!ok) continue;
        let score = -eaten.length * 0.3;
        for (let xx = x; xx < x + f.w; xx++) for (const yy of [y - 1, y + f.h]) score += contactScore(typeAt(xx, yy));
        for (let yy = y; yy < y + f.h; yy++) for (const xx of [x - 1, x + f.w]) score += contactScore(typeAt(xx, yy));
        // À contact égal, on reste au plus près de l'ancienne position.
        score -= (Math.abs(x - cx) + Math.abs(y - cy)) * 0.01;
        if (!best || score > best.score) best = { x, y, score, eaten };
      }
    }
    return best;
  };
  const inPlace = (b: Data, eat: boolean) => {
    const f = size(b);
    const [ow, oh] = oldSize(b);
    return search(b, b.x - (f.w - ow), b.x, b.y - (f.h - oh), b.y, eat);
  };

  /**
   * Insère une rangée (vertical = false) ou une colonne vide à la coordonnée `at` :
   * tout ce qui dépasse cette ligne est décalé d'une case, les routes et taxiways
   * coupés sont prolongés. Annulé si un bâtiment sortirait du terrain constructible.
   */
  const insert = (vertical: boolean, at: number): boolean => {
    const fp = (b: Data) => (pending.has(b) ? { w: oldSize(b)[0], h: oldSize(b)[1] } : size(b));
    // Tout ce qui dépasse la ligne est décalé (un terminal à cheval reste solidaire de ses voisins).
    const moved = all().filter((b) => (vertical ? b.x + fp(b).w : b.y + fp(b).h) > at);
    for (const b of moved) {
      const f = fp(b);
      for (let y = b.y; y < b.y + f.h; y++) for (let x = b.x; x < b.x + f.w; x++) {
        const nx = vertical ? x + 1 : x;
        const ny = vertical ? y : y + 1;
        const lin = b.type === 'road' || b.type === 'taxiway';
        // Une route qui sort de la carte disparaît simplement (l'entrée reste au bord).
        if ((nx >= W || ny >= H) && lin) continue;
        if (!free(nx, ny)) return false;
      }
    }
    const lines = new Map<string, string>();
    for (const b of all()) if (b.type === 'road' || b.type === 'taxiway') lines.set(`${b.x},${b.y}`, b.type);
    for (const b of moved) vertical ? b.x++ : b.y++;
    d.buildings = all().filter((b) => b.x < W && b.y < H);
    // Prolonge les lignes coupées par l'insertion.
    for (const [k, t] of lines) {
      const [x, y] = k.split(',').map(Number);
      const before = vertical ? x === at - 1 : y === at - 1;
      const next = vertical ? `${at},${y}` : `${x},${at}`;
      if (before && lines.get(next) === t) {
        all().push({ ...newBuilding(d, t, vertical ? at : x, vertical ? y : at, 0, true), totalInvested: BUILDINGS[t].cost });
      }
    }
    return true;
  };

  const removed = new Set<number>();
  rebuild();
  for (const b of queue) {
    let best = inPlace(b, false);
    if (!best && BUILDINGS[b.type].standSize) {
      // Côté opposé au taxiway : on y insère une rangée ou une colonne.
      const [ow, oh] = oldSize(b);
      const sides: [boolean, number, boolean][] = [];
      let n = 0, so = 0, we = 0, ea = 0;
      for (let x = b.x; x < b.x + ow; x++) { if (typeAt(x, b.y - 1) === 'taxiway') n++; if (typeAt(x, b.y + oh) === 'taxiway') so++; }
      for (let y = b.y; y < b.y + oh; y++) { if (typeAt(b.x - 1, y) === 'taxiway') we++; if (typeAt(b.x + ow, y) === 'taxiway') ea++; }
      if (n >= so) sides.push([false, b.y + oh, false]); else sides.push([false, b.y, true]);
      if (we >= ea) sides.push([true, b.x + ow, false]); else sides.push([true, b.x, true]);
      for (const [vertical, at, shiftSelf] of sides) {
        const need = vertical ? size(b).w - ow : size(b).h - oh;
        let done = 0;
        for (let k = 0; k < need; k++) if (insert(vertical, at)) done++;
        // Inséré du côté du poste lui-même : il a été décalé, on le ramène contre le taxiway.
        if (shiftSelf && done) vertical ? (b.x -= done) : (b.y -= done);
        rebuild();
        best = inPlace(b, false);
        if (best) break;
      }
    }
    best ??= inPlace(b, true) ?? search(b, b.x - 12, b.x + 12, b.y - 12, b.y + 12, false);
    pending.delete(b);
    if (best) {
      b.x = best.x;
      b.y = best.y;
      for (const id of best.eaten) removed.add(id);
      d.buildings = all().filter((o) => !best!.eaten.includes(o.id));
    } else {
      removed.add(b.id);
      d.buildings = all().filter((o) => o !== b);
      d.finance.cash += b.totalInvested ?? BUILDINGS[b.type].cost;
      (d.log ??= []).push({ t: d.time, level: 'warn', key: 'log.rescaled', params: { name: 'b.' + b.type } });
    }
    rebuild();
  }
  for (const f of d.flights ?? []) {
    if (removed.has(f.standId)) f.standId = null;
    if (removed.has(f.runwayId)) f.runwayId = null;
  }
}

/** Intérêt d'un voisin pour l'emplacement agrandi (raccordements conservés). */
function contactScore(type: string): number {
  if (type === 'taxiway') return 1;
  if (type.startsWith('terminal') || type === 'pier') return 2;
  return 0;
}

export function migrate(d: Data): Data {
  let v = typeof d.version === 'number' ? d.version : 0;
  if (v > SAVE_VERSION) throw new Error('save-too-new');
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error('no-migration-' + v);
    d = m(d);
    v = d.version;
  }
  return d;
}
