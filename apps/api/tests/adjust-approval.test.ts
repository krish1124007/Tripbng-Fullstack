// Phase-7 tests for the two-person wallet-adjustment approval flow.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@tripbng/shared';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Wallet } from '../src/models/Wallet.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { PendingAdjustment } from '../src/models/PendingAdjustment.js';
import { Counter } from '../src/models/Counter.js';
import {
  approveAdjustment,
  cancelAdjustment,
  proposeAdjustment,
  rejectAdjustment,
  type AdjustApprovalContext,
} from '../src/services/wallet/adjust-approval.service.js';
import { env } from '../src/config/env.js';

let tenantId: Types.ObjectId;
const THRESHOLD = env.WALLET_ADJUSTMENT_APPROVAL_THRESHOLD_PAISE;

function adminCtx(): AdjustApprovalContext {
  return {
    tenantId: String(tenantId),
    userId: String(new Types.ObjectId()),
    role: 'SUPER_ADMIN' as Role,
  };
}

function distributorCtx(): AdjustApprovalContext {
  return {
    tenantId: String(tenantId),
    userId: String(new Types.ObjectId()),
    role: 'DISTRIBUTOR' as Role,
  };
}

async function makeAgency(walletBalance = 0): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await Agency.create({
    _id: id,
    tenantId,
    agencyCode: `AA-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Adjust Approval Test',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    walletBalance,
    module: 'CASH',
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  await Wallet.create({
    tenantId,
    agencyId: id,
    walletCode: `WAL-AA-${crypto.randomBytes(4).toString('hex')}`,
    balance: walletBalance,
    version: 0,
  });
  return id;
}

beforeAll(async () => {
  await connectMongo();
  await Counter.deleteMany({});
  await WalletTransaction.deleteMany({});
  const t = await Tenant.create({
    code: `aa-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Adjust Approval',
    domain: 'aa.test',
  });
  tenantId = t._id;
});

afterAll(async () => {
  await PendingAdjustment.deleteMany({ tenantId });
  await WalletTransaction.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Counter.deleteMany({});
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await PendingAdjustment.deleteMany({ tenantId });
  await WalletTransaction.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
});

describe('proposeAdjustment — below threshold', () => {
  it('executes immediately when amount ≤ threshold', async () => {
    const agencyId = await makeAgency(0);
    const result = await proposeAdjustment(adminCtx(), {
      direction: 'CREDIT',
      amountPaise: THRESHOLD, // exactly at threshold = below-or-equal
      reason: 'compensation',
      agencyId: String(agencyId),
    });
    expect(result.executed).toBe(true);
    expect(result.ledgerTxnId).toBeTruthy();
    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.balance).toBe(THRESHOLD);
    // No PendingAdjustment row written.
    const pending = await PendingAdjustment.countDocuments({ tenantId });
    expect(pending).toBe(0);
  });

  it('DEBIT below threshold also executes immediately', async () => {
    const agencyId = await makeAgency(500_000);
    const result = await proposeAdjustment(adminCtx(), {
      direction: 'DEBIT',
      amountPaise: 50_000,
      reason: 'wrong credit',
      agencyId: String(agencyId),
    });
    expect(result.executed).toBe(true);
    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.balance).toBe(450_000);
  });
});

describe('proposeAdjustment — above threshold', () => {
  it('stages PENDING_APPROVAL with no wallet movement', async () => {
    const agencyId = await makeAgency(0);
    const result = await proposeAdjustment(adminCtx(), {
      direction: 'CREDIT',
      amountPaise: THRESHOLD + 1,
      reason: 'big incident comp',
      agencyId: String(agencyId),
    });
    expect(result.executed).toBe(false);
    expect(result.pendingId).toBeTruthy();
    expect(result.ledgerTxnId).toBeNull();

    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.balance).toBe(0); // untouched

    const pending = await PendingAdjustment.findById(result.pendingId);
    expect(pending?.status).toBe('PENDING_APPROVAL');
    expect(pending?.thresholdAtTime).toBe(THRESHOLD);
  });
});

describe('approveAdjustment', () => {
  it('different admin approval executes the ledger entry', async () => {
    const agencyId = await makeAgency(0);
    const proposerCtx = adminCtx();
    const { pendingId } = (await proposeAdjustment(proposerCtx, {
      direction: 'CREDIT',
      amountPaise: THRESHOLD + 50_000,
      reason: 'big credit',
      agencyId: String(agencyId),
    })) as { pendingId: string; executed: false; ledgerTxnId: null };

    const approverCtx = adminCtx(); // different userId
    const approved = await approveAdjustment(approverCtx, pendingId);
    expect(approved.status).toBe('APPROVED');
    expect(String(approved.approvedBy)).toBe(approverCtx.userId);
    expect(approved.ledgerTxnId).toBeTruthy();

    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.balance).toBe(THRESHOLD + 50_000);
  });

  it('refuses self-approval by the proposer', async () => {
    const agencyId = await makeAgency(0);
    const proposerCtx = adminCtx();
    const { pendingId } = (await proposeAdjustment(proposerCtx, {
      direction: 'CREDIT',
      amountPaise: THRESHOLD + 1,
      reason: 'self test',
      agencyId: String(agencyId),
    })) as { pendingId: string; executed: false; ledgerTxnId: null };

    await expect(approveAdjustment(proposerCtx, pendingId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.balance).toBe(0);
  });

  it('idempotent on already-APPROVED row', async () => {
    const agencyId = await makeAgency(0);
    const { pendingId } = (await proposeAdjustment(adminCtx(), {
      direction: 'CREDIT',
      amountPaise: THRESHOLD + 1,
      reason: 'test reason',
      agencyId: String(agencyId),
    })) as { pendingId: string; executed: false; ledgerTxnId: null };

    const approverCtx = adminCtx();
    await approveAdjustment(approverCtx, pendingId);
    const second = await approveAdjustment(approverCtx, pendingId);
    expect(second.status).toBe('APPROVED');

    // Only one ledger entry posted.
    const txns = await WalletTransaction.countDocuments({
      tenantId,
      agencyId,
      type: 'ADJUSTMENT_CREDIT',
    });
    expect(txns).toBe(1);
  });

  it('refuses approval of REJECTED / CANCELLED rows', async () => {
    const agencyId = await makeAgency(0);
    const proposerCtx = adminCtx();
    const { pendingId } = (await proposeAdjustment(proposerCtx, {
      direction: 'CREDIT',
      amountPaise: THRESHOLD + 1,
      reason: 'test reason',
      agencyId: String(agencyId),
    })) as { pendingId: string; executed: false; ledgerTxnId: null };
    await rejectAdjustment(adminCtx(), pendingId, 'no good');

    await expect(approveAdjustment(adminCtx(), pendingId)).rejects.toThrow();
  });
});

describe('rejectAdjustment', () => {
  it('marks REJECTED with reason, no ledger impact', async () => {
    const agencyId = await makeAgency(0);
    const { pendingId } = (await proposeAdjustment(adminCtx(), {
      direction: 'CREDIT',
      amountPaise: THRESHOLD + 1,
      reason: 'test reason',
      agencyId: String(agencyId),
    })) as { pendingId: string; executed: false; ledgerTxnId: null };
    const rejected = await rejectAdjustment(adminCtx(), pendingId, 'over budget');
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('over budget');

    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.balance).toBe(0);
  });

  it('refuses rejection without a reason', async () => {
    const agencyId = await makeAgency(0);
    const { pendingId } = (await proposeAdjustment(adminCtx(), {
      direction: 'CREDIT',
      amountPaise: THRESHOLD + 1,
      reason: 'test reason',
      agencyId: String(agencyId),
    })) as { pendingId: string; executed: false; ledgerTxnId: null };
    await expect(rejectAdjustment(adminCtx(), pendingId, '')).rejects.toThrow();
  });
});

describe('cancelAdjustment', () => {
  it('only the proposer may cancel their own row', async () => {
    const agencyId = await makeAgency(0);
    const proposerCtx = adminCtx();
    const { pendingId } = (await proposeAdjustment(proposerCtx, {
      direction: 'CREDIT',
      amountPaise: THRESHOLD + 1,
      reason: 'test reason',
      agencyId: String(agencyId),
    })) as { pendingId: string; executed: false; ledgerTxnId: null };

    // Another admin tries to cancel — refused.
    await expect(cancelAdjustment(adminCtx(), pendingId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    // Original proposer cancels — works.
    const cancelled = await cancelAdjustment(proposerCtx, pendingId);
    expect(cancelled.status).toBe('CANCELLED');
  });
});

describe('proposeAdjustment — authorisation + validation', () => {
  it('refuses non-admin callers', async () => {
    const agencyId = await makeAgency(0);
    await expect(
      proposeAdjustment(distributorCtx(), {
        direction: 'CREDIT',
        amountPaise: 1_000,
        reason: 'test reason',
        agencyId: String(agencyId),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects when neither agencyId nor distributorId is provided', async () => {
    await expect(
      proposeAdjustment(adminCtx(), {
        direction: 'CREDIT',
        amountPaise: 1_000,
        reason: 'test reason',
      }),
    ).rejects.toThrow();
  });

  it('rejects zero/negative amount', async () => {
    const agencyId = await makeAgency(0);
    await expect(
      proposeAdjustment(adminCtx(), {
        direction: 'CREDIT',
        amountPaise: 0,
        reason: 'test reason',
        agencyId: String(agencyId),
      }),
    ).rejects.toThrow();
  });
});
