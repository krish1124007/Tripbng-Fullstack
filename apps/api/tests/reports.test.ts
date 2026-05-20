// Phase-10 report tests — credit exposure aging + DI payout summary.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Wallet } from '../src/models/Wallet.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import {
  runCreditExposureReport,
  runDiPayoutReport,
} from '../src/services/wallet/reports.service.js';

let tenantId: Types.ObjectId;

async function makeCreditAgency(opts: {
  code?: string;
  creditLimit?: number;
  creditUsed?: number;
  creditDueDate?: Date | null;
  bookingBlocked?: boolean;
  blockReason?: 'CREDIT_LIMIT' | 'CREDIT_EXPIRED' | 'DUE_DATE_CROSSED' | null;
  module?: 'CREDIT' | 'CASH' | 'DI';
}): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await Agency.create({
    _id: id,
    tenantId,
    agencyCode: opts.code ?? `CE-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Test Agency',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    module: opts.module ?? 'CREDIT',
    creditLimit: opts.creditLimit ?? 100_000,
    creditDueDate: opts.creditDueDate ?? null,
    bookingBlocked: opts.bookingBlocked ?? false,
    blockReason: opts.blockReason ?? null,
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  await Wallet.create({
    tenantId,
    agencyId: id,
    walletCode: `WAL-CE-${crypto.randomBytes(4).toString('hex')}`,
    balance: 0,
    creditUsed: opts.creditUsed ?? 0,
    version: 0,
  });
  return id;
}

const dayUtc = (offsetDays: number, base = new Date()): Date => {
  const baseDay = Math.floor(base.getTime() / 86_400_000);
  return new Date((baseDay + offsetDays) * 86_400_000);
};

beforeAll(async () => {
  await connectMongo();
  const t = await Tenant.create({
    code: `rep-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Reports Test',
    domain: 'rep.test',
  });
  tenantId = t._id;
});

afterAll(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
});

describe('runCreditExposureReport — aging buckets', () => {
  it('agency with future due date lands in "current"', async () => {
    await makeCreditAgency({ creditUsed: 25_000, creditDueDate: dayUtc(5) });
    const r = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(r.totalAgencies).toBe(1);
    expect(r.rows[0]!.agingBucket).toBe('current');
    expect(r.byBucket.current.count).toBe(1);
    expect(r.byBucket.current.outstandingPaise).toBe(25_000);
  });

  it('agency overdue 3 days lands in 0-7', async () => {
    await makeCreditAgency({ creditUsed: 50_000, creditDueDate: dayUtc(-3) });
    const r = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(r.rows[0]!.agingBucket).toBe('0-7');
    expect(r.rows[0]!.daysToDue).toBe(-3);
  });

  it('agency overdue 10 days lands in 8-15', async () => {
    await makeCreditAgency({ creditUsed: 50_000, creditDueDate: dayUtc(-10) });
    const r = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(r.rows[0]!.agingBucket).toBe('8-15');
  });

  it('agency overdue 20 days lands in 16-30', async () => {
    await makeCreditAgency({ creditUsed: 50_000, creditDueDate: dayUtc(-20) });
    const r = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(r.rows[0]!.agingBucket).toBe('16-30');
  });

  it('agency overdue 60 days lands in 30+', async () => {
    await makeCreditAgency({ creditUsed: 50_000, creditDueDate: dayUtc(-60) });
    const r = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(r.rows[0]!.agingBucket).toBe('30+');
  });

  it('agency with no due date lands in current', async () => {
    await makeCreditAgency({ creditUsed: 30_000, creditDueDate: null });
    const r = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(r.rows[0]!.agingBucket).toBe('current');
    expect(r.rows[0]!.daysToDue).toBeNull();
  });

  it('zero-outstanding agencies are excluded by default', async () => {
    await makeCreditAgency({ creditUsed: 0, creditDueDate: dayUtc(5) });
    await makeCreditAgency({ creditUsed: 1_000, creditDueDate: dayUtc(5) });
    const r = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(r.totalAgencies).toBe(1);
  });

  it('only CREDIT-module agencies show up', async () => {
    await makeCreditAgency({ module: 'CASH', creditUsed: 50_000 });
    await makeCreditAgency({ module: 'CREDIT', creditUsed: 50_000 });
    const r = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(r.totalAgencies).toBe(1);
  });

  it('totals sum across all included agencies', async () => {
    await makeCreditAgency({ creditUsed: 30_000, creditLimit: 100_000 });
    await makeCreditAgency({ creditUsed: 70_000, creditLimit: 200_000 });
    const r = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(r.totalOutstandingPaise).toBe(100_000);
    expect(r.totalLimitPaise).toBe(300_000);
  });

  it('rows sorted most-overdue first (smallest daysToDue)', async () => {
    await makeCreditAgency({ code: 'CE-PAST', creditUsed: 10_000, creditDueDate: dayUtc(-10) });
    await makeCreditAgency({ code: 'CE-FUTURE', creditUsed: 10_000, creditDueDate: dayUtc(5) });
    await makeCreditAgency({ code: 'CE-OLD', creditUsed: 10_000, creditDueDate: dayUtc(-30) });
    const r = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(r.rows.map((row) => row.agencyCode)).toEqual(['CE-OLD', 'CE-PAST', 'CE-FUTURE']);
  });

  it('utilisationPercent computed correctly', async () => {
    await makeCreditAgency({ creditUsed: 75_000, creditLimit: 100_000 });
    const r = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(r.rows[0]!.utilisationPercent).toBe(75);
  });

  it('utilisationPercent is 0 when creditLimit=0 (no division by zero)', async () => {
    await makeCreditAgency({ creditUsed: 1_000, creditLimit: 0 });
    const r = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(r.rows[0]!.utilisationPercent).toBe(0);
  });

  it('minOutstandingPaise filter narrows result set', async () => {
    await makeCreditAgency({ creditUsed: 5_000 });
    await makeCreditAgency({ creditUsed: 100_000 });
    const r = await runCreditExposureReport({
      tenantId: String(tenantId),
      minOutstandingPaise: 50_000,
    });
    expect(r.totalAgencies).toBe(1);
    expect(r.rows[0]!.creditUsedPaise).toBe(100_000);
  });
});

describe('runDiPayoutReport — period aggregation', () => {
  async function makeDiAgency(code: string): Promise<Types.ObjectId> {
    const id = new Types.ObjectId();
    await Agency.create({
      _id: id,
      tenantId,
      agencyCode: code,
      companyName: `Agency ${code}`,
      state: 'MH',
      city: 'Mumbai',
      pincode: '400001',
      address: 'x',
      module: 'DI',
      status: 'ACTIVE',
      ownerUserId: new Types.ObjectId(),
    });
    return id;
  }

  async function postLedger(
    agencyId: Types.ObjectId,
    type: 'INCENTIVE_CREDIT' | 'TDS_DEDUCT',
    amount: number,
    createdAt: Date,
  ): Promise<void> {
    await WalletTransaction.collection.insertOne({
      tenantId,
      txnId: `${type}-${crypto.randomBytes(4).toString('hex')}`,
      userId: new Types.ObjectId(),
      agencyId,
      type,
      direction: type === 'INCENTIVE_CREDIT' ? 'CREDIT' : 'DEBIT',
      amount,
      bucket: 'WALLET',
      balanceAfter: 0,
      createdAt,
    });
  }

  it('aggregates gross + TDS per agency, computes net', async () => {
    const a = await makeDiAgency('DI-A');
    const b = await makeDiAgency('DI-B');
    const now = new Date();
    const inWindow = new Date(now.getTime() - 86_400_000); // yesterday
    await postLedger(a, 'INCENTIVE_CREDIT', 100_000, inWindow);
    await postLedger(a, 'TDS_DEDUCT', 2_000, inWindow);
    await postLedger(b, 'INCENTIVE_CREDIT', 50_000, inWindow);
    await postLedger(b, 'TDS_DEDUCT', 1_000, inWindow);

    const from = new Date(now.getTime() - 7 * 86_400_000);
    const r = await runDiPayoutReport({
      tenantId: String(tenantId),
      from,
      to: now,
    });
    expect(r.totalAgencies).toBe(2);
    expect(r.totalGrossIncentivePaise).toBe(150_000);
    expect(r.totalTdsPaise).toBe(3_000);
    expect(r.totalNetCreditPaise).toBe(147_000);
  });

  it('excludes entries outside the period', async () => {
    const a = await makeDiAgency('DI-A');
    const now = new Date();
    const inWindow = new Date(now.getTime() - 86_400_000);
    const outOfWindow = new Date(now.getTime() - 30 * 86_400_000);
    await postLedger(a, 'INCENTIVE_CREDIT', 100_000, inWindow);
    await postLedger(a, 'INCENTIVE_CREDIT', 99_999, outOfWindow);

    const from = new Date(now.getTime() - 7 * 86_400_000);
    const r = await runDiPayoutReport({
      tenantId: String(tenantId),
      from,
      to: now,
    });
    expect(r.totalGrossIncentivePaise).toBe(100_000);
  });

  it('rows sorted by gross incentive DESC', async () => {
    const big = await makeDiAgency('DI-BIG');
    const small = await makeDiAgency('DI-SMALL');
    const now = new Date();
    const inWindow = new Date(now.getTime() - 86_400_000);
    await postLedger(small, 'INCENTIVE_CREDIT', 10_000, inWindow);
    await postLedger(big, 'INCENTIVE_CREDIT', 500_000, inWindow);

    const r = await runDiPayoutReport({
      tenantId: String(tenantId),
      from: new Date(now.getTime() - 7 * 86_400_000),
      to: now,
    });
    expect(r.rows.map((x) => x.agencyCode)).toEqual(['DI-BIG', 'DI-SMALL']);
  });

  it('incentiveCount reflects number of INCENTIVE_CREDIT rows', async () => {
    const a = await makeDiAgency('DI-MULTI');
    const now = new Date();
    const inWindow = new Date(now.getTime() - 86_400_000);
    await postLedger(a, 'INCENTIVE_CREDIT', 10_000, inWindow);
    await postLedger(a, 'INCENTIVE_CREDIT', 20_000, inWindow);
    await postLedger(a, 'INCENTIVE_CREDIT', 30_000, inWindow);

    const r = await runDiPayoutReport({
      tenantId: String(tenantId),
      from: new Date(now.getTime() - 7 * 86_400_000),
      to: now,
    });
    expect(r.rows[0]!.incentiveCount).toBe(3);
    expect(r.rows[0]!.grossIncentivePaise).toBe(60_000);
  });

  it('returns empty rows when no incentives in period', async () => {
    const now = new Date();
    const r = await runDiPayoutReport({
      tenantId: String(tenantId),
      from: new Date(now.getTime() - 7 * 86_400_000),
      to: now,
    });
    expect(r.totalAgencies).toBe(0);
    expect(r.rows).toHaveLength(0);
    expect(r.totalGrossIncentivePaise).toBe(0);
  });
});
