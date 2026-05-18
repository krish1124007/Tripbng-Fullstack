import type { Job } from 'bullmq';
import { Booking } from '../models/Booking.js';
import { Inventory } from '../models/Inventory.js';
import { logger } from '../config/logger.js';
import { getHoldExpiryQueue, QUEUE_NAMES } from './index.js';

const SWEEP_JOB_NAME = 'sweep-stale-holds';
const REPEAT_EVERY_MS = 60 * 1000; // every minute

// scheduleHoldExpirySweep — registers the recurring sweep job (idempotent: removes any prior
// scheduler with the same key first, so re-deploys don't pile up duplicates).
export async function scheduleHoldExpirySweep(): Promise<void> {
  const queue = getHoldExpiryQueue();
  // Remove any existing repeatable jobs with the same key before re-adding.
  const existing = await queue.getRepeatableJobs();
  await Promise.all(
    existing
      .filter((j) => j.name === SWEEP_JOB_NAME)
      .map((j) => queue.removeRepeatableByKey(j.key)),
  );
  await queue.add(
    SWEEP_JOB_NAME,
    {},
    {
      repeat: { every: REPEAT_EVERY_MS },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
  logger.info(
    { queue: QUEUE_NAMES.HOLD_EXPIRY, every: REPEAT_EVERY_MS },
    'hold-expiry sweep scheduled',
  );
}

// holdExpiryProcessor — finds bookings that are still HOLD past their expiresAt and
// transitions them to EXPIRED, releasing seats back to the inventory atomically.
//
// Why not a simple TTL index on Mongo? Two reasons:
// 1. We need side effects (release seats, write audit) that TTL deletion can't do.
// 2. We want EXPIRED rows to remain in the DB for analytics, just transitioned.
export async function holdExpiryProcessor(
  _job: Job,
): Promise<{ released: number; expired: number }> {
  const now = new Date();
  // Find candidates first; we update one at a time so seat releases stay accurate per booking.
  const stale = await Booking.find({
    status: 'HOLD',
    expiresAt: { $lt: now },
  })
    .select('_id seatsConsumed inventoryId bookingCode')
    .limit(100);

  let released = 0;
  for (const b of stale) {
    const updated = await Booking.findOneAndUpdate(
      { _id: b._id, status: 'HOLD' },
      { $set: { status: 'EXPIRED' } },
      { new: true },
    );
    if (!updated) continue; // Lost a race — somebody confirmed/cancelled in between.
    if (b.inventoryId && b.seatsConsumed > 0) {
      await Inventory.updateOne(
        { _id: b.inventoryId },
        { $inc: { seatsRemaining: b.seatsConsumed } },
      );
      released += b.seatsConsumed;
    }
    logger.info(
      { bookingId: String(b._id), bookingCode: b.bookingCode, releasedSeats: b.seatsConsumed },
      'expired stale hold',
    );
  }

  return { released, expired: stale.length };
}
