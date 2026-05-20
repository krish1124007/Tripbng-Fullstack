// ICICI Orange PG / Pay Gateway — PaymentProvider implementation.
//
// What this provider does:
//   - `initiate` → POST /initiateSale, return the bank's redirectURI.
//       Standard/redirect mode only (payType="0"). Direct/Seamless is
//       explicitly forbidden upstream (PCI scope).
//   - `verify`   → parse the return URL body (provided by the route
//       handler in `rawPayload`), verify V1 hash, map responseCode →
//       SUCCESS / FAILED.
//   - `fetchStatus` → POST /command transactionType=STATUS, map
//       txnStatus SUC/FAL/PND → our enum. Source of truth for the
//       reconciliation cron.
//   - `refund`   → POST /command transactionType=REFUND.
//   - `verifyWebhookSignature` → Payment Advice (S2S). Same parser as
//       return URL but accepts JSON OR form. The hash is the entire
//       authentication mechanism — no IP allowlist headers in this PG.
//   - `healthCheck` → ping initiateSale URL with HEAD. Cheap-ish; the
//       /command endpoint doesn't accept HEAD reliably.

import { logger } from '../../../config/logger.js';
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
} from '../types.js';
import { initiateSale, refund as refundCmd, statusCheck } from './api.js';
import {
  describeResponseCode,
  isSuccessCode,
  paiseToWireAmount,
  sanitiseMerchantTxnNo,
  txnDateIST,
  type IciciOrangePgConfig,
} from './types.js';
import { parseAdvice, parseReturnUrl } from './webhook.js';

export class IciciOrangePgProvider implements PaymentProvider {
  readonly code = 'ICICI_ORANGE_PG' as const;
  readonly name = 'ICICI Orange PG';
  readonly capabilities: readonly PaymentCapability[] = [
    'WALLET_TOPUP',
    'BOOKING_PAYMENT',
    'REFUND',
    'UPI',
    'CARD',
    'NETBANKING',
    'WEBHOOK',
  ];

  constructor(private readonly cfg: IciciOrangePgConfig) {}

  async initiate(req: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
    const merchantTxnNo = sanitiseMerchantTxnNo(req.paymentTransactionCode);
    // Customer email is required by the spec. Fall back to a deterministic
    // placeholder when the agency has no email on file — never send a real
    // customer's email if they're not the cardholder.
    const email =
      (req.optionalFields?.customerEmailID && req.optionalFields.customerEmailID.trim()) ||
      `noreply+${req.agencyId?.toString() ?? req.walletId.toString()}@tripbng.com`;

    const res = await initiateSale(this.cfg, {
      merchantTxnNo,
      amount: paiseToWireAmount(req.amountPaise),
      customerEmailID: email,
      customerMobileNo: req.optionalFields?.customerMobileNo,
      customerName: req.agencyName ?? req.optionalFields?.customerName,
      txnDate: txnDateIST(),
      addlParam1: req.optionalFields?.addlParam1,
      addlParam2: req.optionalFields?.addlParam2,
    });

    if (res.responseCode !== 'R1000' || !res.redirectURI || !res.tranCtx) {
      logger.warn(
        { responseCode: res.responseCode, respDescription: res.respDescription, merchantTxnNo },
        'icici-orange-pg initiateSale rejected',
      );
      throw new PaymentError(
        'GATEWAY_FAILURE',
        `ICICI Orange PG initiateSale failed: ${res.responseCode} ${res.respDescription ?? ''}`.trim(),
        this.code,
        res.responseCode,
      );
    }

    // The redirect URI from the bank already contains the host + path; the
    // tranCtx token MUST be appended as a query param.
    const sep = res.redirectURI.includes('?') ? '&' : '?';
    const redirectUrl = `${res.redirectURI}${sep}tranCtx=${encodeURIComponent(res.tranCtx)}`;

    return {
      method: 'REDIRECT',
      redirectUrl,
      sessionId: res.tranCtx,
      // 15-minute session per the spec's session-timeout guidance.
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }

  async verify(req: VerifyPaymentRequest): Promise<VerifyPaymentResponse> {
    // The route handler delivers the raw form fields in `rawPayload`. We
    // also accept a pre-serialised body string under `__rawBody` so the
    // hash math operates on the exact bytes received.
    const rawBody =
      typeof req.rawPayload['__rawBody'] === 'string'
        ? (req.rawPayload['__rawBody'] as string)
        : new URLSearchParams(
            Object.entries(req.rawPayload)
              .filter(([, v]) => typeof v === 'string')
              .map(([k, v]) => [k, v as string] as [string, string]),
          ).toString();

    const parsed = parseReturnUrl(rawBody, this.cfg.credentials.key);
    if (!parsed.signatureValid) {
      throw new PaymentError(
        'INVALID_SIGNATURE',
        'ICICI Orange PG return URL signature mismatch',
        this.code,
      );
    }

    const code = parsed.payload.responseCode;
    const meta = describeResponseCode(code);
    const ours: VerifyPaymentResponse['status'] =
      meta.status === 'SUCCESS'
        ? 'SUCCESS'
        : meta.status === 'INITIATED' || meta.status === 'PENDING'
          ? 'PENDING'
          : 'FAILED';

    return {
      status: ours,
      gatewayTxnId: parsed.payload.txnID,
      paymentInstrument: mapPaymentMode(parsed.payload.paymentMode),
      paymentInstrumentDetails: {
        paymentMode: parsed.payload.paymentMode,
        paymentSubInstType: parsed.payload.paymentSubInstType,
        paymentDateTime: parsed.payload.paymentDateTime,
      },
      failureCode: ours === 'FAILED' ? code : undefined,
      failureReason: ours === 'FAILED' ? parsed.payload.respDescription : undefined,
      parsed: parsed.payload,
    };
  }

  async fetchStatus(merchantTxnNo: string): Promise<FetchStatusResponse> {
    const res = await statusCheck(this.cfg, sanitiseMerchantTxnNo(merchantTxnNo));
    const status = mapTxnStatus(res.txnStatus);
    return {
      status,
      terminal: status === 'SUCCESS' || status === 'FAILED',
      gatewayTxnId: res.txnID,
      failureCode: status === 'FAILED' ? res.responseCode : undefined,
      failureReason: status === 'FAILED' ? res.respDescription : undefined,
      parsed: res as unknown as Record<string, unknown>,
    };
  }

  async refund(req: RefundRequest): Promise<RefundResponse> {
    const res = await refundCmd(this.cfg, {
      refundCode: sanitiseMerchantTxnNo(req.refundCode),
      originalTxnNo: sanitiseMerchantTxnNo(req.paymentTransactionCode),
      amount: paiseToWireAmount(req.amountPaise),
    });

    if (isSuccessCode(res.responseCode)) {
      return {
        status: res.txnStatus === 'SUC' ? 'COMPLETED' : 'INITIATED',
        gatewayRefundId: res.txnID,
      };
    }
    return {
      status: 'FAILED',
      failureReason: res.respDescription ?? `code ${res.responseCode}`,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      // Light probe — HEAD on initiateSale. Some networks block HEAD; if so
      // we fall back to GET (which will 405 but at least proves reachability).
      const res = await fetch(this.cfg.endpoints.initiateSale, {
        method: 'HEAD',
        signal: AbortSignal.timeout(Math.min(this.cfg.timeoutMs, 10_000)),
      }).catch(() =>
        fetch(this.cfg.endpoints.initiateSale, {
          method: 'GET',
          signal: AbortSignal.timeout(Math.min(this.cfg.timeoutMs, 10_000)),
        }),
      );
      return { ok: res.status < 500, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'unknown' };
    }
  }

  verifyWebhookSignature(req: RawWebhookRequest): WebhookPayload {
    const contentType =
      (req.headers['content-type'] as string | undefined) ??
      (req.headers['Content-Type'] as string | undefined);
    const parsed = parseAdvice(req.rawBody, contentType, this.cfg.credentials.key);
    return {
      signatureValid: parsed.signatureValid,
      eventType: parsed.payload.responseCode ?? 'UNKNOWN',
      gatewayTxnId: parsed.payload.txnID ?? parsed.payload.merchantTxnNo,
      parsed: parsed.payload,
    };
  }
}

// ────────── mapping helpers ──────────

function mapPaymentMode(
  mode: string | undefined,
): VerifyPaymentResponse['paymentInstrument'] {
  switch ((mode ?? '').toUpperCase()) {
    case 'CARD':
      return 'CARD';
    case 'NB':
      return 'NETBANKING';
    case 'UPI':
      return 'UPI';
    case 'WALLET':
      return 'WALLET';
    default:
      return 'UNKNOWN';
  }
}

function mapTxnStatus(
  s: string | undefined,
): FetchStatusResponse['status'] {
  switch ((s ?? '').toUpperCase()) {
    case 'SUC':
      return 'SUCCESS';
    case 'FAL':
      return 'FAILED';
    case 'PND':
      return 'PENDING';
    default:
      return 'UNKNOWN';
  }
}
