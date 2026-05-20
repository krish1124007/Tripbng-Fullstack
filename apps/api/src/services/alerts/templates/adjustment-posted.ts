// Adjustment posted — fires when a manual wallet adjustment lands, either
// via the immediate path (below threshold) or after the two-person
// approval queue.

import type { AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const adjustmentPostedTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'ADJUSTMENT_POSTED') {
      throw new Error(`adjustmentPostedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const verb = v.direction === 'CREDIT' ? 'credited' : 'debited';
    const subject = `Wallet ${verb}: ${rs(v.amountPaise)}`;
    const color = v.direction === 'CREDIT' ? '#15803d' : '#b91c1c';
    const html = emailLayout({
      title: subject,
      preheader: `Reason: ${v.reason}`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:${color};">Wallet ${verb}</h1>
<p style="margin:0 0 16px;color:#475569;">An admin has posted a manual ${v.direction.toLowerCase()} adjustment to your wallet.</p>
${kvTable([
  ['Amount', rs(v.amountPaise)],
  ['Direction', v.direction],
  ['Reason', v.reason],
  ['Wallet balance after', rs(v.walletBalanceAfterPaise)],
  ...(v.wasApproved
    ? ([['Approval path', 'Two-person approved']] as Array<[string, string]>)
    : []),
])}`,
    });
    const text = [
      `Wallet ${verb}: ${rs(v.amountPaise)}`,
      `Reason: ${v.reason}`,
      `New balance: ${rs(v.walletBalanceAfterPaise)}`,
      v.wasApproved ? `(Two-person approved)` : '',
      `— TripBng`,
    ]
      .filter(Boolean)
      .join('\n');
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (payload.event !== 'ADJUSTMENT_POSTED') {
      throw new Error(`adjustmentPostedTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    // Meta-approved template: `adjustment_posted`
    // {{1}} direction, {{2}} amount, {{3}} reason, {{4}} new balance
    return {
      templateName: 'adjustment_posted',
      bodyParams: [
        v.direction.toLowerCase(),
        rs(v.amountPaise),
        v.reason,
        rs(v.walletBalanceAfterPaise),
      ],
    };
  },

  inapp(payload) {
    if (payload.event !== 'ADJUSTMENT_POSTED') {
      throw new Error(`adjustmentPostedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    const verb = v.direction === 'CREDIT' ? 'credited' : 'debited';
    return {
      title: `Wallet ${verb}: ${rs(v.amountPaise)}`,
      body: `${v.reason} • new balance ${rs(v.walletBalanceAfterPaise)}`,
      type: 'ADJUSTMENT_POSTED',
      actionUrl: '/wallet/transactions',
    };
  },
};
