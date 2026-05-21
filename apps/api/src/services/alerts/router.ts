// Alert router — decides which channels fire for which events.
//
// Resolution hierarchy (top wins):
//   1. Explicit override passed by the call site (`enqueueAlert({ channels: [...] })`)
//   2. Recipient-level event override (`agency.notificationPrefs.events[EVENT]`)
//   3. Global default per-event channel set (`DEFAULT_CHANNELS` below)
//
// After the channel set is decided, the recipient-level master switch
// (`agency.notificationPrefs.channels.email/whatsapp/inapp`) filters the
// final list — so an agency can disable WhatsApp globally even if a
// specific event is configured to use it.

import type { NotificationPrefs } from '@tripbng/shared';
import type { AlertChannel, AlertEvent, ResolvedRecipient } from './types.js';

/**
 * Default channel set per event. Designed so a no-op channel (e.g. WhatsApp
 * without templates approved, or SMTP without creds) silently degrades to
 * the rest — no recipient is left without ANY channel for important events.
 */
const DEFAULT_CHANNELS: Record<AlertEvent, AlertChannel[]> = {
  // P0
  BOOKING_CONFIRMED: ['email', 'whatsapp', 'inapp'],
  BOOKING_FAILED: ['email', 'whatsapp', 'inapp'],
  TOPUP_SUCCEEDED: ['email', 'whatsapp', 'inapp'],
  TOPUP_FAILED: ['email', 'inapp'], // skip WA on failure to avoid template-fatigue
  HOLD_EXPIRY_WARNING: ['whatsapp', 'inapp'], // urgent — email is too slow

  // P1
  BOOKING_CANCELLED: ['email', 'whatsapp', 'inapp'],
  LOW_WALLET_BALANCE: ['email', 'whatsapp', 'inapp'],
  INSURANCE_ISSUED: ['email', 'inapp'],
  MANUAL_TOPUP_APPROVED: ['email', 'inapp'],
  MANUAL_TOPUP_REJECTED: ['email', 'inapp'],

  // P2 — auth/security
  PASSWORD_RESET_OTP: ['email', 'whatsapp'], // OTP needs both for reachability
  LOGIN_NEW_DEVICE: ['email'],

  // Hotel corporate workflow (Phase 5)
  HOTEL_BOOKING_AWAITS_APPROVAL: ['email', 'inapp'],
  HOTEL_BOOKING_APPROVED: ['email', 'whatsapp', 'inapp'],
  HOTEL_BOOKING_REJECTED: ['email', 'inapp'],

  // Hotel lifecycle (booker-facing outcomes)
  HOTEL_BOOKING_CONFIRMED: ['email', 'whatsapp', 'inapp'],
  HOTEL_BOOKING_FAILED: ['email', 'inapp'],
  HOTEL_BOOKING_CANCELLED: ['email', 'whatsapp', 'inapp'],

  // Ops
  CIRCUIT_BREAKER_TRIPPED: ['email'], // ops inbox only
  MANUAL_ISSUANCE_PENDING_REMINDER: ['email'], // ops inbox only

  // Agency-wallet
  // Credit-due reminders escalate by anchor: heads-up is in-app + email only;
  // T-1 / today / overdue add WhatsApp for urgency.
  CREDIT_DUE_T_MINUS_3: ['email', 'inapp'],
  CREDIT_DUE_T_MINUS_1: ['email', 'whatsapp', 'inapp'],
  CREDIT_DUE_TODAY: ['email', 'whatsapp', 'inapp'],
  CREDIT_OVERDUE: ['email', 'whatsapp', 'inapp'],
  // Incentives + transfers feel like a "receipt" — email + in-app, no WA.
  INCENTIVE_CREDITED: ['email', 'inapp'],
  DISTRIBUTOR_TRANSFER_IN: ['email', 'inapp'],
  // Admin actions — quiet by default. Agency owner gets a record, not a ping.
  MODULE_SWITCHED: ['email', 'inapp'],
  ADJUSTMENT_POSTED: ['email', 'inapp'],
};

/**
 * Resolve the channels to fire for a given event. Returns the global default
 * unless a call-site override is provided. This is the layer-1 resolution
 * shared across all recipients in a dispatch — recipient-level filtering
 * happens in `applyRecipientPrefs` below.
 */
export function channelsForEvent(
  event: AlertEvent,
  override?: AlertChannel[] | null,
): AlertChannel[] {
  if (override && override.length > 0) return override;
  return DEFAULT_CHANNELS[event] ?? [];
}

/**
 * Apply a single recipient's notification prefs on top of the resolved
 * channel set. Called inside the dispatcher right before each recipient's
 * channels fan out. Two filters:
 *
 *   - Event-level override: if the recipient configured a specific channel
 *     set for THIS event, that replaces the input channels entirely.
 *   - Master switch: any channel turned off in `prefs.channels.<channel>`
 *     gets stripped from the final list.
 *
 * Returns the filtered channel array. Empty array means "drop this recipient
 * for this event" — the dispatcher handles that case as a skipped recipient.
 *
 * Events that aren't user-configurable (PASSWORD_RESET_OTP,
 * CIRCUIT_BREAKER_TRIPPED) bypass this filter entirely — the caller should
 * not invoke applyRecipientPrefs for them. The dispatcher knows which is
 * which via the `isUserConfigurableEvent` helper.
 */
export function applyRecipientPrefs(
  baseChannels: AlertChannel[],
  event: AlertEvent,
  prefs: NotificationPrefs | null | undefined,
): AlertChannel[] {
  if (!prefs || !isUserConfigurableEvent(event)) return baseChannels;

  // Layer 2: event-level override.
  const eventOverride = prefs.events?.[event as keyof typeof prefs.events];
  const channelsAfterEvent =
    eventOverride && eventOverride.length > 0 ? eventOverride : baseChannels;

  // Layer 3: master switches.
  return channelsAfterEvent.filter((c) => prefs.channels[c] !== false);
}

/** True when an event respects per-agency configuration. Hard-coded to
 *  exclude security-critical and ops-only events that must always fire. */
export function isUserConfigurableEvent(event: AlertEvent): boolean {
  return (
    event !== 'PASSWORD_RESET_OTP' &&
    event !== 'CIRCUIT_BREAKER_TRIPPED' &&
    event !== 'MANUAL_ISSUANCE_PENDING_REMINDER'
  );
}
