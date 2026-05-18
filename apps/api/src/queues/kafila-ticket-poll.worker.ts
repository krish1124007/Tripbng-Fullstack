// Kafila ticket-poll worker — resolves the "CreatePnr accepted but
// ticket numbers not issued yet" state.
//
// Triggered by the booking service when adapter.hold() returns a
// response whose Passengers[].Optional.ticketDetails[] is empty (or
// CurrentStatus === 'PENDING'). Each job polls retriveBooking and
// either:
//   - resolves to CONFIRMED (ticket numbers present) → done.
//   - resolves to FAILED / CANCELLED → ops alert (refund handled by
//     the booking service when it sees the booking flipped to FAILED;
//     we don't do refunds here because the worker doesn't own the
//     booking record).
//   - stays PENDING → re-enqueue with backoff up to MAX_ATTEMPTS.
//
// The poll schedule is hardcoded (30s → 1m → 2m → 5m → 15m → 30m) so
// the dashboard sees deterministic behaviour. Push to env vars only
// when ops needs per-environment tuning.
//
// IMPORTANT: this worker does NOT update any Mongo Booking record —
// the booking service owns that. The worker's job is to surface the
// terminal state via logs + alerts; the booking service polls or
// subscribes to those signals to update its own model. This keeps the
// worker decoupled from whichever booking model (Booking,
// FlightBooking, …) the platform picks for Kafila flights.

import type { Job } from 'bullmq';
import { logger } from '../config/logger.js';
import { getKafilaAdapterIfConfigured } from '../adapters/registry.js';
import { getKafilaTicketPollQueue } from './index.js';

export interface KafilaTicketPollJob {
  /** Kafila BookingId — returned as `supplierBookingRef` from
   *  adapter.hold(). The worker calls retriveBooking({bookingId: ...})
   *  with this. */
  bookingRef: string;
  /** 1-based attempt counter. Worker uses this to pick the next delay
   *  from POLL_DELAYS_MS and to give up at MAX_ATTEMPTS. */
  attempt: number;
  /** Optional Mongo Booking._id — passed through so dashboards can
   *  correlate without re-querying. Worker doesn't touch this record. */
  internalBookingId?: string;
  /** Correlation key reused across the booking's audit trail — same
   *  value the adapter used on CreatePnr. Helps support trace the
   *  poll chain. */
  correlationId?: string;
}

/** Poll cadence — total horizon ~53 minutes across 6 attempts. After
 *  the 6th poll we give up and ops gets an alert. */
const POLL_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 900_000, 1_800_000] as const;
const MAX_ATTEMPTS = POLL_DELAYS_MS.length;

interface PollOutcome {
  kind: 'confirmed' | 'pending' | 'failed';
  ticketNumbers: string[];
  pnr?: string;
  status?: string;
  errorMessage?: string;
}

function inspectBookingResponse(res: unknown): PollOutcome {
  const data =
    (res as { data?: { BookingInfo?: { CurrentStatus?: string; PNR?: string; GPnr?: string; APnr?: string }; PaxInfo?: { Passengers?: Array<{ Optional?: { ticketDetails?: Array<{ ticketNumber?: string }> } }> }; ErrorMessage?: string } } | undefined)?.data;
  const info = data?.BookingInfo;
  const status = info?.CurrentStatus ?? '';
  const pnr = info?.GPnr || info?.PNR || info?.APnr || undefined;

  const ticketNumbers: string[] = [];
  for (const p of data?.PaxInfo?.Passengers ?? []) {
    for (const t of p.Optional?.ticketDetails ?? []) {
      if (t.ticketNumber) ticketNumbers.push(t.ticketNumber);
    }
  }

  if (ticketNumbers.length > 0 || status === 'CONFIRMED' || status === 'TICKETED') {
    return { kind: 'confirmed', ticketNumbers, pnr, status };
  }
  if (status === 'FAILED' || status === 'CANCELLED' || status === 'ERROR') {
    return {
      kind: 'failed',
      ticketNumbers: [],
      pnr,
      status,
      errorMessage: data?.ErrorMessage ?? `Kafila booking ${status}`,
    };
  }
  // Default: still pending (or vendor returned an unrecognized status —
  // the conservative branch is to keep polling, not to fail).
  return { kind: 'pending', ticketNumbers: [], pnr, status };
}

export async function kafilaTicketPollProcessor(job: Job<KafilaTicketPollJob>): Promise<void> {
  const { bookingRef, attempt, internalBookingId, correlationId } = job.data;
  const adapter = getKafilaAdapterIfConfigured();
  if (!adapter) {
    // KAFILA_ENABLED=false at runtime. Log + drop the job — it'll be
    // re-enqueued next time the adapter comes online if the booking
    // service still cares.
    logger.warn(
      { bookingRef, attempt },
      'kafila.ticket-poll: adapter not configured, dropping job',
    );
    return;
  }

  let outcome: PollOutcome;
  try {
    // Call the raw client directly — adapter.retrieveBooking() drops
    // the response shape down to {pnr, status} but the worker needs
    // the full body to extract ticket numbers + error text.
    const raw = await adapter.client.retriveBooking({ bookingId: bookingRef });
    outcome = inspectBookingResponse(raw);
  } catch (err) {
    // Transport / vendor error — log and treat as still-pending so
    // we re-enqueue. Persistent transport failure burns through
    // MAX_ATTEMPTS and lands in the ops-alert branch below.
    logger.warn(
      { bookingRef, attempt, err: err instanceof Error ? err.message : err, correlationId },
      'kafila.ticket-poll: retriveBooking failed, treating as pending',
    );
    outcome = { kind: 'pending', ticketNumbers: [] };
  }

  if (outcome.kind === 'confirmed') {
    logger.info(
      {
        bookingRef,
        internalBookingId,
        attempt,
        pnr: outcome.pnr,
        ticketCount: outcome.ticketNumbers.length,
        correlationId,
      },
      'kafila.ticket-poll: CONFIRMED — tickets issued',
    );
    // Booking service polls these logs / its own state to flip the
    // Booking model from PENDING to TICKETED. If we add an alert
    // pipeline for "your flight is ticketed" this is the call site.
    return;
  }

  if (outcome.kind === 'failed') {
    logger.error(
      {
        bookingRef,
        internalBookingId,
        attempt,
        status: outcome.status,
        errorMessage: outcome.errorMessage,
        correlationId,
      },
      'kafila.ticket-poll: SUPPLIER FAILED — booking service must refund + notify',
    );
    return;
  }

  // Still pending. Re-enqueue if attempts remain.
  if (attempt >= MAX_ATTEMPTS) {
    logger.error(
      { bookingRef, internalBookingId, attempt, correlationId },
      'kafila.ticket-poll: max attempts exceeded — booking stuck PENDING, manual ops review needed',
    );
    return;
  }

  const nextDelay = POLL_DELAYS_MS[attempt] ?? POLL_DELAYS_MS[POLL_DELAYS_MS.length - 1]!;
  await getKafilaTicketPollQueue().add(
    'poll',
    { bookingRef, attempt: attempt + 1, internalBookingId, correlationId },
    { delay: nextDelay },
  );
  logger.debug(
    { bookingRef, attempt, nextAttemptIn: nextDelay, correlationId },
    'kafila.ticket-poll: still pending, re-enqueued',
  );
}
