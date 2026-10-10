import { getLang } from './i18n';

export function money(v: number, compact = true): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (compact) {
    if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)} Md€`;
    if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2)} M€`;
    if (a >= 1e4) return `${sign}${(a / 1e3).toFixed(1)} k€`;
  }
  return `${sign}${Math.round(a).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-US')} €`;
}

export function num(v: number, digits = 0): string {
  return v.toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function pct(v: number, digits = 0): string {
  return `${num(v * 100, digits)} %`;
}

/** Minute de la journée → "HH:MM". */
export function clock(minuteOfDay: number): string {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
