// Low wallet balance — fires the first time a debit drops the wallet below
// the configured threshold. Designed to be a one-shot warning, not a stream
// of nags every time the balance dips further.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { ctaButton, emailLayout, kvTable } from './_layout.js';

export const lowWalletBalanceTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'LOW_WALLET_BALANCE') {
      throw new Error(`lowWalletBalanceTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Wallet running low: ${rs(v.walletBalancePaise)}`;
    const html = emailLayout({
      title: subject,
      preheader: `Top up to keep bookings flowing without interruptions.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#b45309;">Wallet balance is low</h1>
<p style="margin:0 0 16px;color:#475569;">Your wallet has dropped below the alert threshold. Top up now to avoid booking interruptions.</p>
${kvTable([
  ['Current balance', rs(v.walletBalancePaise)],
  ['Alert threshold', rs(v.thresholdPaise)],
])}
${ctaButton('Top up now', v.topupUrl)}`,
    });
    const text = [
      `Your wallet balance is low.`,
      `Current balance: ${rs(v.walletBalancePaise)}`,
      `Alert threshold: ${rs(v.thresholdPaise)}`,
      ``,
      `Top up: ${v.topupUrl}`,
      `— TripBng`,
    ].join('\n');
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (payload.event !== 'LOW_WALLET_BALANCE') {
      throw new Error(`lowWalletBalanceTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      // Meta-approved template: `low_wallet_balance`
      // Body params: {{1}} currentBalance, {{2}} threshold, {{3}} topupUrl
      templateName: 'low_wallet_balance',
      bodyParams: [rs(v.walletBalancePaise), rs(v.thresholdPaise), v.topupUrl],
    };
  },

  inapp(payload) {
    if (payload.event !== 'LOW_WALLET_BALANCE') {
      throw new Error(`lowWalletBalanceTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Wallet low: ${rs(v.walletBalancePaise)}`,
      body: `Below alert threshold of ${rs(v.thresholdPaise)} — top up to keep bookings flowing.`,
      type: 'LOW_WALLET_BALANCE',
      actionUrl: '/wallet/topup',
    };
  },
};
