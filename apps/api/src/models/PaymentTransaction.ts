// PaymentTransaction — gateway-side record. Spec §3.2.
//
// Distinct from WalletTransaction:
//   - PaymentTransaction = "what happened with the payment gateway" (init,
//     redirect, webhook, success/fail).
//   - WalletTransaction  = "what happened to the agency's money" (immutable
//     ledger entry).
//
// One PT may produce zero or one WT (only on SUCCESS). The walletTransactionId
// link is set in markSuccess, in the same Mongo session that creates the WT
// and updates Wallet.balance.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

export const PAYMENT_PURPOSE = ['WALLET_TOPUP', 'BOOKING_PAYMENT', 'REFUND'] as const;
export const PAYMENT_PROVIDER = ['ICICI_EAZYPAY', 'PHONEPE', 'MANUAL'] as const;
export const PAYMENT_INSTRUMENT = [
  'UPI',
  'CARD',
  'NETBANKING',
  'NEFT',
  'RTGS',
  'IMPS',
  'WALLET',
  'UNKNOWN',
] as const;

/**
 * State machine — see spec §16.3.
 *   INITIATED  → we created the record, gateway not yet contacted
 *   PENDING    → session created, user redirected
 *   PROCESSING → user came back / awaiting verification
 *   SUCCESS    → verified, wallet credited
 *   FAILED     → terminal failure
 *   TIMEOUT    → session expired (resolved by sweep)
 *   REFUND_INITIATED → refund call sent
 *   REFUNDED   → terminal refund
 *   DISPUTED   → chargeback raised
 *   RECONCILED_MANUAL → resolved via reconciliation, not gateway response
 *
 * Transitions enforced by PaymentService.transition() — invalid moves throw.
 */
export const PAYMENT_STATUS = [
  'INITIATED',
  'PENDING',
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'TIMEOUT',
  'REFUND_INITIATED',
  'REFUNDED',
  'DISPUTED',
  'RECONCILED_MANUAL',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

const PaymentTransactionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    txnCode: { type: String, required: true, unique: true, index: true }, // PT0000123

    // Owner / context.
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    initiatedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },

    purpose: { type: String, enum: PAYMENT_PURPOSE, required: true, index: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    refundOfPaymentTxnId: { type: Schema.Types.ObjectId, ref: 'PaymentTransaction', default: null },

    amount: { type: Number, required: true, min: 1 }, // paise
    currency: { type: String, default: 'INR' },

    // Gateway.
    providerCode: { type: String, enum: PAYMENT_PROVIDER, required: true, index: true },
    gatewayConfigId: { type: Schema.Types.ObjectId, ref: 'PaymentGatewayConfig', default: null },
    gatewayTxnId: { type: String, default: null, index: true },
    gatewayPaymentId: { type: String, default: null },
    paymentInstrument: { type: String, enum: PAYMENT_INSTRUMENT, default: null },
    paymentInstrumentDetails: { type: Schema.Types.Mixed, default: null },

    status: { type: String, enum: PAYMENT_STATUS, default: 'INITIATED', index: true },

    /** Append-only audit trail of every status change. Pushed by
     *  paymentService.transition() — never written directly. The whole point
     *  is to answer "how did this PT go from PENDING → SUCCESS at 2:14
     *  → FAILED at 2:15?" without grep-archaeology of logs. */
    statusHistory: [
      {
        from: { type: String, enum: PAYMENT_STATUS, required: true },
        to: { type: String, enum: PAYMENT_STATUS, required: true },
        at: { type: Date, default: () => new Date() },
        reason: { type: String, default: null },
        actor: { type: String, default: null }, // userId or 'SYSTEM' / 'WEBHOOK' / 'RECON_SWEEP'
        verificationMethod: { type: String, default: null },
      },
    ],

    // Idempotency — sparse so unset PTs don't collide.
    idempotencyKey: { type: String, default: null },

    // Lifecycle timestamps.
    initiatedAt: { type: Date, default: () => new Date() },
    redirectedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    reconciledAt: { type: Date, default: null },

    // Verification.
    verificationMethod: {
      type: String,
      enum: ['WEBHOOK', 'RETURN_URL', 'POLL', 'RECON_SWEEP', 'MANUAL'],
      default: null,
    },
    webhookReceivedAt: { type: Date, default: null },
    webhookPayloadId: { type: Schema.Types.ObjectId, ref: 'WebhookEvent', default: null },

    // Settlement (when money actually hits platform's bank).
    settlement: {
      settledAt: { type: Date, default: null },
      settlementAmount: { type: Number, default: null },
      mdrAmount: { type: Number, default: null },
      gstOnMdr: { type: Number, default: null },
      settlementBatchId: { type: String, default: null },
      settlementUtr: { type: String, default: null },
    },

    // Failure detail.
    failureReason: { type: String, default: null },
    failureCode: { type: String, default: null },
    retryable: { type: Boolean, default: false },
    retryCount: { type: Number, default: 0 },

    // Linked wallet transaction (only on success).
    walletTransactionId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },

    // Raw payloads — `select: false` to keep them out of normal queries (PII risk +
    // some gateways send 100KB+ blobs). Encryption-at-rest happens at the storage
    // layer (Mongo Atlas FLE / disk encryption).
    gatewayRequestPayload: { type: Schema.Types.Mixed, default: null, select: false },
    gatewayResponsePayload: { type: Schema.Types.Mixed, default: null, select: false },

    // Audit.
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    deviceFingerprint: { type: String, default: null },
  },
  { timestamps: true },
);

PaymentTransactionSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
PaymentTransactionSchema.index({ tenantId: 1, walletId: 1, createdAt: -1 });
PaymentTransactionSchema.index({ providerCode: 1, gatewayTxnId: 1 });
PaymentTransactionSchema.index({ status: 1, initiatedAt: 1 }); // stale-PT sweep
// Idempotency — unique only when a key is set.
PaymentTransactionSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export type PaymentTransactionDoc = HydratedDocument<
  InferSchemaType<typeof PaymentTransactionSchema>
> & { _id: Types.ObjectId };
export const PaymentTransaction: Model<PaymentTransactionDoc> =
  (mongoose.models.PaymentTransaction as Model<PaymentTransactionDoc> | undefined) ??
  model<PaymentTransactionDoc>('PaymentTransaction', PaymentTransactionSchema);
