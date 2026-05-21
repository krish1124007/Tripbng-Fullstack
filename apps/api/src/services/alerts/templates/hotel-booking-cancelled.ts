// Hotel booking cancelled — sent when TBO's GetChangeRequestStatus returns
// Processed (3) and the wallet refund has been credited.
//
// Channels: email + WhatsApp + in-app. Cancellation refunds are the
// highest-anxiety question for travel users ("did my money come back?") —
// confirmation in two channels is worth the WA template-fatigue tax.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { brandingForLayout, emailLayout, kvTable } from './_layout.js';

export const hotelBookingCancelledTemplate: AlertTemplate = {
  email(payload, branding) {
    if (payload.event !== 'HOTEL_BOOKING_CANCELLED') {
      throw new Error(`hotelBookingCancelledTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const netRefund = v.refundPaise - v.cancellationFeePaise;
    const subject = `Cancellation processed: ${v.hotelName} — ${rs(netRefund)} refunded`;
    const html = emailLayout({
      title: subject,
      preheader: `Cancellation confirmed. Refund ${rs(netRefund)} credited to your wallet.`,
      branding: brandingForLayout(branding),
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Cancellation processed</h1>
<p style="margin:0 0 16px;color:#475569;">The supplier has processed your cancellation. The refund has been credited to your wallet.</p>
${kvTable([
  ['Hotel', v.hotelName],
  ['City', v.city ?? '—'],
  ['Check-in', v.checkIn],
  ['Check-out', v.checkOut],
  ['Original total', rs(v.totalSellingPaise)],
  ['Cancellation fee', v.cancellationFeePaise > 0 ? rs(v.cancellationFeePaise) : 'None'],
  ['Refund amount', rs(v.refundPaise)],
  ['Net credited', rs(netRefund)],
])}
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">If the credit doesn't appear in your wallet within 10 minutes, contact support with the booking reference above.</p>`,
    });
    const text = [
      `Cancellation processed for ${v.hotelName}.`,
      `Refund: ${rs(v.refundPaise)}`,
      v.cancellationFeePaise > 0 ? `Cancellation fee: ${rs(v.cancellationFeePaise)}` : null,
      `Net credited: ${rs(netRefund)}`,
      ``,
      `If the credit doesn't appear within 10 minutes, contact support.`,
      `— TripBng`,
    ]
      .filter(Boolean)
      .join('\n');
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (payload.event !== 'HOTEL_BOOKING_CANCELLED') {
      throw new Error(`hotelBookingCancelledTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    const netRefund = v.refundPaise - v.cancellationFeePaise;
    return {
      // Meta-approved template: `hotel_booking_cancelled`
      // Body params: {{1}} hotelName, {{2}} dates, {{3}} fee, {{4}} netRefund
      templateName: 'hotel_booking_cancelled',
      bodyParams: [
        v.hotelName,
        `${v.checkIn} – ${v.checkOut}`,
        v.cancellationFeePaise > 0 ? rs(v.cancellationFeePaise) : 'None',
        rs(netRefund),
      ],
    };
  },

  inapp(payload) {
    if (payload.event !== 'HOTEL_BOOKING_CANCELLED') {
      throw new Error(`hotelBookingCancelledTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    const netRefund = v.refundPaise - v.cancellationFeePaise;
    return {
      title: `Cancelled: ${v.hotelName}`,
      body: `${rs(netRefund)} credited${v.cancellationFeePaise > 0 ? ` (after ${rs(v.cancellationFeePaise)} fee)` : ''}`,
      type: 'HOTEL_BOOKING_CANCELLED',
      actionUrl: v.detailUrl ?? `/bookings/${v.bookingId}`,
    };
  },
};
