// Bus trip service — wraps SeatSeller's TripDetails + BPDP endpoints
// for the seat-layout UI.
//
// CRITICAL: getTripDetails is ALWAYS LIVE — no caching, no memoisation,
// no in-process dedupe. Spec §0 Law 1. Stale fares between search and
// block are the #1 cause of revenue leakage and policy violations.
//
// BPDP can be cached at short TTL (1h) because it's effectively static
// per trip. The cache lives in cache.service.ts; this file uses it.

import { logger } from '../../config/logger.js';
import { getSeatSellerClient } from '../../adapters/seatseller/factory.js';
import { SeatSellerError } from '../../adapters/seatseller/errors.js';
import { parseForcedSeats, type ForcedSeats } from '../../adapters/seatseller/utils/forced-seats.js';
import {
  ssMinutesToDate,
  dojFromIstDateString,
} from '../../adapters/seatseller/utils/time.js';
import type {
  SeatSellerSeat,
  SeatSellerStop,
  SeatSellerTripDetails,
} from '../../adapters/seatseller/types.js';
import { getCachedBpDp, setCachedBpDp } from './cache.service.js';

// ────────── Output shape ──────────
// We expose a normalised, UI-friendly canonical view rather than the
// raw SeatSellerTripDetails — the booking-form needs forcedSeats parsed,
// pickup times resolved to ISO timestamps, and a stable seat-layout grid.

export interface TripDetailsView {
  tripId: string;
  inventoryId: string;

  /** Parsed forcedSeats. UI uses canPickFreely() to decide selection rules. */
  forcedSeats: ForcedSeats;
  /** Raw policy string — booking flow re-parses on cancel; the search-time
   *  reading is just informational. */
  cancellationPolicy: string;
  /** Anchor for cancellation slab math; set on the booking row at hold-time. */
  cancellationCalculationTimestamp: string;
  partialCancellationAllowed: boolean;

  /** Seats with display-ready row/col + price. Order matches operator emission. */
  seats: SeatSellerSeat[];

  /** Boarding/dropping stops with `time` already resolved to ISO timestamps
   *  (the caller passes `doj` so we can convert SeatSeller minutes). */
  boardingPoints: ResolvedStop[];
  droppingPoints: ResolvedStop[];

  bpDpSeatLayout: boolean;
  callFareBreakupApi: boolean;
  mTicketEnabled: boolean;
}

export interface ResolvedStop extends Omit<SeatSellerStop, 'time'> {
  /** ISO timestamp computed via ssMinutesToDate(doj, time). */
  timeAt: string;
  /** Original ssMinutes — preserved for the block request which sends it back. */
  timeMinutes: number;
}

// ────────── getTripDetails (LIVE) ──────────

/**
 * Live trip-details fetch. Never cached. Always hits SeatSeller.
 *
 * @param tripId  SeatSeller trip handle from getAvailableTrips
 * @param doj     "yyyy-MM-dd" — the journey date the user picked. Used
 *                to resolve SeatSeller's minute-offsets to absolute
 *                timestamps. Must match the doj used at search time.
 *
 * Throws when SEATSELLER_ENABLED=false (caller routes shouldn't call this
 * without checking — but a thrown error is safer than returning a stale
 * shim).
 */
export async function getTripDetails(
  tripId: string,
  doj: string,
): Promise<TripDetailsView> {
  const client = getSeatSellerClient();
  if (!client) {
    throw new SeatSellerError('SEATSELLER_DISABLED', 'Bus search is disabled');
  }
  const dojDate = dojFromIstDateString(doj);
  const details = await client.getTripDetails(tripId);
  return normaliseTripDetails(details, dojDate);
}

/**
 * BP-DP-model trip details (some operators only return seat layouts
 * once the user has picked a BP and DP). Spec §6.1 + §8.1.
 *
 * Lazily cached — same TTL as the BPDP-only endpoint, since this is
 * really "BPDP plus seats" and the seats are only as fresh as the
 * surrounding layout. Even so, blockTicket re-fetches; this is a UI
 * convenience.
 */
export async function getTripDetailsV2(
  inventoryId: string,
  bpId: number,
  dpId: number,
  doj: string,
): Promise<TripDetailsView> {
  const client = getSeatSellerClient();
  if (!client) {
    throw new SeatSellerError('SEATSELLER_DISABLED', 'Bus search is disabled');
  }
  const dojDate = dojFromIstDateString(doj);
  const details = await client.getTripDetailsV2({ inventoryId, bpId, dpId });
  return normaliseTripDetails(details, dojDate);
}

// ────────── BPDP (short cache OK) ──────────

export interface BpDpView {
  tripId: string;
  boardingPoints: ResolvedStop[];
  droppingPoints: ResolvedStop[];
}

export async function getBpDpDetails(tripId: string, doj: string, bpId?: number): Promise<BpDpView> {
  const dojDate = dojFromIstDateString(doj);

  // Cache hit returns immediately. We re-resolve minute offsets to
  // timestamps below — minutes are stable per trip but the doj could
  // theoretically differ between callers. Defensive re-resolve.
  const cached = await getCachedBpDp(tripId);
  if (cached) {
    return {
      tripId,
      boardingPoints: cached.boardingPoints.map((s) => resolveStop(s, dojDate)),
      droppingPoints: cached.droppingPoints.map((s) => resolveStop(s, dojDate)),
    };
  }

  const client = getSeatSellerClient();
  if (!client) {
    throw new SeatSellerError('SEATSELLER_DISABLED', 'Bus search is disabled');
  }
  const live = await client.getBpDpDetails({ tripId, bpId });
  // Cache the raw stop list (minute-encoded). resolveStop runs at read
  // time so callers always see consistent timestamps.
  await setCachedBpDp(tripId, live).catch((err) =>
    logger.warn({ err, tripId }, 'bus.trip: bpdp cache write failed — non-fatal'),
  );

  return {
    tripId,
    boardingPoints: live.boardingPoints.map((s) => resolveStop(s, dojDate)),
    droppingPoints: live.droppingPoints.map((s) => resolveStop(s, dojDate)),
  };
}

// ────────── Helpers ──────────

function normaliseTripDetails(
  details: SeatSellerTripDetails,
  dojDate: Date,
): TripDetailsView {
  return {
    tripId: details.tripId,
    inventoryId: details.inventoryId,
    forcedSeats: parseForcedSeats(details.forcedSeats),
    cancellationPolicy: details.cancellationPolicy,
    cancellationCalculationTimestamp: details.cancellationCalculationTimestamp,
    partialCancellationAllowed: details.partialCancellationAllowed,
    seats: details.seats,
    boardingPoints: details.boardingPoints.map((s) => resolveStop(s, dojDate)),
    droppingPoints: details.droppingPoints.map((s) => resolveStop(s, dojDate)),
    bpDpSeatLayout: details.bpDpSeatLayout,
    callFareBreakupApi: details.callFareBreakupApi,
    mTicketEnabled: details.mTicketEnabled,
  };
}

function resolveStop(s: SeatSellerStop, dojDate: Date): ResolvedStop {
  return {
    id: s.id,
    name: s.name,
    address: s.address,
    landmark: s.landmark,
    contact: s.contact,
    timeAt: ssMinutesToDate(dojDate, s.time).toISOString(),
    timeMinutes: s.time,
  };
}
