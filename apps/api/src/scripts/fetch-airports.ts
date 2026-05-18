/**
 * Fetches the OpenFlights airports + countries datasets and writes a clean,
 * filtered, IATA-coded airports JSON for our autocomplete.
 *
 * Run once at build/setup:
 *   pnpm --filter @tripbng/api exec tsx src/scripts/fetch-airports.ts
 *
 * Output: apps/api/src/data/airports.generated.json
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AIRPORTS_URL =
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';
const COUNTRIES_URL =
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/countries.dat';

interface OutAirport {
  iata: string;
  name: string;
  city: string;
  country: string;
  countryCode: string;
}

// CSV with quoted values + commas inside strings — minimal parser tuned for OpenFlights data.
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

async function main() {
  console.warn('downloading datasets…');
  const [countriesRaw, airportsRaw] = await Promise.all([
    fetchText(COUNTRIES_URL),
    fetchText(AIRPORTS_URL),
  ]);

  // Country name → ISO-2 code
  const countryToIso = new Map<string, string>();
  for (const line of countriesRaw.split('\n')) {
    if (!line.trim()) continue;
    const cols = parseCsvRow(line);
    const name = cols[0]?.trim();
    const iso = cols[1]?.trim();
    if (name && iso && iso.length === 2) countryToIso.set(name, iso);
  }
  console.warn(`countries: ${countryToIso.size}`);

  const airports: OutAirport[] = [];
  for (const line of airportsRaw.split('\n')) {
    if (!line.trim()) continue;
    const cols = parseCsvRow(line);
    // Columns: id, name, city, country, IATA, ICAO, lat, lon, alt, tz, dst, tzName, type, source
    const name = cols[1]?.trim() ?? '';
    const city = cols[2]?.trim() ?? '';
    const country = cols[3]?.trim() ?? '';
    const iata = cols[4]?.trim() ?? '';
    const type = cols[12]?.trim() ?? '';
    if (type && type !== 'airport') continue; // drop heliports, stations, ports
    if (!iata || iata === '\\N' || iata.length !== 3) continue;
    if (!name || !city || !country) continue;
    const countryCode = countryToIso.get(country) ?? '';
    airports.push({ iata: iata.toUpperCase(), name, city, country, countryCode });
  }

  // Dedupe by IATA — keep first.
  const seen = new Set<string>();
  const dedup: OutAirport[] = [];
  for (const a of airports) {
    if (seen.has(a.iata)) continue;
    seen.add(a.iata);
    dedup.push(a);
  }

  // Sort by IATA so the file is diff-friendly.
  dedup.sort((a, b) => a.iata.localeCompare(b.iata));

  const outPath = resolve(import.meta.dirname, '..', 'data', 'airports.generated.json');
  writeFileSync(outPath, JSON.stringify(dedup, null, 0));
  console.warn(`wrote ${dedup.length} airports → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
