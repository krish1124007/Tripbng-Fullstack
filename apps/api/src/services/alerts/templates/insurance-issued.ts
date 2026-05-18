// Insurance issued — one alert per booking (not per traveler) summarising
// the policy numbers and premium. Email-only by default — insurance is
// post-purchase paperwork, not time-sensitive enough for WA template-fatigue.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { emailLayout, escapeHtml, kvTable } from './_layout.js';

export const insuranceIssuedTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'INSURANCE_ISSUED') {
      throw new Error(`insuranceIssuedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Travel insurance issued — ${v.policyNumbers.length} polic${v.policyNumbers.length === 1 ? 'y' : 'ies'}`;
    const policiesList = v.policyNumbers
      .map((n) => `<li style="margin:4px 0;">${escapeHtml(n)}</li>`)
      .join('');
    const html = emailLayout({
      title: subject,
      preheader: `Your travel insurance from ${v.insurerName} is active.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Travel insurance issued</h1>
<p style="margin:0 0 16px;color:#475569;">Your travel insurance has been issued and is now active.</p>
${kvTable([
  ['Insurer', v.insurerName],
  ['Premium', rs(v.premiumPaise)],
  ['Booking', v.bookingCode ?? '—'],
])}
<p style="margin:16px 0 8px;color:#1a1a1a;font-weight:500;">Policy numbers:</p>
<ul style="margin:0;padding-left:20px;color:#1a1a1a;">${policiesList}</ul>
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">Download the policy PDFs from your dashboard. Carry a printed or digital copy when you travel.</p>`,
    });
    const text = [
      `Travel insurance issued — ${v.policyNumbers.length} polic${v.policyNumbers.length === 1 ? 'y' : 'ies'}.`,
      `Insurer: ${v.insurerName}`,
      `Premium: ${rs(v.premiumPaise)}`,
      v.bookingCode ? `Booking: ${v.bookingCode}` : null,
      ``,
      `Policy numbers:`,
      ...v.policyNumbers.map((n) => `  - ${n}`),
      ``,
      `Download the policy PDFs from your dashboard.`,
      `— TripBng`,
    ]
      .filter(Boolean)
      .join('\n');
    return { subject, html, text };
  },

  inapp(payload) {
    if (payload.event !== 'INSURANCE_ISSUED') {
      throw new Error(`insuranceIssuedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Insurance issued — ${v.insurerName}`,
      body: `${v.policyNumbers.length} polic${v.policyNumbers.length === 1 ? 'y' : 'ies'} • ${rs(v.premiumPaise)}`,
      type: 'INSURANCE_ISSUED',
      actionUrl: '/insurance',
    };
  },
  // No whatsapp() — paperwork goes via email.
};
