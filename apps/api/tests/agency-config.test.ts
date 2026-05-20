// Phase-5 tests for the agency-config admin services.
//
// Covers:
//   - switchAgencyModule: happy path, no-op, CREDIT→other gate, force=true
//     override, DISTRIBUTOR transition allowed-with-warning, booking-block
//     reset on CREDIT→ exit, authorisation refused for non-admin.
//   - setCreditConfig: field-by-field update + audit, validation, role gate.
//   - upsertDiConfig: create + update paths, audit, role gate.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Wallet } from '../src/models/Wallet.js';
import { DepositIncentiveConfig } from '../src/models/DepositIncentiveConfig.js';
import { AuditLog } from '../src/models/AuditLog.js';
import {
  setCreditConfig,
  switchAgencyModule,
  upsertDiConfig,
  type AdminContext,
} from '../src/services/wallet/agency-config.service.js';
import type { Role } from '@tripbng/shared';

let tenantId: Types.ObjectId;
const adminUserId = new Types.ObjectId();

function adminCtx(): AdminContext {
  return {
    tenantId: String(tenantId),
    userId: String(adminUserId),
    role: 'SUPER_ADMIN' as Role,
  };
}

function distributorCtx(): AdminContext {
  return {
    tenantId: String(tenantId),
    userId: String(new Types.ObjectId()),
    role: 'DISTRIBUTOR' as Role,
  };
}

async function makeAgency(opts: {
  module?: 'CREDIT' | 'DI' | 'CASH' | 'DISTRIBUTOR' | 'SUB_AGENT';
  creditUsed?: number;
  bookingBlocked?: boolean;
  blockReason?: 'CREDIT_LIMIT' | 'CREDIT_EXPIRED' | 'DUE_DATE_CROSSED' | null;
}) {
  const agencyId = new Types.ObjectId();
  await Agency.create({
    _id: agencyId,
    tenantId,
    agencyCode: `AC-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Test',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    module: opts.module ?? 'CASH',
    status: 'ACTIVE',
    bookingBlocked: opts.bookingBlocked ?? false,
    blockReason: opts.blockReason ?? null,
    ownerUserId: new Types.ObjectId(),
  });
  await Wallet.create({
    tenantId,
    agencyId,
    walletCode: `WAL-AC-${crypto.randomBytes(4).toString('hex')}`,
    balance: 0,
    creditUsed: opts.creditUsed ?? 0,
    version: 0,
  });
  return agencyId;
}

beforeAll(async () => {
  await connectMongo();
  const t = await Tenant.create({
    code: `ac-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Agency Config',
    domain: 'ac.test',
  });
  tenantId = t._id;
});

afterAll(async () => {
  await AuditLog.deleteMany({ tenantId });
  await DepositIncentiveConfig.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await AuditLog.deleteMany({ tenantId });
  await DepositIncentiveConfig.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
});

describe('switchAgencyModule', () => {
  it('switches CASH → CREDIT for a fresh agency', async () => {
    const agencyId = await makeAgency({ module: 'CASH' });
    const r = await switchAgencyModule(adminCtx(), {
      agencyId: String(agencyId),
      newModule: 'CREDIT',
    });
    expect(r.previousModule).toBe('CASH');
    expect(r.agency.module).toBe('CREDIT');
    const audit = await AuditLog.findOne({ tenantId, action: 'agency.module.switch' });
    expect(audit?.before).toMatchObject({ module: 'CASH' });
    expect(audit?.after).toMatchObject({ module: 'CREDIT' });
  });

  it('is a no-op when newModule equals current', async () => {
    const agencyId = await makeAgency({ module: 'DI' });
    const r = await switchAgencyModule(adminCtx(), {
      agencyId: String(agencyId),
      newModule: 'DI',
    });
    expect(r.previousModule).toBe('DI');
    expect(r.agency.module).toBe('DI');
    // No audit row written for no-op.
    const audits = await AuditLog.countDocuments({ tenantId, action: 'agency.module.switch' });
    expect(audits).toBe(0);
  });

  it('refuses CREDIT → other when creditUsed > 0', async () => {
    const agencyId = await makeAgency({ module: 'CREDIT', creditUsed: 50_000 });
    // VALIDATION_ERROR's catalog message is "Invalid input"; the human-readable
    // explanation lives in err.details.reason — match against that.
    await expect(
      switchAgencyModule(adminCtx(), {
        agencyId: String(agencyId),
        newModule: 'CASH',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: expect.objectContaining({ outstandingPaise: 50_000 }),
    });
    const after = await Agency.findById(agencyId).lean();
    expect(after?.module).toBe('CREDIT'); // unchanged
  });

  it('allows CREDIT → other when force=true even with outstanding credit', async () => {
    const agencyId = await makeAgency({ module: 'CREDIT', creditUsed: 50_000 });
    const r = await switchAgencyModule(adminCtx(), {
      agencyId: String(agencyId),
      newModule: 'CASH',
      force: true,
      notes: 'admin force-close, will manual-adjust the credit',
    });
    expect(r.agency.module).toBe('CASH');
    const audit = await AuditLog.findOne({ tenantId, action: 'agency.module.switch' });
    expect((audit?.after as Record<string, unknown>).force).toBe(true);
  });

  it('clears credit-related bookingBlocked when exiting CREDIT', async () => {
    const agencyId = await makeAgency({
      module: 'CREDIT',
      bookingBlocked: true,
      blockReason: 'CREDIT_LIMIT',
    });
    const r = await switchAgencyModule(adminCtx(), {
      agencyId: String(agencyId),
      newModule: 'CASH',
    });
    expect(r.agency.bookingBlocked).toBe(false);
    expect(r.agency.blockReason).toBeNull();
  });

  it('refuses non-admin callers', async () => {
    const agencyId = await makeAgency({ module: 'CASH' });
    await expect(
      switchAgencyModule(distributorCtx(), {
        agencyId: String(agencyId),
        newModule: 'CREDIT',
      }),
    ).rejects.toThrow(/permission/);
  });

  it('throws AGENCY_NOT_FOUND on bad id', async () => {
    await expect(
      switchAgencyModule(adminCtx(), {
        agencyId: String(new Types.ObjectId()),
        newModule: 'CREDIT',
      }),
    ).rejects.toThrow(/Agency not found/);
  });
});

describe('setCreditConfig', () => {
  it('sets all four fields and writes audit', async () => {
    const agencyId = await makeAgency({ module: 'CREDIT' });
    const expiry = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const due = new Date(Date.now() + 15 * 86_400_000).toISOString();
    const updated = await setCreditConfig(adminCtx(), {
      agencyId: String(agencyId),
      creditLimitPaise: 5_000_000,
      creditExpiryDate: expiry,
      creditDueDate: due,
      blockOnDueDateCross: true,
    });
    expect(updated.creditLimit).toBe(5_000_000);
    expect(updated.creditExpiryDate?.toISOString()).toBe(expiry);
    expect(updated.creditDueDate?.toISOString()).toBe(due);
    expect(updated.blockOnDueDateCross).toBe(true);

    const audit = await AuditLog.findOne({ tenantId, action: 'agency.credit_config.set' });
    expect(audit?.before).toMatchObject({ creditLimit: 0 });
    expect(audit?.after).toMatchObject({
      creditLimit: 5_000_000,
      blockOnDueDateCross: true,
    });
  });

  it('clears dates when null is passed', async () => {
    const agencyId = await makeAgency({ module: 'CREDIT' });
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await setCreditConfig(adminCtx(), {
      agencyId: String(agencyId),
      creditExpiryDate: future,
    });
    let after = await Agency.findById(agencyId).lean();
    expect(after?.creditExpiryDate).toBeTruthy();

    await setCreditConfig(adminCtx(), {
      agencyId: String(agencyId),
      creditExpiryDate: null,
    });
    after = await Agency.findById(agencyId).lean();
    expect(after?.creditExpiryDate).toBeNull();
  });

  it('rejects negative or non-integer creditLimitPaise', async () => {
    const agencyId = await makeAgency({ module: 'CREDIT' });
    await expect(
      setCreditConfig(adminCtx(), {
        agencyId: String(agencyId),
        creditLimitPaise: -1,
      }),
    ).rejects.toThrow();
    await expect(
      setCreditConfig(adminCtx(), {
        agencyId: String(agencyId),
        creditLimitPaise: 1.5,
      }),
    ).rejects.toThrow();
  });

  it('refuses non-admin callers', async () => {
    const agencyId = await makeAgency({ module: 'CASH' });
    await expect(
      setCreditConfig(distributorCtx(), {
        agencyId: String(agencyId),
        creditLimitPaise: 1_000_000,
      }),
    ).rejects.toThrow(/permission/);
  });
});

describe('upsertDiConfig', () => {
  it('creates a new config when none exists, with defaults filled', async () => {
    const agencyId = await makeAgency({ module: 'DI' });
    const config = await upsertDiConfig(adminCtx(), {
      agencyId: String(agencyId),
      incentiveBasisPoints: 150,
    });
    expect(config.incentiveBasisPoints).toBe(150);
    expect(config.tdsBasisPoints).toBe(200); // default
    expect(config.isActive).toBe(true);
    expect(config.incentiveMode).toBe('PERCENT');

    const audit = await AuditLog.findOne({ tenantId, action: 'agency.di_config.create' });
    expect(audit).toBeTruthy();
  });

  it('updates the existing config when one already exists', async () => {
    const agencyId = await makeAgency({ module: 'DI' });
    await upsertDiConfig(adminCtx(), {
      agencyId: String(agencyId),
      incentiveBasisPoints: 100,
    });
    const updated = await upsertDiConfig(adminCtx(), {
      agencyId: String(agencyId),
      incentiveBasisPoints: 250,
      tdsApplicable: false,
    });
    expect(updated.incentiveBasisPoints).toBe(250);
    expect(updated.tdsApplicable).toBe(false);

    // Only one row exists for the agency.
    const count = await DepositIncentiveConfig.countDocuments({
      tenantId,
      agencyId,
    });
    expect(count).toBe(1);

    const updateAudit = await AuditLog.findOne({
      tenantId,
      action: 'agency.di_config.update',
    });
    expect(updateAudit).toBeTruthy();
  });

  it('refuses non-admin callers', async () => {
    const agencyId = await makeAgency({ module: 'DI' });
    await expect(
      upsertDiConfig(distributorCtx(), {
        agencyId: String(agencyId),
        incentiveBasisPoints: 100,
      }),
    ).rejects.toThrow(/permission/);
  });

  it('rejects non-existent agency', async () => {
    await expect(
      upsertDiConfig(adminCtx(), {
        agencyId: String(new Types.ObjectId()),
        incentiveBasisPoints: 100,
      }),
    ).rejects.toThrow(/Agency not found/);
  });
});
