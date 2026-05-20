// Wallet-integrity worker — daily ledger-vs-cache reconciliation.
//
// Spec: AGENCY_WALLET_SYSTEM §10, "Daily integrity-check cron that recomputes
// wallet and credit balances from `wallet_ledger` sums and compares to
// `wallets` document — alert on any drift > 0".
//
// Schedule: daily at 02:30 IST. Off-peak so the aggregation doesn't compete
// with booking-time wallet writes. We use the same cron-pattern + tz pair
// the TBO token-refresh worker uses for consistency with operational tooling
// (everything daily lives at 0X:XX IST).
//
// Lifecycle:
//   1. Pull a single batch via `runIntegrityCheck()` (handles aggregation,
//      cross-reference, audit, log).
//   2. Worker just orchestrates — all real logic lives in the service so it
//      can be re-used by an admin "check now" endpoint or a test.
//
// Concurrency: 1. Overlapping ticks would race on the per-wallet
// `lastReconciledAt` update + duplicate audit rows. The sweep is fast
// (a single aggregate + a small fan-out) so serial is fine.

import type { Job, Queue } from 'bullmq';
import { QUEUE_NAMES } from './index.js';
import { logger } from '../config/logger.js';
import { runIntegrityCheck } from '../services/wallet/integrity-check.service.js';

const CRON = '30 2 * * *'; // 02:30 IST daily
const TZ = 'Asia/Kolkata';

interface WalletIntegrityJob {
  triggeredBy: 'cron' | 'manual';
}

export async function walletIntegrityProcessor(job: Job<WalletIntegrityJob>): Promise<void> {
  const startedAt = Date.now();
  try {
    const report = await runIntegrityCheck();
    logger.info(
      {
        scanned: report.scannedAgencies,
        drifted: report.driftedAgencies,
        durationMs: Date.now() - startedAt,
        triggeredBy: job.data.triggeredBy,
      },
      'wallet-integrity: completed',
    );
  } catch (err) {
    // Re-throw so BullMQ records the failure + retries per worker options.
    // But shout in the log first so ops sees it even if the retry succeeds.
    logger.error({ err }, 'wallet-integrity: tick failed');
    throw err;
  }
}

/**
 * Arm the daily integrity-check schedule on the supplied queue. Idempotent:
 * removes any previously registered repeatable jobs on the queue first so a
 * config change to CRON/TZ doesn't leave a duplicate schedule running.
 */
export async function scheduleWalletIntegrity(queue: Queue): Promise<void> {
  // Strip any stale repeats. This handles deployment churn — e.g. someone
  // bumped CRON from 02:30 to 03:30; without this we'd end up with both
  // schedules armed until manual cleanup.
  const existing = await queue.getRepeatableJobs();
  await Promise.all(
    existing
      .filter((j) => j.id === 'cron:wallet-integrity')
      .map((j) => queue.removeRepeatableByKey(j.key)),
  );

  await queue.add(
    'integrity-tick',
    { triggeredBy: 'cron' },
    {
      repeat: { pattern: CRON, tz: TZ },
      jobId: 'cron:wallet-integrity',
      removeOnComplete: { count: 14 }, // ~2 weeks of history
      removeOnFail: { count: 50 },
    },
  );
  logger.info(
    { queue: QUEUE_NAMES.WALLET_INTEGRITY, cron: CRON, tz: TZ },
    'wallet-integrity: scheduler armed',
  );
}
