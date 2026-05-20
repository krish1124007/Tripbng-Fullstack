// Distributor transfer landed — receiving agency (or distributor, on RECALL)
// is told that a balance movement just hit their wallet. The TYPE param
// switches the message between "transfer received" and "balance recalled".

import type { AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const distributorTransferInTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'DISTRIBUTOR_TRANSFER_IN') {
      throw new Error(`distributorTransferInTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const headline =
      v.type === 'TRANSFER' ? 'Balance transferred to your wallet' : 'Balance recalled by distributor';
    const subject = `${headline} — ${rs(v.amountPaise)}`;
    const html = emailLayout({
      title: subject,
      preheader: `Reference ${v.transferRef}`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#0e7490;">${headline}</h1>
<p style="margin:0 0 16px;color:#475569;">${
        v.type === 'TRANSFER'
          ? `Your distributor ${v.distributorName} has transferred balance to your wallet.`
          : `Your distributor ${v.distributorName} has recalled balance from your wallet.`
      }</p>
${kvTable([
  ['Amount', rs(v.amountPaise)],
  ['Reference', v.transferRef],
  ['Wallet balance after', rs(v.walletBalanceAfterPaise)],
])}`,
    });
    const text = [
      headline,
      `Amount: ${rs(v.amountPaise)}`,
      `Reference: ${v.transferRef}`,
      `New wallet balance: ${rs(v.walletBalanceAfterPaise)}`,
      `— TripBng`,
    ].join('\n');
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (payload.event !== 'DISTRIBUTOR_TRANSFER_IN') {
      throw new Error(`distributorTransferInTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    // Meta-approved template: `distributor_transfer_in`
    // {{1}} type ("received" | "recalled"), {{2}} amount, {{3}} distributor, {{4}} ref, {{5}} new balance
    return {
      templateName: 'distributor_transfer_in',
      bodyParams: [
        v.type === 'TRANSFER' ? 'received' : 'recalled',
        rs(v.amountPaise),
        v.distributorName,
        v.transferRef,
        rs(v.walletBalanceAfterPaise),
      ],
    };
  },

  inapp(payload) {
    if (payload.event !== 'DISTRIBUTOR_TRANSFER_IN') {
      throw new Error(`distributorTransferInTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title:
        v.type === 'TRANSFER'
          ? `${rs(v.amountPaise)} received from ${v.distributorName}`
          : `${rs(v.amountPaise)} recalled by ${v.distributorName}`,
      body: `Ref ${v.transferRef} • new balance ${rs(v.walletBalanceAfterPaise)}`,
      type: 'DISTRIBUTOR_TRANSFER_IN',
      actionUrl: '/wallet',
    };
  },
};
