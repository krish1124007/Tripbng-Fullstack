import { z } from 'zod';

export const NOTIFICATION_CHANNEL = ['IN_APP', 'EMAIL', 'SMS', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[number];

export const NOTIFICATION_CATEGORY = [
  'TRANSACTIONAL', // booking confirmed, ticket issued, refund processed
  'OPERATIONAL', // top-up approved, KYC verified
  'PROMOTIONAL', // banners, offers
  'ALERT', // low wallet, dormant warning, security
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORY)[number];

export const NOTIFICATION_PRIORITY = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITY)[number];

export const PublicNotificationSchema = z.object({
  id: z.string(),
  category: z.enum(NOTIFICATION_CATEGORY),
  channel: z.enum(NOTIFICATION_CHANNEL),
  priority: z.enum(NOTIFICATION_PRIORITY),
  title: z.string(),
  body: z.string(),
  href: z.string().nullable(),
  read: z.boolean(),
  readAt: z.string().datetime().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type PublicNotification = z.infer<typeof PublicNotificationSchema>;

export const NotificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.coerce.boolean().default(false),
  category: z.enum(NOTIFICATION_CATEGORY).optional(),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

// ───────── Per-agency notification preferences ─────────
//
// The alert system uses these prefs to decide which channels fire for each
// event. Hierarchy at dispatch time:
//   1. Start with the global default channel set for the event (router.ts).
//   2. If the agency has an event-level override in `events`, replace the
//      default with the override.
//   3. Filter the resulting set through `channels` master switches — if
//      `channels.email` is false, no email send happens for that agency
//      regardless of event-level config.
//
// Defaults: every channel ON, no event overrides. New agencies pick up the
// global default behaviour without explicit configuration.

export const ALERT_EVENT_NAME = [
  'BOOKING_CONFIRMED',
  'BOOKING_FAILED',
  'BOOKING_CANCELLED',
  'TOPUP_SUCCEEDED',
  'TOPUP_FAILED',
  'HOLD_EXPIRY_WARNING',
  'LOW_WALLET_BALANCE',
  'INSURANCE_ISSUED',
  'MANUAL_TOPUP_APPROVED',
  'MANUAL_TOPUP_REJECTED',
  'LOGIN_NEW_DEVICE',
  'HOTEL_BOOKING_AWAITS_APPROVAL',
  'HOTEL_BOOKING_APPROVED',
  'HOTEL_BOOKING_REJECTED',
  'HOTEL_BOOKING_CONFIRMED',
  'HOTEL_BOOKING_FAILED',
  'HOTEL_BOOKING_CANCELLED',
  // PASSWORD_RESET_OTP is intentionally NOT user-configurable —
  // OTPs always go out so account recovery never breaks.
  // CIRCUIT_BREAKER_TRIPPED is ops-only — no agency-level config either.
] as const;
export type AlertEventName = (typeof ALERT_EVENT_NAME)[number];

export const ALERT_CHANNEL_NAME = ['email', 'whatsapp', 'inapp'] as const;
export type AlertChannelName = (typeof ALERT_CHANNEL_NAME)[number];

export const NotificationPrefsSchema = z.object({
  /** Master switches per channel — false here disables that channel
   *  entirely for this agency, regardless of event-level config. */
  channels: z.object({
    email: z.boolean(),
    whatsapp: z.boolean(),
    inapp: z.boolean(),
  }),
  /** Per-event channel set. Missing entries fall back to global defaults. */
  events: z.record(z.enum(ALERT_EVENT_NAME), z.array(z.enum(ALERT_CHANNEL_NAME))),
  /** Custom low-balance threshold (paise). Null = use the global default
   *  (env.LOW_WALLET_THRESHOLD_PAISE). */
  lowBalanceThresholdPaise: z.number().int().nonnegative().nullable(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

/** Update payload — every field optional so partial updates are clean. */
export const UpdateNotificationPrefsSchema = z.object({
  channels: z
    .object({
      email: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
      inapp: z.boolean().optional(),
    })
    .optional(),
  events: z
    .record(z.enum(ALERT_EVENT_NAME), z.array(z.enum(ALERT_CHANNEL_NAME)))
    .optional(),
  lowBalanceThresholdPaise: z.number().int().nonnegative().nullable().optional(),
});
export type UpdateNotificationPrefs = z.infer<typeof UpdateNotificationPrefsSchema>;

/** Defaults applied when an agency has no explicit prefs. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  channels: { email: true, whatsapp: true, inapp: true },
  events: {},
  lowBalanceThresholdPaise: null,
};
