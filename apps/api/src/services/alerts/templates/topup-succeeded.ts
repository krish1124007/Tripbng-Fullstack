// Top-up succeeded — wallet credited.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const topupSucceededTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'TOPUP_SUCCEEDED') {
      throw new Error(`topupSucceededTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Wallet topped up: ${rs(v.amountPaise)}`;
    const html = emailLayout({
      title: subject,
      preheader: `Your wallet top-up of ${rs(v.amountPaise)} is successful.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Top-up successful</h1>
<p style="margin:0 0 16px;color:#475569;">Your wallet has been credited.</p>
${kvTable([
  ['Transaction', v.txnCode],
  ['Amount', rs(v.amountPaise)],
  ['Provider', v.provider],
  ['Wallet balance', v.walletBalancePaise != null ? rs(v.walletBalancePaise) : '—'],
])}`,
    });
    const text = [
      `Wallet top-up of ${rs(v.amountPaise)} successful.`,
      `Transaction: ${v.txnCode}`,
      `Provider: ${v.provider}`,
      v.walletBalancePaise != null ? `Wallet balance: ${rs(v.walletBalancePaise)}` : null,
      `— TripBng`,
    ]
      .filter(Boolean)
      .join('\n');
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (payload.event !== 'TOPUP_SUCCEEDED') {
      throw new Error(`topupSucceededTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      // Meta-approved template: `topup_succeeded`
      // Body params: {{1}} amount, {{2}} txnCode, {{3}} walletBalance
      templateName: 'topup_succeeded',
      bodyParams: [
        rs(v.amountPaise),
        v.txnCode,
        v.walletBalancePaise != null ? rs(v.walletBalancePaise) : '—',
      ],
    };
  },

  inapp(payload) {
    if (payload.event !== 'TOPUP_SUCCEEDED') {
      throw new Error(`topupSucceededTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Wallet topped up: ${rs(v.amountPaise)}`,
      body: `${v.txnCode} via ${v.provider}`,
      type: 'TOPUP_SUCCEEDED',
      actionUrl: '/wallet',
    };
  },
};
