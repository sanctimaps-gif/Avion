import { fr } from '../locales/fr';
import { en } from '../locales/en';

/**
 * Internationalisation. Chaque langue est un dictionnaire plat clé → texte.
 * Pour ajouter une langue : créer src/locales/xx.ts et l'enregistrer ici.
 */
export type Lang = 'fr' | 'en';
const dictionaries: Record<Lang, Record<string, string>> = { fr, en };
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
];

let current: Lang = 'fr';

export function setLang(l: Lang): void {
  current = dictionaries[l] ? l : 'fr';
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}
export function getLang(): Lang {
  return current;
}

export function t(key: string, params?: Record<string, string | number>): string {
  let s = dictionaries[current][key] ?? dictionaries.fr[key] ?? key;
  if (params) {
    for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
  }
  return s;
}

/** Vérifie si une clé existe (utilisé par les tests de complétude des traductions). */
export function hasKey(lang: Lang, key: string): boolean {
  return key in dictionaries[lang];
}
export function allKeys(lang: Lang): string[] {
  return Object.keys(dictionaries[lang]);
}
