// Phase-14 — payment-recon-sweeper tests.
//
// The sweeper itself is a 5-line wrapper around paymentService.sweepStalePayments
// — these tests target the underlying sweep behavior, which until now had no
// coverage. We stub the provider registry so each PT in the sweep gets a
// deterministic fetchStatus response (keyed by gatewayTxnId).
//
// Cases:
//   1. PT < 30 min old isn't touched (selection window)
//   2. PT > 30 min, fetchStatus terminal SUCCESS → markSuccess
//   3. PT > 30 min, fetchStatus terminal FAILED → markFailed
//   4. PT > 30 min, fetchStatus non-terminal AND PT < 1h → stays PENDING
//   5. PT > 60 min, fetchStatus non-terminal → markTimeout
//   6. fetchStatus throws → continues to next PT, no crash

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the registry BEFORE any service that imports it. Each test reseats
// the response table via `setProviderResponses` below.
const providerResponses = new Map<
  string,
  { status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'UNKNOWN'; terminal: boolean; failureCode?: string }
>();
const providerErrors = new Set<string>();

vi.mock('../src/adapters/payment/registry.js', () => ({
  getProvider: async () => ({
    code: 'ICICI_ORANGE_PG' as const,
    fetchStatus: async (gatewayTxnId: string) => {
      if (providerErrors.has(gatewayTxnId)) {
        throw new Error(`stub provider configured to fail for ${gatewayTxnId}`);
      }
      const r = providerResponses.get(gatewayTxnId);
      if (!r) return { status: 'UNKNOWN', terminal: false, parsed: {} };
      return { ...r, gatewayTxnId, parsed: {} };
    },
  }),
}));

import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Wallet } from '../src/models/Wallet.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { Counter } from '../src/models/Counter.js';
import { PaymentTransaction } from '../src/models/PaymentTransaction.js';
import { paymentService } from '../src/services/payment/payment.service.js';

let tenantId: Types.ObjectId;
const initiatedByUserId = new Types.ObjectId();

interface SeedPTOptions {
  amount?: number;
  gatewayTxnId: string;
  initiatedAt: Date;
  status?: 'PENDING' | 'PROCESSING';
}

async function seedAgencyWallet(): Promise<{ agencyId: Types.ObjectId; walletId: Types.ObjectId }> {
  const agencyId = new Types.ObjectId();
  const walletId = new Types.ObjectId();
  await Agency.create({
    _id: agencyId,
    tenantId,
    agencyCode: `RECON-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Recon Sweep Test',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    module: 'CASH',
    walletBalance: 0,
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  await Wallet.create({
    _id: walletId,
    tenantId,
    agencyId,
    walletCode: `WAL-RECON-${crypto.randomBytes(4).toString('hex')}`,
    balance: 0,
    version: 0,
  });
  return { agencyId, walletId };
}

async function seedPT(
  agencyId: Types.ObjectId,
  walletId: Types.ObjectId,
  opts: SeedPTOptions,
): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await PaymentTransaction.collection.insertOne({
    _id: id,
    tenantId,
    txnCode: `PT${crypto.randomBytes(6).toString('hex')}`,
    walletId,
    initiatedByUserId,
    agencyId,
    purpose: 'WALLET_TOPUP',
    amount: opts.amount ?? 100_000,
    currency: 'INR',
    providerCode: 'ICICI_ORANGE_PG',
    status: opts.status ?? 'PENDING',
    gatewayTxnId: opts.gatewayTxnId,
    statusHistory: [],
    createdAt: opts.initiatedAt,
    updatedAt: opts.initiatedAt,
    initiatedAt: opts.initiatedAt,
  });
  return id;
}

const FOURTY_MIN_AGO = (): Date => new Date(Date.now() - 40 * 60 * 1000);
const SEVENTY_MIN_AGO = (): Date => new Date(Date.now() - 70 * 60 * 1000);
const TEN_MIN_AGO = (): Date => new Date(Date.now() - 10 * 60 * 1000);

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `recon-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Recon Sweep Test Tenant',
    domain: 'recon.test',
  });
  tenantId = tenant._id;
});

afterAll(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await PaymentTransaction.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Counter.deleteMany({});
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await WalletTransaction.deleteMany({ tenantId });
  await Wallet.deleteMany({ tenantId });
  await PaymentTransaction.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  providerResponses.clear();
  providerErrors.clear();
  // Sweep uses the legacy credit path — keep waterfall off so tests don't
  // require a CreditSettlement row + DI worker dependencies.
  (env as { WATERFALL_LIVE: boolean }).WATERFALL_LIVE = false;
});

describe('paymentService.sweepStalePayments', () => {
  it('does not pick up PTs younger than 30 minutes', async () => {
    const { agencyId, walletId } = await seedAgencyWallet();
    const ptId = await seedPT(agencyId, walletId, {
      gatewayTxnId: 'fresh-1',
      initiatedAt: TEN_MIN_AGO(),
    });
    providerResponses.set('fresh-1', { status: 'SUCCESS', terminal: true });

    const result = await paymentService.sweepStalePayments();
    expect(result.resolved).toBe(0);
    expect(result.stillPending).toBe(0);

    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(pt!.status).toBe('PENDING'); // untouched
  });

  it('resolves a stale PT to SUCCESS when the gateway confirms', async () => {
    const { agencyId, walletId } = await seedAgencyWallet();
    const ptId = await seedPT(agencyId, walletId, {
      gatewayTxnId: 'success-1',
      initiatedAt: FOURTY_MIN_AGO(),
    });
    providerResponses.set('success-1', { status: 'SUCCESS', terminal: true });

    const result = await paymentService.sweepStalePayments();
    expect(result.resolved).toBe(1);
    expect(result.stillPending).toBe(0);

    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(pt!.status).toBe('SUCCESS');
    expect(pt!.verificationMethod).toBe('POLL');

    // Side effect — wallet got credited (legacy path, single TOPUP row).
    const ledger = await WalletTransaction.find({ agencyId }).lean();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.type).toBe('TOPUP');
  });

  it('resolves a stale PT to FAILED when the gateway reports failure', async () => {
    const { agencyId, walletId } = await seedAgencyWallet();
    const ptId = await seedPT(agencyId, walletId, {
      gatewayTxnId: 'fail-1',
      initiatedAt: FOURTY_MIN_AGO(),
    });
    providerResponses.set('fail-1', {
      status: 'FAILED',
      terminal: true,
      failureCode: 'INSUFFICIENT_FUNDS',
    });

    const result = await paymentService.sweepStalePayments();
    expect(result.resolved).toBe(1);

    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(pt!.status).toBe('FAILED');
    // No wallet credit on failure.
    const ledgerCount = await WalletTransaction.countDocuments({ agencyId });
    expect(ledgerCount).toBe(0);
  });

  it('keeps a PT pending when the gateway is still processing and it is < 1h old', async () => {
    const { agencyId, walletId } = await seedAgencyWallet();
    const ptId = await seedPT(agencyId, walletId, {
      gatewayTxnId: 'pending-1',
      initiatedAt: FOURTY_MIN_AGO(),
    });
    providerResponses.set('pending-1', { status: 'PENDING', terminal: false });

    const result = await paymentService.sweepStalePayments();
    expect(result.resolved).toBe(0);
    expect(result.stillPending).toBe(1);

    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(pt!.status).toBe('PENDING');
  });

  it('marks a PT as TIMEOUT when the gateway is non-terminal and the PT is > 1h old', async () => {
    const { agencyId, walletId } = await seedAgencyWallet();
    const ptId = await seedPT(agencyId, walletId, {
      gatewayTxnId: 'timeout-1',
      initiatedAt: SEVENTY_MIN_AGO(),
    });
    providerResponses.set('timeout-1', { status: 'PENDING', terminal: false });

    const result = await paymentService.sweepStalePayments();
    expect(result.resolved).toBe(1);

    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(pt!.status).toBe('TIMEOUT');
  });

  it('keeps sweeping other PTs after one of them throws on fetchStatus', async () => {
    const { agencyId, walletId } = await seedAgencyWallet();
    const ptIdBad = await seedPT(agencyId, walletId, {
      gatewayTxnId: 'boom-1',
      initiatedAt: FOURTY_MIN_AGO(),
    });
    const ptIdGood = await seedPT(agencyId, walletId, {
      gatewayTxnId: 'good-after-boom',
      initiatedAt: FOURTY_MIN_AGO(),
    });
    providerErrors.add('boom-1');
    providerResponses.set('good-after-boom', { status: 'SUCCESS', terminal: true });

    const result = await paymentService.sweepStalePayments();
    expect(result.resolved).toBe(1); // good-after-boom resolved
    expect(result.stillPending).toBe(1); // boom-1 stays

    const bad = await PaymentTransaction.findById(ptIdBad).lean();
    expect(bad!.status).toBe('PENDING');
    const good = await PaymentTransaction.findById(ptIdGood).lean();
    expect(good!.status).toBe('SUCCESS');
  });
});
