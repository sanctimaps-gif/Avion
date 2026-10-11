import { describe, expect, it } from 'vitest';
import { createGame } from '../src/sim/state';
import { Traffic } from '../src/render/traffic';

describe('circulation routière', () => {
  it('des véhicules sortent des tunnels / parkings, suivent les routes et disparaissent sous terre', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 41 });
    s.pax.live.inTerminal = 300;
    const tr = new Traffic();
    let t = 1000;
    let maxCars = 0;
    let sawUnderground = false;
    for (let i = 0; i < 1500; i++) {
      t += 50;
      tr.update(s, t, 1);
      maxCars = Math.max(maxCars, tr.count);
      for (const p of tr.poses()) {
        if (p.h < -0.05) sawUnderground = true;
        // Toujours sur une route, une trémie ou sous l'autoroute (sortie par le bas de la carte)
        expect(p.y).toBeLessThan(s.map.h + 1);
      }
    }
    expect(tr.portals.some((p) => p.kind === 'tunnel')).toBe(true);
    expect(tr.portals.some((p) => p.kind === 'parking')).toBe(true);
    expect(maxCars).toBeGreaterThan(5);
    expect(sawUnderground).toBe(true);
  });

  it('en pause, rien ne bouge', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 42 });
    const tr = new Traffic();
    tr.update(s, 1000, 1);
    for (let i = 0; i < 100; i++) tr.update(s, 1100 + i * 50, 1);
    const before = JSON.stringify(tr.poses());
    for (let i = 0; i < 50; i++) tr.update(s, 7000 + i * 50, 0);
    expect(JSON.stringify(tr.poses())).toBe(before);
  });
});
