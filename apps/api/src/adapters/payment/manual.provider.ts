// Manual provider — NEFT/UPI proof upload + admin approval. No gateway.
//
// Initiate is a no-op: the agency creates a TopupRequest with manual proof,
// admin approves via a separate route, and the wallet credit happens at
// approval time (not via this provider). The provider exists so the registry
// is uniform — the routing layer always asks the registry for a provider,
// even when the "provider" is the human approval workflow.

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

export class ManualProvider implements PaymentProvider {
  readonly code = 'MANUAL' as const;
  readonly name = 'Manual NEFT / UPI / Cash';
  readonly capabilities: readonly PaymentCapability[] = ['WALLET_TOPUP', 'NEFT_RTGS'];

  async initiate(_req: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
    throw new PaymentError(
      'BAD_REQUEST',
      'Manual top-ups go through POST /api/v1/topups/manual, not initiate',
      this.code,
    );
  }

  async verify(_req: VerifyPaymentRequest): Promise<VerifyPaymentResponse> {
    return { status: 'PENDING', parsed: {} };
  }

  async fetchStatus(_gatewayTxnId: string): Promise<FetchStatusResponse> {
    return { status: 'UNKNOWN', terminal: false, parsed: {} };
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, message: 'manual provider always healthy' };
  }

  verifyWebhookSignature(_req: RawWebhookRequest): WebhookPayload {
    throw new PaymentError('GATEWAY_FAILURE', 'Manual provider has no webhooks', this.code);
  }
}
