// Credit-due reminder service — spec §8 of AGENCY_WALLET_SYSTEM.md.
//
// Scans every CREDIT-module agency with an outstanding `creditUsed > 0` and
// a configured `creditDueDate`, and fires one reminder per agency on each
// of the four anchor offsets:
//
//   T-3  — three days before the due date (heads-up window)
//   T-1  — one day before
//   T+0  — the due date itself (final reminder)
//   T+3  — three days past (overdue follow-up)
//
// Per-agency-per-offset dedupe lives in Redis with a 24 h TTL — re-running
// the cron on the same day won't re-fire the same anchor. The dedupe key
// shape mirrors the wallet-monitor worker's pattern.
//
// Notification path
//   The dispatched alert events (CREDIT_DUE_T_MINUS_3, CREDIT_DUE_TODAY,
//   CREDIT_OVERDUE) aren't yet authored in `services/alerts/templates/`.
//   Until the templates land, the service logs a structured "would fire"
//   line per matched agency so ops can verify behaviour. Once templates
//   ship, swap the logger.info for enqueueAlert per the comment in the
//   helper — the rest of the scheduling logic stays unchanged.

import { Agency, type AgencyDoc } from '../../models/Agency.js';
import { Wallet } from '../../models/Wallet.js';
import { redis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { enqueueAlert } from '../alerts/index.js';
import type { AlertEvent } from '../alerts/types.js';

/** Anchors evaluated each tick. Stored as offset in DAYS from due date. */
export const REMINDER_OFFSETS: readonly { days: number; event: string }[] = [
  { days: -3, event: 'CREDIT_DUE_T_MINUS_3' },
  { days: -1, event: 'CREDIT_DUE_TODAY' /* used here for T-1 too */ },
  { days: 0, event: 'CREDIT_DUE_TODAY' },
  { days: 3, event: 'CREDIT_OVERDUE' },
] as const;

const DEDUPE_TTL_SEC = 24 * 60 * 60;
const dedupeKey = (agencyId: string, offsetDays: number): string =>
  `credit-due:fired:${agencyId}:${offsetDays}`;

export interface RemindersOptions {
  tenantId?: string;
  agencyIds?: string[];
  /** Override "now" for testing. Calls use this to land on a deterministic
   *  anchor day regardless of real clock skew. */
  now?: Date;
}

export interface RemindersReport {
  scannedAgencies: number;
  firedReminders: number;
  skippedDeduped: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

/**
 * Sweep CREDIT-module agencies and fire the appropriate reminder anchor.
 * Idempotent on (agencyId, offsetDays) via Redis dedupe — safe to call
 * multiple times per day, only one alert per anchor per agency per 24 h.
 */
export async function runCreditDueReminders(
  opts: RemindersOptions = {},
): Promise<RemindersReport> {
  const startedAt = new Date();
  const now = opts.now ?? startedAt;

  const filter: Record<string, unknown> = {
    module: 'CREDIT',
    creditDueDate: { $ne: null },
  };
  if (opts.tenantId) filter.tenantId = opts.tenantId;
  if (opts.agencyIds && opts.agencyIds.length > 0) {
    filter._id = { $in: opts.agencyIds };
  }
  const agencies = await Agency.find(filter).select(
    '_id tenantId creditDueDate notificationPrefs ownerUserId',
  );

  // Pull wallets in one round-trip — we need creditUsed to filter agencies
  // that have nothing outstanding (an agency on CREDIT module that paid down
  // before the due date doesn't need a reminder).
  const wallets = await Wallet.find({
    agencyId: { $in: agencies.map((a) => a._id) },
  })
    .select('agencyId creditUsed')
    .lean();
  const walletByAgency = new Map(wallets.map((w) => [String(w.agencyId), w]));

  let firedReminders = 0;
  let skippedDeduped = 0;

  for (const agency of agencies) {
    const wallet = walletByAgency.get(String(agency._id));
    const creditUsed = wallet?.creditUsed ?? 0;
    if (creditUsed <= 0) continue; // nothing owed — skip

    const anchor = pickAnchorOffset(agency.creditDueDate as Date, now);
    if (anchor === null) continue; // not on any reminder day

    const key = dedupeKey(String(agency._id), anchor);
    const acquired = await redis
      .set(key, '1', 'EX', DEDUPE_TTL_SEC, 'NX')
      .catch(() => null);
    if (acquired !== 'OK') {
      skippedDeduped++;
      continue;
    }

    await fireReminder(agency, creditUsed, anchor);
    firedReminders++;
  }

  const finishedAt = new Date();
  logger.info(
    {
      scanned: agencies.length,
      fired: firedReminders,
      skippedDeduped,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    },
    'credit-due-reminder: tick done',
  );
  return {
    scannedAgencies: agencies.length,
    firedReminders,
    skippedDeduped,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

/**
 * Returns the offset-in-days the agency is on, or null if not on any anchor.
 * Floors `now` and `dueDate` to UTC midnight so the offset comparison is
 * cron-tick-agnostic (a 02:00 IST tick and an 18:00 IST tick both fire the
 * same anchor for a due date that's "today").
 */
export function pickAnchorOffset(dueDate: Date, now: Date): number | null {
  const dayMs = 24 * 60 * 60 * 1000;
  const dueUtc = Math.floor(dueDate.getTime() / dayMs);
  const nowUtc = Math.floor(now.getTime() / dayMs);
  const offsetDays = nowUtc - dueUtc;
  for (const anchor of REMINDER_OFFSETS) {
    if (offsetDays === anchor.days) return anchor.days;
  }
  return null;
}

async function fireReminder(
  agency: AgencyDoc,
  creditUsedPaise: number,
  offsetDays: number,
): Promise<void> {
  const event: AlertEvent =
    offsetDays === -3
      ? 'CREDIT_DUE_T_MINUS_3'
      : offsetDays === -1
        ? 'CREDIT_DUE_T_MINUS_1'
        : offsetDays === 0
          ? 'CREDIT_DUE_TODAY'
          : 'CREDIT_OVERDUE';

  const dueDate = (agency.creditDueDate as Date | null)?.toISOString() ?? null;
  if (!dueDate) {
    // Defensive — the agency-find filter already required `creditDueDate != null`,
    // but a value can flip during a concurrent admin write. Skip gracefully.
    return;
  }
  const payNowUrl = `${env.WEB_BASE_URL.replace(/\/$/, '')}/wallet/credit`;

  try {
    await enqueueAlert(
      {
        event,
        vars: {
          creditUsedPaise,
          creditLimitPaise: agency.creditLimit ?? 0,
          dueDate,
          offsetDays,
          payNowUrl,
        },
      },
      [{ kind: 'agency', id: String(agency._id) }],
      {
        tenantId: String(agency.tenantId),
        // Correlation key matches the Redis dedupe so cross-system audit
        // joins are clean.
        correlationKey: `credit-due:${String(agency._id)}:${offsetDays}`,
      },
    );
  } catch (err) {
    // Alert enqueue failure must not crash the cron. The dedupe key is
    // already set, so a manual re-fire requires DEL-ing it first.
    logger.warn(
      { err, agencyId: String(agency._id), event },
      'credit-due-reminder: enqueueAlert failed (continuing)',
    );
  }
}
