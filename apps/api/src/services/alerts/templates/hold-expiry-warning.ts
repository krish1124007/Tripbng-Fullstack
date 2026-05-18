// Hold-expiry warning — fires N minutes before a HOLD's expiresAt. Channels
// default to WhatsApp + in-app only: it's a time-sensitive nudge, email is
// too slow to be actionable.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const holdExpiryWarningTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'HOLD_EXPIRY_WARNING') {
      throw new Error(`holdExpiryWarningTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Hold expiring in ${v.minutesRemaining} min — ${v.bookingCode}`;
    const html = emailLayout({
      title: subject,
      preheader: `Confirm soon to avoid losing your fare lock.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#b45309;">Hold expiring soon</h1>
<p style="margin:0 0 16px;color:#475569;">Your booking hold expires in <strong>${v.minutesRemaining} minutes</strong>. Confirm now to keep the fare locked.</p>
${kvTable([
  ['Booking code', v.bookingCode],
  ['Sector', v.sector],
  ['Expires at', v.expiresAt],
])}`,
    });
    const text = [
      `Hold for ${v.bookingCode} expires in ${v.minutesRemaining} minutes.`,
      `Sector: ${v.sector}`,
      `Confirm now to keep the fare locked.`,
      `— TripBng`,
    ].join('\n');
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (payload.event !== 'HOLD_EXPIRY_WARNING') {
      throw new Error(`holdExpiryWarningTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      // Meta-approved template: `hold_expiry_warning`
      // Body params: {{1}} bookingCode, {{2}} sector, {{3}} minutesRemaining
      templateName: 'hold_expiry_warning',
      bodyParams: [v.bookingCode, v.sector, String(v.minutesRemaining)],
    };
  },

  inapp(payload) {
    if (payload.event !== 'HOLD_EXPIRY_WARNING') {
      throw new Error(`holdExpiryWarningTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Hold expiring in ${v.minutesRemaining} min`,
      body: `${v.bookingCode} • ${v.sector} — confirm before ${v.expiresAt}`,
      type: 'HOLD_EXPIRY_WARNING',
      actionUrl: `/bookings`,
    };
  },
};
