// Razorpay payment provider — Standard Checkout (Orders API + JS modal).
//
// Razorpay's flow is meaningfully different from ICICI Eazypay or
// PhonePe Standard Checkout:
//
//   1. Server creates a server-side Order via POST /v1/orders.
//   2. Server returns the order_id + key_id to the client.
//   3. Client opens the Razorpay Checkout JS modal with those details.
//   4. User completes payment inside the modal.
//   5. Razorpay POSTs back razorpay_payment_id + razorpay_order_id +
//      razorpay_signature, which we verify via HMAC.
//   6. (Optionally) Razorpay also fires an async webhook with the same
//      info — primary truth source for the reconciler.
//
// Because the SPA opens the checkout modal directly (no redirect), our
// `initiate()` returns method='REDIRECT' to a thin SPA-hosted checkout
// page that loads Razorpay's JS and embeds the modal. The order details
// flow through `formFields` so the FE has everything it needs without
// a second API round-trip.
//
// Signature schemes:
//   - Verify (return URL): HMAC_SHA256(order_id + '|' + payment_id,
//                                      key_secret)
//   - Webhook:              HMAC_SHA256(rawBody, webhook_secret)

import { Buffer } from 'node:buffer';
import { logger } from '../../config/logger.js';
import { hmacSha256Hex, safeEqual } from './crypto.js';
import {
  PaymentError,
  type FetchStatusResponse,
  type HealthStatus,
  type InitiatePaymentRequest,
  type InitiatePaymentResponse,
  type PaymentCapability,
  type PaymentProvider,
  type RawWebhookRequest,
  type RefundRequest,
  type RefundResponse,
  type VerifyPaymentRequest,
  type VerifyPaymentResponse,
  type WebhookPayload,
} from './types.js';

export interface RazorpayCredentials {
  /** Public key — embedded in the checkout JS. Format `rzp_test_*` or `rzp_live_*`. */
  keyId: string;
  /** Private key — used for HMAC verification + Basic Auth on Orders/Payments API. */
  keySecret: string;
  /** Webhook secret — configured separately in the Razorpay dashboard. */
  webhookSecret: string;
}

export interface RazorpayConfig {
  credentials: RazorpayCredentials;
  /** Base URL — only one in practice; sandbox lives at the same host with test keys. */
  baseUrl: string;
  /** Where the SPA's Razorpay checkout page lives — formFields will land
   *  there so the FE can open the modal. Receives `?txn=<paymentTransactionCode>`. */
  returnUrl: string;
  /** Wall-clock timeout for the create-order call. */
  timeoutMs: number;
}

interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: 'created' | 'attempted' | 'paid';
  [key: string]: unknown;
}

interface RazorpayPaymentResponse {
  id: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  order_id?: string;
  method?: string;
  amount?: number;
  currency?: string;
  error_code?: string;
  error_description?: string;
  acquirer_data?: { upi_transaction_id?: string; rrn?: string };
  [key: string]: unknown;
}

interface RazorpayRefundResponse {
  id: string;
  status: 'pending' | 'processed' | 'failed';
  payment_id?: string;
  amount?: number;
  [key: string]: unknown;
}

export class RazorpayProvider implements PaymentProvider {
  readonly code = 'RAZORPAY' as const;
  readonly name = 'Razorpay';
  readonly capabilities: readonly PaymentCapability[] = [
    'WALLET_TOPUP',
    'BOOKING_PAYMENT',
    'REFUND',
    'UPI',
    'CARD',
    'NETBANKING',
    'WEBHOOK',
  ];

  constructor(private readonly cfg: RazorpayConfig) {}

  // ────────── Initiate ──────────

  async initiate(req: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
    if (req.amountPaise <= 0 || !Number.isInteger(req.amountPaise)) {
      throw new PaymentError(
        'BAD_REQUEST',
        'Razorpay amount must be a positive integer in paise',
        this.code,
      );
    }
    // Razorpay's `notes` field is opaque; surface udf-style metadata so
    // ops can reconcile manually if a webhook ever goes missing.
    const notes: Record<string, string> = {
      walletId: req.walletId.toString(),
      purpose: req.purpose,
      txnCode: req.paymentTransactionCode,
    };
    if (req.agencyId) notes.agencyId = req.agencyId.toString();
    if (req.agencyName) notes.agencyName = req.agencyName.slice(0, 60);

    const payload = {
      amount: req.amountPaise,
      currency: 'INR',
      // Razorpay caps `receipt` at 40 chars; our paymentTransactionCode
      // shape is `WT-2026-000123` (~14 chars) so we're well within.
      receipt: req.paymentTransactionCode.slice(0, 40),
      notes,
      // payment_capture=1 → auto-capture authorised payments. Anything
      // else means we'd manually capture later, which the bus topup flow
      // doesn't need.
      payment_capture: 1,
    };

    const order = await this.callRazorpay<RazorpayOrderResponse>('POST', '/v1/orders', payload);

    // Razorpay orders don't have a hard expiry on the order itself;
    // they expire when the underlying offer is closed, ~15 min by
    // default. Mirror PhonePe's 20-min expiry as a UX hint.
    const expiresAt = new Date(Date.now() + 20 * 60_000);

    // formFields carries everything the SPA needs to embed Razorpay
    // Checkout JS without making another API call.
    const formFields: Record<string, string> = {
      orderId: order.id,
      keyId: this.cfg.credentials.keyId,
      amount: String(payload.amount),
      currency: payload.currency,
      receipt: payload.receipt,
      txnCode: req.paymentTransactionCode,
      name: req.agencyName ?? 'TripBNG',
      description: descriptionFor(req.purpose),
    };

    return {
      method: 'REDIRECT',
      redirectUrl: appendQuery(this.cfg.returnUrl, {
        txn: req.paymentTransactionCode,
      }),
      formFields,
      sessionId: order.id,
      expiresAt,
    };
  }

  // ────────── Verify (return URL post-back) ──────────

  async verify(req: VerifyPaymentRequest): Promise<VerifyPaymentResponse> {
    const orderId = pluckString(req.rawPayload, 'razorpay_order_id');
    const paymentId = pluckString(req.rawPayload, 'razorpay_payment_id');
    const signature = pluckString(req.rawPayload, 'razorpay_signature');

    if (!orderId || !paymentId || !signature) {
      throw new PaymentError(
        'BAD_REQUEST',
        'Razorpay verify: missing razorpay_order_id / razorpay_payment_id / razorpay_signature',
        this.code,
      );
    }

    const expected = hmacSha256Hex(`${orderId}|${paymentId}`, this.cfg.credentials.keySecret);
    if (!safeEqual(expected, signature)) {
      throw new PaymentError(
        'INVALID_SIGNATURE',
        'Razorpay verify: HMAC mismatch',
        this.code,
      );
    }

    // Signature ok — pull the canonical payment record so we know
    // status (`captured` vs `failed`) and the instrument used. Skipping
    // this fetch would require trusting a client-supplied "status" which
    // Razorpay never sends as part of the signed payload.
    const payment = await this.fetchPayment(paymentId);
    return paymentToVerifyResponse(payment);
  }

  // ────────── Status fetch (reconciliation sweeper) ──────────

  async fetchStatus(gatewayTxnId: string): Promise<FetchStatusResponse> {
    // gatewayTxnId is the payment id (pay_xxx) in our convention. If
    // the caller mistakenly passes the order_id (order_xxx) we fall
    // back to a payments-by-order lookup — same trick the reconciler
    // uses when only the order is on the PT row.
    if (gatewayTxnId.startsWith('order_')) {
      const order = await this.fetchOrder(gatewayTxnId);
      return orderToFetchStatusResponse(order);
    }
    const payment = await this.fetchPayment(gatewayTxnId);
    return paymentToFetchStatusResponse(payment);
  }

  // ────────── Refund ──────────

  async refund(req: RefundRequest): Promise<RefundResponse> {
    if (req.amountPaise <= 0) {
      throw new PaymentError('BAD_REQUEST', 'Razorpay refund amount must be > 0', this.code);
    }
    const payload = {
      amount: req.amountPaise,
      notes: { reason: req.reason.slice(0, 250), refundCode: req.refundCode.slice(0, 40) },
      // speed=normal (default) keeps the refund within Razorpay's
      // standard 5-7 day window; speed=optimum bills our merchant
      // account for instant refunds — opt-in only.
    };
    const refund = await this.callRazorpay<RazorpayRefundResponse>(
      'POST',
      `/v1/payments/${encodeURIComponent(req.paymentTransactionCode)}/refund`,
      payload,
    );
    return {
      status:
        refund.status === 'processed'
          ? 'COMPLETED'
          : refund.status === 'failed'
            ? 'FAILED'
            : 'INITIATED',
      gatewayRefundId: refund.id,
    };
  }

  // ────────── Webhook ──────────

  verifyWebhookSignature(req: RawWebhookRequest): WebhookPayload {
    const sig = headerOf(req.headers, 'x-razorpay-signature');
    if (!sig) {
      throw new PaymentError('INVALID_SIGNATURE', 'Razorpay webhook: missing X-Razorpay-Signature', this.code);
    }
    const expected = hmacSha256Hex(req.rawBody, this.cfg.credentials.webhookSecret);
    const valid = safeEqual(expected, sig);
    if (!valid) {
      throw new PaymentError('INVALID_SIGNATURE', 'Razorpay webhook: HMAC mismatch', this.code);
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(req.rawBody) as Record<string, unknown>;
    } catch {
      throw new PaymentError('BAD_REQUEST', 'Razorpay webhook: body is not JSON', this.code);
    }
    const eventType = String(parsed.event ?? 'unknown');
    // Best-effort gateway txn id extraction. Razorpay nests the entity
    // under payload.payment.entity / payload.refund.entity / payload.order.entity.
    const gatewayTxnId = extractEntityId(parsed) ?? undefined;

    return { signatureValid: true, eventType, gatewayTxnId, parsed };
  }

  // ────────── Health ──────────

  async healthCheck(): Promise<HealthStatus> {
    // Razorpay has no public ping endpoint. We treat "credentials are
    // present + not obviously malformed" as healthy and let the first
    // initiate() bubble actual errors. The status sweeper picks up any
    // genuine outage by surfacing repeated NETWORK_ERROR.
    const ok = !!this.cfg.credentials.keyId && !!this.cfg.credentials.keySecret;
    return {
      ok,
      message: ok ? undefined : 'Razorpay credentials missing',
    };
  }

  // ────────── Internal HTTP ──────────

  private async fetchPayment(paymentId: string): Promise<RazorpayPaymentResponse> {
    return this.callRazorpay<RazorpayPaymentResponse>(
      'GET',
      `/v1/payments/${encodeURIComponent(paymentId)}`,
    );
  }

  private async fetchOrder(orderId: string): Promise<RazorpayOrderResponse> {
    return this.callRazorpay<RazorpayOrderResponse>(
      'GET',
      `/v1/orders/${encodeURIComponent(orderId)}`,
    );
  }

  private async callRazorpay<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = this.cfg.baseUrl.replace(/\/$/, '') + path;
    const auth = Buffer.from(
      `${this.cfg.credentials.keyId}:${this.cfg.credentials.keySecret}`,
    ).toString('base64');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      const isAbort = (err as Error).name === 'AbortError';
      throw new PaymentError(
        'NETWORK_ERROR',
        isAbort
          ? `Razorpay ${method} ${path} timed out after ${this.cfg.timeoutMs}ms`
          : `Razorpay ${method} ${path}: ${(err as Error).message}`,
        this.code,
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      logger.warn(
        { providerCode: this.code, method, path, status: res.status, body: text.slice(0, 500) },
        'razorpay: non-2xx response',
      );
      throw new PaymentError(
        'GATEWAY_FAILURE',
        `Razorpay ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`,
        this.code,
        // Razorpay's error JSON shape: { error: { code, description, ... } }.
        tryReadErrorCode(text),
      );
    }
    if (text.length === 0) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new PaymentError(
        'GATEWAY_FAILURE',
        `Razorpay ${method} ${path}: non-JSON response`,
        this.code,
      );
    }
  }
}

// ────────── Helpers ──────────

function pluckString(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function headerOf(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

function descriptionFor(purpose: string): string {
  switch (purpose) {
    case 'WALLET_TOPUP':
      return 'TripBNG wallet top-up';
    case 'BOOKING_PAYMENT':
      return 'TripBNG booking payment';
    case 'REFUND':
      return 'TripBNG refund';
    default:
      return 'TripBNG payment';
  }
}

function appendQuery(url: string, qs: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(qs)) u.searchParams.set(k, v);
  return u.toString();
}

function paymentToVerifyResponse(p: RazorpayPaymentResponse): VerifyPaymentResponse {
  const status = p.status === 'captured' || p.status === 'authorized'
    ? 'SUCCESS'
    : p.status === 'failed'
      ? 'FAILED'
      : 'PENDING';
  return {
    status,
    gatewayTxnId: p.id,
    paymentInstrument: mapInstrument(p.method),
    paymentInstrumentDetails: p.acquirer_data,
    failureCode: p.error_code,
    failureReason: p.error_description,
    parsed: p as unknown as Record<string, unknown>,
  };
}

function paymentToFetchStatusResponse(p: RazorpayPaymentResponse): FetchStatusResponse {
  if (p.status === 'captured' || p.status === 'authorized') {
    return {
      status: 'SUCCESS',
      terminal: true,
      gatewayTxnId: p.id,
      parsed: p as unknown as Record<string, unknown>,
    };
  }
  if (p.status === 'failed') {
    return {
      status: 'FAILED',
      terminal: true,
      gatewayTxnId: p.id,
      failureCode: p.error_code,
      failureReason: p.error_description,
      parsed: p as unknown as Record<string, unknown>,
    };
  }
  // 'created' / 'refunded' — not terminal from the topup flow's POV.
  return { status: 'PENDING', terminal: false, gatewayTxnId: p.id, parsed: p as unknown as Record<string, unknown> };
}

function orderToFetchStatusResponse(o: RazorpayOrderResponse): FetchStatusResponse {
  // Order-level status only tells us whether ANY payment succeeded —
  // not which one. For the reconciler this is fine; on `paid` we look
  // up the order's payments collection separately.
  if (o.status === 'paid') {
    return {
      status: 'SUCCESS',
      terminal: true,
      gatewayTxnId: o.id,
      parsed: o as unknown as Record<string, unknown>,
    };
  }
  return {
    status: 'PENDING',
    terminal: false,
    gatewayTxnId: o.id,
    parsed: o as unknown as Record<string, unknown>,
  };
}

function mapInstrument(method?: string): VerifyPaymentResponse['paymentInstrument'] {
  switch (method) {
    case 'upi':
      return 'UPI';
    case 'card':
      return 'CARD';
    case 'netbanking':
      return 'NETBANKING';
    case 'wallet':
      return 'WALLET';
    default:
      return 'UNKNOWN';
  }
}

function tryReadErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string } };
    return parsed.error?.code;
  } catch {
    return undefined;
  }
}

function extractEntityId(payload: Record<string, unknown>): string | null {
  const p = payload.payload as Record<string, unknown> | undefined;
  if (!p) return null;
  for (const key of ['payment', 'refund', 'order']) {
    const block = p[key] as Record<string, unknown> | undefined;
    const entity = block?.entity as Record<string, unknown> | undefined;
    const id = entity?.id;
    if (typeof id === 'string') return id;
  }
  return null;
}
