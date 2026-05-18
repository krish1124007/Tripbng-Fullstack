// WalletService — the ONLY way to mutate wallet state. Spec §4.
//
// Atomicity: every credit/debit/transfer uses a Mongo session. Replica-set
// transactions are required in production; on a single-node dev DB, Mongoose
// silently skips the transaction — flagged in `assertReplicaSet()` and the
// boot log.
//
// Idempotency: every mutation accepts an `idempotencyKey`. The first call
// with a given key creates the WalletTransaction; replays return the same
// row without side effects.

import mongoose, { Types } from 'mongoose';
import { AppError, type WalletTxnType } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { Wallet, type WalletDoc } from '../../models/Wallet.js';
import { WalletTransaction, type WalletTransactionDoc } from '../../models/WalletTransaction.js';
import { Counter } from '../../models/Counter.js';

export interface CreditInput {
  walletId: Types.ObjectId;
  amount: number; // paise; must be > 0
  type: WalletTxnType;
  description: string;
  performedBy: Types.ObjectId | 'SYSTEM';
  bookingId?: Types.ObjectId | null;
  topupRequestId?: Types.ObjectId | null;
  paymentTransactionId?: Types.ObjectId | null;
  relatedTxnId?: Types.ObjectId | null;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface DebitInput extends Omit<CreditInput, 'topupRequestId'> {
  /** Allow debit beyond `balance` up to `creditLimit - creditUsed`. Default false. */
  allowCreditUtilization?: boolean;
}

export class WalletService {
  // ────────── Read ──────────

  async getWallet(walletId: Types.ObjectId): Promise<WalletDoc> {
    const w = await Wallet.findById(walletId);
    if (!w) throw new AppError('NOT_FOUND', { reason: `wallet ${walletId} not found` });
    return w;
  }

  async findOrCreateForAgency(
    tenantId: Types.ObjectId,
    agencyId: Types.ObjectId,
  ): Promise<WalletDoc> {
    let w = await Wallet.findOne({ tenantId, agencyId });
    if (w) return w;
    const walletCode = await nextWalletCode(tenantId);
    w = await Wallet.create({ tenantId, agencyId, walletCode });
    return w;
  }

  async findOrCreateForDistributor(
    tenantId: Types.ObjectId,
    distributorId: Types.ObjectId,
  ): Promise<WalletDoc> {
    let w = await Wallet.findOne({ tenantId, distributorId });
    if (w) return w;
    const walletCode = await nextWalletCode(tenantId);
    w = await Wallet.create({ tenantId, distributorId, walletCode });
    return w;
  }

  // ────────── Write ──────────

  async credit(input: CreditInput): Promise<WalletTransactionDoc> {
    if (input.amount <= 0) {
      throw new AppError('VALIDATION_ERROR', { reason: 'credit amount must be > 0' });
    }
    if (input.idempotencyKey) {
      const existing = await WalletTransaction.findOne({ txnId: input.idempotencyKey });
      if (existing) return existing;
    }
    return this.applyMutation({ ...input, direction: 'CREDIT' });
  }

  async debit(input: DebitInput): Promise<WalletTransactionDoc> {
    if (input.amount <= 0) {
      throw new AppError('VALIDATION_ERROR', { reason: 'debit amount must be > 0' });
    }
    if (input.idempotencyKey) {
      const existing = await WalletTransaction.findOne({ txnId: input.idempotencyKey });
      if (existing) return existing;
    }
    return this.applyMutation({ ...input, direction: 'DEBIT' });
  }

  async transfer(input: {
    fromWalletId: Types.ObjectId;
    toWalletId: Types.ObjectId;
    amount: number;
    description: string;
    performedBy: Types.ObjectId;
    idempotencyKey?: string;
  }): Promise<{ debitTxn: WalletTransactionDoc; creditTxn: WalletTransactionDoc }> {
    if (input.fromWalletId.equals(input.toWalletId)) {
      throw new AppError('VALIDATION_ERROR', { reason: 'cannot transfer to the same wallet' });
    }
    if (input.amount <= 0) {
      throw new AppError('VALIDATION_ERROR', { reason: 'transfer amount must be > 0' });
    }

    const idem = input.idempotencyKey;
    if (idem) {
      const existingDebit = await WalletTransaction.findOne({ txnId: `${idem}-d` });
      const existingCredit = await WalletTransaction.findOne({ txnId: `${idem}-c` });
      if (existingDebit && existingCredit) {
        return { debitTxn: existingDebit, creditTxn: existingCredit };
      }
    }

    // Write the debit first so the from-wallet can't go negative; then the credit.
    const debitTxn = await this.applyMutation({
      walletId: input.fromWalletId,
      amount: input.amount,
      type: 'TRANSFER_OUT',
      description: input.description,
      performedBy: input.performedBy,
      direction: 'DEBIT',
      idempotencyKey: idem ? `${idem}-d` : undefined,
    });
    try {
      const creditTxn = await this.applyMutation({
        walletId: input.toWalletId,
        amount: input.amount,
        type: 'TRANSFER_IN',
        description: input.description,
        performedBy: input.performedBy,
        direction: 'CREDIT',
        idempotencyKey: idem ? `${idem}-c` : undefined,
        relatedTxnId: debitTxn._id,
      });
      // Link the two — `relatedTxnId` set on debit too, post-credit.
      await WalletTransaction.collection.updateOne(
        { _id: debitTxn._id },
        { $set: { relatedTxnId: creditTxn._id } },
      );
      return { debitTxn, creditTxn };
    } catch (creditErr) {
      // Best-effort reversal of the debit — the source-of-truth is the ledger,
      // so we write a compensating credit, not a delete.
      logger.error(
        { err: creditErr, debitTxnId: debitTxn._id },
        'transfer credit leg failed — applying compensating credit',
      );
      await this.applyMutation({
        walletId: input.fromWalletId,
        amount: input.amount,
        type: 'TRANSFER_REVERSAL',
        description: `Reversal of failed transfer ${debitTxn.txnId}`,
        performedBy: input.performedBy,
        direction: 'CREDIT',
        relatedTxnId: debitTxn._id,
      });
      throw creditErr;
    }
  }

  /**
   * Block a portion of the wallet for an in-flight booking hold. Reversed
   * by `releaseBlock`, settled by `convertBlockToDebit`.
   */
  async blockBalance(walletId: Types.ObjectId, amount: number): Promise<WalletDoc> {
    const w = await this.getWallet(walletId);
    if (w.status !== 'ACTIVE') throw new AppError('VALIDATION_ERROR', { reason: 'wallet not active' });
    const available = (w.balance ?? 0) - (w.blockedBalance ?? 0);
    if (amount > available) {
      throw new AppError('INSUFFICIENT_WALLET', {
        required: amount,
        available,
        creditAvailable: (w.creditLimit ?? 0) - (w.creditUsed ?? 0),
      });
    }
    w.blockedBalance = (w.blockedBalance ?? 0) + amount;
    await w.save();
    return w;
  }

  async releaseBlock(walletId: Types.ObjectId, amount: number): Promise<WalletDoc> {
    const w = await this.getWallet(walletId);
    w.blockedBalance = Math.max(0, (w.blockedBalance ?? 0) - amount);
    await w.save();
    return w;
  }

  // ────────── Reconciliation ──────────

  /** Recompute Wallet.balance from the ledger. Logs drift, does not auto-correct. */
  async rebuildBalance(walletId: Types.ObjectId): Promise<{
    before: number;
    afterLedger: number;
    drift: number;
  }> {
    const w = await this.getWallet(walletId);
    const ownerFilter = w.agencyId
      ? { agencyId: w.agencyId }
      : w.distributorId
        ? { distributorId: w.distributorId }
        : { userId: w.userId };
    const sum = await WalletTransaction.aggregate<{ _id: null; total: number }>([
      { $match: { tenantId: w.tenantId, ...ownerFilter } },
      {
        $group: {
          _id: null,
          total: {
            $sum: { $cond: [{ $eq: ['$direction', 'CREDIT'] }, '$amount', { $multiply: ['$amount', -1] }] },
          },
        },
      },
    ]);
    const afterLedger = sum[0]?.total ?? 0;
    const before = w.balance ?? 0;
    const drift = before - afterLedger;
    if (drift !== 0) {
      logger.error(
        { walletId: walletId.toString(), before, afterLedger, drift },
        'WALLET-DRIFT — Wallet.balance disagrees with ledger sum',
      );
    }
    w.lastReconciledAt = new Date();
    w.lastReconciledBalance = afterLedger;
    await w.save();
    return { before, afterLedger, drift };
  }

  // ────────── Internals ──────────

  /**
   * The only place that writes a WalletTransaction + updates Wallet.balance.
   * Mongo transaction when a replica set is available; falls back to
   * non-atomic on single-node dev — the latter is logged loudly.
   */
  private async applyMutation(input: {
    walletId: Types.ObjectId;
    amount: number;
    type: WalletTxnType;
    description: string;
    performedBy: Types.ObjectId | 'SYSTEM';
    direction: 'CREDIT' | 'DEBIT';
    bookingId?: Types.ObjectId | null;
    topupRequestId?: Types.ObjectId | null;
    paymentTransactionId?: Types.ObjectId | null;
    relatedTxnId?: Types.ObjectId | null;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
    allowCreditUtilization?: boolean;
  }): Promise<WalletTransactionDoc> {
    const session = await startSessionSafe();
    const useTxn = !!session;

    try {
      if (useTxn) await session!.startTransaction();

      const wallet = await Wallet.findById(input.walletId).session(session ?? null);
      if (!wallet) {
        throw new AppError('NOT_FOUND', { reason: `wallet ${input.walletId} not found` });
      }
      if (wallet.status !== 'ACTIVE' && input.direction === 'DEBIT') {
        throw new AppError('VALIDATION_ERROR', { reason: 'wallet is not active' });
      }

      // Balance math.
      const currentBalance = wallet.balance ?? 0;
      const blocked = wallet.blockedBalance ?? 0;
      const creditLimit = wallet.creditLimit ?? 0;
      const creditUsed = wallet.creditUsed ?? 0;

      let nextBalance = currentBalance;
      if (input.direction === 'CREDIT') {
        nextBalance = currentBalance + input.amount;
      } else {
        const available = currentBalance - blocked;
        if (input.amount > available) {
          if (!input.allowCreditUtilization || input.amount - available > creditLimit - creditUsed) {
            throw new AppError('INSUFFICIENT_WALLET', {
              required: input.amount,
              available,
              creditAvailable: creditLimit - creditUsed,
            });
          }
        }
        nextBalance = currentBalance - input.amount;
      }

      // Insert ledger row (immutable).
      const txnId = input.idempotencyKey ?? `WT-${new Types.ObjectId().toHexString()}`;
      const [doc] = await WalletTransaction.create(
        [
          {
            tenantId: wallet.tenantId,
            txnId,
            userId: wallet.agencyId ?? wallet.distributorId ?? wallet.userId ?? input.performedBy,
            agencyId: wallet.agencyId ?? null,
            distributorId: wallet.distributorId ?? null,
            type: input.type,
            direction: input.direction,
            amount: input.amount,
            balanceAfter: nextBalance,
            bookingId: input.bookingId ?? null,
            topupRequestId: input.topupRequestId ?? null,
            relatedTxnId: input.relatedTxnId ?? null,
            description: input.description,
            performedBy:
              input.performedBy === 'SYSTEM' ? null : (input.performedBy as Types.ObjectId),
            metadata: {
              ...(input.metadata ?? {}),
              ...(input.paymentTransactionId
                ? { paymentTransactionId: input.paymentTransactionId.toString() }
                : {}),
            },
          },
        ],
        { session: session ?? undefined },
      );

      // Update Wallet cache. Optimistic-lock on `version` to catch concurrent
      // mutations that bypassed the session (shouldn't happen, but defensive).
      const updated = await Wallet.findOneAndUpdate(
        { _id: wallet._id, version: wallet.version },
        {
          $set: {
            balance: nextBalance,
            lastTransactionAt: new Date(),
            ...(input.type === 'TOPUP' ? { lastTopupAt: new Date() } : {}),
          },
          $inc: {
            version: 1,
            ...(input.type === 'TOPUP' ? { lifetimeTopupAmount: input.amount } : {}),
            ...(input.type === 'BOOKING_DEBIT' ? { lifetimeBookingAmount: input.amount } : {}),
          },
        },
        { new: true, session: session ?? undefined },
      );
      if (!updated) {
        throw new AppError('VALIDATION_ERROR', {
          reason: 'wallet version mismatch — concurrent mutation detected',
        });
      }

      if (useTxn) await session!.commitTransaction();
      return doc!;
    } catch (err) {
      if (useTxn && session?.inTransaction()) await session.abortTransaction();
      throw err;
    } finally {
      if (session) await session.endSession();
    }
  }
}

async function startSessionSafe(): Promise<mongoose.ClientSession | null> {
  try {
    const session = await mongoose.startSession();
    return session;
  } catch (err) {
    logger.warn({ err }, 'Mongo session unavailable — running non-atomic (single-node dev?)');
    return null;
  }
}

async function nextWalletCode(tenantId: Types.ObjectId): Promise<string> {
  const c = await Counter.findOneAndUpdate(
    { _id: `wallet-${tenantId.toHexString()}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return `W${String(c.seq).padStart(6, '0')}`;
}

export const walletService = new WalletService();
