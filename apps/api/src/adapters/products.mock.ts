// Mock supplier adapters for the non-flight products that haven't yet been
// extracted to their own provider directories. Each implements a single
// search/quote method against the shared schema contract. When a real
// supplier integration ships (Hotelbeds / Travelport for hotels, RedBus
// partner API for buses, Tata AIG for insurance), swap the adapter
// implementation — the service layer + routes stay identical.
//
// Same deterministic-seeded RNG approach as the existing series.adapter so the
// same query yields the same results across pages of pagination / re-renders.
//
// Phase D note: HolidayAdapter and VisaAdapter have been moved to dedicated
// adapter directories under apps/api/src/adapters/{holiday,visa}/ to support
// the full booking lifecycle (search/priceCheck/book/cancel/fetchStatus).
// Hotel, bus, and insurance stay here for now — they'll follow the same
// pattern in their respective phases.

import type {
  BusOption,
  BusSearchRequest,
  HotelOption,
  HotelSearchRequest,
  InsurancePlan,
  InsuranceQuoteRequest,
} from '@tripbng/shared';

// ────────── deterministic RNG (seeded) ──────────

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function rng(seed: number) {
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

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function addMinutes(hh: number, mm: number, add: number): { h: number; m: number } {
  let total = hh * 60 + mm + add;
  total = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return { h: Math.floor(total / 60), m: total % 60 };
}

// ────────── HOTELS ──────────

const HOTEL_BRANDS = [
  'Aurora Stays',
  'Cinnamon Suites',
  'Lotus Crest',
  'Marigold Residency',
  'Sapphire Heights',
  'Indus Vista',
  'Banyan Court',
  'Saffron Manor',
  'Coral Reef Resort',
  'Cedar Palace',
  'Monsoon Bay',
  'Whitepearl Inn',
] as const;

const NEIGHBOURHOODS: Record<string, readonly string[]> = {
  default: ['City centre', 'Beachfront', 'Old town', 'Business district', 'Riverside'],
  Bangkok: ['Sukhumvit', 'Silom', 'Khao San', 'Asok', 'Riverside'],
  Bali: ['Seminyak', 'Ubud', 'Canggu', 'Nusa Dua', 'Jimbaran'],
  Dubai: ['Downtown', 'Marina', 'JBR', 'Palm Jumeirah', 'Deira'],
  Maldives: ['North Malé Atoll', 'South Malé Atoll', 'Ari Atoll', 'Baa Atoll'],
};

const AMENITIES = [
  'Free WiFi',
  'Pool',
  'Breakfast',
  'AC',
  'Gym',
  'Spa',
  'Airport pickup',
  'Restaurant',
  'Pet friendly',
  '24×7 reception',
] as const;

const HOTEL_GRADIENTS = [
  'from-amber-200 to-rose-300',
  'from-emerald-200 to-cyan-300',
  'from-orange-200 to-amber-400',
  'from-sky-200 to-blue-400',
  'from-rose-200 to-pink-300',
  'from-violet-200 to-fuchsia-300',
  'from-lime-200 to-emerald-300',
  'from-yellow-200 to-orange-300',
] as const;

export interface HotelAdapter {
  readonly code: string;
  readonly name: string;
  search(req: HotelSearchRequest): Promise<HotelOption[]>;
}

export class MockHotelAdapter implements HotelAdapter {
  readonly code = 'MOCK_HOTELS';
  readonly name = 'TripBng Mock Hotels';

  async search(req: HotelSearchRequest): Promise<HotelOption[]> {
    const seed = hashStr(
      `${req.destination}|${req.checkIn.toISOString()}|${req.checkOut.toISOString()}`,
    );
    const r = rng(seed);
    const nights = Math.max(
      1,
      Math.round((req.checkOut.getTime() - req.checkIn.getTime()) / (24 * 3600 * 1000)),
    );
    const areas = NEIGHBOURHOODS[req.destination] ?? NEIGHBOURHOODS.default!;

    const out: HotelOption[] = [];
    for (let i = 0; i < 8; i++) {
      const brand = pick(r, HOTEL_BRANDS);
      const stars = range(r, 3, 5) as 3 | 4 | 5;
      const baseRupees =
        stars === 3
          ? range(r, 1500, 4500)
          : stars === 4
            ? range(r, 4500, 9500)
            : range(r, 8500, 22000);
      const perNightPaise = baseRupees * 100;
      const reviewScore = +(5 + r() * 5).toFixed(1);
      const reviewCount = range(r, 84, 1840);
      const amenitiesPool = [...AMENITIES].sort(() => r() - 0.5);
      out.push({
        id: `${seed}-${i}`,
        name: `${brand} ${req.destination}`,
        brand,
        city: req.destination,
        area: pick(r, areas),
        stars,
        refundable: r() > 0.35,
        reviewScore,
        reviewCount,
        perNightPaise,
        totalPaise: perNightPaise * nights,
        nights,
        amenities: amenitiesPool.slice(0, range(r, 4, 6)),
        imageGradient: pick(r, HOTEL_GRADIENTS),
        roomType: pick(r, [
          'Deluxe room',
          'Premium room',
          'Superior room',
          'Family suite',
          'Executive room',
        ]),
        inclusion: pick(r, ['Room only', 'Breakfast included', 'Breakfast + dinner', 'All meals']),
      });
    }
    return out.sort((a, b) => a.perNightPaise - b.perNightPaise);
  }
}

// ────────── BUSES ──────────

const BUS_OPERATORS = [
  'Skyline Travels',
  'Velvet Voyages',
  'Trident Express',
  'Saffron Coaches',
  'Lotus Lines',
  'Coastal Cruisers',
  'Granite Motors',
  'Indigo Wheels',
] as const;

const BUS_TYPES = [
  'AC Sleeper (2+1)',
  'Non-AC Sleeper',
  'AC Seater',
  'Volvo Multi-axle',
  'Scania AC Sleeper',
  'AC Semi-sleeper',
] as const;

const BUS_AMENITIES = [
  'WiFi',
  'Charging port',
  'Blanket',
  'Water bottle',
  'Live tracking',
  'Reading light',
  'Pillow',
] as const;

export interface BusAdapter {
  readonly code: string;
  readonly name: string;
  search(req: BusSearchRequest): Promise<BusOption[]>;
}

export class MockBusAdapter implements BusAdapter {
  readonly code = 'MOCK_BUSES';
  readonly name = 'TripBng Mock Buses';

  async search(req: BusSearchRequest): Promise<BusOption[]> {
    const seed = hashStr(`${req.from}|${req.to}|${req.date.toISOString()}`);
    const r = rng(seed);
    const out: BusOption[] = [];
    for (let i = 0; i < 12; i++) {
      const depH = range(r, 5, 23);
      const depM = pick(r, [0, 15, 30, 45]);
      const durationMins = range(r, 240, 900);
      const arr = addMinutes(depH, depM, durationMins);
      const fareRupees = range(r, 380, 2400);
      const amenitiesPool = [...BUS_AMENITIES].sort(() => r() - 0.5);
      out.push({
        id: `${seed}-${i}`,
        operator: pick(r, BUS_OPERATORS),
        busType: pick(r, BUS_TYPES),
        departureTime: `${pad2(depH)}:${pad2(depM)}`,
        arrivalTime: `${pad2(arr.h)}:${pad2(arr.m)}`,
        durationMins,
        fromCity: req.from,
        toCity: req.to,
        parePaise: fareRupees * 100,
        seatsLeft: range(r, 1, 28),
        rating: +(3.5 + r() * 1.5).toFixed(1),
        amenities: amenitiesPool.slice(0, range(r, 3, 5)),
        pickupPoints: range(r, 2, 8),
      });
    }
    return out.sort(
      (a, b) => Number(a.departureTime.replace(':', '')) - Number(b.departureTime.replace(':', '')),
    );
  }
}

// ────────── HOLIDAYS — extracted to apps/api/src/adapters/holiday/ (Phase D) ──────────
// MockHolidayAdapter + full HolidaySupplierAdapter lifecycle live there.
// Re-mounting them here would duplicate the contract; importers should use
// `holidaySupplier()` from adapters/holiday/registry.js instead.

// ────────── VISA — extracted to apps/api/src/adapters/visa/ (Phase D) ──────────
// Same story as holidays — full VisaSupplierAdapter lifecycle moved out.
// Importers use `visaSupplier()` from adapters/visa/registry.js.


// ────────── INSURANCE ──────────

const CARRIERS = [
  'Tata AIG',
  'ICICI Lombard',
  'Bajaj Allianz',
  'Reliance General',
  'ACKO',
] as const;

interface PlanTier {
  name: string;
  med: number;
  bag: number;
  cancel: number;
  dental: number;
  hosp: number;
  mult: number;
  rec: boolean;
  adv: boolean;
  pre: boolean;
}

const PLAN_TIERS: PlanTier[] = [
  {
    name: 'Essential',
    med: 50_000,
    bag: 300,
    cancel: 1000,
    dental: 250,
    hosp: 30_000,
    mult: 1,
    rec: false,
    adv: false,
    pre: false,
  },
  {
    name: 'Standard',
    med: 100_000,
    bag: 500,
    cancel: 2000,
    dental: 500,
    hosp: 75_000,
    mult: 1.6,
    rec: true,
    adv: false,
    pre: false,
  },
  {
    name: 'Comprehensive',
    med: 250_000,
    bag: 1000,
    cancel: 5000,
    dental: 1000,
    hosp: 150_000,
    mult: 2.6,
    rec: false,
    adv: true,
    pre: true,
  },
  {
    name: 'Platinum',
    med: 500_000,
    bag: 2000,
    cancel: 10_000,
    dental: 2000,
    hosp: 300_000,
    mult: 4.2,
    rec: false,
    adv: true,
    pre: true,
  },
  {
    name: 'Adventure',
    med: 200_000,
    bag: 800,
    cancel: 3500,
    dental: 800,
    hosp: 100_000,
    mult: 3.0,
    rec: false,
    adv: true,
    pre: false,
  },
];

export interface InsuranceAdapter {
  readonly code: string;
  readonly name: string;
  quote(req: InsuranceQuoteRequest): Promise<InsurancePlan[]>;
}

export class MockInsuranceAdapter implements InsuranceAdapter {
  readonly code = 'MOCK_INSURANCE';
  readonly name = 'TripBng Mock Insurance Carriers';

  async quote(req: InsuranceQuoteRequest): Promise<InsurancePlan[]> {
    const seed = hashStr(JSON.stringify(req));
    const r = rng(seed);
    const days = Math.max(
      1,
      Math.round((req.to.getTime() - req.from.getTime()) / (24 * 3600 * 1000)),
    );
    const baseDay =
      req.region === 'world' || req.region === 'world-ex-us'
        ? 38
        : req.region === 'schengen'
          ? 28
          : 14;
    const ageFactor =
      req.oldestAge.startsWith('66') || req.oldestAge.startsWith('71')
        ? 1.7
        : req.oldestAge.startsWith('56')
          ? 1.3
          : 1;

    return PLAN_TIERS.map((t, i) => {
      const premium = Math.round(baseDay * days * req.travellers * ageFactor * t.mult);
      return {
        id: `${seed}-${i}`,
        carrier: pick(r, CARRIERS),
        planName: t.name,
        recommended: t.rec,
        premiumRupees: premium,
        cover: {
          medicalUSD: t.med,
          baggageUSD: t.bag,
          cancellationUSD: t.cancel,
          dentalUSD: t.dental,
          hospitalisationUSD: t.hosp,
          adventureSports: t.adv,
          preExisting: t.pre,
          deductibleUSD: i === 0 ? 100 : i === 1 ? 50 : 0,
          cashlessNetwork: i === 0 ? 8000 : i === 1 ? 12_000 : i === 2 ? 18_000 : 24_000,
        },
        highlights:
          i === 1
            ? ['Most chosen by partners', 'Cashless at 12k+ hospitals', 'Free emergency evacuation']
            : i === 2
              ? [
                  'Adventure sports covered',
                  'Pre-existing diseases covered',
                  '24×7 multilingual helpline',
                ]
              : i === 3
                ? ['Highest medical cover', 'Personal concierge', 'Trip-cancellation no-fault']
                : i === 4
                  ? [
                      'Tailored for trekkers',
                      'Equipment cover up to USD 800',
                      'High-altitude rescue',
                    ]
                  : ['Lowest premium', 'Quick claim payout', 'Standard cover'],
      };
    });
  }
}
