// Master / catalog data fetched from ASEGO. These barely change (currencies,
// categories, plan master) so we cache aggressively in Redis to avoid
// hammering ASEGO on every quote render. The /reasons/{type} list is cached
// even longer — it's effectively static.
//
// Cache keys are namespaced under `asego:master:*` so an ops invalidation
// (POST /api/v1/insurance/cache/invalidate) can `DEL asego:master:*` cleanly.

import { redis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { getAsegoContext } from './asego.singleton.js';
import { AppError } from '@tripbng/shared';

interface AsegoCurrency {
  id: string;
  currency: string;
  code: string;
  symbol?: string;
}

interface AsegoCategory {
  id: string;
  name: string;
  description?: string;
}

interface AsegoMasterReason {
  id: string;
  reason: string;
}

/**
 * Generic cache-aside helper. On hit returns the cached JSON; on miss runs the
 * fetcher, writes the result to Redis with the given TTL, then returns it.
 * Cache failures (parse errors, network blips) are non-fatal — we always fall
 * back to a live fetch.
 */
async function getOrFetch<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    const raw = await redis.get(key);
    if (raw) return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn({ key, err }, 'asego cache read failed — falling back to live fetch');
  }
  const value = await fetcher();
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn({ key, err }, 'asego cache write failed — value still returned to caller');
  }
  return value;
}

function ttlMaster(): number {
  return parseInt(process.env.ASEGO_CACHE_TTL_MASTER ?? '86400', 10);
}
function ttlReasons(): number {
  return parseInt(process.env.ASEGO_CACHE_TTL_REASONS ?? '2592000', 10);
}

function ensureCtx() {
  const ctx = getAsegoContext();
  if (!ctx) {
    throw new AppError('SUPPLIER_UNAVAILABLE', { reason: 'ASEGO insurance not configured' });
  }
  return ctx;
}

/** GET /currency — list of supported pricing currencies. */
export async function listCurrencies(): Promise<AsegoCurrency[]> {
  const ctx = ensureCtx();
  return getOrFetch<AsegoCurrency[]>('asego:master:currency', ttlMaster(), async () => {
    return await ctx.client.get<AsegoCurrency[]>('/currency');
  });
}

/** GET /category — geography buckets used as `category` UUID in quote/issue. */
export async function listCategories(): Promise<AsegoCategory[]> {
  const ctx = ensureCtx();
  return getOrFetch<AsegoCategory[]>('asego:master:category', ttlMaster(), async () => {
    return await ctx.client.get<AsegoCategory[]>('/category');
  });
}

/**
 * GET /plan/masterDetails/{partnerId} — full plan master (insurer, planId,
 * sellingPlanId, riders, coverages). The frontend uses this to render the plan
 * library; the mapper uses it to look up rider values during issuance.
 */
export async function listPlanMaster(): Promise<unknown> {
  const ctx = ensureCtx();
  return getOrFetch<unknown>(
    `asego:master:plan:${ctx.identity.partnerId}`,
    ttlMaster(),
    async () => {
      return await ctx.client.get<unknown>(`/plan/masterDetails/${ctx.identity.partnerId}`);
    },
  );
}

/** GET /reasons/{type} — cancellation / endorsement reason picklist. */
export async function listReasons(type: string): Promise<AsegoMasterReason[]> {
  const ctx = ensureCtx();
  if (!type || !/^[a-z_]+$/i.test(type)) {
    throw new AppError('VALIDATION_ERROR', { reason: 'invalid reason type' });
  }
  return getOrFetch<AsegoMasterReason[]>(`asego:master:reasons:${type}`, ttlReasons(), async () => {
    return await ctx.client.get<AsegoMasterReason[]>(`/reasons/${encodeURIComponent(type)}`);
  });
}

/** Admin op — drop every master-data cache key so next reads go live. */
export async function invalidateMasterCache(): Promise<{ deleted: number }> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', 'asego:master:*', 'COUNT', 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  if (keys.length === 0) return { deleted: 0 };
  await redis.del(...keys);
  return { deleted: keys.length };
}
