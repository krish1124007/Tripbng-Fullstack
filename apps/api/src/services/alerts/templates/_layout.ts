// Shared HTML email layout — wraps a single content block in our brand chrome.
//
// Why inline-styles only (no <style> block, no class names): Gmail strips
// <style> in some clients (notably the Android Gmail app for non-Gmail
// senders), and Outlook desktop is famously hostile to anything beyond
// table-based inline-styled HTML. Inline-only renders identically across
// every mail client we care about.

export interface EmailLayoutBranding {
  /** Header band background. Falls back to platform deep-ink. */
  primaryColor?: string;
  /** Text colour on top of primaryColor. Falls back to white. */
  primaryForegroundColor?: string;
  /** Wordmark text shown in the band. Falls back to "TripBng". */
  companyName?: string;
  /**
   * Absolute, public URL the recipient's mail client can fetch.
   * Inline data URLs are stripped by Gmail's image proxy in some
   * configs, so branded emails MUST use a public URL. Set
   * API_PUBLIC_BASE_URL=https://api.tripbng.com (or your CDN) so the
   * resolver's built URL points somewhere reachable from the public
   * internet.
   */
  logoPublicUrl?: string | null;
}

export function emailLayout(opts: {
  title: string;
  preheader?: string;
  bodyHtml: string;
  branding?: EmailLayoutBranding | null;
}): string {
  const preheader = opts.preheader ?? '';
  // Header band — primaryColor + readable foreground from the resolved
  // branding. Falls back to the platform deep-ink (#0f172a) on white.
  const bg = sanitizeHex(opts.branding?.primaryColor) ?? '#0f172a';
  const fg = sanitizeHex(opts.branding?.primaryForegroundColor) ?? '#ffffff';
  const wordmark = (opts.branding?.companyName ?? 'TripBng').slice(0, 60);
  const logoUrl = opts.branding?.logoPublicUrl ?? null;
  // Logo + wordmark composition. When a logo URL is supplied we show
  // the image followed by the company name (small, vertically
  // centred). Without a logo, the wordmark stands alone — same as
  // the original "TripBng" header before branding shipped.
  const headerCell = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(wordmark)}" height="28" style="display:inline-block;vertical-align:middle;max-height:28px;max-width:180px;border:0;" /> <span style="display:inline-block;vertical-align:middle;margin-left:10px;color:${fg};font-size:14px;font-weight:600;">${escapeHtml(wordmark)}</span>`
    : escapeHtml(wordmark);
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
              <td style="padding:20px 32px;background:${bg};color:${fg};font-size:18px;font-weight:600;">
                ${headerCell}
              </td>
            </tr>
            <tr>
              <td style="padding:32px;font-size:14px;line-height:1.6;">
                ${opts.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.5;">
                You received this email because you have an account on ${escapeHtml(wordmark)}. If you have questions, reply to this message — our support team will respond within one business day.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Defensive — never let unsanitised tenant input land in raw CSS. */
function sanitizeHex(v: string | null | undefined): string | null {
  if (!v) return null;
  return /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6,8})$/.test(v) ? v : null;
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

/**
 * Primary CTA button — table-cell-based for Outlook. Optional
 * `branding` recolours the button to the tenant's primaryColor +
 * foreground; defaults to the platform deep-ink on white text.
 */
export function ctaButton(
  label: string,
  href: string,
  branding?: { primaryColor?: string; primaryForegroundColor?: string } | null,
): string {
  const bg = sanitizeHex(branding?.primaryColor) ?? '#0f172a';
  const fg = sanitizeHex(branding?.primaryForegroundColor) ?? '#ffffff';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="background:${bg};border-radius:6px;">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;color:${fg};text-decoration:none;font-weight:600;font-size:14px;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}
