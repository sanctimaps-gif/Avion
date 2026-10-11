import { describe, expect, it } from 'vitest';
import { createGame } from '../src/sim/state';
import { tick } from '../src/sim/simulation';
import { pendingAction, SERVICES, startService } from '../src/sim/flights';
import { assignStand, clearTakeoff, clearTaxi, standOptions, stripFlights } from '../src/sim/control';
import type { Flight, GameState } from '../src/sim/types';

function runUntil(s: GameState, cond: () => boolean, max = 3000): boolean {
  for (let i = 0; i < max; i++) {
    if (cond()) return true;
    tick(s);
  }
  return cond();
}

describe('mode contrôleur', () => {
  it('le joueur attribue le poste, lance les services et autorise roulage et décollage', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 31, control: 'manual' });
    let f: Flight | undefined;
    expect(runUntil(s, () => !!(f = s.flights.find((x) => pendingAction(s, x)?.need === 'stand')))).toBe(true);
    expect(stripFlights(s)[0].need?.need).toBe('stand');
    const opt = standOptions(s, f!).find((o) => o.ok)!;
    expect(assignStand(s, f!, opt.id)).toBe(true);
    expect(f!.standId).toBe(opt.id);
    // Un autre vol ne peut pas prendre le même poste.
    const other = s.flights.find((x) => x !== f && pendingAction(s, x)?.need === 'stand');
    if (other) expect(standOptions(s, other).find((o) => o.id === opt.id)!.ok).toBe(false);

    expect(runUntil(s, () => pendingAction(s, f!)?.need === 'services')).toBe(true);
    for (const k of SERVICES) expect(startService(s, f!, k)).toBe(true);
    expect(runUntil(s, () => pendingAction(s, f!)?.need === 'taxi')).toBe(true);
    expect(clearTaxi(s, f!)).toBe(true);
    expect(runUntil(s, () => pendingAction(s, f!)?.need === 'takeoff')).toBe(true);
    expect(clearTakeoff(s, f!)).toBe(true);
    expect(runUntil(s, () => f!.phase === 'departed')).toBe(true);
    expect(f!.ctlGood).toBe(4);
    expect(f!.ctlMissed ?? 0).toBe(0);
  });

  it('sans ordre, la limite d’assistance déclenche la prise en charge automatique (pénalité)', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 32, control: 'manual' });
    let f: Flight | undefined;
    expect(runUntil(s, () => !!(f = s.flights.find((x) => pendingAction(s, x)?.need === 'stand')))).toBe(true);
    expect(runUntil(s, () => f!.phase === 'departed')).toBe(true);
    expect(f!.ctlMissed).toBe(4);
    expect(s.ctlStats!.missed).toBeGreaterThanOrEqual(4);
  });

  it('en mode gestion, aucun ordre n’est demandé', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 33 });
    for (let i = 0; i < 600; i++) tick(s);
    expect(s.flights.some((f) => pendingAction(s, f))).toBe(false);
    expect(s.flights.some((f) => f.phase === 'departed' || f.standId !== null)).toBe(true);
  });
});
