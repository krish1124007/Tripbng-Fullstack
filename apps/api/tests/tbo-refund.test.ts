// Unit tests for the shared hotel-booking refund helper.
//
// We test the guard logic + outcome reporting without spinning up Mongo —
// vi.mock replaces the wallet/ledger postCredit primitive so the test runs
// in microseconds. The downstream Mongo write (postCredit's own ledger
// row) is covered by the wallet integration test in tests/wallet.test.ts.

import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postCreditMock = vi.fn();

vi.mock('../src/services/wallet/ledger.js', () => ({
  postCredit: (...args: unknown[]) => postCreditMock(...args),
  postDebit: vi.fn(),
}));

// Import AFTER vi.mock so the helper picks up the mocked postCredit.
const { refundHotelBookingDebit } = await import('../src/services/tbo/refund.js');

interface FakeDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  agencyId: Types.ObjectId | null;
  walletDebitTxnId: Types.ObjectId | null;
  walletRefundTxnId: Types.ObjectId | null;
}

const newFakeDoc = (overrides: Partial<FakeDoc> = {}): FakeDoc => ({
  _id: new Types.ObjectId(),
  tenantId: new Types.ObjectId(),
  agencyId: new Types.ObjectId(),
  walletDebitTxnId: new Types.ObjectId(),
  walletRefundTxnId: null,
  ...overrides,
});

beforeEach(() => {
  postCreditMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('refundHotelBookingDebit — guard logic', () => {
  it('skips when no debit was posted (walletDebitTxnId is null)', async () => {
    const doc = newFakeDoc({ walletDebitTxnId: null });
    const result = await refundHotelBookingDebit({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc: doc as any,
      amountPaise: 100_00,
      description: 'test',
      performedByUserId: new Types.ObjectId().toHexString(),
    });
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('no debit posted');
    expect(postCreditMock).not.toHaveBeenCalled();
  });

  it('skips when refund was already issued (idempotent)', async () => {
    const doc = newFakeDoc({ walletRefundTxnId: new Types.ObjectId() });
    const result = await refundHotelBookingDebit({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc: doc as any,
      amountPaise: 100_00,
      description: 'test',
      performedByUserId: new Types.ObjectId().toHexString(),
    });
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('already refunded');
    expect(postCreditMock).not.toHaveBeenCalled();
  });

  it('skips when agencyId is missing', async () => {
    const doc = newFakeDoc({ agencyId: null });
    const result = await refundHotelBookingDebit({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc: doc as any,
      amountPaise: 100_00,
      description: 'test',
      performedByUserId: new Types.ObjectId().toHexString(),
    });
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('no agencyId on booking');
  });

  it('skips when amountPaise is zero or negative', async () => {
    const doc = newFakeDoc();
    const result = await refundHotelBookingDebit({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc: doc as any,
      amountPaise: 0,
      description: 'test',
      performedByUserId: new Types.ObjectId().toHexString(),
    });
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toBe('non-positive refund amount');
  });
});

describe('refundHotelBookingDebit — happy path', () => {
  it('posts a credit + sets walletRefundTxnId on the doc', async () => {
    const creditTxnId = new Types.ObjectId();
    postCreditMock.mockResolvedValueOnce({ _id: creditTxnId });

    const doc = newFakeDoc();
    const result = await refundHotelBookingDebit({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc: doc as any,
      amountPaise: 12_345,
      description: 'TBO supplier rejected',
      performedByUserId: new Types.ObjectId().toHexString(),
    });

    expect(result.outcome).toBe('credited');
    expect(doc.walletRefundTxnId).toEqual(creditTxnId);
    expect(postCreditMock).toHaveBeenCalledTimes(1);
    const callArgs = postCreditMock.mock.calls[0]![0];
    expect(callArgs.type).toBe('REFUND_CREDIT');
    expect(callArgs.amountPaise).toBe(12_345);
    expect(callArgs.relatedTxnId).toBe(String(doc.walletDebitTxnId));
    expect(callArgs.metadata).toEqual({ hotelBookingId: String(doc._id) });
  });

  it('passes the agencyId as walletOwnerId', async () => {
    postCreditMock.mockResolvedValueOnce({ _id: new Types.ObjectId() });
    const doc = newFakeDoc();
    await refundHotelBookingDebit({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc: doc as any,
      amountPaise: 100,
      description: 'test',
      performedByUserId: new Types.ObjectId().toHexString(),
    });
    const callArgs = postCreditMock.mock.calls[0]![0];
    expect(callArgs.walletKind).toBe('AGENCY');
    expect(callArgs.walletOwnerId).toBe(String(doc.agencyId));
  });
});

describe('refundHotelBookingDebit — failure path', () => {
  it('returns failed + leaves walletRefundTxnId null when postCredit throws', async () => {
    postCreditMock.mockRejectedValueOnce(new Error('mongo write conflict'));

    const doc = newFakeDoc();
    const result = await refundHotelBookingDebit({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc: doc as any,
      amountPaise: 100_00,
      description: 'test',
      performedByUserId: new Types.ObjectId().toHexString(),
    });

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('mongo write conflict');
    // Critically: walletRefundTxnId must NOT be set, so a retry won't be
    // blocked by the "already refunded" guard.
    expect(doc.walletRefundTxnId).toBeNull();
  });

  it('reports a generic reason for non-Error thrown values', async () => {
    postCreditMock.mockRejectedValueOnce('string-throw');
    const doc = newFakeDoc();
    const result = await refundHotelBookingDebit({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      doc: doc as any,
      amountPaise: 100_00,
      description: 'test',
      performedByUserId: new Types.ObjectId().toHexString(),
    });
    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('unknown');
  });
});
