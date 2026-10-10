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
};

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
