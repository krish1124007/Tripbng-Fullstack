// Mock supplier adapters for the 5 non-flight products. Each implements a single
// search/quote method against the shared schema contract. When a real supplier
// integration ships (Hotelbeds / Travelport for hotels, RedBus partner API for buses,
// VFS for visa, Tata AIG for insurance), swap the adapter implementation — the
// service layer + routes stay identical.
//
// Same deterministic-seeded RNG approach as the existing series.adapter so the
// same query yields the same results across pages of pagination / re-renders.

import type {
  BusOption,
  BusSearchRequest,
  HolidayPackage,
  HolidaySearchRequest,
  HotelOption,
  HotelSearchRequest,
  InsurancePlan,
  InsuranceQuoteRequest,
  VisaQuote,
  VisaQuoteRequest,
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

// ────────── HOLIDAYS ──────────

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

export interface HolidayAdapter {
  readonly code: string;
  readonly name: string;
  search(req: HolidaySearchRequest): Promise<HolidayPackage[]>;
}

export class MockHolidayAdapter implements HolidayAdapter {
  readonly code = 'MOCK_HOLIDAYS';
  readonly name = 'TripBng Mock Holidays';

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
}

// ────────── VISA ──────────

const VISA_DOCUMENTS = [
  'Passport (6+ months validity, 2 blank pages)',
  'Two recent passport-size photographs (matte, light background)',
  'Filled visa application form (signed)',
  'Confirmed return ticket itinerary',
  'Hotel booking / proof of accommodation',
  'Bank statements — last 3 months',
  'Income tax returns — last 2 years',
  'Travel insurance ≥ ₹30 lakh medical cover',
] as const;

const VISA_COUNTRY_MAP: Record<
  string,
  { name: string; flag: string; kind: string; tat: string; govt: number }
> = {
  AE: {
    name: 'United Arab Emirates',
    flag: '🇦🇪',
    kind: 'eVisa (30-day tourist)',
    tat: '3–4 working days',
    govt: 6800,
  },
  TH: { name: 'Thailand', flag: '🇹🇭', kind: 'Visa-on-arrival', tat: '7 working days', govt: 2200 },
  SG: { name: 'Singapore', flag: '🇸🇬', kind: 'eVisa', tat: '5–7 working days', govt: 2800 },
  JP: { name: 'Japan', flag: '🇯🇵', kind: 'Sticker visa', tat: '10–14 working days', govt: 450 },
  GB: {
    name: 'United Kingdom',
    flag: '🇬🇧',
    kind: 'Standard visitor',
    tat: '15+ working days',
    govt: 11400,
  },
  US: {
    name: 'United States',
    flag: '🇺🇸',
    kind: 'B1/B2 Tourist',
    tat: '30+ working days',
    govt: 16500,
  },
  AU: {
    name: 'Australia',
    flag: '🇦🇺',
    kind: 'eVisitor (subclass 651)',
    tat: '8–10 working days',
    govt: 9200,
  },
  TR: { name: 'Türkiye', flag: '🇹🇷', kind: 'eVisa', tat: '2–3 working days', govt: 4000 },
};

export interface VisaAdapter {
  readonly code: string;
  readonly name: string;
  quote(req: VisaQuoteRequest): Promise<VisaQuote>;
}

export class MockVisaAdapter implements VisaAdapter {
  readonly code = 'MOCK_VISA';
  readonly name = 'TripBng Mock Visa Partner';

  async quote(req: VisaQuoteRequest): Promise<VisaQuote> {
    const c = VISA_COUNTRY_MAP[req.country] ?? VISA_COUNTRY_MAP.AE!;
    const applicants = req.applicants;
    const serviceFee = 1499 * applicants;
    const courierFee = 350;
    const govtFee = c.govt * applicants;
    const validFrom = new Date(req.travelDate);
    const validUntil = new Date(req.travelDate.getTime() + 90 * 24 * 3600 * 1000);
    return {
      countryName: c.name,
      countryCode: req.country,
      flag: c.flag,
      visaKind: c.kind,
      processingDays: c.tat,
      govtFeeRupees: govtFee,
      serviceFeeRupees: serviceFee,
      courierFeeRupees: courierFee,
      totalRupees: govtFee + serviceFee + courierFee,
      applicants,
      validFrom: validFrom.toISOString().slice(0, 10),
      validUntil: validUntil.toISOString().slice(0, 10),
      documents: [...VISA_DOCUMENTS],
    };
  }
}

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
