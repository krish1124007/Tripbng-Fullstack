// Hotel booking confirmed — sent to the booker + booking_contact when:
//   - TBO returns VoucherStatus=true on the original /book call (one-shot
//     confirmation), OR
//   - the voucher worker successfully turns a HELD booking into VOUCHERED, OR
//   - the pending-poll worker resolves a PENDING_SUPPLIER booking to confirmed.
//
// Channels: email + WhatsApp + in-app — confirmation is high-value, the
// guest will want to see the voucher number in their phone notifications.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { ctaButton, emailLayout, kvTable } from './_layout.js';

export const hotelBookingConfirmedTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'HOTEL_BOOKING_CONFIRMED') {
      throw new Error(`hotelBookingConfirmedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Booking confirmed: ${v.hotelName} — ${v.checkIn}`;
    const html = emailLayout({
      title: subject,
      preheader: `${v.hotelName}, ${v.nights} night${v.nights === 1 ? '' : 's'} from ${v.checkIn}.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Booking confirmed</h1>
<p style="margin:0 0 16px;color:#475569;">Your hotel booking is confirmed and the e-voucher is ready.</p>
${kvTable([
  ['Hotel', v.hotelName],
  ['City', v.city ?? '—'],
  ['Check-in', v.checkIn],
  ['Check-out', v.checkOut],
  ['Nights', String(v.nights)],
  ['Confirmation', v.confirmationNo ?? '—'],
  ['Total paid', rs(v.totalSellingPaise)],
])}
${v.detailUrl ? ctaButton('View booking', v.detailUrl) : ''}
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">Carry a printed or digital copy of the e-voucher along with valid government ID at check-in.</p>`,
    });
    const text = [
      `Booking confirmed at ${v.hotelName}.`,
      `Check-in: ${v.checkIn} → ${v.checkOut} (${v.nights} night${v.nights === 1 ? '' : 's'})`,
      v.confirmationNo ? `Confirmation: ${v.confirmationNo}` : null,
      `Total paid: ${rs(v.totalSellingPaise)}`,
      v.detailUrl ? `\nView booking: ${v.detailUrl}` : null,
      ``,
      `Carry a printed or digital copy of the e-voucher with valid government ID at check-in.`,
      `— TripBng`,
    ]
      .filter(Boolean)
      .join('\n');
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (payload.event !== 'HOTEL_BOOKING_CONFIRMED') {
      throw new Error(`hotelBookingConfirmedTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      // Meta-approved template: `hotel_booking_confirmed`
      // Body params: {{1}} hotelName, {{2}} dates, {{3}} confirmationNo, {{4}} amount
      templateName: 'hotel_booking_confirmed',
      bodyParams: [
        v.hotelName,
        `${v.checkIn} – ${v.checkOut}`,
        v.confirmationNo ?? '—',
        rs(v.totalSellingPaise),
      ],
    };
  },

  inapp(payload) {
    if (payload.event !== 'HOTEL_BOOKING_CONFIRMED') {
      throw new Error(`hotelBookingConfirmedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Confirmed: ${v.hotelName}`,
      body: `${v.checkIn} → ${v.checkOut} • ${rs(v.totalSellingPaise)}${v.confirmationNo ? ` • ${v.confirmationNo}` : ''}`,
      type: 'HOTEL_BOOKING_CONFIRMED',
      actionUrl: v.detailUrl ?? `/bookings/${v.bookingId}`,
    };
  },
};
