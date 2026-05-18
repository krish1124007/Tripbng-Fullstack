// Hotel search orchestration — chunked parallel TBO fanout.
//
// Pathway:
//   1. Resolve destination → hotelCodes (city → tbo_hotels lookup OR direct).
//   2. Cap at request.maxResults (default 1000) for latency control.
//   3. Chunk into TBO_SEARCH_CHUNK_SIZE (≤100) hotelCode batches.
//   4. Fan out TBO_SEARCH_PARALLEL_LIMIT concurrent Search calls.
//   5. Map each chunk's response through search-result.mapper.
//   6. Dedupe by hotelCode (cheapest selling price wins; ties: keep first).
//   7. Sort ascending by total selling price.
//   8. Cache normalized response in Redis 60s.
//
// Markup (Phase 5 will replace with per-corporate rates): apply a flat
// percentage on top of TBO net before computing selling price. Floor never
// goes below the per-room net.

import crypto from 'node:crypto';
import { redis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { Agency } from '../../models/Agency.js';
import { TboHotel } from '../../models/TboHotel.js';
import {
  type HotelAvailRequest,
  type HotelAvailResponse,
  type HotelOffer,
} from '@tripbng/shared';
import { mapSearchResponse } from '../../adapters/tbo/mappers/search-result.mapper.js';
import type { TboPaxRoom, TboSearchResponse } from '../../adapters/tbo/types/search.js';
import { TboError } from '../../adapters/tbo/errors.js';
import { tboCall } from './client.js';
import { filterOffersByPolicy, normalizePolicies } from './policy-guard.service.js';

const CACHE_PREFIX = 'tbo:search:';

export interface SearchContext {
  tenantId: string;
  userId: string;
  agencyId: string | null;
  /** Future: per-corporate markup. Phase 2 always uses TBO_DEFAULT_MARKUP_PCT. */
  markupPercent?: number;
}

/**
 * Run a normalized hotel-availability search end-to-end.
 *
 * Cache: keyed on the canonical-JSON hash of the request. Reads serve from
 * cache when warm; misses trigger the full fan-out and write back. We don't
 * differentiate cached-vs-live to the caller (the response shape carries
 * `cachedAt` so the UI can show data freshness if it wants to).
 */
export async function searchHotels(
  req: HotelAvailRequest,
  ctx: SearchContext,
): Promise<HotelAvailResponse> {
  if (!env.TBO_ENABLED) {
    throw new TboError('TBO_DISABLED', 'TBO integration not enabled', {
      method: 'Search',
      retryable: false,
    });
  }

  const cacheKey = buildCacheKey(req);
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as HotelAvailResponse;
      logger.debug({ cacheKey, offers: parsed.offers.length }, 'tbo: search cache hit');
      return parsed;
    } catch {
      // Bad cache row — drop and fall through to fresh fetch.
      await redis.del(cacheKey).catch(() => undefined);
    }
  }

  const hotelCodes = await resolveHotelCodes(req);
  if (hotelCodes.length === 0) {
    return emptyResponse(req);
  }

  const nights = computeNights(req.checkIn, req.checkOut);
  const chunks = chunk(hotelCodes, env.TBO_SEARCH_CHUNK_SIZE);
  const allOffers: HotelOffer[] = [];
  const allErrors: HotelAvailResponse['errors'] = [];

  await runWithConcurrency(chunks, env.TBO_SEARCH_PARALLEL_LIMIT, async (codes) => {
    try {
      const res = await tboCall<TboSearchResponse>({
        method: 'Search',
        host: 'hotel',
        path: '/Search',
        body: buildSearchBody(req, codes, nights),
      });
      const mapped = mapSearchResponse(res, { nights });
      allOffers.push(...mapped.offers);
      allErrors.push(...mapped.errors);
    } catch (err) {
      // Soft-fail per-chunk: a transient supplier error in one chunk
      // shouldn't take down the whole search. Surface as an error row so
      // the UI can show "X hotels temporarily unavailable".
      logger.warn({ err, chunkSize: codes.length }, 'tbo: search chunk failed');
      allErrors.push({
        hotelCode: null,
        code: err instanceof TboError ? err.code : 'TBO_TRANSPORT',
        message: err instanceof Error ? err.message.slice(0, 200) : 'chunk failed',
      });
    }
  });

  // Look up the agency policies once — drives both the per-corporate
  // markup AND the post-fanout policy filter. Anonymous searches
  // (no agencyId — SUPER_ADMIN preview) skip both.
  const agencyPolicies = ctx.agencyId
    ? await Agency.findById(ctx.agencyId).select('hotelPolicies').lean()
    : null;
  const policies = normalizePolicies(agencyPolicies?.hotelPolicies ?? null);

  // Apply markup on every offer (per-room totals roll up to the offer total).
  // Per-corporate override beats env default beats explicit ctx override.
  const markupPct =
    ctx.markupPercent ?? policies.markupPercent ?? env.TBO_DEFAULT_MARKUP_PCT;
  const withMarkup = allOffers.map((o) => applyMarkup(o, markupPct));

  // Dedupe by hotelCode — cheapest selling-price wins; ties keep first.
  const dedup = new Map<string, HotelOffer>();
  for (const o of withMarkup) {
    const existing = dedup.get(o.hotel.code);
    if (!existing || o.pricing.totalSellingPaise < existing.pricing.totalSellingPaise) {
      dedup.set(o.hotel.code, o);
    }
  }
  const sorted = Array.from(dedup.values()).sort(
    (a, b) => a.pricing.totalSellingPaise - b.pricing.totalSellingPaise,
  );

  // Apply post-fanout filters that we couldn't push to TBO.
  const filtered = applyPostFilters(sorted, req);

  // Corporate policy filter — drops offers above the per-night cap, blocked
  // chains, etc. Surface the count so the UI can show "X hidden by policy".
  const policyResult = filterOffersByPolicy(filtered, policies, nights);
  for (const blocked of policyResult.blocked) {
    allErrors.push({
      hotelCode: blocked.offer.hotel.code,
      code: 'POLICY_VIOLATION',
      message: `${blocked.offer.hotel.name}: ${blocked.reasons.join(', ')}`,
    });
  }

  const response: HotelAvailResponse = {
    searchId: crypto.randomBytes(8).toString('hex'),
    request: req,
    offers: policyResult.allowed,
    errors: allErrors,
    cachedAt: new Date().toISOString(),
    ttlSeconds: env.TBO_SEARCH_CACHE_TTL_SEC,
  };

  // Best-effort cache write — failures here just mean the next search runs
  // the same fan-out, not a correctness issue.
  if (env.TBO_SEARCH_CACHE_TTL_SEC > 0) {
    void redis
      .set(cacheKey, JSON.stringify(response), 'EX', env.TBO_SEARCH_CACHE_TTL_SEC)
      .catch((err) => logger.warn({ err }, 'tbo: search cache write failed'));
  }

  logger.info(
    {
      tenantId: ctx.tenantId,
      destination: req.destination,
      hotelsRequested: hotelCodes.length,
      chunks: chunks.length,
      offers: filtered.length,
      errors: allErrors.length,
    },
    'tbo: search done',
  );
  return response;
}

// ────────── helpers ──────────

async function resolveHotelCodes(req: HotelAvailRequest): Promise<string[]> {
  if (req.destination.type === 'hotel') {
    return req.destination.hotelCodes.slice(0, req.maxResults);
  }
  // City search — pull hotelCodes from our local tbo_hotels reference data.
  // Sort by star desc + isActive so the most likely-relevant come first
  // when we're capped at maxResults.
  const docs = await TboHotel.find({
    cityId: req.destination.cityId,
    isActive: true,
  })
    .sort({ starRating: -1, _id: 1 })
    .limit(req.maxResults)
    .select('hotelCode')
    .lean();
  return docs.map((d) => d.hotelCode);
}

function buildSearchBody(
  req: HotelAvailRequest,
  hotelCodes: string[],
  nights: number,
): Record<string, unknown> {
  return {
    HotelCodes: hotelCodes.join(','),
    CheckInDate: req.checkIn,
    NoOfNights: nights,
    GuestNationality: req.guestNationality.toUpperCase(),
    NoOfRooms: req.rooms.length,
    RoomGuests: req.rooms.map<TboPaxRoom>((r) => ({
      Adults: r.adults,
      Children: r.children,
      ChildrenAges: r.childrenAges.length > 0 ? r.childrenAges : undefined,
    })),
    IsDetailedResponse: false,
    MealType: req.filters?.mealPlan ?? 'All',
    IsRefundable: req.filters?.refundable === true ? true : undefined,
  };
}

function buildCacheKey(req: HotelAvailRequest): string {
  // Canonical JSON — sort keys deterministically so equivalent requests
  // share a cache row regardless of object property order on the wire.
  const canonical = JSON.stringify(req, Object.keys(req).sort());
  const hash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24);
  return `${CACHE_PREFIX}${hash}`;
}

function emptyResponse(req: HotelAvailRequest): HotelAvailResponse {
  return {
    searchId: crypto.randomBytes(8).toString('hex'),
    request: req,
    offers: [],
    errors: [
      {
        hotelCode: null,
        code: 'NO_HOTELS_FOR_DESTINATION',
        message:
          req.destination.type === 'city'
            ? `No hotels in tbo_hotels for cityId=${req.destination.cityId}. Run the admin sync.`
            : 'No hotelCodes provided',
      },
    ],
    cachedAt: new Date().toISOString(),
    ttlSeconds: 0,
  };
}

function applyMarkup(offer: HotelOffer, markupPct: number): HotelOffer {
  if (markupPct <= 0) return offer;
  const factor = 1 + markupPct / 100;
  const rooms = offer.rooms.map((r) => ({
    ...r,
    totalSellingPaise: Math.round(r.totalNetPaise * factor),
  }));
  const totalNetPaise = rooms.reduce((s, r) => s + r.totalNetPaise, 0);
  const totalSellingPaise = rooms.reduce((s, r) => s + r.totalSellingPaise, 0);
  const nights = Math.max(1, Math.round(offer.pricing.totalSellingPaise / Math.max(1, offer.pricing.perNightPaise)));
  return {
    ...offer,
    rooms,
    pricing: {
      ...offer.pricing,
      totalNetPaise,
      totalSellingPaise,
      perNightPaise: Math.round(totalSellingPaise / nights),
    },
  };
}

function applyPostFilters(offers: HotelOffer[], req: HotelAvailRequest): HotelOffer[] {
  const f = req.filters;
  if (!f) return offers;
  return offers.filter((o) => {
    if (f.refundable === true && !o.policies.isRefundable) return false;
    if (f.maxPriceTotalPaise != null && o.pricing.totalSellingPaise > f.maxPriceTotalPaise) {
      return false;
    }
    if (f.minStarRating != null && (o.hotel.starRating ?? 0) < f.minStarRating) return false;
    return true;
  });
}

function computeNights(checkIn: string, checkOut: string): number {
  const start = new Date(checkIn).getTime();
  const end = new Date(checkOut).getTime();
  return Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const next = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      if (item !== undefined) await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

/** Helper exposed for prebook.service: search-result lookup by offerId. */
export async function getCachedOffer(searchId: string, offerId: string): Promise<HotelOffer | null> {
  // We cache by request-hash, not searchId. Direct lookup by offerId would
  // require a parallel index. For Phase 2 we accept the cost — PreBook
  // doesn't have to read from cache; it operates on the raw TBO BookingCode
  // extracted from offerId. If the cache layer becomes load-bearing we
  // restructure here.
  void searchId;
  void offerId;
  return null;
}
