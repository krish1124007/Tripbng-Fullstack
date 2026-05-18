// TBO Auth service — token lifecycle.
//
// Contract:
//   getToken()       — returns a valid token. Reads from Redis; on miss,
//                      authenticates with TBO, caches, returns.
//   forceRefresh()   — bypasses cache. Called when a method returns
//                      Status=4 (InValidSession) and we want to retry once.
//   logout(token)    — invalidates a token at TBO. Used on shutdown / when
//                      rotating creds. Best-effort; swallows transport errors
//                      because a stale-but-not-yet-rotated token isn't a
//                      correctness problem.
//
// Concurrency: getToken() uses a Redis SETNX lock to prevent the
// thundering-herd problem where 100 simultaneous Search calls each issue
// their own Authenticate. The lock-holder authenticates and writes the cache;
// losers spin briefly waiting for the cache.
//
// Audit: every Authenticate/Logout call writes a TboAuditLog row via the
// HTTP client's interceptor. Don't log the token in app-level logs — the
// audit table is the only place it lives.

import { redis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { callTbo } from '../../adapters/tbo/client.js';
import { TboError, statusToErrorCode } from '../../adapters/tbo/errors.js';
import { TBO_STATUS } from '../../adapters/tbo/types/auth.js';
import type {
  TboAuthenticateRequest,
  TboAuthenticateResponse,
  TboLogoutRequest,
  TboLogoutResponse,
} from '../../adapters/tbo/types/auth.js';
import { secondsUntilNextMidnightIST } from './time.js';

const LOCK_KEY = 'tbo:token:lock';
const LOCK_TTL_SEC = 30;
const LOCK_POLL_MS = 200;
const LOCK_MAX_WAIT_MS = 15_000;

class TboAuthService {
  /**
   * Get a valid token. Returns the cached value when present; otherwise
   * acquires a Redis lock, authenticates, caches, returns.
   */
  async getToken(): Promise<string> {
    const cached = await redis.get(env.TBO_TOKEN_CACHE_KEY).catch(() => null);
    if (cached) return cached;

    return this.refreshUnderLock();
  }

  /**
   * Force a re-authentication, bypassing the cache. Used by callers that
   * received Status=4 (InValidSession) and want to retry the original call.
   *
   * Always takes the lock — if two requests both see InValidSession on the
   * same stale token, only one Authenticate fires.
   */
  async forceRefresh(): Promise<string> {
    return this.refreshUnderLock(true);
  }

  /**
   * Log a token out at TBO. Best-effort — swallow transport failures since
   * an un-logged-out token expires at midnight IST anyway.
   */
  async logout(token: string): Promise<void> {
    if (!env.TBO_ENABLED) return;
    if (!env.TBO_END_USER_IP) {
      logger.warn('tbo.logout: TBO_END_USER_IP unset, skipping');
      return;
    }
    const body: TboLogoutRequest = {
      ClientId: env.TBO_CLIENT_ID,
      TokenId: token,
      EndUserIp: env.TBO_END_USER_IP,
    };
    try {
      await callTbo<TboLogoutResponse>({
        method: 'Logout',
        host: 'shared',
        path: '/Logout',
        body: body as unknown as Record<string, unknown>,
      });
    } catch (err) {
      logger.warn({ err }, 'tbo.logout: best-effort failure (token will expire at midnight IST)');
    }
  }

  // ────────── internals ──────────

  private async refreshUnderLock(force = false): Promise<string> {
    if (!force) {
      const cached = await redis.get(env.TBO_TOKEN_CACHE_KEY).catch(() => null);
      if (cached) return cached;
    }

    // Acquire lock — `set NX EX` is atomic. If we lose the race, spin until
    // either the cache is populated or the lock-holder times out.
    const lockId = `${process.pid}:${Date.now()}`;
    const acquired = await redis
      .set(LOCK_KEY, lockId, 'EX', LOCK_TTL_SEC, 'NX')
      .catch(() => null);

    if (!acquired) {
      // Another worker is authenticating. Spin on the cache.
      const start = Date.now();
      while (Date.now() - start < LOCK_MAX_WAIT_MS) {
        await sleep(LOCK_POLL_MS);
        const cached = await redis.get(env.TBO_TOKEN_CACHE_KEY).catch(() => null);
        if (cached) return cached;
      }
      throw new TboError('TBO_TRANSPORT', 'tbo: timed out waiting for sibling auth', {
        method: 'Authenticate',
        retryable: true,
      });
    }

    try {
      const token = await this.authenticate();
      const ttl = Math.max(60, secondsUntilNextMidnightIST() - env.TBO_TOKEN_TTL_BUFFER_SEC);
      await redis.set(env.TBO_TOKEN_CACHE_KEY, token, 'EX', ttl);
      return token;
    } finally {
      // Best-effort lock release. If we crashed mid-auth the LOCK_TTL_SEC
      // expiry will free it.
      const current = await redis.get(LOCK_KEY).catch(() => null);
      if (current === lockId) await redis.del(LOCK_KEY).catch(() => undefined);
    }
  }

  /**
   * Raw Authenticate call — no caching, no locking. Only callable from
   * `refreshUnderLock`. Returns the token; throws TboError on any failure.
   */
  private async authenticate(): Promise<string> {
    if (!env.TBO_USERNAME || !env.TBO_PASSWORD) {
      throw new TboError('TBO_NOT_CONFIGURED', 'TBO_USERNAME / TBO_PASSWORD not set', {
        method: 'Authenticate',
        retryable: false,
      });
    }
    if (!env.TBO_END_USER_IP) {
      throw new TboError('TBO_NOT_CONFIGURED', 'TBO_END_USER_IP not set', {
        method: 'Authenticate',
        retryable: false,
      });
    }

    const body: TboAuthenticateRequest = {
      ClientId: env.TBO_CLIENT_ID,
      UserName: env.TBO_USERNAME,
      Password: env.TBO_PASSWORD,
      EndUserIp: env.TBO_END_USER_IP,
    };

    const res = await callTbo<TboAuthenticateResponse>({
      method: 'Authenticate',
      host: 'shared',
      path: '/Authenticate',
      body: body as unknown as Record<string, unknown>,
    });

    if (res.Status !== TBO_STATUS.SUCCESSFUL || !res.TokenId) {
      const code = res.Status ? statusToErrorCode(res.Status) : 'TBO_UNKNOWN';
      throw new TboError(code ?? 'TBO_UNKNOWN', res.Error?.ErrorMessage ?? 'authenticate failed', {
        method: 'Authenticate',
        tboStatus: res.Status,
        tboErrorCode: res.Error?.ErrorCode,
        tboMessage: res.Error?.ErrorMessage,
        retryable: false,
      });
    }

    logger.info(
      { agencyId: res.Member?.AgencyId ?? res.AgencyId, currency: res.Member?.Currency },
      'tbo.authenticate: success',
    );
    return res.TokenId;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Singleton — used by every TBO service. */
export const tboAuthService = new TboAuthService();
