// Integration tests for the wallet-integrity service.
//
// Builds a tiny dataset (tenant + agencies + ledger rows) and runs
// `runIntegrityCheck` to confirm: clean wallets report zero drift, mismatched
// caches report positive/negative drift, dual-write mismatch is flagged, and
// orphan-cache agencies (no ledger rows but non-zero cached balance) are
// surfaced. Audit + reconciliation timestamps are not asserted heavily — the
// service's own log + AuditLog writes are exercised via a `dryRun: false` path.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Wallet } from '../src/models/Wallet.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import {
  hasDrift,
  runIntegrityCheck,
} from '../src/services/wallet/integrity-check.service.js';

let tenantId: Types.ObjectId;

async function makeAgency(walletBalance: number): Promise<Types.ObjectId> {
  const code = `INT-AG-${crypto.randomBytes(4).toString('hex')}`;
  const agency = await Agency.create({
    tenantId,
    agencyCode: code,
    companyName: 'Integrity Test Agency',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'test',
    walletBalance,
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  return agency._id;
}

async function makeWallet(agencyId: Types.ObjectId, balance: number): Promise<Types.ObjectId> {
  const code = `WAL-INT-${crypto.randomBytes(4).toString('hex')}`;
  const wallet = await Wallet.create({
    tenantId,
    agencyId,
    walletCode: code,
    balance,
    version: 0,
  });
  return wallet._id;
}

async function ledger(
  agencyId: Types.ObjectId,
  direction: 'CREDIT' | 'DEBIT',
  amount: number,
  type = 'TOPUP' as const,
  bucket: 'WALLET' | 'CREDIT' = 'WALLET',
): Promise<void> {
  await WalletTransaction.create({
    tenantId,
    txnId: `TXN-${crypto.randomBytes(4).toString('hex')}`,
    userId: new Types.ObjectId(),
    agencyId,
    direction,
    type,
    amount,
    bucket,
    balanceAfter: 0, // not asserted by the service
    description: 'integrity-test',
  });
}

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `int-test-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Integrity Test Tenant',
    domain: 'int.test',
  });
  tenantId = tenant._id;
});

afterAll(async () => {
  // Clean up everything this suite created. Order: ledger → wallets → agencies
  // → tenant, so foreign-key-ish references don't dangle in admin tooling.
  await WalletTransaction.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  // Each test owns its dataset — wipe between to keep assertions tight.
  await WalletTransaction.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
});

describe('runIntegrityCheck', () => {
  it('reports zero drift when caches match ledger sum', async () => {
    const agencyId = await makeAgency(10_000); // ₹100
    await makeWallet(agencyId, 10_000);
    await ledger(agencyId, 'CREDIT', 10_000);

    const report = await runIntegrityCheck({ tenantId: String(tenantId), dryRun: true });
    expect(report.scannedAgencies).toBe(1);
    expect(report.driftedAgencies).toBe(0);
    const row = report.rows[0]!;
    expect(row.ledgerSumPaise).toBe(10_000);
    expect(row.driftAgencyPaise).toBe(0);
    expect(row.driftWalletPaise).toBe(0);
    expect(row.driftBetweenCachesPaise).toBe(0);
    expect(hasDrift(row)).toBe(false);
  });

  it('reports positive drift when Agency cache is too high', async () => {
    const agencyId = await makeAgency(15_000); // cached 150
    await makeWallet(agencyId, 15_000);
    await ledger(agencyId, 'CREDIT', 10_000); // ledger only 100

    const report = await runIntegrityCheck({ tenantId: String(tenantId), dryRun: true });
    const row = report.rows[0]!;
    expect(row.ledgerSumPaise).toBe(10_000);
    expect(row.driftAgencyPaise).toBe(5_000);
    expect(row.driftWalletPaise).toBe(5_000);
    expect(row.driftBetweenCachesPaise).toBe(0); // caches agree with each other, both wrong
    expect(report.driftedAgencies).toBe(1);
  });

  it('reports drift between caches when Agency.walletBalance and Wallet.balance disagree', async () => {
    const agencyId = await makeAgency(20_000); // Agency cache 200
    await makeWallet(agencyId, 18_000); // Wallet cache 180
    await ledger(agencyId, 'CREDIT', 20_000); // Ledger 200 — agency cache matches, wallet doesn't

    const report = await runIntegrityCheck({ tenantId: String(tenantId), dryRun: true });
    const row = report.rows[0]!;
    expect(row.driftAgencyPaise).toBe(0);
    expect(row.driftWalletPaise).toBe(-2_000);
    expect(row.driftBetweenCachesPaise).toBe(2_000);
    expect(hasDrift(row)).toBe(true);
    expect(report.driftedAgencies).toBe(1);
  });

  it('handles a mix of credits and debits', async () => {
    const agencyId = await makeAgency(5_000);
    await makeWallet(agencyId, 5_000);
    await ledger(agencyId, 'CREDIT', 10_000); // +100
    await ledger(agencyId, 'DEBIT', 3_000, 'BOOKING_DEBIT'); // -30
    await ledger(agencyId, 'DEBIT', 2_000, 'BOOKING_DEBIT'); // -20
    // Expected ledger sum = 5_000; caches = 5_000 → no drift.

    const report = await runIntegrityCheck({ tenantId: String(tenantId), dryRun: true });
    const row = report.rows[0]!;
    expect(row.ledgerSumPaise).toBe(5_000);
    expect(hasDrift(row)).toBe(false);
  });

  it('ignores CREDIT-bucket ledger entries when summing the WALLET bucket', async () => {
    const agencyId = await makeAgency(0);
    await makeWallet(agencyId, 0);
    // 100 in WALLET bucket + 50 in CREDIT bucket. The integrity sum should
    // ONLY count the WALLET row.
    await ledger(agencyId, 'CREDIT', 10_000, 'TOPUP', 'WALLET');
    await ledger(agencyId, 'CREDIT', 5_000, 'TOPUP', 'CREDIT');

    const report = await runIntegrityCheck({ tenantId: String(tenantId), dryRun: true });
    const row = report.rows.find((r) => r.agencyId === String(agencyId))!;
    expect(row.ledgerSumPaise).toBe(10_000);
    // Cache says 0, ledger says 10_000 → cache is too low by 10_000.
    expect(row.driftAgencyPaise).toBe(-10_000);
  });

  it('surfaces agencies with non-zero cache but zero ledger entries (orphan cache)', async () => {
    // Imagine a seeded agency given an opening balance with no ledger row.
    const agencyId = await makeAgency(50_000);
    // Deliberately no Wallet doc, no WalletTransaction rows.

    const report = await runIntegrityCheck({ tenantId: String(tenantId), dryRun: true });
    const row = report.rows.find((r) => r.agencyId === String(agencyId));
    expect(row).toBeDefined();
    expect(row!.ledgerSumPaise).toBe(0);
    expect(row!.driftAgencyPaise).toBe(50_000);
    expect(report.driftedAgencies).toBeGreaterThan(0);
  });

  it('treats legacy ledger rows (bucket unset) as WALLET', async () => {
    const agencyId = await makeAgency(7_000);
    await makeWallet(agencyId, 7_000);
    // Insert a row WITHOUT bucket — simulating legacy data written before the
    // Phase-1 step 5 schema change. We bypass the Mongoose default by writing
    // raw via the underlying collection.
    await WalletTransaction.collection.insertOne({
      tenantId,
      txnId: `LEGACY-${crypto.randomBytes(4).toString('hex')}`,
      userId: new Types.ObjectId(),
      agencyId,
      direction: 'CREDIT',
      type: 'TOPUP',
      amount: 7_000,
      balanceAfter: 7_000,
      description: 'legacy',
      createdAt: new Date(),
    });

    const report = await runIntegrityCheck({ tenantId: String(tenantId), dryRun: true });
    const row = report.rows.find((r) => r.agencyId === String(agencyId))!;
    expect(row.ledgerSumPaise).toBe(7_000);
    expect(hasDrift(row)).toBe(false);
  });

  it('persistence path (dryRun=false) writes lastReconciledAt on Wallet docs', async () => {
    const agencyId = await makeAgency(2_000);
    const walletId = await makeWallet(agencyId, 2_000);
    await ledger(agencyId, 'CREDIT', 2_000);

    await runIntegrityCheck({ tenantId: String(tenantId), dryRun: false });

    const wallet = await Wallet.findById(walletId).lean();
    expect(wallet?.lastReconciledAt).toBeTruthy();
    expect(wallet?.lastReconciledBalance).toBe(2_000);
  });

  it('respects the agencyIds scope option', async () => {
    const a = await makeAgency(0);
    const b = await makeAgency(0);
    await ledger(a, 'CREDIT', 1_000);
    await ledger(b, 'CREDIT', 5_000);

    const report = await runIntegrityCheck({
      tenantId: String(tenantId),
      agencyIds: [String(a)],
      dryRun: true,
    });
    expect(report.scannedAgencies).toBe(1);
    expect(report.rows[0]!.agencyId).toBe(String(a));
  });
});
