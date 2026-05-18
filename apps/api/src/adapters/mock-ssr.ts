// Mock SSR catalog generator.
//
// MOCK fares don't talk to a real supplier — they're synthesized for
// dev/demo. The booking UI's BaggageDetailsPicker + SeatSelectionPicker
// expect an SSR catalog with the same shape TBO returns. We build a
// deterministic, plausible catalog from the fareToken so agents can
// drive the full booking flow end-to-end against MOCK fares without
// needing a real TBO account.
//
// The catalog includes:
//   • One segment matching the fareToken's origin/destination
//   • Three baggage tiers (5kg / 10kg / 20kg) at INR rates that mirror
//     real Indian LCC pricing
//   • A 30-row × 6-seat (3-3) cabin map with realistic price tiers,
//     a few "sold" seats sprinkled in, and a couple of premium rows
//
// Shape mirrors CanonicalSSR (apps/api/src/adapters/tbo-flight/transforms.ts).

export interface CanonicalMockSeat {
  code: string;
  rowNo: number;
  seatNo: string;
  seatType: string;
  available: boolean;
  pricePaise: number;
  currency: string;
}

export interface CanonicalMockSeatRow {
  rowNo: number;
  seats: CanonicalMockSeat[];
}

export interface CanonicalMockBaggage {
  code: string;
  label: string;
  weightKg: number;
  pricePaise: number;
  currency: string;
}

export interface CanonicalMockMeal {
  code: string;
  label: string;
  description: string | null;
  pricePaise: number;
  currency: string;
}

export interface CanonicalMockSsrSegment {
  segmentId: string;
  origin: string | null;
  destination: string | null;
  meals: CanonicalMockMeal[];
  baggage: CanonicalMockBaggage[];
  seatRows: CanonicalMockSeatRow[];
  currency: string;
}

export interface CanonicalMockSsr {
  segments: CanonicalMockSsrSegment[];
}

/** Parse a MOCK fareToken (e.g. "MOCK:BOM:DEL:2026-05-22:1") → segments. */
function parseMockToken(fareToken: string):
  | { origin: string; destination: string }
  | null {
  if (!fareToken.startsWith('MOCK:')) return null;
  const parts = fareToken.split(':');
  if (parts.length < 4) return null;
  const origin = parts[1];
  const destination = parts[2];
  if (!origin || !destination) return null;
  return { origin, destination };
}

/** Deterministic small int from a string. */
function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function buildMockSsrCatalog(fareToken: string): CanonicalMockSsr {
  const parsed = parseMockToken(fareToken);
  if (!parsed) return { segments: [] };

  return buildSyntheticSsrCatalog([
    { origin: parsed.origin, destination: parsed.destination },
  ]);
}

// ────────── Generic synthesised catalog ──────────
//
// Used for suppliers we haven't fully integrated yet (ETRAV / KAFILA /
// AIRIQ / MOCK). The frontend passes in the segments it already has
// from the cached search result, and we mint a plausible
// meal / baggage / seat-map catalog so the booking UI can be driven
// end-to-end. When a supplier's real SSR adapter lands later, the
// route handler switches it back to live data.

export interface SyntheticSegmentInput {
  origin: string;
  destination: string;
}

export function buildSyntheticSsrCatalog(
  segments: SyntheticSegmentInput[],
): CanonicalMockSsr {
  if (segments.length === 0) return { segments: [] };
  return {
    segments: segments.map((s) => {
      const segmentId = `${s.origin}-${s.destination}`;
      const seed = hashSeed(segmentId);
      return {
        segmentId,
        origin: s.origin,
        destination: s.destination,
        currency: 'INR',
        meals: buildMockMeals(seed),
        baggage: buildMockBaggage(seed),
        seatRows: buildMockSeatRows(seed),
      };
    }),
  };
}

// ────────── Builders ──────────

function buildMockMeals(seed: number): CanonicalMockMeal[] {
  // Three sample meal upgrades — common Indian LCC patterns.
  return [
    {
      code: 'MEAL-VEG',
      label: 'Veg Combo Meal',
      description: 'Vegetable wrap + cookie + bottled water',
      pricePaise: 25000 + (seed % 5000),
      currency: 'INR',
    },
    {
      code: 'MEAL-NV',
      label: 'Non-veg Combo Meal',
      description: 'Chicken wrap + cookie + bottled water',
      pricePaise: 32000 + (seed % 5000),
      currency: 'INR',
    },
    {
      code: 'MEAL-JAIN',
      label: 'Jain Meal',
      description: 'Jain-friendly options, no onion/garlic',
      pricePaise: 22000 + (seed % 5000),
      currency: 'INR',
    },
  ];
}

function buildMockBaggage(seed: number): CanonicalMockBaggage[] {
  // Three tiers — matches real Indian LCC excess-baggage pricing.
  return [
    {
      code: 'BAG-5',
      label: 'Prepaid Excess Baggage',
      weightKg: 5,
      pricePaise: 60000 + (seed % 10000), // ₹600-700
      currency: 'INR',
    },
    {
      code: 'BAG-10',
      label: 'Prepaid Excess Baggage',
      weightKg: 10,
      pricePaise: 110000 + (seed % 15000), // ₹1100-1250
      currency: 'INR',
    },
    {
      code: 'BAG-20',
      label: 'Prepaid Excess Baggage',
      weightKg: 20,
      pricePaise: 210000 + (seed % 20000), // ₹2100-2300
      currency: 'INR',
    },
  ];
}

/**
 * 30-row × 6-seat 3-3 cabin map. Seats are letters A B C | D E F.
 * Rows 1-3 are premium (₹1001-1500) — extra legroom.
 * Rows 4-10 are mid-tier (₹501-1000) — front of cabin.
 * Rows 11-26 are mostly free, with some ₹300-500 windows/aisles.
 * Rows 27-30 are mid-tier again — exit row pricing.
 * A handful of seats are marked sold using the seed.
 */
function buildMockSeatRows(seed: number): CanonicalMockSeatRow[] {
  const letters: Array<{ letter: string; type: string }> = [
    { letter: 'A', type: 'Window' },
    { letter: 'B', type: 'Middle' },
    { letter: 'C', type: 'Aisle' },
    { letter: 'D', type: 'Aisle' },
    { letter: 'E', type: 'Middle' },
    { letter: 'F', type: 'Window' },
  ];

  const rows: CanonicalMockSeatRow[] = [];
  for (let rowNo = 1; rowNo <= 30; rowNo++) {
    const seats: CanonicalMockSeat[] = letters.map(({ letter, type }, colIdx) => {
      // Sold-seat predicate — deterministic per (row, col, seed).
      const soldKey = (seed + rowNo * 11 + colIdx * 7) % 13;
      const sold = soldKey === 0; // ~7.7% sold

      // Price tiers by row.
      let pricePaise: number;
      if (rowNo <= 3) {
        // Premium extra-legroom rows.
        pricePaise = 120000 + (rowNo * 100 + colIdx * 50); // ~₹1200-1500
      } else if (rowNo <= 10) {
        // Front-of-cabin mid-tier.
        pricePaise = 60000 + (rowNo * 40 + colIdx * 30); // ~₹600-1000
      } else if (rowNo >= 27) {
        // Exit-row mid-tier.
        pricePaise = 70000 + (colIdx * 50); // ~₹700-1000
      } else if (type === 'Window' || type === 'Aisle') {
        // Window / aisle preference fee in mid-cabin.
        pricePaise = (seed + rowNo) % 3 === 0 ? 30000 + (colIdx * 30) : 0;
      } else {
        // Middle seats in mid-cabin — free.
        pricePaise = 0;
      }

      return {
        code: `${rowNo}${letter}`,
        rowNo,
        seatNo: letter,
        seatType: type,
        available: !sold,
        pricePaise,
        currency: 'INR',
      };
    });
    rows.push({ rowNo, seats });
  }
  return rows;
}
