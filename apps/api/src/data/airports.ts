import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Airport } from '@tripbng/shared';

// 6,000+ commercial airports worldwide, generated from OpenFlights (countries.dat
// joined with airports.dat → IATA-coded airports only). Run
// `pnpm --filter @tripbng/api exec tsx src/scripts/fetch-airports.ts` to refresh.
//
// Loaded once at boot (~630 KB JSON) — autocomplete is in-memory after that.
const GENERATED_PATH = resolve(import.meta.dirname, '..', '..', 'src', 'data', 'airports.generated.json');
const GENERATED: readonly Airport[] = JSON.parse(
  readFileSync(GENERATED_PATH, 'utf-8'),
) as Airport[];

// Top Indian + Gulf hubs we want to surface first when the user types short prefixes.
// Anything in this list outranks the OpenFlights data for prefix matches.
const PRIORITY_IATA = new Set([
  'BOM',
  'DEL',
  'BLR',
  'MAA',
  'CCU',
  'HYD',
  'AMD',
  'PNQ',
  'COK',
  'TRV',
  'GOI',
  'GOX',
  'JAI',
  'LKO',
  'IXC',
  'NAG',
  'IDR',
  'GAU',
  'SXR',
  'IXM',
  'IXB',
  'IXR',
  'PAT',
  'BBI',
  'VNS',
  'IXJ',
  'CJB',
  'IXE',
  'DXB',
  'AUH',
  'DOH',
  'SIN',
  'BKK',
  'KUL',
  'CMB',
  'KTM',
  'LHR',
  'JFK',
  'LAX',
  'CDG',
  'FRA',
  'AMS',
  'IST',
  'HND',
  'SYD',
]);

export const AIRPORTS: readonly Airport[] = GENERATED;

// Naive in-memory search by code, name, or city. ~6k rows; sub-ms in practice.
// Ranks: exact IATA → priority hub starts-with → other starts-with → contains.
export function searchAirports(q: string, limit = 10): Airport[] {
  const needle = q.toLowerCase().trim();
  if (!needle) return [];
  const exactCode: Airport[] = [];
  const priorityStartsWith: Airport[] = [];
  const startsWith: Airport[] = [];
  const contains: Airport[] = [];
  for (const a of AIRPORTS) {
    const iata = a.iata.toLowerCase();
    if (iata === needle) {
      exactCode.push(a);
      continue;
    }
    const city = a.city.toLowerCase();
    const name = a.name.toLowerCase();
    if (iata.startsWith(needle) || city.startsWith(needle) || name.startsWith(needle)) {
      if (PRIORITY_IATA.has(a.iata)) priorityStartsWith.push(a);
      else startsWith.push(a);
    } else if (
      iata.includes(needle) ||
      city.includes(needle) ||
      name.includes(needle) ||
      a.country.toLowerCase().includes(needle)
    ) {
      contains.push(a);
    }
  }
  return [...exactCode, ...priorityStartsWith, ...startsWith, ...contains].slice(0, limit);
}
