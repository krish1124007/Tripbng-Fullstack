// Master airline list — IATA code → display name. Used to populate airline
// dropdowns (fare rules, markup rules, filters) instead of free-text entry.
// Curated for the Indian B2B market (domestic carriers first, then the Gulf /
// international carriers that matter most for outbound traffic).

export interface AirlineMaster {
  code: string; // IATA 2-char
  name: string;
}

export const AIRLINES: readonly AirlineMaster[] = [
  // ── Domestic (India) ──
  { code: '6E', name: 'IndiGo' },
  { code: 'AI', name: 'Air India' },
  { code: 'UK', name: 'Vistara' },
  { code: 'SG', name: 'SpiceJet' },
  { code: 'QP', name: 'Akasa Air' },
  { code: 'IX', name: 'Air India Express' },
  { code: 'G8', name: 'Go First' },
  { code: 'I5', name: 'AIX Connect' },
  { code: '9I', name: 'Alliance Air' },
  // ── Gulf / Middle East ──
  { code: 'EK', name: 'Emirates' },
  { code: 'EY', name: 'Etihad Airways' },
  { code: 'QR', name: 'Qatar Airways' },
  { code: 'SV', name: 'Saudia' },
  { code: 'GF', name: 'Gulf Air' },
  { code: 'WY', name: 'Oman Air' },
  { code: 'FZ', name: 'flydubai' },
  { code: 'XY', name: 'flynas' },
  { code: 'J9', name: 'Jazeera Airways' },
  { code: 'KU', name: 'Kuwait Airways' },
  // ── Asia ──
  { code: 'SQ', name: 'Singapore Airlines' },
  { code: 'TG', name: 'Thai Airways' },
  { code: 'MH', name: 'Malaysia Airlines' },
  { code: 'AK', name: 'AirAsia' },
  { code: 'CX', name: 'Cathay Pacific' },
  { code: 'UL', name: 'SriLankan Airlines' },
  { code: 'BG', name: 'Biman Bangladesh' },
  { code: 'NP', name: 'Nile Air' },
  { code: 'WS', name: 'WestJet' },
  // ── Europe / Americas ──
  { code: 'LH', name: 'Lufthansa' },
  { code: 'BA', name: 'British Airways' },
  { code: 'AF', name: 'Air France' },
  { code: 'KL', name: 'KLM' },
  { code: 'TK', name: 'Turkish Airlines' },
  { code: 'VS', name: 'Virgin Atlantic' },
  { code: 'UA', name: 'United Airlines' },
  { code: 'AA', name: 'American Airlines' },
  { code: 'DL', name: 'Delta Air Lines' },
];

const AIRLINE_BY_CODE: Record<string, string> = Object.fromEntries(
  AIRLINES.map((a) => [a.code, a.name]),
);

/** Display name for an IATA code, falling back to the code itself. */
export function airlineName(code: string | null | undefined): string {
  if (!code) return '';
  return AIRLINE_BY_CODE[code.toUpperCase()] ?? code.toUpperCase();
}
