import type { SearchRequest, SearchResponse } from '@tripbng/shared';

export type FlightResult = SearchResponse['results'][number];
export type SortKey =
  | 'recommended'
  | 'price'
  | 'price_desc'
  | 'duration'
  | 'departure_asc'
  | 'departure_desc'
  | 'arrival_asc'
  | 'arrival_desc';

// ────────── Filter state — single source of truth shared between
// the sidebar component and the page's filter pipeline ──────────

export interface FlightFilters {
  /** Allowed stop counts. Empty Set = no filter applied. */
  stops: Set<0 | 1 | 2>;
  /** Inclusive price band in paise. Sentinel [0, Infinity] = no filter. */
  priceRange: [number, number];
  /** Max total travel duration in minutes. Infinity = no filter. */
  maxDurationMin: number;
  /** Departure-time buckets the user accepts:
   *  0 = 00:00-06:00, 1 = 06:00-12:00, 2 = 12:00-18:00, 3 = 18:00-24:00.
   *  Empty = no filter. */
  departureBuckets: Set<0 | 1 | 2 | 3>;
  /** Same scheme, applied to the last segment's arrival hour. */
  arrivalBuckets: Set<0 | 1 | 2 | 3>;
  /** Airline IATA codes the user wants. Empty = all. */
  airlines: Set<string>;
  refundableOnly: boolean;
  /** Inventory-shape source. */
  sources: Set<'SERIES' | 'LCC' | 'FSC' | 'API'>;
  /** Supplier codes (KAFILA, AIRIQ, ETRAV, TBO, …). */
  suppliers: Set<string>;
  /** Fare-type buckets (MAIN/FLX/SAVR/SME/LCC). Empty = all. */
  fareTypes: Set<'MAIN' | 'FLX' | 'SAVR' | 'SME' | 'LCC'>;
  /** Hide results whose incentive is below this paise amount. 0 = no filter. */
  minIncentivePaise: number;
  /** Toggle: only show results where the agent earns a positive incentive. */
  positiveIncentiveOnly: boolean;
  /** Layover airport IATA codes — only relevant for 1+ stop results. */
  layovers: Set<string>;
  /** Minimum seats remaining (e.g. need >=9 for a group booking). */
  minSeats: number;
  /** Free-text filter on flight number + airline name. */
  query: string;
}

export const emptyFilters: FlightFilters = {
  stops: new Set(),
  priceRange: [0, Number.POSITIVE_INFINITY],
  maxDurationMin: Number.POSITIVE_INFINITY,
  departureBuckets: new Set(),
  arrivalBuckets: new Set(),
  airlines: new Set(),
  refundableOnly: false,
  sources: new Set(),
  suppliers: new Set(),
  layovers: new Set(),
  minSeats: 0,
  query: '',
  fareTypes: new Set(),
  minIncentivePaise: 0,
  positiveIncentiveOnly: false,
};

// ────────── Fare-type classifier ──────────
//
// Suppliers ship fare classes as free-text strings (RCIP, YOWIN,
// SAVER, FLEX_PLUS, SME_ANNUAL, …). We bucket them into a small
// vocabulary the agent recognises across vendors:
//   MAIN — standard fare, the default
//   FLX  — flexible / refundable / change-friendly
//   SAVR — series / consolidator saver bucket
//   SME  — corporate / SME fare class
//   LCC  — low-cost carrier publishable fare
// The result.refundable + result.source flags add signal when
// fareClass is missing entirely.

export interface FareTypeInfo {
  code: 'MAIN' | 'FLX' | 'SAVR' | 'SME' | 'LCC';
  /** Tailwind class string for the pill background + text colour. */
  toneClass: string;
  /** title= attribute for hover. */
  tooltip: string;
}

const FARE_TYPE_TONES: Record<FareTypeInfo['code'], { toneClass: string; tooltip: string }> = {
  MAIN: {
    toneClass: 'bg-teal-100 text-teal-800',
    tooltip: 'Main · standard fare',
  },
  FLX: {
    toneClass: 'bg-orange-100 text-orange-800',
    tooltip: 'Flex · refundable + date-change-friendly',
  },
  SAVR: {
    toneClass: 'bg-emerald-100 text-emerald-800',
    tooltip: 'Saver · series / consolidator fare',
  },
  SME: {
    toneClass: 'bg-amber-100 text-amber-800',
    tooltip: 'SME · corporate fare class',
  },
  LCC: {
    toneClass: 'bg-sky-100 text-sky-800',
    tooltip: 'LCC · low-cost carrier published fare',
  },
};

export function classifyFare(r: FlightResult): FareTypeInfo {
  const fc = (r.fareClass ?? '').toUpperCase();
  let code: FareTypeInfo['code'] = 'MAIN';
  if (/SME|CORP/.test(fc)) code = 'SME';
  else if (/FLEX|FLX|FLEXI|REFUND/.test(fc) || (r.refundable && r.source !== 'SERIES')) code = 'FLX';
  else if (r.source === 'SERIES' || /SAVE|SAVR|SVR/.test(fc)) code = 'SAVR';
  else if (r.source === 'LCC') code = 'LCC';
  return { code, ...FARE_TYPE_TONES[code] };
}

// ────────── Fare-bundle benefits ──────────
//
// Suppliers in India don't ship granular "what's included" structured
// data — only the legacy text fields (baggageCheckin / baggageCabin /
// fareRuleDescription). We synthesize the typical bundle composition
// from the fare-type bucket so the agent can answer "does this fare
// include a meal?" without opening the fare-rules iframe.
//
// Each benefit has one of three states:
//   • 'included'    — bundled in this fare
//   • 'chargeable'  — buyable at the airport (greyed out, with "+ ₹")
//   • 'excluded'    — not available on this bundle (greyed + struck)
//
// The mapping below is heuristic and conservative — when in doubt we
// default to 'chargeable' rather than 'included' so we never over-
// promise. Agencies that have richer per-bucket data can override this
// table later.

export type BenefitState = 'included' | 'chargeable' | 'excluded';

export type BenefitKey = 'baggage' | 'cabin' | 'meal' | 'seat' | 'change' | 'refund';

export interface FareBenefit {
  key: BenefitKey;
  /** Short label for the chip. */
  label: string;
  /** Optional sub-label rendered below (e.g. "15 kg"). */
  detail?: string;
  state: BenefitState;
}

export function getFareBenefits(r: FlightResult): FareBenefit[] {
  const type = classifyFare(r);

  // Baggage — driven by the live fields when present.
  const baggageDetail = r.baggageCheckin ? r.baggageCheckin : undefined;
  const cabinDetail = r.baggageCabin ? r.baggageCabin : undefined;

  // Defaults per bucket.
  let mealState: BenefitState;
  let seatState: BenefitState;
  let changeState: BenefitState;
  const refundState: BenefitState = r.refundable ? 'included' : 'chargeable';

  switch (type.code) {
    case 'SME':
      mealState = 'included';
      seatState = 'included';
      changeState = 'included';
      break;
    case 'FLX':
      mealState = 'chargeable';
      seatState = 'included';
      changeState = 'included';
      break;
    case 'MAIN':
      mealState = 'chargeable';
      seatState = 'chargeable';
      changeState = 'chargeable';
      break;
    case 'SAVR':
      mealState = 'chargeable';
      seatState = 'chargeable';
      changeState = 'chargeable';
      break;
    case 'LCC':
    default:
      mealState = 'chargeable';
      seatState = 'chargeable';
      changeState = 'chargeable';
      break;
  }

  // Business / first-class always upgrades meal + seat to "included".
  if (r.travelClass === 'BUSINESS' || r.travelClass === 'FIRST') {
    mealState = 'included';
    seatState = 'included';
  }

  return [
    {
      key: 'baggage',
      label: 'Check-in baggage',
      detail: baggageDetail,
      state: baggageDetail ? 'included' : 'chargeable',
    },
    {
      key: 'cabin',
      label: 'Cabin baggage',
      detail: cabinDetail,
      state: cabinDetail ? 'included' : 'chargeable',
    },
    { key: 'meal', label: 'Meal', state: mealState },
    { key: 'seat', label: 'Seat selection', state: seatState },
    { key: 'change', label: 'Date change', state: changeState },
    { key: 'refund', label: 'Refund', state: refundState },
  ];
}

/** Time-bucket lookup. Hour 24 wraps to 0 — guards a one-off result. */
export function timeBucket(iso: string): 0 | 1 | 2 | 3 {
  const h = new Date(iso).getHours();
  if (h < 6) return 0;
  if (h < 12) return 1;
  if (h < 18) return 2;
  return 3;
}

export const TIME_BUCKETS: { value: 0 | 1 | 2 | 3; label: string; range: string }[] = [
  { value: 0, label: 'Early morning', range: 'Before 6 AM' },
  { value: 1, label: 'Morning', range: '6 AM – 12 PM' },
  { value: 2, label: 'Afternoon', range: '12 PM – 6 PM' },
  { value: 3, label: 'Evening', range: 'After 6 PM' },
];

/** Apply the filter object to a result list. Pure — no sort, just filter. */
export function applyFlightFilters(results: FlightResult[], f: FlightFilters): FlightResult[] {
  return results.filter((r) => {
    if (f.refundableOnly && !r.refundable) return false;
    if (f.stops.size > 0) {
      const cap = r.stops >= 2 ? 2 : (r.stops as 0 | 1);
      if (!f.stops.has(cap)) return false;
    }
    if (r.totalGrossPaise < f.priceRange[0] || r.totalGrossPaise > f.priceRange[1]) return false;
    if (r.totalDuration > f.maxDurationMin) return false;
    const firstDep = r.segments[0]?.departure;
    if (f.departureBuckets.size > 0 && firstDep && !f.departureBuckets.has(timeBucket(firstDep))) {
      return false;
    }
    const lastArr = r.segments[r.segments.length - 1]?.arrival;
    if (f.arrivalBuckets.size > 0 && lastArr && !f.arrivalBuckets.has(timeBucket(lastArr))) {
      return false;
    }
    if (f.airlines.size > 0) {
      const code = r.segments[0]?.airline.code;
      if (!code || !f.airlines.has(code)) return false;
    }
    if (f.sources.size > 0 && !f.sources.has(r.source)) return false;
    if (f.suppliers.size > 0 && !f.suppliers.has(r.supplierCode)) return false;
    if (f.layovers.size > 0) {
      // Layover airports = origins of intermediate segments (not the
      // very first one — that's the search origin).
      const stops = r.segments.slice(1).map((s) => s.origin.code);
      if (!stops.some((c) => f.layovers.has(c))) return false;
    }
    if (f.minSeats > 0) {
      const seats = r.seatsRemaining ?? 0;
      if (seats < f.minSeats) return false;
    }
    if (f.query.trim()) {
      const q = f.query.trim().toLowerCase();
      const hay = r.segments
        .map((s) => `${s.airline.code} ${s.airline.name ?? ''} ${s.flightNumber}`)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.fareTypes.size > 0) {
      // Cheap inline classification — must mirror classifyFare() in this
      // file. We do it here instead of importing classifyFare to keep
      // this filter helper pure and avoid the per-row info-object alloc.
      const fc = (r.fareClass ?? '').toUpperCase();
      let bucket: 'MAIN' | 'FLX' | 'SAVR' | 'SME' | 'LCC' = 'MAIN';
      if (/SME|CORP/.test(fc)) bucket = 'SME';
      else if (/FLEX|FLX|FLEXI|REFUND/.test(fc) || (r.refundable && r.source !== 'SERIES'))
        bucket = 'FLX';
      else if (r.source === 'SERIES' || /SAVE|SAVR|SVR/.test(fc)) bucket = 'SAVR';
      else if (r.source === 'LCC') bucket = 'LCC';
      if (!f.fareTypes.has(bucket)) return false;
    }
    if (f.positiveIncentiveOnly) {
      const inc = r.totalGrossPaise - r.totalAgencyPayablePaise;
      if (inc <= 0) return false;
    }
    if (f.minIncentivePaise > 0) {
      const inc = r.totalGrossPaise - r.totalAgencyPayablePaise;
      if (inc < f.minIncentivePaise) return false;
    }
    return true;
  });
}

/** Count how many distinct filter dimensions are non-default. Used for
 *  the "Clear all (n)" pill + the mobile drawer's badge count. */
export function activeFilterCount(f: FlightFilters): number {
  let n = 0;
  if (f.stops.size > 0) n++;
  if (f.priceRange[0] > 0 || f.priceRange[1] !== Number.POSITIVE_INFINITY) n++;
  if (f.maxDurationMin !== Number.POSITIVE_INFINITY) n++;
  if (f.departureBuckets.size > 0) n++;
  if (f.arrivalBuckets.size > 0) n++;
  if (f.airlines.size > 0) n++;
  if (f.refundableOnly) n++;
  if (f.sources.size > 0) n++;
  if (f.suppliers.size > 0) n++;
  if (f.layovers.size > 0) n++;
  if (f.minSeats > 0) n++;
  if (f.query.trim()) n++;
  if (f.fareTypes.size > 0) n++;
  if (f.minIncentivePaise > 0) n++;
  if (f.positiveIncentiveOnly) n++;
  return n;
}

const toDateStr = (d: Date | string): string =>
  (typeof d === 'string' ? new Date(d) : d).toISOString().slice(0, 10);

/**
 * Encodes a SearchRequest into a /flights/search URL.
 *   one-way:    ?tripType=ONEWAY&from=BOM&to=DEL&date=2026-05-10&...
 *   round-trip: ?tripType=ROUNDTRIP&from=BOM&to=DEL&date=2026-05-10&returnDate=2026-05-15&...
 *   multi-city: ?tripType=MULTICITY&seg=BOM-DEL-2026-05-10&seg=DEL-BLR-2026-05-12&...
 *
 * Common params (always emitted): class, adults, children, infants.
 */
export function buildSearchUrl(req: SearchRequest): string {
  const sp = new URLSearchParams();
  sp.set('tripType', req.tripType);
  if (req.tripType === 'MULTICITY') {
    for (const s of req.segments) {
      sp.append('seg', `${s.origin}-${s.destination}-${toDateStr(s.date)}`);
    }
  } else {
    const out = req.segments[0]!;
    sp.set('from', out.origin);
    sp.set('to', out.destination);
    sp.set('date', toDateStr(out.date));
    if (req.tripType === 'ROUNDTRIP' && req.segments[1]) {
      sp.set('returnDate', toDateStr(req.segments[1].date));
    }
  }
  sp.set('class', req.travelClass);
  sp.set('adults', String(req.pax.adults));
  sp.set('children', String(req.pax.children));
  sp.set('infants', String(req.pax.infants));
  return `/flights/search?${sp.toString()}`;
}

/**
 * Decodes /flights/search URL params into a SearchRequest. Returns null if the
 * URL is missing required fields (caller should bounce to the landing page).
 *
 * Accepts the shape produced by `buildSearchUrl` AND the legacy ONEWAY shape
 * (no `tripType` param, just from/to/date) so existing bookmarks keep working.
 */
export function parseSearchUrl(params: URLSearchParams): SearchRequest | null {
  const travelClass = (params.get('class') ?? 'ECONOMY') as SearchRequest['travelClass'];
  const adults = Math.max(1, parseInt(params.get('adults') ?? '1', 10));
  const children = Math.max(0, parseInt(params.get('children') ?? '0', 10));
  const infants = Math.max(0, parseInt(params.get('infants') ?? '0', 10));
  const pax = { adults, children, infants };

  const tripType = (params.get('tripType') ?? 'ONEWAY') as SearchRequest['tripType'];

  if (tripType === 'MULTICITY') {
    const legs = params.getAll('seg').map((raw) => {
      // 'BOM-DEL-2026-05-10' → split into [origin, destination, date]
      // Date contains hyphens too, so split on first two only.
      const i1 = raw.indexOf('-');
      const i2 = raw.indexOf('-', i1 + 1);
      if (i1 < 0 || i2 < 0) return null;
      const origin = raw.slice(0, i1).toUpperCase();
      const destination = raw.slice(i1 + 1, i2).toUpperCase();
      const dateStr = raw.slice(i2 + 1);
      if (origin.length !== 3 || destination.length !== 3 || !dateStr) return null;
      return { origin, destination, date: new Date(dateStr) };
    });
    const valid = legs.filter((l): l is NonNullable<typeof l> => l !== null);
    if (valid.length < 2) return null;
    return { tripType: 'MULTICITY', segments: valid, travelClass, pax };
  }

  const fromCode = params.get('from')?.toUpperCase() ?? '';
  const toCode = params.get('to')?.toUpperCase() ?? '';
  const date = params.get('date') ?? '';
  if (!fromCode || !toCode || !date) return null;

  if (tripType === 'ROUNDTRIP') {
    const returnDate = params.get('returnDate') ?? '';
    if (!returnDate) return null;
    return {
      tripType: 'ROUNDTRIP',
      segments: [
        { origin: fromCode, destination: toCode, date: new Date(date) },
        { origin: toCode, destination: fromCode, date: new Date(returnDate) },
      ],
      travelClass,
      pax,
    };
  }

  return {
    tripType: 'ONEWAY',
    segments: [{ origin: fromCode, destination: toCode, date: new Date(date) }],
    travelClass,
    pax,
  };
}

export function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ────────── Flight grouping ──────────
//
// Multiple supplier responses for the same underlying flight (same
// airline + flight number + same calendar day, same endpoints) should
// collapse into a single result card with a fare picker. The agent
// picks MAIN vs FLX vs SME from one card, not three separate rows
// showing the same AI 2663 from BOM to DEL.
//
// Signature contract — **per segment**:
//
//   `${airlineCode}${flightNumber}@${depDate}@${origin}-${destination}`
//
// joined across all segments with "|". We deliberately key off the
// **calendar date** (YYYY-MM-DD) rather than the full ISO timestamp
// because different suppliers ship the same flight with slightly
// different times (timezone normalisation drift, layover-time
// rounding, etc.). Using just the date avoids splitting a single
// real-world flight across two cards.
//
// What we DON'T merge:
//   • Different airlines / flight numbers — obvious
//   • Different calendar days — same flight number on a different
//     date is structurally a different flight
//   • Different endpoints — flight from BOM via X vs via Y
//
// What we DO merge that older signatures wouldn't:
//   • One supplier reports departure 09:40, another 09:42 — same flight
//   • One supplier reports 4h 35m duration, another 11h 20m for the
//     same FlightNo+date+endpoints (rare supplier drift on layover
//     scheduling). The selected fare's segments/duration drive the
//     visible times column, so the card stays honest.

export interface FlightGroup {
  /** Stable identifier for the underlying flight (used as React key). */
  signature: string;
  /** Fare variants — sorted cheapest-first by default. */
  fares: FlightResult[];
}

export function groupFlightsBySignature(results: FlightResult[]): FlightGroup[] {
  // Insertion-ordered map so the first occurrence of each signature
  // wins for ordering (preserves the parent's sort).
  const groups = new Map<string, FlightResult[]>();
  for (const r of results) {
    const sig = r.segments
      .map((s) => {
        const depDate = new Date(s.departure).toISOString().slice(0, 10);
        return `${s.airline.code}${s.flightNumber}@${depDate}@${s.origin.code}-${s.destination.code}`;
      })
      .join('|');
    const existing = groups.get(sig);
    if (existing) existing.push(r);
    else groups.set(sig, [r]);
  }
  return Array.from(groups.entries()).map(([signature, fares]) => ({
    signature,
    // Within a group, always show cheapest first — even when the
    // parent list is sorted differently (e.g. by duration).
    fares: [...fares].sort((a, b) => a.totalGrossPaise - b.totalGrossPaise),
  }));
}

// ────────── Per-fare "best of" annotations ──────────
//
// For a group of fares on the same flight (MAIN / FLX / SME …), surface
// quick decision aids next to each fare:
//
//   • Cheapest        — lowest gross price in the group (index 0 because
//                       groups are sorted cheapest-first)
//   • Best margin     — highest INC (= gross − agency-payable). Only set
//                       when at least one fare has a meaningful positive
//                       incentive AND the winner stands alone (ties get
//                       no badge — there's no winner to pick).
//   • Best refundable — cheapest refundable fare, but only when the
//                       group MIXES refundable + non-refundable. If all
//                       fares are refundable (or none are), the badge
//                       carries no signal so we skip it.

export interface FareBestOf {
  isBestMargin: boolean;
  isBestRefundable: boolean;
}

export function computeFareBestOf(fares: FlightResult[]): FareBestOf[] {
  const blank: FareBestOf = { isBestMargin: false, isBestRefundable: false };
  if (fares.length <= 1) return fares.map(() => blank);

  const result: FareBestOf[] = fares.map(() => ({ ...blank }));

  // ── Best margin ─────────────────────────────────────────────
  const incs = fares.map((f) => f.totalGrossPaise - f.totalAgencyPayablePaise);
  const maxInc = Math.max(...incs);
  if (maxInc > 0) {
    // Tie-break: only annotate when a single winner exists. Otherwise
    // marking N fares "best margin" is useless noise.
    const winners = incs.reduce(
      (count, v) => (v === maxInc ? count + 1 : count),
      0,
    );
    if (winners === 1) {
      const idx = incs.indexOf(maxInc);
      result[idx]!.isBestMargin = true;
    }
  }

  // ── Best refundable ─────────────────────────────────────────
  const hasRefundable = fares.some((f) => f.refundable);
  const hasNonRefundable = fares.some((f) => !f.refundable);
  if (hasRefundable && hasNonRefundable) {
    // Pick the cheapest refundable. Group is already sorted cheapest-first,
    // so the first refundable encountered is the winner.
    const idx = fares.findIndex((f) => f.refundable);
    if (idx >= 0) result[idx]!.isBestRefundable = true;
  }

  return result;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDateLong(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
