// Alert system — type contract.
//
// Every multi-channel notification we emit (booking confirmed, top-up
// succeeded, low-balance warning, …) flows through this shape so the
// dispatcher, channel adapters, and templates all speak the same language.
//
// AlertEvent is a closed enum — adding a new event is a deliberate change:
//   1. Add the constant here
//   2. Register a template in templates/index.ts
//   3. (optional) Override default channels in router.ts
//
// AlertVars is a per-event union — the template for each event picks out the
// fields it cares about. We keep this typed (not `Record<string, unknown>`)
// because templates are the place silent bugs hide: a misnamed var renders
// to "undefined" in production and goes unnoticed for days.

import type { NotificationPrefs } from '@tripbng/shared';
import type { Types } from 'mongoose';

export type AlertEvent =
  // P0
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_FAILED'
  | 'TOPUP_SUCCEEDED'
  | 'TOPUP_FAILED'
  | 'HOLD_EXPIRY_WARNING'
  // P1
  | 'BOOKING_CANCELLED'
  | 'LOW_WALLET_BALANCE'
  | 'INSURANCE_ISSUED'
  | 'MANUAL_TOPUP_APPROVED'
  | 'MANUAL_TOPUP_REJECTED'
  // P2 (security/auth)
  | 'PASSWORD_RESET_OTP'
  | 'LOGIN_NEW_DEVICE'
  // Hotel-specific corporate workflow (Phase 5)
  | 'HOTEL_BOOKING_AWAITS_APPROVAL'
  | 'HOTEL_BOOKING_APPROVED'
  | 'HOTEL_BOOKING_REJECTED'
  // Hotel-specific lifecycle outcomes (booker-facing)
  | 'HOTEL_BOOKING_CONFIRMED'
  | 'HOTEL_BOOKING_FAILED'
  | 'HOTEL_BOOKING_CANCELLED'
  // Ops-only
  | 'CIRCUIT_BREAKER_TRIPPED'
  // ── Agency-wallet additions (Phases 1-8 of AGENCY_WALLET_SYSTEM spec) ──
  // Credit-due reminder anchors (spec §8)
  | 'CREDIT_DUE_T_MINUS_3'
  | 'CREDIT_DUE_T_MINUS_1'
  | 'CREDIT_DUE_TODAY'
  | 'CREDIT_OVERDUE'
  // DI module — async incentive worker fires this post-credit
  | 'INCENTIVE_CREDITED'
  // Distributor → sub-agent balance landed (TRANSFER or RECALL completed)
  | 'DISTRIBUTOR_TRANSFER_IN'
  // Admin actions
  | 'MODULE_SWITCHED'
  | 'ADJUSTMENT_POSTED';

export type AlertChannel = 'email' | 'whatsapp' | 'inapp';

/** Where the alert is delivered. The dispatcher resolves abstract refs to
 *  concrete email + mobile via the recipient resolver before queueing. */
export type RecipientRef =
  | { kind: 'agency'; id: string | Types.ObjectId }
  | { kind: 'user'; id: string | Types.ObjectId }
  | { kind: 'booking_contact'; bookingId: string | Types.ObjectId }
  | { kind: 'ops' } // routes to env.OPS_ALERT_EMAIL
  | { kind: 'raw'; email?: string; mobile?: string; name?: string };

export interface ResolvedRecipient {
  /** Display name for the template's "Hi {{name}}" slot. */
  name: string;
  email: string | null;
  mobile: string | null;
  countryCode: string | null;
  /** For audit + the in-app channel. */
  agencyId?: string | null;
  userId?: string | null;
  /** Channel preferences — falls back to global defaults when unset.
   *  Populated by the recipient resolver when the recipient has an
   *  associated agency (`agency` ref, or `user`/`booking_contact` whose
   *  resolver finds an agencyId). The dispatcher applies these AFTER the
   *  global default lookup, so an agency override beats the default but
   *  the master `channels` switches still gate the final send. */
  notificationPrefs?: NotificationPrefs | null;
}

// ───── per-event variable shapes ─────
// Keep these flat — templates are easier to write against a flat record than
// a nested booking-doc-like blob, and we want template authors to not need
// the full Mongoose model.

export interface BookingAlertVars {
  bookingCode: string;
  pnr?: string | null;
  sector: string;
  travelDate: string; // ISO yyyy-mm-dd
  paxCount: number;
  amountPaise: number;
  ticketUrl?: string | null;
}

export interface TopupAlertVars {
  txnCode: string;
  amountPaise: number;
  provider: string;
  walletBalancePaise?: number | null;
  failureReason?: string | null;
}

export interface HoldExpiryVars {
  bookingCode: string;
  sector: string;
  expiresAt: string; // ISO
  minutesRemaining: number;
}

export interface LowBalanceVars {
  walletBalancePaise: number;
  thresholdPaise: number;
  topupUrl: string;
  /** "low"      — balance dropped under the warning threshold. Dedupe
   *               per wallet for `WALLET_LOW_ALERT_DEDUPE_HOURS`.
   *  "critical" — balance under the critical threshold. Bookings are at
   *               imminent risk. Fires every monitor tick (no dedupe). */
  severity?: 'low' | 'critical';
}

export interface InsuranceIssuedVars {
  policyNumbers: string[];
  insurerName: string;
  premiumPaise: number;
  bookingCode?: string | null;
}

export interface ManualTopupVars {
  txnCode: string;
  amountPaise: number;
  decidedBy: string;
  rejectionReason?: string | null;
}

export interface PasswordResetVars {
  otp: string;
  validForMinutes: number;
}

export interface LoginAlertVars {
  ipAddress: string;
  userAgent: string;
  at: string; // ISO
}

export interface BreakerVars {
  supplier: string;
  errorRate: number;
  windowSec: number;
}

// ── Agency-wallet vars ──

/** Credit-due reminders — same shape for T-3 / T-1 / T+0 / T+3; the event
 *  name disambiguates urgency at template-render time. */
export interface CreditDueVars {
  /** Outstanding credit balance in paise (creditUsed at the time of fire). */
  creditUsedPaise: number;
  creditLimitPaise: number;
  /** ISO date of the due date, anchored to UTC midnight. */
  dueDate: string;
  /** Signed offset in days from now to due (negative = future, +3 = overdue). */
  offsetDays: number;
  /** Agency-dashboard URL where the user goes to pay down. */
  payNowUrl: string;
}

/** Fired after the DI incentive worker commits the INCENTIVE_CREDIT (+
 *  optional TDS_DEDUCT) ledger rows for a deposit. */
export interface IncentiveCreditedVars {
  /** Source deposit amount in paise. */
  depositPaise: number;
  /** Gross incentive (before TDS) in paise. */
  incentivePaise: number;
  /** TDS withheld in paise. Zero when tdsApplicable=false. */
  tdsPaise: number;
  /** Net wallet credit (= incentive − tds), in paise. */
  netCreditPaise: number;
  /** Wallet balance after the incentive applied, in paise. */
  walletBalanceAfterPaise: number;
}

/** Fired on the receiving side of a distributor→sub-agent transfer (or its
 *  reverse, when type=RECALL — the template differentiates via `type`). */
export interface DistributorTransferInVars {
  transferRef: string;
  amountPaise: number;
  /** Display name of the distributor sending (or recalling from) the balance. */
  distributorName: string;
  /** Direction signal — RECALL surfaces a different message than the normal
   *  TRANSFER receipt. */
  type: 'TRANSFER' | 'RECALL';
  /** Wallet balance after the transfer landed, in paise. */
  walletBalanceAfterPaise: number;
}

/** Admin switched the agency's module. Auditable + visible to the agency
 *  owner so they understand any change in billing behaviour. */
export interface ModuleSwitchedVars {
  previousModule: 'CREDIT' | 'DI' | 'CASH' | 'DISTRIBUTOR' | 'SUB_AGENT';
  newModule: 'CREDIT' | 'DI' | 'CASH' | 'DISTRIBUTOR' | 'SUB_AGENT';
  /** Admin-supplied free-form context, if any. */
  notes: string | null;
  /** Whether the switch used the force=true override (CREDIT→other with
   *  outstanding credit). Surfaces in the notification body. */
  forced: boolean;
}

/** Manual wallet adjustment landed (either direct execute below threshold,
 *  or via two-person approval above). */
export interface AdjustmentPostedVars {
  direction: 'CREDIT' | 'DEBIT';
  amountPaise: number;
  reason: string;
  /** Wallet balance after the adjustment, in paise. */
  walletBalanceAfterPaise: number;
  /** True when the adjustment went through the two-person approval queue. */
  wasApproved: boolean;
}

/** Hotel-booking lifecycle vars — shared base for CONFIRMED / FAILED /
 *  CANCELLED. The discriminated union below extends this with event-
 *  specific extras (refundPaise on CANCELLED, etc.). */
export interface HotelLifecycleVars {
  bookingId: string;
  /** Internal booking code (TRBNG-HTL-…). May be null for DRAFTs that
   *  failed before code allocation. */
  bookingCode: string | null;
  hotelName: string;
  city: string | null;
  checkIn: string; // ISO yyyy-mm-dd
  checkOut: string;
  nights: number;
  totalSellingPaise: number;
  /** TBO confirmation number — set on CONFIRMED. */
  confirmationNo?: string | null;
  /** TBO invoice number — set after voucher generation. */
  invoiceNumber?: string | null;
  /** Booking detail / e-voucher URL on the agency dashboard. */
  detailUrl?: string | null;
}

/** Hotel-booking corporate-workflow vars. Approval-flavour events all share
 *  the same shape — the template differentiates by event name. */
export interface HotelApprovalVars {
  bookingId: string;
  hotelName: string;
  city: string | null;
  checkIn: string; // ISO yyyy-mm-dd
  checkOut: string;
  nights: number;
  totalSellingPaise: number;
  /** Free-form policy reasons — surfaces the WHY to approver/booker. */
  reasons: string[];
  /** Booker's display name — for the approver-side template. */
  bookerName?: string | null;
  /** URL to the booking detail page on the agency dashboard. Optional —
   *  the alert dispatcher accepts null and skips the CTA when absent. */
  detailUrl?: string | null;
  /** Approver/decider name + decision note (REJECTED / APPROVED templates). */
  decidedBy?: string | null;
  decisionNote?: string | null;
}

/** Discriminated union: the dispatcher passes one variant; the template for
 *  the matching event narrows on `event`. */
export type AlertPayload =
  | { event: 'BOOKING_CONFIRMED'; vars: BookingAlertVars }
  | { event: 'BOOKING_FAILED'; vars: BookingAlertVars & { failureReason?: string | null } }
  | { event: 'BOOKING_CANCELLED'; vars: BookingAlertVars & { refundPaise: number; cancellationFeePaise: number } }
  | { event: 'TOPUP_SUCCEEDED'; vars: TopupAlertVars }
  | { event: 'TOPUP_FAILED'; vars: TopupAlertVars }
  | { event: 'HOLD_EXPIRY_WARNING'; vars: HoldExpiryVars }
  | { event: 'LOW_WALLET_BALANCE'; vars: LowBalanceVars }
  | { event: 'INSURANCE_ISSUED'; vars: InsuranceIssuedVars }
  | { event: 'MANUAL_TOPUP_APPROVED'; vars: ManualTopupVars }
  | { event: 'MANUAL_TOPUP_REJECTED'; vars: ManualTopupVars }
  | { event: 'PASSWORD_RESET_OTP'; vars: PasswordResetVars }
  | { event: 'LOGIN_NEW_DEVICE'; vars: LoginAlertVars }
  | { event: 'HOTEL_BOOKING_AWAITS_APPROVAL'; vars: HotelApprovalVars }
  | { event: 'HOTEL_BOOKING_APPROVED'; vars: HotelApprovalVars }
  | { event: 'HOTEL_BOOKING_REJECTED'; vars: HotelApprovalVars }
  | { event: 'HOTEL_BOOKING_CONFIRMED'; vars: HotelLifecycleVars }
  | {
      event: 'HOTEL_BOOKING_FAILED';
      vars: HotelLifecycleVars & { failureReason?: string | null };
    }
  | {
      event: 'HOTEL_BOOKING_CANCELLED';
      vars: HotelLifecycleVars & {
        refundPaise: number;
        cancellationFeePaise: number;
      };
    }
  | { event: 'CIRCUIT_BREAKER_TRIPPED'; vars: BreakerVars }
  // Agency-wallet events
  | { event: 'CREDIT_DUE_T_MINUS_3'; vars: CreditDueVars }
  | { event: 'CREDIT_DUE_T_MINUS_1'; vars: CreditDueVars }
  | { event: 'CREDIT_DUE_TODAY'; vars: CreditDueVars }
  | { event: 'CREDIT_OVERDUE'; vars: CreditDueVars }
  | { event: 'INCENTIVE_CREDITED'; vars: IncentiveCreditedVars }
  | { event: 'DISTRIBUTOR_TRANSFER_IN'; vars: DistributorTransferInVars }
  | { event: 'MODULE_SWITCHED'; vars: ModuleSwitchedVars }
  | { event: 'ADJUSTMENT_POSTED'; vars: AdjustmentPostedVars };

/** Render output per channel — what the dispatcher hands to the channel
 *  adapter to deliver. Templates produce these from AlertPayload. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface RenderedWhatsApp {
  /** Meta-approved template name. */
  templateName: string;
  /** Positional body params — order matches the template's {{N}} placeholders. */
  bodyParams: string[];
  language?: string;
}

export interface RenderedInApp {
  title: string;
  body: string;
  type?: string;
  actionUrl?: string | null;
}

/** A template module exports this shape. Channels marked optional mean the
 *  alert isn't supported on that channel (e.g. WhatsApp for ops alerts). */
export interface AlertTemplate {
  email?: (vars: AlertPayload) => RenderedEmail;
  whatsapp?: (vars: AlertPayload) => RenderedWhatsApp;
  inapp?: (vars: AlertPayload) => RenderedInApp;
}

// ───── helpers used by templates ─────
export function rs(paise: number): string {
  // INR formatting — Rs symbol so SMTP-fallback (no unicode safety) doesn't
  // turn into garbage. Comma grouping is Indian (lakh/crore).
  const rupees = paise / 100;
  return `Rs ${rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
