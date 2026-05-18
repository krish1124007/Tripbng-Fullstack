// Weekly city + alias sync from SeatSeller.
//
// Schedule: Sunday 03:00 IST (per CLAUDE.md §2 architecture diagram).
// We use BullMQ's repeat-every-N-ms cron pattern, mirroring the
// existing tbo-token-refresh + tbo-reference-sync workers.
//
// Behaviour:
//   - Pulls getCities + getAliases from SeatSeller (lazy-warmed when
//     SEATSELLER_USE_MOCK=true; the mock returns deterministic data).
//   - Writes both to Redis with TTL_CITIES_SEC. The cache-fill path
//     in search.service also writes these on lazy-fill, so the worker
//     is a freshness-keeper, not the only writer.
//   - Best-effort. Failures log + retry next week.

import type { Job, Queue } from 'bullmq';
import { logger } from '../config/logger.js';
import { getSeatSellerClient } from '../adapters/seatseller/factory.js';
import {
  setCachedAliases,
  setCachedCities,
} from '../services/bus/cache.service.js';

interface CitySyncJob {
  /** Bookkeeping only — used in logs. */
  triggeredBy: 'cron' | 'manual';
}

export async function seatsellerCitySyncProcessor(job: Job<CitySyncJob>): Promise<void> {
  const client = getSeatSellerClient();
  if (!client) {
    logger.info({ triggeredBy: job.data.triggeredBy }, 'seatseller.city-sync: SeatSeller disabled — skipping');
    return;
  }

  const startedAt = Date.now();
  try {
    const [cities, aliases] = await Promise.all([client.getCities(), client.getAliases()]);
    await Promise.all([setCachedCities(cities), setCachedAliases(aliases)]);
    logger.info(
      {
        cities: cities.length,
        aliases: aliases.length,
        ms: Date.now() - startedAt,
        triggeredBy: job.data.triggeredBy,
      },
      'seatseller.city-sync: ok',
    );
  } catch (err) {
    logger.error(
      { err, triggeredBy: job.data.triggeredBy, ms: Date.now() - startedAt },
      'seatseller.city-sync: failed — will retry next week',
    );
    // Don't rethrow — BullMQ would mark the cron job failed and retry
    // immediately; we'd rather wait for next week's slot than hammer
    // SeatSeller during an outage.
  }
}

/**
 * Schedule the recurring cron. Called from queues/index.ts at startup.
 * Cron string: every Sunday 03:00 IST = 21:30 UTC Saturday.
 */
export async function scheduleSeatsellerCitySync(queue: Queue): Promise<void> {
  await queue.add(
    'sync-cities',
    { triggeredBy: 'cron' },
    {
      repeat: { pattern: '30 21 * * 6' }, // 21:30 UTC Saturday = 03:00 IST Sunday
      jobId: 'cron:seatseller-city-sync',
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    },
  );
}
