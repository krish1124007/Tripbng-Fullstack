// Phase-3 tests for the distributor → sub-agent transfer flow.
//
// Covers:
//   - Below-threshold fast-path: status COMPLETED, both ledger legs landed.
//   - Above-threshold gating: status PENDING_APPROVAL until admin approves.
//   - Admin approve/reject: state machine + audit trail.
//   - Authorisation: distributor can only transfer to its own downline.
//   - Insufficient balance: FAILED status, distributor wallet unchanged.
//   - Idempotency: repeat call on COMPLETED row is a no-op.
//   - Concurrent transfers serialise per-distributor (dual-lock check).
//
// Integration test — touches real Mongo + Redis (same shared infra as the
// rest of the wallet suite).

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type { Role } from '@tripbng/shared';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Distributor } from '../src/models/Distributor.js';
import { Wallet } from '../src/models/Wallet.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { DistributorTransfer } from '../src/models/DistributorTransfer.js';
import { Counter } from '../src/models/Counter.js';
import {
  approveTransfer,
  rejectTransfer,
  requestTransfer,
  type ActorContext,
} from '../src/services/wallet/distributor-transfer.service.js';
import { env } from '../src/config/env.js';

let tenantId: Types.ObjectId;
const adminId = new Types.ObjectId();

const THRESHOLD = env.DISTRIBUTOR_TRANSFER_APPROVAL_THRESHOLD_PAISE;

async function makeDistributor(walletBalance: number): Promise<Types.ObjectId> {
  const distId = new Types.ObjectId();
  await Distributor.create({
    _id: distId,
    tenantId,
    distributorCode: `DT-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Test Distributor',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    ownerUserId: new Types.ObjectId(),
    walletBalance,
    status: 'ACTIVE',
  });
  await Wallet.create({
    tenantId,
    distributorId: distId,
    walletCode: `WAL-DIST-${crypto.randomBytes(4).toString('hex')}`,
    balance: walletBalance,
    version: 0,
  });
  return distId;
}

async function makeAgency(
  distributorId: Types.ObjectId | null,
  walletBalance = 0,
): Promise<Types.ObjectId> {
  const agencyId = new Types.ObjectId();
  await Agency.create({
    _id: agencyId,
    tenantId,
    agencyCode: `DT-AG-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Test Agency',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    walletBalance,
    distributorId,
    module: 'CASH',
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  await Wallet.create({
    tenantId,
    agencyId,
    walletCode: `WAL-AG-${crypto.randomBytes(4).toString('hex')}`,
    balance: walletBalance,
    version: 0,
  });
  return agencyId;
}

function distributorCtx(distributorId: string): ActorContext {
  return {
    tenantId: String(tenantId),
    userId: String(new Types.ObjectId()),
    role: 'DISTRIBUTOR' as Role,
    distributorId,
  };
}

function adminCtx(): ActorContext {
  return {
    tenantId: String(tenantId),
    userId: String(adminId),
    role: 'SUPER_ADMIN' as Role,
  };
}

beforeAll(async () => {
  await connectMongo();
  await Counter.deleteMany({});
  await WalletTransaction.deleteMany({});
  const tenant = await Tenant.create({
    code: `dt-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Distributor Transfer Tenant',
    domain: 'dt.test',
  });
  tenantId = tenant._id;
});

afterAll(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await DistributorTransfer.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Distributor.deleteMany({ tenantId });
  await Counter.deleteMany({});
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await DistributorTransfer.deleteMany({ tenantId });
  await WalletTransaction.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Distributor.deleteMany({ tenantId });
});

describe('requestTransfer — fast-path (below threshold)', () => {
  it('executes synchronously, both wallets move atomically', async () => {
    const distId = await makeDistributor(100_000);
    const agencyId = await makeAgency(distId, 0);

    const { transfer, executed } = await requestTransfer(distributorCtx(String(distId)), {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: 30_000,
    });

    expect(executed).toBe(true);
    expect(transfer.status).toBe('COMPLETED');
    expect(transfer.approvalRequired).toBe(false);
    expect(transfer.outLedgerId).toBeTruthy();
    expect(transfer.inLedgerId).toBeTruthy();

    const distWallet = await Wallet.findOne({ distributorId: distId }).lean();
    const agencyWallet = await Wallet.findOne({ agencyId }).lean();
    expect(distWallet?.balance).toBe(70_000);
    expect(agencyWallet?.balance).toBe(30_000);
  });

  it('writes the two ledger legs with linked relatedTxnId', async () => {
    const distId = await makeDistributor(100_000);
    const agencyId = await makeAgency(distId, 0);
    const { transfer } = await requestTransfer(distributorCtx(String(distId)), {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: 25_000,
    });
    const out = await WalletTransaction.findById(transfer.outLedgerId).lean();
    const inLedger = await WalletTransaction.findById(transfer.inLedgerId).lean();
    expect(out?.type).toBe('TRANSFER_OUT');
    expect(out?.direction).toBe('DEBIT');
    expect(out?.amount).toBe(25_000);
    expect(inLedger?.type).toBe('TRANSFER_IN');
    expect(inLedger?.direction).toBe('CREDIT');
    expect(inLedger?.relatedTxnId?.toString()).toBe(String(out?._id));
  });

  it('FAILED status on insufficient balance, distributor wallet unchanged', async () => {
    const distId = await makeDistributor(5_000);
    const agencyId = await makeAgency(distId, 0);

    await expect(
      requestTransfer(distributorCtx(String(distId)), {
        distributorId: String(distId),
        agencyId: String(agencyId),
        amountPaise: 10_000,
      }),
    ).rejects.toThrow();

    const distWallet = await Wallet.findOne({ distributorId: distId }).lean();
    const agencyWallet = await Wallet.findOne({ agencyId }).lean();
    expect(distWallet?.balance).toBe(5_000);
    expect(agencyWallet?.balance).toBe(0);
    const failed = await DistributorTransfer.findOne({ status: 'FAILED' });
    expect(failed?.failureReason).toBeTruthy();
  });
});

describe('requestTransfer — approval gating (above threshold)', () => {
  it('stages PENDING_APPROVAL with no wallet movement', async () => {
    const distId = await makeDistributor(THRESHOLD + 100_000);
    const agencyId = await makeAgency(distId, 0);
    const above = THRESHOLD + 10_000;

    const { transfer, executed } = await requestTransfer(distributorCtx(String(distId)), {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: above,
    });
    expect(executed).toBe(false);
    expect(transfer.status).toBe('PENDING_APPROVAL');
    expect(transfer.approvalRequired).toBe(true);
    expect(transfer.outLedgerId).toBeNull();
    expect(transfer.inLedgerId).toBeNull();

    // Wallets untouched until admin approves.
    const distWallet = await Wallet.findOne({ distributorId: distId }).lean();
    const agencyWallet = await Wallet.findOne({ agencyId }).lean();
    expect(distWallet?.balance).toBe(THRESHOLD + 100_000);
    expect(agencyWallet?.balance).toBe(0);
  });

  it('admin approve runs the legs, status → COMPLETED', async () => {
    const distId = await makeDistributor(THRESHOLD + 100_000);
    const agencyId = await makeAgency(distId, 0);
    const above = THRESHOLD + 10_000;
    const { transfer } = await requestTransfer(distributorCtx(String(distId)), {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: above,
    });

    const approved = await approveTransfer(adminCtx(), String(transfer._id));
    expect(approved.status).toBe('COMPLETED');
    expect(approved.approvedBy?.toString()).toBe(String(adminId));
    expect(approved.outLedgerId).toBeTruthy();

    const distWallet = await Wallet.findOne({ distributorId: distId }).lean();
    const agencyWallet = await Wallet.findOne({ agencyId }).lean();
    expect(distWallet?.balance).toBe(THRESHOLD + 100_000 - above);
    expect(agencyWallet?.balance).toBe(above);
  });

  it('admin reject leaves wallets untouched and records reason', async () => {
    const distId = await makeDistributor(THRESHOLD + 100_000);
    const agencyId = await makeAgency(distId, 0);
    const { transfer } = await requestTransfer(distributorCtx(String(distId)), {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: THRESHOLD + 10_000,
    });

    const rejected = await rejectTransfer(adminCtx(), String(transfer._id), 'over-budget');
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('over-budget');

    const distWallet = await Wallet.findOne({ distributorId: distId }).lean();
    const agencyWallet = await Wallet.findOne({ agencyId }).lean();
    expect(distWallet?.balance).toBe(THRESHOLD + 100_000);
    expect(agencyWallet?.balance).toBe(0);
  });

  it('approve is idempotent on already-COMPLETED transfer', async () => {
    const distId = await makeDistributor(100_000);
    const agencyId = await makeAgency(distId, 0);
    const { transfer } = await requestTransfer(distributorCtx(String(distId)), {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: 10_000, // below threshold, executes immediately
    });
    // Admin "approves" an already-completed one — should be a no-op.
    const again = await approveTransfer(adminCtx(), String(transfer._id));
    expect(again.status).toBe('COMPLETED');
    // Wallet should not double-debit.
    const distWallet = await Wallet.findOne({ distributorId: distId }).lean();
    expect(distWallet?.balance).toBe(90_000);
  });

  it('rejecting a COMPLETED transfer is refused', async () => {
    const distId = await makeDistributor(100_000);
    const agencyId = await makeAgency(distId, 0);
    const { transfer } = await requestTransfer(distributorCtx(String(distId)), {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: 10_000,
    });
    await expect(rejectTransfer(adminCtx(), String(transfer._id), 'too late')).rejects.toThrow();
  });
});

describe('requestTransfer — authorisation', () => {
  it('distributor cannot transfer to an agency outside its downline', async () => {
    const distA = await makeDistributor(100_000);
    const distB = await makeDistributor(100_000);
    const agencyOfB = await makeAgency(distB, 0);

    await expect(
      requestTransfer(distributorCtx(String(distA)), {
        distributorId: String(distA),
        agencyId: String(agencyOfB),
        amountPaise: 5_000,
      }),
    ).rejects.toThrow();
  });

  it('distributor cannot pose as another distributor', async () => {
    const distA = await makeDistributor(100_000);
    const distB = await makeDistributor(100_000);
    const agencyOfB = await makeAgency(distB, 0);

    // distA's ctx, but they target distB's row.
    await expect(
      requestTransfer(distributorCtx(String(distA)), {
        distributorId: String(distB),
        agencyId: String(agencyOfB),
        amountPaise: 5_000,
      }),
    ).rejects.toThrow();
  });

  it('SUPER_ADMIN may transfer on behalf of any distributor', async () => {
    const distId = await makeDistributor(100_000);
    const agencyId = await makeAgency(distId, 0);
    const { transfer } = await requestTransfer(adminCtx(), {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: 10_000,
    });
    expect(transfer.status).toBe('COMPLETED');
  });
});

describe('requestTransfer — input validation', () => {
  it('rejects zero/negative amount', async () => {
    const distId = await makeDistributor(100_000);
    const agencyId = await makeAgency(distId, 0);
    await expect(
      requestTransfer(distributorCtx(String(distId)), {
        distributorId: String(distId),
        agencyId: String(agencyId),
        amountPaise: 0,
      }),
    ).rejects.toThrow();
  });
});

describe('concurrent transfers — dual-lock', () => {
  it('two concurrent transfers for the same pair serialise without deadlock', async () => {
    const distId = await makeDistributor(50_000);
    const agencyId = await makeAgency(distId, 0);

    // Both transfers want 20k. Distributor has 50k. Both should succeed.
    const ctx = distributorCtx(String(distId));
    const [a, b] = await Promise.all([
      requestTransfer(ctx, {
        distributorId: String(distId),
        agencyId: String(agencyId),
        amountPaise: 20_000,
      }),
      requestTransfer(ctx, {
        distributorId: String(distId),
        agencyId: String(agencyId),
        amountPaise: 20_000,
      }),
    ]);
    expect(a.transfer.status).toBe('COMPLETED');
    expect(b.transfer.status).toBe('COMPLETED');
    const distWallet = await Wallet.findOne({ distributorId: distId }).lean();
    const agencyWallet = await Wallet.findOne({ agencyId }).lean();
    expect(distWallet?.balance).toBe(10_000);
    expect(agencyWallet?.balance).toBe(40_000);
  });

  it('concurrent transfers that exceed balance: one succeeds, one FAILs', async () => {
    const distId = await makeDistributor(30_000);
    const agencyId = await makeAgency(distId, 0);
    const ctx = distributorCtx(String(distId));

    const results = await Promise.allSettled([
      requestTransfer(ctx, {
        distributorId: String(distId),
        agencyId: String(agencyId),
        amountPaise: 20_000,
      }),
      requestTransfer(ctx, {
        distributorId: String(distId),
        agencyId: String(agencyId),
        amountPaise: 20_000,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const distWallet = await Wallet.findOne({ distributorId: distId }).lean();
    expect(distWallet?.balance).toBe(10_000);
  });
});

afterEach(async () => {
  // Cleanup explicit per-test residuals — overlapping with beforeEach is
  // belt-and-braces; the suite has caused leaks in past iterations.
});
