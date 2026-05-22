// Partner inquiry received — ops-only alert. Routes to OPS_ALERT_EMAIL.
// Fired by the public /api/v1/inquiries submission form when a prospective
// agency or distributor reaches out. The reply-to is set to the applicant's
// email so an ops reply goes straight back to them.

import type { AlertTemplate } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const partnerInquiryReceivedTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'PARTNER_INQUIRY_RECEIVED') {
      throw new Error(`partnerInquiryReceivedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `[TripBng inquiry] ${v.type} · ${v.companyName}`;
    const html = emailLayout({
      title: subject,
      preheader: `${v.fullName} from ${v.companyName} wants to ${v.type === 'AGENCY' ? 'register an agency' : 'partner as a distributor'}.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">New partner inquiry</h1>
<p style="margin:0 0 16px;color:#475569;">${escapeHtml(v.fullName)} from <strong>${escapeHtml(v.companyName)}</strong> just submitted an inquiry. Reply to this email to reach them directly.</p>
${kvTable([
  ['Type', v.type],
  ['Company', v.companyName],
  ['Contact', `${v.fullName} <${v.email}>`],
  ['Mobile', v.mobile],
  ['City', v.city || '—'],
  ['State', v.state || '—'],
  ['GSTIN', v.gstin || '—'],
  ['Size band', v.sizeBand || '—'],
])}
${v.message ? `<p style="margin:16px 0 0;color:#0f172a;font-size:14px;line-height:1.55;"><strong>Message:</strong><br/>${escapeHtml(v.message).replace(/\n/g, '<br/>')}</p>` : ''}
<p style="margin:24px 0 0;text-align:center;">
  <a href="${escapeHtml(v.adminUrl)}" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;">Open in admin</a>
</p>`,
    });
    const text = [
      `New partner inquiry`,
      ``,
      `Type:    ${v.type}`,
      `Company: ${v.companyName}`,
      `Contact: ${v.fullName} <${v.email}> · ${v.mobile}`,
      `City:    ${v.city || '—'} · State: ${v.state || '—'}`,
      `GSTIN:   ${v.gstin || '—'} · Size band: ${v.sizeBand || '—'}`,
      ``,
      `Message:`,
      v.message || '(none)',
      ``,
      `Open in admin: ${v.adminUrl}`,
    ].join('\n');
    return { subject, html, text };
  },
  // Ops-only — no whatsapp, no inapp.
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
