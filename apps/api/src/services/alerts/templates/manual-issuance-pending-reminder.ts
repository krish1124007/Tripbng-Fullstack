// Manual-issuance follow-up — ops-only alert.
//
// Fired by the manual-issuance-followup cron worker when a booking has been
// parked in PENDING_MANUAL longer than the tier threshold. The booking was
// confirmed (and the agency was debited) but the supplier API was skipped —
// ops needs to attach a PNR + ticket numbers via the admin panel.
//
// Single event, four tiers (REMINDER / ESCALATION / CRITICAL / CRITICAL_HIGH).
// The template branches on `tier` for subject + colour + body urgency.

import type { AlertTemplate } from '../types.js';
import { emailLayout, kvTable, escapeHtml } from './_layout.js';

const TIER_LABEL: Record<string, { label: string; colour: string }> = {
  REMINDER: { label: 'Reminder', colour: '#0369a1' },
  ESCALATION: { label: 'Escalation', colour: '#b45309' },
  CRITICAL: { label: 'Critical', colour: '#b91c1c' },
  CRITICAL_HIGH: { label: 'Critical (>48h)', colour: '#7f1d1d' },
};

export const manualIssuancePendingReminderTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'MANUAL_ISSUANCE_PENDING_REMINDER') {
      throw new Error(
        `manualIssuancePendingReminderTemplate.email called with ${payload.event}`,
      );
    }
    const v = payload.vars;
    const tier = TIER_LABEL[v.tier] ?? TIER_LABEL.REMINDER;
    const subject = `[OPS] Manual issuance pending — ${v.bookingCode} (${v.pendingHours}h, ${tier.label})`;
    const rupees = (v.amountPaise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

    const bodyHtml = `
<h1 style="margin:0 0 12px;font-size:20px;color:${tier.colour};">${tier.label}: ${escapeHtml(v.bookingCode)} pending manual issue</h1>
<p style="margin:0 0 16px;color:#475569;">A booking has been parked in <strong>PENDING_MANUAL</strong> for ${v.pendingHours} hours. The wallet has already been debited &mdash; the agency is waiting on the PNR. Please attach the supplier PNR + ticket numbers via the admin panel.</p>
${kvTable([
  ['Booking code', v.bookingCode],
  ['Agency', v.agencyName],
  ['Supplier', v.supplierCode],
  ['Sector', v.sector],
  ['Travel date', v.travelDate],
  ['Pax count', String(v.paxCount)],
  ['Amount debited', `Rs ${rupees}`],
  ['Pending since', new Date(v.pendingSince).toUTCString()],
  ['Routing reason', v.internalNotes ?? '—'],
])}
<p style="margin:24px 0 16px;">
  <a href="${escapeHtml(v.adminUrl)}" style="display:inline-block;padding:10px 18px;background:${tier.colour};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Open booking in admin</a>
</p>
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">This reminder will re-fire at higher tiers (12h, 24h, 48h) until the booking is issued manually or cancelled. The matching Map Source rule that routed this booking lives under <code>/admin/wallet-ops/map-sources</code>.</p>`;

    const html = emailLayout({
      title: subject,
      preheader: `${v.bookingCode} pending manual issuance for ${v.pendingHours}h — ${v.agencyName}.`,
      bodyHtml,
    });

    const text = [
      `[OPS] Manual issuance pending: ${v.bookingCode}`,
      `Tier: ${tier.label} (${v.pendingHours}h pending)`,
      ``,
      `Agency: ${v.agencyName}`,
      `Supplier: ${v.supplierCode}`,
      `Sector: ${v.sector}`,
      `Travel date: ${v.travelDate}`,
      `Pax count: ${v.paxCount}`,
      `Amount debited: Rs ${rupees}`,
      `Pending since: ${v.pendingSince}`,
      `Routing reason: ${v.internalNotes ?? '—'}`,
      ``,
      `Issue in admin: ${v.adminUrl}`,
    ].join('\n');

    return { subject, html, text };
  },
  // Ops-only — no whatsapp, no inapp. Router config forces email-only and
  // bypasses recipient-prefs filtering.
};
