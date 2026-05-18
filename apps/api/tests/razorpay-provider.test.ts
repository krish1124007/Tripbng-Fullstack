// RazorpayProvider unit tests.
//
// We avoid hitting the real Razorpay API by stubbing global fetch via
// vi.stubGlobal. Two surfaces are exercised here:
//   1. Pure-crypto paths — verify() HMAC + verifyWebhookSignature().
//      No network. Direct HMAC checks against known fixtures.
//   2. HTTP-shaped paths — initiate() / fetchStatus() / refund(). We
//      stub fetch to return canned Razorpay-shaped JSON.

import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hmacSha256Hex } from '../src/adapters/payment/crypto.js';
import { PaymentError } from '../src/adapters/payment/types.js';
import {
  RazorpayProvider,
  type RazorpayConfig,
} from '../src/adapters/payment/razorpay.provider.js';

const baseConfig: RazorpayConfig = {
  credentials: {
    keyId: 'rzp_test_FAKE_KEY',
    keySecret: 'fake_secret_xxx',
    webhookSecret: 'fake_webhook_secret',
  },
  baseUrl: 'https://api.razorpay.com',
  returnUrl: 'https://app.tripbng.com/payments/razorpay/callback',
  timeoutMs: 5000,
};

function makeProvider(): RazorpayProvider {
  return new RazorpayProvider(baseConfig);
}

const okJsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response;

const errJsonResponse = (body: unknown, status: number): Response =>
  ({
    ok: false,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ────────── verify() ──────────

describe('RazorpayProvider.verify', () => {
  it('throws on missing required fields', async () => {
    const p = makeProvider();
    await expect(
      p.verify({ paymentTransactionCode: 'WT-1', rawPayload: {} }),
    ).rejects.toThrow(PaymentError);
  });

  it('throws INVALID_SIGNATURE when HMAC mismatches', async () => {
    const p = makeProvider();
    await expect(
      p.verify({
        paymentTransactionCode: 'WT-1',
        rawPayload: {
          razorpay_order_id: 'order_xyz',
          razorpay_payment_id: 'pay_abc',
          razorpay_signature: 'wrong-signature',
        },
      }),
    ).rejects.toThrow(/HMAC mismatch/);
  });

  it('returns SUCCESS when HMAC matches and payment is captured', async () => {
    const orderId = 'order_xyz';
    const paymentId = 'pay_abc';
    const sig = hmacSha256Hex(`${orderId}|${paymentId}`, baseConfig.credentials.keySecret);

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({
        id: paymentId,
        order_id: orderId,
        status: 'captured',
        method: 'upi',
        amount: 10_000,
        currency: 'INR',
        acquirer_data: { upi_transaction_id: 'UPI-123' },
      }),
    );

    const p = makeProvider();
    const res = await p.verify({
      paymentTransactionCode: 'WT-1',
      rawPayload: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig },
    });

    expect(res.status).toBe('SUCCESS');
    expect(res.gatewayTxnId).toBe(paymentId);
    expect(res.paymentInstrument).toBe('UPI');
  });

  it('returns FAILED when the captured payment status is `failed`', async () => {
    const orderId = 'order_xyz';
    const paymentId = 'pay_abc';
    const sig = hmacSha256Hex(`${orderId}|${paymentId}`, baseConfig.credentials.keySecret);

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({
        id: paymentId,
        status: 'failed',
        error_code: 'BAD_REQUEST_ERROR',
        error_description: 'card declined',
      }),
    );

    const p = makeProvider();
    const res = await p.verify({
      paymentTransactionCode: 'WT-1',
      rawPayload: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig },
    });
    expect(res.status).toBe('FAILED');
    expect(res.failureCode).toBe('BAD_REQUEST_ERROR');
  });
});

// ────────── verifyWebhookSignature() ──────────

describe('RazorpayProvider.verifyWebhookSignature', () => {
  const goodBody = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_abc', status: 'captured' } } },
  });

  it('throws when X-Razorpay-Signature header is missing', () => {
    const p = makeProvider();
    expect(() =>
      p.verifyWebhookSignature({ headers: {}, rawBody: goodBody }),
    ).toThrow(/missing X-Razorpay-Signature/);
  });

  it('throws on signature mismatch', () => {
    const p = makeProvider();
    expect(() =>
      p.verifyWebhookSignature({
        headers: { 'x-razorpay-signature': 'totally-wrong' },
        rawBody: goodBody,
      }),
    ).toThrow(/HMAC mismatch/);
  });

  it('accepts a valid signature + extracts eventType + entity id', () => {
    const sig = hmacSha256Hex(goodBody, baseConfig.credentials.webhookSecret);
    const p = makeProvider();
    const out = p.verifyWebhookSignature({
      headers: { 'x-razorpay-signature': sig },
      rawBody: goodBody,
    });
    expect(out.signatureValid).toBe(true);
    expect(out.eventType).toBe('payment.captured');
    expect(out.gatewayTxnId).toBe('pay_abc');
  });

  it('extracts refund entity id from refund.created events', () => {
    const body = JSON.stringify({
      event: 'refund.created',
      payload: { refund: { entity: { id: 'rfnd_abc', status: 'pending' } } },
    });
    const sig = hmacSha256Hex(body, baseConfig.credentials.webhookSecret);
    const p = makeProvider();
    const out = p.verifyWebhookSignature({
      headers: { 'x-razorpay-signature': sig },
      rawBody: body,
    });
    expect(out.gatewayTxnId).toBe('rfnd_abc');
  });

  it('rejects non-JSON body even when signature is valid', () => {
    const body = 'not json{';
    const sig = hmacSha256Hex(body, baseConfig.credentials.webhookSecret);
    const p = makeProvider();
    expect(() =>
      p.verifyWebhookSignature({ headers: { 'x-razorpay-signature': sig }, rawBody: body }),
    ).toThrow(/not JSON/);
  });
});

// ────────── initiate() ──────────

describe('RazorpayProvider.initiate', () => {
  it('rejects non-positive amount', async () => {
    const p = makeProvider();
    await expect(
      p.initiate({
        paymentTransactionCode: 'WT-1',
        amountPaise: 0,
        walletId: new Types.ObjectId(),
        initiatedByUserId: new Types.ObjectId(),
        purpose: 'WALLET_TOPUP',
      }),
    ).rejects.toThrow(/positive integer in paise/);
  });

  it('rejects fractional amount', async () => {
    const p = makeProvider();
    await expect(
      p.initiate({
        paymentTransactionCode: 'WT-1',
        amountPaise: 100.5,
        walletId: new Types.ObjectId(),
        initiatedByUserId: new Types.ObjectId(),
        purpose: 'WALLET_TOPUP',
      }),
    ).rejects.toThrow(/positive integer in paise/);
  });

  it('creates an order and returns formFields with the order details', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({
        id: 'order_xyz',
        amount: 10_000,
        currency: 'INR',
        receipt: 'WT-2026-1',
        status: 'created',
      }),
    );
    const walletId = new Types.ObjectId();
    const userId = new Types.ObjectId();

    const p = makeProvider();
    const res = await p.initiate({
      paymentTransactionCode: 'WT-2026-1',
      amountPaise: 10_000,
      walletId,
      agencyName: 'Acme Travels',
      initiatedByUserId: userId,
      purpose: 'WALLET_TOPUP',
    });

    expect(res.method).toBe('REDIRECT');
    expect(res.sessionId).toBe('order_xyz');
    expect(res.formFields).toMatchObject({
      orderId: 'order_xyz',
      keyId: 'rzp_test_FAKE_KEY',
      amount: '10000',
      currency: 'INR',
      txnCode: 'WT-2026-1',
      name: 'Acme Travels',
    });
    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // Returns to a URL with ?txn= so the SPA's checkout page can pick up.
    expect(res.redirectUrl).toContain('txn=WT-2026-1');
  });

  it('passes payment_capture=1 in the order body so payments auto-capture', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({ id: 'order_xyz', amount: 10_000, currency: 'INR', receipt: 'WT-1', status: 'created' }),
    );
    const p = makeProvider();
    await p.initiate({
      paymentTransactionCode: 'WT-1',
      amountPaise: 10_000,
      walletId: new Types.ObjectId(),
      initiatedByUserId: new Types.ObjectId(),
      purpose: 'WALLET_TOPUP',
    });
    const call = fetchMock.mock.calls[0]!;
    const body = JSON.parse(call[1].body as string) as { payment_capture: number };
    expect(body.payment_capture).toBe(1);
  });

  it('surfaces GATEWAY_FAILURE on non-2xx with Razorpay error code', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      errJsonResponse({ error: { code: 'BAD_REQUEST_ERROR', description: 'amount too low' } }, 400),
    );
    const p = makeProvider();
    try {
      await p.initiate({
        paymentTransactionCode: 'WT-1',
        amountPaise: 10_000,
        walletId: new Types.ObjectId(),
        initiatedByUserId: new Types.ObjectId(),
        purpose: 'WALLET_TOPUP',
      });
      expect.fail('expected PaymentError');
    } catch (err) {
      expect(err).toBeInstanceOf(PaymentError);
      expect((err as PaymentError).code).toBe('GATEWAY_FAILURE');
      expect((err as PaymentError).gatewayCode).toBe('BAD_REQUEST_ERROR');
    }
  });

  it('classifies AbortError → NETWORK_ERROR', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abortErr);
    const p = makeProvider();
    try {
      await p.initiate({
        paymentTransactionCode: 'WT-1',
        amountPaise: 10_000,
        walletId: new Types.ObjectId(),
        initiatedByUserId: new Types.ObjectId(),
        purpose: 'WALLET_TOPUP',
      });
      expect.fail('expected PaymentError');
    } catch (err) {
      expect((err as PaymentError).code).toBe('NETWORK_ERROR');
    }
  });
});

// ────────── fetchStatus() ──────────

describe('RazorpayProvider.fetchStatus', () => {
  it('SUCCESS + terminal for captured payments', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(okJsonResponse({ id: 'pay_abc', status: 'captured' }));
    const p = makeProvider();
    const out = await p.fetchStatus('pay_abc');
    expect(out.status).toBe('SUCCESS');
    expect(out.terminal).toBe(true);
  });

  it('FAILED + terminal for failed payments', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({
        id: 'pay_abc',
        status: 'failed',
        error_code: 'BAD_REQUEST_ERROR',
        error_description: 'card declined',
      }),
    );
    const p = makeProvider();
    const out = await p.fetchStatus('pay_abc');
    expect(out.status).toBe('FAILED');
    expect(out.terminal).toBe(true);
    expect(out.failureCode).toBe('BAD_REQUEST_ERROR');
  });

  it('PENDING + non-terminal for created payments', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(okJsonResponse({ id: 'pay_abc', status: 'created' }));
    const p = makeProvider();
    const out = await p.fetchStatus('pay_abc');
    expect(out.status).toBe('PENDING');
    expect(out.terminal).toBe(false);
  });

  it('falls back to order lookup when an order_xxx id is passed', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({ id: 'order_xyz', amount: 10_000, currency: 'INR', status: 'paid' }),
    );
    const p = makeProvider();
    const out = await p.fetchStatus('order_xyz');
    expect(out.status).toBe('SUCCESS');
    expect(out.terminal).toBe(true);
    // Verify the request actually went to /v1/orders, not /v1/payments.
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/v1/orders/order_xyz');
  });
});
