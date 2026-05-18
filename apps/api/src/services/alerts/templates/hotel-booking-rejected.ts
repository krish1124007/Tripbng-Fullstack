// Hotel booking rejected — sent to the original booker after the manager
// rejects a flagged booking. Terminal — the booking row stays as
// BOOK_FAILED and the booker would need to re-PreBook + re-submit.
//
// Channels: email + in-app. WhatsApp skipped — rejection is sensitive
// information you'd rather have in a channel where it can be reviewed
// in context, not pushed to a phone notification.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const hotelBookingRejectedTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'HOTEL_BOOKING_REJECTED') {
      throw new Error(`hotelBookingRejectedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Booking declined: ${v.hotelName}`;
    const html = emailLayout({
      title: subject,
      preheader: `${v.decidedBy ?? 'Your manager'} declined your booking request for ${v.hotelName}.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#b91c1c;">Booking declined</h1>
<p style="margin:0 0 16px;color:#475569;">${v.decidedBy ?? 'Your manager'} declined your booking request. No funds were debited.</p>
${kvTable([
  ['Hotel', v.hotelName],
  ['City', v.city ?? '—'],
  ['Check-in', v.checkIn],
  ['Check-out', v.checkOut],
  ['Total', rs(v.totalSellingPaise)],
  ['Declined by', v.decidedBy ?? '—'],
  ['Reason', v.decisionNote ?? 'Not specified'],
])}
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">If you'd like to revise the booking (different hotel, dates, or rate), start a new search. The original supplier offer may have a short shelf-life.</p>`,
    });
    const text = [
      `Booking declined by ${v.decidedBy ?? 'your manager'}.`,
      `Hotel: ${v.hotelName}${v.city ? ` (${v.city})` : ''}`,
      `Check-in: ${v.checkIn} → ${v.checkOut}`,
      `Total: ${rs(v.totalSellingPaise)}`,
      `Reason: ${v.decisionNote ?? 'not specified'}`,
      ``,
      `No funds debited. Start a new search to try again.`,
      `— TripBng`,
    ].join('\n');
    return { subject, html, text };
  },

  inapp(payload) {
    if (payload.event !== 'HOTEL_BOOKING_REJECTED') {
      throw new Error(`hotelBookingRejectedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Declined: ${v.hotelName}`,
      body: `${v.decidedBy ?? 'Manager'} declined • ${v.decisionNote ?? 'see email for details'}`,
      type: 'HOTEL_BOOKING_REJECTED',
      actionUrl: v.detailUrl ?? `/bookings/${v.bookingId}`,
    };
  },
};
