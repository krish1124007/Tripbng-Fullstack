// Daily TBO token refresh — fires at 00:01 IST every day.
//
// Why a cron + an on-demand cache: most calls hit the cache, so the cron
// isn't strictly necessary. But it's worth doing anyway — the cron warms
// the cache before the morning traffic spike, so the first booking of the
// day doesn't pay the auth round-trip latency. Also: if the cache happens
// to lose its key (Redis restart, key eviction), the cron is the safety net.
//
// The cron is idempotent: forceRefresh re-authenticates whether or not the
// cache is populated, so duplicate scheduler runs (e.g. after a redeploy)
// don't break anything.

import type { Job } from 'bullmq';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { tboAuthService } from '../services/tbo/auth.service.js';
import { getTboTokenRefreshQueue, QUEUE_NAMES } from './index.js';

const REFRESH_JOB_NAME = 'tbo-daily-token-refresh';
/** 00:01 IST — gives the previous-day token a 1 minute grace before
 *  TBO's midnight invalidation. */
const REFRESH_CRON = '1 0 * * *';
const REFRESH_TZ = 'Asia/Kolkata';

/**
 * Register the recurring scheduler. Idempotent: removes any prior repeatable
 * job with the same name before re-adding so re-deploys don't pile up
 * duplicates.
 */
export async function scheduleTboTokenRefresh(): Promise<void> {
  if (!env.TBO_ENABLED) {
    logger.info('tbo: integration disabled, skipping token-refresh scheduler');
    return;
  }
  const queue = getTboTokenRefreshQueue();
  const existing = await queue.getRepeatableJobs();
  await Promise.all(
    existing
      .filter((j) => j.name === REFRESH_JOB_NAME)
      .map((j) => queue.removeRepeatableByKey(j.key)),
  );
  await queue.add(
    REFRESH_JOB_NAME,
    {},
    {
      repeat: { pattern: REFRESH_CRON, tz: REFRESH_TZ },
      removeOnComplete: 30,
      removeOnFail: 100,
    },
  );
  logger.info(
    { queue: QUEUE_NAMES.TBO_TOKEN_REFRESH, cron: REFRESH_CRON, tz: REFRESH_TZ },
    'tbo: token-refresh scheduler armed',
  );
}

/**
 * Worker body — fetches a fresh token via forceRefresh(), which writes
 * straight to the cache. We don't need the return value here; the next
 * Search/PreBook will read it.
 */
export async function tboTokenRefreshProcessor(_job: Job): Promise<{ refreshed: boolean }> {
  if (!env.TBO_ENABLED) {
    return { refreshed: false };
  }
  await tboAuthService.forceRefresh();
  logger.info('tbo: daily token refresh complete');
  return { refreshed: true };
}
