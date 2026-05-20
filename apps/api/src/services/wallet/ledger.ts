// Wallet ledger service — atomic credit/debit + immutable ledger row.
//
// Phase-1 step 6 migration (gap-analysis Conflict 1, Option A):
//   * `Wallet` is now the source of truth for balance + optimistic `version`.
//   * `Agency.walletBalance` / `Distributor.walletBalance` are STILL written
//     (dual-write) so existing read paths keep working until the reader-side
//     migration lands in a later phase.
//   * Every mutation is wrapped in `withWalletLock` (serialises per-wallet
//     concurrent callers) and `withMongoTxn` (commits the Wallet update, the
//     legacy cache update, and the ledger row atomically). Optimistic
//     `Wallet.version` is the inner-most safety net via `updateWalletWithVersion`.
//
// Backward compatibility:
//   The public surface (`postCredit`, `postDebit`, `getWalletBalance`,
//   `serializeTxn`) is unchanged. Callers don't know about Wallet vs Agency;
//   they just see correct behaviour.
//
// Recovery from missing Wallet doc:
//   The backfill script (`scripts/backfill-wallet-collection.ts`) creates
//   Wallet docs for every existing Agency + Distributor. If a fresh agency
//   is somehow created without a Wallet doc, we auto-create one inside the
//   first ledger call AND log a loud warning so ops notices the gap in the
//   agency-creation pipeline.

import { CODE_PREFIX, type WalletTxnType } from '@tripbng/shared';
import { AppError } from '@tripbng/shared';
import { Agency } from '../../models/Agency.js';
import { Distributor } from '../../models/Distributor.js';
import { Wallet, type WalletDoc } from '../../models/Wallet.js';
import { WalletTransaction, type WalletTransactionDoc } from '../../models/WalletTransaction.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { nextCode } from '../../utils/codes.js';
import { withWalletLock } from '../../utils/wallet-lock.js';
import { updateWalletWithVersion, withMongoTxn } from '../../utils/mongo-txn.js';
import { enqueueAlert } from '../alerts/index.js';
import type { ClientSession } from 'mongoose';

export type WalletKind = 'AGENCY' | 'DISTRIBUTOR';

export interface PostEntryInput {
  tenantId: string;
  walletKind: WalletKind;
  walletOwnerId: string;
  type: WalletTxnType;
  amountPaise: number;
  performedBy: string;

  bookingId?: string | null;
  topupRequestId?: string | null;
  amendmentId?: string | null;
  relatedTxnId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;

  // For DEBIT: when false, allow balance to go negative (admin override /
  // refund recovery). Ignored for CREDIT.
  requireSufficientBalance?: boolean;

  // Phase-1 step 5 additions. Pass through when the caller knows them (e.g.
  // the upcoming WaterfallService needs to tag CREDIT-bucket entries and
  // attach the PG reference id for idempotency).
  bucket?: 'WALLET' | 'CREDIT';
  pgReferenceId?: string | null;
}

/**
 * Atomically credit a wallet. Wallet (primary) + legacy cache + ledger row
 * are committed in a single Mongo transaction, serialised per-owner via the
 * Redis wallet lock.
 */
export async function postCredit(input: PostEntryInput): Promise<WalletTransactionDoc> {
  validateAmount(input.amountPaise);
  return applyLedgerEntry({ ...input, direction: 'CREDIT' });
}

/**
 * Atomically debit a wallet. Same atomicity guarantees as `postCredit`.
 * Throws `INSUFFICIENT_WALLET` when balance would go negative and
 * `requireSufficientBalance !== false`.
 */
export async function postDebit(input: PostEntryInput): Promise<WalletTransactionDoc> {
  validateAmount(input.amountPaise);
  return applyLedgerEntry({ ...input, direction: 'DEBIT' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function validateAmount(amountPaise: number): void {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'amountPaise must be a positive integer' });
  }
}

interface ApplyArgs extends PostEntryInput {
  direction: 'CREDIT' | 'DEBIT';
}

async function applyLedgerEntry(args: ApplyArgs): Promise<WalletTransactionDoc> {
  const delta = args.direction === 'CREDIT' ? args.amountPaise : -args.amountPaise;
  const requireSufficient = args.direction === 'DEBIT' && (args.requireSufficientBalance ?? true);
  // Mint the txn code OUTSIDE the lock — `nextCode` hits its own counter
  // collection and shouldn't extend the critical section.
  const txnId = await nextCode(CODE_PREFIX.WALLET_TXN);

  type LowBalanceArgs = { balanceAfter: number; threshold: number };
  interface ApplyResult {
    txn: WalletTransactionDoc;
    lowBalance: LowBalanceArgs | null;
  }

  const result = await withWalletLock(args.walletOwnerId, async () =>
    withMongoTxn(async (session): Promise<ApplyResult> => {
      const wallet = await ensureWallet(session, args);
      const balanceBefore = wallet.balance ?? 0;
      if (requireSufficient && balanceBefore < args.amountPaise) {
        throw new AppError('INSUFFICIENT_WALLET');
      }

      const balanceAfter = balanceBefore + delta;

      // 1. Primary write — Wallet, with optimistic version check. The helper
      //    throws WalletVersionConflictError if a concurrent writer slipped
      //    through the lock (rare — lock TTL expired before we got here).
      const now = new Date();
      const setUpdates: Record<string, unknown> = { lastTransactionAt: now };
      if (args.type === 'TOPUP') setUpdates.lastTopupAt = now;
      const incUpdates: Record<string, number> = { balance: delta };
      if (args.type === 'TOPUP' && args.direction === 'CREDIT') {
        incUpdates.lifetimeTopupAmount = args.amountPaise;
      } else if (args.type === 'BOOKING_DEBIT' && args.direction === 'DEBIT') {
        incUpdates.lifetimeBookingAmount = args.amountPaise;
      }
      await updateWalletWithVersion(session, wallet._id, wallet.version ?? 0, {
        $inc: incUpdates,
        $set: setUpdates,
      });

      // 2. Secondary write — legacy cache on Agency/Distributor. Same delta,
      //    same session. Reader-side migration (step 6c) will eventually
      //    delete this, but until then existing UI code keeps working.
      if (args.walletKind === 'AGENCY') {
        await Agency.updateOne(
          { _id: args.walletOwnerId },
          { $inc: { walletBalance: delta } },
          { session },
        );
      } else {
        await Distributor.updateOne(
          { _id: args.walletOwnerId },
          { $inc: { walletBalance: delta } },
          { session },
        );
      }

      // 3. Ledger entry — immutable, includes pre/post balances + bucket so
      //    the integrity cron can verify the sum against Wallet.balance.
      const created = await WalletTransaction.create(
        [
          {
            tenantId: args.tenantId,
            txnId,
            userId: args.performedBy,
            agencyId: args.walletKind === 'AGENCY' ? args.walletOwnerId : null,
            distributorId: args.walletKind === 'DISTRIBUTOR' ? args.walletOwnerId : null,
            type: args.type,
            direction: args.direction,
            amount: args.amountPaise,
            bucket: args.bucket ?? 'WALLET',
            balanceBefore,
            balanceAfter,
            bookingId: args.bookingId ?? null,
            topupRequestId: args.topupRequestId ?? null,
            amendmentId: args.amendmentId ?? null,
            relatedTxnId: args.relatedTxnId ?? null,
            pgReferenceId: args.pgReferenceId ?? null,
            description: args.description ?? null,
            performedBy: args.performedBy,
            ipAddress: args.ipAddress ?? null,
            metadata: args.metadata ?? null,
          },
        ],
        { session },
      );
      const txn = created[0]!;

      // Stage low-balance alert; we'll enqueue AFTER the txn commits so a
      // failed enqueue can't roll back the ledger write.
      let lowBalance: LowBalanceArgs | null = null;
      if (args.direction === 'DEBIT' && args.walletKind === 'AGENCY') {
        const agency = await Agency.findById(args.walletOwnerId)
          .select('notificationPrefs')
          .session(session)
          .lean();
        const agencyOverride = agency?.notificationPrefs?.lowBalanceThresholdPaise ?? null;
        const threshold = agencyOverride ?? env.LOW_WALLET_THRESHOLD_PAISE;
        if (threshold > 0 && balanceBefore >= threshold && balanceAfter < threshold) {
          lowBalance = { balanceAfter, threshold };
        }
      }
      return { txn, lowBalance };
    }),
  );

  if (result.lowBalance) {
    void enqueueLowBalanceAlert(args, result.lowBalance.balanceAfter, result.lowBalance.threshold);
  }
  return result.txn;
}

/**
 * Look up the Wallet doc for the given owner. Lazy-create on miss with the
 * current legacy cache value as the opening balance — covers any
 * just-promoted agency that hasn't been backfilled yet. Loud warning so the
 * gap in the agency-creation pipeline is visible.
 */
async function ensureWallet(session: ClientSession, args: ApplyArgs): Promise<WalletDoc> {
  const filter = args.walletKind === 'AGENCY'
    ? { agencyId: args.walletOwnerId }
    : { distributorId: args.walletOwnerId };
  const existing = await Wallet.findOne(filter).session(session);
  if (existing) return existing;

  // No Wallet doc — opening balance comes from the legacy cache so we don't
  // accidentally double-count. The walletCode is derived from the owner id
  // (not the shared counter) so it stays unique even when callers reset the
  // Counter collection in tests without resetting Wallet.
  const opening = await readLegacyOpeningBalance(args.walletKind, args.walletOwnerId, session);
  const walletCode = `AUTO-${args.walletKind}-${args.walletOwnerId}`;
  const created = await Wallet.create(
    [
      {
        tenantId: args.tenantId,
        agencyId: args.walletKind === 'AGENCY' ? args.walletOwnerId : null,
        distributorId: args.walletKind === 'DISTRIBUTOR' ? args.walletOwnerId : null,
        walletCode,
        balance: opening,
        version: 0,
      },
    ],
    { session },
  );
  logger.warn(
    {
      walletKind: args.walletKind,
      ownerId: args.walletOwnerId,
      openingBalancePaise: opening,
    },
    'wallet.ledger: auto-created Wallet doc — run scripts/backfill-wallet-collection',
  );
  return created[0]!;
}

async function readLegacyOpeningBalance(
  kind: WalletKind,
  ownerId: string,
  session: ClientSession,
): Promise<number> {
  if (kind === 'AGENCY') {
    const a = await Agency.findById(ownerId)
      .select('walletBalance')
      .session(session)
      .lean();
    if (!a) throw new AppError('AGENCY_NOT_FOUND');
    return a.walletBalance ?? 0;
  }
  const d = await Distributor.findById(ownerId)
    .select('walletBalance')
    .session(session)
    .lean();
  if (!d) throw new AppError('DISTRIBUTOR_NOT_FOUND');
  return d.walletBalance ?? 0;
}

async function enqueueLowBalanceAlert(
  input: PostEntryInput,
  balanceAfter: number,
  threshold: number,
): Promise<void> {
  try {
    const baseUrl = env.API_BASE_URL.replace(/\/$/, '');
    await enqueueAlert(
      {
        event: 'LOW_WALLET_BALANCE',
        vars: {
          walletBalancePaise: balanceAfter,
          thresholdPaise: threshold,
          topupUrl: `${baseUrl}/wallet/topup`,
        },
      },
      [{ kind: 'agency', id: input.walletOwnerId }],
      {
        tenantId: input.tenantId,
        correlationKey: `low-balance:${input.walletOwnerId}`,
      },
    );
  } catch (err) {
    logger.warn({ err, agencyId: input.walletOwnerId }, 'low-balance alert enqueue failed');
  }
}

export async function getWalletBalance(
  kind: WalletKind,
  ownerId: string,
): Promise<{ balancePaise: number; creditLimitPaise: number; outstandingPaise: number }> {
  // Prefer the Wallet collection (single source of truth from Phase-1 step 6).
  // Fall back to the legacy Agency/Distributor cache for the brief window
  // where a Wallet doc may not yet exist (pre-backfill or test fixtures).
  if (kind === 'AGENCY') {
    const wallet = await Wallet.findOne({ agencyId: ownerId }).select('balance').lean();
    const agency = await Agency.findById(ownerId).select(
      'walletBalance creditLimit outstandingAmount',
    );
    if (!agency) throw new AppError('AGENCY_NOT_FOUND');
    return {
      balancePaise: wallet?.balance ?? agency.walletBalance ?? 0,
      creditLimitPaise: agency.creditLimit ?? 0,
      outstandingPaise: agency.outstandingAmount ?? 0,
    };
  }
  const wallet = await Wallet.findOne({ distributorId: ownerId }).select('balance').lean();
  const dist = await Distributor.findById(ownerId).select('walletBalance creditLimit');
  if (!dist) throw new AppError('DISTRIBUTOR_NOT_FOUND');
  return {
    balancePaise: wallet?.balance ?? dist.walletBalance ?? 0,
    creditLimitPaise: dist.creditLimit ?? 0,
    outstandingPaise: 0,
  };
}

export function serializeTxn(t: WalletTransactionDoc) {
  return {
    id: String(t._id),
    txnId: t.txnId,
    userId: String(t.userId),
    agencyId: t.agencyId ? String(t.agencyId) : null,
    distributorId: t.distributorId ? String(t.distributorId) : null,
    type: t.type,
    direction: t.direction,
    amountPaise: t.amount,
    balanceAfterPaise: t.balanceAfter,
    currency: t.currency ?? 'INR',
    bookingId: t.bookingId ? String(t.bookingId) : null,
    topupRequestId: t.topupRequestId ? String(t.topupRequestId) : null,
    amendmentId: t.amendmentId ? String(t.amendmentId) : null,
    relatedTxnId: t.relatedTxnId ? String(t.relatedTxnId) : null,
    description: t.description,
    performedBy: t.performedBy ? String(t.performedBy) : null,
    metadata: t.metadata ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

