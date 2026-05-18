// Operator-cancellation poller for SeatSeller bus bookings.
//
// Daily at 06:00 IST (CLAUDE.md §2 / §8.4):
//   1. Pull SeatSeller's busCancellationInfo for [today-2d, today+30d]
//   2. For every tin in the response:
//        - find local BusBooking
//        - skip CANCELLED / OPERATOR_CANCELLED rows (idempotency)
//        - else: dispatch processOperatorCancellation(tin) — credits
//          the wallet, persists a BusCancellation row, transitions
//          BusBooking → OPERATOR_CANCELLED
//   3. Log a summary
//
// 2-day backwards window covers operators who cancel late on the
// previous day's SOD — ours might lag SeatSeller's reporting by a few
// hours.
//
// 30-day forward window matches the maximum-advance booking ceiling.
// Anything cancelled further out hasn't been booked yet.

import type { Job, Queue } from 'bullmq';
import { logger } from '../config/logger.js';
import { getSeatSellerClient } from '../adapters/seatseller/factory.js';
import { processOperatorCancellation } from '../services/bus/cancellation.service.js';
import { dateToIstYyyyMmDd } from '../adapters/seatseller/utils/time.js';

interface OperatorCancelJob {
  triggeredBy: 'cron' | 'manual';
}

export async function busOperatorCancellationProcessor(
  job: Job<OperatorCancelJob>,
): Promise<void> {
  const client = getSeatSellerClient();
  if (!client) {
    logger.info(
      { triggeredBy: job.data.triggeredBy },
      'bus.operator-cancel: SeatSeller disabled — skipping',
    );
    return;
  }

  const startedAt = Date.now();
  const today = new Date();
  const fromDate = new Date(today.getTime() - 2 * 24 * 60 * 60_000);
  const toDate = new Date(today.getTime() + 30 * 24 * 60 * 60_000);

  let listed: { tin: string }[] = [];
  try {
    listed = await client.busCancellationInfo({
      from: dateToIstYyyyMmDd(fromDate),
      to: dateToIstYyyyMmDd(toDate),
    });
  } catch (err) {
    logger.error(
      { err, triggeredBy: job.data.triggeredBy },
      'bus.operator-cancel: busCancellationInfo failed — will retry tomorrow',
    );
    return;
  }

  let processed = 0;
  let skippedNotFound = 0;
  let skippedAlreadyCancelled = 0;
  let processedRefundPaise = 0;
  let errored = 0;

  for (const row of listed) {
    try {
      const result = await processOperatorCancellation(row.tin);
      switch (result.skipped) {
        case 'not-found':
          skippedNotFound++;
          break;
        case 'already-cancelled':
          skippedAlreadyCancelled++;
          break;
        case undefined:
          processed++;
          processedRefundPaise += result.refundPaise;
          break;
        default:
          // operator-disabled / pre-tin — count as skipped silently.
          break;
      }
    } catch (err) {
      errored++;
      // Log but keep iterating — one bad tin shouldn't stop the rest.
      logger.error(
        { err, tin: row.tin },
        'bus.operator-cancel: processOperatorCancellation threw',
      );
    }
  }

  logger.info(
    {
      ms: Date.now() - startedAt,
      total: listed.length,
      processed,
      skippedNotFound,
      skippedAlreadyCancelled,
      errored,
      processedRefundPaise,
      triggeredBy: job.data.triggeredBy,
    },
    'bus.operator-cancel: tick done',
  );
}

/** Daily 06:00 IST = 00:30 UTC. */
export async function scheduleBusOperatorCancellationPoller(queue: Queue): Promise<void> {
  await queue.add(
    'sweep-operator-cancellations',
    { triggeredBy: 'cron' },
    {
      repeat: { pattern: '30 0 * * *' }, // 00:30 UTC = 06:00 IST
      jobId: 'cron:bus-operator-cancellation-poller',
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );
}
