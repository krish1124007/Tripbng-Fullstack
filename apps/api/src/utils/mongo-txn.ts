// MongoDB multi-doc transaction helper + optimistic Wallet version check.
//
// Every wallet/credit/ledger mutation must:
//   1. Sit inside a Mongo transaction so the wallet update and the ledger
//      entry land atomically (or roll back together).
//   2. Use the Wallet `version` field for optimistic concurrency, so if a
//      stale `withWalletLock` lease let a second writer slip through, we
//      catch the conflict at commit time and surface a typed error.
//
// `withMongoTxn(fn)` opens a session, runs `fn(session)` inside
// `session.withTransaction`, and ends the session in a `finally`. The
// Mongoose API for transactions is awkward in two ways we paper over:
//
//   * `session.withTransaction(cb)` does not return cb's value. Callers
//     end up writing `let result; await … cb runs … result = x` boilerplate
//     every time. This helper does that for them.
//   * `withTransaction` retries the callback on transient errors (write
//     conflicts, primary stepdown) for up to 120s. That's fine — but the
//     callback MUST be idempotent. Inline comment warns at call site.
//
// `updateWalletWithVersion` performs an atomic compare-and-set on the
// Wallet doc, throwing `WalletVersionConflictError` if a concurrent
// writer already advanced the version.

import mongoose, { type ClientSession, type UpdateQuery, type Types } from 'mongoose';
import { Wallet, type WalletDoc } from '../models/Wallet.js';

export class WalletVersionConflictError extends Error {
  readonly walletId: string;
  readonly expectedVersion: number;
  constructor(walletId: string, expectedVersion: number) {
    super(
      `Wallet ${walletId} version conflict — expected v${expectedVersion}, was advanced by a concurrent writer`,
    );
    this.name = 'WalletVersionConflictError';
    this.walletId = walletId;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * Run `fn` inside a Mongoose transaction. Returns whatever `fn` returns.
 *
 * IMPORTANT: `fn` may be invoked more than once if Mongo flags a transient
 * error (WriteConflict, primary stepdown). Keep it idempotent — e.g. compute
 * a deterministic ledger txnId from input params, not from `Date.now()` /
 * `Math.random()` outside the callback.
 */
export async function withMongoTxn<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    // `withTransaction`'s callback return value is discarded by Mongoose, so
    // we stash the result in a closure.
    let result: T;
    let captured = false;
    await session.withTransaction(async () => {
      result = await fn(session);
      captured = true;
    });
    if (!captured) {
      // Defensive: should never happen — withTransaction either ran the cb to
      // completion or threw. If the cb threw, we wouldn't be here.
      throw new Error('withMongoTxn: callback did not complete');
    }
    // Non-null assertion is safe because `captured` proves the assignment ran.
    return result!;
  } finally {
    await session.endSession();
  }
}

/**
 * Atomically update a wallet document while asserting the expected version.
 * On match: applies `updates`, bumps `version` by 1, returns the post-update doc.
 * On mismatch (or doc not found): throws `WalletVersionConflictError`.
 *
 * The caller MUST run this inside `withMongoTxn` so the wallet update and the
 * accompanying ledger write share a transaction.
 *
 * Usage:
 *   await withMongoTxn(async (session) => {
 *     const wallet = await Wallet.findOne({ agencyId }).session(session);
 *     // ... compute new balances ...
 *     await updateWalletWithVersion(session, wallet._id, wallet.version, {
 *       $set: { balance: newBalance },
 *     });
 *     await WalletTransaction.create([{ ... }], { session });
 *   });
 */
export async function updateWalletWithVersion(
  session: ClientSession,
  walletId: Types.ObjectId | string,
  expectedVersion: number,
  updates: UpdateQuery<WalletDoc>,
): Promise<WalletDoc> {
  // Merge a $inc on `version` into the caller's update payload. We don't let
  // the caller pass version themselves — the contract is "I'll do the bump".
  const mergedUpdates: UpdateQuery<WalletDoc> = {
    ...updates,
    $inc: {
      ...(updates.$inc ?? {}),
      version: 1,
    },
  };

  const updated = await Wallet.findOneAndUpdate(
    { _id: walletId, version: expectedVersion },
    mergedUpdates,
    { new: true, session },
  );

  if (!updated) {
    throw new WalletVersionConflictError(String(walletId), expectedVersion);
  }
  return updated;
}
