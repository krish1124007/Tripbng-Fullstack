// Phase-6 tests for the credit-block recompute service.
//
// Pure-ish logic — drives the three guards (limit / expiry / due-date),
// plus the transition state machine (no-change / block / unblock /
// reason-changed). Each test wires a fresh agency + wallet and asserts the
// resulting Agency.bookingBlocked / blockReason after `recomputeCreditBlocks`.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Wallet } from '../src/models/Wallet.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { recomputeCreditBlocks } from '../src/services/wallet/credit-block.service.js';

let tenantId: Types.ObjectId;

interface AgencyOpts {
  module?: 'CREDIT' | 'CASH' | 'DI' | 'DISTRIBUTOR' | 'SUB_AGENT';
  creditLimit?: number;
  creditUsed?: number;
  creditExpiryDate?: Date | null;
  creditDueDate?: Date | null;
  blockOnDueDateCross?: boolean;
  bookingBlocked?: boolean;
  blockReason?:
    | 'CREDIT_LIMIT'
    | 'CREDIT_EXPIRED'
    | 'DUE_DATE_CROSSED'
    | 'INSUFFICIENT_BALANCE'
    | 'ADMIN_SUSPEND'
    | null;
}

async function makeAgency(opts: AgencyOpts = {}): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await Agency.create({
    _id: id,
    tenantId,
    agencyCode: `CB-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Credit Block Test',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    module: opts.module ?? 'CREDIT',
    creditLimit: opts.creditLimit ?? 100_000,
    creditExpiryDate: opts.creditExpiryDate ?? null,
    creditDueDate: opts.creditDueDate ?? null,
    blockOnDueDateCross: opts.blockOnDueDateCross ?? false,
    bookingBlocked: opts.bookingBlocked ?? false,
    blockReason: opts.blockReason ?? null,
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  await Wallet.create({
    tenantId,
    agencyId: id,
    walletCode: `WAL-CB-${crypto.randomBytes(4).toString('hex')}`,
    balance: 0,
    creditUsed: opts.creditUsed ?? 0,
    version: 0,
  });
  return id;
}

const yesterday = (): Date => new Date(Date.now() - 86_400_000);
const tomorrow = (): Date => new Date(Date.now() + 86_400_000);

beforeAll(async () => {
  await connectMongo();
  const t = await Tenant.create({
    code: `cb-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Credit Block',
    domain: 'cb.test',
  });
  tenantId = t._id;
});

afterAll(async () => {
  await AuditLog.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await AuditLog.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
});

describe('recomputeCreditBlocks — guards', () => {
  it('blocks on CREDIT_LIMIT when creditUsed >= creditLimit', async () => {
    const agencyId = await makeAgency({ creditLimit: 100_000, creditUsed: 100_000 });
    const r = await recomputeCreditBlocks({ tenantId: String(tenantId) });
    expect(r.newlyBlocked).toBe(1);
    const after = await Agency.findById(agencyId).lean();
    expect(after?.bookingBlocked).toBe(true);
    expect(after?.blockReason).toBe('CREDIT_LIMIT');
  });

  it('blocks on CREDIT_EXPIRED when expiry is in the past', async () => {
    const agencyId = await makeAgency({
      creditLimit: 100_000,
      creditUsed: 10_000,
      creditExpiryDate: yesterday(),
    });
    await recomputeCreditBlocks({ tenantId: String(tenantId) });
    const after = await Agency.findById(agencyId).lean();
    expect(after?.bookingBlocked).toBe(true);
    expect(after?.blockReason).toBe('CREDIT_EXPIRED');
  });

  it('blocks on DUE_DATE_CROSSED only when blockOnDueDateCross + creditUsed > 0', async () => {
    const agencyId = await makeAgency({
      creditLimit: 100_000,
      creditUsed: 50_000,
      creditDueDate: yesterday(),
      blockOnDueDateCross: true,
    });
    await recomputeCreditBlocks({ tenantId: String(tenantId) });
    const after = await Agency.findById(agencyId).lean();
    expect(after?.bookingBlocked).toBe(true);
    expect(after?.blockReason).toBe('DUE_DATE_CROSSED');
  });

  it('does NOT block on DUE_DATE_CROSSED when creditUsed = 0 (paid down on time)', async () => {
    const agencyId = await makeAgency({
      creditLimit: 100_000,
      creditUsed: 0,
      creditDueDate: yesterday(),
      blockOnDueDateCross: true,
    });
    await recomputeCreditBlocks({ tenantId: String(tenantId) });
    const after = await Agency.findById(agencyId).lean();
    expect(after?.bookingBlocked).toBe(false);
    expect(after?.blockReason).toBeNull();
  });

  it('does NOT block on DUE_DATE_CROSSED when blockOnDueDateCross = false', async () => {
    const agencyId = await makeAgency({
      creditLimit: 100_000,
      creditUsed: 50_000,
      creditDueDate: yesterday(),
      blockOnDueDateCross: false,
    });
    await recomputeCreditBlocks({ tenantId: String(tenantId) });
    const after = await Agency.findById(agencyId).lean();
    expect(after?.bookingBlocked).toBe(false);
  });

  it('CREDIT_LIMIT takes priority over EXPIRED', async () => {
    const agencyId = await makeAgency({
      creditLimit: 100_000,
      creditUsed: 100_000,
      creditExpiryDate: yesterday(),
    });
    await recomputeCreditBlocks({ tenantId: String(tenantId) });
    const after = await Agency.findById(agencyId).lean();
    expect(after?.blockReason).toBe('CREDIT_LIMIT');
  });
});

describe('recomputeCreditBlocks — transitions', () => {
  it('unblocks when all credit guards clear', async () => {
    const agencyId = await makeAgency({
      creditLimit: 100_000,
      creditUsed: 30_000,
      bookingBlocked: true,
      blockReason: 'CREDIT_LIMIT',
    });
    const r = await recomputeCreditBlocks({ tenantId: String(tenantId) });
    expect(r.newlyUnblocked).toBe(1);
    const after = await Agency.findById(agencyId).lean();
    expect(after?.bookingBlocked).toBe(false);
    expect(after?.blockReason).toBeNull();
  });

  it('preserves non-credit block reasons (ADMIN_SUSPEND stays put)', async () => {
    const agencyId = await makeAgency({
      creditLimit: 100_000,
      creditUsed: 30_000,
      bookingBlocked: true,
      blockReason: 'ADMIN_SUSPEND',
    });
    const r = await recomputeCreditBlocks({ tenantId: String(tenantId) });
    expect(r.newlyUnblocked).toBe(0);
    const after = await Agency.findById(agencyId).lean();
    expect(after?.bookingBlocked).toBe(true);
    expect(after?.blockReason).toBe('ADMIN_SUSPEND');
  });

  it('records reasonChanged when guard reason shifts (LIMIT → EXPIRED)', async () => {
    const agencyId = await makeAgency({
      creditLimit: 100_000,
      creditUsed: 30_000, // no longer over limit
      creditExpiryDate: yesterday(), // but expired
      bookingBlocked: true,
      blockReason: 'CREDIT_LIMIT',
    });
    const r = await recomputeCreditBlocks({ tenantId: String(tenantId) });
    expect(r.reasonChanged).toBe(1);
    const after = await Agency.findById(agencyId).lean();
    expect(after?.blockReason).toBe('CREDIT_EXPIRED');
  });

  it('no-op when state is unchanged (no audit row written)', async () => {
    await makeAgency({
      creditLimit: 100_000,
      creditUsed: 30_000,
      bookingBlocked: false,
      blockReason: null,
    });
    const r = await recomputeCreditBlocks({ tenantId: String(tenantId) });
    expect(r.newlyBlocked).toBe(0);
    expect(r.newlyUnblocked).toBe(0);
    expect(r.reasonChanged).toBe(0);
    const audits = await AuditLog.countDocuments({
      tenantId,
      action: 'agency.credit_block.recompute',
    });
    expect(audits).toBe(0);
  });

  it('writes audit row on any state transition', async () => {
    const agencyId = await makeAgency({ creditLimit: 100_000, creditUsed: 100_000 });
    await recomputeCreditBlocks({ tenantId: String(tenantId) });
    const audit = await AuditLog.findOne({
      tenantId,
      action: 'agency.credit_block.recompute',
      resourceId: String(agencyId),
    });
    expect(audit?.before).toMatchObject({ bookingBlocked: false });
    expect(audit?.after).toMatchObject({
      bookingBlocked: true,
      blockReason: 'CREDIT_LIMIT',
      transition: 'block',
    });
  });
});

describe('recomputeCreditBlocks — scope', () => {
  it('only scans CREDIT-module agencies (skips CASH/DI/etc.)', async () => {
    // A CREDIT agency that's over limit, plus a CASH one that the cron should ignore.
    await makeAgency({ module: 'CREDIT', creditLimit: 100_000, creditUsed: 100_000 });
    await makeAgency({ module: 'CASH', creditLimit: 100_000, creditUsed: 100_000 });

    const r = await recomputeCreditBlocks({ tenantId: String(tenantId) });
    expect(r.scannedAgencies).toBe(1);
    expect(r.newlyBlocked).toBe(1);
  });

  it('respects the agencyIds scope option', async () => {
    const a = await makeAgency({ creditLimit: 100_000, creditUsed: 100_000 });
    const b = await makeAgency({ creditLimit: 100_000, creditUsed: 100_000 });
    const r = await recomputeCreditBlocks({
      tenantId: String(tenantId),
      agencyIds: [String(a)],
    });
    expect(r.scannedAgencies).toBe(1);
    const aAfter = await Agency.findById(a).lean();
    const bAfter = await Agency.findById(b).lean();
    expect(aAfter?.bookingBlocked).toBe(true);
    expect(bAfter?.bookingBlocked).toBe(false);
  });
});
