import type { WeatherKind } from '../sim/types';

/**
 * Effets opérationnels de chaque condition météo.
 * runwayCap : multiplicateur de capacité piste ; visibility : 0..1 ;
 * needsDeicing / needsSnow : opérations hivernales requises.
 */
export interface WeatherDef {
  kind: WeatherKind;
  runwayCap: number;
  visibility: number;
  delay: number; // minutes de retard moyen ajoutées
  cancel: number; // probabilité d'annulation par vol
  needsDeicing: boolean;
  needsSnow: boolean;
  energy: number; // multiplicateur énergie
  satisfaction: number; // effet direct
  staffLoad: number; // charge supplémentaire pour le personnel
  severe: boolean;
}

export const WEATHER: Record<WeatherKind, WeatherDef> = {
  clear: { kind: 'clear', runwayCap: 1, visibility: 1, delay: 0, cancel: 0, needsDeicing: false, needsSnow: false, energy: 1, satisfaction: 1, staffLoad: 0, severe: false },
  cloudy: { kind: 'cloudy', runwayCap: 1, visibility: 0.9, delay: 0, cancel: 0, needsDeicing: false, needsSnow: false, energy: 1.02, satisfaction: 0, staffLoad: 0, severe: false },
  rain: { kind: 'rain', runwayCap: 0.85, visibility: 0.7, delay: 4, cancel: 0, needsDeicing: false, needsSnow: false, energy: 1.03, satisfaction: -1, staffLoad: 0.05, severe: false },
  fog: { kind: 'fog', runwayCap: 0.5, visibility: 0.15, delay: 12, cancel: 0.02, needsDeicing: false, needsSnow: false, energy: 1.05, satisfaction: -2, staffLoad: 0.05, severe: false },
  snow: { kind: 'snow', runwayCap: 0.55, visibility: 0.4, delay: 18, cancel: 0.04, needsDeicing: true, needsSnow: true, energy: 1.35, satisfaction: -3, staffLoad: 0.2, severe: false },
  frost: { kind: 'frost', runwayCap: 0.85, visibility: 0.9, delay: 6, cancel: 0, needsDeicing: true, needsSnow: false, energy: 1.25, satisfaction: -1, staffLoad: 0.1, severe: false },
  wind: { kind: 'wind', runwayCap: 0.8, visibility: 0.95, delay: 5, cancel: 0.005, needsDeicing: false, needsSnow: false, energy: 1.05, satisfaction: -1, staffLoad: 0.05, severe: false },
  gusts: { kind: 'gusts', runwayCap: 0.65, visibility: 0.9, delay: 10, cancel: 0.02, needsDeicing: false, needsSnow: false, energy: 1.05, satisfaction: -2, staffLoad: 0.05, severe: false },
  thunder: { kind: 'thunder', runwayCap: 0.45, visibility: 0.5, delay: 25, cancel: 0.05, needsDeicing: false, needsSnow: false, energy: 1.05, satisfaction: -4, staffLoad: 0.1, severe: true },
  storm: { kind: 'storm', runwayCap: 0.25, visibility: 0.4, delay: 45, cancel: 0.15, needsDeicing: false, needsSnow: false, energy: 1.1, satisfaction: -6, staffLoad: 0.15, severe: true },
  heat: { kind: 'heat', runwayCap: 0.9, visibility: 1, delay: 3, cancel: 0, needsDeicing: false, needsSnow: false, energy: 1.4, satisfaction: -2, staffLoad: 0.1, severe: false },
  blizzard: { kind: 'blizzard', runwayCap: 0.15, visibility: 0.1, delay: 60, cancel: 0.3, needsDeicing: true, needsSnow: true, energy: 1.6, satisfaction: -7, staffLoad: 0.3, severe: true },
};

export const WEATHER_KINDS = Object.keys(WEATHER) as WeatherKind[];

/** Climat : poids de chaque condition selon la saison (0 hiver … 3 automne). */
export const CLIMATE: Record<WeatherKind, [number, number, number, number]> = {
  clear: [18, 30, 42, 20],
  cloudy: [24, 26, 18, 28],
  rain: [12, 18, 8, 22],
  fog: [9, 4, 1, 10],
  snow: [10, 1, 0, 1],
  frost: [12, 2, 0, 3],
  wind: [6, 7, 4, 8],
  gusts: [4, 3, 2, 5],
  thunder: [0, 4, 7, 2],
  storm: [2, 1, 1, 3],
  heat: [0, 1, 14, 0],
  blizzard: [2, 0, 0, 0],
};

export const SEASON_TEMP: [number, number, number, number] = [3, 13, 25, 12];

/** Persistance : probabilité de garder la même condition d'une heure sur l'autre. */
export const PERSISTENCE: Record<WeatherKind, number> = {
  clear: 0.92, cloudy: 0.88, rain: 0.82, fog: 0.75, snow: 0.8, frost: 0.85, wind: 0.8,
  gusts: 0.7, thunder: 0.55, storm: 0.6, heat: 0.92, blizzard: 0.6,
};

export const WEATHER_ICON: Record<WeatherKind, string> = {
  clear: '☀️', cloudy: '⛅', rain: '🌧️', fog: '🌫️', snow: '🌨️', frost: '🧊', wind: '💨',
  gusts: '🌬️', thunder: '⛈️', storm: '🌀', heat: '🔥', blizzard: '❄️',
};
