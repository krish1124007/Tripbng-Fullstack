// Bus search service — orchestrates city + trip lookups against the
// SeatSeller adapter, with the cache layer in front of getCities and
// getAvailableTrips. CLAUDE.md §8.1.
//
// Flow:
//   1. Validate src, dst, doj.
//   2. Try cache: trips:{src}:{dst}:{doj}
//   3. On miss: ss.getAvailableTrips(...) → cache → return
//   4. Decorate each trip with derived fields:
//        - departureAt, arrivalAt (ssMinutesToDate)
//   5. Apply tenant policy filters (busType, operator allowlist, maxFare)
//      — DEFERRED to Phase 5 when TravelPolicy is in. The shape of the
//      service accepts an optional policy parameter today; the search
//      route always passes undefined for now.
//   6. Sort by departureAt asc + return.

import { AppError } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { getSeatSellerClient } from '../../adapters/seatseller/factory.js';
import { SeatSellerError } from '../../adapters/seatseller/errors.js';
import {
  ssMinutesToDate,
  dojFromIstDateString,
} from '../../adapters/seatseller/utils/time.js';
import type {
  SeatSellerAvailableTrip,
  SeatSellerCity,
  SeatSellerCityAlias,
} from '../../adapters/seatseller/types.js';
import {
  getCachedAliases,
  getCachedCities,
  getCachedTrips,
  setCachedAliases,
  setCachedCities,
  setCachedTrips,
} from './cache.service.js';
import { resolvePolicyForEmployee } from '../approval/policy.service.js';

// ────────── Search ──────────

export interface BusSearchInput {
  source: number;
  destination: number;
  /** "yyyy-MM-dd" in IST. */
  doj: string;
  /** Optional bookings-window guards. Pre-resolved hints — used directly
   *  by tests + callers that already know the policy. */
  policy?: BusPolicyHints;
  /** Phase-5 path: when set, the service resolves the employee's
   *  TravelPolicy and converts to BusPolicyHints automatically. Takes
   *  precedence over an inline `policy` field. Routes pass this from
   *  `?employeeId=` in the search URL. */
  employeeId?: string;
}

export interface BusPolicyHints {
  /** Cap fares displayed (per-pax, in paise). */
  maxFarePaise?: number;
  /** Only show trips on these operator IDs. */
  allowedOperatorIds?: number[];
  /** Hide these operator IDs. */
  blockedOperatorIds?: number[];
  /** Restrict to AC trips. */
  acOnly?: boolean;
  /** Disallow sleepers. */
  sleeperAllowed?: boolean;
  /** Specific busTypeIds allowed (whitelist). */
  allowedBusTypeIds?: number[];
}

export interface BusSearchResult {
  /** Echoed input. */
  source: { id: number; name: string | null };
  destination: { id: number; name: string | null };
  doj: string;
  /** Whether the underlying call hit our cache. Useful for ops dashboards. */
  fromCache: boolean;
  /** Trips, sorted by computed departure time (UTC). */
  trips: BusTripView[];
  /** How many trips were filtered out by tenant policy (0 today). */
  filteredOut: number;
}

export interface BusTripView extends SeatSellerAvailableTrip {
  /** Resolved ISO timestamps for the UI. */
  departureAt: string;
  arrivalAt: string;
}

/**
 * Run a bus search. Source/destination resolve to city names from the
 * cached city catalog when available — non-fatal if not cached (we just
 * return null names).
 */
export async function searchBuses(input: BusSearchInput): Promise<BusSearchResult> {
  const { source, destination, doj } = input;

  if (!Number.isInteger(source) || source <= 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'source must be a positive city id' });
  }
  if (!Number.isInteger(destination) || destination <= 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'destination must be a positive city id' });
  }
  if (source === destination) {
    throw new AppError('VALIDATION_ERROR', { reason: 'source and destination must differ' });
  }

  // Reject doj outside the [today, today+90d] window. Per-tenant
  // tightening (minAdvanceHours, maxAdvanceDays) lands in Phase 5 with
  // the policy engine.
  const dojDate = dojFromIstDateString(doj); // throws on malformed
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (dojDate.getTime() < today.getTime() - 24 * 60 * 60 * 1000) {
    throw new AppError('VALIDATION_ERROR', { reason: 'doj cannot be in the past' });
  }
  // 90 days in the future — broad ceiling; tenant policy tightens.
  const ninetyDaysOut = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
  if (dojDate.getTime() > ninetyDaysOut.getTime()) {
    throw new AppError('VALIDATION_ERROR', { reason: 'doj more than 90 days out' });
  }

  // ── Cache hit / miss ──
  const cached = await getCachedTrips(source, destination, doj);
  let trips: SeatSellerAvailableTrip[];
  let fromCache = false;
  if (cached) {
    trips = cached;
    fromCache = true;
  } else {
    const client = getSeatSellerClient();
    if (!client) {
      throw new SeatSellerError('SEATSELLER_DISABLED', 'Bus search is disabled');
    }
    trips = await client.getAvailableTrips({ source, destination, doj });
    // Cache write is best-effort. A Redis hiccup must not poison the
    // search response.
    await setCachedTrips(source, destination, doj, trips, dojDate).catch((err) =>
      logger.warn({ err, source, destination, doj }, 'bus.search: cache write failed'),
    );
  }

  // ── Decorate ──
  const decorated: BusTripView[] = trips.map((t) => ({
    ...t,
    departureAt: ssMinutesToDate(dojDate, t.departureTime).toISOString(),
    arrivalAt: ssMinutesToDate(dojDate, t.arrivalTime).toISOString(),
  }));

  // ── Policy filters ──
  // employeeId takes precedence: resolve TravelPolicy → BusPolicyHints.
  // Falls back to inline `policy` for tests / callers that already know.
  const policyHints = input.employeeId
    ? await resolvePolicyHintsForEmployee(input.employeeId)
    : input.policy;
  const filtered = policyHints ? applyPolicy(decorated, policyHints) : decorated;

  // ── Sort ──
  filtered.sort((a, b) => a.departureAt.localeCompare(b.departureAt));

  // ── Resolve city names from the cached catalog (best effort). ──
  const cities = await getCachedCities();
  const sourceCity = cities?.find((c) => c.id === source) ?? null;
  const destCity = cities?.find((c) => c.id === destination) ?? null;

  return {
    source: { id: source, name: sourceCity?.name ?? null },
    destination: { id: destination, name: destCity?.name ?? null },
    doj,
    fromCache,
    trips: filtered,
    filteredOut: decorated.length - filtered.length,
  };
}

function applyPolicy(trips: BusTripView[], p: BusPolicyHints): BusTripView[] {
  return trips.filter((t) => {
    if (p.maxFarePaise !== undefined && t.fareMinINR * 100 > p.maxFarePaise) return false;
    if (p.allowedOperatorIds && !p.allowedOperatorIds.includes(t.operatorId)) return false;
    if (p.blockedOperatorIds && p.blockedOperatorIds.includes(t.operatorId)) return false;
    if (p.acOnly && t.isAc !== true) return false;
    if (p.sleeperAllowed === false && t.isSleeper === true) return false;
    if (p.allowedBusTypeIds && t.busTypeId !== undefined && !p.allowedBusTypeIds.includes(t.busTypeId)) {
      return false;
    }
    return true;
  });
}

/**
 * Resolve a TravelPolicy doc for an employee and convert to the
 * narrower BusPolicyHints shape this service uses for filtering. We
 * keep two shapes so the policy-eval (used at submit-time) can read the
 * full TravelPolicy with auto-approve thresholds, while search-time
 * filtering only needs the hard "filter from results" rules.
 *
 * Returns undefined when no policy is wired up — caller treats that
 * as permissive.
 */
async function resolvePolicyHintsForEmployee(
  employeeId: string,
): Promise<BusPolicyHints | undefined> {
  const policy = await resolvePolicyForEmployee(employeeId);
  if (!policy || !policy.rules?.bus) return undefined;
  const r = policy.rules.bus;
  const hints: BusPolicyHints = {};
  if (r.maxFarePaise != null) hints.maxFarePaise = r.maxFarePaise;
  if (r.acOnly) hints.acOnly = true;
  if (r.sleeperAllowed === false) hints.sleeperAllowed = false;
  if (r.allowedBusTypeIds && r.allowedBusTypeIds.length > 0) {
    hints.allowedBusTypeIds = r.allowedBusTypeIds;
  }
  if (r.blockedOperatorIds && r.blockedOperatorIds.length > 0) {
    hints.blockedOperatorIds = r.blockedOperatorIds;
  }
  return hints;
}

// ────────── City autocomplete ──────────

export interface CityAutocompleteResult {
  cities: SeatSellerCity[];
  fromCache: boolean;
}

/**
 * Resolve cities by partial name match. Cache-first; warms via the
 * city-sync worker on a Sunday cron, but we lazily pull on miss for
 * fresh installs (and for tests where the cron hasn't fired).
 */
export async function getCityAutocomplete(
  q: string,
  limit = 12,
): Promise<CityAutocompleteResult> {
  const needle = q.trim().toLowerCase();
  const { cities, aliases, fromCache } = await loadCitiesAndAliases();

  if (!needle) {
    return { cities: cities.slice(0, limit), fromCache };
  }

  const aliasIds = new Set(
    aliases.filter((a) => a.alias.toLowerCase().includes(needle)).map((a) => a.cityId),
  );
  const matches = cities
    .filter((c) => c.name.toLowerCase().includes(needle) || aliasIds.has(c.id))
    .slice(0, limit);
  return { cities: matches, fromCache };
}

interface CityCatalog {
  cities: SeatSellerCity[];
  aliases: SeatSellerCityAlias[];
  fromCache: boolean;
}

/**
 * Internal cache-first read of cities + aliases. Used by the
 * autocomplete + the search service's name resolution. Public so the
 * city-sync worker can call it (and so tests can prime fixtures).
 */
export async function loadCitiesAndAliases(): Promise<CityCatalog> {
  const [cachedCities, cachedAliases] = await Promise.all([
    getCachedCities(),
    getCachedAliases(),
  ]);
  if (cachedCities && cachedAliases) {
    return { cities: cachedCities, aliases: cachedAliases, fromCache: true };
  }

  const client = getSeatSellerClient();
  if (!client) {
    // Disabled — return empty catalog rather than throwing. The
    // autocomplete UX should degrade gracefully.
    return { cities: cachedCities ?? [], aliases: cachedAliases ?? [], fromCache: false };
  }

  // Lazy fill on first hit. The city-sync worker overwrites these on
  // its weekly run; concurrent first-touch races are harmless because
  // both writers produce equivalent payloads.
  const [cities, aliases] = await Promise.all([client.getCities(), client.getAliases()]);
  await Promise.all([setCachedCities(cities), setCachedAliases(aliases)]).catch((err) =>
    logger.warn({ err }, 'bus.search: city catalog cache write failed — non-fatal'),
  );
  return { cities, aliases, fromCache: false };
}
