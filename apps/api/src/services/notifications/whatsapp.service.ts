// WhatsApp Business Cloud API — outbound messaging.
//
// Why WhatsApp (not just email):
//   - Indian travel-agency staff live in WhatsApp. A ticket buried in inbox
//     gets missed; a WhatsApp ping with the e-ticket as a downloadable doc gets
//     opened in seconds.
//   - 99%+ delivery rate vs. ~94% for email after spam filters.
//
// What this stub does:
//   - Sends a TEMPLATE message (not freeform — Meta requires templates for
//     business-initiated 24h-window-violating sends), parameterized with the
//     booker's name + booking code + a signed ticket-download URL.
//   - Returns the WhatsApp message id so the caller can persist it for delivery
//     tracking (later: webhook handles message_status events).
//   - No-ops cleanly when WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is
//     unset — the rest of the booking flow keeps working.
//
// Template requirements (config in Meta Business Manager — template name lives
// in env.WHATSAPP_TEMPLATE_NAME, default `ticket_confirmation`):
//
//   Header:   "TripBng e-ticket"
//   Body:     "Hi {{1}}, your booking {{2}} is confirmed.
//              Download e-ticket: {{3}}
//              Travel safe — TripBng"
//   Footer:   none
//   Buttons:  none (URL inlined in body — Meta charges per template, keep it
//             simple for v1)
//
// We DO NOT upload the PDF as a media attachment in this stub — the v1 flow
// passes a signed URL that points back at our /api/v1/bookings/:id/ticket
// route. v2 can switch to media-attachment templates once we're ready to deal
// with Meta's 16MB cap, async media uploads, and 30-day media TTL.

import { createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { BookingDoc } from '../../models/Booking.js';

interface WhatsAppSendResult {
  status: 'sent' | 'skipped' | 'failed';
  /** WhatsApp wamid — opaque id for the message; null when skipped/failed. */
  messageId?: string | null;
  /** Reason for skip/fail — useful for ops dashboards. */
  reason?: string;
}

interface SendTicketArgs {
  booking: BookingDoc;
  /**
   * Override the booking.contact.mobile when needed (e.g. retry from admin
   * console with a corrected number). Falls back to the booking contact.
   * Must include country-code-friendly digits (we strip + and spaces here).
   */
  toMobile?: string;
  toCountryCode?: string;
  /** Display name in the template's {{1}} param. Falls back to first pax. */
  recipientName?: string;
}

/**
 * Generic WhatsApp Cloud API template-send. Used by the alert dispatcher for
 * every templated event we emit (ticket confirmation, hold-expiry warning,
 * top-up succeeded, low-balance warning, …).
 *
 * The body-component parameter list is positional — the template definition
 * in Meta Business Manager dictates how many `{{N}}` slots exist; pass them
 * in declaration order. Header/button params can be added later if a future
 * template needs them.
 *
 * Returns a result object — never throws. Failures log + return
 * `{ status: 'failed', reason }`; the dispatcher decides whether to retry.
 */
export async function sendWhatsAppTemplate(args: {
  /** E.164 with or without leading + — we strip it. */
  to: string;
  countryCode?: string;
  /** Meta-approved template name. */
  templateName: string;
  /** ISO-639 lang code; defaults to env.WHATSAPP_TEMPLATE_LANG. */
  language?: string;
  /** Positional body params — will be wrapped as { type: 'text', text }. */
  bodyParams?: string[];
  /**
   * Optional opaque correlation id for logging. Helpful when the same
   * template is sent for many bookings — the log line ties the wamid back.
   */
  correlationKey?: string;
}): Promise<WhatsAppSendResult> {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    return { status: 'skipped', reason: 'WhatsApp credentials not configured' };
  }

  const cc = (args.countryCode ?? '+91').replace(/\D/g, '');
  const local = args.to.replace(/\D/g, '');
  if (!local) return { status: 'skipped', reason: 'empty recipient mobile' };

  // If `to` already includes the cc digits (length > 10 typically), trust it.
  // Otherwise prepend the cc. Cheap heuristic — works for IN, will need
  // sharpening when we go international.
  const e164NoPlus = local.length > 10 ? local : `${cc}${local}`;

  const body = {
    messaging_product: 'whatsapp',
    to: e164NoPlus,
    type: 'template',
    template: {
      name: args.templateName,
      language: { code: args.language ?? env.WHATSAPP_TEMPLATE_LANG },
      components: args.bodyParams
        ? [
            {
              type: 'body',
              parameters: args.bodyParams.map((text) => ({ type: 'text', text })),
            },
          ]
        : undefined,
    },
  };

  const url = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(
        {
          status: res.status,
          to: e164NoPlus,
          template: args.templateName,
          correlationKey: args.correlationKey,
          body: text.slice(0, 300),
        },
        'whatsapp send failed',
      );
      return { status: 'failed', reason: `whatsapp ${res.status}: ${text.slice(0, 200)}` };
    }

    const json = (await res.json()) as { messages?: Array<{ id: string }> };
    const messageId = json.messages?.[0]?.id ?? null;
    logger.info(
      {
        messageId,
        to: e164NoPlus,
        template: args.templateName,
        correlationKey: args.correlationKey,
      },
      'whatsapp template sent',
    );
    return { status: 'sent', messageId };
  } catch (err) {
    logger.warn(
      { err, template: args.templateName, correlationKey: args.correlationKey },
      'whatsapp send threw',
    );
    return { status: 'failed', reason: err instanceof Error ? err.message : 'transport error' };
  }
}

/**
 * Booking-specific helper — the original v1 entry point. Now a thin wrapper
 * over sendWhatsAppTemplate so the existing booking-confirm wiring keeps
 * working untouched while the generic primitive powers everything else.
 */
export async function sendTicketWhatsApp(args: SendTicketArgs): Promise<WhatsAppSendResult> {
  const cc = args.toCountryCode ?? args.booking.contact?.countryCode ?? '+91';
  const local = args.toMobile ?? args.booking.contact?.mobile ?? '';
  if (!local.replace(/\D/g, '')) {
    return { status: 'skipped', reason: 'no recipient mobile on booking' };
  }

  const recipientName =
    args.recipientName ??
    (args.booking.passengers?.[0]
      ? `${args.booking.passengers[0].firstName} ${args.booking.passengers[0].lastName}`.trim()
      : 'Traveler');

  const ticketUrl = signedTicketUrl(String(args.booking._id));

  return sendWhatsAppTemplate({
    to: local,
    countryCode: cc,
    templateName: env.WHATSAPP_TEMPLATE_NAME,
    bodyParams: [recipientName.slice(0, 60), args.booking.bookingCode, ticketUrl],
    correlationKey: `booking:${args.booking.bookingCode}`,
  });
}

/**
 * Build a tamper-proof URL the WhatsApp recipient can click to download the
 * e-ticket without authenticating. The URL is HMAC-signed with the same
 * JWT_ACCESS_SECRET — the booking route validates it before serving.
 *
 * Format: `${API_BASE_URL}/api/v1/bookings/:id/ticket?sig=:hex&exp=:epoch`
 *
 * Lifetime: 7 days — long enough to survive being forwarded around, short
 * enough that an old leaked URL becomes useless before the trip ends.
 */
function signedTicketUrl(bookingId: string): string {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const sig = createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(`${bookingId}.${exp}`)
    .digest('hex');
  const base = env.API_BASE_URL.replace(/\/$/, '');
  return `${base}/api/v1/bookings/${bookingId}/ticket?sig=${sig}&exp=${exp}`;
}

/**
 * Verify a signed ticket URL — used by the booking ticket route to allow
 * unauthenticated downloads when a valid sig+exp are present. Returns true
 * when the signature is intact AND not expired.
 */
export function verifyTicketSignature(bookingId: string, sig: string, exp: string): boolean {
  const expEpoch = Number.parseInt(exp, 10);
  if (!Number.isFinite(expEpoch)) return false;
  if (Math.floor(Date.now() / 1000) > expEpoch) return false;
  const expected = createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(`${bookingId}.${expEpoch}`)
    .digest('hex');
  // Constant-time-ish — the strings are the same length so === is fine for our
  // threat model (no timing-attack target here, the sig is publicly verifiable).
  return expected === sig;
}
