// Cutover-freeze middleware — Redis-backed kill-switch for the wallet
// cutover window (Phase 9, AGENCY_WALLET_SYSTEM spec §18; runbook §2.1 at
// docs/runbooks/wallet-cutover.md).
//
// When the kill-switch is set (any non-null value at `wallet:cutover:freeze`),
// guarded write endpoints return 503 with `Retry-After`. Reads and webhook /
// payment-advice routes are NOT guarded — those must keep flowing during the
// freeze so in-flight payments can drain before the live-path swap.
//
// Operator commands (from the runbook):
//
//   # Engage — value is the freeze reason, TTL is the maintenance window
//   redis-cli SET wallet:cutover:freeze "in-progress" EX 1800
//
//   # Release
//   redis-cli DEL wallet:cutover:freeze
//
// Fail-open policy: if Redis is unreachable, we WARN-log and let the request
// through. The alternative (fail-closed) self-DOSes during a Redis incident
// for no real benefit — a load-balancer-level kill exists for that case.

import type { NextFunction, Request, Response } from 'express';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

export const CUTOVER_FREEZE_KEY = 'wallet:cutover:freeze';

/** What the middleware emits on a frozen request. Keep matching the
 *  app-wide error envelope used by error.ts + agency-rate-limit.ts. */
export interface CutoverFreezeErrorResponse {
  success: false;
  error: {
    code: 'CUTOVER_FREEZE';
    message: string;
    reason: string | null;
    retryAfterSec: number;
  };
}

/** Pure read — returns whether the freeze is currently engaged, and the
 *  operator-supplied reason if any. Exported so admin/health endpoints can
 *  surface freeze state without re-implementing the read. */
export async function readFreezeState(): Promise<{
  frozen: boolean;
  reason: string | null;
  ttlSec: number | null;
}> {
  try {
    const val = await redis.get(CUTOVER_FREEZE_KEY);
    if (val === null) return { frozen: false, reason: null, ttlSec: null };
    // TTL is read separately so a frozen-with-no-TTL state still works
    // (operator can SET without EX during an open-ended emergency).
    const ttl = await redis.ttl(CUTOVER_FREEZE_KEY).catch(() => -1);
    return { frozen: true, reason: val, ttlSec: ttl > 0 ? ttl : null };
  } catch (err) {
    logger.error(
      { err },
      'cutover-freeze: Redis check failed — defaulting to OPEN (use LB kill if needed)',
    );
    return { frozen: false, reason: null, ttlSec: null };
  }
}

/** Middleware factory. `area` is purely for log attribution — frozen
 *  responses look the same regardless. */
export function requireNotFrozen(area: 'booking' | 'topup' | 'transfer') {
  return async function cutoverFreezeMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const state = await readFreezeState();
    if (!state.frozen) return next();

    // Retry-After: clamp the TTL to a sensible floor so clients don't
    // hammer immediately on a freeze with no TTL set.
    const retryAfterSec = state.ttlSec && state.ttlSec > 0 ? state.ttlSec : 60;
    res.setHeader('Retry-After', String(retryAfterSec));

    logger.warn(
      {
        area,
        reason: state.reason,
        path: req.path,
        method: req.method,
        agencyId: req.auth?.agencyId ?? null,
        retryAfterSec,
      },
      'cutover-freeze: request rejected — wallet cutover in progress',
    );

    const body: CutoverFreezeErrorResponse = {
      success: false,
      error: {
        code: 'CUTOVER_FREEZE',
        message: 'Wallet cutover in progress — please retry shortly.',
        reason: state.reason,
        retryAfterSec,
      },
    };
    res.status(503).json(body);
  };
}
