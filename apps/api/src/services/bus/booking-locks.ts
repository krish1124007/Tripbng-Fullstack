// Distributed lock + idempotency helpers for the bus booking flow.
//
// Two concerns kept narrow:
//
//   1. Per-approval booking lock — `acquireBookingLock(approvalId)`
//      Prevents two concurrent /bookings calls (same agent on two tabs,
//      or a network retry mid-flight) from both running the
//      block + book sequence against SeatSeller. Without the lock the
//      second call would burn a fresh blockKey + double-debit the
//      wallet before the first finishes.
//
//   2. Idempotency cache — `getIdempotencyHit / setIdempotencyHit`
//      When the client supplies an `Idempotency-Key` header the second
//      call gets the same booking back without ever touching SeatSeller.
//      24h TTL matches CLAUDE.md §7 cache table.
//
// Both layers ride on Redis. SETNX for the lock, SET EX for the cache.
// No ledger persistence — these caches are advisory + safe to lose.

import { logger } from '../../config/logger.js';
import { redis } from '../../config/redis.js';

// ────────── Lock ──────────

const LOCK_TTL_SEC = 300; // 5 min — covers the 8-min block window with headroom.

export interface BookingLock {
  lockKey: string;
  /** Unique token written into the lock value. Release-time we only
   *  delete the row if the token still matches; otherwise some other
   *  caller has acquired the lock after ours expired. */
  token: string;
}

/**
 * Try to acquire the booking lock for an approvalId. Returns the lock
 * handle on success, or null when the lock is already held.
 *
 * Caller MUST `releaseBookingLock(lock)` in a `finally` so a 5-min
 * stuck lock doesn't follow a thrown error.
 */
export async function acquireBookingLock(approvalId: string): Promise<BookingLock | null> {
  const lockKey = `bus:lock:book:${approvalId}`;
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const acquired = await redis
    .set(lockKey, token, 'EX', LOCK_TTL_SEC, 'NX')
    .catch((err) => {
      logger.warn({ err, lockKey }, 'bus.booking-lock: SETNX failed — proceeding without lock');
      return 'OK';
    });
  if (acquired !== 'OK') return null;
  return { lockKey, token };
}

/** Release the lock — but only if we still own it. Best-effort: a
 *  failure here just lets the lock TTL expire. */
export async function releaseBookingLock(lock: BookingLock): Promise<void> {
  const current = await redis.get(lock.lockKey).catch(() => null);
  if (current !== lock.token) return; // expired or stolen — leave it
  await redis.del(lock.lockKey).catch(() => undefined);
}

// ────────── Idempotency ──────────

const IDEMPOTENCY_TTL_SEC = 24 * 60 * 60;

export interface IdempotencyHit {
  bookingId: string;
  status: string;
  /** ISO timestamp the original call wrote the cache row. Useful when
   *  surfacing "this is a deduped result" to the agent. */
  cachedAt: string;
  /** Free-form extra fields the caller wants to round-trip. */
  payload?: Record<string, unknown>;
}

/**
 * Look up a previous successful booking for this idempotency key. Returns
 * null on miss.
 */
export async function getIdempotencyHit(
  idempotencyKey: string,
): Promise<IdempotencyHit | null> {
  const raw = await redis.get(idemKey(idempotencyKey)).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IdempotencyHit;
  } catch (err) {
    logger.warn({ err, idempotencyKey }, 'bus.idempotency: cached value not JSON — invalidating');
    await redis.del(idemKey(idempotencyKey)).catch(() => undefined);
    return null;
  }
}

/**
 * Store an idempotency hit. Best-effort — a Redis hiccup must not
 * poison the booking response. The flow already persisted the
 * BusBooking row, so worst case the second call retries against
 * SeatSeller (and SeatSeller's own dedupe by blockKey covers us).
 */
export async function setIdempotencyHit(
  idempotencyKey: string,
  hit: IdempotencyHit,
): Promise<void> {
  await redis
    .set(idemKey(idempotencyKey), JSON.stringify(hit), 'EX', IDEMPOTENCY_TTL_SEC)
    .catch((err) => {
      logger.warn({ err, idempotencyKey }, 'bus.idempotency: SET failed — non-fatal');
    });
}

function idemKey(k: string): string {
  return `bus:idemp:book:${k}`;
}
