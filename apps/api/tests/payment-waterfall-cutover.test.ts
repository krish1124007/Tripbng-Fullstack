// Phase-13 — paymentService.markSuccess cutover tests.
//
// Verifies the branching introduced when WATERFALL_LIVE is flipped on:
//   1. legacy path (flag OFF) writes a single TOPUP row and no CreditSettlement
//   2. waterfall path on a CASH agency credits wallet fully and writes a
//      CreditSettlement snapshot but no CREDIT_SETTLEMENT leg
//   3. waterfall path on a CREDIT agency with outstanding splits across legs
//   4. distributor-attributed PT (no agencyId) stays on legacy even when the
//      flag is on
//   5. duplicate markSuccess under waterfall is a clean no-op
//
// Implementation detail: env is parsed once at import time and frozen into
// the `env` object — but the object itself is mutable, so the tests flip
// `env.WATERFALL_LIVE` between cases. Casts via `(env as { ... })` avoid the
// readonly TS surface while keeping the runtime mutation honest.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgencyModule } from '@tripbng/shared';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Distributor } from '../src/models/Distributor.js';
import { Wallet } from '../src/models/Wallet.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { CreditSettlement } from '../src/models/CreditSettlement.js';
import { Counter } from '../src/models/Counter.js';
import {
  PaymentTransaction,
  type PaymentStatus,
} from '../src/models/PaymentTransaction.js';
import { paymentService } from '../src/services/payment/payment.service.js';

let tenantId: Types.ObjectId;
const initiatedByUserId = new Types.ObjectId();

interface Fixture {
  agencyId: Types.ObjectId;
  walletId: Types.ObjectId;
}

async function makeAgencyWithWallet(
  module: AgencyModule,
  walletBalance: number,
  creditUsed = 0,
): Promise<Fixture> {
  const agencyId = new Types.ObjectId();
  const walletId = new Types.ObjectId();
  await Agency.create({
    _id: agencyId,
    tenantId,
    agencyCode: `PWC-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Payment Cutover Test',
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
    _id: walletId,
    tenantId,
    agencyId,
    walletCode: `WAL-PWC-${crypto.randomBytes(4).toString('hex')}`,
    balance: walletBalance,
    creditUsed,
    version: 0,
  });
  return { agencyId, walletId };
}

async function seedPendingPT(opts: {
  agencyId?: Types.ObjectId | null;
  walletId: Types.ObjectId;
  amount: number;
  providerCode?: 'ICICI_ORANGE_PG' | 'PHONEPE' | 'MANUAL';
  status?: PaymentStatus;
  gatewayTxnId?: string;
  distributorId?: Types.ObjectId | null;
}): Promise<Types.ObjectId> {
  // We use the raw driver to skip the strict schema validation around audit
  // fields — markSuccess doesn't read them, and seeding 20 fields per test
  // would be unreadable. The unique-index requirements (txnCode etc.) are
  // honoured by minting fresh values per fixture.
  const id = new Types.ObjectId();
  await PaymentTransaction.collection.insertOne({
    _id: id,
    tenantId,
    txnCode: `PT${crypto.randomBytes(6).toString('hex')}`,
    walletId: opts.walletId,
    initiatedByUserId,
    agencyId: opts.agencyId ?? null,
    distributorId: opts.distributorId ?? null,
    purpose: 'WALLET_TOPUP',
    amount: opts.amount,
    currency: 'INR',
    providerCode: opts.providerCode ?? 'ICICI_ORANGE_PG',
    status: opts.status ?? 'PENDING',
    gatewayTxnId: opts.gatewayTxnId ?? `gw-${crypto.randomBytes(4).toString('hex')}`,
    statusHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    initiatedAt: new Date(),
  });
  return id;
}

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `pwc-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Payment Cutover Test Tenant',
    domain: 'pwc.test',
  });
  tenantId = tenant._id;
});

afterAll(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await CreditSettlement.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await PaymentTransaction.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Distributor.deleteMany({ tenantId });
  await Counter.deleteMany({});
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await CreditSettlement.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await PaymentTransaction.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Distributor.deleteMany({ tenantId });
  // Always restore the default before each test — the flag flip per case
  // is opt-in and a leaked flag would silently miscategorize later tests.
  (env as { WATERFALL_LIVE: boolean }).WATERFALL_LIVE = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// Path 1: legacy
// ─────────────────────────────────────────────────────────────────────────────

describe('markSuccess — legacy path (WATERFALL_LIVE=false)', () => {
  it('credits the full amount via walletService.credit; no CreditSettlement row', async () => {
    const { agencyId, walletId } = await makeAgencyWithWallet('CASH', 0);
    const ptId = await seedPendingPT({ agencyId, walletId, amount: 100_000 });

    await paymentService.markSuccess(ptId, { verificationMethod: 'WEBHOOK' });

    const ledger = await WalletTransaction.find({ agencyId }).lean();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.type).toBe('TOPUP');
    expect(ledger[0]!.bucket).toBe('WALLET');
    expect(ledger[0]!.amount).toBe(100_000);

    // No snapshot — that's a waterfall-only artefact.
    const settlements = await CreditSettlement.countDocuments({ agencyId });
    expect(settlements).toBe(0);

    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(pt!.status).toBe('SUCCESS');
    expect(String(pt!.walletTransactionId)).toBe(String(ledger[0]!._id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Path 2: waterfall on a CASH agency — no credit-settlement leg
// ─────────────────────────────────────────────────────────────────────────────

describe('markSuccess — waterfall path on CASH agency (WATERFALL_LIVE=true)', () => {
  beforeEach(() => {
    (env as { WATERFALL_LIVE: boolean }).WATERFALL_LIVE = true;
  });

  it('writes one TOPUP ledger row and a CreditSettlement snapshot, no settle leg', async () => {
    const { agencyId, walletId } = await makeAgencyWithWallet('CASH', 5_000);
    const ptId = await seedPendingPT({
      agencyId,
      walletId,
      amount: 200_000,
      gatewayTxnId: 'gw-cash-1',
    });

    await paymentService.markSuccess(ptId, { verificationMethod: 'WEBHOOK' });

    const ledger = await WalletTransaction.find({ agencyId }).lean();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.type).toBe('TOPUP');
    expect(ledger[0]!.bucket).toBe('WALLET');
    expect(ledger[0]!.amount).toBe(200_000);

    const settlements = await CreditSettlement.find({ agencyId }).lean();
    expect(settlements).toHaveLength(1);
    expect(settlements[0]!.amountReceived).toBe(200_000);
    expect(settlements[0]!.amountAppliedToCredit).toBe(0);
    expect(settlements[0]!.amountAppliedToWallet).toBe(200_000);
    expect(settlements[0]!.agencyModuleAtTime).toBe('CASH');

    const wallet = await Wallet.findById(walletId).lean();
    expect(wallet!.balance).toBe(205_000); // pre-existing 5k + 200k

    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(pt!.status).toBe('SUCCESS');
    expect(String(pt!.walletTransactionId)).toBe(String(ledger[0]!._id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Path 3: waterfall on a CREDIT agency with outstanding — the whole point
// ─────────────────────────────────────────────────────────────────────────────

describe('markSuccess — waterfall path on CREDIT agency with outstanding', () => {
  beforeEach(() => {
    (env as { WATERFALL_LIVE: boolean }).WATERFALL_LIVE = true;
  });

  it('splits the payment: settle credit first, top up wallet with remainder', async () => {
    // Agency owes 75k on credit; pays 200k — 75k settles credit, 125k tops up.
    const { agencyId, walletId } = await makeAgencyWithWallet('CREDIT', 0, 75_000);
    const ptId = await seedPendingPT({
      agencyId,
      walletId,
      amount: 200_000,
      gatewayTxnId: 'gw-credit-split',
    });

    await paymentService.markSuccess(ptId, { verificationMethod: 'WEBHOOK' });

    const ledger = await WalletTransaction.find({ agencyId }).sort({ createdAt: 1 }).lean();
    expect(ledger).toHaveLength(2);

    const creditLeg = ledger.find((l) => l.type === 'CREDIT_SETTLEMENT')!;
    const topupLeg = ledger.find((l) => l.type === 'TOPUP')!;
    expect(creditLeg).toBeDefined();
    expect(topupLeg).toBeDefined();

    expect(creditLeg.bucket).toBe('CREDIT');
    expect(creditLeg.direction).toBe('DEBIT');
    expect(creditLeg.amount).toBe(75_000);

    expect(topupLeg.bucket).toBe('WALLET');
    expect(topupLeg.direction).toBe('CREDIT');
    expect(topupLeg.amount).toBe(125_000);

    const settlement = await CreditSettlement.findOne({ agencyId }).lean();
    expect(settlement!.amountAppliedToCredit).toBe(75_000);
    expect(settlement!.amountAppliedToWallet).toBe(125_000);
    expect(settlement!.agencyModuleAtTime).toBe('CREDIT');

    // PT links to the TOPUP leg, not the settlement leg.
    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(String(pt!.walletTransactionId)).toBe(String(topupLeg._id));
  });

  it('payment ≤ outstanding settles credit entirely; no wallet leg', async () => {
    const { agencyId, walletId } = await makeAgencyWithWallet('CREDIT', 0, 75_000);
    const ptId = await seedPendingPT({
      agencyId,
      walletId,
      amount: 50_000,
      gatewayTxnId: 'gw-credit-exact',
    });

    await paymentService.markSuccess(ptId, { verificationMethod: 'WEBHOOK' });

    const ledger = await WalletTransaction.find({ agencyId }).lean();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.type).toBe('CREDIT_SETTLEMENT');
    expect(ledger[0]!.amount).toBe(50_000);

    // Falls back to the CREDIT_SETTLEMENT leg as the PT linkage anchor.
    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(String(pt!.walletTransactionId)).toBe(String(ledger[0]!._id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Path 4: distributor PT — no agencyId, stays on legacy even when flag is on
// ─────────────────────────────────────────────────────────────────────────────

describe('markSuccess — distributor-attributed PT (no agencyId) with flag on', () => {
  it('falls back to the legacy path; no CreditSettlement is written', async () => {
    (env as { WATERFALL_LIVE: boolean }).WATERFALL_LIVE = true;

    // No agency — distributor top-up. Wallet is owned by the distributor.
    const distributorId = new Types.ObjectId();
    const walletId = new Types.ObjectId();
    await Distributor.create({
      _id: distributorId,
      tenantId,
      distributorCode: `DIST-${crypto.randomBytes(4).toString('hex')}`,
      companyName: 'Test Distributor',
      ownerUserId: new Types.ObjectId(),
      state: 'MH',
      city: 'Mumbai',
      pincode: '400001',
      address: 'x',
      status: 'ACTIVE',
    });
    await Wallet.create({
      _id: walletId,
      tenantId,
      distributorId,
      walletCode: `WAL-DIST-${crypto.randomBytes(4).toString('hex')}`,
      balance: 0,
      version: 0,
    });

    const ptId = await seedPendingPT({
      agencyId: null,
      walletId,
      distributorId,
      amount: 50_000,
      gatewayTxnId: 'gw-dist-1',
    });

    await paymentService.markSuccess(ptId, { verificationMethod: 'WEBHOOK' });

    // Legacy ledger row in the distributor wallet; no settlement snapshot.
    const ledger = await WalletTransaction.find({ walletId }).lean();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.type).toBe('TOPUP');

    const settlements = await CreditSettlement.countDocuments({ tenantId });
    expect(settlements).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Path 5: duplicate markSuccess under waterfall — clean no-op
// ─────────────────────────────────────────────────────────────────────────────

describe('markSuccess — idempotency under waterfall', () => {
  it('duplicate call on a SUCCESS PT short-circuits; no extra ledger rows', async () => {
    (env as { WATERFALL_LIVE: boolean }).WATERFALL_LIVE = true;

    const { agencyId, walletId } = await makeAgencyWithWallet('CASH', 0);
    const ptId = await seedPendingPT({
      agencyId,
      walletId,
      amount: 100_000,
      gatewayTxnId: 'gw-idemp-1',
    });

    await paymentService.markSuccess(ptId, { verificationMethod: 'WEBHOOK' });
    // Second call — already SUCCESS, early-return without doing anything.
    await paymentService.markSuccess(ptId, { verificationMethod: 'RETURN_URL' });

    const ledger = await WalletTransaction.find({ agencyId }).lean();
    expect(ledger).toHaveLength(1);

    const settlements = await CreditSettlement.find({ agencyId }).lean();
    expect(settlements).toHaveLength(1);
  });
});
