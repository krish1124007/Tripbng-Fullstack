// Integration tests for the Mongo transaction helper + Wallet optimistic
// concurrency control.
//
// Hits real Mongo (replica set — required for multi-doc transactions). The
// vitest.config wires MONGO_URI to mongodb://localhost:27017/tripbng_test.
// Each test uses a unique walletCode so re-runs don't collide.

import crypto from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Wallet } from '../src/models/Wallet.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import {
  WalletVersionConflictError,
  updateWalletWithVersion,
  withMongoTxn,
} from '../src/utils/mongo-txn.js';

let tenantId: Types.ObjectId;

async function makeWallet(initialBalance = 0): Promise<{ id: Types.ObjectId; code: string }> {
  const code = `WAL-TEST-${crypto.randomBytes(6).toString('hex')}`;
  const doc = await Wallet.create({
    tenantId,
    agencyId: new Types.ObjectId(), // owner is irrelevant for these tests
    walletCode: code,
    balance: initialBalance,
    version: 0,
  });
  return { id: doc._id, code };
}

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `txn-test-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Txn Test Tenant',
    domain: 'txn.test',
  });
  tenantId = tenant._id;
});

beforeEach(async () => {
  // Clean slate between tests so cross-test rows can't pollute count assertions.
  await Wallet.deleteMany({ tenantId });
  await WalletTransaction.deleteMany({ tenantId });
});

afterAll(async () => {
  // Clean up only the rows this suite created (filter by tenant).
  await Wallet.deleteMany({ tenantId });
  await WalletTransaction.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

describe('withMongoTxn', () => {
  it('returns the value the callback returns', async () => {
    const result = await withMongoTxn(async () => 42);
    expect(result).toBe(42);
  });

  it('commits multi-doc writes atomically', async () => {
    const { id: walletId } = await makeWallet(0);
    await withMongoTxn(async (session) => {
      await updateWalletWithVersion(session, walletId, 0, {
        $set: { balance: 100_000 },
      });
      await WalletTransaction.create(
        [
          {
            tenantId,
            txnId: `TXN-${crypto.randomBytes(4).toString('hex')}`,
            direction: 'CREDIT',
            type: 'TOPUP',
            amount: 100_000,
            balanceAfter: 100_000,
            description: 'commits-test',
            userId: new Types.ObjectId(),
            performedBy: new Types.ObjectId(),
          },
        ],
        { session },
      );
    });

    const wallet = await Wallet.findById(walletId).lean();
    expect(wallet?.balance).toBe(100_000);
    expect(wallet?.version).toBe(1);
    const txns = await WalletTransaction.countDocuments({ description: 'commits-test' });
    expect(txns).toBe(1);
  });

  it('rolls back BOTH writes if the callback throws', async () => {
    const { id: walletId } = await makeWallet(50_000);
    await expect(
      withMongoTxn(async (session) => {
        await updateWalletWithVersion(session, walletId, 0, {
          $set: { balance: 100_000 },
        });
        await WalletTransaction.create(
          [
            {
              tenantId,
              txnId: `TXN-${crypto.randomBytes(4).toString('hex')}`,
              direction: 'CREDIT',
              type: 'TOPUP',
              amount: 50_000,
              balanceAfter: 100_000,
              description: 'should-rollback',
              userId: new Types.ObjectId(),
              performedBy: new Types.ObjectId(),
            },
          ],
          { session },
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // Wallet must still show original balance + version.
    const wallet = await Wallet.findById(walletId).lean();
    expect(wallet?.balance).toBe(50_000);
    expect(wallet?.version).toBe(0);
    // No ledger row written.
    const txns = await WalletTransaction.countDocuments({
      description: 'should-rollback',
    });
    expect(txns).toBe(0);
  });

  it('propagates the thrown error unchanged', async () => {
    class MyError extends Error {
      readonly code = 'MY_CODE';
    }
    await expect(
      withMongoTxn(async () => {
        throw new MyError('specific');
      }),
    ).rejects.toBeInstanceOf(MyError);
  });
});

describe('updateWalletWithVersion', () => {
  it('applies updates and bumps the version on a clean match', async () => {
    const { id: walletId } = await makeWallet(0);
    const updated = await withMongoTxn(async (session) =>
      updateWalletWithVersion(session, walletId, 0, {
        $set: { balance: 25_000 },
      }),
    );
    expect(updated.balance).toBe(25_000);
    expect(updated.version).toBe(1);
  });

  it('throws WalletVersionConflictError on stale version', async () => {
    const { id: walletId } = await makeWallet(0);
    // First write bumps version 0 → 1.
    await withMongoTxn(async (session) =>
      updateWalletWithVersion(session, walletId, 0, { $set: { balance: 10_000 } }),
    );
    // Second writer still thinks version is 0 — must conflict.
    await expect(
      withMongoTxn(async (session) =>
        updateWalletWithVersion(session, walletId, 0, { $set: { balance: 999 } }),
      ),
    ).rejects.toBeInstanceOf(WalletVersionConflictError);

    const wallet = await Wallet.findById(walletId).lean();
    // First writer's value preserved; second writer's value rejected.
    expect(wallet?.balance).toBe(10_000);
    expect(wallet?.version).toBe(1);
  });

  it('throws WalletVersionConflictError when the wallet does not exist', async () => {
    const fakeId = new Types.ObjectId();
    await expect(
      withMongoTxn(async (session) =>
        updateWalletWithVersion(session, fakeId, 0, { $set: { balance: 1 } }),
      ),
    ).rejects.toBeInstanceOf(WalletVersionConflictError);
  });

  it('merges caller $inc with the version bump (does not clobber)', async () => {
    const { id: walletId } = await makeWallet(0);
    const updated = await withMongoTxn(async (session) =>
      updateWalletWithVersion(session, walletId, 0, {
        $inc: { balance: 5_000, lifetimeTopupAmount: 5_000 },
      }),
    );
    expect(updated.balance).toBe(5_000);
    expect(updated.lifetimeTopupAmount).toBe(5_000);
    expect(updated.version).toBe(1);
  });

  it('error carries walletId + expectedVersion', async () => {
    const { id: walletId } = await makeWallet(0);
    await withMongoTxn(async (session) =>
      updateWalletWithVersion(session, walletId, 0, { $set: { balance: 1 } }),
    );
    try {
      await withMongoTxn(async (session) =>
        updateWalletWithVersion(session, walletId, 0, { $set: { balance: 2 } }),
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WalletVersionConflictError);
      expect((err as WalletVersionConflictError).walletId).toBe(String(walletId));
      expect((err as WalletVersionConflictError).expectedVersion).toBe(0);
    }
  });
});
