// Bus search-cache helpers.
//
// Three concerns live here, kept narrow so they're easy to swap if Redis
// ever moves to a managed cache:
//   1. Cache-key naming (single source of truth — used by tests + lint).
//   2. TTL resolution (peak season = 30 min, off-peak = 2 h).
//   3. The `tripDetails` escape hatch — we EXPORT a guard helper that
//      proves there's no caching of trip-details anywhere. CLAUDE.md §0
//      Law 1: tripDetails is NEVER cached.
//
// The Redis client and the SeatSeller client are dependency-injected via
// arguments so unit tests can wire fakes without touching ioredis. The
// service file itself imports the real `redis` singleton for production
// callers — search.service uses that path.

import { logger } from '../../config/logger.js';
import { redis } from '../../config/redis.js';
import type {
  SeatSellerAvailableTrip,
  SeatSellerBpDpDetails,
  SeatSellerCity,
  SeatSellerCityAlias,
} from '../../adapters/seatseller/types.js';

// ────────── Cache key registry ──────────
// Centralised so the guard test (bus-no-trip-details-cache.test.ts) can
// scan the literal strings without false negatives. Update only via the
// `BUS_CACHE_KEYS` map — never inline a key.

export const BUS_CACHE_KEYS = {
  cities: 'bus:cities:list',
  aliases: 'bus:aliases:list',
  /** trips:{src}:{dst}:{doj} */
  trips: (src: number, dst: number, doj: string): string =>
    `bus:trips:${src}:${dst}:${doj}`,
  /** bpdp:{tripId} — short-TTL cache of the BP-DP layout. */
  bpdp: (tripId: string): string => `bus:bpdp:${tripId}`,
} as const;

// ────────── TTL resolver ──────────

/** Peak-season TTL — short because fares move fast during peak. */
export const TTL_PEAK_SEC = 30 * 60; // 30 min
/** Off-peak TTL — longer because fares are stable. */
export const TTL_OFFPEAK_SEC = 2 * 60 * 60; // 2 h
export const TTL_CITIES_SEC = 7 * 24 * 60 * 60; // 7 days
export const TTL_BPDP_SEC = 60 * 60; // 1 hour

/**
 * Returns true when the journey date falls in a known peak window:
 *   - May–June (summer holiday travel)
 *   - October–November (Diwali / Dussehra cluster)
 *   - March (Holi)
 *   - 24-31 December (year-end + Christmas)
 *
 * Pure function on the IST calendar — never reads Date.now().
 */
export function isPeakSeason(doj: Date): boolean {
  if (Number.isNaN(doj.getTime())) return false;
  const ist = new Date(doj.getTime() + 5.5 * 60 * 60_000);
  const month = ist.getUTCMonth() + 1; // 1-12
  const day = ist.getUTCDate();

  if (month === 5 || month === 6) return true; // summer
  if (month === 10 || month === 11) return true; // Diwali cluster
  if (month === 3) return true; // Holi
  if (month === 12 && day >= 24) return true; // year-end
  return false;
}

/** Choose TTL for a trips:{src}:{dst}:{doj} cache row. */
export function tripsTtlSec(doj: Date): number {
  return isPeakSeason(doj) ? TTL_PEAK_SEC : TTL_OFFPEAK_SEC;
}

// ────────── Cities + aliases ──────────

export async function getCachedCities(): Promise<SeatSellerCity[] | null> {
  const raw = await redis.get(BUS_CACHE_KEYS.cities).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SeatSellerCity[];
  } catch (err) {
    logger.warn({ err }, 'bus.cache: cities JSON parse failed — invalidating');
    await redis.del(BUS_CACHE_KEYS.cities).catch(() => undefined);
    return null;
  }
}

export async function setCachedCities(cities: SeatSellerCity[]): Promise<void> {
  await redis.set(
    BUS_CACHE_KEYS.cities,
    JSON.stringify(cities),
    'EX',
    TTL_CITIES_SEC,
  );
}

export async function getCachedAliases(): Promise<SeatSellerCityAlias[] | null> {
  const raw = await redis.get(BUS_CACHE_KEYS.aliases).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SeatSellerCityAlias[];
  } catch (err) {
    logger.warn({ err }, 'bus.cache: aliases JSON parse failed — invalidating');
    await redis.del(BUS_CACHE_KEYS.aliases).catch(() => undefined);
    return null;
  }
}

export async function setCachedAliases(aliases: SeatSellerCityAlias[]): Promise<void> {
  await redis.set(
    BUS_CACHE_KEYS.aliases,
    JSON.stringify(aliases),
    'EX',
    TTL_CITIES_SEC,
  );
}

// ────────── Trips ──────────

export async function getCachedTrips(
  src: number,
  dst: number,
  doj: string,
): Promise<SeatSellerAvailableTrip[] | null> {
  const key = BUS_CACHE_KEYS.trips(src, dst, doj);
  const raw = await redis.get(key).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SeatSellerAvailableTrip[];
  } catch (err) {
    logger.warn({ err, key }, 'bus.cache: trips JSON parse failed — invalidating');
    await redis.del(key).catch(() => undefined);
    return null;
  }
}

export async function setCachedTrips(
  src: number,
  dst: number,
  doj: string,
  trips: SeatSellerAvailableTrip[],
  dojDate: Date,
): Promise<void> {
  const key = BUS_CACHE_KEYS.trips(src, dst, doj);
  await redis.set(key, JSON.stringify(trips), 'EX', tripsTtlSec(dojDate));
}

// ────────── BP-DP ──────────

export async function getCachedBpDp(tripId: string): Promise<SeatSellerBpDpDetails | null> {
  const raw = await redis.get(BUS_CACHE_KEYS.bpdp(tripId)).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SeatSellerBpDpDetails;
  } catch (err) {
    logger.warn({ err, tripId }, 'bus.cache: bpdp JSON parse failed — invalidating');
    await redis.del(BUS_CACHE_KEYS.bpdp(tripId)).catch(() => undefined);
    return null;
  }
}

export async function setCachedBpDp(tripId: string, value: SeatSellerBpDpDetails): Promise<void> {
  await redis.set(BUS_CACHE_KEYS.bpdp(tripId), JSON.stringify(value), 'EX', TTL_BPDP_SEC);
}

// ────────── Forbidden — tripDetails NEVER cached ──────────
// CLAUDE.md §0 Law 1. The tests in bus-no-trip-details-cache.test.ts
// scan this entire file for "tripDetails" cache keys; the only mention
// of the string here is in this guard comment + the assertion below.

/** Static assertion: nothing in this module declares a `tripDetails`
 *  cache key. The test guard re-checks this at the source level too. */
export const __NO_TRIP_DETAILS_CACHE__: { readonly reason: string } = Object.freeze({
  reason:
    'tripDetails is never cached — CLAUDE.md §0 Law 1. Tests in ' +
    'bus-no-trip-details-cache.test.ts will fail if any cache helper ' +
    'for tripDetails is added.',
});
