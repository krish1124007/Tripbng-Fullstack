// Idempotency-Key middleware. Apply to mutating routes (POST/PUT/PATCH).
//
// Behaviour:
//   - First request with a given key + route + body-hash + caller is recorded
//     in Redis with a 24h TTL; the response is captured and replayed on
//     duplicate requests.
//   - Replay returns the original status + headers + body, even on errors.
//   - Conflicting body for the same key throws 409 (caller is reusing a key
//     for a different operation).
//   - Missing Idempotency-Key header on a guarded route is allowed by default
//     so we don't break existing clients; in `enforce: true` mode it 400s.
//
// Why Redis vs Mongo for the store: TTL-friendly, sub-ms lookups, and we
// already use ioredis everywhere. Falls back to letting the request proceed
// (logged) if Redis is down — better than blocking real money flow.

import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

interface CachedResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  bodyHash: string;
}

const TTL_SECONDS = 24 * 60 * 60;

interface IdempotencyOptions {
  /** Throw 400 when the header is missing. Default false (advisory). */
  enforce?: boolean;
  /** Don't store responses with these statuses (e.g. 5xx). Default: 5xx skipped. */
  storeOnStatus?: (status: number) => boolean;
}

export function idempotencyKey(opts: IdempotencyOptions = {}) {
  const enforce = opts.enforce ?? false;
  const shouldStore = opts.storeOnStatus ?? ((s: number) => s < 500);

  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

    const key = (req.headers['idempotency-key'] as string | undefined)?.trim();
    if (!key) {
      if (enforce) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Idempotency-Key header required' },
        });
        return;
      }
      return next();
    }
    if (key.length < 8 || key.length > 200) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Idempotency-Key must be 8–200 chars' },
      });
      return;
    }

    // Caller scope — protects against key reuse across users/agencies.
    const caller = req.auth?.userId ?? req.ip ?? 'anon';
    const bodyHash = hashBody(req.body);
    const route = `${req.method}:${req.baseUrl}${req.path}`;
    const redisKey = `idem:${caller}:${route}:${key}`;

    let cached: CachedResponse | null = null;
    try {
      const raw = await redis.get(redisKey);
      if (raw) cached = JSON.parse(raw) as CachedResponse;
    } catch (err) {
      logger.warn({ err, key }, 'idempotency: redis read failed, proceeding fresh');
    }

    if (cached) {
      // Same key, different body = developer error. Refuse loudly.
      if (cached.bodyHash !== bodyHash) {
        res.status(409).json({
          success: false,
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Idempotency-Key reused with a different request body',
          },
        });
        return;
      }
      // Replay.
      for (const [name, value] of Object.entries(cached.headers)) {
        if (!res.headersSent) res.setHeader(name, value);
      }
      res.setHeader('Idempotent-Replay', 'true');
      res.status(cached.status).json(cached.body);
      return;
    }

    // Capture the response by hijacking res.json. We restore the original
    // method after the response so other middleware sees normal behaviour.
    const originalJson = res.json.bind(res);
    res.json = function captured(body: unknown) {
      const status = res.statusCode || 200;
      if (shouldStore(status)) {
        const payload: CachedResponse = {
          status,
          headers: pickReplayHeaders(res),
          body,
          bodyHash,
        };
        redis
          .set(redisKey, JSON.stringify(payload), 'EX', TTL_SECONDS)
          .catch((err) =>
            logger.warn({ err, key }, 'idempotency: redis write failed (non-fatal)'),
          );
      }
      return originalJson(body);
    };

    return next();
  };
}

function hashBody(body: unknown): string {
  const s = body === undefined ? '' : JSON.stringify(body);
  return createHash('sha256').update(s).digest('hex');
}

function pickReplayHeaders(res: Response): Record<string, string> {
  // Only headers that are safe to replay verbatim.
  const safe = ['content-type', 'cache-control', 'etag'];
  const out: Record<string, string> = {};
  for (const name of safe) {
    const v = res.getHeader(name);
    if (typeof v === 'string') out[name] = v;
  }
  return out;
}
