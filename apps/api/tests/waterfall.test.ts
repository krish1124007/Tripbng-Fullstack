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
import { applyPayment, simulatePayment } from '../src/services/wallet/waterfall.service.js';
import { DepositIncentiveConfig } from '../src/models/DepositIncentiveConfig.js';

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
  await DepositIncentiveConfig.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Counter.deleteMany({});
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await CreditSettlement.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await DepositIncentiveConfig.deleteMany({ tenantId });
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

// ─────────────────────────────────────────────────────────────────────────────
// simulatePayment — pure read-only counterpart used by SHADOW_WALLET mode
// (Phase 9, AGENCY_WALLET_SYSTEM spec §18). Must produce the same split
// numbers applyPayment would, without writing anything.
// ─────────────────────────────────────────────────────────────────────────────

describe('WaterfallService.simulatePayment', () => {
  it('CASH module: full amount classified as wallet, no DI incentive', async () => {
    const { agencyId } = await makeAgencyWithWallet('CASH', 250_000);
    const sim = await simulatePayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 50_000,
      pgReferenceId: pgRef(),
      pgGateway: 'PHONEPE',
      performedBy: String(userId),
    });

    expect(sim.module).toBe('CASH');
    expect(sim.amountReceivedPaise).toBe(50_000);
    expect(sim.appliedToCreditPaise).toBe(0);
    expect(sim.appliedToWalletPaise).toBe(50_000);
    expect(sim.walletBalanceBeforePaise).toBe(250_000);
    expect(sim.creditUsedBeforePaise).toBe(0);
    expect(sim.diIncentive).toBeNull();
  });

  it('CREDIT module with outstanding: splits between credit and wallet', async () => {
    const { agencyId } = await makeAgencyWithWallet('CREDIT', 100_000, 60_000);
    const sim = await simulatePayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 100_000,
      pgReferenceId: pgRef(),
      pgGateway: 'ICICI_ORANGE_PG',
      performedBy: String(userId),
    });

    expect(sim.module).toBe('CREDIT');
    expect(sim.appliedToCreditPaise).toBe(60_000);
    expect(sim.appliedToWalletPaise).toBe(40_000);
    expect(sim.creditUsedBeforePaise).toBe(60_000);
  });

  it('CREDIT module with no outstanding: full amount to wallet', async () => {
    const { agencyId } = await makeAgencyWithWallet('CREDIT', 100_000, 0);
    const sim = await simulatePayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 100_000,
      pgReferenceId: pgRef(),
      pgGateway: 'ICICI_ORANGE_PG',
      performedBy: String(userId),
    });

    expect(sim.appliedToCreditPaise).toBe(0);
    expect(sim.appliedToWalletPaise).toBe(100_000);
  });

  it('CREDIT module: payment smaller than outstanding — all to credit, 0 to wallet', async () => {
    const { agencyId } = await makeAgencyWithWallet('CREDIT', 0, 100_000);
    const sim = await simulatePayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 40_000,
      pgReferenceId: pgRef(),
      pgGateway: 'ICICI_ORANGE_PG',
      performedBy: String(userId),
    });

    expect(sim.appliedToCreditPaise).toBe(40_000);
    expect(sim.appliedToWalletPaise).toBe(0);
  });

  it('DI module with active config: computes incentive + TDS', async () => {
    const { agencyId } = await makeAgencyWithWallet('DI', 0);
    // 1% percent incentive on deposit, with 2% TDS on the gross incentive.
    await DepositIncentiveConfig.create({
      tenantId,
      agencyId,
      isActive: true,
      incentiveMode: 'PERCENT',
      incentiveBasisPoints: 100,        // 1.00%
      tdsApplicable: true,
      tdsBasisPoints: 200,              // 2.00%
      validFrom: new Date(Date.now() - 86400_000),
      validTo: null,
    });

    const sim = await simulatePayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 10_000_000,          // ₹1,00,000
      pgReferenceId: pgRef(),
      pgGateway: 'PHONEPE',
      performedBy: String(userId),
    });

    expect(sim.module).toBe('DI');
    expect(sim.appliedToWalletPaise).toBe(10_000_000);
    expect(sim.diIncentive).not.toBeNull();
    expect(sim.diIncentive?.incentivePaise).toBe(100_000); // 1% of ₹1L = ₹1,000
    expect(sim.diIncentive?.tdsPaise).toBe(2_000);          // 2% of ₹1,000 = ₹20
    expect(sim.diIncentive?.netCreditPaise).toBe(98_000);   // ₹980
  });

  it('DI module with no matching config: returns NO_CONFIG skip', async () => {
    const { agencyId } = await makeAgencyWithWallet('DI', 0);
    const sim = await simulatePayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 100_000,
      pgReferenceId: pgRef(),
      pgGateway: 'PHONEPE',
      performedBy: String(userId),
    });

    expect(sim.module).toBe('DI');
    expect(sim.appliedToWalletPaise).toBe(100_000);
    expect(sim.diIncentive).toEqual({
      incentivePaise: 0,
      tdsPaise: 0,
      netCreditPaise: 0,
      skip: 'NO_CONFIG',
    });
  });

  it('is genuinely read-only: no Wallet / WalletTransaction / CreditSettlement writes', async () => {
    const { agencyId } = await makeAgencyWithWallet('CREDIT', 100_000, 60_000);

    const txnsBefore = await WalletTransaction.countDocuments({ tenantId });
    const settlementsBefore = await CreditSettlement.countDocuments({ tenantId });
    const walletBefore = await Wallet.findOne({ agencyId }).lean();

    await simulatePayment({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      amountPaise: 100_000,
      pgReferenceId: pgRef(),
      pgGateway: 'ICICI_ORANGE_PG',
      performedBy: String(userId),
    });

    const txnsAfter = await WalletTransaction.countDocuments({ tenantId });
    const settlementsAfter = await CreditSettlement.countDocuments({ tenantId });
    const walletAfter = await Wallet.findOne({ agencyId }).lean();

    expect(txnsAfter).toBe(txnsBefore);
    expect(settlementsAfter).toBe(settlementsBefore);
    expect(walletAfter?.balance).toBe(walletBefore?.balance);
    expect(walletAfter?.creditUsed).toBe(walletBefore?.creditUsed);
    expect(walletAfter?.version).toBe(walletBefore?.version);
  });

  it('matches applyPayment split numbers for the same input', async () => {
    // Same fixture, same input → simulate and apply must report identical
    // appliedToCredit / appliedToWallet numbers. Catches drift between the
    // two code paths (which is the whole point of shadow mode).
    const { agencyId: simAgency } = await makeAgencyWithWallet('CREDIT', 100_000, 40_000);
    const { agencyId: applyAgency } = await makeAgencyWithWallet('CREDIT', 100_000, 40_000);

    const sim = await simulatePayment({
      tenantId: String(tenantId),
      agencyId: String(simAgency),
      amountPaise: 75_000,
      pgReferenceId: pgRef(),
      pgGateway: 'ICICI_ORANGE_PG',
      performedBy: String(userId),
    });

    const apply = await applyPayment({
      tenantId: String(tenantId),
      agencyId: String(applyAgency),
      amountPaise: 75_000,
      pgReferenceId: pgRef(),
      pgGateway: 'ICICI_ORANGE_PG',
      performedBy: String(userId),
    });

    expect(sim.appliedToCreditPaise).toBe(apply.settlement.amountAppliedToCredit);
    expect(sim.appliedToWalletPaise).toBe(apply.settlement.amountAppliedToWallet);
  });

  it('rejects missing agency the same way applyPayment does', async () => {
    const ghostAgencyId = new Types.ObjectId();
    await expect(
      simulatePayment({
        tenantId: String(tenantId),
        agencyId: String(ghostAgencyId),
        amountPaise: 1_000,
        pgReferenceId: pgRef(),
        pgGateway: 'PHONEPE',
        performedBy: String(userId),
      }),
    ).rejects.toThrow();
  });
});
