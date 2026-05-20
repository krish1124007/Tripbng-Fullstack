// Incentive credited — DI module post-deposit notification. Fired by the
// async incentive worker once the INCENTIVE_CREDIT (+ optional TDS_DEDUCT)
// ledger rows commit. Surfaces the split so the agency owner can see why
// their wallet balance differs from the bare deposit amount.

import type { AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const incentiveCreditedTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'INCENTIVE_CREDITED') {
      throw new Error(`incentiveCreditedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Deposit incentive credited: ${rs(v.netCreditPaise)}`;
    const tdsRow: Array<[string, string]> = v.tdsPaise > 0
      ? [['TDS withheld', `-${rs(v.tdsPaise)}`]]
      : [];
    const html = emailLayout({
      title: subject,
      preheader: `Your deposit incentive has landed in your wallet.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#15803d;">Deposit incentive credited</h1>
<p style="margin:0 0 16px;color:#475569;">Your latest deposit has been rewarded with an incentive. Net credit reflects TDS where applicable.</p>
${kvTable([
  ['Deposit amount', rs(v.depositPaise)],
  ['Gross incentive', rs(v.incentivePaise)],
  ...tdsRow,
  ['Net wallet credit', rs(v.netCreditPaise)],
  ['Wallet balance after', rs(v.walletBalanceAfterPaise)],
])}`,
    });
    const text = [
      `Deposit incentive credited.`,
      `Deposit: ${rs(v.depositPaise)}`,
      `Gross incentive: ${rs(v.incentivePaise)}`,
      v.tdsPaise > 0 ? `TDS: -${rs(v.tdsPaise)}` : '',
      `Net credit: ${rs(v.netCreditPaise)}`,
      `New wallet balance: ${rs(v.walletBalanceAfterPaise)}`,
      `— TripBng`,
    ]
      .filter(Boolean)
      .join('\n');
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (payload.event !== 'INCENTIVE_CREDITED') {
      throw new Error(`incentiveCreditedTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    // Meta-approved template: `incentive_credited`
    // {{1}} deposit, {{2}} gross incentive, {{3}} tds, {{4}} net credit, {{5}} new balance
    return {
      templateName: 'incentive_credited',
      bodyParams: [
        rs(v.depositPaise),
        rs(v.incentivePaise),
        rs(v.tdsPaise),
        rs(v.netCreditPaise),
        rs(v.walletBalanceAfterPaise),
      ],
    };
  },

  inapp(payload) {
    if (payload.event !== 'INCENTIVE_CREDITED') {
      throw new Error(`incentiveCreditedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Incentive credited: ${rs(v.netCreditPaise)}`,
      body:
        v.tdsPaise > 0
          ? `${rs(v.incentivePaise)} incentive − ${rs(v.tdsPaise)} TDS = ${rs(v.netCreditPaise)} net.`
          : `${rs(v.incentivePaise)} incentive added to your wallet.`,
      type: 'INCENTIVE_CREDITED',
      actionUrl: '/wallet',
    };
  },
};
