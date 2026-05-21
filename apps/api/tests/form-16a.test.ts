// Phase-C tests for Form 16A certificate generation.
//
// Covers:
//   - buildForm16A composes the certificate data shape correctly
//   - Throws NOT_FOUND when (agency, quarter) has zero deductions —
//     we never issue a blank certificate
//   - Throws NOT_FOUND when the agency doesn't exist
//   - Surfaces missing-PAN / missing-category as warnings (not failures)
//   - form16AToPdf produces a non-empty PDF buffer

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { buildForm16A, form16AToPdf } from '../src/services/tax/form-16a.service.js';
import { AppError } from '@tripbng/shared';

let tenantId: Types.ObjectId;

async function makeAgency(opts: {
  pan?: string | null;
  panName?: string | null;
  category?: 'INDIVIDUAL' | 'COMPANY' | 'FIRM' | null;
}): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await Agency.create({
    _id: id,
    tenantId,
    agencyCode: `F16-${crypto.randomBytes(3).toString('hex')}`,
    companyName: 'Form-16A Test Agency',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: '12 Tax Street',
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
    pan: {
      number: opts.pan ?? undefined,
      name: opts.panName ?? undefined,
      deducteeCategory: opts.category ?? null,
    },
  });
  return id;
}

async function insertTdsPair(opts: {
  agencyId: Types.ObjectId;
  grossPaise: number;
  tdsPaise: number;
  at: Date;
}): Promise<void> {
  const incentiveId = new Types.ObjectId();
  const tdsId = new Types.ObjectId();
  const performedBy = new Types.ObjectId();
  await WalletTransaction.collection.insertOne({
    _id: incentiveId,
    tenantId,
    txnId: `WT-INC-${crypto.randomBytes(4).toString('hex')}`,
    userId: opts.agencyId,
    agencyId: opts.agencyId,
    amount: opts.grossPaise,
    direction: 'CREDIT',
    type: 'INCENTIVE_CREDIT',
    description: 'test incentive',
    performedBy,
    balanceAfter: opts.grossPaise,
    createdAt: opts.at,
    updatedAt: opts.at,
  });
  await WalletTransaction.collection.insertOne({
    _id: tdsId,
    tenantId,
    txnId: `WT-TDS-${crypto.randomBytes(4).toString('hex')}`,
    userId: opts.agencyId,
    agencyId: opts.agencyId,
    amount: opts.tdsPaise,
    direction: 'DEBIT',
    type: 'TDS_DEDUCT',
    description: 'test tds',
    performedBy,
    relatedTxnId: incentiveId,
    balanceAfter: opts.grossPaise - opts.tdsPaise,
    createdAt: opts.at,
    updatedAt: opts.at,
  });
}

beforeAll(async () => {
  await connectMongo();
  const t = await Tenant.create({
    code: `f16-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Form 16A Test',
    domain: 'f16.test',
  });
  tenantId = t._id;
});

afterAll(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
});

describe('buildForm16A', () => {
  it('produces a complete certificate for a deductee with TDS in the quarter', async () => {
    const agencyId = await makeAgency({
      pan: 'AAAPL1234C',
      panName: 'Test Agency Pvt Ltd',
      category: 'COMPANY',
    });
    await insertTdsPair({
      agencyId,
      grossPaise: 100_000,
      tdsPaise: 5_000,
      at: new Date('2025-04-15T10:00:00.000Z'),
    });
    await insertTdsPair({
      agencyId,
      grossPaise: 50_000,
      tdsPaise: 2_500,
      at: new Date('2025-05-20T10:00:00.000Z'),
    });

    const cert = await buildForm16A({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      financialYear: '2025-26',
      quarter: 'Q1',
    });

    expect(cert.deductee.pan).toBe('AAAPL1234C');
    expect(cert.deductee.name).toBe('Test Agency Pvt Ltd');
    expect(cert.deductee.category).toBe('COMPANY');
    expect(cert.lineItems).toHaveLength(2);
    expect(cert.totals.amountPaidPaise).toBe(150_000);
    expect(cert.totals.tdsPaise).toBe(7_500);
    expect(cert.totals.totalTaxPaise).toBe(7_500); // 194H: no surcharge + HEC
    expect(cert.warnings).toHaveLength(0);
    expect(cert.certificateNumber).toContain('TBNG/16A/202526/Q1/');
    // Challan fields are deliberately null at certificate-build time.
    expect(cert.challan.bsrCode).toBeNull();
    expect(cert.challan.dateOfDeposit).toBeNull();
  });

  it('throws NOT_FOUND when the agency has zero TDS in the quarter', async () => {
    const agencyId = await makeAgency({
      pan: 'AAAPL1234C',
      panName: 'X',
      category: 'COMPANY',
    });
    // Drop a TDS row OUTSIDE the Q1 window — should not count.
    await insertTdsPair({
      agencyId,
      grossPaise: 100_000,
      tdsPaise: 5_000,
      at: new Date('2025-03-31T10:00:00.000Z'),
    });

    await expect(
      buildForm16A({
        tenantId: String(tenantId),
        agencyId: String(agencyId),
        financialYear: '2025-26',
        quarter: 'Q1',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('throws NOT_FOUND when the agency does not exist', async () => {
    const fakeId = new Types.ObjectId();
    await expect(
      buildForm16A({
        tenantId: String(tenantId),
        agencyId: String(fakeId),
        financialYear: '2025-26',
        quarter: 'Q1',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('surfaces missing-PAN / missing-category as warnings (still renders)', async () => {
    const agencyId = await makeAgency({
      pan: null,
      panName: null,
      category: null,
    });
    await insertTdsPair({
      agencyId,
      grossPaise: 100_000,
      tdsPaise: 5_000,
      at: new Date('2025-04-15T10:00:00.000Z'),
    });

    const cert = await buildForm16A({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      financialYear: '2025-26',
      quarter: 'Q1',
    });
    expect(cert.warnings.length).toBeGreaterThan(0);
    expect(cert.warnings.some((w) => w.toLowerCase().includes('pan'))).toBe(true);
    expect(cert.lineItems).toHaveLength(1);
  });
});

describe('form16AToPdf', () => {
  it('produces a non-empty PDF stream', async () => {
    const agencyId = await makeAgency({
      pan: 'AAAPL1234C',
      panName: 'PDF Test',
      category: 'COMPANY',
    });
    await insertTdsPair({
      agencyId,
      grossPaise: 100_000,
      tdsPaise: 5_000,
      at: new Date('2025-04-15T10:00:00.000Z'),
    });

    const cert = await buildForm16A({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      financialYear: '2025-26',
      quarter: 'Q1',
    });

    const stream = form16AToPdf(cert);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const pdf = Buffer.concat(chunks);
    expect(pdf.length).toBeGreaterThan(1000); // anything plausible > 1KB
    // PDF magic number is `%PDF`
    expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });
});
