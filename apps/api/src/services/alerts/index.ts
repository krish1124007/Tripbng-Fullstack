// alertService — public facade. Service code calls this; everything else is
// internal plumbing (templates, channels, resolver, dispatcher, worker).
//
// Two paths:
//   1. enqueueAlert(payload, recipients, opts) — preferred, returns immediately
//      after pushing to the BullMQ queue. The worker handles SMTP/WA/in-app.
//   2. sendAlertSync(payload, recipients, opts) — bypasses the queue, dispatches
//      inline. Use ONLY for cases where the queue isn't running yet (tests,
//      ad-hoc scripts) or where the alert MUST go out before the request
//      completes (rare — e.g. password-reset OTP where we need the messageId).

import { Queue } from 'bullmq';
import { bullmqRedis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { alertDispatchProcessor, type AlertJobData } from '../../queues/alert-dispatch.worker.js';
import type { AlertChannel, AlertPayload, RecipientRef } from './types.js';

export const ALERT_DISPATCH_QUEUE = 'alert-dispatch' as const;

let queue: Queue | null = null;
function getQueue(): Queue {
  if (!queue) queue = new Queue(ALERT_DISPATCH_QUEUE, { connection: bullmqRedis });
  return queue;
}

interface EnqueueOpts {
  /** Override the default channel set for this event. */
  channels?: AlertChannel[] | null;
  /** Multi-tenant scope — required for in-app delivery. */
  tenantId: string;
  /** Free-form correlation key for log grouping (e.g. `booking:TR-1234`). */
  correlationKey?: string;
  /** Delay (ms) before processing — used by hold-expiry warnings. */
  delayMs?: number;
}

/**
 * Push an alert into the dispatch queue. Returns the BullMQ job id.
 *
 * Falls back to inline dispatch if the queue is unreachable (Redis down) so
 * an alert is still sent on a best-effort basis.
 */
export async function enqueueAlert(
  payload: AlertPayload,
  recipients: RecipientRef[],
  opts: EnqueueOpts,
): Promise<string | null> {
  const data: AlertJobData = {
    event: payload.event,
    vars: payload.vars,
    recipients,
    channels: opts.channels ?? null,
    tenantId: opts.tenantId,
    correlationKey: opts.correlationKey,
  };

  try {
    const job = await getQueue().add('dispatch', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
      delay: opts.delayMs,
    });
    return job.id ?? null;
  } catch (err) {
    logger.warn(
      { err, event: payload.event, correlationKey: opts.correlationKey },
      'alert enqueue failed — falling back to inline dispatch',
    );
    // Inline fallback. Wrapped in catch to never throw out of the alert path.
    void sendAlertSync(payload, recipients, opts).catch((sendErr) => {
      logger.error(
        { err: sendErr, event: payload.event, correlationKey: opts.correlationKey },
        'alert inline-dispatch fallback also failed',
      );
    });
    return null;
  }
}

/**
 * Inline dispatch — same code path the worker runs, but synchronous. Useful
 * in tests and for cases where the queue isn't running.
 */
export async function sendAlertSync(
  payload: AlertPayload,
  recipients: RecipientRef[],
  opts: EnqueueOpts,
): Promise<void> {
  const data: AlertJobData = {
    event: payload.event,
    vars: payload.vars,
    recipients,
    channels: opts.channels ?? null,
    tenantId: opts.tenantId,
    correlationKey: opts.correlationKey,
  };
  // The processor expects a BullMQ Job — we synthesize the minimum shape.
  await alertDispatchProcessor({ data } as Parameters<typeof alertDispatchProcessor>[0]);
}

/** For graceful shutdown. */
export async function closeAlertQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
