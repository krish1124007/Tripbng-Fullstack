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

export const BOOKING_STATUS = [
  'INITIATED',
  'HOLD',
  'PAYMENT_PENDING',
  'TICKETING_IN_PROGRESS',
  'CONFIRMED',
  'TICKETED',
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
  'RAZORPAY',
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
] as const;
export type WalletTxnType = (typeof WALLET_TXN_TYPE)[number];
