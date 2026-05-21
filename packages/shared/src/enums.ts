export const ROLES = [
  'SUPER_ADMIN',
  'DISTRIBUTOR',
  'AGENCY',
  'SUB_AGENT',
  'SUPPLIER',
  'ACCOUNTS_USER',
  'SUPPORT_AGENT',
] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUS = ['PENDING', 'ACTIVE', 'SUSPENDED', 'BLOCKED'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const AGENCY_STATUS = ['PENDING', 'ACTIVE', 'SUSPENDED', 'BLOCKED'] as const;
export type AgencyStatus = (typeof AGENCY_STATUS)[number];

// Agency-wallet module assignment — every agency belongs to exactly one. See
// docs/AGENCY_WALLET_GAP_ANALYSIS.md §11 for the rollout plan. Default 'CASH'
// keeps existing agencies behaviourally unchanged until admin migrates them.
export const AGENCY_MODULE = ['CREDIT', 'DI', 'CASH', 'DISTRIBUTOR', 'SUB_AGENT'] as const;
export type AgencyModule = (typeof AGENCY_MODULE)[number];

// Deductee category for Form 26Q / 16A — drives the "Deductee_Type" column
// in the NSDL RPU annexure. We use the legal-entity classification, not the
// tax-residency one (NRI handling is out of scope until international
// expansion). The codes in parens match NSDL's deductee_code field.
export const DEDUCTEE_CATEGORY = [
  'INDIVIDUAL',   // (1) Individual proprietor
  'HUF',          // (2) Hindu Undivided Family
  'COMPANY',      // (3) Body Corporate (private + listed)
  'FIRM',         // (4) Partnership firm (incl. LLP)
  'AOP_BOI',      // (5) Association / Body of individuals
  'TRUST',        // (6) Trust / Society
  'GOVERNMENT',   // (7) Local authority / Government
] as const;
export type DeducteeCategory = (typeof DEDUCTEE_CATEGORY)[number];

/** NSDL Form 26Q deductee_code mapping — used in the RPU flat-file export. */
export const DEDUCTEE_CATEGORY_TO_NSDL_CODE: Record<DeducteeCategory, string> = {
  INDIVIDUAL: '1',
  HUF: '2',
  COMPANY: '3',
  FIRM: '4',
  AOP_BOI: '5',
  TRUST: '6',
  GOVERNMENT: '7',
};

// Reasons the booking gate refuses a booking attempt for a given agency. Set
// alongside `bookingBlocked=true` on Agency. Null when not blocked.
export const AGENCY_BLOCK_REASON = [
  'CREDIT_LIMIT',         // creditBalance >= creditLimit
  'CREDIT_EXPIRED',       // creditExpiryDate < now
  'DUE_DATE_CROSSED',     // blockOnDueDateCross + creditDueDate < now + outstanding
  'INSUFFICIENT_BALANCE', // wallet would go negative on debit
  'ADMIN_SUSPEND',        // operator action — overrides automated checks
] as const;
export type AgencyBlockReason = (typeof AGENCY_BLOCK_REASON)[number];

export const BOOKING_STATUS = [
  'INITIATED',
  'HOLD',
  'PAYMENT_PENDING',
  'TICKETING_IN_PROGRESS',
  'CONFIRMED',
  'TICKETED',
  // Phase 5 — booking matched a Map Source with manual-issuance pendingBooking
  // criteria. The wallet was debited as usual but the supplier API was NOT
  // called. Ops issues the PNR + supplier reference manually via the admin
  // endpoint, which transitions the booking to TICKETED.
  'PENDING_MANUAL',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
  'FAILED',
  'EXPIRED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUS)[number];

export const PAYMENT_MODE = [
  'WALLET',
  'CREDIT',
  'DEPOSIT',
  'BANK',
  'UPI',
  'CASH',
] as const;
export type PaymentMode = (typeof PAYMENT_MODE)[number];

export const PAYMENT_STATUS = ['PENDING', 'PAID', 'PARTIAL', 'REFUNDED', 'FAILED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export const TRAVEL_TYPE = ['DOMESTIC', 'INTERNATIONAL'] as const;
export type TravelType = (typeof TRAVEL_TYPE)[number];

export const TRAVEL_CLASS = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const;
export type TravelClass = (typeof TRAVEL_CLASS)[number];

export const PAX_TYPE = ['ADULT', 'CHILD', 'INFANT'] as const;
export type PaxType = (typeof PAX_TYPE)[number];

export const WALLET_TXN_TYPE = [
  'TOPUP',
  'BOOKING_DEBIT',
  'REFUND_CREDIT',
  'CANCELLATION_FEE',
  'MARKUP_CREDIT',
  'COMMISSION_CREDIT',
  'INCENTIVE_CREDIT',
  'ADJUSTMENT_DEBIT',
  'ADJUSTMENT_CREDIT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'TRANSFER_REVERSAL',
  // ── Agency-wallet module additions ──────────────────────────────────────
  // Spec §3.1 payment waterfall: when a deposit lands for a CREDIT-module
  // agency with outstanding credit, the first slice settles the credit
  // (DR on the CREDIT bucket) before the surplus tops up the wallet.
  'CREDIT_SETTLEMENT',
  // Spec §3.3 DI module: incentive computed asynchronously on a successful
  // deposit, posted as a CR to the WALLET bucket alongside a TDS_DEDUCT.
  'DEPOSIT_INCENTIVE',
  // Spec §3.3: TDS withholding on a DEPOSIT_INCENTIVE — DR on the WALLET
  // bucket, paired with the parent INCENTIVE entry via relatedTxnId.
  'TDS_DEDUCT',
  // Auto-unblock reversal — emitted by the hourly recompute job when a
  // previously DUE_DATE_CROSSED block clears (e.g. caller paid down the
  // outstanding balance). Audit-only; no balance impact.
  'DUE_BLOCK_REVERSAL',
  // Topup reversal — emitted when the payment gateway pushes a refund event
  // for an earlier TOPUP success (chargeback, user-initiated refund). DR on
  // the WALLET bucket, paired with the original TOPUP via relatedTxnId. The
  // wallet may go negative if the agency already spent the topup — that's
  // operationally truthful (they owe us); the booking gate's
  // INSUFFICIENT_BALANCE check still blocks further debits until repaid.
  'TOPUP_REVERSAL',
] as const;
export type WalletTxnType = (typeof WALLET_TXN_TYPE)[number];

// Which balance bucket a ledger entry touches. Spec §3.1: wallet and credit
// are never co-mingled in a single ledger row. Existing entries default to
// WALLET (the only bucket the legacy code wrote to).
export const WALLET_TXN_BUCKET = ['WALLET', 'CREDIT'] as const;
export type WalletTxnBucket = (typeof WALLET_TXN_BUCKET)[number];
