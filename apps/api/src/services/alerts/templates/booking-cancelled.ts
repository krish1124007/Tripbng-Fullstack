// Booking cancelled — sent when an agency cancels a TICKETED booking.
// The user-facing question is "what's the net cash impact" — refund minus
// any cancellation fee — so we lead with both numbers.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const bookingCancelledTemplate: AlertTemplate = {
  email(payload, branding) {
    if (payload.event !== 'BOOKING_CANCELLED') {
      throw new Error(`bookingCancelledTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const netRefund = v.refundPaise - v.cancellationFeePaise;
    const subject = `Booking ${v.bookingCode} cancelled — ${rs(netRefund)} refunded`;
    const html = emailLayout({
      title: subject,
      preheader: `Cancellation processed. Refund ${rs(netRefund)} credited to your wallet.`,
      branding: branding
        ? {
            companyName: branding.companyName,
            primaryColor: branding.primaryColor,
            primaryForegroundColor: branding.primaryForegroundColor,
            logoPublicUrl: branding.logoPublicUrl,
          }
        : null,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Booking cancelled</h1>
<p style="margin:0 0 16px;color:#475569;">The cancellation has been processed and the refund has been credited to your wallet.</p>
${kvTable([
  ['Booking code', v.bookingCode],
  ['Sector', v.sector],
  ['Travel date', v.travelDate],
  ['Refund amount', rs(v.refundPaise)],
  ['Cancellation fee', v.cancellationFeePaise > 0 ? rs(v.cancellationFeePaise) : 'None'],
  ['Net credited', rs(netRefund)],
])}
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">If the credit doesn't appear in your wallet within 10 minutes, contact support with the booking code above.</p>`,
    });
    const text = [
      `Booking ${v.bookingCode} cancelled.`,
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
    if (payload.event !== 'BOOKING_CANCELLED') {
      throw new Error(`bookingCancelledTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    const netRefund = v.refundPaise - v.cancellationFeePaise;
    return {
      // Meta-approved template: `booking_cancelled`
      // Body params: {{1}} bookingCode, {{2}} sector, {{3}} cancellationFee, {{4}} netRefund
      templateName: 'booking_cancelled',
      bodyParams: [
        v.bookingCode,
        v.sector,
        v.cancellationFeePaise > 0 ? rs(v.cancellationFeePaise) : 'None',
        rs(netRefund),
      ],
    };
  },

  inapp(payload) {
    if (payload.event !== 'BOOKING_CANCELLED') {
      throw new Error(`bookingCancelledTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    const netRefund = v.refundPaise - v.cancellationFeePaise;
    return {
      title: `Booking ${v.bookingCode} cancelled`,
      body: `${v.sector} • ${rs(netRefund)} credited to wallet`,
      type: 'BOOKING_CANCELLED',
      actionUrl: '/bookings',
    };
  },
};
