// Payment reconciliation sweeper — 15-min cron.
//
// What this does:
//   PaymentTransactions occasionally get stuck in PENDING/PROCESSING — webhook
//   drops, browser-closes-before-return, network blips on the return URL.
//   `paymentService.sweepStalePayments()` polls the provider for any PT older
//   than 30 minutes and routes it through markSuccess / markFailed / markTimeout
//   based on the gateway's authoritative answer.
//
// Why a separate cron from wallet-monitor / wallet-integrity:
//   - wallet-monitor is alerting (low-balance push), not state-mutating.
//   - wallet-integrity is daily ledger-vs-cache audit, runs once at 02:30.
//   - Payment reconciliation needs to fire often enough that a customer-facing
//     stuck topup doesn't sit unresolved for hours. 15 minutes is the
//     sweet spot: webhook-drop recovery feels real-time-ish to ops, but
//     we're not hammering the provider with status checks on a noisy timer.
//
// Schedule: every 15 minutes. Same cadence the wallet-monitor uses (parallel
// engineering rhythm — easier to reason about a single "every 15min Mongo
// scan" envelope on the API box). Both crons hit cheap queries (indexed on
// status + initiatedAt for this one; tenantId + balance for the monitor).
//
// Concurrency: 1. The sweep itself is fast (≤100 PTs per tick by design)
// and overlapping ticks would risk double-calling markSuccess on the same
// PT before its state transitions. The service's own status-transition
// guard would catch this, but cleaner to just serialise.

import type { Job, Queue } from 'bullmq';
import { QUEUE_NAMES } from './index.js';
import { logger } from '../config/logger.js';
import { paymentService } from '../services/payment/payment.service.js';

const CRON = '*/15 * * * *'; // every 15 minutes
const TZ = 'Asia/Kolkata';

interface PaymentReconJob {
  triggeredBy: 'cron' | 'manual';
}

export async function paymentReconSweeperProcessor(
  job: Job<PaymentReconJob>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await paymentService.sweepStalePayments();
    logger.info(
      {
        resolved: result.resolved,
        stillPending: result.stillPending,
        durationMs: Date.now() - startedAt,
        triggeredBy: job.data.triggeredBy,
      },
      'payment-recon-sweeper: completed',
    );
  } catch (err) {
    // Re-throw so BullMQ records the failure + retries per worker options.
    // But shout in the log first so ops sees it even if the retry succeeds.
    logger.error({ err }, 'payment-recon-sweeper: tick failed');
    throw err;
  }
}

/**
 * Arm the 15-min recon-sweep schedule on the supplied queue. Idempotent:
 * removes any previously registered repeatable jobs on the queue first so a
 * config change to CRON/TZ doesn't leave a duplicate schedule running.
 */
export async function schedulePaymentReconSweeper(queue: Queue): Promise<void> {
  const existing = await queue.getRepeatableJobs();
  await Promise.all(
    existing
      .filter((j) => j.id === 'cron:payment-recon-sweeper')
      .map((j) => queue.removeRepeatableByKey(j.key)),
  );

  await queue.add(
    'recon-tick',
    { triggeredBy: 'cron' },
    {
      repeat: { pattern: CRON, tz: TZ },
      jobId: 'cron:payment-recon-sweeper',
      removeOnComplete: { count: 96 }, // ~24h of history (96 ticks/day)
      removeOnFail: { count: 100 },
    },
  );
  logger.info(
    { queue: QUEUE_NAMES.PAYMENT_RECON_SWEEPER, cron: CRON, tz: TZ },
    'payment-recon-sweeper: scheduler armed',
  );
}
