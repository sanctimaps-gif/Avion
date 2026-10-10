import type { GameState, LogEntry } from './types';

/** Journal de bord + notifications. L'interface s'abonne via onLog. */
type Listener = (e: LogEntry) => void;
const listeners: Listener[] = [];
export function onLog(l: Listener): () => void {
  listeners.push(l);
  return () => listeners.splice(listeners.indexOf(l), 1);
}

export function addLog(s: GameState, level: LogEntry['level'], key: string, params?: LogEntry['params']): void {
  const e: LogEntry = { t: s.time, level, key, params };
  s.log.push(e);
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
  for (const l of listeners) l(e);
}
