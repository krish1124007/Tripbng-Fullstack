// WebhookEvent — every webhook stored RAW. Spec §3.3.
//
// Why we store the raw body even on signature failure: forensic replay. A
// gateway might rotate keys without telling us; a logged raw body is the
// only thing that lets us replay later with the correct key.
//
// Dedupe key: (providerCode, gatewayTxnId, eventType). Same key arriving
// twice = `processingStatus = 'DUPLICATE'`, no second wallet credit.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { PAYMENT_PROVIDER } from './PaymentTransaction.js';

const WebhookEventSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    providerCode: { type: String, enum: PAYMENT_PROVIDER, required: true, index: true },
    eventType: { type: String, default: 'UNKNOWN' },

    // Raw inbound — kept verbatim.
    rawHeaders: { type: Schema.Types.Mixed, default: null },
    rawBody: { type: String, required: true },
    signature: { type: String, default: null },
    signatureValid: { type: Boolean, required: true },

    // Parsed.
    parsedPayload: { type: Schema.Types.Mixed, default: null },
    paymentTxnId: { type: Schema.Types.ObjectId, ref: 'PaymentTransaction', default: null, index: true },
    gatewayTxnId: { type: String, default: null, index: true },

    // Processing.
    processedAt: { type: Date, default: null },
    processingStatus: {
      type: String,
      enum: ['RECEIVED', 'PROCESSED', 'FAILED', 'DUPLICATE', 'IGNORED'],
      default: 'RECEIVED',
      index: true,
    },
    processingError: { type: String, default: null },
    processingAttempts: { type: Number, default: 0 },

    // Source verification (for providers with IP allowlists).
    sourceIp: { type: String, default: null },
    sourceVerified: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: 'receivedAt', updatedAt: 'updatedAt' } },
);

WebhookEventSchema.index({ providerCode: 1, gatewayTxnId: 1, eventType: 1 });
WebhookEventSchema.index({ providerCode: 1, processingStatus: 1, receivedAt: -1 });

export type WebhookEventDoc = HydratedDocument<InferSchemaType<typeof WebhookEventSchema>> & {
  _id: Types.ObjectId;
};
export const WebhookEvent: Model<WebhookEventDoc> =
  (mongoose.models.WebhookEvent as Model<WebhookEventDoc> | undefined) ??
  model<WebhookEventDoc>('WebhookEvent', WebhookEventSchema);
