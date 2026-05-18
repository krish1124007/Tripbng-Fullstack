// Orchestrator for the 5 non-flight product modules. Picks the right adapter,
// runs the search/quote, attaches a searchId for cache-key parity with the
// existing flight pipeline. When a real supplier integration ships, swap the
// adapter constructor below and the rest of the stack stays the same.

import { randomUUID } from 'node:crypto';
import type {
  BusSearchRequest,
  BusSearchResponse,
  HolidaySearchRequest,
  HolidaySearchResponse,
  HotelSearchRequest,
  HotelSearchResponse,
  InsuranceQuoteRequest,
  InsuranceQuoteResponse,
  VisaQuote,
  VisaQuoteRequest,
} from '@tripbng/shared';
import { logger } from '../config/logger.js';
import {
  MockBusAdapter,
  MockHolidayAdapter,
  MockHotelAdapter,
  MockInsuranceAdapter,
  MockVisaAdapter,
  type BusAdapter,
  type HolidayAdapter,
  type HotelAdapter,
  type InsuranceAdapter,
  type VisaAdapter,
} from '../adapters/products.mock.js';

// Adapter slots — swapped in src/index.ts on boot. Keeping them as module-level
// singletons keeps imports tight and lets us hot-swap during tests.
let hotelAdapter: HotelAdapter = new MockHotelAdapter();
let busAdapter: BusAdapter = new MockBusAdapter();
let holidayAdapter: HolidayAdapter = new MockHolidayAdapter();
let visaAdapter: VisaAdapter = new MockVisaAdapter();
let insuranceAdapter: InsuranceAdapter = new MockInsuranceAdapter();

export function setHotelAdapter(a: HotelAdapter) {
  hotelAdapter = a;
}
export function setBusAdapter(a: BusAdapter) {
  busAdapter = a;
}
export function setHolidayAdapter(a: HolidayAdapter) {
  holidayAdapter = a;
}
export function setVisaAdapter(a: VisaAdapter) {
  visaAdapter = a;
}
export function setInsuranceAdapter(a: InsuranceAdapter) {
  insuranceAdapter = a;
}

// ────────── HOTELS ──────────

export async function searchHotels(req: HotelSearchRequest): Promise<HotelSearchResponse> {
  const startedAt = Date.now();
  const results = await hotelAdapter.search(req);
  logger.info(
    {
      product: 'hotels',
      adapter: hotelAdapter.code,
      destination: req.destination,
      results: results.length,
      ms: Date.now() - startedAt,
    },
    'hotel search complete',
  );
  return { searchId: randomUUID(), results };
}

// ────────── BUSES ──────────

export async function searchBuses(req: BusSearchRequest): Promise<BusSearchResponse> {
  const startedAt = Date.now();
  const results = await busAdapter.search(req);
  logger.info(
    {
      product: 'buses',
      adapter: busAdapter.code,
      from: req.from,
      to: req.to,
      results: results.length,
      ms: Date.now() - startedAt,
    },
    'bus search complete',
  );
  return { searchId: randomUUID(), results };
}

// ────────── HOLIDAYS ──────────

export async function searchHolidays(req: HolidaySearchRequest): Promise<HolidaySearchResponse> {
  const startedAt = Date.now();
  const results = await holidayAdapter.search(req);
  logger.info(
    {
      product: 'holidays',
      adapter: holidayAdapter.code,
      destination: req.destination,
      results: results.length,
      ms: Date.now() - startedAt,
    },
    'holiday search complete',
  );
  return { searchId: randomUUID(), results };
}

// ────────── VISA ──────────

export async function quoteVisa(req: VisaQuoteRequest): Promise<VisaQuote> {
  const startedAt = Date.now();
  const quote = await visaAdapter.quote(req);
  logger.info(
    {
      product: 'visa',
      adapter: visaAdapter.code,
      country: req.country,
      applicants: req.applicants,
      ms: Date.now() - startedAt,
    },
    'visa quote complete',
  );
  return quote;
}

// ────────── INSURANCE ──────────

export async function quoteInsurance(req: InsuranceQuoteRequest): Promise<InsuranceQuoteResponse> {
  const startedAt = Date.now();
  const plans = await insuranceAdapter.quote(req);
  logger.info(
    {
      product: 'insurance',
      adapter: insuranceAdapter.code,
      tripType: req.tripType,
      region: req.region,
      plans: plans.length,
      ms: Date.now() - startedAt,
    },
    'insurance quote complete',
  );
  return { searchId: randomUUID(), plans };
}
