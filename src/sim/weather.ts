import { CLIMATE, PERSISTENCE, SEASON_TEMP, WEATHER_KINDS } from '../data/weather';
import { Rng } from '../core/rng';
import { clamp } from '../core/format';
import { addLog } from './log';
import type { GameState, WeatherHour, WeatherKind } from './types';

/**
 * Météo dynamique : chaîne de Markov horaire, pondérée par la saison,
 * avec prévisions sur 48 h (générées à l'avance, donc fiables pour planifier).
 */
export function season(day: number): number {
  const doy = ((day % 360) + 360) % 360;
  // 0 hiver (déc-fév), 1 printemps, 2 été, 3 automne. Jour 0 = 1er janvier.
  if (doy < 60 || doy >= 330) return 0;
  if (doy < 150) return 1;
  if (doy < 240) return 2;
  return 3;
}

function windFor(kind: WeatherKind, r: Rng): number {
  switch (kind) {
    case 'wind': return r.range(18, 30);
    case 'gusts': return r.range(25, 40);
    case 'storm': return r.range(38, 60);
    case 'blizzard': return r.range(30, 48);
    case 'thunder': return r.range(15, 32);
    default: return r.range(3, 14);
  }
}

export function nextHour(prev: WeatherHour, hourAbs: number, r: Rng): WeatherHour {
  const day = Math.floor(hourAbs / 24);
  const sea = season(day);
  let kind: WeatherKind = prev.kind;
  if (!r.chance(PERSISTENCE[prev.kind])) {
    kind = r.weighted(WEATHER_KINDS, (k) => CLIMATE[k][sea]);
  }
  const hour = hourAbs % 24;
  const diurnal = Math.sin(((hour - 9) / 24) * Math.PI * 2) * 5;
  let temp = SEASON_TEMP[sea] + diurnal + r.gauss(0, 2.5);
  temp = prev.temp + (temp - prev.temp) * 0.35;
  if ((kind === 'snow' || kind === 'blizzard' || kind === 'frost') && temp > 2) {
    if (sea === 0) temp = r.range(-6, 1);
    else kind = kind === 'frost' ? 'cloudy' : 'rain';
  }
  if (kind === 'heat') {
    if (sea === 2) temp = Math.max(temp, r.range(31, 38));
    else kind = 'clear';
  }
  if (kind === 'rain' && temp < 0) kind = 'snow';
  const windDir = (prev.windDir + r.gauss(0, 18) + 360) % 360;
  return { kind, temp: Math.round(temp * 10) / 10, wind: Math.round(windFor(kind, r)), windDir: Math.round(windDir) };
}

export function initWeather(s: GameState): void {
  const r = new Rng(s.rng);
  const hourAbs = Math.floor(s.time / 60);
  const sea = season(Math.floor(hourAbs / 24));
  let cur: WeatherHour = { kind: 'clear', temp: SEASON_TEMP[sea], wind: 8, windDir: r.int(0, 359) };
  const forecast: WeatherHour[] = [];
  for (let i = 1; i <= 48; i++) {
    cur = nextHour(cur, hourAbs + i, r);
    forecast.push(cur);
  }
  s.weather = { current: { kind: 'clear', temp: SEASON_TEMP[sea], wind: 8, windDir: forecast[0].windDir }, forecast, lastHour: hourAbs };
  s.rng = r.state;
}

export function weatherHourly(s: GameState): void {
  const hourAbs = Math.floor(s.time / 60);
  if (hourAbs === s.weather.lastHour) return;
  const r = new Rng(s.rng);
  const prevKind = s.weather.current.kind;
  s.weather.current = s.weather.forecast.shift()!;
  const last = s.weather.forecast[s.weather.forecast.length - 1] ?? s.weather.current;
  s.weather.forecast.push(nextHour(last, hourAbs + 48, r));
  s.weather.lastHour = hourAbs;
  s.rng = r.state;
  const k = s.weather.current.kind;
  if (s.settings.weather && k !== prevKind && ['storm', 'blizzard', 'thunder', 'fog', 'snow'].includes(k)) {
    addLog(s, k === 'fog' || k === 'snow' ? 'warn' : 'bad', 'log.weather', { w: 'w.' + k });
  }
}

/** Résumé des 24 prochaines heures pour l'interface. */
export function forecastSummary(s: GameState, hours = 24): WeatherHour[] {
  return s.weather.forecast.slice(0, clamp(hours, 1, 48));
}
