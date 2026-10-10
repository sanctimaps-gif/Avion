import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fr } from '../src/locales/fr';
import { en } from '../src/locales/en';
import { BUILDING_LIST, BUILD_CATS } from '../src/data/buildings';
import { TECH_LIST, BRANCHES } from '../src/data/research';
import { INCIDENT_LIST } from '../src/data/incidents';
import { WEATHER_KINDS } from '../src/data/weather';
import { SCENARIOS } from '../src/data/scenarios';
import { AIRLINE_LIST } from '../src/data/airlines';
import { CAREER_OBJECTIVES } from '../src/data/objectives';
import { STAFF_CATS } from '../src/sim/types';
import { LAYERS } from '../src/render/overlays';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('traductions', () => {
  const keys = new Set<string>();
  for (const file of walk('src')) {
    if (file.includes('locales')) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]*[a-zA-Z0-9_])'/g)) keys.add(m[1]);
    for (const m of src.matchAll(/'((?:pb|rw|delay|lock|err|log|over|neg)\.[a-zA-Z.]+)'/g)) keys.add(m[1]);
  }
  for (const b of BUILDING_LIST) keys.add('b.' + b.id).add('bd.' + b.id);
  for (const c of BUILD_CATS) keys.add('cat.' + c);
  for (const tch of TECH_LIST) keys.add('tech.' + tch.id).add('techd.' + tch.id);
  for (const br of BRANCHES) keys.add('branch.' + br);
  for (const i of INCIDENT_LIST) keys.add('inc.' + i.id).add('incd.' + i.id);
  for (const w of WEATHER_KINDS) keys.add('w.' + w);
  for (const s of SCENARIOS) keys.add('sc.' + s.id).add('scd.' + s.id);
  for (const a of AIRLINE_LIST) keys.add('profile.' + a.profile);
  for (const c of STAFF_CATS) keys.add('staff.' + c).add('staffd.' + c);
  for (const l of LAYERS) keys.add('layer.' + l);
  for (const tier of CAREER_OBJECTIVES.flat()) keys.add('obj.' + tier.kind);
  for (let i = 0; i <= 6; i++) keys.add('tier.' + i);
  for (let i = 0; i < 12; i++) keys.add('month.' + i);
  for (const m of ['career', 'sandbox', 'challenge', 'event', 'daily']) keys.add('mode.' + m).add('mode.' + m + 'Desc');
  for (const p of ['scheduled', 'inbound', 'holding', 'landing', 'taxi_in', 'deboarding', 'servicing', 'boarding', 'ready', 'taxi_out', 'queue', 'takeoff', 'departed', 'diverted', 'cancelled']) keys.add('ph.' + p);
  for (const k of ['pb.noTerminal', 'pb.noRoad', 'pb.noTaxiway', 'pb.noRunway']) keys.add(k + '.fix');

  it('toutes les clés utilisées existent en français et en anglais', () => {
    const missingFr = [...keys].filter((k) => !(k in fr));
    const missingEn = [...keys].filter((k) => !(k in en));
    expect(missingFr).toEqual([]);
    expect(missingEn).toEqual([]);
  });
  it('les deux langues ont exactement les mêmes clés', () => {
    expect(Object.keys(fr).filter((k) => !(k in en))).toEqual([]);
    expect(Object.keys(en).filter((k) => !(k in fr))).toEqual([]);
  });
});
