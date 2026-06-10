// Credit-block recompute — spec §3.6 of AGENCY_WALLET_SYSTEM.md.
//
// Evaluates the three booking-gate guards for CREDIT-module agencies:
//
//   1. CREDIT_LIMIT      — creditUsed >= creditLimit
//   2. CREDIT_EXPIRED    — creditExpiryDate exists and < now
//   3. DUE_DATE_CROSSED  — blockOnDueDateCross AND creditDueDate < now
//                          AND creditUsed > 0 (don't block agencies that
//                          paid down their outstanding before the date)
//
// Runs against `Agency.bookingBlocked` + `Agency.blockReason`:
//   * When any guard fires, set bookingBlocked=true with the matching reason.
//   * When all guards clear AND the previous block reason was credit-related,
//     unblock. Other reasons (INSUFFICIENT_BALANCE, ADMIN_SUSPEND) are
//     preserved — those flow from different code paths and we don't claim
//     authority over them here.
//
// Idempotent — safe to call as often as the operator wants. Audit-logs any
// transition (block→block-with-different-reason, block→unblock, unblock→block).

import { Agency, type AgencyDoc } from '../../models/Agency.js';
import { Wallet } from '../../models/Wallet.js';
import { type AgencyBlockReason } from '@tripbng/shared';
import { recordAudit } from '../audit.service.js';
import { logger } from '../../config/logger.js';

const CREDIT_REASONS: ReadonlySet<AgencyBlockReason> = new Set([
  'CREDIT_LIMIT',
  'CREDIT_EXPIRED',
  'DUE_DATE_CROSSED',
]);

export interface RecomputeOptions {
  /** Limit the scan to a single tenant. Default: all tenants (cron mode). */
  tenantId?: string;
  /** Limit to a specific list of agencies (manual trigger / targeted test). */
  agencyIds?: string[];
  /** Override "now" for testing. */
  now?: Date;
}

export interface RecomputeReport {
  scannedAgencies: number;
  newlyBlocked: number;
  newlyUnblocked: number;
  reasonChanged: number;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

/**
 * Recompute booking-gate guards for every CREDIT-module agency in scope.
 * Returns a high-level summary; per-agency diffs land in the audit log.
 */
export async function recomputeCreditBlocks(
  opts: RecomputeOptions = {},
): Promise<RecomputeReport> {
  const startedAt = new Date();
  const now = opts.now ?? startedAt;

  const filter: Record<string, unknown> = { module: 'CREDIT' };
  if (opts.tenantId) filter.tenantId = opts.tenantId;
  if (opts.agencyIds && opts.agencyIds.length > 0) {
    filter._id = { $in: opts.agencyIds };
  }

  const agencies = await Agency.find(filter).select(
    '_id tenantId module creditLimit creditExpiryDate creditDueDate blockOnDueDateCross bookingBlocked blockReason',
  );

  // Pull wallets in one round-trip so we don't N+1 the agency loop.
  const wallets = await Wallet.find({
    agencyId: { $in: agencies.map((a) => a._id) },
  })
    .select('agencyId creditUsed')
    .lean();
  const walletByAgency = new Map(wallets.map((w) => [String(w.agencyId), w]));

  let newlyBlocked = 0;
  let newlyUnblocked = 0;
  let reasonChanged = 0;

  for (const agency of agencies) {
    const wallet = walletByAgency.get(String(agency._id));
    const creditUsed = wallet?.creditUsed ?? 0;
    const next = evaluate(agency, creditUsed, now);
    const transition = classifyTransition(agency, next);

    if (transition === 'none') continue;

    const beforeSnapshot = {
      bookingBlocked: agency.bookingBlocked ?? false,
      blockReason: agency.blockReason ?? null,
    };

    agency.bookingBlocked = next.bookingBlocked;
    agency.blockReason = next.blockReason ?? null;
    await agency.save();

    if (transition === 'block') newlyBlocked++;
    else if (transition === 'unblock') newlyUnblocked++;
    else if (transition === 'reason-changed') reasonChanged++;

    try {
      await recordAudit({
        tenantId: String(agency.tenantId),
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'agency.credit_block.recompute',
        resource: 'agency',
        resourceId: String(agency._id),
        before: beforeSnapshot,
        after: {
          bookingBlocked: next.bookingBlocked,
          blockReason: next.blockReason ?? null,
          transition,
        },
      });
    } catch (err) {
      logger.warn(
        { err, agencyId: String(agency._id) },
        'credit-block: audit failed (continuing)',
      );
    }
  }

  const finishedAt = new Date();
  return {
    scannedAgencies: agencies.length,
    newlyBlocked,
    newlyUnblocked,
    reasonChanged,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

interface NextState {
  bookingBlocked: boolean;
  blockReason: AgencyBlockReason | null;
}

/**
 * Pure: given an agency and its credit usage, decide what the booking-gate
 * state should be. Spec §3.6 — guards evaluated in priority order; first
 * match wins (LIMIT > EXPIRED > DUE_DATE).
 */
function evaluate(agency: AgencyDoc, creditUsed: number, now: Date): NextState {
  const limit = agency.creditLimit ?? 0;
  if (limit > 0 && creditUsed >= limit) {
    return { bookingBlocked: true, blockReason: 'CREDIT_LIMIT' };
  }
  if (agency.creditExpiryDate && agency.creditExpiryDate < now) {
    return { bookingBlocked: true, blockReason: 'CREDIT_EXPIRED' };
  }
  if (
    agency.blockOnDueDateCross &&
    agency.creditDueDate &&
    agency.creditDueDate < now &&
    creditUsed > 0
  ) {
    return { bookingBlocked: true, blockReason: 'DUE_DATE_CROSSED' };
  }

  // All credit guards clear. We only unblock if the CURRENT block reason
  // was credit-related — preserve INSUFFICIENT_BALANCE, ADMIN_SUSPEND, etc.
  const currentReason = agency.blockReason as AgencyBlockReason | null;
  if (currentReason && !CREDIT_REASONS.has(currentReason)) {
    return { bookingBlocked: agency.bookingBlocked ?? false, blockReason: currentReason };
  }
  return { bookingBlocked: false, blockReason: null };
}

type Transition = 'none' | 'block' | 'unblock' | 'reason-changed';

function classifyTransition(agency: AgencyDoc, next: NextState): Transition {
  const wasBlocked = agency.bookingBlocked ?? false;
  const wasReason = agency.blockReason ?? null;
  if (wasBlocked === next.bookingBlocked && wasReason === next.blockReason) {
    return 'none';
  }
  if (!wasBlocked && next.bookingBlocked) return 'block';
  if (wasBlocked && !next.bookingBlocked) return 'unblock';
  return 'reason-changed';
}

