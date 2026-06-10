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
import { airlineAllowed, resolveSupplierAccess } from './supplier-access/index.js';
import { SEARCH_REQ_PREFIX } from './search-cache.js';

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
  // Derive travelType once per option from the route's IATA codes. Earlier
  // code hardcoded 'DOMESTIC' regardless of the request — international
  // fares were priced through the domestic GST/markup rails by accident.
  // `deriveTravelType` falls back to DOMESTIC when an airport isn't in our
  // OpenFlights file (same fail-safe Phase 4 search filter uses).
  const optionTravelType = deriveTravelType(segment.origin.code, segment.destination.code);

  const priceFor = (
    paxType: 'ADULT' | 'CHILD' | 'INFANT',
    perPaxBase: number,
    perPaxTax: number,
  ): FareBreakdown => {
    const r = priceFare({
      baseFarePaise: perPaxBase,
      taxesPaise: perPaxTax,
      paxType,
      travelType: optionTravelType,
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

  // Module 3 — centralized supplier-access rules engine. Decides which of the
  // built adapters may actually be called (Supplier Active → Source Active →
  // Mapping Allowed → Agency Authorized) and carries each survivor's airline
  // allow-list for the post-pricing filter below. Fail-open: an unconfigured
  // tenant lets every active adapter through, so search keeps working until the
  // Supplier Map is populated.
  const access = await resolveSupplierAccess(
    { tenantId: ctx.tenantId, agencyId: ctx.agencyId },
    request,
    adapters.map((a) => a.code),
  );
  const allowedAdapters = adapters.filter((a) => access.byCode[a.code]?.allowed ?? true);
  const blocked = adapters.filter((a) => !(access.byCode[a.code]?.allowed ?? true));
  if (blocked.length > 0) {
    logger.debug(
      { blocked: blocked.map((a) => ({ code: a.code, reason: access.byCode[a.code]?.reason })) },
      'supplier-access: adapters excluded from fanout',
    );
  }

  const searchId = crypto.randomBytes(8).toString('hex');
  const fanout = await fanoutSearch(allowedAdapters, { searchId, request });

  const pricingCtx = await loadPricingContext(ctx);

  // Phase 4 — apply the agent's Map Source filter BEFORE pricing. Pricing is
  // the expensive step (per-pax FareBreakdown + GST + policy resolution); we
  // don't want to do it for options that won't reach the agent. Pass-through
  // when no Map Source matches — see service comment for the policy.
  const travelType = deriveTravelType(segment.origin, segment.destination);
  const filtered = await applyMapSourceFilter(fanout.options, {
    tenantId: ctx.tenantId,
    agencyGroupIds: pricingCtx.agencyGroupIds,
    productType: 'FLIGHT',
    travelType,
  });
  if (filtered.applied) {
    logger.info(
      {
        searchId,
        tenantId: ctx.tenantId,
        before: fanout.options.length,
        after: filtered.options.length,
        dropped: filtered.dropped,
        masked: filtered.masked,
      },
      'map-source filter applied to search results',
    );
  }

  const bookingDate = new Date();
  const priced: SearchResult[] = [];
  for (const opt of fanout.options) {
    // Airline restriction (Module 3, rule 3) — a matched mapping/source may
    // limit a supplier to an airline allow-list. Drop options whose carrier
    // isn't permitted for the supplier that returned them.
    const decision = access.byCode[opt.supplierCode];
    const airline = opt.segments[0]?.airline.code;
    if (decision && airline && !airlineAllowed(decision, airline)) continue;
    try {
      const result = await priceOption(opt, ctx, pricingCtx, request, bookingDate);
      const adjusted = await maybeApplyMapPolicy(
        result,
        opt,
        ctx,
        request.pax,
        pricingCtx.agencyGroupIds,
        commissionPctCache,
      );
      priced.push(adjusted);
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
  // Key must vary on every input that can change which fares an agent sees:
  //   - tenantId (already in the namespace prefix below)
  //   - distributorId — pricing context loads distributor-scoped MarkupRules,
  //                     so two agencies in different distributors with the
  //                     same agency-side rules would otherwise share a key
  //                     and one would see the other's prices
  //   - agencyId — agency-scoped MarkupRules + Policy refs
  //   - tripType — round-trip pairing changes the result set shape
  //   - segments + class + pax + travelType
  //
  // Note `travelType` here is the request-side hint, not the per-option
  // value derived from IATA — `priceOption` derives DOMESTIC vs INTERNATIONAL
  // per option from the airport country codes. The request hint is included
  // for completeness so a future "international-only" filter never collides
  // with a domestic cached result.
  const hash = crypto
    .createHash('sha1')
    .update(
      [
        ctx.distributorId ?? 'no-dist',
        ctx.agencyId ?? 'no-agency',
        seg,
        request.tripType,
        request.travelClass,
        JSON.stringify(request.pax),
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 16);
  return `${SEARCH_REQ_PREFIX}${ctx.tenantId}:${hash}`;
}

export { adapterForCode };

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8 — Map Policy post-pricing
//
// Given a priced SearchResult, find the matching MapPolicy and apply its
// enabled components to each per-pax FareBreakdown. Recomputes the result's
// aggregate totals. Pass-through when nothing matches.
// ─────────────────────────────────────────────────────────────────────────────
async function maybeApplyMapPolicy(
  result: SearchResult,
  opt: FanoutFareOption,
  ctx: SearchContext,
  pax: { adults: number; children: number; infants: number },
  agencyGroupIds: string[],
  commissionPctCache: Map<string, number>,
): Promise<SearchResult> {
  const airline = opt.segments[0]?.airline.code;
  if (!airline) return result;

  const policy = await resolveMapPolicy({
    tenantId: ctx.tenantId,
    productType: 'FLIGHT',
    airline,
    // Prefer the adapter-emitted fareType (real marketing label) over the
    // booking-class proxy. Adapters that don't surface fareType fall back
    // to fareClass so existing fareType configs that pasted in fare-basis
    // codes keep working.
    fareType: opt.fareType ?? opt.fareClass ?? null,
    agencyGroupIds,
    supplierCode: opt.supplierCode,
  });
  if (!policy) return result;

  // Commission base — same per-pax base × Policy.commissionPercent for every
  // pax type; resolveSupplierCommissionPaise reads commissionPercent and
  // computes the per-pax commission paise.
  const adultCommission = await resolveSupplierCommissionPaise(
    opt.policyId ?? null,
    result.perPax.adult.baseFarePaise,
    commissionPctCache,
  );
  const childCommission = await resolveSupplierCommissionPaise(
    opt.policyId ?? null,
    result.perPax.child.baseFarePaise,
    commissionPctCache,
  );
  const infantCommission = await resolveSupplierCommissionPaise(
    opt.policyId ?? null,
    result.perPax.infant.baseFarePaise,
    commissionPctCache,
  );

  const adultAdj = applyMapPolicyToBreakdown(result.perPax.adult, policy, {
    supplierCommissionPaise: adultCommission,
  });
  const childAdj = applyMapPolicyToBreakdown(result.perPax.child, policy, {
    supplierCommissionPaise: childCommission,
  });
  const infantAdj = applyMapPolicyToBreakdown(result.perPax.infant, policy, {
    supplierCommissionPaise: infantCommission,
  });

  // No-op short-circuit. Empty trace = no enabled component fired (or every
  // component computed to zero paise). Skip the rebuild to keep the result
  // shape identical for the dedup + sort downstream.
  if (
    adultAdj.trace.length === 0 &&
    childAdj.trace.length === 0 &&
    infantAdj.trace.length === 0
  ) {
    return result;
  }

  logMapPolicyApplied(
    policy,
    adultAdj.totalDeltaPaise + childAdj.totalDeltaPaise + infantAdj.totalDeltaPaise,
    { fareId: result.id, airline, tenantId: ctx.tenantId },
  );

  const totalGross =
    adultAdj.breakdown.grossAmountPaise * pax.adults +
    childAdj.breakdown.grossAmountPaise * pax.children +
    infantAdj.breakdown.grossAmountPaise * pax.infants;
  const totalAgencyPayable =
    adultAdj.breakdown.agencyPayablePaise * pax.adults +
    childAdj.breakdown.agencyPayablePaise * pax.children +
    infantAdj.breakdown.agencyPayablePaise * pax.infants;

  return {
    ...result,
    perPax: {
      adult: adultAdj.breakdown,
      child: childAdj.breakdown,
      infant: infantAdj.breakdown,
    },
    totalGrossPaise: totalGross,
    totalAgencyPayablePaise: totalAgencyPayable,
  };
}
