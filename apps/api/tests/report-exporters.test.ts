// Phase-11 exporter tests — verify the XLSX + PDF outputs of the admin
// wallet reports. We don't render-compare; we assert byte signatures, that
// the workbook round-trips with the rows we expect, and that totals/format
// markers land where the templates promise.
//
// The XLSX tests open the produced buffer with ExcelJS to read it back —
// this exercises both writer and reader, so any breakage in cell coercion
// or column key drift shows up here.

import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
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
import {
  creditExposureToPdf,
  creditExposureToXlsx,
  diPayoutToPdf,
  diPayoutToXlsx,
} from '../src/services/wallet/report-exporters.js';

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
    agencyCode: opts.code ?? `EX-${crypto.randomBytes(4).toString('hex')}`,
    companyName: opts.code ?? 'Test Agency',
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
    walletCode: `WAL-EX-${crypto.randomBytes(4).toString('hex')}`,
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

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

beforeAll(async () => {
  await connectMongo();
  const t = await Tenant.create({
    code: `expt-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Exporter Test',
    domain: 'expt.test',
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

// ─────────────────────────────────────────────────────────────────────────────
// Credit-exposure exporters
// ─────────────────────────────────────────────────────────────────────────────

describe('creditExposureToXlsx', () => {
  it('returns a buffer that starts with the XLSX (zip) magic', async () => {
    await makeCreditAgency({ code: 'EX-A', creditUsed: 50_000, creditDueDate: dayUtc(5) });
    const report = await runCreditExposureReport({ tenantId: String(tenantId) });
    const buf = await creditExposureToXlsx(report);
    // XLSX is a ZIP archive — first four bytes are "PK\x03\x04".
    expect(buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
  });

  it('round-trips: workbook reopened has both sheets and the right row count', async () => {
    await makeCreditAgency({ code: 'EX-RT1', creditUsed: 25_000, creditDueDate: dayUtc(-3) });
    await makeCreditAgency({ code: 'EX-RT2', creditUsed: 75_000, creditDueDate: dayUtc(5) });
    const report = await runCreditExposureReport({ tenantId: String(tenantId) });
    const buf = await creditExposureToXlsx(report);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    const main = wb.getWorksheet('Credit Exposure');
    expect(main).toBeDefined();
    // 1 header + 2 data + 1 totals = 4 rows.
    expect(main!.rowCount).toBe(4);

    const summary = wb.getWorksheet('Aging Summary');
    expect(summary).toBeDefined();
    // 1 header + 5 buckets = 6 rows.
    expect(summary!.rowCount).toBe(6);
  });

  it('TOTAL row reflects the report aggregates (rupees, not paise)', async () => {
    await makeCreditAgency({
      code: 'EX-T1',
      creditLimit: 200_000,
      creditUsed: 60_000,
      creditDueDate: dayUtc(5),
    });
    await makeCreditAgency({
      code: 'EX-T2',
      creditLimit: 300_000,
      creditUsed: 90_000,
      creditDueDate: dayUtc(5),
    });
    const report = await runCreditExposureReport({ tenantId: String(tenantId) });
    const buf = await creditExposureToXlsx(report);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Credit Exposure')!;
    const last = ws.getRow(ws.rowCount);
    expect(last.getCell(1).value).toBe('TOTAL');
    // Outstanding = 150_000 paise → 1500 rupees, written as the cell number.
    expect(Number(last.getCell(4).value)).toBe(1500);
  });

  it('empty report still produces a valid workbook with just headers + totals', async () => {
    const report = await runCreditExposureReport({ tenantId: String(tenantId) });
    expect(report.rows).toHaveLength(0);
    const buf = await creditExposureToXlsx(report);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Credit Exposure')!;
    // header + totals (no data rows)
    expect(ws.rowCount).toBe(2);
  });
});

describe('creditExposureToPdf', () => {
  it('produces a PDF stream that starts with the PDF magic', async () => {
    await makeCreditAgency({ code: 'EX-P', creditUsed: 40_000, creditDueDate: dayUtc(-5) });
    const report = await runCreditExposureReport({ tenantId: String(tenantId) });
    const buf = await streamToBuffer(creditExposureToPdf(report));
    // PDF magic header.
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    // Sanity: non-trivial size.
    expect(buf.length).toBeGreaterThan(500);
  });

  it('PDF for an empty report still emits a valid document', async () => {
    const report = await runCreditExposureReport({ tenantId: String(tenantId) });
    const buf = await streamToBuffer(creditExposureToPdf(report));
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DI payout exporters
// ─────────────────────────────────────────────────────────────────────────────

async function seedDiActivity(agencyId: Types.ObjectId, gross: number, tds: number): Promise<void> {
  // Yesterday — inside any reasonable test window.
  const createdAt = new Date(Date.now() - 86_400_000);
  // We use the raw driver to bypass Mongoose validation (avoids needing to
  // populate walletId + every audit field for a fixture ledger entry).
  await WalletTransaction.collection.insertOne({
    tenantId,
    txnId: `INC-${crypto.randomBytes(4).toString('hex')}`,
    userId: new Types.ObjectId(),
    agencyId,
    type: 'INCENTIVE_CREDIT',
    direction: 'CREDIT',
    amount: gross,
    bucket: 'WALLET',
    balanceAfter: gross,
    createdAt,
  });
  await WalletTransaction.collection.insertOne({
    tenantId,
    txnId: `TDS-${crypto.randomBytes(4).toString('hex')}`,
    userId: new Types.ObjectId(),
    agencyId,
    type: 'TDS_DEDUCT',
    direction: 'DEBIT',
    amount: tds,
    bucket: 'WALLET',
    balanceAfter: gross - tds,
    createdAt,
  });
}

describe('diPayoutToXlsx', () => {
  it('writes a sheet with the period banner and per-agency rows', async () => {
    const a1 = await makeCreditAgency({ code: 'DI-X1' });
    const a2 = await makeCreditAgency({ code: 'DI-X2' });
    await seedDiActivity(a1, 100_000, 10_000);
    await seedDiActivity(a2, 50_000, 5_000);

    const from = new Date(Date.now() - 7 * 86_400_000);
    const report = await runDiPayoutReport({ tenantId: String(tenantId), from });
    const buf = await diPayoutToXlsx(report);

    expect(buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('DI Payout')!;

    // Title row holds the period banner; column headers live on row 3.
    expect(String(ws.getCell('A1').value)).toContain('Distributor Incentive Payout');
    expect(ws.getCell('A3').value).toBe('Agency Code');
    expect(ws.getCell('D3').value).toBe('Gross Incentive');

    // Title (row 1) + spacer (row 2) + header (row 3) + 2 data + 1 totals = 6.
    expect(ws.rowCount).toBe(6);

    // Totals row gross = 150_000 paise → 1500 rupees.
    const totalsRow = ws.getRow(ws.rowCount);
    expect(totalsRow.getCell(1).value).toBe('TOTAL');
    expect(Number(totalsRow.getCell(4).value)).toBe(1500);
    expect(Number(totalsRow.getCell(5).value)).toBe(150); // TDS total
    expect(Number(totalsRow.getCell(6).value)).toBe(1350); // Net total
  });

  it('empty-period DI report produces a workbook with the banner but no data rows', async () => {
    const from = new Date(Date.now() - 7 * 86_400_000);
    const report = await runDiPayoutReport({ tenantId: String(tenantId), from });
    expect(report.rows).toHaveLength(0);
    const buf = await diPayoutToXlsx(report);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('DI Payout')!;
    // Title + spacer + header + totals = 4 rows (no data rows).
    expect(ws.rowCount).toBe(4);
  });
});

describe('diPayoutToPdf', () => {
  it('produces a PDF stream that starts with the PDF magic', async () => {
    const a = await makeCreditAgency({ code: 'DI-P' });
    await seedDiActivity(a, 25_000, 2_500);
    const from = new Date(Date.now() - 7 * 86_400_000);
    const report = await runDiPayoutReport({ tenantId: String(tenantId), from });
    const buf = await streamToBuffer(diPayoutToPdf(report));
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(500);
  });

  it('handles many rows without throwing (page-break path)', async () => {
    // Seed 25 agencies — enough to overflow a single page given the row pitch.
    for (let i = 0; i < 25; i++) {
      const a = await makeCreditAgency({ code: `DI-MULTI-${i}` });
      await seedDiActivity(a, 10_000 + i, 1_000 + i);
    }
    const from = new Date(Date.now() - 7 * 86_400_000);
    const report = await runDiPayoutReport({ tenantId: String(tenantId), from });
    expect(report.rows.length).toBe(25);
    const buf = await streamToBuffer(diPayoutToPdf(report));
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    // 25 rows + multi-page → output should be meaningfully larger than the
    // single-row case (>2 KB).
    expect(buf.length).toBeGreaterThan(2_000);
  });
});
