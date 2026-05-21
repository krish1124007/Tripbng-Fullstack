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
  MockHotelAdapter,
  MockInsuranceAdapter,
  type BusAdapter,
  type HotelAdapter,
  type InsuranceAdapter,
} from '../adapters/products.mock.js';
import {
  defaultHolidaySupplier,
  _setHolidaySupplier,
} from '../adapters/holiday/registry.js';
import type { HolidaySupplierAdapter } from '../adapters/holiday/types.js';
import { defaultVisaSupplier, _setVisaSupplier } from '../adapters/visa/registry.js';
import type { VisaSupplierAdapter } from '../adapters/visa/types.js';

// Hotel / bus / insurance still ride on the legacy single-slot pattern —
// they'll move to per-supplier registries in their own phases (D follow-up).
let hotelAdapter: HotelAdapter = new MockHotelAdapter();
let busAdapter: BusAdapter = new MockBusAdapter();
let insuranceAdapter: InsuranceAdapter = new MockInsuranceAdapter();

export function setHotelAdapter(a: HotelAdapter) {
  hotelAdapter = a;
}
export function setBusAdapter(a: BusAdapter) {
  busAdapter = a;
}
/**
 * @deprecated Phase D — holiday adapter selection now goes through the
 *  holiday registry. Use `_setHolidaySupplier('MOCK_HOLIDAYS', adapter)` from
 *  adapters/holiday/registry.js. This shim survives so older tests can call
 *  the legacy hook; it routes to the same registry.
 */
export function setHolidayAdapter(a: HolidaySupplierAdapter) {
  _setHolidaySupplier(a.code, a);
}
/** @deprecated Phase D — see setHolidayAdapter. Routes through the visa registry. */
export function setVisaAdapter(a: VisaSupplierAdapter) {
  _setVisaSupplier(a.code, a);
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
  // For now we always dispatch to the default supplier (MOCK). When TBO
  // Holidays ships, the booking flow will pick the right supplier via the
  // package's `supplierCode` discriminator; until then the legacy entry
  // point keeps the existing search-only behaviour.
  const adapter = defaultHolidaySupplier();
  const results = await adapter.search(req);
  logger.info(
    {
      product: 'holidays',
      adapter: adapter.code,
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
  const adapter = defaultVisaSupplier();
  const quote = await adapter.quote(req);
  logger.info(
    {
      product: 'visa',
      adapter: adapter.code,
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
