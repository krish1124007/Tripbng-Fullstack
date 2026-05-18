// PaymentGatewayConfig — DB-backed, tenant-scoped. Spec §2.3 + §11.
//
// Why DB-backed (vs. env): admins enable/disable per-tenant, swap UAT↔PROD
// without redeploys, and the disabled-agency-group rules are first-class.
//
// `credentials` is `select: false` — it never appears in default reads. The
// admin "Reveal" flow re-fetches via a 2FA-gated endpoint that explicitly
// includes the field. Encryption-at-rest happens at the storage layer
// (Mongo Atlas FLE in production); this model treats them as opaque.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { PAYMENT_PROVIDER } from './PaymentTransaction.js';

const PaymentGatewayConfigSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    providerCode: { type: String, enum: PAYMENT_PROVIDER, required: true },
    displayName: { type: String, required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'DISABLED', 'MAINTENANCE'],
      default: 'DISABLED',
      index: true,
    },
    environment: { type: String, enum: ['UAT', 'PROD'], required: true },

    // Provider-specific. Stored ENCRYPTED at rest via field-encryption helper
    // (`encryptedCredentials` is the prefixed AES-256-GCM ciphertext).
    // Plaintext access goes through `getCredentials(cfg)` in `payment-config.service.ts`,
    // which decrypts inline. Direct reads of this field return the ciphertext.
    encryptedCredentials: { type: String, default: '', select: false },

    baseUrl: { type: String, required: true },
    webhookUrl: { type: String, default: null },
    returnUrl: { type: String, default: null },

    // Routing rules.
    enabledForRoles: [{ type: String, enum: ['DISTRIBUTOR', 'AGENCY', 'SUB_AGENT'] }],
    disabledAgencyGroupIds: [{ type: Schema.Types.ObjectId, ref: 'AgencyGroup' }],
    amountMin: { type: Number, default: 100 }, // ₹1
    amountMax: { type: Number, default: 10_000_000_00 }, // ₹1Cr (paise)

    // MDR for cost analytics — informational, not used in the transaction flow.
    mdrPercent: { type: Number, default: null },
    mdrFixed: { type: Number, default: null }, // paise
    mdrGstPercent: { type: Number, default: 18 },

    // Operational.
    timeoutMs: { type: Number, default: 30_000 },
    retryAttempts: { type: Number, default: 3 },
    circuitBreakerThreshold: { type: Number, default: 5 },

    // Audit.
    lastModifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lastTestedAt: { type: Date, default: null },
    lastHealthStatus: {
      type: String,
      enum: ['HEALTHY', 'DEGRADED', 'DOWN'],
      default: null,
    },
  },
  { timestamps: true },
);

PaymentGatewayConfigSchema.index(
  { tenantId: 1, providerCode: 1, environment: 1 },
  { unique: true },
);

export type PaymentGatewayConfigDoc = HydratedDocument<
  InferSchemaType<typeof PaymentGatewayConfigSchema>
> & { _id: Types.ObjectId };
export const PaymentGatewayConfig: Model<PaymentGatewayConfigDoc> =
  (mongoose.models.PaymentGatewayConfig as Model<PaymentGatewayConfigDoc> | undefined) ??
  model<PaymentGatewayConfigDoc>('PaymentGatewayConfig', PaymentGatewayConfigSchema);
