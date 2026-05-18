// SeatSeller client factory.
//
// The booking service depends on ISeatSellerClient — never on either
// concrete class. This factory is the ONE place real vs. mock is chosen,
// and the indirection enforces the dev-mock-mandatory rule (CLAUDE.md
// §0 Law 3).
//
// Lifecycle: lazy singleton. First call constructs the client; subsequent
// calls reuse it. There's no per-tenant state to manage — the OAuth
// token is cached in Redis and shared across the platform (it's our
// partner credential, not the tenant's).

import { env, isProd } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { ISeatSellerClient } from './client.interface.js';
import { SeatSellerClient } from './client.js';
import { MockSeatSellerClient } from './mock-client.js';

let singleton: ISeatSellerClient | null | undefined;

/**
 * Returns the SeatSeller client appropriate for the current environment.
 * Returns null when SEATSELLER_ENABLED=false — caller treats this the
 * same as "supplier disabled" (skip bus search, return empty list).
 *
 * Throws on boot in production-like envs if mock is enabled — we never
 * want to deploy a release that thinks it's hitting SeatSeller but is
 * actually serving fixtures.
 */
export function getSeatSellerClient(): ISeatSellerClient | null {
  if (singleton !== undefined) return singleton;

  if (!env.SEATSELLER_ENABLED) {
    singleton = null;
    return null;
  }

  if (env.SEATSELLER_USE_MOCK) {
    if (isProd) {
      // Hard fail. The runner is misconfigured if this ever fires —
      // shipping mock bookings to a paying tenant would be catastrophic.
      throw new Error(
        'SEATSELLER_USE_MOCK=true is not allowed in production. ' +
          'Set SEATSELLER_USE_MOCK=false and supply real OAuth credentials.',
      );
    }
    logger.info('seatseller: using MockSeatSellerClient (dev/test)');
    singleton = new MockSeatSellerClient();
    return singleton;
  }

  // Real client — credentials must all be present.
  const missing: string[] = [];
  if (!env.SEATSELLER_OAUTH_KEY) missing.push('SEATSELLER_OAUTH_KEY');
  if (!env.SEATSELLER_OAUTH_SECRET) missing.push('SEATSELLER_OAUTH_SECRET');
  if (!env.SEATSELLER_TOKEN_URL) missing.push('SEATSELLER_TOKEN_URL');
  if (missing.length > 0) {
    logger.warn(
      { missing },
      'seatseller: SEATSELLER_ENABLED=true but credentials missing — bus disabled',
    );
    singleton = null;
    return null;
  }

  logger.info({ baseUrl: env.SEATSELLER_BASE_URL }, 'seatseller: using real SeatSellerClient');
  singleton = new SeatSellerClient({
    baseUrl: env.SEATSELLER_BASE_URL,
    oauthKey: env.SEATSELLER_OAUTH_KEY,
    oauthSecret: env.SEATSELLER_OAUTH_SECRET,
    tokenUrl: env.SEATSELLER_TOKEN_URL,
    requestTimeoutMs: env.SEATSELLER_REQUEST_TIMEOUT_MS,
    blockTimeoutMs: env.SEATSELLER_BLOCK_TIMEOUT_MS,
    oauthCacheKey: env.SEATSELLER_OAUTH_CACHE_KEY,
  });
  return singleton;
}

/**
 * Test hook: reset the singleton so a fresh mock can be installed
 * with new fail-injection state. NEVER call this from production code.
 */
export function _resetSeatSellerClientForTests(client?: ISeatSellerClient): void {
  singleton = client ?? undefined;
}
