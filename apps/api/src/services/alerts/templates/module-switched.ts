// Module switched — fires when an admin changes the agency's billing/pricing
// module. Visible to the agency owner so any change in pricing or credit
// behaviour is explained alongside the event.

import type { AlertTemplate } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

const MODULE_LABEL = {
  CREDIT: 'Credit module',
  DI: 'Deposit Incentive (DI)',
  CASH: 'Cash on Carry',
  DISTRIBUTOR: 'Distributor',
  SUB_AGENT: 'Sub-Agent',
} as const;

export const moduleSwitchedTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'MODULE_SWITCHED') {
      throw new Error(`moduleSwitchedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Your billing module changed: ${MODULE_LABEL[v.newModule]}`;
    const html = emailLayout({
      title: subject,
      preheader: `Switched from ${MODULE_LABEL[v.previousModule]} to ${MODULE_LABEL[v.newModule]}.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#1d4ed8;">Billing module updated</h1>
<p style="margin:0 0 16px;color:#475569;">An admin has changed your agency's billing module. New behaviour applies from this point onwards.</p>
${kvTable([
  ['From', MODULE_LABEL[v.previousModule]],
  ['To', MODULE_LABEL[v.newModule]],
  ...(v.notes ? ([['Notes', v.notes]] as Array<[string, string]>) : []),
  ...(v.forced
    ? ([
        ['Force override', 'Yes — outstanding credit retained, requires manual adjustment'],
      ] as Array<[string, string]>)
    : []),
])}`,
    });
    const text = [
      `Billing module updated.`,
      `From: ${MODULE_LABEL[v.previousModule]}`,
      `To: ${MODULE_LABEL[v.newModule]}`,
      v.notes ? `Notes: ${v.notes}` : '',
      v.forced ? `Force override: yes` : '',
      `— TripBng`,
    ]
      .filter(Boolean)
      .join('\n');
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (payload.event !== 'MODULE_SWITCHED') {
      throw new Error(`moduleSwitchedTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    // Meta-approved template: `module_switched`
    // {{1}} previous, {{2}} new
    return {
      templateName: 'module_switched',
      bodyParams: [MODULE_LABEL[v.previousModule], MODULE_LABEL[v.newModule]],
    };
  },

  inapp(payload) {
    if (payload.event !== 'MODULE_SWITCHED') {
      throw new Error(`moduleSwitchedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Module changed to ${MODULE_LABEL[v.newModule]}`,
      body: `From ${MODULE_LABEL[v.previousModule]}${v.notes ? ` — ${v.notes}` : ''}`,
      type: 'MODULE_SWITCHED',
      actionUrl: '/settings/billing',
    };
  },
};
