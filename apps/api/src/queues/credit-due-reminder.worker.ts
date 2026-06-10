// Credit-due reminder worker — daily morning cron.
//
// Schedule: 07:00 IST daily. Picked so:
//   * Anchor-day reminders fire at a humane hour for the recipient.
//   * Sits well after the daily wallet-integrity check (02:30) and after
//     the hourly credit-block recompute has had its 01:05 + 02:05 + 03:05
//     ticks to settle the bookingBlocked state for newly-expired credit.
//
// Per-anchor dedupe lives in the service's Redis SETNX — re-runs within
// 24 h are safe.

import type { Job, Queue } from 'bullmq';
import { QUEUE_NAMES } from './index.js';
import { logger } from '../config/logger.js';
import { runCreditDueReminders } from '../services/wallet/credit-due-reminder.service.js';

const CRON = '0 7 * * *'; // 07:00 IST daily
const TZ = 'Asia/Kolkata';

interface CreditDueReminderJob {
  triggeredBy: 'cron' | 'manual';
}

export async function creditDueReminderProcessor(
  job: Job<CreditDueReminderJob>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const report = await runCreditDueReminders();
    logger.info(
      {
        scanned: report.scannedAgencies,
        fired: report.firedReminders,
        skippedDeduped: report.skippedDeduped,
        durationMs: Date.now() - startedAt,
        triggeredBy: job.data.triggeredBy,
      },
      'credit-due-reminder: completed',
    );
  } catch (err) {
    logger.error({ err }, 'credit-due-reminder: tick failed');
    throw err;
  }
}

export async function scheduleCreditDueReminder(queue: Queue): Promise<void> {
  const existing = await queue.getRepeatableJobs();
  await Promise.all(
    existing
      .filter((j) => j.id === 'cron:credit-due-reminder')
      .map((j) => queue.removeRepeatableByKey(j.key)),
  );
  await queue.add(
    'reminder-tick',
    { triggeredBy: 'cron' },
    {
      repeat: { pattern: CRON, tz: TZ },
      jobId: 'cron:credit-due-reminder',
      removeOnComplete: { count: 30 }, // ~1 month of history
      removeOnFail: { count: 50 },
    },
  );
  logger.info(
    { queue: QUEUE_NAMES.CREDIT_DUE_REMINDER, cron: CRON, tz: TZ },
    'credit-due-reminder: scheduler armed',
  );
}
