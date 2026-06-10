// Credit-block recompute worker — hourly cron, spec §3.6.
//
// Re-evaluates the three credit guards (limit / expiry / due-date) for every
// CREDIT-module agency and flips `Agency.bookingBlocked` accordingly. The
// guards also fire transactionally inside `debitForBooking`, so this cron is
// the safety net that catches:
//
//   * Time-based crossings (expiry hits midnight, due-date crosses) when no
//     booking attempt has happened to trigger inline evaluation.
//   * Operator-side cleanups (admin paid down outstanding manually) — the
//     cron picks up the unblock.
//
// Schedule: hourly at :05 IST so it doesn't collide with the daily integrity
// check (02:30) or the TBO token-refresh (00:01). The cadence matches spec
// §6.1 expectations.

import type { Job, Queue } from 'bullmq';
import { QUEUE_NAMES } from './index.js';
import { logger } from '../config/logger.js';
import { recomputeCreditBlocks } from '../services/wallet/credit-block.service.js';

const CRON = '5 * * * *'; // every hour at :05
const TZ = 'Asia/Kolkata';

interface CreditBlockRecomputeJob {
  triggeredBy: 'cron' | 'manual';
}

export async function creditBlockRecomputeProcessor(
  job: Job<CreditBlockRecomputeJob>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const report = await recomputeCreditBlocks();
    logger.info(
      {
        scanned: report.scannedAgencies,
        newlyBlocked: report.newlyBlocked,
        newlyUnblocked: report.newlyUnblocked,
        reasonChanged: report.reasonChanged,
        durationMs: Date.now() - startedAt,
        triggeredBy: job.data.triggeredBy,
      },
      'credit-block: tick done',
    );
  } catch (err) {
    logger.error({ err }, 'credit-block: tick failed');
    throw err;
  }
}

/**
 * Arm the hourly schedule. Idempotent: removes any stale repeatable jobs
 * with the same jobId before adding the current schedule. Pattern-change
 * deploys won't leave duplicate schedules running.
 */
export async function scheduleCreditBlockRecompute(queue: Queue): Promise<void> {
  const existing = await queue.getRepeatableJobs();
  await Promise.all(
    existing
      .filter((j) => j.id === 'cron:credit-block-recompute')
      .map((j) => queue.removeRepeatableByKey(j.key)),
  );
  await queue.add(
    'recompute-tick',
    { triggeredBy: 'cron' },
    {
      repeat: { pattern: CRON, tz: TZ },
      jobId: 'cron:credit-block-recompute',
      removeOnComplete: { count: 96 }, // ~4 days of history
      removeOnFail: { count: 50 },
    },
  );
  logger.info(
    { queue: QUEUE_NAMES.CREDIT_BLOCK_RECOMPUTE, cron: CRON, tz: TZ },
    'credit-block: scheduler armed',
  );
}
