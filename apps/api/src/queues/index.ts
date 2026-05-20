// Queue + worker registry. BullMQ stores jobs in Redis and workers consume them.
// Naming convention: queues are kebab-cased and shared with their worker file.
//
// Lifecycle: createQueues() is called from the API entrypoint after Redis is up. Workers
// run in-process by default (RUN_WORKERS=true) so dev / single-node prod doesn't need a
// separate process. In a multi-node setup, set RUN_WORKERS only on dedicated worker nodes.
import { Queue, Worker, type Job, type WorkerOptions } from 'bullmq';
import { bullmqRedis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { isProd } from '../config/env.js';

export const QUEUE_NAMES = {
  HOLD_EXPIRY: 'hold-expiry',
  EMAIL_RETRY: 'email-retry',
  PAYMENT_WEBHOOK: 'payment-webhook',
  ALERT_DISPATCH: 'alert-dispatch',
  TBO_TOKEN_REFRESH: 'tbo-token-refresh',
  TBO_REFERENCE_SYNC: 'tbo-reference-sync',
  TBO_PENDING_BOOKING_POLL: 'tbo-pending-booking-poll',
  TBO_VOUCHER: 'tbo-voucher',
  TBO_CANCEL_POLL: 'tbo-cancel-poll',
  TBO_FLIGHT_CANCEL_POLL: 'tbo-flight-cancel-poll',
  SEATSELLER_CITY_SYNC: 'seatseller-city-sync',
  WALLET_MONITOR: 'wallet-monitor',
  WALLET_INTEGRITY: 'wallet-integrity',
  DI_INCENTIVE: 'di-incentive',
  CREDIT_BLOCK_RECOMPUTE: 'credit-block-recompute',
  CREDIT_DUE_REMINDER: 'credit-due-reminder',
  APPROVAL_EXPIRY_SWEEPER: 'approval-expiry-sweeper',
  BUS_OPERATOR_CANCELLATION_POLLER: 'bus-operator-cancellation-poller',
  KAFILA_TICKET_POLL: 'kafila-ticket-poll',
} as const;

let holdExpiryQueue: Queue | null = null;
let emailRetryQueue: Queue | null = null;
let paymentWebhookQueue: Queue | null = null;
let alertDispatchQueue: Queue | null = null;
let tboTokenRefreshQueue: Queue | null = null;
let tboReferenceSyncQueue: Queue | null = null;
let tboPendingBookingPollQueue: Queue | null = null;
let tboVoucherQueue: Queue | null = null;
let tboCancelPollQueue: Queue | null = null;
let tboFlightCancelPollQueue: Queue | null = null;
let seatsellerCitySyncQueue: Queue | null = null;
let walletMonitorQueue: Queue | null = null;
let walletIntegrityQueue: Queue | null = null;
let diIncentiveQueue: Queue | null = null;
let creditBlockRecomputeQueue: Queue | null = null;
let creditDueReminderQueue: Queue | null = null;
let approvalExpirySweeperQueue: Queue | null = null;
let busOperatorCancellationPollerQueue: Queue | null = null;
let kafilaTicketPollQueue: Queue | null = null;

const workers: Worker[] = [];

// Shared bullmq Redis connection (maxRetriesPerRequest: null) — required for blocking ops.
const sharedConnection = () => ({ connection: bullmqRedis });

export function getHoldExpiryQueue(): Queue {
  if (!holdExpiryQueue) holdExpiryQueue = new Queue(QUEUE_NAMES.HOLD_EXPIRY, sharedConnection());
  return holdExpiryQueue;
}

export function getEmailRetryQueue(): Queue {
  if (!emailRetryQueue) emailRetryQueue = new Queue(QUEUE_NAMES.EMAIL_RETRY, sharedConnection());
  return emailRetryQueue;
}

export function getPaymentWebhookQueue(): Queue {
  if (!paymentWebhookQueue) {
    paymentWebhookQueue = new Queue(QUEUE_NAMES.PAYMENT_WEBHOOK, sharedConnection());
  }
  return paymentWebhookQueue;
}

export function getAlertDispatchQueue(): Queue {
  if (!alertDispatchQueue) {
    alertDispatchQueue = new Queue(QUEUE_NAMES.ALERT_DISPATCH, sharedConnection());
  }
  return alertDispatchQueue;
}

export function getTboTokenRefreshQueue(): Queue {
  if (!tboTokenRefreshQueue) {
    tboTokenRefreshQueue = new Queue(QUEUE_NAMES.TBO_TOKEN_REFRESH, sharedConnection());
  }
  return tboTokenRefreshQueue;
}

export function getTboReferenceSyncQueue(): Queue {
  if (!tboReferenceSyncQueue) {
    tboReferenceSyncQueue = new Queue(QUEUE_NAMES.TBO_REFERENCE_SYNC, sharedConnection());
  }
  return tboReferenceSyncQueue;
}

export function getTboPendingBookingPollQueue(): Queue {
  if (!tboPendingBookingPollQueue) {
    tboPendingBookingPollQueue = new Queue(
      QUEUE_NAMES.TBO_PENDING_BOOKING_POLL,
      sharedConnection(),
    );
  }
  return tboPendingBookingPollQueue;
}

export function getTboVoucherQueue(): Queue {
  if (!tboVoucherQueue) {
    tboVoucherQueue = new Queue(QUEUE_NAMES.TBO_VOUCHER, sharedConnection());
  }
  return tboVoucherQueue;
}

export function getTboCancelPollQueue(): Queue {
  if (!tboCancelPollQueue) {
    tboCancelPollQueue = new Queue(QUEUE_NAMES.TBO_CANCEL_POLL, sharedConnection());
  }
  return tboCancelPollQueue;
}

export function getTboFlightCancelPollQueue(): Queue {
  if (!tboFlightCancelPollQueue) {
    tboFlightCancelPollQueue = new Queue(
      QUEUE_NAMES.TBO_FLIGHT_CANCEL_POLL,
      sharedConnection(),
    );
  }
  return tboFlightCancelPollQueue;
}

export function getSeatsellerCitySyncQueue(): Queue {
  if (!seatsellerCitySyncQueue) {
    seatsellerCitySyncQueue = new Queue(
      QUEUE_NAMES.SEATSELLER_CITY_SYNC,
      sharedConnection(),
    );
  }
  return seatsellerCitySyncQueue;
}

export function getWalletMonitorQueue(): Queue {
  if (!walletMonitorQueue) {
    walletMonitorQueue = new Queue(QUEUE_NAMES.WALLET_MONITOR, sharedConnection());
  }
  return walletMonitorQueue;
}

export function getWalletIntegrityQueue(): Queue {
  if (!walletIntegrityQueue) {
    walletIntegrityQueue = new Queue(QUEUE_NAMES.WALLET_INTEGRITY, sharedConnection());
  }
  return walletIntegrityQueue;
}

export function getDiIncentiveQueue(): Queue {
  if (!diIncentiveQueue) {
    diIncentiveQueue = new Queue(QUEUE_NAMES.DI_INCENTIVE, sharedConnection());
  }
  return diIncentiveQueue;
}

export function getCreditBlockRecomputeQueue(): Queue {
  if (!creditBlockRecomputeQueue) {
    creditBlockRecomputeQueue = new Queue(QUEUE_NAMES.CREDIT_BLOCK_RECOMPUTE, sharedConnection());
  }
  return creditBlockRecomputeQueue;
}

export function getCreditDueReminderQueue(): Queue {
  if (!creditDueReminderQueue) {
    creditDueReminderQueue = new Queue(QUEUE_NAMES.CREDIT_DUE_REMINDER, sharedConnection());
  }
  return creditDueReminderQueue;
}

export function getApprovalExpirySweeperQueue(): Queue {
  if (!approvalExpirySweeperQueue) {
    approvalExpirySweeperQueue = new Queue(
      QUEUE_NAMES.APPROVAL_EXPIRY_SWEEPER,
      sharedConnection(),
    );
  }
  return approvalExpirySweeperQueue;
}

export function getBusOperatorCancellationPollerQueue(): Queue {
  if (!busOperatorCancellationPollerQueue) {
    busOperatorCancellationPollerQueue = new Queue(
      QUEUE_NAMES.BUS_OPERATOR_CANCELLATION_POLLER,
      sharedConnection(),
    );
  }
  return busOperatorCancellationPollerQueue;
}

export function getKafilaTicketPollQueue(): Queue {
  if (!kafilaTicketPollQueue) {
    kafilaTicketPollQueue = new Queue(QUEUE_NAMES.KAFILA_TICKET_POLL, sharedConnection());
  }
  return kafilaTicketPollQueue;
}

/** Enqueue a Kafila ticket-poll job. Booking-service hook: call this
 *  after adapter.hold() if the returned booking's ticket numbers
 *  are empty / CurrentStatus === 'PENDING'. Worker handles the rest:
 *  exponential backoff up to 6 attempts (~53 min total horizon). */
export async function enqueueKafilaTicketPoll(data: {
  bookingRef: string;
  internalBookingId?: string;
  correlationId?: string;
}): Promise<void> {
  await getKafilaTicketPollQueue().add(
    'poll',
    { ...data, attempt: 1 },
    {
      // First poll fires after 30s. Subsequent polls re-enqueue with
      // their own delays inside the worker.
      delay: 30_000,
      attempts: 1, // Worker manages its own retries via re-enqueue.
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  );
}

export interface FlightCancelPollJob {
  bookingId: string;
  /** Attempt counter — used for back-off + giving up. */
  attempt: number;
}

/** Enqueue a poll for a TBO flight cancellation. Public helper so
 *  services/booking can trigger the first poll right after dispatching
 *  Air/SendChangeRequest. The worker re-enqueues itself for subsequent
 *  polls until terminal status. */
export async function enqueueFlightCancelPoll(
  data: FlightCancelPollJob,
  delayMs?: number,
): Promise<void> {
  await getTboFlightCancelPollQueue().add('poll-flight-cancel', data, {
    delay: delayMs ?? 60_000, // First poll 60s after cancel — TBO needs a beat.
    attempts: 3,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  });
}

// startWorkers — spins up consumers for every queue. Each worker is bounded in concurrency
// because the work is mostly Mongo-bound; bumping concurrency past ~10 starts thrashing the
// connection pool with no throughput gain.
export async function startWorkers(): Promise<void> {
  // Defer the imports so the worker code path is only loaded when workers are actually run.
  const { holdExpiryProcessor, scheduleHoldExpirySweep } = await import('./hold-expiry.worker.js');
  const { emailRetryProcessor } = await import('./email-retry.worker.js');
  const { paymentWebhookProcessor } = await import('./payment-webhook.worker.js');
  const { alertDispatchProcessor } = await import('./alert-dispatch.worker.js');
  const { tboTokenRefreshProcessor, scheduleTboTokenRefresh } = await import(
    './tbo-token-refresh.worker.js'
  );
  const { tboReferenceSyncProcessor, scheduleTboReferenceSync } = await import(
    './tbo-reference-sync.worker.js'
  );
  const { tboPendingBookingPollProcessor } = await import(
    './tbo-pending-booking-poll.worker.js'
  );
  const { tboVoucherProcessor } = await import('./tbo-voucher.worker.js');
  const { tboCancelPollProcessor } = await import('./tbo-cancel-poll.worker.js');
  const { tboFlightCancelPollProcessor } = await import(
    './tbo-flight-cancel-poll.worker.js'
  );
  const { seatsellerCitySyncProcessor, scheduleSeatsellerCitySync } = await import(
    './seatseller-city-sync.worker.js'
  );
  const { walletMonitorProcessor, scheduleWalletMonitor } = await import(
    './wallet-monitor.worker.js'
  );
  const { walletIntegrityProcessor, scheduleWalletIntegrity } = await import(
    './wallet-integrity.worker.js'
  );
  const { diIncentiveProcessor } = await import('./di-incentive.worker.js');
  const { creditBlockRecomputeProcessor, scheduleCreditBlockRecompute } = await import(
    './credit-block-recompute.worker.js'
  );
  const { creditDueReminderProcessor, scheduleCreditDueReminder } = await import(
    './credit-due-reminder.worker.js'
  );
  const { approvalExpirySweeperProcessor, scheduleApprovalExpirySweeper } = await import(
    './approval-expiry-sweeper.worker.js'
  );
  const {
    busOperatorCancellationProcessor,
    scheduleBusOperatorCancellationPoller,
  } = await import('./bus-operator-cancellation-poller.worker.js');
  const { kafilaTicketPollProcessor } = await import('./kafila-ticket-poll.worker.js');

  const opts: WorkerOptions = {
    connection: bullmqRedis,
    autorun: true,
    concurrency: 5,
  };

  workers.push(
    new Worker(
      QUEUE_NAMES.HOLD_EXPIRY,
      holdExpiryProcessor as (job: Job) => Promise<unknown>,
      opts,
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.EMAIL_RETRY,
      emailRetryProcessor as (job: Job) => Promise<unknown>,
      opts,
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.PAYMENT_WEBHOOK,
      paymentWebhookProcessor as (job: Job) => Promise<unknown>,
      // Higher concurrency on webhooks — they're mostly DB-bound and we want
      // a 1000-webhook spike to drain in seconds, not minutes.
      { ...opts, concurrency: 20 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.ALERT_DISPATCH,
      alertDispatchProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 10 — alerts are mostly outbound HTTP (SMTP / WA), and
      // running too many in parallel risks tripping provider rate limits.
      // Empirically WA is the bottleneck (~80 msgs/sec/phone-number).
      { ...opts, concurrency: 10 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.TBO_TOKEN_REFRESH,
      tboTokenRefreshProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 1 — only one auth call should ever be in flight; even
      // if duplicate cron fires, the auth-service Redis lock dedupes them.
      { ...opts, concurrency: 1 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.TBO_REFERENCE_SYNC,
      tboReferenceSyncProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 1 — the sweep itself fans out work internally
      // (HotelDetails parallelism); we don't want two sweeps overlapping.
      { ...opts, concurrency: 1 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.TBO_PENDING_BOOKING_POLL,
      tboPendingBookingPollProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 5 — most pending polls are quick, but a spike of new
      // pending bookings shouldn't queue up behind one another.
      { ...opts, concurrency: 5 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.TBO_VOUCHER,
      tboVoucherProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 3 — voucher generation is rare, low concurrency.
      { ...opts, concurrency: 3 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.TBO_CANCEL_POLL,
      tboCancelPollProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 5 — same rationale as pending poll.
      { ...opts, concurrency: 5 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.TBO_FLIGHT_CANCEL_POLL,
      tboFlightCancelPollProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 5 — TBO Air/GetChangeRequestStatus is a quick call.
      { ...opts, concurrency: 5 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.SEATSELLER_CITY_SYNC,
      seatsellerCitySyncProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 1 — only one sync should ever be in flight; getCities
      // is cheap but writing concurrent caches is wasteful.
      { ...opts, concurrency: 1 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.WALLET_MONITOR,
      walletMonitorProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 1 — overlapping monitor ticks would race the Redis
      // dedupe SETNX. The sweep itself is fast (a single Mongo query +
      // per-wallet alerts).
      { ...opts, concurrency: 1 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.WALLET_INTEGRITY,
      walletIntegrityProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 1 — overlapping ticks would race on per-wallet
      // `lastReconciledAt` writes and duplicate audit rows. Daily cadence
      // makes serial execution easy.
      { ...opts, concurrency: 1 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.DI_INCENTIVE,
      diIncentiveProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 5 — the underlying ledger service already serialises
      // per-agency via Redis lock, so cross-agency parallelism is safe and
      // desirable when a topup burst lands.
      { ...opts, concurrency: 5 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.CREDIT_BLOCK_RECOMPUTE,
      creditBlockRecomputeProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 1 — single tenant-wide scan per hour, audit writes
      // would race if overlapping.
      { ...opts, concurrency: 1 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.CREDIT_DUE_REMINDER,
      creditDueReminderProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 1 — daily sweep, Redis dedupe keys race-tolerant but
      // logging stays clean with serial execution.
      { ...opts, concurrency: 1 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.APPROVAL_EXPIRY_SWEEPER,
      approvalExpirySweeperProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 1 — single Mongo updateMany; concurrency adds nothing.
      { ...opts, concurrency: 1 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.BUS_OPERATOR_CANCELLATION_POLLER,
      busOperatorCancellationProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 1 — daily sweep; refunds need ordering.
      { ...opts, concurrency: 1 },
    ),
  );
  workers.push(
    new Worker(
      QUEUE_NAMES.KAFILA_TICKET_POLL,
      kafilaTicketPollProcessor as (job: Job) => Promise<unknown>,
      // Concurrency 5 — most polls are quick retriveBooking calls; a
      // spike of new PENDING bookings shouldn't serialize.
      { ...opts, concurrency: 5 },
    ),
  );

  for (const w of workers) {
    w.on('failed', (job, err) =>
      logger.error(
        { err, queue: w.name, jobId: job?.id, attempts: job?.attemptsMade },
        'job failed',
      ),
    );
    w.on('completed', (job) => logger.debug({ queue: w.name, jobId: job.id }, 'job completed'));
  }

  // Kick off the recurring hold-expiry sweep — runs every minute. The sweep itself enqueues
  // a job that scans for expired holds and releases them.
  await scheduleHoldExpirySweep();

  // Daily TBO token refresh at 00:01 IST. No-ops when TBO_ENABLED=false.
  await scheduleTboTokenRefresh();

  // Nightly TBO reference-data sweep at 02:00 IST.
  await scheduleTboReferenceSync();

  // Weekly SeatSeller city catalog sync — Sunday 03:00 IST.
  await scheduleSeatsellerCitySync(getSeatsellerCitySyncQueue());

  // Wallet monitor — every 15 min by default.
  await scheduleWalletMonitor(getWalletMonitorQueue());

  // Wallet integrity — daily 02:30 IST. Recomputes ledger sums and audits drift.
  await scheduleWalletIntegrity(getWalletIntegrityQueue());

  // Credit-block recompute — hourly :05 IST. Safety net for time-based
  // crossings of credit limit / expiry / due-date.
  await scheduleCreditBlockRecompute(getCreditBlockRecomputeQueue());

  // Credit-due reminder — daily 07:00 IST. T-3 / T-1 / T+0 / T+3 anchors
  // with Redis dedupe per (agencyId, offset).
  await scheduleCreditDueReminder(getCreditDueReminderQueue());

  // Approval expiry sweeper — every 1 min.
  await scheduleApprovalExpirySweeper(getApprovalExpirySweeperQueue());

  // Bus operator-cancellation poller — daily 06:00 IST.
  await scheduleBusOperatorCancellationPoller(getBusOperatorCancellationPollerQueue());

  logger.info({ workers: workers.length, isProd }, 'workers started');
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
  await Promise.all(
    [
      holdExpiryQueue,
      emailRetryQueue,
      paymentWebhookQueue,
      alertDispatchQueue,
      tboTokenRefreshQueue,
      tboReferenceSyncQueue,
      tboPendingBookingPollQueue,
      tboVoucherQueue,
      tboCancelPollQueue,
      tboFlightCancelPollQueue,
      seatsellerCitySyncQueue,
      walletMonitorQueue,
      walletIntegrityQueue,
      diIncentiveQueue,
      creditBlockRecomputeQueue,
      creditDueReminderQueue,
      approvalExpirySweeperQueue,
      busOperatorCancellationPollerQueue,
      kafilaTicketPollQueue,
    ]
      .filter((q): q is Queue => !!q)
      .map((q) => q.close()),
  );
  holdExpiryQueue = null;
  emailRetryQueue = null;
  paymentWebhookQueue = null;
  alertDispatchQueue = null;
  tboTokenRefreshQueue = null;
  tboReferenceSyncQueue = null;
  tboPendingBookingPollQueue = null;
  tboVoucherQueue = null;
  tboCancelPollQueue = null;
  seatsellerCitySyncQueue = null;
  tboFlightCancelPollQueue = null;
  walletMonitorQueue = null;
  walletIntegrityQueue = null;
  diIncentiveQueue = null;
  creditBlockRecomputeQueue = null;
  creditDueReminderQueue = null;
  approvalExpirySweeperQueue = null;
  busOperatorCancellationPollerQueue = null;
  kafilaTicketPollQueue = null;
}
