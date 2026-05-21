// Phase-C tests for the Form 26Q quarterly TDS-return preparation service.
//
// Covers:
//   - resolveQuarterRange (pure) — every quarter's UTC date pair, FY format
//     validation, FY-suffix arithmetic.
//   - runForm26QExport integration — pulls TDS_DEDUCT ledger entries,
//     joins to Agency for deductee identity, flags missing PAN/category,
//     pairs to the parent INCENTIVE_CREDIT for amount-paid resolution.
//   - form26QToCsv — CSV escapes commas/quotes, totals row, two-decimal
//     paise→rupee conversion (RPU rejects rows with currency symbols).

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import {
  form26QToCsv,
  resolveQuarterRange,
  runForm26QExport,
} from '../src/services/tax/form-26q.service.js';

let tenantId: Types.ObjectId;

async function makeAgency(opts: {
  panNumber?: string | null;
  panName?: string | null;
  deducteeCategory?: 'INDIVIDUAL' | 'COMPANY' | 'FIRM' | null;
  companyName?: string;
}): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await Agency.create({
    _id: id,
    tenantId,
    agencyCode: `F26-${crypto.randomBytes(3).toString('hex')}`,
    companyName: opts.companyName ?? 'Form-26Q Test Agency',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: '12 Tax Street',
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
    pan: {
      number: opts.panNumber ?? undefined,
      name: opts.panName ?? undefined,
      deducteeCategory: opts.deducteeCategory ?? null,
    },
  });
  return id;
}

/**
 * Insert an INCENTIVE_CREDIT + paired TDS_DEDUCT at a specific date (so
 * we can target a specific quarter). Mirrors the DI worker's shape but
 * uses the raw driver to skip the schema's strict performedBy/balanceAfter
 * casts — we're testing the Form 26Q aggregation, not the ledger writer.
 */
async function insertTdsPair(opts: {
  agencyId: Types.ObjectId;
  grossPaise: number;
  tdsPaise: number;
  at: Date;
}): Promise<void> {
  const incentiveTxnId = `WT-INC-${crypto.randomBytes(4).toString('hex')}`;
  const tdsTxnId = `WT-TDS-${crypto.randomBytes(4).toString('hex')}`;
  const incentiveId = new Types.ObjectId();
  const tdsId = new Types.ObjectId();
  const performedBy = new Types.ObjectId(); // synthetic system user

  await WalletTransaction.collection.insertOne({
    _id: incentiveId,
    tenantId,
    txnId: incentiveTxnId,
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
    txnId: tdsTxnId,
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
    code: `f26-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Form 26Q Test',
    domain: 'f26.test',
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

describe('resolveQuarterRange — pure', () => {
  it('Q1 = Apr 1 → Jul 1 (exclusive)', () => {
    const r = resolveQuarterRange('2025-26', 'Q1');
    expect(r.from.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2025-07-01T00:00:00.000Z');
  });

  it('Q2 = Jul 1 → Oct 1 (exclusive)', () => {
    const r = resolveQuarterRange('2025-26', 'Q2');
    expect(r.from.toISOString()).toBe('2025-07-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2025-10-01T00:00:00.000Z');
  });

  it('Q4 spans across calendar years (Jan-Mar of the latter year)', () => {
    const r = resolveQuarterRange('2025-26', 'Q4');
    expect(r.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('rejects malformed FY strings', () => {
    expect(() => resolveQuarterRange('2025', 'Q1')).toThrow();
    expect(() => resolveQuarterRange('2025-2026', 'Q1')).toThrow();
  });

  it('rejects FY whose suffix does not match the next year', () => {
    expect(() => resolveQuarterRange('2025-27', 'Q1')).toThrow();
  });
});

describe('runForm26QExport — integration', () => {
  it('returns empty report when no TDS in the quarter', async () => {
    const r = await runForm26QExport({
      tenantId: String(tenantId),
      financialYear: '2025-26',
      quarter: 'Q1',
    });
    expect(r.rows).toHaveLength(0);
    expect(r.totals.tdsAmountPaise).toBe(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('produces one row per TDS_DEDUCT, paired to the parent INCENTIVE_CREDIT', async () => {
    const agencyId = await makeAgency({
      panNumber: 'AAAPL1234C',
      panName: 'Test Agency Pvt Ltd',
      deducteeCategory: 'COMPANY',
    });
    await insertTdsPair({
      agencyId,
      grossPaise: 100_000, // ₹1000 gross
      tdsPaise: 5_000, // ₹50 TDS @ 5%
      at: new Date('2025-04-15T10:00:00.000Z'),
    });

    const r = await runForm26QExport({
      tenantId: String(tenantId),
      financialYear: '2025-26',
      quarter: 'Q1',
    });
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(row.panOfDeductee).toBe('AAAPL1234C');
    expect(row.nameOfDeductee).toBe('Test Agency Pvt Ltd');
    expect(row.deducteeCode).toBe('3'); // COMPANY
    expect(row.amountPaidOrCreditedPaise).toBe(100_000);
    expect(row.tdsAmountPaise).toBe(5_000);
    expect(row.totalTaxDeductedPaise).toBe(5_000);
    expect(row.sectionCode).toBe('194H');
    expect(r.totals.tdsAmountPaise).toBe(5_000);
    expect(r.totals.deducteeCount).toBe(1);
    expect(r.warnings).toHaveLength(0);
  });

  it('excludes TDS rows outside the quarter window', async () => {
    const agencyId = await makeAgency({
      panNumber: 'AAAPL1234C',
      panName: 'Acme',
      deducteeCategory: 'INDIVIDUAL',
    });
    await insertTdsPair({
      agencyId,
      grossPaise: 50_000,
      tdsPaise: 2_500,
      at: new Date('2025-03-31T23:00:00.000Z'), // Q4 of prior FY
    });
    await insertTdsPair({
      agencyId,
      grossPaise: 80_000,
      tdsPaise: 4_000,
      at: new Date('2025-04-01T10:00:00.000Z'), // Q1 of 2025-26
    });

    const r = await runForm26QExport({
      tenantId: String(tenantId),
      financialYear: '2025-26',
      quarter: 'Q1',
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.amountPaidOrCreditedPaise).toBe(80_000);
  });

  it('flags agencies missing PAN as warnings (but still emits the row)', async () => {
    const agencyId = await makeAgency({
      panNumber: null,
      panName: null,
      deducteeCategory: null,
      companyName: 'Naked Agency',
    });
    await insertTdsPair({
      agencyId,
      grossPaise: 60_000,
      tdsPaise: 3_000,
      at: new Date('2025-04-10T10:00:00.000Z'),
    });

    const r = await runForm26QExport({
      tenantId: String(tenantId),
      financialYear: '2025-26',
      quarter: 'Q1',
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.panOfDeductee).toBe(''); // empty, not missing
    expect(r.rows[0]!.nameOfDeductee).toBe('Naked Agency'); // falls back to companyName
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.reasons).toEqual(
      expect.arrayContaining(['MISSING_PAN', 'MISSING_PAN_NAME', 'MISSING_DEDUCTEE_CATEGORY']),
    );
    expect(r.warnings[0]!.affectedRowCount).toBeGreaterThanOrEqual(1);
  });

  it('aggregates multiple TDS rows across multiple deductees correctly', async () => {
    const a1 = await makeAgency({
      panNumber: 'AAAPL1111C',
      panName: 'A One',
      deducteeCategory: 'COMPANY',
    });
    const a2 = await makeAgency({
      panNumber: 'AAAPL2222C',
      panName: 'A Two',
      deducteeCategory: 'INDIVIDUAL',
    });
    await insertTdsPair({
      agencyId: a1,
      grossPaise: 50_000,
      tdsPaise: 2_500,
      at: new Date('2025-04-10T10:00:00.000Z'),
    });
    await insertTdsPair({
      agencyId: a1,
      grossPaise: 30_000,
      tdsPaise: 1_500,
      at: new Date('2025-05-15T10:00:00.000Z'),
    });
    await insertTdsPair({
      agencyId: a2,
      grossPaise: 70_000,
      tdsPaise: 3_500,
      at: new Date('2025-06-20T10:00:00.000Z'),
    });

    const r = await runForm26QExport({
      tenantId: String(tenantId),
      financialYear: '2025-26',
      quarter: 'Q1',
    });
    expect(r.rows).toHaveLength(3);
    expect(r.totals.grossAmountPaise).toBe(150_000);
    expect(r.totals.tdsAmountPaise).toBe(7_500);
    expect(r.totals.deducteeCount).toBe(2); // unique PANs
  });
});

describe('form26QToCsv — CSV format', () => {
  it('emits a header row + one row per record + a totals row', async () => {
    const agencyId = await makeAgency({
      panNumber: 'AAAPL1234C',
      panName: 'Test, Inc.', // includes a comma — must be quoted
      deducteeCategory: 'COMPANY',
    });
    await insertTdsPair({
      agencyId,
      grossPaise: 100_000,
      tdsPaise: 5_000,
      at: new Date('2025-04-15T10:00:00.000Z'),
    });

    const r = await runForm26QExport({
      tenantId: String(tenantId),
      financialYear: '2025-26',
      quarter: 'Q1',
    });
    const csv = form26QToCsv(r);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3); // header + 1 data + totals
    expect(lines[0]).toContain('PAN of Deductee');
    // Comma in deductee name → field is quoted
    expect(lines[1]).toContain('"Test, Inc."');
    // Two-decimal rupees, no currency symbol, no thousands separator
    expect(lines[1]).toContain(',1000.00,');
    expect(lines[1]).toContain(',50.00,');
    expect(lines[2]!.startsWith('TOTAL')).toBe(true);
  });

  it('quotes fields containing CRLF or quotes', () => {
    // We test the escaping by hand-crafting a report — the live code uses
    // composeAddress which doesn't produce quotes/newlines, so the only way
    // to hit those branches is via injection.
    const report = {
      tenantId: 'x',
      financialYear: '2025-26' as const,
      quarter: 'Q1' as const,
      quarterFrom: '2025-04-01',
      quarterTo: '2025-07-01',
      generatedAt: new Date().toISOString(),
      rows: [
        {
          srNo: 1,
          deducteeCode: '3',
          deducteeCategory: 'COMPANY' as const,
          panOfDeductee: 'AAAPL1234C',
          nameOfDeductee: 'He said "hi"',
          address: 'Line 1\r\nLine 2',
          sectionCode: '194H' as const,
          dateOfPaymentOrCredit: '2025-04-15',
          amountPaidOrCreditedPaise: 100_000,
          tdsAmountPaise: 5_000,
          surchargePaise: 0,
          hecPaise: 0,
          totalTaxDeductedPaise: 5_000,
          dateOfTaxDeduction: '2025-04-15',
          reasonForNonDeduction: '',
          ledgerTxnId: 'WT-x',
        },
      ],
      totals: {
        deducteeCount: 1,
        rowCount: 1,
        grossAmountPaise: 100_000,
        tdsAmountPaise: 5_000,
        surchargePaise: 0,
        hecPaise: 0,
        totalTaxDeductedPaise: 5_000,
      },
      warnings: [],
    };
    const csv = form26QToCsv(report);
    expect(csv).toContain('"He said ""hi"""');
    expect(csv).toContain('"Line 1\r\nLine 2"');
  });
});
