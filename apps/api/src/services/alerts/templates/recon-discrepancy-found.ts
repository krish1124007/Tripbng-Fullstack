// Reconciliation discrepancy — ops-only alert. Fires after the daily
// settlement-batch reconciliation finds gateway-vs-internal mismatches.
// Goes to OPS_ALERT_EMAIL (until/unless a separate FINANCE_ALERT_EMAIL is
// introduced — currently finance + ops share the inbox).

import type { AlertTemplate } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const reconDiscrepancyFoundTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'RECON_DISCREPANCY_FOUND') {
      throw new Error(`reconDiscrepancyFoundTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `[OPS] ${v.discrepancyCount} reconciliation discrepancy${v.discrepancyCount === 1 ? '' : 'ies'} — ${v.providerCode} ${v.batchDate}`;
    const html = emailLayout({
      title: subject,
      preheader: `${v.discrepancyCount} mismatched row${v.discrepancyCount === 1 ? '' : 's'} in the ${v.providerCode} settlement for ${v.batchDate}.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#b91c1c;">Reconciliation discrepancies</h1>
<p style="margin:0 0 16px;color:#475569;">The daily settlement reconciliation finished with mismatches. Investigate via the admin reconciliation drill-down before tomorrow's batch lands.</p>
${kvTable([
  ['Provider', v.providerCode],
  ['Batch date', v.batchDate],
  ['Discrepancies', String(v.discrepancyCount)],
  ['Matched rows', String(v.matchedCount)],
  ['Recovered from PENDING', String(v.resolvedCount)],
])}
${renderDiscrepancyTable(v.sampleDiscrepancies)}
<p style="margin:24px 0 0;text-align:center;">
  <a href="${escapeHtml(v.adminUrl)}" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;">Open reconciliation batch</a>
</p>
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">Common causes: gateway slow-settle (PT not in gateway file yet — usually self-heals on T+1), amount-mismatch (typically MDR / GST math drift — finance fixes once), or we credited a wallet on a PENDING → SUCCESS recovery that the gateway later marked failed (rare, urgent).</p>`,
    });
    const text = [
      `Reconciliation discrepancies — ${v.providerCode} ${v.batchDate}`,
      ``,
      `Discrepancies: ${v.discrepancyCount}`,
      `Matched rows:  ${v.matchedCount}`,
      `Recovered:     ${v.resolvedCount}`,
      ``,
      `Top ${v.sampleDiscrepancies.length} discrepancies:`,
      ...v.sampleDiscrepancies.map(
        (d) =>
          `  • [${d.kind}] ${d.paymentTxnCode ?? d.gatewayTxnId ?? '?'} — ${d.detail}` +
          (d.ourAmount != null && d.gatewayAmount != null
            ? ` (ours: ${d.ourAmount}, gateway: ${d.gatewayAmount})`
            : ''),
      ),
      ``,
      `Open in admin: ${v.adminUrl}`,
    ].join('\n');
    return { subject, html, text };
  },
  // Ops-only — no whatsapp, no inapp.
};

function renderDiscrepancyTable(
  rows: Array<{
    kind: string;
    gatewayTxnId?: string | null;
    paymentTxnCode?: string | null;
    detail: string;
    ourAmount?: number | null;
    gatewayAmount?: number | null;
  }>,
): string {
  if (!rows.length) return '';
  return `
<table role="presentation" cellpadding="8" cellspacing="0" border="0" style="margin-top:16px;width:100%;border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;border-spacing:0;font-size:13px;">
  <thead>
    <tr style="background:#f8fafc;color:#334155;font-weight:600;">
      <th style="text-align:left;border-bottom:1px solid #e5e7eb;">Kind</th>
      <th style="text-align:left;border-bottom:1px solid #e5e7eb;">Reference</th>
      <th style="text-align:left;border-bottom:1px solid #e5e7eb;">Detail</th>
    </tr>
  </thead>
  <tbody>
    ${rows
      .map(
        (d) => `<tr>
      <td style="border-bottom:1px solid #f1f5f9;color:#0f172a;"><code style="font-size:12px;color:#0f172a;">${escapeHtml(d.kind)}</code></td>
      <td style="border-bottom:1px solid #f1f5f9;font-family:monospace;font-size:12px;color:#334155;">${escapeHtml(d.paymentTxnCode ?? d.gatewayTxnId ?? '—')}</td>
      <td style="border-bottom:1px solid #f1f5f9;color:#475569;">${escapeHtml(d.detail)}${
        d.ourAmount != null && d.gatewayAmount != null
          ? `<br/><span style="font-size:11px;color:#94a3b8;">ours: ${d.ourAmount} · gw: ${d.gatewayAmount}</span>`
          : ''
      }</td>
    </tr>`,
      )
      .join('')}
  </tbody>
</table>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
