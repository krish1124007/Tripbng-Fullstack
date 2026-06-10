import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

// Prefix for the request-signature search cache (route + class + pax + agency).
// A hit here short-circuits the whole fan-out, so it MUST be dropped whenever
// supplier visibility changes — otherwise a search run while a supplier was OFF
// keeps being served after the supplier is turned back ON (up to the 5-min TTL),
// which looks like "re-enabling the supplier did nothing".
export const SEARCH_REQ_PREFIX = 'search:req:';

/**
 * Invalidate cached flight-search responses so the next search re-runs the
 * fan-out instead of replaying a stale, pre-change result set.
 *
 * Scoped by tenant when `tenantId` is given (the common case — a supplier
 * toggle only affects that tenant); pass nothing to flush every tenant.
 * Uses SCAN (not KEYS) so it stays non-blocking on large keyspaces.
 * Best-effort: a Redis hiccup is logged, never thrown — cache invalidation
 * must not break the admin action that triggered it.
 */
export async function invalidateSearchCache(tenantId?: string): Promise<number> {
  const match = tenantId ? `${SEARCH_REQ_PREFIX}${tenantId}:*` : `${SEARCH_REQ_PREFIX}*`;
  let cursor = '0';
  let removed = 0;
  try {
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', match, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) removed += await redis.del(...keys);
    } while (cursor !== '0');
    if (removed > 0) logger.info({ removed, tenantId: tenantId ?? 'ALL' }, 'search-cache invalidated');
  } catch (err) {
    logger.warn({ err, tenantId }, 'search-cache: invalidation failed');
  }
  return removed;
}
