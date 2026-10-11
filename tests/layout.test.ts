import { describe, expect, it } from 'vitest';
import { createGame } from '../src/sim/state';
import { bFootprint, getWorld, invalidateWorld } from '../src/sim/world';

describe('aménagement de départ', () => {
  for (const startTier of [0, 1]) {
    it(`palier ${startTier} : aucun chevauchement, tout est raccordé`, () => {
      const s = createGame({ name: 't', mode: 'career', seed: 7, startTier } as never);
      invalidateWorld();
      const seen = new Map<number, number>();
      for (const b of s.buildings) {
        const f = bFootprint(b);
        for (let y = b.y; y < b.y + f.h; y++) for (let x = b.x; x < b.x + f.w; x++) {
          const i = y * s.map.w + x;
          expect(seen.get(i), `${b.type} @${x},${y}`).toBeUndefined();
          seen.set(i, b.id);
        }
      }
      const w = getWorld(s);
      expect([...w.problems.entries()].map(([id, p]) => `${w.byId.get(id)!.type}:${p}`)).toEqual([]);
      expect(w.stands.every((st) => st.reachable)).toBe(true);
      expect(w.stands.filter((st) => st.contact).length).toBeGreaterThanOrEqual(2);
      expect(w.runways.every((r) => r.connected)).toBe(true);
    });
  }
});
