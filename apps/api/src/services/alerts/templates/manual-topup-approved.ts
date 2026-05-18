// Manual top-up approved — admin (distributor or super-admin) approved a
// pending bank-transfer / cheque top-up request. Wallet has been credited.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const manualTopupApprovedTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'MANUAL_TOPUP_APPROVED') {
      throw new Error(`manualTopupApprovedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Top-up approved: ${rs(v.amountPaise)} credited`;
    const html = emailLayout({
      title: subject,
      preheader: `Your manual top-up has been approved and credited to your wallet.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Top-up approved</h1>
<p style="margin:0 0 16px;color:#475569;">Your manual top-up request has been verified by ${v.decidedBy} and the amount has been credited to your wallet.</p>
${kvTable([
  ['Transaction', v.txnCode],
  ['Amount credited', rs(v.amountPaise)],
  ['Approved by', v.decidedBy],
])}`,
    });
    const text = [
      `Manual top-up approved.`,
      `Transaction: ${v.txnCode}`,
      `Amount credited: ${rs(v.amountPaise)}`,
      `Approved by: ${v.decidedBy}`,
      `— TripBng`,
    ].join('\n');
    return { subject, html, text };
  },

  inapp(payload) {
    if (payload.event !== 'MANUAL_TOPUP_APPROVED') {
      throw new Error(`manualTopupApprovedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Top-up approved: ${rs(v.amountPaise)}`,
      body: `${v.txnCode} approved by ${v.decidedBy}`,
      type: 'MANUAL_TOPUP_APPROVED',
      actionUrl: '/wallet',
    };
  },
  // No whatsapp — manual top-ups are agency-internal, no need to push WA fatigue.
};
