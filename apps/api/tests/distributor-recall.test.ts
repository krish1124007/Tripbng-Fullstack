// Phase-6 tests for the distributor RECALL flow.
//
// Builds on the same fixtures used by distributor-transfer.test.ts: create
// a distributor + agency, fund the distributor, run a forward TRANSFER,
// then exercise the recall paths (success / insufficient-agency-balance /
// authorisation / repeat-recall rejection).

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  recallTransfer,
  requestTransfer,
  type ActorContext,
} from '../src/services/wallet/distributor-transfer.service.js';

let tenantId: Types.ObjectId;

async function makeDistributor(walletBalance: number): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await Distributor.create({
    _id: id,
    tenantId,
    distributorCode: `DT-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Test',
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
    distributorId: id,
    walletCode: `WAL-DIST-${crypto.randomBytes(4).toString('hex')}`,
    balance: walletBalance,
    version: 0,
  });
  return id;
}

async function makeAgency(
  distributorId: Types.ObjectId,
  walletBalance = 0,
): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await Agency.create({
    _id: id,
    tenantId,
    agencyCode: `RA-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Test',
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
    agencyId: id,
    walletCode: `WAL-AG-${crypto.randomBytes(4).toString('hex')}`,
    balance: walletBalance,
    version: 0,
  });
  return id;
}

function distCtx(distributorId: string): ActorContext {
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
    userId: String(new Types.ObjectId()),
    role: 'SUPER_ADMIN' as Role,
  };
}

beforeAll(async () => {
  await connectMongo();
  await Counter.deleteMany({});
  await WalletTransaction.deleteMany({});
  const t = await Tenant.create({
    code: `ra-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Recall Test',
    domain: 'ra.test',
  });
  tenantId = t._id;
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

describe('recallTransfer — happy path', () => {
  it('reverses a COMPLETED transfer atomically, marks original REVERSED', async () => {
    const distId = await makeDistributor(100_000);
    const agencyId = await makeAgency(distId, 0);
    const ctx = distCtx(String(distId));

    const { transfer } = await requestTransfer(ctx, {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: 30_000,
    });
    expect(transfer.status).toBe('COMPLETED');

    const recall = await recallTransfer(ctx, String(transfer._id), 'agent over-funded');
    expect(recall.status).toBe('COMPLETED');
    expect(recall.type).toBe('RECALL');
    expect(String(recall.originalTransferId)).toBe(String(transfer._id));
    expect(recall.outLedgerId).toBeTruthy();
    expect(recall.inLedgerId).toBeTruthy();

    const distWallet = await Wallet.findOne({ distributorId: distId }).lean();
    const agencyWallet = await Wallet.findOne({ agencyId }).lean();
    // Net of forward + recall = original state.
    expect(distWallet?.balance).toBe(100_000);
    expect(agencyWallet?.balance).toBe(0);

    const original = await DistributorTransfer.findById(transfer._id);
    expect(original?.status).toBe('REVERSED');
  });

  it('admin may recall any distributor’s transfer', async () => {
    const distId = await makeDistributor(100_000);
    const agencyId = await makeAgency(distId, 0);
    const { transfer } = await requestTransfer(distCtx(String(distId)), {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: 20_000,
    });

    const recall = await recallTransfer(adminCtx(), String(transfer._id));
    expect(recall.status).toBe('COMPLETED');
  });
});

describe('recallTransfer — failure modes', () => {
  it('FAILED when agency has spent the transferred balance', async () => {
    const distId = await makeDistributor(100_000);
    const agencyId = await makeAgency(distId, 0);
    const ctx = distCtx(String(distId));

    const { transfer } = await requestTransfer(ctx, {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: 30_000,
    });

    // Simulate the agency spending the money before recall fires.
    await Wallet.updateOne({ agencyId }, { $set: { balance: 0 } });
    await Agency.updateOne({ _id: agencyId }, { $set: { walletBalance: 0 } });

    await expect(recallTransfer(ctx, String(transfer._id))).rejects.toThrow();

    // The recall row is FAILED; original is still COMPLETED (not REVERSED).
    const recallRow = await DistributorTransfer.findOne({
      tenantId,
      type: 'RECALL',
    });
    expect(recallRow?.status).toBe('FAILED');
    expect(recallRow?.failureReason).toBeTruthy();
    const original = await DistributorTransfer.findById(transfer._id);
    expect(original?.status).toBe('COMPLETED');
  });

  it('refuses recall when status is PENDING_APPROVAL (not yet executed)', async () => {
    const distId = await makeDistributor(20_000_000); // above approval threshold
    const agencyId = await makeAgency(distId, 0);
    const ctx = distCtx(String(distId));

    // Force PENDING_APPROVAL by going above the threshold (5M paise).
    const { transfer } = await requestTransfer(ctx, {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: 10_000_000,
    });
    expect(transfer.status).toBe('PENDING_APPROVAL');

    await expect(recallTransfer(ctx, String(transfer._id))).rejects.toThrow();
  });

  it('refuses double-recall (REVERSED status blocks the second attempt)', async () => {
    const distId = await makeDistributor(100_000);
    const agencyId = await makeAgency(distId, 0);
    const ctx = distCtx(String(distId));
    const { transfer } = await requestTransfer(ctx, {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: 30_000,
    });
    await recallTransfer(ctx, String(transfer._id));
    // Second attempt — original is now REVERSED, can't recall again.
    await expect(recallTransfer(ctx, String(transfer._id))).rejects.toThrow();
  });

  it('rejects recall of a RECALL row (only TRANSFER rows can be recalled)', async () => {
    const distId = await makeDistributor(100_000);
    const agencyId = await makeAgency(distId, 0);
    const ctx = distCtx(String(distId));
    const { transfer } = await requestTransfer(ctx, {
      distributorId: String(distId),
      agencyId: String(agencyId),
      amountPaise: 30_000,
    });
    const recall = await recallTransfer(ctx, String(transfer._id));
    await expect(recallTransfer(ctx, String(recall._id))).rejects.toThrow();
  });
});

describe('recallTransfer — authorisation', () => {
  it('distributor cannot recall another distributor’s transfer', async () => {
    const distA = await makeDistributor(100_000);
    const distB = await makeDistributor(100_000);
    const agencyB = await makeAgency(distB, 0);
    const { transfer } = await requestTransfer(distCtx(String(distB)), {
      distributorId: String(distB),
      agencyId: String(agencyB),
      amountPaise: 10_000,
    });

    await expect(
      recallTransfer(distCtx(String(distA)), String(transfer._id)),
    ).rejects.toThrow();
  });
});
