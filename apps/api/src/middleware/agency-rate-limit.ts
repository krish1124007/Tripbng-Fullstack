// Per-agency rate limiter — Redis-backed sliding window.
//
// Why per-agency (not per-IP): one corporate office routes all traffic
// through the same NAT IP, so per-IP either limits the whole office or is
// useless. Per-agency-id is the right blast-radius.
//
// Algorithm: sliding-window counter. We INCR a key with a 60s TTL — total
// requests in the past minute. Cheaper than a true sliding-window-log for
// the precision we need (~10% accuracy is fine for "is this agency
// hammering us").
//
// Three classes of caller:
//   - Authenticated agency:   60 search/min, 20 booking/min (config below)
//   - Authenticated distributor: 200/min (transfers, cockpit reads)
//   - Anon / SUPER_ADMIN:    unscoped (admin shouldn't hit limits)

import type { NextFunction, Request, Response } from 'express';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

interface AgencyLimitOptions {
  /** Max requests per window. */
  max: number;
  /** Window length in seconds. Default 60. */
  windowSec?: number;
  /** Key suffix — distinguishes search-vs-booking buckets per agency. */
  bucket: string;
}

export function agencyRateLimit(opts: AgencyLimitOptions) {
  const window = opts.windowSec ?? 60;

  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const role = req.auth?.role;
    if (!role || role === 'SUPER_ADMIN') return next();

    const scope =
      req.auth?.agencyId ??
      req.auth?.distributorId ??
      req.auth?.userId ??
      req.ip ??
      'anon';

    const key = `rl:agency:${scope}:${opts.bucket}`;
    let count: number;
    try {
      count = await redis.incr(key);
      if (count === 1) await redis.expire(key, window);
    } catch (err) {
      // Redis down? Don't block legitimate traffic.
      logger.warn({ err }, 'agency-rate-limit: redis unavailable, fail-open');
      return next();
    }

    res.setHeader('X-RateLimit-Limit', String(opts.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, opts.max - count)));
    res.setHeader('X-RateLimit-Bucket', opts.bucket);

    if (count > opts.max) {
      const ttl = await redis.ttl(key).catch(() => window);
      res.setHeader('Retry-After', String(Math.max(1, ttl)));
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: `${opts.bucket} rate limit exceeded for this agency`,
          retryAfterSec: ttl,
        },
      });
      return;
    }

    return next();
  };
}

/** Common buckets — apply at the route level. */
export const searchAgencyLimit = agencyRateLimit({ bucket: 'search', max: 60 });
export const bookingAgencyLimit = agencyRateLimit({ bucket: 'booking', max: 20 });
export const topupAgencyLimit = agencyRateLimit({ bucket: 'topup', max: 10 });
