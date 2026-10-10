import type { GameState } from '../sim/types';
import { migrate } from './migrations';
import type { KVStore } from './storage';

/**
 * Gestion des parties multiples. Chaque partie possède son propre
 * emplacement ("save:<id>") + une copie de secours ("save:<id>:bak") ;
 * l'index des parties est mis à jour dans la même transaction.
 * L'intégrité est vérifiée par somme de contrôle à chaque chargement ;
 * en cas de corruption, la copie de secours est restaurée.
 */
export interface SlotMeta {
  id: string;
  name: string;
  mode: string;
  tier: number;
  cash: number;
  day: number;
  reputation: number;
  contracts: number;
  updatedAt: number;
  playSeconds: number;
  thumb?: string;
  challenge?: string | null;
  over?: boolean;
}

interface Envelope {
  format: 'AMSAVE';
  version: number;
  checksum: string;
  savedAt: number;
  data: string;
}

export function checksum(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function metaOf(s: GameState, thumb?: string): SlotMeta {
  return {
    id: s.id,
    name: s.name,
    mode: s.mode,
    tier: s.tier,
    cash: Math.round(s.finance.cash),
    day: Math.floor(s.time / 1440),
    reputation: Math.round(s.reputation),
    contracts: s.contracts.length,
    updatedAt: Date.now(),
    playSeconds: Math.round(s.playSeconds),
    thumb,
    challenge: s.challenge?.id ?? null,
    over: !!s.gameOver,
  };
}

export type LoadResult = { state: GameState; recovered: boolean } | { error: string };

export class SaveManager {
  constructor(private store: KVStore) {}

  async list(): Promise<SlotMeta[]> {
    const raw = await this.store.get('index');
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as SlotMeta[];
      return arr.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return this.rebuildIndex();
    }
  }

  /** Reconstruit l'index à partir des emplacements présents (index corrompu). */
  async rebuildIndex(): Promise<SlotMeta[]> {
    const keys = (await this.store.keys()).filter((k) => /^save:[^:]+$/.test(k));
    const metas: SlotMeta[] = [];
    for (const k of keys) {
      const r = await this.load(k.slice(5));
      if ('state' in r) metas.push(metaOf(r.state));
    }
    await this.store.commit({ index: JSON.stringify(metas) });
    return metas;
  }

  async save(s: GameState, thumb?: string): Promise<void> {
    s.updatedAt = Date.now();
    const data = JSON.stringify(s);
    const env: Envelope = { format: 'AMSAVE', version: s.version, checksum: checksum(data), savedAt: Date.now(), data };
    const key = 'save:' + s.id;
    const previous = await this.store.get(key);
    const index = (await this.list()).filter((m) => m.id !== s.id);
    const oldMeta = (await this.list()).find((m) => m.id === s.id);
    index.push(metaOf(s, thumb ?? oldMeta?.thumb));
    const ops: Record<string, string | null> = {
      [key]: JSON.stringify(env),
      index: JSON.stringify(index),
      last: s.id,
    };
    // La copie de secours n'est remplacée que si l'ancienne sauvegarde était saine.
    if (previous && this.validEnvelope(previous)) ops[key + ':bak'] = previous;
    await this.store.commit(ops);
  }

  private validEnvelope(raw: string): Envelope | null {
    try {
      const env = JSON.parse(raw) as Envelope;
      if (env.format !== 'AMSAVE' || typeof env.data !== 'string') return null;
      if (checksum(env.data) !== env.checksum) return null;
      return env;
    } catch {
      return null;
    }
  }

  private decode(raw: string | null): GameState | null {
    if (!raw) return null;
    const env = this.validEnvelope(raw);
    if (!env) return null;
    try {
      return migrate(JSON.parse(env.data)) as GameState;
    } catch {
      return null;
    }
  }

  async load(id: string): Promise<LoadResult> {
    const main = this.decode(await this.store.get('save:' + id));
    if (main) return { state: main, recovered: false };
    const bak = this.decode(await this.store.get('save:' + id + ':bak'));
    if (bak) return { state: bak, recovered: true };
    return { error: 'err.saveCorrupt' };
  }

  async lastPlayed(): Promise<string | null> {
    const id = await this.store.get('last');
    if (!id) return null;
    const list = await this.list();
    return list.some((m) => m.id === id) ? id : (list[0]?.id ?? null);
  }

  async rename(id: string, name: string): Promise<boolean> {
    const r = await this.load(id);
    if (!('state' in r)) return false;
    r.state.name = name;
    await this.save(r.state);
    return true;
  }

  async remove(id: string): Promise<void> {
    const index = (await this.list()).filter((m) => m.id !== id);
    const last = await this.store.get('last');
    await this.store.commit({
      ['save:' + id]: null,
      ['save:' + id + ':bak']: null,
      index: JSON.stringify(index),
      last: last === id ? (index[0]?.id ?? null) : last,
    });
  }

  /** Export d'une partie (fichier de sauvegarde portable). */
  async exportSave(id: string): Promise<string | null> {
    return this.store.get('save:' + id);
  }

  /** Import : la partie reçoit un nouvel identifiant pour ne rien écraser. */
  async importSave(raw: string): Promise<GameState | null> {
    const s = this.decode(raw);
    if (!s) return null;
    s.id = `g${Date.now().toString(36)}i`;
    s.name = s.name + ' (import)';
    await this.save(s);
    return s;
  }
}
