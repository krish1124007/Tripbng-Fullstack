// Shared HTML email layout — wraps a single content block in our brand chrome.
//
// Why inline-styles only (no <style> block, no class names): Gmail strips
// <style> in some clients (notably the Android Gmail app for non-Gmail
// senders), and Outlook desktop is famously hostile to anything beyond
// table-based inline-styled HTML. Inline-only renders identically across
// every mail client we care about.

export function emailLayout(opts: { title: string; preheader?: string; bodyHtml: string }): string {
  const preheader = opts.preheader ?? '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(opts.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
            <tr>
              <td style="padding:24px 32px;background:#0f172a;color:#ffffff;font-size:18px;font-weight:600;">
                TripBng
              </td>
            </tr>
            <tr>
              <td style="padding:32px;font-size:14px;line-height:1.6;">
                ${opts.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.5;">
                You received this email because you have an account on TripBng. If you have questions, reply to this message — our support team will respond within one business day.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Minimum-viable HTML escape for template-interpolated user data. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Two-column key/value table — used inside email bodies for booking/payment summaries. */
export function kvTable(rows: Array<[string, string]>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:8px 0;color:#64748b;width:40%;">${escapeHtml(k)}</td><td style="padding:8px 0;color:#1a1a1a;font-weight:500;">${escapeHtml(v)}</td></tr>`,
  )
  .join('\n')}
</table>`;
}

/** Primary CTA button — table-cell-based for Outlook. */
export function ctaButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="background:#0f172a;border-radius:6px;">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}
