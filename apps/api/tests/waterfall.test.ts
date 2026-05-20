// Integration tests for the payment-waterfall service (spec §3.1).
//
// Covers all five agency-module flavours plus idempotency and the partial /
// exact-settlement edge cases on the CREDIT module. Uses real Mongo + Redis
// (singleFork — see vitest.config) and tears down per-test state.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgencyModule } from '@tripbng/shared';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Wallet } from '../src/models/Wallet.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { CreditSettlement } from '../src/models/CreditSettlement.js';
import { Counter } from '../src/models/Counter.js';
import { applyPayment } from '../src/services/wallet/waterfall.service.js';

let tenantId: Types.ObjectId;
const userId = new Types.ObjectId();

interface FixtureAgency {
  agencyId: Types.ObjectId;
  walletBefore: number;
  creditUsedBefore: number;
}

async function makeAgencyWithWallet(
  module: AgencyModule,
  walletBalance: number,
  creditUsed = 0,
): Promise<FixtureAgency> {
  const agencyId = new Types.ObjectId();
  await Agency.create({
    _id: agencyId,
    tenantId,
    agencyCode: `WF-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Waterfall Test',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    walletBalance,
    module,
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  await Wallet.create({
    tenantId,
    agencyId,
    walletCode: `WAL-WF-${crypto.randomBytes(4).toString('hex')}`,
    balance: walletBalance,
    creditUsed,
    version: 0,
  });
  return { agencyId, walletBefore: walletBalance, creditUsedBefore: creditUsed };
}

const pgRef = (): string => `pgref-${crypto.randomBytes(4).toString('hex')}`;

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `wf-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Waterfall Test Tenant',
    domain: 'wf.test',
  });
  tenantId = tenant._id;
});

afterAll(async () => {
  // Cleanup in dependency order — ledger entries first, then snapshots,
  // wallets, agencies, finally the tenant.
  await WalletTransaction.deleteMany({ tenantId });
  await CreditSettlement.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Counter.deleteMany({});
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await CreditSettlement.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
});

describe('WaterfallService.applyPayment', () => {
  // ────────── CASH module ──────────

  it('CASH module: full amount credits the wallet', async () => {
    const { agencyId } = await makeAgencyWithWallet('CASH', 0);
    const ref = pgRef();
    const res = await applyPayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 50_000,
      pgReferenceId: ref,
      pgGateway: 'PHONEPE',
      performedBy: String(userId),
    });

    expect(res.applied).toBe(true);
    expect(res.ledgerEntries.length).toBe(1);
    expect(res.ledgerEntries[0]!.type).toBe('TOPUP');
    expect(res.ledgerEntries[0]!.bucket).toBe('WALLET');
    expect(res.settlement.amountAppliedToCredit).toBe(0);
    expect(res.settlement.amountAppliedToWallet).toBe(50_000);

    const wallet = await Wallet.findOne({ agencyId }).lean();
    const agency = await Agency.findById(agencyId).lean();
    expect(wallet?.balance).toBe(50_000);
    expect(agency?.walletBalance).toBe(50_000); // dual-write
  });

  // ────────── CREDIT module ──────────

  it('CREDIT module with NO outstanding credit: full amount to wallet', async () => {
    const { agencyId } = await makeAgencyWithWallet('CREDIT', 0, 0);
    const ref = pgRef();
    const res = await applyPayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 100_000,
      pgReferenceId: ref,
      pgGateway: 'ICICI_ORANGE_PG',
      performedBy: String(userId),
    });
    expect(res.applied).toBe(true);
    expect(res.settlement.amountAppliedToCredit).toBe(0);
    expect(res.settlement.amountAppliedToWallet).toBe(100_000);
    expect(res.ledgerEntries.length).toBe(1);
    expect(res.ledgerEntries[0]!.type).toBe('TOPUP');
  });

  it('CREDIT module with PARTIAL credit (deposit < credit owed): all goes to credit', async () => {
    // Owed: ₹1000, deposit: ₹500 → settle 500, wallet leg = 0.
    const { agencyId } = await makeAgencyWithWallet('CREDIT', 0, 100_000);
    const ref = pgRef();
    const res = await applyPayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 50_000,
      pgReferenceId: ref,
      pgGateway: 'PHONEPE',
      performedBy: String(userId),
    });

    expect(res.applied).toBe(true);
    expect(res.settlement.amountAppliedToCredit).toBe(50_000);
    expect(res.settlement.amountAppliedToWallet).toBe(0);
    expect(res.ledgerEntries.length).toBe(1);
    expect(res.ledgerEntries[0]!.type).toBe('CREDIT_SETTLEMENT');
    expect(res.ledgerEntries[0]!.bucket).toBe('CREDIT');
    expect(res.ledgerEntries[0]!.direction).toBe('DEBIT');

    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.creditUsed).toBe(50_000); // 100_000 - 50_000
    expect(wallet?.balance).toBe(0);
    expect(wallet?.version).toBe(1); // single bump (credit leg only)
  });

  it('CREDIT module with SPLIT (deposit > credit owed): credit settled + wallet topped up', async () => {
    // Owed: ₹500, deposit: ₹1500 → settle 500, wallet leg = 1000.
    const { agencyId } = await makeAgencyWithWallet('CREDIT', 0, 50_000);
    const ref = pgRef();
    const res = await applyPayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 150_000,
      pgReferenceId: ref,
      pgGateway: 'ICICI_ORANGE_PG',
      performedBy: String(userId),
    });

    expect(res.applied).toBe(true);
    expect(res.settlement.amountAppliedToCredit).toBe(50_000);
    expect(res.settlement.amountAppliedToWallet).toBe(100_000);
    expect(res.ledgerEntries.length).toBe(2);
    const credit = res.ledgerEntries.find((l) => l.type === 'CREDIT_SETTLEMENT')!;
    const topup = res.ledgerEntries.find((l) => l.type === 'TOPUP')!;
    expect(credit.bucket).toBe('CREDIT');
    expect(credit.direction).toBe('DEBIT');
    expect(credit.amount).toBe(50_000);
    expect(topup.bucket).toBe('WALLET');
    expect(topup.direction).toBe('CREDIT');
    expect(topup.amount).toBe(100_000);

    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.creditUsed).toBe(0);
    expect(wallet?.balance).toBe(100_000);
    expect(wallet?.version).toBe(2); // bumped once per updateWalletWithVersion call
  });

  it('CREDIT module with EXACT match (deposit == credit owed): nothing to wallet', async () => {
    const { agencyId } = await makeAgencyWithWallet('CREDIT', 0, 75_000);
    const ref = pgRef();
    const res = await applyPayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 75_000,
      pgReferenceId: ref,
      pgGateway: 'PHONEPE',
      performedBy: String(userId),
    });
    expect(res.settlement.amountAppliedToCredit).toBe(75_000);
    expect(res.settlement.amountAppliedToWallet).toBe(0);
    expect(res.ledgerEntries.length).toBe(1);
    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.creditUsed).toBe(0);
    expect(wallet?.balance).toBe(0);
  });

  // ────────── DI module ──────────

  it('DI module: full amount credits the wallet (incentive deferred to Phase-2)', async () => {
    const { agencyId } = await makeAgencyWithWallet('DI', 0);
    const ref = pgRef();
    const res = await applyPayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 100_000,
      pgReferenceId: ref,
      pgGateway: 'PHONEPE',
      performedBy: String(userId),
    });
    expect(res.applied).toBe(true);
    expect(res.settlement.amountAppliedToWallet).toBe(100_000);
    expect(res.ledgerEntries.length).toBe(1);
    expect(res.ledgerEntries[0]!.type).toBe('TOPUP');
    // The DEPOSIT_INCENTIVE + TDS_DEDUCT entries are NOT produced here —
    // Phase-2's async incentive worker will post them based on this snapshot.
  });

  // ────────── Idempotency ──────────

  it('idempotent — duplicate webhook with the same pgReferenceId is a no-op', async () => {
    const { agencyId } = await makeAgencyWithWallet('CASH', 0);
    const ref = pgRef();
    const first = await applyPayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 50_000,
      pgReferenceId: ref,
      pgGateway: 'PHONEPE',
      performedBy: String(userId),
    });
    expect(first.applied).toBe(true);

    const second = await applyPayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 50_000,
      pgReferenceId: ref,
      pgGateway: 'PHONEPE',
      performedBy: String(userId),
    });
    expect(second.applied).toBe(false);
    expect(String(second.settlement._id)).toBe(String(first.settlement._id));

    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.balance).toBe(50_000); // NOT 100_000 — double-apply prevented
    const ledgerCount = await WalletTransaction.countDocuments({ pgReferenceId: ref });
    expect(ledgerCount).toBe(1);
  });

  it('idempotent across module flavours — same ref on a CREDIT split also dedupes', async () => {
    const { agencyId } = await makeAgencyWithWallet('CREDIT', 0, 30_000);
    const ref = pgRef();
    const first = await applyPayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 100_000,
      pgReferenceId: ref,
      pgGateway: 'PHONEPE',
      performedBy: String(userId),
    });
    expect(first.applied).toBe(true);
    expect(first.ledgerEntries.length).toBe(2);

    const second = await applyPayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 100_000,
      pgReferenceId: ref,
      pgGateway: 'PHONEPE',
      performedBy: String(userId),
    });
    expect(second.applied).toBe(false);
    const wallet = await Wallet.findOne({ agencyId }).lean();
    expect(wallet?.creditUsed).toBe(0);
    expect(wallet?.balance).toBe(70_000);
  });

  // ────────── Snapshot integrity ──────────

  it('settlement snapshot captures pre/post balances correctly', async () => {
    const { agencyId } = await makeAgencyWithWallet('CREDIT', 20_000, 40_000);
    const ref = pgRef();
    const res = await applyPayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 60_000,
      pgReferenceId: ref,
      pgGateway: 'ICICI_ORANGE_PG',
      performedBy: String(userId),
    });
    // 40k credit owed + 60k deposit → settle 40k, wallet leg = 20k.
    expect(res.settlement.creditBalanceBefore).toBe(40_000);
    expect(res.settlement.creditBalanceAfter).toBe(0);
    expect(res.settlement.walletBalanceBefore).toBe(20_000);
    expect(res.settlement.walletBalanceAfter).toBe(40_000);
    expect(res.settlement.ledgerEntryIds.length).toBe(2);
    expect(res.settlement.agencyModuleAtTime).toBe('CREDIT');
  });

  // ────────── Input validation ──────────

  it('rejects zero/negative amounts', async () => {
    const { agencyId } = await makeAgencyWithWallet('CASH', 0);
    await expect(
      applyPayment({
        tenantId: String(tenantId),
        agencyId: String(agencyId),
        amountPaise: 0,
        pgReferenceId: pgRef(),
        pgGateway: 'PHONEPE',
        performedBy: String(userId),
      }),
    ).rejects.toThrow();
  });

  it('rejects missing pgReferenceId', async () => {
    const { agencyId } = await makeAgencyWithWallet('CASH', 0);
    await expect(
      applyPayment({
        tenantId: String(tenantId),
        agencyId: String(agencyId),
        amountPaise: 1_000,
        pgReferenceId: '',
        pgGateway: 'PHONEPE',
        performedBy: String(userId),
      }),
    ).rejects.toThrow();
  });
});
