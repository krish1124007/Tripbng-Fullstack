// Manual-issuance follow-up service — scans for bookings parked in
// PENDING_MANUAL longer than a tier threshold and fires escalating ops
// reminders until the booking is issued (or cancelled).
//
// Tiered cadence (hours since PENDING_MANUAL):
//   ≥  4h → REMINDER       (heads-up)
//   ≥ 12h → ESCALATION     (urgent)
//   ≥ 24h → CRITICAL       (red-flag)
//   ≥ 48h → CRITICAL_HIGH  (executive escalation)
//
// We fire at most one alert per (bookingId, tier) using Redis SETNX
// dedupe. The TTL for each key matches the next tier's threshold so a
// booking that lingers re-fires on the next escalation — never the same
// tier twice. The cron itself runs every 4 hours so the worst-case
// delay between threshold-crossing and alert is ~4h.
//
// We deliberately do NOT write to the booking from this sweep. Reasons:
//   1. `updatedAt` would jitter, breaking the "hours since PENDING_MANUAL"
//      proxy that the worker depends on.
//   2. Mongo writes from a cron sweep create avoidable load.
// Dedupe living in Redis means a flush re-fires every tier — operationally
// acceptable; we'd rather over-nag than silently drop a stuck booking.

import { Booking, type BookingDoc } from '../../models/Booking.js';
import { redis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { enqueueAlert } from '../alerts/index.js';
import type { ManualIssuancePendingVars } from '../alerts/types.js';

/** Escalation tiers — order matters: we pick the HIGHEST tier whose
 *  threshold has been crossed for a given booking age. */
export const FOLLOWUP_TIERS = [
  { tier: 'CRITICAL_HIGH', minHours: 48 },
  { tier: 'CRITICAL', minHours: 24 },
  { tier: 'ESCALATION', minHours: 12 },
  { tier: 'REMINDER', minHours: 4 },
] as const;

export type FollowupTier = (typeof FOLLOWUP_TIERS)[number]['tier'];

/** TTL per tier — set just long enough that the same booking can't fire
 *  the same tier twice, but expires before the next-higher tier becomes
 *  reachable. The exception is CRITICAL_HIGH which is the terminal tier
 *  and uses a long TTL so we don't re-page every 4h forever. */
const DEDUPE_TTL_SEC: Record<FollowupTier, number> = {
  REMINDER: 9 * 60 * 60, // 9h — covers the gap up to ESCALATION (12h)
  ESCALATION: 13 * 60 * 60, // 13h — covers the gap up to CRITICAL (24h)
  CRITICAL: 25 * 60 * 60, // 25h — covers the gap up to CRITICAL_HIGH (48h)
  CRITICAL_HIGH: 7 * 24 * 60 * 60, // 7 days — terminal tier, page once a week
};

const dedupeKey = (bookingId: string, tier: FollowupTier): string =>
  `manual-issuance-followup:fired:${bookingId}:${tier}`;

export interface FollowupOptions {
  /** Override "now" for deterministic tests. */
  now?: Date;
  /** Tenant scope — usually omitted (sweeps all tenants). */
  tenantId?: string;
  /** Hard upper bound on bookings processed per tick — defensive. The
   *  worker is read-mostly so this cap is generous. */
  limit?: number;
}

export interface FollowupReport {
  scannedBookings: number;
  firedReminders: number;
  skippedDeduped: number;
  /** Bookings whose age didn't cross even the lowest tier (< 4h). */
  skippedTooFresh: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

/**
 * Pick the highest-urgency tier a booking has crossed given its current
 * pending-age. Returns null if it hasn't crossed even the REMINDER tier.
 */
export function pickTier(pendingHours: number): FollowupTier | null {
  for (const t of FOLLOWUP_TIERS) {
    if (pendingHours >= t.minHours) return t.tier;
  }
  return null;
}

/**
 * Sweep PENDING_MANUAL bookings and fire follow-up alerts. Returns a
 * structured report so the worker can log success metrics.
 */
export async function runManualIssuanceFollowup(
  opts: FollowupOptions = {},
): Promise<FollowupReport> {
  const startedAt = new Date();
  const now = opts.now ?? startedAt;
  const limit = opts.limit ?? 500;

  // Anything updated less than 4h ago can't be on any tier yet. Skip the
  // index scan entirely with a $lte filter on updatedAt.
  const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const filter: Record<string, unknown> = {
    status: 'PENDING_MANUAL',
    updatedAt: { $lte: fourHoursAgo },
  };
  if (opts.tenantId) filter.tenantId = opts.tenantId;

  const bookings = await Booking.find(filter)
    .select(
      '_id tenantId bookingCode agencyName supplierCode sector travelDate ' +
        'passengers pricing updatedAt internalNotes',
    )
    .limit(limit);

  let firedReminders = 0;
  let skippedDeduped = 0;
  let skippedTooFresh = 0;

  for (const booking of bookings) {
    const pendingMs = now.getTime() - (booking.updatedAt as Date).getTime();
    const pendingHours = Math.floor(pendingMs / (60 * 60 * 1000));
    const tier = pickTier(pendingHours);
    if (!tier) {
      skippedTooFresh++;
      continue;
    }

    const key = dedupeKey(String(booking._id), tier);
    const acquired = await redis
      .set(key, '1', 'EX', DEDUPE_TTL_SEC[tier], 'NX')
      .catch(() => null);
    if (acquired !== 'OK') {
      skippedDeduped++;
      continue;
    }

    await fireReminder(booking, tier, pendingHours);
    firedReminders++;
  }

  const finishedAt = new Date();
  logger.info(
    {
      scanned: bookings.length,
      fired: firedReminders,
      skippedDeduped,
      skippedTooFresh,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    },
    'manual-issuance-followup: tick done',
  );

  return {
    scannedBookings: bookings.length,
    firedReminders,
    skippedDeduped,
    skippedTooFresh,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

async function fireReminder(
  booking: BookingDoc,
  tier: FollowupTier,
  pendingHours: number,
): Promise<void> {
  const adminUrl = `${env.WEB_BASE_URL.replace(/\/$/, '')}/bookings/${String(booking._id)}`;
  const travelDateIso =
    booking.travelDate instanceof Date
      ? booking.travelDate.toISOString().slice(0, 10)
      : String(booking.travelDate);

  const vars: ManualIssuancePendingVars = {
    bookingCode: booking.bookingCode,
    bookingId: String(booking._id),
    agencyName: booking.agencyName,
    supplierCode: booking.supplierCode,
    sector: booking.sector,
    travelDate: travelDateIso,
    paxCount: booking.passengers?.length ?? 0,
    amountPaise: booking.pricing?.agencyPayablePaise ?? 0,
    pendingSince: (booking.updatedAt as Date).toISOString(),
    pendingHours,
    tier,
    internalNotes: booking.internalNotes ?? null,
    adminUrl,
  };

  try {
    await enqueueAlert(
      { event: 'MANUAL_ISSUANCE_PENDING_REMINDER', vars },
      [{ kind: 'ops' }],
      {
        tenantId: String(booking.tenantId),
        correlationKey: `manual-issuance-followup:${String(booking._id)}:${tier}`,
      },
    );
  } catch (err) {
    // Same posture as the credit-due reminder: never crash the cron. The
    // dedupe key is already set; manual re-fire requires DEL-ing it.
    logger.warn(
      { err, bookingId: String(booking._id), tier },
      'manual-issuance-followup: enqueueAlert failed (continuing)',
    );
  }
}
