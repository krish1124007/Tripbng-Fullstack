import { CODE_PREFIX, type WalletTxnType } from '@tripbng/shared';
import { AppError } from '@tripbng/shared';
import { Agency, type AgencyDoc } from '../../models/Agency.js';
import { Distributor, type DistributorDoc } from '../../models/Distributor.js';
import { WalletTransaction, type WalletTransactionDoc } from '../../models/WalletTransaction.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { nextCode } from '../../utils/codes.js';
import { enqueueAlert } from '../alerts/index.js';

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

  // For DEBIT: when false, allow balance to go negative (admin override / refund recovery).
  requireSufficientBalance?: boolean;
}

// postCredit — atomic: increment balance, then write the immutable ledger entry.
// If the ledger write fails after the increment lands we shout in logs and rely on
// reconciliation since balance is the projection of the ledger anyway.
export async function postCredit(input: PostEntryInput): Promise<WalletTransactionDoc> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'amountPaise must be a positive integer' });
  }
  const updated = await incrementBalance(input.walletKind, input.walletOwnerId, input.amountPaise);
  return writeLedger({ ...input, direction: 'CREDIT', balanceAfter: walletBalance(updated) });
}

// postDebit — atomic: only decrement if balance is sufficient (when required). Throws
// INSUFFICIENT_WALLET when the row doesn't match the $gte condition.
export async function postDebit(input: PostEntryInput): Promise<WalletTransactionDoc> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'amountPaise must be a positive integer' });
  }
  const requireSufficient = input.requireSufficientBalance ?? true;
  const updated = await decrementBalance(
    input.walletKind,
    input.walletOwnerId,
    input.amountPaise,
    requireSufficient,
  );
  if (!updated) throw new AppError('INSUFFICIENT_WALLET');
  const balanceAfter = walletBalance(updated);
  const balanceBefore = balanceAfter + input.amountPaise;

  // Low-balance check — fire ONLY on the threshold crossing (was >= threshold,
  // now < threshold). Avoids spamming on every subsequent debit while balance
  // stays low. Agency wallets only — distributor wallets aren't customer-facing.
  if (input.walletKind === 'AGENCY') {
    // `updated` here is an AgencyDoc when walletKind === 'AGENCY'. Pull its
    // per-agency override (if any) — falls back to the env default.
    const agencyOverride =
      (updated as AgencyDoc).notificationPrefs?.lowBalanceThresholdPaise ?? null;
    const threshold = agencyOverride ?? env.LOW_WALLET_THRESHOLD_PAISE;
    if (
      threshold > 0 &&
      balanceBefore >= threshold &&
      balanceAfter < threshold
    ) {
      void enqueueLowBalanceAlert(input, balanceAfter, threshold);
    }
  }

  return writeLedger({ ...input, direction: 'DEBIT', balanceAfter });
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
          // Frontend route — agency dashboard's top-up flow lives here.
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

async function incrementBalance(
  kind: WalletKind,
  ownerId: string,
  amount: number,
): Promise<AgencyDoc | DistributorDoc> {
  if (kind === 'AGENCY') {
    const a = await Agency.findOneAndUpdate(
      { _id: ownerId },
      { $inc: { walletBalance: amount } },
      { new: true },
    );
    if (!a) throw new AppError('AGENCY_NOT_FOUND');
    return a as AgencyDoc;
  }
  const d = await Distributor.findOneAndUpdate(
    { _id: ownerId },
    { $inc: { walletBalance: amount } },
    { new: true },
  );
  if (!d) throw new AppError('DISTRIBUTOR_NOT_FOUND');
  return d as DistributorDoc;
}

async function decrementBalance(
  kind: WalletKind,
  ownerId: string,
  amount: number,
  requireSufficient: boolean,
): Promise<AgencyDoc | DistributorDoc | null> {
  const filter: Record<string, unknown> = { _id: ownerId };
  if (requireSufficient) filter.walletBalance = { $gte: amount };
  if (kind === 'AGENCY') {
    return (await Agency.findOneAndUpdate(
      filter,
      { $inc: { walletBalance: -amount } },
      { new: true },
    )) as AgencyDoc | null;
  }
  return (await Distributor.findOneAndUpdate(
    filter,
    { $inc: { walletBalance: -amount } },
    { new: true },
  )) as DistributorDoc | null;
}

function walletBalance(doc: AgencyDoc | DistributorDoc): number {
  return doc.walletBalance ?? 0;
}

async function writeLedger(
  args: PostEntryInput & { direction: 'CREDIT' | 'DEBIT'; balanceAfter: number },
): Promise<WalletTransactionDoc> {
  const txnId = await nextCode(CODE_PREFIX.WALLET_TXN);
  try {
    const doc = await WalletTransaction.create({
      tenantId: args.tenantId,
      txnId,
      userId: args.performedBy,
      agencyId: args.walletKind === 'AGENCY' ? args.walletOwnerId : null,
      distributorId: args.walletKind === 'DISTRIBUTOR' ? args.walletOwnerId : null,
      type: args.type,
      direction: args.direction,
      amount: args.amountPaise,
      balanceAfter: args.balanceAfter,
      bookingId: args.bookingId ?? null,
      topupRequestId: args.topupRequestId ?? null,
      amendmentId: args.amendmentId ?? null,
      relatedTxnId: args.relatedTxnId ?? null,
      description: args.description ?? null,
      performedBy: args.performedBy,
      ipAddress: args.ipAddress ?? null,
      metadata: args.metadata ?? null,
    });
    return doc;
  } catch (err) {
    // The balance has already moved. Log loud — operator must reconcile from the audit trail.
    logger.fatal({ err, args }, 'wallet.ledger write failed AFTER balance change — RECONCILE NOW');
    throw err;
  }
}

export async function getWalletBalance(
  kind: WalletKind,
  ownerId: string,
): Promise<{ balancePaise: number; creditLimitPaise: number; outstandingPaise: number }> {
  if (kind === 'AGENCY') {
    const a = await Agency.findById(ownerId).select('walletBalance creditLimit outstandingAmount');
    if (!a) throw new AppError('AGENCY_NOT_FOUND');
    return {
      balancePaise: a.walletBalance ?? 0,
      creditLimitPaise: a.creditLimit ?? 0,
      outstandingPaise: a.outstandingAmount ?? 0,
    };
  }
  const d = await Distributor.findById(ownerId).select('walletBalance creditLimit');
  if (!d) throw new AppError('DISTRIBUTOR_NOT_FOUND');
  return {
    balancePaise: d.walletBalance ?? 0,
    creditLimitPaise: d.creditLimit ?? 0,
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
