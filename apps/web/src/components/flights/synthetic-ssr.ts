// Synthetic SSR catalog — frontend-side mirror of the backend's
// mock-ssr.ts.
//
// We generate the catalog on the client so the booking-form pickers
// (BaggageDetailsPicker, SeatSelectionPicker, SsrPicker) always have
// data to render — no waiting on a network round-trip, no race
// conditions, no auth issues. The numbers are deterministic per
// (origin, destination) pair so the same route always shows the same
// prices + sold seats.
//
// When a supplier's real SSR adapter ships, replace this with a
// genuine API call inside the SsrCatalogProvider.

import type {
  SsrBaggageOption,
  SsrCatalog,
  SsrMealOption,
  SsrSeatOption,
  SsrSeatRow,
} from './ssr-catalog-context';

export interface SyntheticSegmentInput {
  origin: string;
  destination: string;
}

export function buildSyntheticSsrCatalog(
  segments: SyntheticSegmentInput[],
): SsrCatalog {
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
        meals: buildMeals(seed),
        baggage: buildBaggage(seed),
        seatRows: buildSeatRows(seed),
      };
    }),
  };
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildMeals(seed: number): SsrMealOption[] {
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

function buildBaggage(seed: number): SsrBaggageOption[] {
  return [
    {
      code: 'BAG-5',
      label: 'Prepaid Excess Baggage',
      weightKg: 5,
      pricePaise: 60000 + (seed % 10000),
      currency: 'INR',
    },
    {
      code: 'BAG-10',
      label: 'Prepaid Excess Baggage',
      weightKg: 10,
      pricePaise: 110000 + (seed % 15000),
      currency: 'INR',
    },
    {
      code: 'BAG-20',
      label: 'Prepaid Excess Baggage',
      weightKg: 20,
      pricePaise: 210000 + (seed % 20000),
      currency: 'INR',
    },
  ];
}

/**
 * 30-row × 6-seat (3-3) cabin map. Letters A B C | D E F.
 * Rows 1-3 = premium (₹1200-1500), 4-10 = mid-tier (₹600-1000),
 * 11-26 = mostly free with sprinkled window/aisle fees,
 * 27-30 = exit-row (₹700-1000). ~7.7% of seats marked sold.
 */
function buildSeatRows(seed: number): SsrSeatRow[] {
  const letters: Array<{ letter: string; type: string }> = [
    { letter: 'A', type: 'Window' },
    { letter: 'B', type: 'Middle' },
    { letter: 'C', type: 'Aisle' },
    { letter: 'D', type: 'Aisle' },
    { letter: 'E', type: 'Middle' },
    { letter: 'F', type: 'Window' },
  ];

  const rows: SsrSeatRow[] = [];
  for (let rowNo = 1; rowNo <= 30; rowNo++) {
    const seats: SsrSeatOption[] = letters.map(({ letter, type }, colIdx) => {
      const soldKey = (seed + rowNo * 11 + colIdx * 7) % 13;
      const sold = soldKey === 0;

      let pricePaise: number;
      if (rowNo <= 3) {
        pricePaise = 120000 + (rowNo * 100 + colIdx * 50);
      } else if (rowNo <= 10) {
        pricePaise = 60000 + (rowNo * 40 + colIdx * 30);
      } else if (rowNo >= 27) {
        pricePaise = 70000 + colIdx * 50;
      } else if (type === 'Window' || type === 'Aisle') {
        pricePaise = (seed + rowNo) % 3 === 0 ? 30000 + colIdx * 30 : 0;
      } else {
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
