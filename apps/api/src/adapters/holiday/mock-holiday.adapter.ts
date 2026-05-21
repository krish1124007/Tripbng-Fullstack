// MockHolidayAdapter — deterministic-seeded mock for the holiday module.
//
// Implements the full HolidaySupplierAdapter lifecycle so callers can wire
// against the real contract today, even though the underlying data is
// synthesised. Same posture as series.adapter for flights: every method
// returns plausible data so the booking flow can be exercised end-to-end
// without standing up a real supplier.

import { randomUUID } from 'node:crypto';
import type {
  HolidayPackage,
  HolidaySearchRequest,
} from '@tripbng/shared';
import {
  HolidayAdapterError,
  type HolidayBookRequest,
  type HolidayBookResponse,
  type HolidayBookingStatus,
  type HolidayCancelRequest,
  type HolidayCancelResponse,
  type HolidayCapability,
  type HolidayPriceCheckRequest,
  type HolidayPriceCheckResponse,
  type HolidaySupplierAdapter,
  type HolidaySupplierCode,
} from './types.js';

// ────────── deterministic RNG (seeded) — duplicated from products.mock to
// keep this file self-contained as the mock adapter relocates ──────────

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function range(rand: () => number, lo: number, hi: number): number {
  return Math.floor(rand() * (hi - lo + 1)) + lo;
}

const HOTEL_GRADIENTS = [
  'from-rose-200 to-pink-300',
  'from-violet-200 to-fuchsia-300',
  'from-lime-200 to-emerald-300',
  'from-yellow-200 to-orange-300',
] as const;

const HOLIDAY_NAMES: Record<string, readonly string[]> = {
  default: [
    'Cultural escape',
    'Scenic getaway',
    'Heritage tour',
    'Hidden gems trail',
    'Coastal drive',
  ],
  Vietnam: [
    'Cultural & scenic escape',
    'Heritage trail',
    'Halong + Hanoi loop',
    'South coast hopper',
  ],
  Bali: ['Island hopper', 'Honeymoon hideaway', 'Volcano + beach combo', 'Spiritual retreat'],
  Dubai: ['City + desert combo', 'Skyline & souks', 'Family thrill week', 'Luxury escape'],
  Maldives: ['Overwater escape', 'All-inclusive paradise', 'Snorkel & sunsets'],
};

const ITINERARY_BUILDERS = [
  ['Arrival & welcome', 'Cultural orientation tour', 'City landmarks'],
  ['Heritage walk', 'Local cuisine experience', 'Evening transfer'],
  ['Day trip excursion', 'Beach & relaxation', 'Sunset cruise'],
  ['Adventure day', 'Spa wellness', 'Departure'],
] as const;

// In-memory store for the mock's "booked" state. A real supplier persists
// this on their side; for the mock we keep it process-local so the
// fetchStatus + cancel paths return coherent state during e2e tests.
interface MockBookingState {
  supplierBookingRef: string;
  bookingCode: string;
  travellerCount: number;
  totalPaise: number;
  state: 'CONFIRMED' | 'PENDING' | 'CANCELLED';
  createdAt: Date;
}
const mockBookings = new Map<string, MockBookingState>();

export class MockHolidayAdapter implements HolidaySupplierAdapter {
  readonly code: HolidaySupplierCode = 'MOCK_HOLIDAYS';
  readonly name = 'TripBng Mock Holidays';
  readonly capabilities: readonly HolidayCapability[] = [
    'SEARCH',
    'PRICE_CHECK',
    'BOOK',
    'CANCEL',
    'FETCH_STATUS',
  ];

  async search(req: HolidaySearchRequest): Promise<HolidayPackage[]> {
    const seed = hashStr(`${req.destination}|${req.duration}|${req.budget}|${req.theme}`);
    const r = rng(seed);
    const nights = parseInt(req.duration, 10) || 5;
    const baseFare =
      req.budget === 'luxury'
        ? 95000
        : req.budget === 'premium'
          ? 55000
          : req.budget === 'mid'
            ? 32000
            : 18000;
    const out: HolidayPackage[] = [];
    const namesPool = HOLIDAY_NAMES[req.destination] ?? HOLIDAY_NAMES.default!;
    for (let i = 0; i < 6; i++) {
      const variant = pick(r, namesPool);
      const fare = baseFare + range(r, -8000, 28000);
      const itinerary = Array.from({ length: Math.min(nights, 4) }, (_, d) => {
        const builder = ITINERARY_BUILDERS[d % ITINERARY_BUILDERS.length]!;
        return {
          day: d + 1,
          title: builder[d % builder.length]!,
          body:
            d === 0
              ? `Arrive in ${req.destination}, hotel transfer, evening at leisure.`
              : d === Math.min(nights, 4) - 1
                ? `Final breakfast and airport transfer.`
                : `Guided exploration with local lunch and evening at leisure.`,
        };
      });
      out.push({
        id: `${seed}-${i}`,
        title: `${req.destination} · ${variant}`,
        destination: req.destination,
        nights,
        inclusions:
          req.budget === 'luxury'
            ? ['5★ hotels', 'All meals', 'Private guide', 'Premium transfers', 'Sightseeing']
            : req.budget === 'premium'
              ? ['4★ hotels', 'Daily breakfast', 'Sightseeing', 'Airport transfers']
              : ['3★ hotels', 'Daily breakfast', 'Group transfers'],
        hotels: range(r, 1, Math.min(3, Math.ceil(nights / 2))),
        cities: [req.destination, pick(r, ['Hanoi', 'Ubud', 'Marina', 'Old town'])].slice(
          0,
          range(r, 1, 2),
        ),
        perPaxRupees: fare,
        perPaxFromCurrency: 'INR',
        flightIncluded: r() > 0.4,
        imageGradient: pick(r, HOTEL_GRADIENTS),
        bestSeller: i === 0 || r() > 0.78,
        themeLabel: req.theme,
        itinerary,
      });
    }
    return out;
  }

  async priceCheck(req: HolidayPriceCheckRequest): Promise<HolidayPriceCheckResponse> {
    // Reuse the search seed embedded in `supplierPackageToken` (the search
    // emits `${seed}-${i}` as the package id). Deterministic so a repeat
    // priceCheck of the same package returns the same total.
    const seed = hashStr(req.supplierPackageToken);
    const r = rng(seed);
    const perPaxPaise = (40000 + range(r, -10000, 30000)) * 100;
    const totalPaise = perPaxPaise * req.travellerCount;
    return {
      available: true,
      totalPaise,
      perPaxPaise,
      validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min
      cancellationPolicy:
        'Free cancellation up to 7 days before travel. 50% refund within 3-7 days. No refund within 72 hours.',
      supplierQuoteRef: `MOCK-QUOTE-${randomUUID().slice(0, 8)}`,
    };
  }

  async book(req: HolidayBookRequest): Promise<HolidayBookResponse> {
    if (!req.travellers || req.travellers.length === 0) {
      throw new HolidayAdapterError(
        'BAD_REQUEST',
        'mock-holiday book: at least one traveller required',
        this.code,
      );
    }
    const supplierBookingRef = `MOCK-HLD-${randomUUID().slice(0, 8)}`;
    // Synchronous confirmation — the mock has no async back-office. Real
    // suppliers may return PENDING here and confirm via fetchStatus.
    mockBookings.set(supplierBookingRef, {
      supplierBookingRef,
      bookingCode: req.bookingCode,
      travellerCount: req.travellers.length,
      totalPaise: 0, // populated upstream from priceCheck
      state: 'CONFIRMED',
      createdAt: new Date(),
    });
    return {
      supplierBookingRef,
      status: 'CONFIRMED',
      voucherUrl: `https://mock.tripbng.local/voucher/${supplierBookingRef}.pdf`,
    };
  }

  async cancel(req: HolidayCancelRequest): Promise<HolidayCancelResponse> {
    const state = mockBookings.get(req.supplierBookingRef);
    if (!state) {
      throw new HolidayAdapterError(
        'NOT_FOUND',
        `mock-holiday cancel: unknown supplierBookingRef ${req.supplierBookingRef}`,
        this.code,
      );
    }
    state.state = 'CANCELLED';
    // Mock penalty: 10% retained, 90% refunded. Real suppliers compute
    // this off their cancellation policy at the time of cancel.
    const penaltyPaise = Math.floor(state.totalPaise * 0.1);
    const refundPaise = state.totalPaise - penaltyPaise;
    return {
      status: 'PROCESSED',
      refundPaise,
      penaltyPaise,
      supplierCancellationRef: `MOCK-CXL-${randomUUID().slice(0, 8)}`,
    };
  }

  async fetchStatus(supplierBookingRef: string): Promise<HolidayBookingStatus> {
    const state = mockBookings.get(supplierBookingRef);
    if (!state) {
      throw new HolidayAdapterError(
        'NOT_FOUND',
        `mock-holiday fetchStatus: unknown supplierBookingRef ${supplierBookingRef}`,
        this.code,
      );
    }
    return {
      supplierBookingRef,
      state: state.state === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
      lastUpdated: state.createdAt.toISOString(),
      voucherUrl: `https://mock.tripbng.local/voucher/${supplierBookingRef}.pdf`,
    };
  }
}

/** Test helper — reset the in-process booking store. Tests call this in
 *  `beforeEach` to keep state isolated. Not exported via the registry
 *  index; only the adapter's test suite needs it. */
export function _resetMockHolidayState(): void {
  mockBookings.clear();
}
