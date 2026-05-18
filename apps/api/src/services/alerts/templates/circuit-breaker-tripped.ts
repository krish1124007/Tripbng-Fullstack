// Circuit-breaker tripped — ops-only alert. Routes exclusively to the
// OPS_ALERT_EMAIL inbox. No user-facing channels: this is an internal
// platform health signal, not something agencies need to see.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const circuitBreakerTrippedTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'CIRCUIT_BREAKER_TRIPPED') {
      throw new Error(`circuitBreakerTrippedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const errorRatePct = (v.errorRate * 100).toFixed(1);
    const subject = `[OPS] Circuit breaker tripped — ${v.supplier}`;
    const html = emailLayout({
      title: subject,
      preheader: `Supplier ${v.supplier} dropped from fanout. Error rate ${errorRatePct}% over ${v.windowSec}s.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#b91c1c;">Circuit breaker OPEN</h1>
<p style="margin:0 0 16px;color:#475569;">A supplier has been dropped from the search fanout because its error rate crossed the trip threshold. The breaker will auto-probe in ${v.windowSec}s. If the supplier is still unhealthy, it will remain OPEN.</p>
${kvTable([
  ['Supplier', v.supplier],
  ['Error rate', `${errorRatePct}%`],
  ['Rolling window', `${v.windowSec}s`],
])}
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">Investigate the supplier integration logs around the trip time. The admin /supplier-health dashboard shows live breaker state for every adapter.</p>`,
    });
    const text = [
      `Circuit breaker tripped: ${v.supplier}`,
      `Error rate: ${errorRatePct}% over ${v.windowSec}s`,
      ``,
      `The breaker will auto-probe in ${v.windowSec}s.`,
      `Check the admin /supplier-health dashboard for live state.`,
    ].join('\n');
    return { subject, html, text };
  },
  // Ops-only — no whatsapp, no inapp. The router config also forces email-only.
};
