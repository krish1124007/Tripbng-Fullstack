// Top-up failed — gateway returned a failure or the session timed out.
// We don't send WhatsApp here in v1: failures are an in-app dashboard signal,
// and we don't want to spam users with template-fatigue messages.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const topupFailedTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'TOPUP_FAILED') {
      throw new Error(`topupFailedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Top-up failed: ${rs(v.amountPaise)}`;
    const html = emailLayout({
      title: subject,
      preheader: `Your top-up of ${rs(v.amountPaise)} did not complete.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#b91c1c;">Top-up did not complete</h1>
<p style="margin:0 0 16px;color:#475569;">Your wallet was not charged. You can retry the top-up from your dashboard.</p>
${kvTable([
  ['Transaction', v.txnCode],
  ['Amount', rs(v.amountPaise)],
  ['Provider', v.provider],
  ['Reason', v.failureReason ?? 'gateway did not confirm payment'],
])}
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">If your bank account was debited but the wallet wasn't credited, contact support with the transaction code above. Bank-side reconciliation typically completes within 24 hours.</p>`,
    });
    const text = [
      `Top-up of ${rs(v.amountPaise)} failed.`,
      `Transaction: ${v.txnCode}`,
      `Provider: ${v.provider}`,
      `Reason: ${v.failureReason ?? 'gateway did not confirm payment'}`,
      ``,
      `If your bank was debited, contact support — reconciliation completes within 24 hours.`,
      `— TripBng`,
    ].join('\n');
    return { subject, html, text };
  },

  inapp(payload) {
    if (payload.event !== 'TOPUP_FAILED') {
      throw new Error(`topupFailedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Top-up failed: ${rs(v.amountPaise)}`,
      body: `${v.txnCode} (${v.failureReason ?? 'gateway error'})`,
      type: 'TOPUP_FAILED',
      actionUrl: '/wallet',
    };
  },

  // No whatsapp() — by design.
};
