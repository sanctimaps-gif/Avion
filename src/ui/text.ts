import { t } from '../core/i18n';
import type { LogEntry } from '../sim/types';

/** Calendrier de jeu : 12 mois de 30 jours. */
export function dateLabel(time: number): string {
  const day = Math.floor(time / 1440);
  const year = Math.floor(day / 360) + 1;
  const doy = day % 360;
  const month = Math.floor(doy / 30);
  return `${(doy % 30) + 1} ${t('month.' + month)} ${t('ui.year')} ${year}`;
}

/** Traduit les paramètres de journal qui sont eux-mêmes des clés. */
export function logText(e: LogEntry): string {
  const p: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(e.params ?? {})) p[k] = typeof v === 'string' && /^[a-z]+\.[\w.]+$/.test(v) ? t(v) : v;
  return t(e.key, p);
}
