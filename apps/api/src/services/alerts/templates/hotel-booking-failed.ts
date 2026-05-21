// Hotel booking failed — sent to the booker (and the agency owner) when:
//   - TBO Book transport fails (timeout, 5xx, parse error)
//   - TBO Book returns Status=2/5
//   - PendingPoll resolves PENDING_SUPPLIER → SUPPLIER_FAILED / CANCELLED
//
// Wallet was already debited; the refund happens (or should — see open
// items in Phase 3) automatically. The alert tells the booker not to
// panic about the deduction.
//
// Channels: email + in-app. WhatsApp skipped — booking failures are
// nuanced (refund timing varies by failure cause) and we'd rather have the
// detailed copy in the inbox than a stripped-down WA template.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { brandingForLayout, emailLayout, kvTable } from './_layout.js';

export const hotelBookingFailedTemplate: AlertTemplate = {
  email(payload, branding) {
    if (payload.event !== 'HOTEL_BOOKING_FAILED') {
      throw new Error(`hotelBookingFailedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Booking failed: ${v.hotelName} — refund initiated`;
    const html = emailLayout({
      title: subject,
      preheader: `We couldn't confirm your booking at ${v.hotelName}. Wallet has been refunded.`,
      branding: brandingForLayout(branding),
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#b91c1c;">Booking could not be confirmed</h1>
<p style="margin:0 0 16px;color:#475569;">The supplier didn't return a confirmation for this booking. We've automatically refunded the full amount to your wallet.</p>
${kvTable([
  ['Hotel', v.hotelName],
  ['City', v.city ?? '—'],
  ['Check-in', v.checkIn],
  ['Check-out', v.checkOut],
  ['Amount refunded', rs(v.totalSellingPaise)],
  ['Reason', v.failureReason ?? 'Supplier did not return a confirmation'],
])}
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">If the refund doesn't appear in your wallet within 10 minutes, contact support with the booking reference above.</p>`,
    });
    const text = [
      `Booking at ${v.hotelName} could not be confirmed.`,
      `Amount refunded: ${rs(v.totalSellingPaise)}`,
      `Reason: ${v.failureReason ?? 'supplier did not return a confirmation'}`,
      ``,
      `If the refund doesn't appear within 10 minutes, contact support.`,
      `— TripBng`,
    ].join('\n');
    return { subject, html, text };
  },

  inapp(payload) {
    if (payload.event !== 'HOTEL_BOOKING_FAILED') {
      throw new Error(`hotelBookingFailedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Booking failed: ${v.hotelName}`,
      body: `${v.checkIn} → ${v.checkOut} • ${rs(v.totalSellingPaise)} refunded${v.failureReason ? ` • ${v.failureReason}` : ''}`,
      type: 'HOTEL_BOOKING_FAILED',
      actionUrl: v.detailUrl ?? `/bookings/${v.bookingId}`,
    };
  },
};
