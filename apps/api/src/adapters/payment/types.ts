// PaymentProvider — common contract for every payment gateway.
// Mirrors the SupplierAdapter pattern (see CLAUDE.md §7).

import type { Types } from 'mongoose';

export type PaymentProviderCode = 'ICICI_ORANGE_PG' | 'PHONEPE' | 'MANUAL';

export type PaymentCapability =
  | 'WALLET_TOPUP'
  | 'BOOKING_PAYMENT'
  | 'REFUND'
  | 'AUTOPAY'
  | 'UPI'
  | 'CARD'
  | 'NETBANKING'
  | 'NEFT_RTGS'
  | 'WEBHOOK';

// ────────── Initiate ──────────

export interface InitiatePaymentRequest {
  paymentTransactionCode: string;
  amountPaise: number;
  walletId: Types.ObjectId;
  agencyId?: Types.ObjectId | null;
  agencyName?: string;
  initiatedByUserId: Types.ObjectId;
  purpose: 'WALLET_TOPUP' | 'BOOKING_PAYMENT' | 'REFUND';
  /** Free-form per provider. */
  optionalFields?: Record<string, string>;
  ipAddress?: string;
  userAgent?: string;
}

export interface InitiatePaymentResponse {
  /** REDIRECT = simple `window.location.href = url`.
   *  FORM_POST = auto-submit a hidden form. */
  method: 'REDIRECT' | 'FORM_POST';
  redirectUrl: string;
  formFields?: Record<string, string>; // only for FORM_POST
  /** Provider's session/order id (e.g. Orange PG tranCtx, PhonePe orderId). */
  sessionId: string;
  expiresAt: Date;
}

// ────────── Verify ──────────

export interface VerifyPaymentRequest {
  paymentTransactionCode: string;
  /** The opaque payload posted to our return URL — gateway form fields,
   *  PhonePe redirect query string, etc. */
  rawPayload: Record<string, unknown>;
}

export interface VerifyPaymentResponse {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  gatewayTxnId?: string;
  paymentInstrument?: 'UPI' | 'CARD' | 'NETBANKING' | 'NEFT' | 'RTGS' | 'IMPS' | 'WALLET' | 'UNKNOWN';
  paymentInstrumentDetails?: Record<string, unknown>;
  failureCode?: string;
  failureReason?: string;
  /** Decrypted/parsed payload — for storing on PT. */
  parsed: Record<string, unknown>;
}

// ────────── Status fetch (sweep + reconciliation) ──────────

export interface FetchStatusResponse {
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'UNKNOWN';
  terminal: boolean;
  gatewayTxnId?: string;
  failureCode?: string;
  failureReason?: string;
  parsed: Record<string, unknown>;
}

// ────────── Refund ──────────

export interface RefundRequest {
  paymentTransactionCode: string;
  refundCode: string; // our refund-side reference
  amountPaise: number;
  reason: string;
}

export interface RefundResponse {
  status: 'INITIATED' | 'COMPLETED' | 'FAILED';
  gatewayRefundId?: string;
  failureReason?: string;
}

// ────────── Webhook ──────────

export interface RawWebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  sourceIp?: string;
}

export interface WebhookPayload {
  signatureValid: boolean;
  eventType: string;
  gatewayTxnId?: string;
  parsed: Record<string, unknown>;
}

// ────────── Health ──────────

export interface HealthStatus {
  ok: boolean;
  latencyMs?: number;
  message?: string;
}

// ────────── The interface itself ──────────

export interface PaymentProvider {
  readonly code: PaymentProviderCode;
  readonly name: string;
  readonly capabilities: readonly PaymentCapability[];

  initiate(req: InitiatePaymentRequest): Promise<InitiatePaymentResponse>;
  verify(req: VerifyPaymentRequest): Promise<VerifyPaymentResponse>;
  fetchStatus(gatewayTxnId: string): Promise<FetchStatusResponse>;
  refund?(req: RefundRequest): Promise<RefundResponse>;
  healthCheck(): Promise<HealthStatus>;

  /** Throws on invalid signature; returns the parsed payload otherwise. */
  verifyWebhookSignature(req: RawWebhookRequest): WebhookPayload;
}

// ────────── Errors ──────────

export class PaymentError extends Error {
  constructor(
    public code:
      | 'NOT_CONFIGURED'
      | 'BAD_REQUEST'
      | 'CRYPTO_FAILURE'
      | 'GATEWAY_FAILURE'
      | 'NETWORK_ERROR'
      | 'INVALID_SIGNATURE'
      | 'INVALID_STATE_TRANSITION'
      | 'IDEMPOTENCY_CONFLICT'
      | 'INSUFFICIENT_FUNDS'
      | 'WALLET_FROZEN',
    message: string,
    public providerCode?: PaymentProviderCode,
    public gatewayCode?: string,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

/** State-machine guardrail. See PaymentTransaction §16.3. */
export const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  INITIATED: ['PENDING', 'FAILED'],
  PENDING: ['PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT'],
  PROCESSING: ['SUCCESS', 'FAILED', 'TIMEOUT'],
  SUCCESS: ['REFUND_INITIATED', 'DISPUTED'],
  FAILED: ['RECONCILED_MANUAL'],
  TIMEOUT: ['SUCCESS', 'FAILED', 'RECONCILED_MANUAL'],
  REFUND_INITIATED: ['REFUNDED', 'FAILED'],
  REFUNDED: [],
  DISPUTED: ['REFUNDED', 'SUCCESS'],
  RECONCILED_MANUAL: [],
} as const;

export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
