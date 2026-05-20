// DI-module incentive service — Phase-2 implementation of spec §3.3 + §6.2.
//
// Responsibilities split into a pure compute function and an impure apply
// function so the math is easy to test in isolation:
//
//   computeIncentive(config, depositPaise) → { incentive, tds, net, skip }
//     Pure. No I/O. Caps, gates, and rounding live here.
//
//   resolveActiveConfig(tenantId, agencyId) → DepositIncentiveConfig | null
//     Picks the per-agency row first, falls back to the tenant-wide default
//     (agencyId: null). Returns null when no live config matches.
//
//   applyIncentive({...}) → { incentiveTxn, tdsTxn? }
//     Composes the above + writes the ledger via postCredit / postDebit.
//     Idempotent on `parentLedgerId` — if a previous apply already wrote an
//     INCENTIVE_CREDIT row linked to the source TOPUP we short-circuit. The
//     worker calls this; the route handler does NOT (yet).
//
// Spec example, verified by the test suite:
//   deposit ₹1,00,000, 1% incentive, 2% TDS
//   → incentive = ₹1,000, tds = ₹20, net wallet credit = ₹980
//   → wallet after = ₹1,00,000 + ₹980 = ₹1,00,980

import { Money } from '@tripbng/shared';
import { AppError } from '@tripbng/shared';
import {
  DepositIncentiveConfig,
  type DepositIncentiveConfigDoc,
} from '../../models/DepositIncentiveConfig.js';
import { WalletTransaction, type WalletTransactionDoc } from '../../models/WalletTransaction.js';
import { Agency } from '../../models/Agency.js';
import { postCredit, postDebit } from './ledger.js';
import { logger } from '../../config/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pure compute
// ─────────────────────────────────────────────────────────────────────────────

export interface IncentiveCompute {
  /** Gross incentive in paise (before TDS). */
  incentivePaise: number;
  /** TDS withheld in paise. */
  tdsPaise: number;
  /** Net credit to wallet (= incentive − tds). */
  netCreditPaise: number;
  /**
   * When set, the deposit fails one of the eligibility gates and the worker
   * should write no ledger entries. `reason` is logged for observability.
   */
  skip?: 'INACTIVE' | 'BELOW_MIN' | 'ZERO_INCENTIVE';
}

/**
 * Pure: compute the incentive + TDS split for a deposit given the active
 * config. Caller decides what to do with the result (apply or skip).
 */
export function computeIncentive(
  config: Pick<
    DepositIncentiveConfigDoc,
    | 'isActive'
    | 'incentiveMode'
    | 'incentiveBasisPoints'
    | 'incentiveAbsolutePaise'
    | 'minDepositForIncentivePaise'
    | 'maxIncentivePerTxnPaise'
    | 'tdsApplicable'
    | 'tdsBasisPoints'
  >,
  depositPaise: number,
): IncentiveCompute {
  if (!config.isActive) {
    return { incentivePaise: 0, tdsPaise: 0, netCreditPaise: 0, skip: 'INACTIVE' };
  }
  if (
    config.minDepositForIncentivePaise != null &&
    depositPaise < config.minDepositForIncentivePaise
  ) {
    return { incentivePaise: 0, tdsPaise: 0, netCreditPaise: 0, skip: 'BELOW_MIN' };
  }

  const deposit = Money.fromNumberPaise(depositPaise);

  // Gross incentive — PERCENT vs ABSOLUTE branch.
  let incentive: bigint;
  if (config.incentiveMode === 'PERCENT') {
    const bp = config.incentiveBasisPoints ?? 0;
    incentive = Money.percentBasisPoints(deposit, bp);
  } else {
    incentive = Money.fromNumberPaise(config.incentiveAbsolutePaise ?? 0);
  }

  // Per-transaction cap.
  if (config.maxIncentivePerTxnPaise != null) {
    const cap = Money.fromNumberPaise(config.maxIncentivePerTxnPaise);
    incentive = Money.min(incentive, cap);
  }
  if (Money.isZero(incentive)) {
    return { incentivePaise: 0, tdsPaise: 0, netCreditPaise: 0, skip: 'ZERO_INCENTIVE' };
  }

  // TDS — rounded half-up on the gross incentive (Indian accounting standard).
  const tds = config.tdsApplicable
    ? Money.percentBasisPoints(incentive, config.tdsBasisPoints ?? 0)
    : Money.ZERO;
  const net = Money.sub(incentive, tds);

  return {
    incentivePaise: Money.toNumberPaise(incentive),
    tdsPaise: Money.toNumberPaise(tds),
    netCreditPaise: Money.toNumberPaise(net),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Active-config resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the active config for the given agency. Resolution preference:
 *   1. Per-agency row (agencyId = given), isActive, valid window covers `now`.
 *   2. Tenant-wide fallback (agencyId = null), isActive, valid window covers `now`.
 * Returns null when neither matches.
 */
export async function resolveActiveConfig(
  tenantId: string,
  agencyId: string,
  now: Date = new Date(),
): Promise<DepositIncentiveConfigDoc | null> {
  const baseFilter = {
    tenantId,
    isActive: true,
    validFrom: { $lte: now },
    $or: [{ validTo: null }, { validTo: { $gte: now } }],
  };
  const perAgency = await DepositIncentiveConfig.findOne({ ...baseFilter, agencyId });
  if (perAgency) return perAgency;
  return DepositIncentiveConfig.findOne({ ...baseFilter, agencyId: null });
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply (impure — writes ledger)
// ─────────────────────────────────────────────────────────────────────────────

export interface ApplyIncentiveInput {
  tenantId: string;
  agencyId: string;
  /** Original deposit amount in paise (from the upstream TOPUP). */
  depositPaise: number;
  /**
   * Ledger row id of the source TOPUP. The two new entries
   * (INCENTIVE_CREDIT + optional TDS_DEDUCT) carry this as `relatedTxnId`
   * so reports can group them, and the worker can detect a duplicate apply.
   */
  parentLedgerId: string;
  /** PG ref of the source deposit — surfaces in the new ledger rows too. */
  pgReferenceId?: string | null;
  /** User the worker attributes the entries to. Typically the agency owner. */
  performedBy: string;
}

export interface ApplyIncentiveResult {
  applied: boolean;
  /** Either the newly-posted entries, or empty when applied=false. */
  incentiveTxn?: WalletTransactionDoc;
  tdsTxn?: WalletTransactionDoc;
  /** Same shape `computeIncentive` returned (or null on skip). */
  compute: IncentiveCompute | null;
}

/**
 * Apply the incentive flow for one source TOPUP. Idempotent on
 * `parentLedgerId` — a second call (e.g. BullMQ retry, duplicate webhook)
 * finds the pre-existing INCENTIVE_CREDIT row and short-circuits.
 *
 * Returns `applied=false` when:
 *   - The agency isn't in DI module.
 *   - No active DepositIncentiveConfig matches.
 *   - The compute gate fired (inactive / below-min / zero-incentive).
 *   - A previous apply for the same parentLedgerId already wrote the rows.
 */
export async function applyIncentive(input: ApplyIncentiveInput): Promise<ApplyIncentiveResult> {
  // Idempotency — check first. The unique-ish anchor is (agencyId, relatedTxnId)
  // because the INCENTIVE_CREDIT row's `relatedTxnId` references the source TOPUP.
  const existing = await WalletTransaction.findOne({
    agencyId: input.agencyId,
    relatedTxnId: input.parentLedgerId,
    type: 'INCENTIVE_CREDIT',
  });
  if (existing) {
    return { applied: false, compute: null };
  }

  // Verify the agency is still in DI module — admin may have switched modules
  // between the deposit and the worker pickup. Don't apply incentive to a
  // CASH agency just because the queue happened to contain a stale job.
  const agency = await Agency.findById(input.agencyId).select('module tenantId').lean();
  if (!agency) throw new AppError('AGENCY_NOT_FOUND');
  if (agency.module !== 'DI') {
    logger.info(
      { agencyId: input.agencyId, currentModule: agency.module },
      'di-incentive: skipping — agency no longer in DI module',
    );
    return { applied: false, compute: null };
  }

  const config = await resolveActiveConfig(input.tenantId, input.agencyId);
  if (!config) {
    logger.info({ agencyId: input.agencyId }, 'di-incentive: no active config — skipping');
    return { applied: false, compute: null };
  }

  const compute = computeIncentive(config, input.depositPaise);
  if (compute.skip) {
    logger.info(
      {
        agencyId: input.agencyId,
        reason: compute.skip,
        depositPaise: input.depositPaise,
      },
      'di-incentive: gate fired — no entries posted',
    );
    return { applied: false, compute };
  }

  // Post the INCENTIVE_CREDIT first (CREDIT direction on WALLET bucket). The
  // ledger service handles locking + Mongo txn + dual-write to Agency cache
  // — we don't need to wrap again here.
  //
  // NOTE: pgReferenceId is intentionally NOT set on the incentive / TDS rows.
  // They're derived from the upstream TOPUP, not the gateway deposit directly
  // — the link to the gateway flows via relatedTxnId → TOPUP → pgReferenceId.
  // The compound (pgReferenceId, bucket) unique index would otherwise block
  // the TDS row (same pgRef + same WALLET bucket as the incentive row).
  const incentiveTxn = await postCredit({
    tenantId: input.tenantId,
    walletKind: 'AGENCY',
    walletOwnerId: input.agencyId,
    type: 'INCENTIVE_CREDIT',
    amountPaise: compute.incentivePaise,
    performedBy: input.performedBy,
    relatedTxnId: input.parentLedgerId,
    bucket: 'WALLET',
    description: 'DI module deposit incentive',
    metadata: {
      incentiveBasisPoints: config.incentiveBasisPoints ?? null,
      incentiveMode: config.incentiveMode,
      depositPaise: input.depositPaise,
      pgReferenceId: input.pgReferenceId ?? null,
    },
  });

  // TDS — separate DEBIT entry, linked back to the incentive via relatedTxnId
  // so the parent_incentive→tds relationship is unambiguous in reports.
  let tdsTxn: WalletTransactionDoc | undefined;
  if (compute.tdsPaise > 0) {
    tdsTxn = await postDebit({
      tenantId: input.tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: input.agencyId,
      type: 'TDS_DEDUCT',
      amountPaise: compute.tdsPaise,
      performedBy: input.performedBy,
      relatedTxnId: String(incentiveTxn._id),
      bucket: 'WALLET',
      description: `TDS @ ${(config.tdsBasisPoints ?? 0) / 100}% on incentive`,
      // TDS may push wallet temporarily into a sub-threshold zone for low
      // balances — never block on insufficient funds. The platform always
      // honors a posted incentive net of TDS, even if it means crossing 0.
      requireSufficientBalance: false,
      metadata: {
        tdsBasisPoints: config.tdsBasisPoints ?? null,
        incentiveTxnId: String(incentiveTxn._id),
        pgReferenceId: input.pgReferenceId ?? null,
      },
    });
  }

  logger.info(
    {
      agencyId: input.agencyId,
      parentLedgerId: input.parentLedgerId,
      depositPaise: input.depositPaise,
      incentivePaise: compute.incentivePaise,
      tdsPaise: compute.tdsPaise,
      netCreditPaise: compute.netCreditPaise,
    },
    'di-incentive: applied',
  );

  return { applied: true, incentiveTxn, tdsTxn, compute };
}
