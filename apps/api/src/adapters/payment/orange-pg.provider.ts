// Orange PG (ICICI "pgpay") provider — Standard mode (payType=0), server-to-server.
//
// Flow (Interface Spec §Ch.3 + §Ch.7 + §Payment Response):
//   1. initiate(): POST JSON to the initiateSale URL with the V2 hash in the
//      `securehash` header. Response carries responseCode=R1000, a `redirectURI`
//      and a `tranCtx`. (showOTPCapturePage='N' for Standard.)
//   2. We bounce the browser to `redirectURI`, forwarding `tranCtx` as-is, so the
//      customer completes 3DSecure / chooses an instrument on ICICI's domain.
//   3. ICICI POSTs the payment response (responseCode, txnID, secureHash, …) back
//      to our returnURL → verify() recomputes the V1 hash and checks responseCode.
//   4. Refund + status run through the /command API (V1 hash, form-urlencoded).
//
// Endpoints (from §URLs):
//   UAT  sale  https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale
//        cmd   https://pgpayuat.icicibank.com/tsp/pg/api/command
//   PROD sale  https://pgpay.icicibank.com/pg/api/v2/initiateSale
//        cmd   https://pgpay.icicibank.com/pg/api/command
//
// NOTE: exact redirect-request params and the refund `originalTxnNo` mapping are
// merchant-pack specific — validate in UAT with live credentials before go-live.

import { logger } from '../../config/logger.js';
import { orangeHashV1, orangeHashV2, orangeVerifyV1 } from './orange-pg.crypto.js';
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

export interface OrangePgCredentials {
  merchantId: string;
  secretKey: string;
}

export interface OrangePgConfig {
  credentials: OrangePgCredentials;
  /** initiateSale URL (UAT or PROD). */
  baseUrl: string;
  /** /command URL — derived from baseUrl when omitted. */
  commandUrl?: string;
  /** Must EXACTLY match the returnURL registered with ICICI. */
  returnUrl: string;
  timeoutMs: number;
}

function deriveCommandUrl(saleUrl: string): string {
  // .../api/v2/initiateSale → .../api/command  (also handles the non-v2 path)
  return saleUrl.replace(/\/v2\/initiateSale\/?$/, '/command').replace(/\/initiateSale\/?$/, '/command');
}

/** ICICI txn ref: alphanumeric only, max 20 chars. */
function toMerchantTxnNo(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
}

export class OrangePgProvider implements PaymentProvider {
  readonly code = 'ORANGE_PG' as const;
  readonly name = 'Orange PG (ICICI)';
  readonly capabilities: readonly PaymentCapability[] = [
    'WALLET_TOPUP',
    'BOOKING_PAYMENT',
    'CARD',
    'NETBANKING',
    'UPI',
    'REFUND',
  ];

  private readonly commandUrl: string;

  constructor(private readonly cfg: OrangePgConfig) {
    this.commandUrl = cfg.commandUrl ?? deriveCommandUrl(cfg.baseUrl);
  }

  async initiate(req: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
    const { merchantId, secretKey } = this.cfg.credentials;
    const merchantTxnNo = toMerchantTxnNo(req.paymentTransactionCode);

    // initiateSale JSON body (Standard / payType=0).
    const body: Record<string, string> = {
      merchantId,
      merchantTxnNo,
      amount: (req.amountPaise / 100).toFixed(2),
      currencyCode: '356',
      payType: '0',
      transactionType: 'SALE',
      customerEmailID: req.optionalFields?.email || 'noreply@tripbng.com',
      returnURL: this.cfg.returnUrl,
    };
    if (req.optionalFields?.mobile) body.customerMobileNo = req.optionalFields.mobile;

    const minified = JSON.stringify(body);
    const securehash = orangeHashV2(minified, secretKey);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    let json: Record<string, unknown>;
    try {
      const res = await fetch(this.cfg.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', securehash },
        body: minified,
        signal: ctrl.signal,
      });
      const text = await res.text();
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown';
      throw new PaymentError(
        (err as Error)?.name === 'AbortError' ? 'NETWORK_ERROR' : 'GATEWAY_FAILURE',
        `Orange PG initiateSale failed: ${reason}`,
        this.code,
      );
    } finally {
      clearTimeout(timer);
    }

    const responseCode = String(json['responseCode'] ?? '');
    const redirectURI = json['redirectURI'] as string | undefined;
    const tranCtx = json['tranCtx'] as string | undefined;
    // R1000 = request accepted; Standard mode must yield a redirectURI.
    if (responseCode !== 'R1000' || !redirectURI || !tranCtx) {
      throw new PaymentError(
        'GATEWAY_FAILURE',
        `Orange PG initiateSale rejected (responseCode=${responseCode || 'none'})`,
        this.code,
        responseCode,
      );
    }

    logger.info(
      { provider: 'ORANGE_PG', action: 'initiate', merchantTxnNo, amountPaise: req.amountPaise },
      'orange-pg initiate ok',
    );

    // Bounce the browser to redirectURI, forwarding tranCtx as-is. The frontend
    // auto-submits this hidden form (POST) so 3DSecure can take over.
    const formFields: Record<string, string> = { merchantId, merchantTxnNo, tranCtx };
    formFields.secureHash = orangeHashV1(formFields, secretKey);

    return {
      method: 'FORM_POST',
      redirectUrl: redirectURI,
      formFields,
      sessionId: merchantTxnNo,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }

  async verify(req: VerifyPaymentRequest): Promise<VerifyPaymentResponse> {
    const { secretKey } = this.cfg.credentials;
    const payload = req.rawPayload as Record<string, string | number | null | undefined>;

    // Hash integrity FIRST — never trust responseCode without a valid signature.
    const hashOk = orangeVerifyV1(payload, secretKey);
    if (!hashOk) {
      logger.warn({ merchantTxnNo: payload['merchantTxnNo'] }, 'orange-pg return hash mismatch');
      return {
        status: 'FAILED',
        failureCode: 'HASH_MISMATCH',
        failureReason: 'secureHash verification failed',
        parsed: payload as Record<string, unknown>,
      };
    }

    const responseCode = String(payload['responseCode'] ?? '');
    const success = responseCode === '000';
    const status: VerifyPaymentResponse['status'] = success
      ? 'SUCCESS'
      : responseCode
        ? 'FAILED'
        : 'PENDING';

    return {
      status,
      gatewayTxnId: (payload['txnID'] as string) || undefined,
      paymentInstrument: mapInstrument(payload['paymentMode'] as string | undefined),
      paymentInstrumentDetails: {
        authId: payload['txnAuthID'],
        paymentInstId: payload['paymentInstId'],
      },
      failureCode: success ? undefined : responseCode || 'NO_RESPONSE_CODE',
      failureReason: success ? undefined : String(payload['respDescription'] ?? 'Payment failed'),
      parsed: payload as Record<string, unknown>,
    };
  }

  async fetchStatus(gatewayTxnId: string): Promise<FetchStatusResponse> {
    const { merchantId, secretKey } = this.cfg.credentials;
    const params: Record<string, string> = {
      merchantId,
      merchantTxnNo: toMerchantTxnNo(`STATUS${Date.now()}`),
      originalTxnNo: gatewayTxnId,
      transactionType: 'STATUS',
    };
    params.secureHash = orangeHashV1(params, secretKey);

    try {
      const json = await this.command(params);
      const txnStatus = String(json['txnStatus'] ?? '');
      const status: FetchStatusResponse['status'] =
        txnStatus === 'SUC' ? 'SUCCESS' : txnStatus === 'FAL' ? 'FAILED' : txnStatus ? 'PENDING' : 'UNKNOWN';
      return {
        status,
        terminal: status === 'SUCCESS' || status === 'FAILED',
        gatewayTxnId: (json['txnID'] as string) || gatewayTxnId,
        failureCode: status === 'FAILED' ? String(json['txnResponseCode'] ?? '') : undefined,
        failureReason: status === 'FAILED' ? String(json['txnRespDescription'] ?? '') : undefined,
        parsed: json,
      };
    } catch (err) {
      logger.warn({ err, gatewayTxnId }, 'orange-pg fetchStatus failed');
      return { status: 'UNKNOWN', terminal: false, parsed: {} };
    }
  }

  async refund(req: RefundRequest): Promise<RefundResponse> {
    const { merchantId, secretKey } = this.cfg.credentials;
    const params: Record<string, string> = {
      merchantId,
      transactionType: 'REFUND',
      merchantTxnNo: toMerchantTxnNo(req.refundCode),
      // originalTxnNo should be the original sale's gateway txnID. Callers pass
      // the original PT code; pass it through (validate mapping in UAT).
      originalTxnNo: toMerchantTxnNo(req.paymentTransactionCode),
      amount: (req.amountPaise / 100).toFixed(2),
    };
    params.secureHash = orangeHashV1(params, secretKey);
    try {
      const json = await this.command(params);
      const code = String(json['responseCode'] ?? '');
      const ok = code === 'R1000' || code === '000';
      return {
        status: ok ? 'INITIATED' : 'FAILED',
        gatewayRefundId: (json['txnID'] as string) || undefined,
        failureReason: ok ? undefined : String(json['respDescription'] ?? code),
      };
    } catch (err) {
      return { status: 'FAILED', failureReason: err instanceof Error ? err.message : 'refund error' };
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: !!this.cfg.baseUrl && !!this.cfg.credentials.merchantId, message: 'config-only check' };
  }

  verifyWebhookSignature(_req: RawWebhookRequest): WebhookPayload {
    // Orange PG uses return-URL POST + status polling, not async webhooks.
    throw new PaymentError(
      'GATEWAY_FAILURE',
      'Orange PG has no webhook — verify via return URL or fetchStatus',
      this.code,
    );
  }

  /** POST form-urlencoded to the /command endpoint, parse JSON. */
  private async command(params: Record<string, string>): Promise<Record<string, unknown>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(this.commandUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        signal: ctrl.signal,
      });
      const text = await res.text();
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } finally {
      clearTimeout(timer);
    }
  }
}

function mapInstrument(mode: string | undefined): VerifyPaymentResponse['paymentInstrument'] {
  switch ((mode ?? '').toUpperCase()) {
    case 'CARD':
    case 'CC':
    case 'DC':
      return 'CARD';
    case 'NB':
    case 'NETBANKING':
      return 'NETBANKING';
    case 'UPI':
      return 'UPI';
    case 'NEFT':
      return 'NEFT';
    case 'RTGS':
      return 'RTGS';
    case 'IMPS':
      return 'IMPS';
    default:
      return 'UNKNOWN';
  }
}
