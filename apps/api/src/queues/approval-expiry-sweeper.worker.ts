// Approval-expiry sweeper.
//
// Runs every minute. Marks pending ApprovalRequests where expiresAt <
// now as `expired`. The state machine ensures terminal states (rejected
// / approved / booked / expired) never get caught by the sweep.
//
// Single-tenant-agnostic: the sweep is a global Mongo updateMany. Audit
// rows aren't written per-doc by this sweeper — the modifiedCount log
// is the trail. Adding per-doc audit would 100x the write load on a
// busy tenant for no real benefit (the request transitions are
// otherwise visible via the resource's updatedAt + status).

import type { Job, Queue } from 'bullmq';
import { logger } from '../config/logger.js';
import { sweepExpiredApprovals } from '../services/approval/approval.service.js';

interface ApprovalExpirySweepJob {
  triggeredBy: 'cron' | 'manual';
}

export async function approvalExpirySweeperProcessor(
  job: Job<ApprovalExpirySweepJob>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const expired = await sweepExpiredApprovals();
    logger.info(
      { expired, ms: Date.now() - startedAt, triggeredBy: job.data.triggeredBy },
      'approval-expiry-sweeper: tick done',
    );
  } catch (err) {
    logger.error(
      { err, triggeredBy: job.data.triggeredBy },
      'approval-expiry-sweeper: failed — will retry next tick',
    );
  }
}

/** Schedule the recurring cron — every minute. */
export async function scheduleApprovalExpirySweeper(queue: Queue): Promise<void> {
  await queue.add(
    'sweep-expired-approvals',
    { triggeredBy: 'cron' },
    {
      repeat: { every: 60_000 },
      jobId: 'cron:approval-expiry-sweeper',
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );
}
