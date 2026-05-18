import crypto from 'node:crypto';
import {
  type FareBreakdown,
  type SearchRequest,
  type SearchResponse,
  type SearchResult,
  AppError,
} from '@tripbng/shared';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { adapterForCode, buildSearchAdapters, fanoutSearch } from '../adapters/index.js';
import type { NormalizedFareOption } from '../adapters/types.js';
import type { FanoutFareOption } from '../adapters/registry.js';
import { Supplier } from '../models/Supplier.js';
import { MarkupRule } from '../models/MarkupRule.js';
import { Policy } from '../models/Policy.js';
import { priceFare, type PricingMarkupRule } from './pricing/index.js';
import { Agency } from '../models/Agency.js';
import { Actor, EVENTS, track } from './analytics.service.js';

const CACHE_TTL_SECONDS = 60 * 5;

export interface SearchContext {
  tenantId: string;
  userId: string;
  /** null when caller has no agency context (e.g. SUPER_ADMIN previewing prices). */
  agencyId: string | null;
  distributorId: string | null;
}

// Pre-computes the markup rules and policy that the pricing engine will need. This is one
// DB lookup per call rather than 3 — keeps p95 search fast.
async function loadPricingContext(ctx: SearchContext) {
  // Agency lookup only matters when the caller has agency context — SUPER_ADMIN searches
  // (no agency) skip it and just see PLATFORM-scope rules + supplier net pricing.
  const agency = ctx.agencyId
    ? await Agency.findById(ctx.agencyId).select('agencyGroupIds').lean()
    : null;
  const agencyGroupIds = (agency?.agencyGroupIds ?? []).map(String);

  const scopeFilters: Record<string, unknown>[] = [{ scope: 'PLATFORM' }];
  if (ctx.distributorId) {
    scopeFilters.push({ scope: 'DISTRIBUTOR', distributorId: ctx.distributorId });
  }
  if (ctx.agencyId) {
    scopeFilters.push({ scope: 'AGENCY', agencyId: ctx.agencyId });
  }
  const rules = await MarkupRule.find({
    tenantId: ctx.tenantId,
    status: 'ACTIVE',
    $or: scopeFilters,
  }).lean();

  const markupRules: PricingMarkupRule[] = rules.map((r) => ({
    id: String(r._id),
    name: r.name,
    scope: r.scope as PricingMarkupRule['scope'],
    distributorId: r.distributorId ? String(r.distributorId) : null,
    agencyId: r.agencyId ? String(r.agencyId) : null,
    valueType: r.valueType as PricingMarkupRule['valueType'],
    value: r.value,
    maxValuePaise: r.maxValuePaise ?? null,
    priority: r.priority ?? 100,
    status: 'ACTIVE',
    conditions: (r.conditions as unknown as PricingMarkupRule['conditions']) ?? {},
  }));

  return { markupRules, agencyGroupIds };
}

async function policyForOption(option: NormalizedFareOption) {
  if (!option.policyId) return undefined;
  const p = await Policy.findById(option.policyId).lean();
  if (!p) return undefined;
  return {
    commissionPercent: p.commissionPercent,
    managementFeePaise: p.managementFeePaise,
    b2bMarkupPaise: p.b2bMarkupPaise,
    gstOnMarkupOnly: p.gstOnMarkupOnly,
    gstRateBasisPoints: p.gstRateBasisPoints,
  };
}

// priceOption — runs the Phase 2 engine for an adapter result. Adult, child, infant each
// get their own breakdown so the booking flow can show per-pax line items.
async function priceOption(
  option: FanoutFareOption,
  ctx: SearchContext,
  pricingCtx: Awaited<ReturnType<typeof loadPricingContext>>,
  request: SearchRequest,
  bookingDate: Date,
): Promise<SearchResult> {
  const policy = await policyForOption(option);
  const segment = option.segments[0];
  if (!segment) throw new AppError('VALIDATION_ERROR', { reason: 'option missing segments' });
  const airline = segment.airline.code;

  const priceFor = (
    paxType: 'ADULT' | 'CHILD' | 'INFANT',
    perPaxBase: number,
    perPaxTax: number,
  ): FareBreakdown => {
    const r = priceFare({
      baseFarePaise: perPaxBase,
      taxesPaise: perPaxTax,
      paxType,
      travelType: request.tripType === 'ROUNDTRIP' ? 'DOMESTIC' : 'DOMESTIC',
      travelClass: request.travelClass,
      airline,
      origin: segment.origin.code,
      destination: segment.destination.code,
      fareClass: option.fareClass,
      agencyId: ctx.agencyId ?? '',
      agencyGroupIds: pricingCtx.agencyGroupIds,
      distributorId: ctx.distributorId,
      bookingDate,
      policy,
      markupRules: pricingCtx.markupRules,
    });
    return {
      baseFarePaise: r.baseFarePaise,
      taxesPaise: r.taxesPaise,
      policyAdjustmentPaise: r.policyAdjustmentPaise,
      platformMarkupPaise: r.platformMarkupPaise,
      distributorMarkupPaise: r.distributorMarkupPaise,
      agencyMarkupPaise: r.agencyMarkupPaise,
      discountPaise: r.discountPaise,
      gstPaise: r.gstPaise,
      grossAmountPaise: r.grossAmountPaise,
      netToSupplierPaise: r.netToSupplierPaise,
      agencyPayablePaise: r.agencyPayablePaise,
      distributorEarningsPaise: r.distributorEarningsPaise,
      platformEarningsPaise: r.platformEarningsPaise,
      currency: 'INR',
    };
  };

  const adult = priceFor(
    'ADULT',
    option.perPax.adult.baseFarePaise,
    option.perPax.adult.taxesPaise,
  );
  const child = priceFor(
    'CHILD',
    option.perPax.child.baseFarePaise,
    option.perPax.child.taxesPaise,
  );
  const infant = priceFor(
    'INFANT',
    option.perPax.infant.baseFarePaise,
    option.perPax.infant.taxesPaise,
  );

  const totalGross =
    adult.grossAmountPaise * request.pax.adults +
    child.grossAmountPaise * request.pax.children +
    infant.grossAmountPaise * request.pax.infants;
  const totalAgencyPayable =
    adult.agencyPayablePaise * request.pax.adults +
    child.agencyPayablePaise * request.pax.children +
    infant.agencyPayablePaise * request.pax.infants;
  const totalNetToSupplier =
    adult.netToSupplierPaise * request.pax.adults +
    child.netToSupplierPaise * request.pax.children +
    infant.netToSupplierPaise * request.pax.infants;

  const totalDuration = option.segments.reduce(
    (s, seg) => s + seg.duration + (seg.stopOver ?? 0),
    0,
  );

  // fareToken is opaque and short-lived; we encode supplier+token+option-id for hold lookup.
  const fareToken = encodeFareToken({
    supplierCode: option.supplierCode,
    supplierFareToken: option.supplierFareToken,
    inventoryId: option.inventoryId,
  });

  const supplierMeta = await resolveSupplierName(option.supplierCode, ctx.tenantId);

  return {
    id: `${option.supplierCode}-${option.supplierFareId}`,
    supplierCode: supplierMeta.code,
    supplierName: supplierMeta.name,
    source: option.source,
    inventoryId: option.inventoryId ?? null,

    segments: option.segments,
    totalDuration,
    stops: Math.max(0, option.segments.length - 1),

    travelClass: option.travelClass,
    refundable: option.refundable,
    baggageCheckin: option.baggageCheckin ?? null,
    baggageCabin: option.baggageCabin ?? null,

    seatsRemaining: option.seatsRemaining ?? null,
    fareRuleDescription: option.fareRuleDescription ?? null,
    fareClass: option.fareClass ?? null,

    perPax: { adult, child, infant },
    totalGrossPaise: totalGross,
    totalAgencyPayablePaise: totalAgencyPayable,
    totalNetToSupplierPaise: totalNetToSupplier,
    currency: 'INR',
    fareToken,
  };
}

async function resolveSupplierName(
  code: string,
  tenantId: string,
): Promise<{ code: string; name: string }> {
  if (code === 'SERIES') return { code: 'SERIES', name: 'TripBng Series' };
  const sup = await Supplier.findOne({ tenantId, code }).lean();
  if (sup?.name) return { code, name: sup.name };
  // Fallbacks for suppliers without a DB row (dev/test).
  if (code === 'MOCK') return { code, name: 'Mock Carrier' };
  if (code === 'ETRAV') return { code, name: 'eTrav' };
  if (code === 'AIRIQ') return { code, name: 'AirIQ' };
  if (code === 'TBO') return { code, name: 'TBO' };
  if (code === 'KAFILA') return { code, name: 'Kafila V2' };
  return { code, name: code };
}

interface FareTokenPayload {
  supplierCode: string;
  supplierFareToken: string;
  inventoryId?: string;
}

function encodeFareToken(p: FareTokenPayload): string {
  return Buffer.from(JSON.stringify(p)).toString('base64url');
}

export function decodeFareToken(token: string): FareTokenPayload {
  try {
    return JSON.parse(Buffer.from(token, 'base64url').toString()) as FareTokenPayload;
  } catch {
    throw new AppError('VALIDATION_ERROR', { reason: 'invalid fareToken' });
  }
}

// searchFlights — cache-checks first, then fans out, prices each option, dedupes by
// flightNumber+departure (lowest-price wins), and persists the result set in Redis so
// hold/confirm can re-fetch the priced view.
export async function searchFlights(
  ctx: SearchContext,
  request: SearchRequest,
): Promise<SearchResponse> {
  const segment = request.segments[0];
  if (!segment) throw new AppError('VALIDATION_ERROR', { reason: 'no segments' });

  const cacheKey = buildCacheKey(ctx, request);
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    logger.debug({ cacheKey }, 'search cache hit');
    return JSON.parse(cached) as SearchResponse;
  }

  const adapters = await buildSearchAdapters(ctx.tenantId);
  const searchId = crypto.randomBytes(8).toString('hex');
  const fanout = await fanoutSearch(adapters, { searchId, request });

  const pricingCtx = await loadPricingContext(ctx);
  const bookingDate = new Date();
  const priced: SearchResult[] = [];
  for (const opt of fanout.options) {
    try {
      priced.push(await priceOption(opt, ctx, pricingCtx, request, bookingDate));
    } catch (err) {
      logger.warn({ err, supplierFareId: opt.supplierFareId }, 'pricing failed for option');
    }
  }

  // Dedup by flightNumber+departure — the cheapest source wins. Ties keep the first.
  const dedup = new Map<string, SearchResult>();
  for (const r of priced) {
    const seg = r.segments[0];
    if (!seg) continue;
    const key = `${seg.flightNumber}|${seg.departure}`;
    const existing = dedup.get(key);
    if (!existing || r.totalGrossPaise < existing.totalGrossPaise) dedup.set(key, r);
  }
  const results = Array.from(dedup.values()).sort((a, b) => a.totalGrossPaise - b.totalGrossPaise);

  const response: SearchResponse = {
    searchId,
    request,
    results,
    errors: fanout.errors,
    cachedAt: new Date().toISOString(),
    ttlSeconds: CACHE_TTL_SECONDS,
  };

  // Two cache writes: by searchId (used by hold) and by request signature (cache hits).
  await Promise.all([
    redis.set(`search:id:${searchId}`, JSON.stringify(response), 'EX', CACHE_TTL_SECONDS),
    redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL_SECONDS),
  ]);

  // Funnel-top event. Splits per-supplier-error counts so PostHog can show
  // "supplier health" breakdowns without us needing a separate dashboard.
  track({
    event: EVENTS.SEARCH_PERFORMED,
    distinctId: ctx.agencyId ? Actor.agency(ctx.agencyId) : Actor.user(ctx.userId),
    properties: {
      search_id: searchId,
      trip_type: request.tripType,
      origin: segment.origin,
      destination: segment.destination,
      date: segment.date,
      travel_class: request.travelClass,
      pax_total: request.pax.adults + request.pax.children + request.pax.infants,
      result_count: results.length,
      supplier_error_count: fanout.errors.length,
      cheapest_paise: results[0]?.totalGrossPaise ?? null,
      tenant_id: ctx.tenantId,
    },
  });

  return response;
}

export async function getCachedSearch(searchId: string): Promise<SearchResponse | null> {
  const raw = await redis.get(`search:id:${searchId}`).catch(() => null);
  return raw ? (JSON.parse(raw) as SearchResponse) : null;
}

function buildCacheKey(ctx: SearchContext, request: SearchRequest): string {
  const seg = request.segments
    .map((s) => `${s.origin}-${s.destination}-${new Date(s.date).toISOString().slice(0, 10)}`)
    .join('|');
  const hash = crypto
    .createHash('sha1')
    .update(`${ctx.agencyId}|${seg}|${request.travelClass}|${JSON.stringify(request.pax)}`)
    .digest('hex')
    .slice(0, 16);
  return `search:req:${ctx.tenantId}:${hash}`;
}

export { adapterForCode };
