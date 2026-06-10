// Per-agency Redis distributed lock for wallet mutations.
//
// All wallet/credit/ledger writes for a single agency MUST be serialised so we
// don't get torn reads on `walletBalance` / `creditBalance` under concurrent
// requests. MongoDB transactions plus an `optimistic version` field on Wallet
// already protect data integrity at write time, but the lock cuts the failure
// mode off earlier: it lets concurrent callers queue rather than racing into
// version-conflict retries that hammer the DB.
//
// Pattern:
//   * `SET key value NX EX 30` — atomic acquire with TTL.
//   * value = random request-id, so only the holder can release. If our work
//     overshoots the TTL and Redis already gave the lock to someone else,
//     the Lua release is a no-op (we don't blow away their lock).
//   * Bounded retry loop with exponential backoff for contention.
//
// Why 30s TTL: long enough to cover a slow Mongo txn with a payment-webhook
// fan-out (typical p99 ~2s), short enough that a crashed worker doesn't park
// the lock for hours.

import crypto from 'node:crypto';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

const LOCK_KEY_PREFIX = 'wallet:lock:';
const DEFAULT_TTL_MS = 30_000;
// Total wall-time we'll spend trying to acquire before giving up. Picked so
// HTTP requests don't hang and so a runaway hot-spot fails fast enough for the
// caller's retry strategy to take over.
const DEFAULT_ACQUIRE_TIMEOUT_MS = 2_000;
const INITIAL_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 400;
// Lua script for safe release — compare-and-delete in one atomic step.
// Returns 1 if we owned the lock and released it, 0 if someone else held it.
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

export class WalletLockError extends Error {
  readonly code: 'LOCK_TIMEOUT' | 'LOCK_LOST';
  readonly agencyId: string;
  constructor(code: 'LOCK_TIMEOUT' | 'LOCK_LOST', agencyId: string, message: string) {
    super(message);
    this.name = 'WalletLockError';
    this.code = code;
    this.agencyId = agencyId;
  }
}

export interface WithWalletLockOptions {
  /**
   * Max wall-time (ms) to wait acquiring the lock before throwing
   * `WalletLockError('LOCK_TIMEOUT')`. Default {@link DEFAULT_ACQUIRE_TIMEOUT_MS}.
   */
  acquireTimeoutMs?: number;
  /**
   * Lock TTL in ms. The held lock will auto-expire after this — set high
   * enough to cover the slowest expected critical section. Default 30s.
   */
  ttlMs?: number;
}

/**
 * Run `fn` while holding the per-agency wallet lock. Acquires (with bounded
 * backoff), runs `fn`, releases regardless of success or failure.
 *
 * @throws WalletLockError when the lock cannot be acquired in time.
 *
 * Important: `fn` must NOT exceed `ttlMs` of wall time. If it does, Redis will
 * have already released the lock and another caller may be running concurrently
 * with us — we log a warning ("LOCK_LOST") but do not throw, because the inner
 * Mongo transaction + Wallet.version optimistic check will still catch any
 * resulting data race.
 */
export async function withWalletLock<T>(
  agencyId: string,
  fn: () => Promise<T>,
  opts: WithWalletLockOptions = {},
): Promise<T> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const acquireTimeoutMs = opts.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
  const key = `${LOCK_KEY_PREFIX}${agencyId}`;
  // 128 bits of entropy — collision risk with another holder is negligible.
  const token = crypto.randomBytes(16).toString('hex');

  await acquire(key, token, ttlMs, acquireTimeoutMs, agencyId);
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    const elapsed = Date.now() - startedAt;
    if (elapsed > ttlMs) {
      // We outran our lease — another caller may have picked up the lock
      // mid-flight. Loud warning so we notice if this becomes recurrent.
      logger.warn(
        { agencyId, elapsedMs: elapsed, ttlMs },
        'wallet-lock: critical section exceeded TTL (LOCK_LOST)',
      );
    }
    await release(key, token, agencyId);
  }
}

async function acquire(
  key: string,
  token: string,
  ttlMs: number,
  budgetMs: number,
  agencyId: string,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  let backoff = INITIAL_BACKOFF_MS;
  while (true) {
    // ioredis SET options: EX (s) or PX (ms); NX to only set if missing.
    // Using PX so we don't lose precision on sub-second TTLs (handy for tests).
    const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (result === 'OK') return;
    if (Date.now() + backoff >= deadline) {
      throw new WalletLockError(
        'LOCK_TIMEOUT',
        agencyId,
        `Could not acquire wallet lock for agency ${agencyId} within ${budgetMs}ms`,
      );
    }
    // Add up to 50% jitter to avoid thundering-herd retries on a hot agency.
    const jitter = Math.floor(Math.random() * backoff * 0.5);
    await sleep(backoff + jitter);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

async function release(key: string, token: string, agencyId: string): Promise<void> {
  try {
    const released = await redis.eval(RELEASE_SCRIPT, 1, key, token);
    if (released === 0 || released === '0') {
      // Either our lease expired and someone else acquired the lock, or it
      // was never held (the second path is impossible if `acquire` returned
      // success, so this collapses to "we outran our TTL").
      logger.warn(
        { agencyId },
        'wallet-lock: release skipped — lock no longer owned by this caller',
      );
    }
  } catch (err) {
    // Releasing is best-effort. Redis blip should NOT mask a real error from
    // the critical section. Log and continue — the lock will auto-expire.
    logger.error({ err, agencyId }, 'wallet-lock: release failed; lock will auto-expire');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
