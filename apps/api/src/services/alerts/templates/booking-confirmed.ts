// Booking confirmed — receipt-style email + parameterised WA template.

import type { AlertPayload, AlertTemplate, BookingAlertVars } from '../types.js';
import { rs } from '../types.js';
import { brandingForLayout, ctaButton, emailLayout, kvTable } from './_layout.js';

export const bookingConfirmedTemplate: AlertTemplate = {
  email(payload: AlertPayload, branding) {
    if (payload.event !== 'BOOKING_CONFIRMED') {
      throw new Error(`bookingConfirmedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Booking ${v.bookingCode} confirmed — ${v.sector}`;
    const html = emailLayout({
      title: subject,
      preheader: `Your e-ticket for ${v.sector} on ${v.travelDate} is ready.`,
      branding: brandingForLayout(branding),
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Booking confirmed</h1>
<p style="margin:0 0 16px;color:#475569;">Your booking is ticketed. The e-ticket is available below.</p>
${kvTable([
  ['Booking code', v.bookingCode],
  ['Sector', v.sector],
  ['Travel date', v.travelDate],
  ['Passengers', String(v.paxCount)],
  ['PNR', v.pnr ?? '—'],
  ['Amount paid', rs(v.amountPaise)],
])}
${v.ticketUrl ? ctaButton('Download e-ticket (PDF)', v.ticketUrl, branding ? { primaryColor: branding.primaryColor, primaryForegroundColor: branding.primaryForegroundColor } : null) : ''}
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">Please carry a printed or digital copy of the e-ticket along with valid government ID at the airport.</p>`,
    });
    const text = renderText(v);
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (payload.event !== 'BOOKING_CONFIRMED') {
      throw new Error(`bookingConfirmedTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      // Meta-approved template: `booking_confirmed`
      // Body params: {{1}} bookingCode, {{2}} sector, {{3}} travelDate, {{4}} amount, {{5}} ticketUrl
      templateName: 'booking_confirmed',
      bodyParams: [
        v.bookingCode,
        v.sector,
        v.travelDate,
        rs(v.amountPaise),
        v.ticketUrl ?? '',
      ],
    };
  },

  inapp(payload) {
    if (payload.event !== 'BOOKING_CONFIRMED') {
      throw new Error(`bookingConfirmedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Booking ${v.bookingCode} confirmed`,
      body: `${v.sector} • ${v.travelDate} • ${rs(v.amountPaise)}`,
      type: 'BOOKING_CONFIRMED',
      actionUrl: v.ticketUrl ?? null,
    };
  },
};

function renderText(v: BookingAlertVars): string {
  return [
    `Booking ${v.bookingCode} confirmed.`,
    ``,
    `Sector: ${v.sector}`,
    `Travel date: ${v.travelDate}`,
    `Passengers: ${v.paxCount}`,
    v.pnr ? `PNR: ${v.pnr}` : null,
    `Amount paid: ${rs(v.amountPaise)}`,
    v.ticketUrl ? `\nDownload e-ticket: ${v.ticketUrl}` : null,
    ``,
    `Please carry a printed or digital copy along with valid government ID at the airport.`,
    ``,
    `— TripBng`,
  ]
    .filter(Boolean)
    .join('\n');
}
