// WaterfallService — payment-application waterfall per spec §3.1.
//
// When a gateway confirms a deposit for an agency, this service decides where
// the money goes:
//
//   if agency.module == 'CREDIT' and wallet.creditUsed > 0:
//       settle credit first   -> CREDIT_SETTLEMENT (bucket=CREDIT, DEBIT)
//       remainder -> wallet   -> TOPUP            (bucket=WALLET, CREDIT)
//   else:
//       full amount -> wallet -> TOPUP            (bucket=WALLET, CREDIT)
//
// For module='DI' the waterfall just credits the wallet here; the
// async-incentive worker (Phase-2) reads `CreditSettlement` rows and posts
// the INCENTIVE / TDS ledger entries separately.
//
// Concurrency story (the same belt-and-suspenders the ledger uses):
//   * Per-agency Redis lock — queues concurrent webhook deliveries.
//   * Mongo multi-doc transaction — atomic commit of Wallet update +
//     Agency cache update + ledger row(s) + CreditSettlement snapshot.
//   * Optimistic `Wallet.version` — catches a lock-lost mid-flight race.
//   * Idempotency on `pgReferenceId` — fast-path check BEFORE the lock so
//     duplicate webhooks short-circuit without contending.
//
// Integration TODO (Phase-1.5 / Phase-2):
//   `paymentService.markSuccess` currently calls `walletService.credit`,
//   which only knows about CASH-style topups. Switching it to call
//   `applyPayment` here will activate the waterfall for CREDIT-module
//   agencies. That swap is deferred so it can land in its own focused PR
//   with the relevant payment-flow tests; this service is standalone-ready
//   and tested in isolation.

import { Money } from '@tripbng/shared';
import { AppError, type AgencyModule } from '@tripbng/shared';
import type { ClientSession, Types } from 'mongoose';
import { Agency } from '../../models/Agency.js';
import { Wallet, type WalletDoc } from '../../models/Wallet.js';
import {
  WalletTransaction,
  type WalletTransactionDoc,
} from '../../models/WalletTransaction.js';
import { CreditSettlement, type CreditSettlementDoc } from '../../models/CreditSettlement.js';
import { logger } from '../../config/logger.js';
import { nextCode } from '../../utils/codes.js';
import { withWalletLock } from '../../utils/wallet-lock.js';
import { updateWalletWithVersion, withMongoTxn } from '../../utils/mongo-txn.js';
import { CODE_PREFIX } from '@tripbng/shared';
import { enqueueDiIncentive } from '../../queues/di-incentive.worker.js';
import { getDiIncentiveQueue } from '../../queues/index.js';

export type PgGateway = 'ICICI_ORANGE_PG' | 'PHONEPE' | 'MANUAL';

export interface ApplyPaymentInput {
  tenantId: string;
  agencyId: string;
  /** Amount the gateway confirmed, in paise. Must be a positive integer. */
  amountPaise: number;
  /** Gateway transaction id — used for idempotency + audit linkage. */
  pgReferenceId: string;
  pgGateway: PgGateway;
  /**
   * User the deposit is attributed to in the ledger. For automated webhook
   * paths this is typically the agency owner; for manual postings it's the
   * admin who initiated the credit.
   */
  performedBy: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ApplyPaymentResult {
  /** True = this call did the work. False = idempotent short-circuit. */
  applied: boolean;
  /** The settlement snapshot row (existing or newly-created). */
  settlement: CreditSettlementDoc;
  /** Ledger rows written by this call (empty when applied=false). */
  ledgerEntries: WalletTransactionDoc[];
}

/**
 * Run the payment waterfall for a single gateway deposit. Idempotent on
 * `(tenantId, agencyId, pgReferenceId)` — a duplicate webhook returns the
 * pre-existing `CreditSettlement` snapshot without re-applying the split.
 */
export async function applyPayment(input: ApplyPaymentInput): Promise<ApplyPaymentResult> {
  validateInput(input);

  // Fast-path idempotency check — avoids the lock + txn on the common case
  // of a duplicate webhook delivery. Race-safe because the inside-the-txn
  // path checks again under the lock before mutating anything.
  const existing = await CreditSettlement.findOne({
    tenantId: input.tenantId,
    agencyId: input.agencyId,
    pgReferenceId: input.pgReferenceId,
  });
  if (existing) {
    return { applied: false, settlement: existing, ledgerEntries: [] };
  }

  // Mint the txn codes outside the lock (each `nextCode` hits the counter
  // collection, which has its own atomic increment).
  const creditTxnId = await nextCode(CODE_PREFIX.WALLET_TXN);
  const topupTxnId = await nextCode(CODE_PREFIX.WALLET_TXN);

  const result = await withWalletLock(input.agencyId, async () =>
    withMongoTxn(async (session): Promise<ApplyPaymentResult> => {
      // Re-check inside the lock+txn — protects against two concurrent
      // webhooks both passing the fast-path check at the same instant.
      const winnerCheck = await CreditSettlement.findOne({
        tenantId: input.tenantId,
        agencyId: input.agencyId,
        pgReferenceId: input.pgReferenceId,
      }).session(session);
      if (winnerCheck) {
        return { applied: false, settlement: winnerCheck, ledgerEntries: [] };
      }

      const { agency, wallet, module } = await loadAgencyAndWallet(session, input);
      const totalReceived = Money.fromNumberPaise(input.amountPaise);
      const walletBefore = Money.fromNumberPaise(wallet.balance ?? 0);
      const creditUsedBefore = Money.fromNumberPaise(wallet.creditUsed ?? 0);

      // Decide the split. CREDIT module with outstanding credit splits;
      // every other module sends the full amount to the wallet.
      let toCredit = Money.ZERO;
      let toWallet = totalReceived;
      if (module === 'CREDIT' && Money.isPositive(creditUsedBefore)) {
        toCredit = Money.min(totalReceived, creditUsedBefore);
        toWallet = Money.sub(totalReceived, toCredit);
      }

      const ledgerEntries: WalletTransactionDoc[] = [];

      // Leg A — settle outstanding credit (CREDIT bucket, DEBIT direction:
      // we're decreasing what's owed).
      if (Money.isPositive(toCredit)) {
        const creditBefore = creditUsedBefore;
        const creditAfter = Money.sub(creditBefore, toCredit);
        await updateWalletWithVersion(session, wallet._id, wallet.version ?? 0, {
          $inc: { creditUsed: -Money.toNumberPaise(toCredit) },
        });
        // Refetch the version we just bumped — second updateWalletWithVersion
        // (for the wallet leg below) needs the new version.
        wallet.version = (wallet.version ?? 0) + 1;

        const created = await WalletTransaction.create(
          [
            {
              tenantId: input.tenantId,
              txnId: creditTxnId,
              userId: input.performedBy,
              agencyId: input.agencyId,
              type: 'CREDIT_SETTLEMENT',
              direction: 'DEBIT',
              amount: Money.toNumberPaise(toCredit),
              bucket: 'CREDIT',
              balanceBefore: Money.toNumberPaise(creditBefore),
              balanceAfter: Money.toNumberPaise(creditAfter),
              pgReferenceId: input.pgReferenceId,
              description: input.description ?? `Credit settlement via ${input.pgGateway}`,
              performedBy: input.performedBy,
              metadata: {
                ...(input.metadata ?? {}),
                pgGateway: input.pgGateway,
              },
            },
          ],
          { session },
        );
        ledgerEntries.push(created[0]!);
      }

      // Leg B — top up wallet with the remainder (WALLET bucket, CREDIT
      // direction). Always runs when there's a remainder, regardless of module.
      if (Money.isPositive(toWallet)) {
        const setUpdates: Record<string, unknown> = {
          lastTransactionAt: new Date(),
          lastTopupAt: new Date(),
        };
        await updateWalletWithVersion(session, wallet._id, wallet.version ?? 0, {
          $inc: {
            balance: Money.toNumberPaise(toWallet),
            lifetimeTopupAmount: Money.toNumberPaise(toWallet),
          },
          $set: setUpdates,
        });
        // Dual-write to legacy Agency cache — same back-compat strategy
        // as `services/wallet/ledger.ts`.
        await Agency.updateOne(
          { _id: input.agencyId },
          { $inc: { walletBalance: Money.toNumberPaise(toWallet) } },
          { session },
        );

        const created = await WalletTransaction.create(
          [
            {
              tenantId: input.tenantId,
              txnId: topupTxnId,
              userId: input.performedBy,
              agencyId: input.agencyId,
              type: 'TOPUP',
              direction: 'CREDIT',
              amount: Money.toNumberPaise(toWallet),
              bucket: 'WALLET',
              balanceBefore: Money.toNumberPaise(walletBefore),
              balanceAfter: Money.toNumberPaise(Money.add(walletBefore, toWallet)),
              pgReferenceId: input.pgReferenceId,
              description: input.description ?? `Wallet top-up via ${input.pgGateway}`,
              performedBy: input.performedBy,
              metadata: {
                ...(input.metadata ?? {}),
                pgGateway: input.pgGateway,
              },
            },
          ],
          { session },
        );
        ledgerEntries.push(created[0]!);
      }

      // Snapshot row — captures the split for reporting + as the idempotency
      // anchor (unique on (tenant, agency, pgReferenceId)).
      const creditAfter = Money.sub(creditUsedBefore, toCredit);
      const walletAfter = Money.add(walletBefore, toWallet);
      const settlement = await CreditSettlement.create(
        [
          {
            tenantId: input.tenantId,
            agencyId: input.agencyId,
            pgReferenceId: input.pgReferenceId,
            pgGateway: input.pgGateway,
            amountReceived: Money.toNumberPaise(totalReceived),
            amountAppliedToCredit: Money.toNumberPaise(toCredit),
            amountAppliedToWallet: Money.toNumberPaise(toWallet),
            creditBalanceBefore: Money.toNumberPaise(creditUsedBefore),
            creditBalanceAfter: Money.toNumberPaise(creditAfter),
            walletBalanceBefore: Money.toNumberPaise(walletBefore),
            walletBalanceAfter: Money.toNumberPaise(walletAfter),
            ledgerEntryIds: ledgerEntries.map((e) => e._id),
            agencyModuleAtTime: module,
          },
        ],
        { session },
      );

      logger.info(
        {
          agencyId: input.agencyId,
          module,
          amountReceivedPaise: Money.toNumberPaise(totalReceived),
          appliedToCreditPaise: Money.toNumberPaise(toCredit),
          appliedToWalletPaise: Money.toNumberPaise(toWallet),
          pgReferenceId: input.pgReferenceId,
          pgGateway: input.pgGateway,
        },
        'waterfall: payment applied',
      );

      // Make sure non-null. Agency is unused downstream — referenced here to
      // satisfy the linter for the loadAgencyAndWallet result.
      void agency;

      return { applied: true, settlement: settlement[0]!, ledgerEntries };
    }),
  );

  // Post-commit hooks. Only fires for first-time application (applied=true);
  // duplicate webhooks short-circuited before the txn so we don't re-enqueue.
  if (result.applied) {
    await maybeEnqueueDiIncentive(input, result);
  }

  return result;
}

/**
 * If the agency is in DI module and the wallet leg of this payment is non-zero,
 * enqueue the async incentive worker. We do this AFTER the txn commits so a
 * rolled-back deposit never triggers an incentive — at-least-once delivery,
 * idempotent at the worker layer.
 */
async function maybeEnqueueDiIncentive(
  input: ApplyPaymentInput,
  result: ApplyPaymentResult,
): Promise<void> {
  if (result.settlement.agencyModuleAtTime !== 'DI') return;
  if (result.settlement.amountAppliedToWallet <= 0) return;
  const topupEntry = result.ledgerEntries.find((e) => e.type === 'TOPUP');
  if (!topupEntry) return;

  try {
    await enqueueDiIncentive(getDiIncentiveQueue(), {
      tenantId: input.tenantId,
      agencyId: input.agencyId,
      depositPaise: result.settlement.amountAppliedToWallet,
      parentLedgerId: String(topupEntry._id),
      pgReferenceId: input.pgReferenceId,
      performedBy: input.performedBy,
      source: 'waterfall',
    });
  } catch (err) {
    // Enqueue failure must not roll back the deposit. The integrity-check
    // cron and a future replay tool will catch the orphan TOPUP without an
    // incentive companion — for now, log loud so ops sees the gap.
    logger.error(
      { err, agencyId: input.agencyId, parentLedgerId: String(topupEntry._id) },
      'waterfall: enqueueDiIncentive failed — deposit committed without incentive job',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function validateInput(input: ApplyPaymentInput): void {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'amountPaise must be a positive integer',
    });
  }
  if (!input.pgReferenceId) {
    throw new AppError('VALIDATION_ERROR', { reason: 'pgReferenceId is required' });
  }
}

interface LoadResult {
  agency: { _id: Types.ObjectId; module: AgencyModule };
  wallet: WalletDoc;
  module: AgencyModule;
}

async function loadAgencyAndWallet(
  session: ClientSession,
  input: ApplyPaymentInput,
): Promise<LoadResult> {
  const agency = await Agency.findById(input.agencyId)
    .select('_id module')
    .session(session)
    .lean();
  if (!agency) throw new AppError('AGENCY_NOT_FOUND');
  const module = (agency.module ?? 'CASH') as AgencyModule;

  let wallet = await Wallet.findOne({ agencyId: input.agencyId }).session(session);
  if (!wallet) {
    // Same lazy-create policy as ledger.ts — covers any agency that hasn't
    // been backfilled yet. Loud warning so ops notices the gap.
    const created = await Wallet.create(
      [
        {
          tenantId: input.tenantId,
          agencyId: input.agencyId,
          walletCode: `AUTO-AGENCY-${input.agencyId}`,
          balance: 0,
          version: 0,
        },
      ],
      { session },
    );
    wallet = created[0]!;
    logger.warn(
      { agencyId: input.agencyId },
      'waterfall: auto-created Wallet doc — run scripts/backfill-wallet-collection',
    );
  }

  return {
    agency: { _id: agency._id, module },
    wallet,
    module,
  };
}
