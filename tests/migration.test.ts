import { describe, expect, it } from 'vitest';
import { migrate } from '../src/save/migrations';
import { createGame } from '../src/sim/state';
import { newBuilding } from '../src/sim/construction';
import { bFootprint, getWorld, invalidateWorld } from '../src/sim/world';
import type { GameState } from '../src/sim/types';

/** Aménagement « moyen » tel qu'il était en v1 (anciennes tailles). */
const OLD: [string, number, number, 0 | 1][] = [
  ['runway_s', 28, 26, 0], ['stand_s', 30, 29, 0], ['stand_s', 34, 29, 0], ['terminal_s', 30, 32, 0],
  ['checkin', 30, 36, 0], ['security', 33, 36, 0], ['baggage_claim', 36, 32, 1], ['info_desk', 36, 35, 0],
  ['cafe', 38, 33, 0], ['parking_s', 41, 40, 0], ['tower_s', 45, 29, 0], ['stand_m', 38, 29, 0],
  ['fire_station', 47, 29, 0], ['shop', 36, 36, 0], ['checkin', 24, 36, 0], ['terminal_s', 24, 32, 0], ['security', 27, 36, 0],
];

describe('migration v1 → v2 (échelle réelle)', () => {
  it('agrandit les pistes et postes sans chevauchement et garde les raccordements', () => {
    const s = createGame({ name: 't', mode: 'career', seed: 3 } as never);
    s.buildings = [];
    const add = (t: string, x: number, y: number, r: 0 | 1 = 0) => s.buildings.push(newBuilding(s, t, x + 8, y + 16, r, true));
    for (const [t, x, y, r] of OLD) add(t, x, y, r);
    for (let x = 29; x <= 44; x++) add('taxiway', x, 28);
    for (let y = 38; y < 56; y++) add('road', 40, y);
    for (let x = 24; x < 40; x++) add('road', x, 38);
    const data = JSON.parse(JSON.stringify({ ...s, version: 1 }));
    const m = migrate(data) as GameState;
    expect(m.version).toBe(2);
    expect(m.buildings.filter((b) => b.type.startsWith('stand')).length).toBe(3);
    const seen = new Set<number>();
    for (const b of m.buildings) {
      const f = bFootprint(b);
      for (let y = b.y; y < b.y + f.h; y++) for (let x = b.x; x < b.x + f.w; x++) {
        expect(seen.has(y * m.map.w + x), `${b.type} @${x},${y}`).toBe(false);
        seen.add(y * m.map.w + x);
      }
    }
    invalidateWorld();
    const w = getWorld(m);
    expect(w.runways[0].connected).toBe(true);
    expect(w.stands.every((st) => st.reachable)).toBe(true);
    expect(w.stands.filter((st) => st.contact).length).toBeGreaterThanOrEqual(2);
  });
});
