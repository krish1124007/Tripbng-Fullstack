// Booking failed — sent when ticketing fails after wallet debit. The wallet
// is auto-refunded; this alert tells the agency not to panic.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { brandingForLayout, emailLayout, kvTable } from './_layout.js';

export const bookingFailedTemplate: AlertTemplate = {
  email(payload, branding) {
    if (payload.event !== 'BOOKING_FAILED') {
      throw new Error(`bookingFailedTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `Booking ${v.bookingCode} failed — refund initiated`;
    const html = emailLayout({
      title: subject,
      preheader: `We couldn't issue your ticket. Wallet has been refunded.`,
      branding: brandingForLayout(branding),
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#b91c1c;">Booking could not be issued</h1>
<p style="margin:0 0 16px;color:#475569;">Our supplier failed to issue the ticket after we collected payment from your wallet. We've automatically refunded the full amount.</p>
${kvTable([
  ['Booking code', v.bookingCode],
  ['Sector', v.sector],
  ['Travel date', v.travelDate],
  ['Amount refunded', rs(v.amountPaise)],
  ['Reason', v.failureReason ?? 'Supplier did not return a ticket'],
])}
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">If the refund doesn't appear in your wallet within 10 minutes, contact support with the booking code above.</p>`,
    });
    const text = [
      `Booking ${v.bookingCode} could not be issued.`,
      `Sector: ${v.sector}`,
      `Amount refunded: ${rs(v.amountPaise)}`,
      `Reason: ${v.failureReason ?? 'supplier failure'}`,
      ``,
      `If the refund doesn't appear within 10 minutes, contact support.`,
      `— TripBng`,
    ].join('\n');
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (payload.event !== 'BOOKING_FAILED') {
      throw new Error(`bookingFailedTemplate.whatsapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      // Meta-approved template: `booking_failed`
      // Body params: {{1}} bookingCode, {{2}} sector, {{3}} amountRefunded, {{4}} reason
      templateName: 'booking_failed',
      bodyParams: [
        v.bookingCode,
        v.sector,
        rs(v.amountPaise),
        (v.failureReason ?? 'supplier failure').slice(0, 200),
      ],
    };
  },

  inapp(payload) {
    if (payload.event !== 'BOOKING_FAILED') {
      throw new Error(`bookingFailedTemplate.inapp called with ${payload.event}`);
    }
    const v = payload.vars;
    return {
      title: `Booking ${v.bookingCode} failed — refunded`,
      body: `${v.sector}: ${rs(v.amountPaise)} refunded (${v.failureReason ?? 'supplier failure'})`,
      type: 'BOOKING_FAILED',
      actionUrl: null,
    };
  },
};
