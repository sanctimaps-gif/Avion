import { describe, expect, it } from 'vitest';
import { createGame } from '../src/sim/state';
import { tick } from '../src/sim/simulation';
import { getWorld } from '../src/sim/world';
import { operatingProfit } from '../src/sim/economy';

describe('simulation', () => {
  it('runs a career game for 10 days with flights and passengers', () => {
    const s = createGame({ name: 'Test', mode: 'career', seed: 42 });
    const w = getWorld(s);
    expect(w.problems.size).toBe(0);
    expect(w.stands.every((st) => st.reachable)).toBe(true);
    expect(w.stands.some((st) => st.contact)).toBe(true);
    for (let i = 0; i < 1440 * 10; i++) tick(s);
    const h = s.finance.history;
    for (const d of h) {
      console.log(d.day, 'pax', d.pax, 'mv', d.movements, 'ot', d.onTime, 'dl', d.delayed, 'cx', d.cancelled, 'dv', d.diverted, 'sat', d.satisfaction, 'rep', d.reputation, 'missed', d.missed, 'profit', Math.round(operatingProfit(d)), 'cash', Math.round(d.cash));
    }
    console.log(JSON.stringify(h[h.length - 1].revenue), JSON.stringify(h[h.length - 1].expenses));
    console.log(s.satisfactionParts, s.weather.current, s.log.slice(-15).map((l) => l.key + JSON.stringify(l.params ?? {})));
    expect(h.length).toBeGreaterThanOrEqual(9);
    expect(h.reduce((a, d) => a + d.pax, 0)).toBeGreaterThan(1000);
  });
});
