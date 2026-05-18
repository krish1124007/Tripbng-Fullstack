import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Distributor } from '../src/models/Distributor.js';
import { User } from '../src/models/User.js';
import { Counter } from '../src/models/Counter.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { TopupRequest } from '../src/models/TopupRequest.js';
import { getWalletBalance, postCredit, postDebit } from '../src/services/wallet/ledger.js';
import { distributorTransferToAgency } from '../src/services/wallet/transfer.js';
import { adjustWallet } from '../src/services/wallet/adjust.js';
import { approveManualTopup, initiateTopup, rejectTopup } from '../src/services/wallet/topup.js';

// Switch the test DB so we never trample dev data. Each test file uses a distinct DB so
// vitest's parallel runner doesn't have files stomping on each other's collections.
process.env.MONGO_URI = 'mongodb://localhost:27017/tripbng_b2b_test_wallet';

let tenantId: string;
let userId: string;
let agencyId: string;
let agencyId2: string;
let distributorId: string;

async function reset(): Promise<void> {
  await Promise.all([
    WalletTransaction.deleteMany({}),
    TopupRequest.deleteMany({}),
    Agency.deleteMany({}),
    Distributor.deleteMany({}),
    Tenant.deleteMany({}),
    User.deleteMany({}),
    Counter.deleteMany({}),
  ]);

  const tenant = await Tenant.create({ code: 'test', name: 'Test' });
  tenantId = String(tenant._id);

  const user = await User.create({
    tenantId,
    userCode: 'TST000001',
    role: 'SUPER_ADMIN',
    email: 'admin@test.dev',
    mobile: '+910000000001',
    fullName: 'Test Admin',
    passwordHash: 'x'.repeat(60),
    status: 'ACTIVE',
  });
  userId = String(user._id);

  const distributor = await Distributor.create({
    tenantId,
    distributorCode: 'D000001',
    companyName: 'Test Distributor',
    state: 'Maharashtra',
    city: 'Mumbai',
    pincode: '400001',
    address: '1 St',
    ownerUserId: user._id,
    walletBalance: 0,
    status: 'ACTIVE',
  });
  distributorId = String(distributor._id);

  const agency = await Agency.create({
    tenantId,
    agencyCode: 'AT000001',
    companyName: 'Test Agency 1',
    state: 'Maharashtra',
    city: 'Pune',
    pincode: '411001',
    address: '2 St',
    distributorId: distributor._id,
    ownerUserId: user._id,
    walletBalance: 0,
    status: 'ACTIVE',
  });
  agencyId = String(agency._id);

  const agency2 = await Agency.create({
    tenantId,
    agencyCode: 'AT000002',
    companyName: 'Test Agency 2 (no distributor)',
    state: 'Karnataka',
    city: 'Bengaluru',
    pincode: '560001',
    address: '3 St',
    ownerUserId: user._id,
    walletBalance: 0,
    status: 'ACTIVE',
  });
  agencyId2 = String(agency2._id);
}

beforeAll(async () => {
  await connectMongo();
});
afterAll(async () => {
  await disconnectMongo();
});
beforeEach(async () => {
  await reset();
});

const ctx = (): {
  tenantId: string;
  userId: string;
  role: 'SUPER_ADMIN';
  agencyId: null;
  distributorId: null;
  ipAddress: null;
} => ({
  tenantId,
  userId,
  role: 'SUPER_ADMIN',
  agencyId: null,
  distributorId: null,
  ipAddress: null,
});

describe('ledger - postCredit/postDebit', () => {
  it('credits an agency wallet and writes an immutable txn', async () => {
    const txn = await postCredit({
      tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
      type: 'TOPUP',
      amountPaise: 100_000,
      performedBy: userId,
    });
    expect(txn.balanceAfter).toBe(100_000);
    const balance = await getWalletBalance('AGENCY', agencyId);
    expect(balance.balancePaise).toBe(100_000);
  });

  it('debits an agency wallet only when balance is sufficient', async () => {
    await postCredit({
      tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
      type: 'TOPUP',
      amountPaise: 50_000,
      performedBy: userId,
    });
    const debit = await postDebit({
      tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
      type: 'BOOKING_DEBIT',
      amountPaise: 30_000,
      performedBy: userId,
    });
    expect(debit.balanceAfter).toBe(20_000);
  });

  it('throws INSUFFICIENT_WALLET when debit exceeds balance', async () => {
    await postCredit({
      tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
      type: 'TOPUP',
      amountPaise: 10_000,
      performedBy: userId,
    });
    await expect(
      postDebit({
        tenantId,
        walletKind: 'AGENCY',
        walletOwnerId: agencyId,
        type: 'BOOKING_DEBIT',
        amountPaise: 50_000,
        performedBy: userId,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_WALLET' });

    // Balance unchanged.
    const balance = await getWalletBalance('AGENCY', agencyId);
    expect(balance.balancePaise).toBe(10_000);
  });

  it('admin debit can override balance check (negative balance allowed)', async () => {
    const debit = await postDebit({
      tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
      type: 'ADJUSTMENT_DEBIT',
      amountPaise: 5_000,
      performedBy: userId,
      requireSufficientBalance: false,
    });
    expect(debit.balanceAfter).toBe(-5_000);
  });

  it('rejects amount that is not a positive integer', async () => {
    await expect(
      postCredit({
        tenantId,
        walletKind: 'AGENCY',
        walletOwnerId: agencyId,
        type: 'TOPUP',
        amountPaise: 0,
        performedBy: userId,
      }),
    ).rejects.toThrow();
    await expect(
      postCredit({
        tenantId,
        walletKind: 'AGENCY',
        walletOwnerId: agencyId,
        type: 'TOPUP',
        amountPaise: 100.5,
        performedBy: userId,
      }),
    ).rejects.toThrow();
  });

  it('wallet transactions are immutable — save throws on update', async () => {
    const txn = await postCredit({
      tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
      type: 'TOPUP',
      amountPaise: 1000,
      performedBy: userId,
    });
    txn.amount = 999;
    await expect(txn.save()).rejects.toThrow(/immutable/i);
    await expect(
      WalletTransaction.findByIdAndUpdate(txn._id, { $set: { amount: 1 } }),
    ).rejects.toThrow(/immutable/i);
  });

  it('credits a distributor wallet', async () => {
    const txn = await postCredit({
      tenantId,
      walletKind: 'DISTRIBUTOR',
      walletOwnerId: distributorId,
      type: 'TOPUP',
      amountPaise: 200_000,
      performedBy: userId,
    });
    expect(txn.balanceAfter).toBe(200_000);
    const b = await getWalletBalance('DISTRIBUTOR', distributorId);
    expect(b.balancePaise).toBe(200_000);
  });

  it('balance equals sum of credits minus debits in createdAt order', async () => {
    for (const amt of [100, 200, 300]) {
      await postCredit({
        tenantId,
        walletKind: 'AGENCY',
        walletOwnerId: agencyId,
        type: 'TOPUP',
        amountPaise: amt,
        performedBy: userId,
      });
    }
    await postDebit({
      tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
      type: 'BOOKING_DEBIT',
      amountPaise: 150,
      performedBy: userId,
    });
    const txns = await WalletTransaction.find({ agencyId }).sort({ createdAt: 1 });
    const replayed = txns.reduce(
      (s, t) => s + (t.direction === 'CREDIT' ? t.amount : -t.amount),
      0,
    );
    const balance = await getWalletBalance('AGENCY', agencyId);
    expect(replayed).toBe(balance.balancePaise);
    expect(txns[txns.length - 1]!.balanceAfter).toBe(balance.balancePaise);
  });

  it('throws AGENCY_NOT_FOUND when wallet owner does not exist', async () => {
    const fakeId = new Types.ObjectId().toString();
    await expect(
      postCredit({
        tenantId,
        walletKind: 'AGENCY',
        walletOwnerId: fakeId,
        type: 'TOPUP',
        amountPaise: 100,
        performedBy: userId,
      }),
    ).rejects.toMatchObject({ code: 'AGENCY_NOT_FOUND' });
  });
});

describe('transfer - distributor → agency', () => {
  it('debits distributor and credits agency atomically', async () => {
    await postCredit({
      tenantId,
      walletKind: 'DISTRIBUTOR',
      walletOwnerId: distributorId,
      type: 'TOPUP',
      amountPaise: 500_000,
      performedBy: userId,
    });
    const result = await distributorTransferToAgency(ctx(), agencyId, 75_000, 'monthly funding');
    expect(result.debitTxnId).toBeTruthy();
    expect(result.creditTxnId).toBeTruthy();

    const distBal = await getWalletBalance('DISTRIBUTOR', distributorId);
    const agBal = await getWalletBalance('AGENCY', agencyId);
    expect(distBal.balancePaise).toBe(425_000);
    expect(agBal.balancePaise).toBe(75_000);
  });

  it('rejects when distributor lacks balance', async () => {
    await expect(distributorTransferToAgency(ctx(), agencyId, 100_000)).rejects.toMatchObject({
      code: 'INSUFFICIENT_WALLET',
    });
  });

  it('rejects when target agency has no distributor', async () => {
    await postCredit({
      tenantId,
      walletKind: 'DISTRIBUTOR',
      walletOwnerId: distributorId,
      type: 'TOPUP',
      amountPaise: 500_000,
      performedBy: userId,
    });
    await expect(distributorTransferToAgency(ctx(), agencyId2, 1000)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('credit-leg links to debit-leg via relatedTxnId', async () => {
    await postCredit({
      tenantId,
      walletKind: 'DISTRIBUTOR',
      walletOwnerId: distributorId,
      type: 'TOPUP',
      amountPaise: 500_000,
      performedBy: userId,
    });
    const r = await distributorTransferToAgency(ctx(), agencyId, 1000);
    const credit = await WalletTransaction.findById(r.creditTxnId);
    expect(String(credit?.relatedTxnId)).toBe(r.debitTxnId);
  });
});

describe('topup lifecycle', () => {
  it('manual topup creates PENDING and approves to APPROVED with ledger entry', async () => {
    const { topup } = await initiateTopup(
      { ...ctx(), agencyId, role: 'AGENCY' },
      {
        amountPaise: 50_000,
        paymentMode: 'BANK',
        referenceNumber: 'BANK-TXN-1',
      },
    );
    expect(topup.status).toBe('PENDING');

    const approved = await approveManualTopup(ctx(), String(topup._id), 'verified');
    expect(approved.status).toBe('APPROVED');
    expect(approved.walletTxnId).toBeTruthy();

    const balance = await getWalletBalance('AGENCY', agencyId);
    expect(balance.balancePaise).toBe(50_000);
  });

  it('rejecting a pending topup does not credit the wallet', async () => {
    const { topup } = await initiateTopup(
      { ...ctx(), agencyId, role: 'AGENCY' },
      {
        amountPaise: 50_000,
        paymentMode: 'BANK',
        referenceNumber: 'BANK-TXN-2',
      },
    );
    const rejected = await rejectTopup(ctx(), String(topup._id), 'invalid receipt');
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('invalid receipt');

    const balance = await getWalletBalance('AGENCY', agencyId);
    expect(balance.balancePaise).toBe(0);
  });

  it('approving a non-pending topup throws', async () => {
    const { topup } = await initiateTopup(
      { ...ctx(), agencyId, role: 'AGENCY' },
      {
        amountPaise: 1_000,
        paymentMode: 'CASH',
      },
    );
    await approveManualTopup(ctx(), String(topup._id));
    await expect(approveManualTopup(ctx(), String(topup._id))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('admin adjustment', () => {
  it('credit adjustment increases balance', async () => {
    await adjustWallet(ctx(), {
      direction: 'CREDIT',
      amountPaise: 25_000,
      reason: 'test compensation',
      agencyId,
    });
    const b = await getWalletBalance('AGENCY', agencyId);
    expect(b.balancePaise).toBe(25_000);
  });

  it('debit adjustment can drive balance negative (admin override)', async () => {
    await adjustWallet(ctx(), {
      direction: 'DEBIT',
      amountPaise: 5_000,
      reason: 'clawback',
      agencyId,
    });
    const b = await getWalletBalance('AGENCY', agencyId);
    expect(b.balancePaise).toBe(-5_000);
  });
});

// Quiet vitest if no test DB is reachable — leave a marker so CI surfaces it.
describe('mongo connectivity', () => {
  it('connection is open', () => {
    expect(mongoose.connection.readyState).toBe(1);
  });
});
