import { describe, expect, it } from 'vitest';
import { SaveManager, checksum } from '../src/save/saveManager';
import { MemoryStore } from '../src/save/storage';
import { createGame } from '../src/sim/state';
import { tick } from '../src/sim/simulation';
import { migrate } from '../src/save/migrations';
import { SAVE_VERSION } from '../src/sim/state';

describe('sauvegardes multiples', () => {
  it('sauvegarde et recharge une partie à l’identique', async () => {
    const sm = new SaveManager(new MemoryStore());
    const s = createGame({ name: 'Alpha', mode: 'career', seed: 1 });
    for (let i = 0; i < 2000; i++) tick(s);
    await sm.save(s);
    const r = await sm.load(s.id);
    expect('state' in r).toBe(true);
    if ('state' in r) {
      expect(r.recovered).toBe(false);
      expect(JSON.stringify(r.state)).toBe(JSON.stringify(s));
      // La simulation reprend de façon déterministe.
      for (let i = 0; i < 500; i++) { tick(s); tick(r.state); }
      expect(r.state.finance.cash).toBeCloseTo(s.finance.cash, 6);
    }
  });

  it('les parties sont indépendantes (charger/renommer/supprimer)', async () => {
    const sm = new SaveManager(new MemoryStore());
    const a = createGame({ name: 'A', mode: 'career', seed: 2 });
    const b = createGame({ name: 'B', mode: 'sandbox', seed: 3, unlimitedMoney: true });
    a.finance.cash = 111;
    b.finance.cash = 222;
    await sm.save(a);
    await sm.save(b);
    expect((await sm.list()).map((m) => m.name).sort()).toEqual(['A', 'B']);
    await sm.rename(a.id, 'A2');
    const ra = await sm.load(a.id);
    const rb = await sm.load(b.id);
    expect('state' in ra && ra.state.name).toBe('A2');
    expect('state' in ra && ra.state.finance.cash).toBe(111);
    expect('state' in rb && rb.state.finance.cash).toBe(222);
    await sm.remove(a.id);
    expect((await sm.list()).map((m) => m.id)).toEqual([b.id]);
    expect('error' in (await sm.load(a.id))).toBe(true);
    expect(await sm.lastPlayed()).toBe(b.id);
  });

  it('restaure la copie de secours si la sauvegarde est corrompue', async () => {
    const store = new MemoryStore();
    const sm = new SaveManager(store);
    const s = createGame({ name: 'C', mode: 'career', seed: 4 });
    s.finance.cash = 1000;
    await sm.save(s);
    s.finance.cash = 2000;
    await sm.save(s);
    // Corruption du fichier principal (écriture partielle simulée).
    const raw = store.data.get('save:' + s.id)!;
    store.data.set('save:' + s.id, raw.slice(0, raw.length / 2));
    const r = await sm.load(s.id);
    expect('state' in r).toBe(true);
    if ('state' in r) {
      expect(r.recovered).toBe(true);
      expect(r.state.finance.cash).toBe(1000);
    }
  });

  it('une sauvegarde interrompue ne détruit pas la précédente', async () => {
    const store = new MemoryStore();
    const sm = new SaveManager(store);
    const s = createGame({ name: 'D', mode: 'career', seed: 5 });
    s.finance.cash = 5;
    await sm.save(s);
    s.finance.cash = 6;
    store.failNextCommit = true;
    await expect(sm.save(s)).rejects.toThrow();
    const r = await sm.load(s.id);
    expect('state' in r && r.state.finance.cash).toBe(5);
  });

  it('détecte une altération via la somme de contrôle', () => {
    expect(checksum('abc')).not.toBe(checksum('abd'));
  });

  it('migre une sauvegarde v0 vers la version courante', () => {
    const s = createGame({ name: 'E', mode: 'career', seed: 6 }) as unknown as Record<string, unknown>;
    delete s.dayCounters;
    delete s.forced;
    s.version = 0;
    const m = migrate(s);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.dayCounters).toBeDefined();
    expect(Array.isArray(m.forced)).toBe(true);
  });

  it('importe une partie sans écraser l’originale', async () => {
    const sm = new SaveManager(new MemoryStore());
    const s = createGame({ name: 'F', mode: 'career', seed: 7 });
    await sm.save(s);
    const raw = (await sm.exportSave(s.id))!;
    const imp = await sm.importSave(raw);
    expect(imp).not.toBeNull();
    expect(imp!.id).not.toBe(s.id);
    expect((await sm.list()).length).toBe(2);
  });
});
