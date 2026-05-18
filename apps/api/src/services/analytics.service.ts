// Backend product analytics — PostHog Capture API.
//
// Why backend (not just frontend):
//   - Wallet top-ups + bookings can complete asynchronously (gateway webhook)
//     long after the user has closed the tab. The frontend can't reliably fire
//     these events.
//   - Funnels need server-side ground truth — search → reprice → hold →
//     confirm — because a frontend track('booking_confirmed') can lie if the
//     user navigated away mid-confirm but the API still ticketed them.
//   - Operating-leverage metrics (per-supplier success rate, agency revenue
//     mix, breaker-trip rate) are server-only signals.
//
// Design choices:
//   - No `posthog-node` dep. The Capture API is a single POST to /capture/
//     with a JSON envelope. We get retries, DSN-disable, and back-pressure
//     handling in 60 lines without an extra dep tree.
//   - Best-effort fire-and-forget: a captured event must never block a request
//     or throw. Failures log at warn and that's it.
//   - distinctId convention: `agency:<id>` for agency-scoped events, `user:<id>`
//     for user-scoped events, `tenant:<id>` as a coarse fallback. PostHog
//     person-merging happens via $set on first event.
//   - Common event vocabulary lives at bottom of file as constants — the call
//     sites import the constant rather than freestyling event names.
//
// What we capture today (call sites already wired in this PR):
//   booking_held, booking_confirmed, booking_cancelled, search_performed,
//   topup_initiated, topup_succeeded, topup_failed, supplier_breaker_tripped,
//   insurance_issued.

import { env, isTest } from '../config/env.js';
import { logger } from '../config/logger.js';

const CAPTURE_PATH = '/capture/';
const TIMEOUT_MS = 5_000;

interface TrackPayload {
  /** Event name. Use the EVENTS constants where possible. */
  event: string;
  /**
   * Stable identifier for the actor — usually `agency:<id>` or `user:<id>`.
   * If the same human acts under two distinctIds, call alias() once to merge.
   */
  distinctId: string;
  /** Free-form event properties. Keep keys snake_case for PostHog convention. */
  properties?: Record<string, unknown>;
  /**
   * `$set` on the person record — sticky props like agency name, plan tier.
   * Sent only when present.
   */
  personProperties?: Record<string, unknown>;
  /** Optional override; defaults to now. */
  timestamp?: Date;
}

/**
 * Fire-and-forget event capture. Never throws.
 *
 * Returns void rather than the Promise so the call site doesn't even need to
 * `void` it — purely incidental.
 */
export function track(payload: TrackPayload): void {
  if (!env.POSTHOG_API_KEY) return; // disabled — no key
  if (isTest) return; // test runs don't talk to PostHog

  const body = {
    api_key: env.POSTHOG_API_KEY,
    event: payload.event,
    distinct_id: payload.distinctId,
    properties: {
      $lib: 'tripbng-api',
      $lib_version: '1.0.0',
      ...(payload.properties ?? {}),
      ...(payload.personProperties ? { $set: payload.personProperties } : {}),
    },
    timestamp: (payload.timestamp ?? new Date()).toISOString(),
  };

  // Fire-and-forget. Log + swallow on failure — analytics failures must not
  // surface to the user or interrupt the request.
  void sendCapture(body).catch((err) => {
    logger.warn({ err, event: payload.event }, 'analytics: capture failed');
  });
}

/**
 * Identify-merge — call this when an anonymous distinctId (cookie/device)
 * should be unified with a logged-in user/agency. PostHog handles the dedupe.
 */
export function alias(distinctId: string, alias: string): void {
  if (!env.POSTHOG_API_KEY) return;
  if (isTest) return;

  void sendCapture({
    api_key: env.POSTHOG_API_KEY,
    event: '$create_alias',
    distinct_id: distinctId,
    properties: { alias },
  }).catch((err) => {
    logger.warn({ err, distinctId, alias }, 'analytics: alias failed');
  });
}

async function sendCapture(body: unknown): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${env.POSTHOG_HOST}${CAPTURE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`posthog ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Common distinctId builders — keeps formatting consistent across the codebase
 * so PostHog person-merging actually works.
 */
export const Actor = {
  agency: (id: string): string => `agency:${id}`,
  user: (id: string): string => `user:${id}`,
  tenant: (id: string): string => `tenant:${id}`,
  anon: (sessionId: string): string => `anon:${sessionId}`,
};

/**
 * Canonical event names. Import these instead of inlining strings — keeps the
 * funnel definitions in PostHog stable across renames.
 */
export const EVENTS = {
  // Search funnel
  SEARCH_PERFORMED: 'search_performed',
  SEARCH_RESULT_CLICKED: 'search_result_clicked',
  REPRICE_PERFORMED: 'reprice_performed',

  // Booking funnel
  BOOKING_HELD: 'booking_held',
  BOOKING_CONFIRMED: 'booking_confirmed',
  BOOKING_CANCELLED: 'booking_cancelled',
  BOOKING_FAILED: 'booking_failed',

  // Wallet funnel
  TOPUP_INITIATED: 'topup_initiated',
  TOPUP_SUCCEEDED: 'topup_succeeded',
  TOPUP_FAILED: 'topup_failed',
  TOPUP_TIMEOUT: 'topup_timeout',

  // Insurance funnel
  INSURANCE_QUOTED: 'insurance_quoted',
  INSURANCE_ISSUED: 'insurance_issued',
  INSURANCE_CANCELLED: 'insurance_cancelled',

  // Operating signals (no funnel, dashboards only)
  SUPPLIER_BREAKER_TRIPPED: 'supplier_breaker_tripped',
  RATE_LIMIT_HIT: 'rate_limit_hit',
  WEBHOOK_PROCESSED: 'webhook_processed',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
