/**
 * Abstraction du stockage local. IndexedDB est utilisé en priorité
 * (transactions atomiques : une sauvegarde interrompue ne corrompt jamais
 * la précédente) ; localStorage sert de solution de repli ; une version en
 * mémoire sert aux tests.
 */
export interface KVStore {
  get(key: string): Promise<string | null>;
  /** Écrit/supprime plusieurs clés de façon atomique (null = suppression). */
  commit(ops: Record<string, string | null>): Promise<void>;
  keys(): Promise<string[]>;
}

export class MemoryStore implements KVStore {
  data = new Map<string, string>();
  failNextCommit = false;
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async commit(ops: Record<string, string | null>) {
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error('simulated interruption');
    }
    for (const [k, v] of Object.entries(ops)) {
      if (v === null) this.data.delete(k);
      else this.data.set(k, v);
    }
  }
  async keys() {
    return [...this.data.keys()];
  }
}

export class LocalStore implements KVStore {
  constructor(private prefix = 'am:') {}
  async get(key: string) {
    return localStorage.getItem(this.prefix + key);
  }
  async commit(ops: Record<string, string | null>) {
    // localStorage n'est pas transactionnel : on écrit d'abord les nouvelles
    // valeurs dans des clés temporaires, puis on les bascule.
    const entries = Object.entries(ops);
    for (const [k, v] of entries) if (v !== null) localStorage.setItem(this.prefix + 'tmp:' + k, v);
    for (const [k, v] of entries) {
      if (v === null) localStorage.removeItem(this.prefix + k);
      else {
        localStorage.setItem(this.prefix + k, v);
        localStorage.removeItem(this.prefix + 'tmp:' + k);
      }
    }
  }
  async keys() {
    const r: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(this.prefix) && !k.startsWith(this.prefix + 'tmp:')) r.push(k.slice(this.prefix.length));
    }
    return r;
  }
}

export class IdbStore implements KVStore {
  private db: Promise<IDBDatabase>;
  constructor(name = 'airport-manager') {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async get(key: string): Promise<string | null> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }
  async commit(ops: Record<string, string | null>): Promise<void> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      const st = tx.objectStore('kv');
      for (const [k, v] of Object.entries(ops)) {
        if (v === null) st.delete(k);
        else st.put(v, k);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    });
  }
  async keys(): Promise<string[]> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String));
      req.onerror = () => reject(req.error);
    });
  }
}

export async function openBestStore(): Promise<KVStore> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const s = new IdbStore();
      await s.keys();
      return s;
    }
  } catch {
    /* repli */
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('am:probe', '1');
      localStorage.removeItem('am:probe');
      return new LocalStore();
    }
  } catch {
    /* repli */
  }
  return new MemoryStore();
}
