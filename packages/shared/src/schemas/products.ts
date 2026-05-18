// Shared Zod schemas for the 5 non-flight product modules: hotels, buses, holidays,
// visa, insurance. The shapes here are the contract between the frontend product
// pages and the backend supplier adapters. Once a real supplier integration ships,
// the shape stays — only the adapter implementation swaps.
import { z } from 'zod';

// ────────── HOTELS ──────────

export const HotelSearchRequestSchema = z.object({
  destination: z.string().min(1).max(120),
  checkIn: z.coerce.date(),
  checkOut: z.coerce.date(),
  rooms: z.number().int().min(1).max(9),
  guests: z.number().int().min(1).max(40),
  nationality: z.string().length(2),
});
export type HotelSearchRequest = z.infer<typeof HotelSearchRequestSchema>;

export const HotelOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string(),
  city: z.string(),
  area: z.string(),
  stars: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  refundable: z.boolean(),
  reviewScore: z.number().min(0).max(10),
  reviewCount: z.number().int().min(0),
  perNightPaise: z.number().int().min(0),
  totalPaise: z.number().int().min(0),
  nights: z.number().int().min(1),
  amenities: z.array(z.string()),
  imageGradient: z.string().optional(),
  imageUrl: z.string().url().optional(),
  roomType: z.string(),
  inclusion: z.string(),
});
export type HotelOption = z.infer<typeof HotelOptionSchema>;

export const HotelSearchResponseSchema = z.object({
  searchId: z.string(),
  results: z.array(HotelOptionSchema),
});
export type HotelSearchResponse = z.infer<typeof HotelSearchResponseSchema>;

// ────────── BUSES ──────────

export const BusSearchRequestSchema = z.object({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  date: z.coerce.date(),
});
export type BusSearchRequest = z.infer<typeof BusSearchRequestSchema>;

export const BusOptionSchema = z.object({
  id: z.string(),
  operator: z.string(),
  busType: z.string(),
  departureTime: z.string(), // HH:mm
  arrivalTime: z.string(),
  durationMins: z.number().int().min(1),
  fromCity: z.string(),
  toCity: z.string(),
  parePaise: z.number().int().min(0),
  seatsLeft: z.number().int().min(0),
  rating: z.number().min(0).max(5),
  amenities: z.array(z.string()),
  pickupPoints: z.number().int().min(0),
});
export type BusOption = z.infer<typeof BusOptionSchema>;

export const BusSearchResponseSchema = z.object({
  searchId: z.string(),
  results: z.array(BusOptionSchema),
});
export type BusSearchResponse = z.infer<typeof BusSearchResponseSchema>;

// ────────── HOLIDAYS ──────────

export const HolidaySearchRequestSchema = z.object({
  destination: z.string().min(1).max(120),
  duration: z.string(), // nights, as string for flexibility
  budget: z.enum(['economy', 'mid', 'premium', 'luxury']),
  theme: z.string(),
  travellers: z.number().int().min(1).max(40),
  departure: z.coerce.date().optional(),
});
export type HolidaySearchRequest = z.infer<typeof HolidaySearchRequestSchema>;

export const HolidayItineraryDaySchema = z.object({
  day: z.number().int().min(1),
  title: z.string(),
  body: z.string(),
});

export const HolidayPackageSchema = z.object({
  id: z.string(),
  title: z.string(),
  destination: z.string(),
  nights: z.number().int().min(1),
  inclusions: z.array(z.string()),
  hotels: z.number().int().min(0),
  cities: z.array(z.string()),
  perPaxRupees: z.number().int().min(0),
  perPaxFromCurrency: z.enum(['USD', 'INR']),
  flightIncluded: z.boolean(),
  imageGradient: z.string().optional(),
  imageUrl: z.string().url().optional(),
  bestSeller: z.boolean(),
  themeLabel: z.string(),
  itinerary: z.array(HolidayItineraryDaySchema),
});
export type HolidayPackage = z.infer<typeof HolidayPackageSchema>;

export const HolidaySearchResponseSchema = z.object({
  searchId: z.string(),
  results: z.array(HolidayPackageSchema),
});
export type HolidaySearchResponse = z.infer<typeof HolidaySearchResponseSchema>;

// ────────── VISA ──────────

export const VisaQuoteRequestSchema = z.object({
  country: z.string().length(2),
  visaType: z.enum(['tourist', 'business', 'transit', 'student', 'medical']),
  travelDate: z.coerce.date(),
  applicants: z.number().int().min(1).max(20),
});
export type VisaQuoteRequest = z.infer<typeof VisaQuoteRequestSchema>;

export const VisaQuoteSchema = z.object({
  countryName: z.string(),
  countryCode: z.string(),
  flag: z.string(),
  visaKind: z.string(),
  processingDays: z.string(),
  govtFeeRupees: z.number().int().min(0),
  serviceFeeRupees: z.number().int().min(0),
  courierFeeRupees: z.number().int().min(0),
  totalRupees: z.number().int().min(0),
  applicants: z.number().int().min(1),
  validFrom: z.string(), // YYYY-MM-DD
  validUntil: z.string(),
  documents: z.array(z.string()),
});
export type VisaQuote = z.infer<typeof VisaQuoteSchema>;

// ────────── INSURANCE ──────────

export const InsuranceQuoteRequestSchema = z.object({
  tripType: z.enum(['single', 'multi', 'student', 'senior', 'group']),
  region: z.enum(['asia', 'asia-jp', 'schengen', 'world-ex-us', 'world']),
  from: z.coerce.date(),
  to: z.coerce.date(),
  travellers: z.number().int().min(1).max(40),
  oldestAge: z.string(), // age band — '18–35', '46–55', etc.
});
export type InsuranceQuoteRequest = z.infer<typeof InsuranceQuoteRequestSchema>;

export const InsuranceCoverSchema = z.object({
  medicalUSD: z.number().int().min(0),
  baggageUSD: z.number().int().min(0),
  cancellationUSD: z.number().int().min(0),
  dentalUSD: z.number().int().min(0),
  hospitalisationUSD: z.number().int().min(0),
  adventureSports: z.boolean(),
  preExisting: z.boolean(),
  deductibleUSD: z.number().int().min(0),
  cashlessNetwork: z.number().int().min(0),
});

export const InsurancePlanSchema = z.object({
  id: z.string(),
  carrier: z.string(),
  planName: z.string(),
  recommended: z.boolean(),
  premiumRupees: z.number().int().min(0),
  cover: InsuranceCoverSchema,
  highlights: z.array(z.string()),
});
export type InsurancePlan = z.infer<typeof InsurancePlanSchema>;

export const InsuranceQuoteResponseSchema = z.object({
  searchId: z.string(),
  plans: z.array(InsurancePlanSchema),
});
export type InsuranceQuoteResponse = z.infer<typeof InsuranceQuoteResponseSchema>;
