import { z } from 'zod';

// Payment + wallet Zod contracts. Single source of truth for API + Web.




export const PAYMENT_PROVIDER = ['ICICI_ORANGE_PG', 'PHONEPE', 'MANUAL'] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDER)[number];

/** Gateway-side status (ours). Exported as PAYMENT_TXN_STATUS to avoid colliding
 *  with the existing enums.PAYMENT_STATUS (booking-payment status). */
export const PAYMENT_TXN_STATUS = [
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
export type PaymentTxnStatus = (typeof PAYMENT_TXN_STATUS)[number];

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

export const TOPUP_METHOD = [
  'ICICI_ORANGE_PG',
  'PHONEPE',
  'MANUAL_NEFT',
  'MANUAL_UPI',
  'MANUAL_CASH',
]  as const;
export type TopupMethod = (typeof TOPUP_METHOD)[number];

// ────────── Request shapes ──────────

/** Min top-up = ₹100 (10,000 paise), max = ₹50L (5,00,00,000 paise). */
const amountPaise = z
  .number()
  .int()
  .min(10_000, 'minimum top-up is ₹100')
  .max(5_000_000_00, 'maximum top-up is ₹50,00,000');

export const GatewayInitiateTopupRequestSchema = z.object({
  amount: amountPaise,



  providerCode: z.enum(['ICICI_ORANGE_PG', 'PHONEPE']),

  /** Optional override: target a specific wallet (admin only — server enforces). */
  walletId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  /** Optional booking id — when supplied, the gateway webhook worker
   *  auto-confirms the booking after the wallet is credited. Used by
   *  the "Pay Now" booking flow; absent for plain wallet top-ups. */
  bookingId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
});
export type GatewayInitiateTopupRequest = z.infer<typeof GatewayInitiateTopupRequestSchema>;

export const ManualTopupRequestSchema = z.object({
  amount: amountPaise,
  method: z.enum(['MANUAL_NEFT', 'MANUAL_UPI', 'MANUAL_CASH']),
  manualProof: z.object({
    bankName: z.string().max(120).optional(),
    transactionRef: z.string().min(3).max(60),
    transactionDate: z.string().datetime(),
    proofImageUrl: z.string().url().optional(),
    notes: z.string().max(500).optional(),
  }),
});
export type ManualTopupRequest = z.infer<typeof ManualTopupRequestSchema>;

export const GatewayApproveTopupRequestSchema = z.object({
  notes: z.string().max(500).optional(),
});
export const GatewayRejectTopupRequestSchema = z.object({
  reason: z.string().min(10).max(500),
});

export const WalletTransferRequestSchema = z.object({
  toWalletId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  amount: amountPaise,
  note: z.string().max(240).optional(),
});

export const WalletAdjustRequestSchema = z.object({
  walletId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  amount: z.number().int(), // can be negative for debit
  /** Reason is mandatory for adjustments — surfaced in audit log. */
  reason: z.string().min(10).max(500),
});

export const WalletFreezeRequestSchema = z.object({
  reason: z.string().min(10).max(500),
});

// ────────── Gateway config (admin) ──────────

export const PaymentGatewayConfigUpdateSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED', 'MAINTENANCE']).optional(),
  environment: z.enum(['UAT', 'PROD']).optional(),
  baseUrl: z.string().url().optional(),
  webhookUrl: z.string().url().optional(),
  returnUrl: z.string().url().optional(),
  amountMin: z.number().int().min(1).optional(),
  amountMax: z.number().int().min(1).optional(),
  mdrPercent: z.number().min(0).max(10).optional(),
  mdrFixed: z.number().int().min(0).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  /** Only set on POST/PATCH that includes credential rotation. Server stores
   *  via select:false; never echoed back. */
  credentials: z.record(z.unknown()).optional(),
});

// ────────── Public response shapes ──────────

export const PublicPaymentTransactionSchema = z.object({
  id: z.string(),
  txnCode: z.string(),
  walletId: z.string(),
  purpose: z.enum(['WALLET_TOPUP', 'BOOKING_PAYMENT', 'REFUND']),
  amount: z.number().int(),
  currency: z.string(),
  providerCode: z.enum(PAYMENT_PROVIDER),
  status: z.enum(PAYMENT_TXN_STATUS),
  paymentInstrument: z.enum(PAYMENT_INSTRUMENT).nullable(),
  failureReason: z.string().nullable(),
  failureCode: z.string().nullable(),
  initiatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type PublicPaymentTransaction = z.infer<typeof PublicPaymentTransactionSchema>;

export const GatewayInitiateTopupResponseSchema = z.object({
  paymentTxnId: z.string(),
  txnCode: z.string(),
  redirectUrl: z.string(),
  expiresAt: z.string().datetime(),
  /** When the gateway returns a form-post URL, the frontend can
   *  either redirect via window.location.href, or auto-submit a hidden form
   *  to handle browsers that block POST navigations. */
  method: z.enum(['REDIRECT', 'FORM_POST']),
});
