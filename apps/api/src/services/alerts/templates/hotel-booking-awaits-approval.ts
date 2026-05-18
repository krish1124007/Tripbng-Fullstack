// Hotel booking awaits approval — sent to the assigned manager when a
// booking is flagged by the corporate-policy gate.
//
// Channels: email + in-app. WhatsApp is intentionally skipped — managers
// usually action approvals from a desk, and Meta template-fatigue here
// would push the user to mute the channel for the higher-volume confirmed-
// booking path.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { ctaButton, emailLayout, kvTable } from './_layout.js';

export const hotelBookingAwaitsApprovalTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'HOTEL_BOOKING_AWAITS_APPROVAL') {
      throw new Error(`hotelBookingAwaitsApprovalTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Approval needed: ${v.hotelName} — ${rs(v.totalSellingPaise)}`;
    const html = emailLayout({
      title: subject,
      preheader: `${v.bookerName ?? 'A team member'} needs your approval to book ${v.hotelName}.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Booking awaiting your approval</h1>
<p style="margin:0 0 16px;color:#475569;">${v.bookerName ?? 'A team member'} requested a booking that's flagged by your travel policy and needs your approval before it can be ticketed.</p>
${kvTable([
  ['Hotel', v.hotelName],
  ['City', v.city ?? '—'],
  ['Check-in', v.checkIn],
  ['Check-out', v.checkOut],
  ['Nights', String(v.nights)],
  ['Total', rs(v.totalSellingPaise)],
  ['Reasons', v.reasons.length > 0 ? v.reasons.join(', ') : 'Above approval threshold'],
])}
${v.detailUrl ? ctaButton('Review & decide', v.detailUrl) : ''}
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">No funds have been debited. The booking is held until you approve or reject.</p>`,
    });
    const text = [
      `Booking awaiting your approval`,
      `Hotel: ${v.hotelName}${v.city ? ` (${v.city})` : ''}`,
      `Check-in: ${v.checkIn}, Check-out: ${v.checkOut}`,
      `Total: ${rs(v.totalSellingPaise)}`,
      `Reasons: ${v.reasons.join(', ')}`,
      v.detailUrl ? `\nReview: ${v.detailUrl}` : null,
      ``,
      `No funds debited until you decide.`,
      `— TripBng`,
    ]
      .filter(Boolean)
      .join('\n');
    return { subject, html, text };
  },

  inapp(payload) {
    if (payload.event !== 'HOTEL_BOOKING_AWAITS_APPROVAL') {
      throw new Error(`hotelBookingAwaitsApprovalTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Approval needed: ${v.hotelName}`,
      body: `${rs(v.totalSellingPaise)} • ${v.checkIn} → ${v.checkOut} • ${v.reasons.join(', ')}`,
      type: 'HOTEL_BOOKING_AWAITS_APPROVAL',
      actionUrl: v.detailUrl ?? `/approvals/${v.bookingId}`,
    };
  },
  // No whatsapp() — see header.
};
