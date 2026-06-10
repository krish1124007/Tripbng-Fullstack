// Manual-issuance follow-up worker — every-4h cron sweep.
//
// Picks up bookings parked in PENDING_MANUAL beyond the tier thresholds
// (see services/booking/manual-issuance-followup.service.ts) and fires
// escalating ops reminders so a wallet-debited booking never silently
// stagnates without a PNR.
//
// Schedule: every 4 hours, starting at 02:00 IST. Synced 2 hours after the
// daily TBO token refresh (00:01 IST) and the wallet-integrity check
// (02:30 IST) so any token / integrity issue surfaces in logs before the
// follow-up sweep would page ops about it.
//
// Per-(bookingId, tier) dedupe lives in the service's Redis SETNX with
// tier-sized TTL — re-runs within a tier window are no-ops.

import type { Job, Queue } from 'bullmq';
import { QUEUE_NAMES } from './index.js';
import { logger } from '../config/logger.js';
import { runManualIssuanceFollowup } from '../services/booking/manual-issuance-followup.service.js';

const CRON = '0 2,6,10,14,18,22 * * *'; // every 4 hours on the IST clock
const TZ = 'Asia/Kolkata';

interface ManualIssuanceFollowupJob {
  triggeredBy: 'cron' | 'manual';
}

export async function manualIssuanceFollowupProcessor(
  job: Job<ManualIssuanceFollowupJob>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const report = await runManualIssuanceFollowup();
    logger.info(
      {
        scanned: report.scannedBookings,
        fired: report.firedReminders,
        skippedDeduped: report.skippedDeduped,
        skippedTooFresh: report.skippedTooFresh,
        durationMs: Date.now() - startedAt,
        triggeredBy: job.data.triggeredBy,
      },
      'manual-issuance-followup: completed',
    );
  } catch (err) {
    logger.error({ err }, 'manual-issuance-followup: tick failed');
    throw err;
  }
}

export async function scheduleManualIssuanceFollowup(queue: Queue): Promise<void> {
  const existing = await queue.getRepeatableJobs();
  await Promise.all(
    existing
      .filter((j) => j.id === 'cron:manual-issuance-followup')
      .map((j) => queue.removeRepeatableByKey(j.key)),
  );
  await queue.add(
    'followup-tick',
    { triggeredBy: 'cron' },
    {
      repeat: { pattern: CRON, tz: TZ },
      jobId: 'cron:manual-issuance-followup',
      removeOnComplete: { count: 50 }, // ~8 days of history at 6/day
      removeOnFail: { count: 100 },
    },
  );
  logger.info(
    { queue: QUEUE_NAMES.MANUAL_ISSUANCE_FOLLOWUP, cron: CRON, tz: TZ },
    'manual-issuance-followup: scheduler armed',
  );
}
