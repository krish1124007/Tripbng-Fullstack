// Cancel-poll worker — re-checks GetChangeRequestStatus until terminal.
//
// Re-enqueues itself with a fixed interval. Stops on Processed/Rejected
// (cancel.service flips the booking) or after MAX_ATTEMPTS attempts (the
// job stays Pending; ops investigates).

import type { Job } from 'bullmq';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { HotelCancellationJob } from '../models/HotelCancellationJob.js';
import { pollCancelStatus } from '../services/tbo/cancel.service.js';
import { getTboCancelPollQueue } from './index.js';

interface CancelPollJob {
  jobId: string;
}

export async function tboCancelPollProcessor(job: Job<CancelPollJob>): Promise<void> {
  const { jobId } = job.data;
  const dbJob = await HotelCancellationJob.findById(jobId).select('completedAt pollAttempts').lean();
  if (!dbJob) {
    logger.warn({ jobId }, 'tbo.cancel-poll: job not found');
    return;
  }
  if (dbJob.completedAt) return;
  if ((dbJob.pollAttempts ?? 0) >= env.TBO_CANCEL_POLL_MAX_ATTEMPTS) {
    logger.error({ jobId }, 'tbo.cancel-poll: max attempts exceeded — leaving Pending for ops');
    return;
  }

  const result = await pollCancelStatus(jobId);
  if (!result.done) {
    await getTboCancelPollQueue().add(
      'poll-cancel',
      { jobId },
      { delay: env.TBO_CANCEL_POLL_INTERVAL_MS },
    );
  }
}
