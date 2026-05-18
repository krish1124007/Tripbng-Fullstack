// Manual top-up rejected — admin rejected a pending bank-transfer / cheque
// top-up request. Wallet is NOT credited; the agency may need to retry.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const manualTopupRejectedTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'MANUAL_TOPUP_REJECTED') {
      throw new Error(`manualTopupRejectedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Top-up rejected: ${rs(v.amountPaise)}`;
    const html = emailLayout({
      title: subject,
      preheader: `Your manual top-up request was not approved. Wallet was not credited.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#b91c1c;">Top-up rejected</h1>
<p style="margin:0 0 16px;color:#475569;">Your manual top-up request was reviewed and could not be approved.</p>
${kvTable([
  ['Transaction', v.txnCode],
  ['Amount requested', rs(v.amountPaise)],
  ['Reviewed by', v.decidedBy],
  ['Reason', v.rejectionReason ?? 'Not specified'],
])}
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">If you believe this was rejected in error, contact support with the transaction code above.</p>`,
    });
    const text = [
      `Manual top-up rejected.`,
      `Transaction: ${v.txnCode}`,
      `Amount: ${rs(v.amountPaise)}`,
      `Reviewed by: ${v.decidedBy}`,
      `Reason: ${v.rejectionReason ?? 'not specified'}`,
      ``,
      `If this was rejected in error, contact support.`,
      `— TripBng`,
    ].join('\n');
    return { subject, html, text };
  },

  inapp(payload) {
    if (payload.event !== 'MANUAL_TOPUP_REJECTED') {
      throw new Error(`manualTopupRejectedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Top-up rejected: ${rs(v.amountPaise)}`,
      body: `${v.txnCode} • ${v.rejectionReason ?? 'see email for details'}`,
      type: 'MANUAL_TOPUP_REJECTED',
      actionUrl: '/wallet',
    };
  },
};
