// Phase-2 tests for the DI module incentive flow.
//
// Two layers:
//   * Pure-compute tests — `computeIncentive(config, depositPaise)` math
//     against the spec example + edge cases (mode=ABSOLUTE, max cap,
//     min-deposit gate, tdsApplicable=false, inactive config).
//   * Integration tests — `applyIncentive` writes the two ledger rows and
//     bumps Wallet.balance correctly. Includes idempotency + module-switch
//     safety + no-config fallback.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Wallet } from '../src/models/Wallet.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { DepositIncentiveConfig } from '../src/models/DepositIncentiveConfig.js';
import { Counter } from '../src/models/Counter.js';
import {
  applyIncentive,
  computeIncentive,
} from '../src/services/wallet/di-incentive.service.js';

let tenantId: Types.ObjectId;
const userId = new Types.ObjectId();

// ─────────────────────────────────────────────────────────────────────────────
// Pure compute (no I/O, runs first since it has no setup cost)
// ─────────────────────────────────────────────────────────────────────────────

describe('computeIncentive — pure', () => {
  const base = {
    isActive: true,
    incentiveMode: 'PERCENT' as const,
    incentiveBasisPoints: 100, // 1%
    incentiveAbsolutePaise: null,
    minDepositForIncentivePaise: null,
    maxIncentivePerTxnPaise: null,
    tdsApplicable: true,
    tdsBasisPoints: 200, // 2%
  };

  it('spec example: ₹1,00,000 deposit → ₹1,000 incentive → ₹20 TDS → ₹980 net', () => {
    // 100_000 rupees = 10_000_000 paise. 1% = 100_000 paise (₹1,000).
    // 2% TDS on ₹1,000 = 2_000 paise (₹20). Net = 98_000 paise (₹980).
    const r = computeIncentive(base, 10_000_000);
    expect(r.incentivePaise).toBe(100_000);
    expect(r.tdsPaise).toBe(2_000);
    expect(r.netCreditPaise).toBe(98_000);
    expect(r.skip).toBeUndefined();
  });

  it('PERCENT mode with no TDS: net = incentive', () => {
    const r = computeIncentive({ ...base, tdsApplicable: false }, 10_000_000);
    expect(r.incentivePaise).toBe(100_000);
    expect(r.tdsPaise).toBe(0);
    expect(r.netCreditPaise).toBe(100_000);
  });

  it('ABSOLUTE mode: incentive is fixed, ignores deposit size', () => {
    const r = computeIncentive(
      { ...base, incentiveMode: 'ABSOLUTE', incentiveBasisPoints: null, incentiveAbsolutePaise: 50_000 },
      10_000_000,
    );
    expect(r.incentivePaise).toBe(50_000); // ₹500 flat
    expect(r.tdsPaise).toBe(1_000);
  });

  it('cap applied when computed incentive exceeds maxIncentivePerTxn', () => {
    // 1% of ₹10L = ₹10k (1_000_000 paise). Cap at 500 paise = ₹5.
    const r = computeIncentive({ ...base, maxIncentivePerTxnPaise: 500 }, 100_000_000);
    expect(r.incentivePaise).toBe(500);
  });

  it('below-min deposit skips with BELOW_MIN', () => {
    const r = computeIncentive({ ...base, minDepositForIncentivePaise: 1_000_000 }, 500_000);
    expect(r.skip).toBe('BELOW_MIN');
    expect(r.incentivePaise).toBe(0);
  });

  it('inactive config skips with INACTIVE', () => {
    const r = computeIncentive({ ...base, isActive: false }, 10_000_000);
    expect(r.skip).toBe('INACTIVE');
  });

  it('zero-incentive (e.g. 0% rate) skips with ZERO_INCENTIVE', () => {
    const r = computeIncentive({ ...base, incentiveBasisPoints: 0 }, 10_000_000);
    expect(r.skip).toBe('ZERO_INCENTIVE');
  });

  it('rounds half-up on fractional incentive (Indian accounting standard)', () => {
    // 1% of 1234 paise = 12.34 paise → 12 paise.
    expect(computeIncentive(base, 1_234).incentivePaise).toBe(12);
    // 1% of 5555 paise = 55.55 paise → 56 paise.
    expect(computeIncentive(base, 5_555).incentivePaise).toBe(56);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration (real Mongo + Redis via ledger.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function setupDiAgency(opts: {
  walletBalance?: number;
  incentiveBp?: number;
  tdsBp?: number;
  tdsApplicable?: boolean;
  active?: boolean;
}): Promise<Types.ObjectId> {
  const agencyId = new Types.ObjectId();
  const walletBalance = opts.walletBalance ?? 0;
  await Agency.create({
    _id: agencyId,
    tenantId,
    agencyCode: `DI-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'DI Test',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    walletBalance,
    module: 'DI',
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  await Wallet.create({
    tenantId,
    agencyId,
    walletCode: `WAL-DI-${crypto.randomBytes(4).toString('hex')}`,
    balance: walletBalance,
    version: 0,
  });
  await DepositIncentiveConfig.create({
    tenantId,
    agencyId,
    isActive: opts.active ?? true,
    incentiveMode: 'PERCENT',
    incentiveBasisPoints: opts.incentiveBp ?? 100,
    tdsApplicable: opts.tdsApplicable ?? true,
    tdsBasisPoints: opts.tdsBp ?? 200,
  });
  return agencyId;
}

async function makeSourceTopup(
  agencyId: Types.ObjectId,
  depositPaise: number,
): Promise<Types.ObjectId> {
  // Stand in for the row that the waterfall would have written. We use the
  // raw collection so we can stamp createdAt and not bother with the codes
  // service.
  const txnId = `TOPUP-${crypto.randomBytes(4).toString('hex')}`;
  const inserted = await WalletTransaction.collection.insertOne({
    tenantId,
    txnId,
    userId,
    agencyId,
    type: 'TOPUP',
    direction: 'CREDIT',
    amount: depositPaise,
    bucket: 'WALLET',
    balanceAfter: depositPaise,
    description: 'fixture',
    createdAt: new Date(),
  });
  return inserted.insertedId as Types.ObjectId;
}

beforeAll(async () => {
  await connectMongo();
  // Defensive wipe — when this suite runs after another that mutates
  // process.env.MONGO_URI (booking.test.ts etc.), we end up on a leaked
  // DB with stale Counter / WalletTransaction rows. Wiping these two
  // upfront makes nextCode() collisions impossible across runs.
  await Counter.deleteMany({});
  await WalletTransaction.deleteMany({});
  const tenant = await Tenant.create({
    code: `di-${crypto.randomBytes(4).toString('hex')}`,
    name: 'DI Test Tenant',
    domain: 'di.test',
  });
  tenantId = tenant._id;
});

afterAll(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await DepositIncentiveConfig.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Counter.deleteMany({});
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await DepositIncentiveConfig.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
});

describe('applyIncentive — integration', () => {
  it('spec flow: ₹1,00,000 deposit → wallet ends at ₹1,00,980', async () => {
    const agencyId = await setupDiAgency({ walletBalance: 10_000_000 });
    const parent = await makeSourceTopup(agencyId, 10_000_000);

    const r = await applyIncentive({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      depositPaise: 10_000_000,
      parentLedgerId: String(parent),
      pgReferenceId: 'pgref-spec',
      performedBy: String(userId),
    });

    expect(r.applied).toBe(true);
    expect(r.compute?.incentivePaise).toBe(100_000);
    expect(r.compute?.tdsPaise).toBe(2_000);
    expect(r.compute?.netCreditPaise).toBe(98_000);

    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.balance).toBe(10_098_000); // ₹1,00,980 — matches the spec

    // Two ledger entries: INCENTIVE_CREDIT + TDS_DEDUCT, both linked.
    const incentive = await WalletTransaction.findOne({
      agencyId,
      type: 'INCENTIVE_CREDIT',
    }).lean();
    const tds = await WalletTransaction.findOne({ agencyId, type: 'TDS_DEDUCT' }).lean();
    expect(incentive?.amount).toBe(100_000);
    expect(incentive?.relatedTxnId?.toString()).toBe(String(parent));
    expect(tds?.amount).toBe(2_000);
    expect(tds?.relatedTxnId?.toString()).toBe(String(incentive?._id));
  });

  it('skips the TDS row when tdsApplicable=false', async () => {
    const agencyId = await setupDiAgency({
      walletBalance: 10_000_000,
      tdsApplicable: false,
    });
    const parent = await makeSourceTopup(agencyId, 10_000_000);

    const r = await applyIncentive({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      depositPaise: 10_000_000,
      parentLedgerId: String(parent),
      pgReferenceId: 'pgref-no-tds',
      performedBy: String(userId),
    });

    expect(r.tdsTxn).toBeUndefined();
    const tdsCount = await WalletTransaction.countDocuments({ agencyId, type: 'TDS_DEDUCT' });
    expect(tdsCount).toBe(0);
    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.balance).toBe(10_100_000); // ₹1,01,000 — full incentive, no TDS
  });

  it('idempotent on parentLedgerId — second call short-circuits', async () => {
    const agencyId = await setupDiAgency({ walletBalance: 10_000_000 });
    const parent = await makeSourceTopup(agencyId, 10_000_000);

    const first = await applyIncentive({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      depositPaise: 10_000_000,
      parentLedgerId: String(parent),
      pgReferenceId: 'pgref-idem',
      performedBy: String(userId),
    });
    expect(first.applied).toBe(true);

    const second = await applyIncentive({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      depositPaise: 10_000_000,
      parentLedgerId: String(parent),
      pgReferenceId: 'pgref-idem',
      performedBy: String(userId),
    });
    expect(second.applied).toBe(false);

    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.balance).toBe(10_098_000); // single application
    expect(await WalletTransaction.countDocuments({ agencyId, type: 'INCENTIVE_CREDIT' })).toBe(1);
    expect(await WalletTransaction.countDocuments({ agencyId, type: 'TDS_DEDUCT' })).toBe(1);
  });

  it('skips when agency switched OUT of DI module after deposit but before incentive', async () => {
    const agencyId = await setupDiAgency({ walletBalance: 10_000_000 });
    const parent = await makeSourceTopup(agencyId, 10_000_000);
    // Admin switches module mid-flight.
    await Agency.updateOne({ _id: agencyId }, { $set: { module: 'CASH' } });

    const r = await applyIncentive({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      depositPaise: 10_000_000,
      parentLedgerId: String(parent),
      pgReferenceId: 'pgref-switched',
      performedBy: String(userId),
    });
    expect(r.applied).toBe(false);

    const incentiveCount = await WalletTransaction.countDocuments({
      agencyId,
      type: 'INCENTIVE_CREDIT',
    });
    expect(incentiveCount).toBe(0);
  });

  it('skips when no active config matches', async () => {
    const agencyId = new Types.ObjectId();
    await Agency.create({
      _id: agencyId,
      tenantId,
      agencyCode: `DI-${crypto.randomBytes(4).toString('hex')}`,
      companyName: 'DI Test',
      state: 'MH',
      city: 'Mumbai',
      pincode: '400001',
      address: 'x',
      walletBalance: 0,
      module: 'DI',
      status: 'ACTIVE',
      ownerUserId: new Types.ObjectId(),
    });
    await Wallet.create({
      tenantId,
      agencyId,
      walletCode: `WAL-NC-${crypto.randomBytes(4).toString('hex')}`,
      balance: 0,
      version: 0,
    });
    // NO DepositIncentiveConfig — neither agency-specific nor global.
    const parent = await makeSourceTopup(agencyId, 5_000_000);

    const r = await applyIncentive({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      depositPaise: 5_000_000,
      parentLedgerId: String(parent),
      pgReferenceId: 'pgref-noconfig',
      performedBy: String(userId),
    });
    expect(r.applied).toBe(false);
  });

  it('falls back to tenant-wide config (agencyId=null) when no per-agency row exists', async () => {
    const agencyId = new Types.ObjectId();
    await Agency.create({
      _id: agencyId,
      tenantId,
      agencyCode: `DI-${crypto.randomBytes(4).toString('hex')}`,
      companyName: 'DI Test',
      state: 'MH',
      city: 'Mumbai',
      pincode: '400001',
      address: 'x',
      walletBalance: 0,
      module: 'DI',
      status: 'ACTIVE',
      ownerUserId: new Types.ObjectId(),
    });
    await Wallet.create({
      tenantId,
      agencyId,
      walletCode: `WAL-FB-${crypto.randomBytes(4).toString('hex')}`,
      balance: 0,
      version: 0,
    });
    // Global default — agencyId: null.
    await DepositIncentiveConfig.create({
      tenantId,
      agencyId: null,
      isActive: true,
      incentiveMode: 'PERCENT',
      incentiveBasisPoints: 50, // 0.5%
      tdsApplicable: false,
      tdsBasisPoints: 0,
    });
    const parent = await makeSourceTopup(agencyId, 10_000_000);

    const r = await applyIncentive({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      depositPaise: 10_000_000,
      parentLedgerId: String(parent),
      pgReferenceId: 'pgref-global',
      performedBy: String(userId),
    });
    expect(r.applied).toBe(true);
    expect(r.compute?.incentivePaise).toBe(50_000); // 0.5% of ₹1L = ₹500
  });
});
