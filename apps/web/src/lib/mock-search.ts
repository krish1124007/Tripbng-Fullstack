/**
 * Mock-search generators — produce realistic-looking demo data for the 5 product
 * modules whose suppliers haven't been wired yet (Hotels, Bus, Holiday, Visa, Insurance).
 *
 * All data here is fictional. Names are made up. Once a real supplier integration
 * lands, the consuming page swaps `generateXxx()` for an API call without changing
 * the rest of the UI.
 */

// ────────── Deterministic pseudo-random for stable demos ──────────
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

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function range(rand: () => number, lo: number, hi: number): number {
  return Math.floor(rand() * (hi - lo + 1)) + lo;
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
];

const NEIGHBOURHOODS: Record<string, string[]> = {
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
];

export interface MockHotel {
  id: string;
  name: string;
  brand: string;
  city: string;
  area: string;
  stars: 3 | 4 | 5;
  refundable: boolean;
  reviewScore: number; // 0..10
  reviewCount: number;
  perNightPaise: number;
  totalPaise: number;
  nights: number;
  amenities: string[];
  imageGradient: string; // tailwind classes
  roomType: string;
  inclusion: string;
}

const HOTEL_GRADIENTS = [
  'from-amber-200 to-rose-300',
  'from-emerald-200 to-cyan-300',
  'from-orange-200 to-amber-400',
  'from-sky-200 to-blue-400',
  'from-rose-200 to-pink-300',
  'from-violet-200 to-fuchsia-300',
  'from-lime-200 to-emerald-300',
  'from-yellow-200 to-orange-300',
];

export function generateHotels(input: {
  destination: string;
  checkIn: string;
  checkOut: string;
}): MockHotel[] {
  const seed = hashStr(`${input.destination}|${input.checkIn}|${input.checkOut}`);
  const r = rng(seed);
  const nights = Math.max(
    1,
    Math.round(
      (new Date(input.checkOut).getTime() - new Date(input.checkIn).getTime()) /
        (24 * 3600 * 1000),
    ),
  );
  const areas =
    NEIGHBOURHOODS[input.destination] ??
    NEIGHBOURHOODS.default!;

  const out: MockHotel[] = [];
  const count = 8;
  for (let i = 0; i < count; i++) {
    const brand = pick(r, HOTEL_BRANDS);
    const stars = (range(r, 3, 5) as 3 | 4 | 5);
    const baseRupees = stars === 3 ? range(r, 1500, 4500) : stars === 4 ? range(r, 4500, 9500) : range(r, 8500, 22000);
    const perNightPaise = baseRupees * 100;
    const reviewScore = +(5 + r() * 5).toFixed(1);
    const reviewCount = range(r, 84, 1840);
    const amenitiesPool = [...AMENITIES].sort(() => r() - 0.5);
    out.push({
      id: `${seed}-${i}`,
      name: `${brand} ${input.destination}`,
      brand,
      city: input.destination,
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
      roomType: pick(r, ['Deluxe room', 'Premium room', 'Superior room', 'Family suite', 'Executive room']),
      inclusion: pick(r, ['Room only', 'Breakfast included', 'Breakfast + dinner', 'All meals']),
    });
  }
  return out.sort((a, b) => a.perNightPaise - b.perNightPaise);
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
];

const BUS_TYPES = [
  'AC Sleeper (2+1)',
  'Non-AC Sleeper',
  'AC Seater',
  'Volvo Multi-axle',
  'Scania AC Sleeper',
  'AC Semi-sleeper',
];

const BUS_AMENITIES = [
  'WiFi',
  'Charging port',
  'Blanket',
  'Water bottle',
  'Live tracking',
  'Reading light',
  'Pillow',
];

export interface MockBus {
  id: string;
  operator: string;
  busType: string;
  departureTime: string; // HH:mm
  arrivalTime: string; // HH:mm
  durationMins: number;
  fromCity: string;
  toCity: string;
  parePaise: number;
  seatsLeft: number;
  rating: number;
  amenities: string[];
  pickupPoints: number;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function addMinutes(hh: number, mm: number, add: number): { h: number; m: number } {
  let total = hh * 60 + mm + add;
  total = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return { h: Math.floor(total / 60), m: total % 60 };
}

export function generateBuses(input: { from: string; to: string; date: string }): MockBus[] {
  const seed = hashStr(`${input.from}|${input.to}|${input.date}`);
  const r = rng(seed);
  const out: MockBus[] = [];
  const count = 12;
  for (let i = 0; i < count; i++) {
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
      fromCity: input.from,
      toCity: input.to,
      parePaise: fareRupees * 100,
      seatsLeft: range(r, 1, 28),
      rating: +(3.5 + r() * 1.5).toFixed(1),
      amenities: amenitiesPool.slice(0, range(r, 3, 5)),
      pickupPoints: range(r, 2, 8),
    });
  }
  return out.sort(
    (a, b) =>
      Number(a.departureTime.replace(':', '')) - Number(b.departureTime.replace(':', '')),
  );
}

// ────────── HOLIDAYS ──────────

export interface MockHolidayPackage {
  id: string;
  title: string;
  destination: string;
  nights: number;
  inclusions: string[];
  hotels: number;
  cities: string[];
  perPaxRupees: number;
  perPaxFromCurrency: 'USD' | 'INR';
  flightIncluded: boolean;
  imageGradient: string;
  bestSeller: boolean;
  themeLabel: string;
  itinerary: { day: number; title: string; body: string }[];
}

const HOLIDAY_NAMES: Record<string, string[]> = {
  default: ['Cultural escape', 'Scenic getaway', 'Heritage tour', 'Hidden gems trail', 'Coastal drive'],
  Vietnam: ['Cultural & scenic escape', 'Heritage trail', 'Halong + Hanoi loop', 'South coast hopper'],
  Bali: ['Island hopper', 'Honeymoon hideaway', 'Volcano + beach combo', 'Spiritual retreat'],
  Dubai: ['City + desert combo', 'Skyline & souks', 'Family thrill week', 'Luxury escape'],
  Maldives: ['Overwater escape', 'All-inclusive paradise', 'Snorkel & sunsets'],
};

const ITINERARY_BUILDERS = [
  ['Arrival & welcome', 'Cultural orientation tour', 'City landmarks'],
  ['Heritage walk', 'Local cuisine experience', 'Evening transfer'],
  ['Day trip excursion', 'Beach & relaxation', 'Sunset cruise'],
  ['Adventure day', 'Spa wellness', 'Departure'],
];

export function generateHolidays(input: {
  destination: string;
  duration: string;
  budget: string;
  theme: string;
}): MockHolidayPackage[] {
  const seed = hashStr(`${input.destination}|${input.duration}|${input.budget}|${input.theme}`);
  const r = rng(seed);
  const nights = parseInt(input.duration, 10) || 5;
  const baseFare = input.budget === 'luxury' ? 95000 : input.budget === 'premium' ? 55000 : input.budget === 'mid' ? 32000 : 18000;
  const out: MockHolidayPackage[] = [];
  const namesPool = HOLIDAY_NAMES[input.destination] ?? HOLIDAY_NAMES.default!;
  const count = 6;
  for (let i = 0; i < count; i++) {
    const variant = pick(r, namesPool);
    const fare = baseFare + range(r, -8000, 28000);
    const itinerary = Array.from({ length: Math.min(nights, 4) }, (_, d) => {
      const builder = ITINERARY_BUILDERS[d % ITINERARY_BUILDERS.length]!;
      return {
        day: d + 1,
        title: builder[d % builder.length]!,
        body:
          d === 0
            ? `Arrive in ${input.destination}, hotel transfer, evening at leisure.`
            : d === Math.min(nights, 4) - 1
              ? `Final breakfast and airport transfer.`
              : `Guided exploration with local lunch and evening at leisure.`,
      };
    });
    out.push({
      id: `${seed}-${i}`,
      title: `${input.destination} · ${variant}`,
      destination: input.destination,
      nights,
      inclusions:
        input.budget === 'luxury'
          ? ['5★ hotels', 'All meals', 'Private guide', 'Premium transfers', 'Sightseeing']
          : input.budget === 'premium'
            ? ['4★ hotels', 'Daily breakfast', 'Sightseeing', 'Airport transfers']
            : ['3★ hotels', 'Daily breakfast', 'Group transfers'],
      hotels: range(r, 1, Math.min(3, Math.ceil(nights / 2))),
      cities: [input.destination, pick(r, ['Hanoi', 'Ubud', 'Marina', 'Old town'])].slice(0, range(r, 1, 2)),
      perPaxRupees: fare,
      perPaxFromCurrency: 'INR',
      flightIncluded: r() > 0.4,
      imageGradient: pick(r, HOTEL_GRADIENTS),
      bestSeller: i === 0 || r() > 0.78,
      themeLabel: input.theme,
      itinerary,
    });
  }
  return out;
}

// ────────── VISA ──────────

export interface MockVisaQuote {
  countryName: string;
  countryCode: string;
  flag: string;
  visaKind: string;
  processingDays: string;
  govtFeeRupees: number;
  serviceFeeRupees: number;
  courierFeeRupees: number;
  totalRupees: number;
  applicants: number;
  validFrom: string;
  validUntil: string;
  documents: string[];
}

const VISA_DOCUMENTS = [
  'Passport (6+ months validity, 2 blank pages)',
  'Two recent passport-size photographs (matte, light background)',
  'Filled visa application form (signed)',
  'Confirmed return ticket itinerary',
  'Hotel booking / proof of accommodation',
  'Bank statements — last 3 months',
  'Income tax returns — last 2 years',
  'Travel insurance ≥ ₹30 lakh medical cover',
];

export function generateVisaQuote(input: {
  country: string;
  visaType: string;
  travelDate: string;
  applicants: string;
}): MockVisaQuote {
  const map: Record<string, { name: string; flag: string; kind: string; tat: string; govt: number }> = {
    AE: { name: 'United Arab Emirates', flag: '🇦🇪', kind: 'eVisa (30-day tourist)', tat: '3–4 working days', govt: 6800 },
    TH: { name: 'Thailand', flag: '🇹🇭', kind: 'Visa-on-arrival', tat: '7 working days', govt: 2200 },
    SG: { name: 'Singapore', flag: '🇸🇬', kind: 'eVisa', tat: '5–7 working days', govt: 2800 },
    JP: { name: 'Japan', flag: '🇯🇵', kind: 'Sticker visa', tat: '10–14 working days', govt: 450 },
    GB: { name: 'United Kingdom', flag: '🇬🇧', kind: 'Standard visitor', tat: '15+ working days', govt: 11400 },
    US: { name: 'United States', flag: '🇺🇸', kind: 'B1/B2 Tourist', tat: '30+ working days', govt: 16500 },
    AU: { name: 'Australia', flag: '🇦🇺', kind: 'eVisitor (subclass 651)', tat: '8–10 working days', govt: 9200 },
    TR: { name: 'Türkiye', flag: '🇹🇷', kind: 'eVisa', tat: '2–3 working days', govt: 4000 },
  };
  const c = map[input.country] ?? map.AE!;
  const applicants = Math.max(1, parseInt(input.applicants, 10) || 1);
  const serviceFee = 1499 * applicants;
  const courierFee = 350;
  const govtFee = c.govt * applicants;
  const valid = new Date(input.travelDate);
  const validFrom = new Date(valid);
  const validUntil = new Date(valid.getTime() + 90 * 24 * 3600 * 1000);
  return {
    countryName: c.name,
    countryCode: input.country,
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
    documents: VISA_DOCUMENTS,
  };
}

// ────────── INSURANCE ──────────

export interface MockInsurancePlan {
  id: string;
  carrier: string;
  planName: string;
  recommended: boolean;
  premiumRupees: number;
  cover: {
    medicalUSD: number;
    baggageUSD: number;
    cancellationUSD: number;
    dentalUSD: number;
    hospitalisationUSD: number;
    adventureSports: boolean;
    preExisting: boolean;
    deductibleUSD: number;
    cashlessNetwork: number;
  };
  highlights: string[];
}

const CARRIERS = ['Tata AIG', 'ICICI Lombard', 'Bajaj Allianz', 'Reliance General', 'ACKO'];

export function generateInsurancePlans(input: {
  tripType: string;
  region: string;
  from: string;
  to: string;
  travellers: string;
  oldestAge: string;
}): MockInsurancePlan[] {
  const seed = hashStr(JSON.stringify(input));
  const r = rng(seed);
  const days = Math.max(
    1,
    Math.round(
      (new Date(input.to).getTime() - new Date(input.from).getTime()) / (24 * 3600 * 1000),
    ),
  );
  const travellers = Math.max(1, parseInt(input.travellers, 10) || 1);
  const baseDay = input.region === 'world' || input.region === 'world-ex-us' ? 38 : input.region === 'schengen' ? 28 : 14;
  const ageFactor = input.oldestAge.startsWith('66') || input.oldestAge.startsWith('71') ? 1.7 : input.oldestAge.startsWith('56') ? 1.3 : 1;

  const tiers: { name: string; med: number; bag: number; cancel: number; dental: number; hosp: number; mult: number; rec: boolean; adv: boolean; pre: boolean }[] = [
    { name: 'Essential', med: 50_000, bag: 300, cancel: 1000, dental: 250, hosp: 30_000, mult: 1, rec: false, adv: false, pre: false },
    { name: 'Standard', med: 100_000, bag: 500, cancel: 2000, dental: 500, hosp: 75_000, mult: 1.6, rec: true, adv: false, pre: false },
    { name: 'Comprehensive', med: 250_000, bag: 1000, cancel: 5000, dental: 1000, hosp: 150_000, mult: 2.6, rec: false, adv: true, pre: true },
    { name: 'Platinum', med: 500_000, bag: 2000, cancel: 10_000, dental: 2000, hosp: 300_000, mult: 4.2, rec: false, adv: true, pre: true },
    { name: 'Adventure', med: 200_000, bag: 800, cancel: 3500, dental: 800, hosp: 100_000, mult: 3.0, rec: false, adv: true, pre: false },
  ];

  return tiers.map((t, i) => {
    const premium = Math.round(baseDay * days * travellers * ageFactor * t.mult);
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
            ? ['Adventure sports covered', 'Pre-existing diseases covered', '24×7 multilingual helpline']
            : i === 3
              ? ['Highest medical cover', 'Personal concierge', 'Trip-cancellation no-fault']
              : i === 4
                ? ['Tailored for trekkers', 'Equipment cover up to USD 800', 'High-altitude rescue']
                : ['Lowest premium', 'Quick claim payout', 'Standard cover'],
    };
  });
}

// ────────── Number formatters used by both client + UI ──────────

export function formatRupees(rupees: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact) {
    if (rupees >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(rupees % 1_00_000 === 0 ? 0 : 2)} L`;
    if (rupees >= 1000) return `₹${(rupees / 1000).toFixed(rupees % 1000 === 0 ? 0 : 1)}K`;
  }
  return `₹${rupees.toLocaleString('en-IN')}`;
}

export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
