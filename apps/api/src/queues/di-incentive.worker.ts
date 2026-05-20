// DI incentive worker — Phase-2 of spec §3.3 + §6.2.
//
// Drains the DI_INCENTIVE queue. Each job represents one source TOPUP that
// landed on a DI-module agency and needs the deposit-incentive flow run
// against it. The waterfall enqueues these synchronously inside its commit
// path; the worker applies them out-of-band so the gateway webhook can
// return 200 quickly and the slow incentive calc + ledger writes happen
// asynchronously.
//
// Concurrency: 5. The underlying ledger service already takes a per-agency
// Redis lock + Mongo transaction; multiple workers can drain jobs for
// DIFFERENT agencies in parallel without colliding. Two jobs for the SAME
// agency queue at the lock layer — well-defined ordering.
//
// Idempotency:
//   * `jobId` is deterministic on `incentive:<agencyId>:<parentLedgerId>` so
//     BullMQ refuses to add a duplicate while the original is still active.
//   * The service layer (`applyIncentive`) also checks for an existing
//     INCENTIVE_CREDIT row linked to the same parentLedgerId before
//     writing, so even a stale-from-removed-job replay is safe.
//
// Retry: BullMQ retries (3 attempts, exponential backoff) — typical
// failure modes are transient Mongo issues or the per-agency lock being
// held by a concurrent debit. Both clear quickly.

import type { Job, Queue } from 'bullmq';
import { logger } from '../config/logger.js';
import { applyIncentive } from '../services/wallet/di-incentive.service.js';

export interface DiIncentiveJob {
  tenantId: string;
  agencyId: string;
  depositPaise: number;
  parentLedgerId: string;
  pgReferenceId: string | null;
  performedBy: string;
  /** Diagnostic: which path enqueued this job. */
  source: 'waterfall' | 'manual' | 'replay';
}

export async function diIncentiveProcessor(job: Job<DiIncentiveJob>): Promise<void> {
  const data = job.data;
  try {
    const result = await applyIncentive({
      tenantId: data.tenantId,
      agencyId: data.agencyId,
      depositPaise: data.depositPaise,
      parentLedgerId: data.parentLedgerId,
      pgReferenceId: data.pgReferenceId,
      performedBy: data.performedBy,
    });

    if (!result.applied) {
      // Common no-op paths: agency switched module, no active config, gate
      // fired (below-min / zero / inactive), or another job already applied.
      // The service has already logged the reason — we just record the
      // outcome on the job itself so admin dashboards can see "ran, no-op".
      await job.updateProgress({ applied: false, skip: result.compute?.skip ?? 'NO_CONFIG' });
      return;
    }
    await job.updateProgress({
      applied: true,
      incentivePaise: result.compute?.incentivePaise ?? 0,
      tdsPaise: result.compute?.tdsPaise ?? 0,
      netCreditPaise: result.compute?.netCreditPaise ?? 0,
    });

    // TODO (Phase-2.1): enqueue INCENTIVE_CREDITED notification via
    // services/alerts/index.ts. The template isn't authored yet — once it
    // lands, swap this logger.info for an enqueueAlert call.
    logger.info(
      {
        agencyId: data.agencyId,
        parentLedgerId: data.parentLedgerId,
        netCreditPaise: result.compute?.netCreditPaise ?? 0,
      },
      'di-incentive: would notify INCENTIVE_CREDITED (template pending)',
    );
  } catch (err) {
    logger.error(
      { err, agencyId: data.agencyId, parentLedgerId: data.parentLedgerId, source: data.source },
      'di-incentive: job failed — BullMQ will retry per worker options',
    );
    throw err;
  }
}

/**
 * Enqueue an incentive-apply job. Used by the waterfall service after a
 * successful DI-module deposit commits. Caller passes the parent TOPUP
 * ledger id so the job key + the eventual relatedTxnId share an anchor.
 */
export async function enqueueDiIncentive(queue: Queue, data: DiIncentiveJob): Promise<void> {
  // Deterministic jobId — BullMQ rejects duplicate adds. Safer than relying
  // solely on service-layer idempotency in the event of webhook fan-out.
  const jobId = `incentive:${data.agencyId}:${data.parentLedgerId}`;
  await queue.add('apply-incentive', data, {
    jobId,
    // 3 attempts with 30s/60s backoff. Most failures (lock contention,
    // mongo blip) clear within seconds; a third retry covers the long tail.
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  });
}
