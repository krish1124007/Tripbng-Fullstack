// Phase-C tests for the refund state-machine + wallet reversal.
//
// Covers:
//   - markRefundInitiated: SUCCESS → REFUND_INITIATED, no wallet impact
//   - markRefunded: REFUND_INITIATED → REFUNDED, posts a TOPUP_REVERSAL row
//   - markRefunded permits balance to go negative when the topup is already
//     spent (allowNegative bypass)
//   - markRefunded is idempotent on duplicate webhooks
//   - markRefundFailed: REFUND_INITIATED → FAILED, no wallet impact
//   - SUCCESS → REFUNDED direct path (some gateways collapse the two events)
//   - Invalid transitions throw

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Wallet } from '../src/models/Wallet.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { Counter } from '../src/models/Counter.js';
import {
  PaymentTransaction,
  type PaymentStatus,
} from '../src/models/PaymentTransaction.js';
import { paymentService } from '../src/services/payment/payment.service.js';

let tenantId: Types.ObjectId;
const initiatedByUserId = new Types.ObjectId();

async function makeAgencyWithWallet(
  walletBalance: number,
): Promise<{ agencyId: Types.ObjectId; walletId: Types.ObjectId }> {
  const agencyId = new Types.ObjectId();
  const walletId = new Types.ObjectId();
  await Agency.create({
    _id: agencyId,
    tenantId,
    agencyCode: `RFD-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Refund Test',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    walletBalance,
    module: 'CASH',
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  await Wallet.create({
    _id: walletId,
    tenantId,
    agencyId,
    walletCode: `WAL-RFD-${crypto.randomBytes(4).toString('hex')}`,
    balance: walletBalance,
    creditUsed: 0,
    version: 0,
  });
  return { agencyId, walletId };
}

async function seedPT(opts: {
  agencyId: Types.ObjectId;
  walletId: Types.ObjectId;
  amount: number;
  status: PaymentStatus;
  walletTransactionId?: Types.ObjectId;
}): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await PaymentTransaction.collection.insertOne({
    _id: id,
    tenantId,
    txnCode: `PT${crypto.randomBytes(6).toString('hex')}`,
    walletId: opts.walletId,
    initiatedByUserId,
    agencyId: opts.agencyId,
    purpose: 'WALLET_TOPUP',
    amount: opts.amount,
    currency: 'INR',
    providerCode: 'PHONEPE',
    status: opts.status,
    walletTransactionId: opts.walletTransactionId ?? null,
    gatewayTxnId: `gw-${crypto.randomBytes(4).toString('hex')}`,
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
    code: `rfd-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Refund Test Tenant',
    domain: 'rfd.test',
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
  // Refund tests run against the legacy path — the waterfall reversal is
  // explicitly out of scope per the markRefunded comment.
  (env as { WATERFALL_LIVE: boolean }).WATERFALL_LIVE = false;
});

describe('markRefundInitiated', () => {
  it('SUCCESS → REFUND_INITIATED, no wallet impact', async () => {
    const { agencyId, walletId } = await makeAgencyWithWallet(100_000);
    const ptId = await seedPT({
      agencyId,
      walletId,
      amount: 50_000,
      status: 'SUCCESS',
    });

    await paymentService.markRefundInitiated(ptId, {
      gatewayRefundId: 'gw-refund-1',
      reason: 'customer requested',
    });

    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(pt!.status).toBe('REFUND_INITIATED');
    expect(pt!.gatewayPaymentId).toBe('gw-refund-1');
    const wallet = await Wallet.findById(walletId).lean();
    expect(wallet!.balance).toBe(100_000); // unchanged
    const ledger = await WalletTransaction.find({ agencyId }).lean();
    expect(ledger).toHaveLength(0);
  });

  it('is idempotent on duplicate accepted webhooks', async () => {
    const { agencyId, walletId } = await makeAgencyWithWallet(100_000);
    const ptId = await seedPT({
      agencyId,
      walletId,
      amount: 50_000,
      status: 'SUCCESS',
    });
    await paymentService.markRefundInitiated(ptId, { gatewayRefundId: 'r1' });
    const second = await paymentService.markRefundInitiated(ptId, {
      gatewayRefundId: 'r1',
    });
    expect(second.status).toBe('REFUND_INITIATED');
    expect(second.statusHistory).toHaveLength(1);
  });

  it('throws on invalid transition (e.g. from PENDING)', async () => {
    const { agencyId, walletId } = await makeAgencyWithWallet(0);
    const ptId = await seedPT({ agencyId, walletId, amount: 10_000, status: 'PENDING' });
    await expect(
      paymentService.markRefundInitiated(ptId, { gatewayRefundId: 'r1' }),
    ).rejects.toThrow();
  });
});

describe('markRefunded', () => {
  it('REFUND_INITIATED → REFUNDED, posts a TOPUP_REVERSAL row', async () => {
    const { agencyId, walletId } = await makeAgencyWithWallet(100_000);
    const ptId = await seedPT({
      agencyId,
      walletId,
      amount: 50_000,
      status: 'REFUND_INITIATED',
    });

    await paymentService.markRefunded(ptId, { gatewayRefundId: 'gw-refund-1' });

    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(pt!.status).toBe('REFUNDED');
    expect(pt!.refundedAt).toBeTruthy();
    const wallet = await Wallet.findById(walletId).lean();
    expect(wallet!.balance).toBe(50_000); // 100k - 50k refund debit
    const ledger = await WalletTransaction.find({ agencyId }).lean();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.type).toBe('TOPUP_REVERSAL');
    expect(ledger[0]!.direction).toBe('DEBIT');
    expect(ledger[0]!.amount).toBe(50_000);
  });

  it('allows the wallet to go negative when the topup has been spent', async () => {
    // Topup landed but the agency has already drained the wallet down to ₹0.
    const { agencyId, walletId } = await makeAgencyWithWallet(0);
    const ptId = await seedPT({
      agencyId,
      walletId,
      amount: 50_000,
      status: 'REFUND_INITIATED',
    });

    await paymentService.markRefunded(ptId, { gatewayRefundId: 'gw-refund-2' });

    const wallet = await Wallet.findById(walletId).lean();
    expect(wallet!.balance).toBe(-50_000); // owed back to platform
    const ledger = await WalletTransaction.find({ agencyId }).lean();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.type).toBe('TOPUP_REVERSAL');
  });

  it('is idempotent on duplicate refund-completed webhooks', async () => {
    const { agencyId, walletId } = await makeAgencyWithWallet(100_000);
    const ptId = await seedPT({
      agencyId,
      walletId,
      amount: 50_000,
      status: 'REFUND_INITIATED',
    });
    await paymentService.markRefunded(ptId, { gatewayRefundId: 'gw-r' });
    await paymentService.markRefunded(ptId, { gatewayRefundId: 'gw-r' });

    // Same PT, same idempotency key → only one ledger row.
    const ledger = await WalletTransaction.find({ agencyId }).lean();
    expect(ledger).toHaveLength(1);
    const wallet = await Wallet.findById(walletId).lean();
    expect(wallet!.balance).toBe(50_000);
  });

  it('handles the SUCCESS → REFUNDED direct path (some gateways collapse events)', async () => {
    // PhonePe in test mode sometimes pushes only a single `pg.refund.completed`
    // event without first sending `pg.refund.accepted`. The PT is still in
    // SUCCESS state. The state machine allows SUCCESS → REFUND_INITIATED →
    // REFUNDED but not SUCCESS → REFUNDED directly. The webhook worker handles
    // this by checking which transition is valid. We document the current
    // behaviour: a direct call to markRefunded from SUCCESS throws.
    const { agencyId, walletId } = await makeAgencyWithWallet(100_000);
    const ptId = await seedPT({
      agencyId,
      walletId,
      amount: 50_000,
      status: 'SUCCESS',
    });
    await expect(
      paymentService.markRefunded(ptId, { gatewayRefundId: 'r' }),
    ).rejects.toThrow();
    // Caller must transition through REFUND_INITIATED first.
    await paymentService.markRefundInitiated(ptId, { gatewayRefundId: 'r' });
    await paymentService.markRefunded(ptId, { gatewayRefundId: 'r' });
    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(pt!.status).toBe('REFUNDED');
  });
});

describe('markRefundFailed', () => {
  it('REFUND_INITIATED → FAILED, no wallet impact', async () => {
    const { agencyId, walletId } = await makeAgencyWithWallet(100_000);
    const ptId = await seedPT({
      agencyId,
      walletId,
      amount: 50_000,
      status: 'REFUND_INITIATED',
    });

    await paymentService.markRefundFailed(ptId, {
      failureCode: 'INSUFFICIENT_BANK_BALANCE',
      failureReason: 'merchant bank failed to settle',
    });

    const pt = await PaymentTransaction.findById(ptId).lean();
    expect(pt!.status).toBe('FAILED');
    expect(pt!.failureCode).toBe('INSUFFICIENT_BANK_BALANCE');
    const wallet = await Wallet.findById(walletId).lean();
    expect(wallet!.balance).toBe(100_000); // unchanged
    const ledger = await WalletTransaction.find({ agencyId }).lean();
    expect(ledger).toHaveLength(0);
  });

  it('is a no-op when called on a non-REFUND_INITIATED PT', async () => {
    const { agencyId, walletId } = await makeAgencyWithWallet(100_000);
    const ptId = await seedPT({
      agencyId,
      walletId,
      amount: 50_000,
      status: 'SUCCESS',
    });
    const result = await paymentService.markRefundFailed(ptId, {
      failureCode: 'X',
      failureReason: 'irrelevant',
    });
    expect(result.status).toBe('SUCCESS'); // unchanged
  });
});
