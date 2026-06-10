// Hotel booking approved — sent to the original booker after the manager
// approves a flagged booking. The actual TBO Book call kicks off
// automatically; this alert is the "manager said yes" signal.
//
// Channels: email + in-app + WhatsApp (decision is good news worth pushing
// to the channel the booker is most likely watching).

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { brandingForLayout, emailLayout, kvTable } from './_layout.js';

export const hotelBookingApprovedTemplate: AlertTemplate = {
  email(payload, branding) {
    if (payload.event !== 'HOTEL_BOOKING_APPROVED') {
      throw new Error(`hotelBookingApprovedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Approved: ${v.hotelName} — booking proceeding`;
    const html = emailLayout({
      title: subject,
      preheader: `Your booking for ${v.hotelName} was approved by ${v.decidedBy ?? 'your manager'}.`,
      branding: brandingForLayout(branding),
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Booking approved</h1>
<p style="margin:0 0 16px;color:#475569;">${v.decidedBy ?? 'Your manager'} approved your booking. We're confirming it with the supplier now — you'll get a separate confirmation once the e-voucher is issued.</p>
${kvTable([
  ['Hotel', v.hotelName],
  ['City', v.city ?? '—'],
  ['Check-in', v.checkIn],
  ['Check-out', v.checkOut],
  ['Total', rs(v.totalSellingPaise)],
  ['Approved by', v.decidedBy ?? '—'],
  ['Note', v.decisionNote ?? '—'],
])}`,
    });
    const text = [
      `Booking approved by ${v.decidedBy ?? 'your manager'}.`,
      `Hotel: ${v.hotelName}${v.city ? ` (${v.city})` : ''}`,
      `Check-in: ${v.checkIn} → ${v.checkOut}`,
      `Total: ${rs(v.totalSellingPaise)}`,
      v.decisionNote ? `Note: ${v.decisionNote}` : null,
      ``,
      `We're confirming with the supplier — separate confirmation to follow.`,
      `— TripBng`,
    ]
      .filter(Boolean)
      .join('\n');
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (payload.event !== 'HOTEL_BOOKING_APPROVED') {
      throw new Error(`hotelBookingApprovedTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      // Meta-approved template: `hotel_booking_approved`
      // Body params: {{1}} hotelName, {{2}} dates, {{3}} decidedBy
      templateName: 'hotel_booking_approved',
      bodyParams: [v.hotelName, `${v.checkIn} – ${v.checkOut}`, v.decidedBy ?? 'manager'],
    };
  },

  inapp(payload) {
    if (payload.event !== 'HOTEL_BOOKING_APPROVED') {
      throw new Error(`hotelBookingApprovedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Approved: ${v.hotelName}`,
      body: `${rs(v.totalSellingPaise)} • approved by ${v.decidedBy ?? 'manager'}; ticketing now`,
      type: 'HOTEL_BOOKING_APPROVED',
      actionUrl: v.detailUrl ?? `/bookings/${v.bookingId}`,
    };
  },
};
