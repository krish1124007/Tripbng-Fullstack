// ICICI Eazypay provider — form-redirect with AES-128-encrypted query params.
//
// Spec §5. Eazypay quirks (worth re-reading at credential time):
//   - Hex-encoded encryption output (UPPERCASE), NOT base64.
//   - Amount in rupees with 2 decimals as a string.
//   - Each param is encrypted SEPARATELY (not the whole querystring).
//   - Optional fields are pipe-delimited: `"foo|bar|baz"`. Use space-padding
//     for blanks: `" |sample| | "` — empty pipes break their parser.
//   - Return URL must EXACTLY match what's registered with ICICI.
//   - Settlement is T+1 to ICICI Current Account.
//   - No webhooks — verification is via the return URL or the Verify URL.
//   - Refunds are MANUAL via ICICI dashboard (no API).
//
// Response codes are surfaced as `failureCode` so the UI can map them.
// Full table in `responseCodes.ts` (TODO: populate from ICICI spec doc when
// the merchant onboarding pack lands).

import { logger } from '../../config/logger.js';
import { eazypayDecrypt, eazypayEncrypt, eazypayMandatoryFields } from './crypto.js';
import {
  PaymentError,
  type FetchStatusResponse,
  type HealthStatus,
  type InitiatePaymentRequest,
  type InitiatePaymentResponse,
  type PaymentCapability,
  type PaymentProvider,
  type RawWebhookRequest,
  type VerifyPaymentRequest,
  type VerifyPaymentResponse,
  type WebhookPayload,
} from './types.js';

export interface IciciEazypayCredentials {
  merchantId: string;
  subMerchantId: string;
  encryptionKey: string; // 16 chars
  payMode: string; // single digit; 0=All, 1=NetBanking, 2=Card, 9=UPI
}

export interface IciciEazypayConfig {
  credentials: IciciEazypayCredentials;
  baseUrl: string; // UAT: https://eazypayuat.icicibank.com/EazyPG  |  PROD: https://eazypay.icicibank.com/EazyPG
  returnUrl: string; // must EXACTLY match what's registered with ICICI
  timeoutMs: number;
}

export class IciciEazypayProvider implements PaymentProvider {
  readonly code = 'ICICI_EAZYPAY' as const;
  readonly name = 'ICICI Eazypay';
  readonly capabilities: readonly PaymentCapability[] = [
    'WALLET_TOPUP',
    'CARD',
    'NETBANKING',
    'UPI',
    'NEFT_RTGS',
  ];

  constructor(private readonly cfg: IciciEazypayConfig) {}

  async initiate(req: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
    const { merchantId, subMerchantId, encryptionKey, payMode } = this.cfg.credentials;
    const referenceNo = req.paymentTransactionCode;
    const mandatory = eazypayMandatoryFields(referenceNo, subMerchantId, req.amountPaise);
    // Optional fields default to space-padded empty pipes (Eazypay parser quirk).
    const optional = req.optionalFields
      ? Object.values(req.optionalFields).map((v) => v || ' ').join('|')
      : ' | | | ';

    const enc = (v: string) => eazypayEncrypt(v, encryptionKey);
    const formFields: Record<string, string> = {
      merchantid: merchantId,
      mandatory_fields: enc(mandatory),
      optional_fields: enc(optional),
      returnurl: enc(this.cfg.returnUrl),
      'Reference No': enc(referenceNo),
      submerchantid: enc(subMerchantId),
      'transaction amount': enc((req.amountPaise / 100).toFixed(2)),
      paymode: enc(payMode),
    };

    // GET-style URL works for most browsers; some block long querystrings, so
    // also surface the formFields so the frontend can auto-submit a hidden form.
    const params = new URLSearchParams(formFields);
    const redirectUrl = `${this.cfg.baseUrl}?${params.toString()}`;

    logger.info(
      {
        provider: 'ICICI_EAZYPAY',
        action: 'initiate',
        referenceNo,
        amountPaise: req.amountPaise,
      },
      'eazypay initiate built',
    );

    return {
      method: 'FORM_POST',
      redirectUrl,
      formFields,
      sessionId: referenceNo,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }

  async verify(req: VerifyPaymentRequest): Promise<VerifyPaymentResponse> {
    const { encryptionKey } = this.cfg.credentials;
    const decrypted: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.rawPayload)) {
      if (typeof v !== 'string' || !/^[0-9A-F]+$/i.test(v)) continue;
      try {
        decrypted[k] = eazypayDecrypt(v, encryptionKey);
      } catch (err) {
        logger.warn({ field: k, err }, 'eazypay return-field decrypt failed');
      }
    }

    const responseCode = decrypted['ResponseCode'] ?? '';
    const success = responseCode === 'E000';
    const status: VerifyPaymentResponse['status'] = success
      ? 'SUCCESS'
      : responseCode
        ? 'FAILED'
        : 'PENDING';

    return {
      status,
      gatewayTxnId: decrypted['UniqueRefNumber'] || decrypted['ID'] || undefined,
      paymentInstrument: mapEazypayMode(decrypted['PaymentMode']),
      paymentInstrumentDetails: { bankCode: decrypted['TPSBankCODE'] },
      failureCode: success ? undefined : responseCode || 'NO_RESPONSE_CODE',
      failureReason: success ? undefined : ICICI_RESPONSE_CODES[responseCode] ?? 'Unknown failure',
      parsed: decrypted,
    };
  }

  async fetchStatus(_gatewayTxnId: string): Promise<FetchStatusResponse> {
    // ICICI exposes a Verify URL — its exact path + payload differs per
    // merchant onboarding pack. Implementing once we have UAT creds + the
    // signed contract; until then this returns UNKNOWN so the sweep job
    // doesn't make a wrong call.
    logger.warn(
      { gatewayTxnId: _gatewayTxnId },
      'eazypay fetchStatus not yet implemented — needs Verify URL from merchant pack',
    );
    return { status: 'UNKNOWN', terminal: false, parsed: {} };
  }

  async healthCheck(): Promise<HealthStatus> {
    // Eazypay has no public ping — if the URL is set we consider it reachable.
    return { ok: !!this.cfg.baseUrl, message: 'config-only check' };
  }

  verifyWebhookSignature(_req: RawWebhookRequest): WebhookPayload {
    // No webhook in Eazypay's standard flow.
    throw new PaymentError(
      'GATEWAY_FAILURE',
      'ICICI Eazypay does not support webhooks — verify via return URL or status fetch',
      this.code,
    );
  }
}

function mapEazypayMode(
  mode: string | undefined,
): VerifyPaymentResponse['paymentInstrument'] {
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

/**
 * Subset of ICICI response-code → human messages we've seen documented.
 * Fill out from the official spec doc once the merchant onboarding pack
 * arrives. Unknown codes fall through to "Unknown failure".
 */
export const ICICI_RESPONSE_CODES: Record<string, string> = {
  E000: 'Success',
  E001: 'Insufficient funds',
  E002: 'Invalid card / not honoured',
  E007: 'Failed at acquirer',
  E008: 'Cancelled by user',
  E0Z0: 'Customer cancelled',
  E0Z1: 'Session expired',
  E555: 'Service unavailable, retry',
  E999: 'Unknown gateway failure',
};
