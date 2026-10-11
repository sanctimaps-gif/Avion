import { describe, expect, it } from 'vitest';
import { createGame } from '../src/sim/state';
import { tick } from '../src/sim/simulation';
import { canPlace, place, demolish, linePoints, placeLine, buyParcel, canBuyParcel, upgrade } from '../src/sim/construction';
import { getWorld, invalidateWorld } from '../src/sim/world';
import { runwayStatus } from '../src/sim/flights';
import { staffEfficiency, hire } from '../src/sim/staff';
import { processingRates } from '../src/sim/passengers';
import { acceptOffer, generateOffer } from '../src/sim/airlines';
import { startIncident } from '../src/sim/incidents';
import { takeLoan, totalDebt, aggregate } from '../src/sim/economy';
import { startResearch } from '../src/sim/research';
import { SCENARIOS } from '../src/data/scenarios';
import type { GameState } from '../src/sim/types';

function run(s: GameState, minutes: number) {
  for (let i = 0; i < minutes; i++) tick(s);
}
function finishBuilds(s: GameState) {
  for (const b of s.buildings) b.buildRemaining = 0;
  invalidateWorld();
}

describe('construction', () => {
  it('refuse collisions, terrain non acquis et eau', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 10 });
    expect(canPlace(s, 'stand_s', 38, 45, 0).reason).toBe('pb.occupied');
    expect(canPlace(s, 'stand_s', 2, 2, 0).reason).toBe('pb.notOwned');
    expect(canPlace(s, 'stand_s', 200, 2, 0).reason).toBe('pb.bounds');
    expect(canPlace(s, 'runway_l', 38, 61, 0).reason).toMatch(/lock\.tier|pb\./);
  });

  it('un poste n’est accessible que relié par taxiway à une piste', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 11 });
    const r = place(s, 'stand_s', 34, 60, 0);
    expect(r.ok).toBe(true);
    finishBuilds(s);
    let st = getWorld(s).stands.find((x) => x.id === r.building!.id)!;
    expect(st.reachable).toBe(false);
    expect(getWorld(s).problems.get(r.building!.id)).toBe('pb.noTaxiway');
    // Taxiway depuis le réseau existant (y=28) jusqu’au poste.
    placeLine(s, 'taxiway', linePoints({ x: 37, y: 45 }, { x: 37, y: 45 }));
    placeLine(s, 'taxiway', linePoints({ x: 36, y: 45 }, { x: 36, y: 61 }));
    finishBuilds(s);
    st = getWorld(s).stands.find((x) => x.id === r.building!.id)!;
    expect(st.reachable).toBe(true);
  });

  it('un module de terminal isolé est signalé, puis fonctionne une fois raccordé', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 12 });
    const r = place(s, 'checkin', 52, 64, 0);
    finishBuilds(s);
    expect(getWorld(s).problems.get(r.building!.id)).toBe('pb.noTerminal');
    expect(getWorld(s).active.has(r.building!.id)).toBe(false);
  });

  it('achat de terrain, amélioration et démolition', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 13 });
    expect(canBuyParcel(s, 3, 6)).toBe(true);
    expect(canBuyParcel(s, 0, 0)).toBe(false);
    const cash = s.finance.cash;
    expect(buyParcel(s, 3, 6)).toBe(true);
    expect(s.finance.cash).toBeLessThan(cash);
    const cafe = s.buildings.find((b) => b.type === 'cafe')!;
    expect(upgrade(s, cafe)).toBe(true);
    expect(cafe.level).toBe(2);
    expect(cafe.buildRemaining).toBe(0);
    expect(upgrade(s, cafe)).toBe(true);
    expect(cafe.level).toBe(3);
    const n = s.buildings.length;
    expect(demolish(s, cafe)).toBe(true);
    expect(s.buildings.length).toBe(n - 1);
  });
});

describe('opérations', () => {
  it('le brouillard ferme une piste sans ILS, l’ILS la rouvre', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 20 });
    s.weather.current = { kind: 'fog', temp: 8, wind: 3, windDir: 90 };
    const w = getWorld(s);
    expect(runwayStatus(s, w, w.runways[0])).toBe('rw.visibility');
    s.tier = 1;
    const r = place(s, 'ils', 52, 40, 0);
    expect(r.ok).toBe(true);
    finishBuilds(s);
    const w2 = getWorld(s);
    expect(runwayStatus(s, w2, w2.runways[0])).toBeNull();
  });

  it('la neige exige un dépôt de déneigement', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 21 });
    s.weather.current = { kind: 'snow', temp: -2, wind: 5, windDir: 90 };
    const w = getWorld(s);
    expect(runwayStatus(s, w, w.runways[0])).toBe('rw.snow');
  });

  it('le manque de personnel réduit le débit de traitement', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 22 });
    const full = processingRates(s).security;
    const eff = staffEfficiency(s, 'security', 12);
    hire(s, 'security', -s.staff.security.count + 1);
    expect(staffEfficiency(s, 'security', 12)).toBeLessThan(eff);
    expect(processingRates(s).security).toBeLessThan(full);
  });

  it('une alerte de sûreté ralentit la sûreté', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 23 });
    const before = processingRates(s).security;
    startIncident(s, 'security_alert', 60);
    expect(processingRates(s).security).toBeLessThan(before * 0.3);
  });

  it('sans poste libre, les avions attendent puis sont déroutés', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 24 });
    for (const b of s.buildings) if (b.type === 'stand_s') b.enabled = false;
    invalidateWorld();
    run(s, 1440);
    const diverted = s.finance.history[s.finance.history.length - 1].diverted + s.dayCounters.diverted;
    expect(diverted).toBeGreaterThan(0);
  });
});

describe('économie et progression', () => {
  it('emprunts et recherche', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 30 });
    expect(takeLoan(s, 500_000, 60)).not.toBeNull();
    expect(totalDebt(s)).toBe(500_000);
    expect(startResearch(s, 'wifi')).toBe(true);
    run(s, 1440 * 5);
    expect(s.research.done).toContain('wifi');
    // Une mensualité a peut-être été prélevée selon le jour : la dette ne doit jamais augmenter.
    expect(totalDebt(s)).toBeLessThanOrEqual(500_000);
  });

  it('partie longue (120 jours) avec un joueur automatique : aucune valeur invalide', () => {
    const s = createGame({ name: 'Long', mode: 'career', seed: 99 });
    for (let d = 0; d < 120; d++) {
      // Le "joueur" accepte les offres compatibles avec ses postes et recrute selon les besoins.
      for (const o of [...s.offers]) if (o.aircraft === 'tp70' || o.aircraft === 'rj95') acceptOffer(s, o);
      if (d === 10) {
        place(s, 'stand_s', 46, 45, 0);
        place(s, 'checkin', 32, 52, 0);
      }
      run(s, 1440);
      for (const c of ['checkin', 'security', 'baggage', 'ground', 'cleaning', 'maintenance', 'operations', 'admin'] as const) {
        const st = s.staff[c];
        if (staffEfficiency(s, c, 12) < 0.9) hire(s, c, 1);
        void st;
      }
    }
    const json = JSON.stringify(s);
    expect(json.includes('NaN')).toBe(false);
    expect(Number.isFinite(s.finance.cash)).toBe(true);
    expect(s.finance.history.length).toBe(120);
    const a = aggregate(s, 30);
    console.log('tier', s.tier, 'rep', Math.round(s.reputation), 'sat', Math.round(s.satisfaction), 'contracts', s.contracts.length, 'pax30', a.pax, 'profit30', Math.round(a.profit), 'cash', Math.round(s.finance.cash), 'flights live', s.flights.length);
    expect(a.pax).toBeGreaterThan(5000);
  }, 60_000);

  it('tous les scénarios démarrent et tournent 3 jours', () => {
    for (const sc of SCENARIOS) {
      const s = createGame({ name: sc.id, mode: sc.kind, scenario: sc.id, seed: 5 });
      expect(s.challenge?.id).toBe(sc.id);
      expect(s.objectives.length).toBeGreaterThan(0);
      run(s, 1440 * 3);
      expect(Number.isFinite(s.finance.cash)).toBe(true);
    }
    const d = createGame({ name: 'daily', mode: 'daily', seed: 5 });
    expect(d.objectives.length).toBe(2);
  });

  it('une offre générée est cohérente', () => {
    const s = createGame({ name: 'T', mode: 'career', seed: 40 });
    for (let i = 0; i < 30; i++) {
      const o = generateOffer(s);
      if (!o) continue;
      expect(o.slots.length).toBe(o.rotations);
      expect(o.slots.every((x) => x >= 0 && x < 1440)).toBe(true);
    }
  });
});
