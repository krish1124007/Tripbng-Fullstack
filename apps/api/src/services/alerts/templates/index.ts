// Template registry — event → renderer.
//
// Adding a new event:
//   1. Add the constant to AlertEvent in types.ts
//   2. Drop a new template file alongside this one
//   3. Wire it into the registry below
//
// We keep the registry as an object literal (not a Map) so unknown keys are a
// type error at the call site, not a runtime miss.

import type { AlertEvent, AlertTemplate } from '../types.js';
import { bookingConfirmedTemplate } from './booking-confirmed.js';
import { bookingFailedTemplate } from './booking-failed.js';
import { bookingCancelledTemplate } from './booking-cancelled.js';
import { topupSucceededTemplate } from './topup-succeeded.js';
import { topupFailedTemplate } from './topup-failed.js';
import { holdExpiryWarningTemplate } from './hold-expiry-warning.js';
import { insuranceIssuedTemplate } from './insurance-issued.js';
import { manualTopupApprovedTemplate } from './manual-topup-approved.js';
import { manualTopupRejectedTemplate } from './manual-topup-rejected.js';
import { lowWalletBalanceTemplate } from './low-wallet-balance.js';
import { circuitBreakerTrippedTemplate } from './circuit-breaker-tripped.js';
import { loginNewDeviceTemplate } from './login-new-device.js';
import { hotelBookingAwaitsApprovalTemplate } from './hotel-booking-awaits-approval.js';
import { hotelBookingApprovedTemplate } from './hotel-booking-approved.js';
import { hotelBookingRejectedTemplate } from './hotel-booking-rejected.js';
import { hotelBookingConfirmedTemplate } from './hotel-booking-confirmed.js';
import { hotelBookingFailedTemplate } from './hotel-booking-failed.js';
import { hotelBookingCancelledTemplate } from './hotel-booking-cancelled.js';
import { creditDueReminderTemplate } from './credit-due-reminder.js';
import { incentiveCreditedTemplate } from './incentive-credited.js';
import { distributorTransferInTemplate } from './distributor-transfer-in.js';
import { moduleSwitchedTemplate } from './module-switched.js';
import { adjustmentPostedTemplate } from './adjustment-posted.js';

/** Partial — events without a template here can't be sent. The dispatcher
 *  treats a missing entry as "alert disabled" + logs a warning. */
export const TEMPLATES: Partial<Record<AlertEvent, AlertTemplate>> = {
  // P0
  BOOKING_CONFIRMED: bookingConfirmedTemplate,
  BOOKING_FAILED: bookingFailedTemplate,
  TOPUP_SUCCEEDED: topupSucceededTemplate,
  TOPUP_FAILED: topupFailedTemplate,
  HOLD_EXPIRY_WARNING: holdExpiryWarningTemplate,

  // P1
  BOOKING_CANCELLED: bookingCancelledTemplate,
  INSURANCE_ISSUED: insuranceIssuedTemplate,
  MANUAL_TOPUP_APPROVED: manualTopupApprovedTemplate,
  MANUAL_TOPUP_REJECTED: manualTopupRejectedTemplate,
  LOW_WALLET_BALANCE: lowWalletBalanceTemplate,

  // Security
  LOGIN_NEW_DEVICE: loginNewDeviceTemplate,

  // Hotel corporate workflow (Phase 5)
  HOTEL_BOOKING_AWAITS_APPROVAL: hotelBookingAwaitsApprovalTemplate,
  HOTEL_BOOKING_APPROVED: hotelBookingApprovedTemplate,
  HOTEL_BOOKING_REJECTED: hotelBookingRejectedTemplate,

  // Hotel lifecycle (booker-facing outcomes)
  HOTEL_BOOKING_CONFIRMED: hotelBookingConfirmedTemplate,
  HOTEL_BOOKING_FAILED: hotelBookingFailedTemplate,
  HOTEL_BOOKING_CANCELLED: hotelBookingCancelledTemplate,

  // Ops
  CIRCUIT_BREAKER_TRIPPED: circuitBreakerTrippedTemplate,

  // Agency-wallet — credit-due reminders, DI incentive, distributor transfer,
  // module switch, manual adjustments. All four credit-due anchors share the
  // same template (it branches on event name internally).
  CREDIT_DUE_T_MINUS_3: creditDueReminderTemplate,
  CREDIT_DUE_T_MINUS_1: creditDueReminderTemplate,
  CREDIT_DUE_TODAY: creditDueReminderTemplate,
  CREDIT_OVERDUE: creditDueReminderTemplate,
  INCENTIVE_CREDITED: incentiveCreditedTemplate,
  DISTRIBUTOR_TRANSFER_IN: distributorTransferInTemplate,
  MODULE_SWITCHED: moduleSwitchedTemplate,
  ADJUSTMENT_POSTED: adjustmentPostedTemplate,
};
