// Login from new device — fired when a successful login comes from an IP
// that doesn't match the user's last-known IP. Email-only by default; this
// is a security signal and the user should see it in their inbox even if
// they've muted WhatsApp.

import type { AlertPayload, AlertTemplate } from '../types.js';
import { emailLayout, kvTable } from './_layout.js';

export const loginNewDeviceTemplate: AlertTemplate = {
  email(payload) {
    if (payload.event !== 'LOGIN_NEW_DEVICE') {
      throw new Error(`loginNewDeviceTemplate.email called with ${payload.event}`);
    }
    const v = payload.vars;
    const subject = `New sign-in to your TripBng account`;
    const html = emailLayout({
      title: subject,
      preheader: `Sign-in detected from a new IP address. If this wasn't you, change your password.`,
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">New sign-in detected</h1>
<p style="margin:0 0 16px;color:#475569;">We noticed a successful sign-in to your account from a new IP address.</p>
${kvTable([
  ['IP address', v.ipAddress],
  ['Browser', truncate(v.userAgent, 80)],
  ['When', v.at],
])}
<p style="margin:16px 0 0;color:#64748b;font-size:13px;">If this was you, no action is needed. If you don't recognise this sign-in, change your password immediately and enable two-factor authentication if you haven't already.</p>`,
    });
    const text = [
      `New sign-in to your TripBng account.`,
      `IP: ${v.ipAddress}`,
      `Browser: ${truncate(v.userAgent, 80)}`,
      `When: ${v.at}`,
      ``,
      `If this wasn't you, change your password and enable 2FA.`,
      `— TripBng`,
    ].join('\n');
    return { subject, html, text };
  },
  // No whatsapp / inapp — security alerts go to email only so the audit
  // trail is easy to find later, and so a compromised in-app session can't
  // suppress the warning.
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
