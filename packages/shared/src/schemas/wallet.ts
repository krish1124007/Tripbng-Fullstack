import { z } from 'zod';
import { PAYMENT_MODE, WALLET_TXN_TYPE } from '../enums.js';

export const TOPUP_STATUS = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'] as const;
export type TopupStatus = (typeof TOPUP_STATUS)[number];

// Modes that need admin approval before posting to the ledger.
export const MANUAL_TOPUP_MODES = ['BANK', 'UPI', 'CASH'] as const;
export type ManualTopupMode = (typeof MANUAL_TOPUP_MODES)[number];

// Public ledger row — what we return to the UI. Mirrors the on-disk shape but stringified IDs.
export const PublicWalletTxnSchema = z.object({
  id: z.string(),
  txnId: z.string(),
  userId: z.string(),
  agencyId: z.string().nullable(),
  distributorId: z.string().nullable(),
  type: z.enum(WALLET_TXN_TYPE),
  direction: z.enum(['CREDIT', 'DEBIT']),
  amountPaise: z.number().int(),
  balanceAfterPaise: z.number().int(),
  currency: z.string(),
  bookingId: z.string().nullable(),
  topupRequestId: z.string().nullable(),
  amendmentId: z.string().nullable(),
  relatedTxnId: z.string().nullable(),
  description: z.string().nullable(),
  performedBy: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type PublicWalletTxn = z.infer<typeof PublicWalletTxnSchema>;

export const WalletQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  type: z.enum(WALLET_TXN_TYPE).optional(),
  direction: z.enum(['CREDIT', 'DEBIT']).optional(),
  bookingId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // Super admin can scope to a specific agency or distributor; others are auto-scoped to self.
  agencyId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  distributorId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
});
export type WalletQuery = z.infer<typeof WalletQuerySchema>;

export const WalletSummarySchema = z.object({
  walletKind: z.enum(['AGENCY', 'DISTRIBUTOR']),
  ownerId: z.string(),
  ownerCode: z.string(),
  ownerName: z.string(),
  walletBalancePaise: z.number().int(),
  creditLimitPaise: z.number().int(),
  outstandingPaise: z.number().int(),
  currency: z.string(),
});
export type WalletSummary = z.infer<typeof WalletSummarySchema>;

export const InitiateTopupRequestSchema = z
  .object({
    // Always paise. UI helpers convert from rupees on submit.
    amountPaise: z.number().int().min(10000, 'Minimum top-up is ₹100'),
    paymentMode: z.enum(PAYMENT_MODE),
    notes: z.string().max(500).optional(),

    // Razorpay returns these on the client after checkout — passed back for verification.
    razorpayPaymentId: z.string().optional(),
    razorpayOrderId: z.string().optional(),
    razorpaySignature: z.string().optional(),

    // For manual modes: the bank reference / UPI ref number / receipt number.
    referenceNumber: z.string().max(120).optional(),
    proofUrl: z.string().url().optional(),

    // Super admin can credit any agency/distributor wallet manually; others top up their own.
    agencyId: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/)
      .optional(),
    distributorId: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/)
      .optional(),
  })
  .refine((d) => d.paymentMode !== 'BANK' || !!d.referenceNumber, {
    message: 'referenceNumber required for BANK transfers',
    path: ['referenceNumber'],
  });
export type InitiateTopupRequest = z.infer<typeof InitiateTopupRequestSchema>;

export const InitiateTopupResponseSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('RAZORPAY'),
    topupId: z.string(),
    razorpayOrderId: z.string(),
    razorpayKeyId: z.string(),
    amountPaise: z.number().int(),
    currency: z.string(),
  }),
  z.object({
    mode: z.literal('MANUAL'),
    topupId: z.string(),
    status: z.literal('PENDING'),
  }),
  z.object({
    mode: z.literal('ADMIN_CREDIT'),
    topupId: z.string(),
    status: z.literal('APPROVED'),
    txnId: z.string(),
  }),
]);
export type InitiateTopupResponse = z.infer<typeof InitiateTopupResponseSchema>;

export const VerifyRazorpayTopupRequestSchema = z.object({
  topupId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  razorpayPaymentId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});
export type VerifyRazorpayTopupRequest = z.infer<typeof VerifyRazorpayTopupRequestSchema>;

export const ApproveTopupRequestSchema = z.object({
  notes: z.string().max(500).optional(),
});

export const RejectTopupRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});

export const PublicTopupRequestSchema = z.object({
  id: z.string(),
  amountPaise: z.number().int(),
  currency: z.string(),
  paymentMode: z.enum(PAYMENT_MODE),
  status: z.enum(TOPUP_STATUS),
  agencyId: z.string().nullable(),
  agencyCode: z.string().nullable(),
  agencyName: z.string().nullable(),
  distributorId: z.string().nullable(),
  distributorCode: z.string().nullable(),
  distributorName: z.string().nullable(),
  requestedByUserId: z.string(),
  approvedByUserId: z.string().nullable(),
  rejectedByUserId: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  proofUrl: z.string().nullable(),
  razorpayOrderId: z.string().nullable(),
  razorpayPaymentId: z.string().nullable(),
  notes: z.string().nullable(),
  walletTxnId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicTopupRequest = z.infer<typeof PublicTopupRequestSchema>;

export const TransferRequestSchema = z.object({
  toAgencyId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  amountPaise: z.number().int().min(10000, 'Minimum transfer is ₹100'),
  notes: z.string().max(500).optional(),
});
export type TransferRequest = z.infer<typeof TransferRequestSchema>;

export const AdjustWalletRequestSchema = z
  .object({
    direction: z.enum(['CREDIT', 'DEBIT']),
    amountPaise: z.number().int().min(1),
    reason: z.string().min(3).max(500),
    agencyId: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/)
      .optional(),
    distributorId: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/)
      .optional(),
  })
  .refine((d) => !!d.agencyId !== !!d.distributorId, {
    message: 'exactly one of agencyId / distributorId must be set',
    path: ['agencyId'],
  });
export type AdjustWalletRequest = z.infer<typeof AdjustWalletRequestSchema>;

export const StatementQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  agencyId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  distributorId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
});
export type StatementQuery = z.infer<typeof StatementQuerySchema>;

export const SetCreditLimitRequestSchema = z.object({
  creditLimitPaise: z.number().int().min(0),
  reason: z.string().min(3).max(500),
});
export type SetCreditLimitRequest = z.infer<typeof SetCreditLimitRequestSchema>;
