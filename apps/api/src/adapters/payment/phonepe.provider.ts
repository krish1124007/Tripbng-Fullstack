// PhonePe Standard Checkout V2 — modern REST + OAuth.
//
// Spec §6. Webhook signature scheme is `Authorization: SHA256(user:pass)` —
// configured in the PhonePe dashboard, NOT derivable from the merchant secret.
// V1 X-VERIFY is still supported but we build for V2.
//
// Token caching: per-process for now. When we run multiple API instances,
// move the cache to Redis so we don't waste auth round-trips. The token TTL
// is ~50 min on production; we refresh at 60s remaining.

import { logger } from '../../config/logger.js';
import { phonepeWebhookAuth, safeEqual } from './crypto.js';
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

export interface PhonePeCredentials {
  merchantId: string;
  clientId: string;
  clientSecret: string;
  clientVersion: string;
  /** Webhook auth — basic-auth-style user:password configured in PhonePe dashboard. */
  webhookUsername: string;
  webhookPassword: string;
}

export interface PhonePeConfig {
  credentials: PhonePeCredentials;
  baseUrl: string; // UAT: https://api-preprod.phonepe.com/apis/pg-sandbox  |  PROD: https://api.phonepe.com/apis/pg
  returnUrl: string;
  timeoutMs: number;
}

interface CachedToken {
  token: string;
  expiresAt: number; // ms epoch
}

export class PhonePeProvider implements PaymentProvider {
  readonly code = 'PHONEPE' as const;
  readonly name = 'PhonePe';
  readonly capabilities: readonly PaymentCapability[] = [
    'WALLET_TOPUP',
    'BOOKING_PAYMENT',
    'REFUND',
    'UPI',
    'CARD',
    'NETBANKING',
    'WEBHOOK',
  ];

  private tokenCache: CachedToken | null = null;

  constructor(private readonly cfg: PhonePeConfig) {}

  async initiate(req: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
    const merchantOrderId = req.paymentTransactionCode;
    const token = await this.getAccessToken();

    const payload = {
      merchantOrderId,
      amount: req.amountPaise,
      expireAfter: 1200, // 20 min
      metaInfo: {
        udf1: req.walletId.toString(),
        udf2: req.agencyId?.toString() ?? '',
        udf3: req.purpose,
      },
      paymentFlow: {
        type: 'PG_CHECKOUT',
        message: `Wallet top-up${req.agencyName ? ` for ${req.agencyName}` : ''}`,
        merchantUrls: {
          redirectUrl: `${this.cfg.returnUrl}?ref=${merchantOrderId}`,
        },
      },
    };

    const res = await this.fetch('/checkout/v2/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `O-Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await safeText(res);
      logger.warn(
        { provider: 'PHONEPE', status: res.status, body: text.slice(0, 500) },
        'phonepe initiate failed',
      );
      throw new PaymentError(
        res.status >= 500 ? 'GATEWAY_FAILURE' : 'BAD_REQUEST',
        `PhonePe initiate failed (${res.status})`,
        this.code,
        String(res.status),
      );
    }

    const body = (await res.json()) as {
      orderId?: string;
      redirectUrl?: string;
      expireAt?: number;
    };
    if (!body.redirectUrl) {
      throw new PaymentError('GATEWAY_FAILURE', 'PhonePe response missing redirectUrl', this.code);
    }

    return {
      method: 'REDIRECT',
      redirectUrl: body.redirectUrl,
      sessionId: body.orderId ?? merchantOrderId,
      expiresAt: body.expireAt ? new Date(body.expireAt) : new Date(Date.now() + 20 * 60 * 1000),
    };
  }

  async verify(req: VerifyPaymentRequest): Promise<VerifyPaymentResponse> {
    // Return URL gives us the merchantOrderId. Trust the webhook for state;
    // here we just call fetchStatus as a fallback path.
    const status = await this.fetchStatus(req.paymentTransactionCode);
    return {
      status: status.status === 'SUCCESS' ? 'SUCCESS' : status.status === 'FAILED' ? 'FAILED' : 'PENDING',
      gatewayTxnId: status.gatewayTxnId,
      failureCode: status.failureCode,
      failureReason: status.failureReason,
      parsed: status.parsed,
    };
  }

  async fetchStatus(merchantOrderId: string): Promise<FetchStatusResponse> {
    const token = await this.getAccessToken();
    const res = await this.fetch(`/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status`, {
      method: 'GET',
      headers: { Authorization: `O-Bearer ${token}` },
    });

    if (!res.ok) {
      logger.warn(
        { provider: 'PHONEPE', merchantOrderId, status: res.status },
        'phonepe status fetch non-2xx',
      );
      return { status: 'UNKNOWN', terminal: false, parsed: {} };
    }

    const body = (await res.json()) as {
      state?: string;
      transactionId?: string;
      errorContext?: { code?: string; description?: string };
    };
    const ours = mapPhonePeState(body.state);
    return {
      status: ours,
      terminal: ours === 'SUCCESS' || ours === 'FAILED',
      gatewayTxnId: body.transactionId,
      failureCode: body.errorContext?.code,
      failureReason: body.errorContext?.description,
      parsed: body as Record<string, unknown>,
    };
  }

  async refund(req: RefundRequest): Promise<RefundResponse> {
    // PhonePe V2 refund — POST /payments/v2/refund.
    // Spec:
    //   merchantRefundId           — our unique refund-side reference
    //   originalMerchantOrderId    — the merchantOrderId from /pay
    //   amount                     — paise, must be <= original
    // Response carries `refundId` (gateway ref) + `state` (PENDING / COMPLETED / FAILED).
    // PhonePe pushes a separate webhook later (pg.refund.completed / .failed) — we
    // map that in the webhook worker. Synchronous response is "accepted" not "settled".
    const token = await this.getAccessToken();
    const payload = {
      merchantRefundId: req.refundCode,
      originalMerchantOrderId: req.paymentTransactionCode,
      amount: req.amountPaise,
    };

    const res = await this.fetch('/payments/v2/refund', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `O-Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await safeText(res);
      logger.warn(
        {
          provider: 'PHONEPE',
          merchantRefundId: req.refundCode,
          status: res.status,
          body: text.slice(0, 500),
        },
        'phonepe refund failed',
      );
      // Hard failures are mapped to FAILED so the caller can roll back wallet
      // state if it had optimistically transitioned. 4xx vs 5xx is preserved
      // in `failureReason` for diagnostics.
      return {
        status: 'FAILED',
        failureReason: `PhonePe refund failed (${res.status}): ${text.slice(0, 200)}`,
      };
    }

    const body = (await res.json()) as {
      refundId?: string;
      state?: string;
      amount?: number;
      message?: string;
    };
    const state = (body.state ?? '').toUpperCase();
    if (state === 'COMPLETED') {
      return { status: 'COMPLETED', gatewayRefundId: body.refundId };
    }
    if (state === 'FAILED') {
      return {
        status: 'FAILED',
        gatewayRefundId: body.refundId,
        failureReason: body.message ?? 'gateway reported refund failure',
      };
    }
    // PhonePe returns PENDING (or no `state` at all, sometimes) — webhook will
    // promote to COMPLETED later.
    return { status: 'INITIATED', gatewayRefundId: body.refundId };
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      const start = Date.now();
      await this.getAccessToken(); // OAuth probes liveness without spending a slot
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'unknown' };
    }
  }

  verifyWebhookSignature(req: RawWebhookRequest): WebhookPayload {
    const auth = (req.headers.authorization ?? req.headers.Authorization) as string | undefined;
    const expected = phonepeWebhookAuth(
      this.cfg.credentials.webhookUsername,
      this.cfg.credentials.webhookPassword,
    );
    const valid = !!auth && safeEqual(auth, expected);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(req.rawBody) as Record<string, unknown>;
    } catch {
      parsed = { raw: req.rawBody.slice(0, 500) };
    }
    const event = (parsed['event'] as string | undefined) ?? 'UNKNOWN';
    // For payment events PhonePe carries `merchantOrderId`; for refund events
    // the same field name refers to the REFUND order id and the original
    // order is at `originalMerchantOrderId`. The worker needs to find the
    // original PT to debit the wallet — so we prefer originalMerchantOrderId
    // when present.
    const payload = parsed['payload'] as
      | {
          merchantOrderId?: string;
          originalMerchantOrderId?: string;
          merchantRefundId?: string;
        }
      | undefined;
    const gatewayTxnId = payload?.originalMerchantOrderId ?? payload?.merchantOrderId;
    return {
      signatureValid: valid,
      eventType: event,
      gatewayTxnId,
      parsed,
    };
  }

  // ────────── internals ──────────

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt - Date.now() > 60_000) {
      return this.tokenCache.token;
    }
    const res = await this.fetch('/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.credentials.clientId,
        client_version: this.cfg.credentials.clientVersion,
        client_secret: this.cfg.credentials.clientSecret,
        grant_type: 'client_credentials',
      }).toString(),
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new PaymentError(
        'GATEWAY_FAILURE',
        `PhonePe OAuth failed (${res.status}): ${text.slice(0, 200)}`,
        this.code,
      );
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      token: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return body.access_token;
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

function mapPhonePeState(state: string | undefined): FetchStatusResponse['status'] {
  switch ((state ?? '').toUpperCase()) {
    case 'COMPLETED':
      return 'SUCCESS';
    case 'FAILED':
    case 'CANCELLED':
      return 'FAILED';
    case 'EXPIRED':
      return 'FAILED';
    case 'PENDING':
      return 'PENDING';
    default:
      return 'UNKNOWN';
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
