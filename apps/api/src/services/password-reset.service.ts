// Password-reset service.
//
// Two operations: request a reset (emails a link) + consume a reset
// (validates the token + updates the password). Designed to be
// safe-by-default — we never reveal whether an email is registered,
// and tokens are single-use, short-lived, and stored hashed.

import { AppError } from '@tripbng/shared';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { captureException } from '../config/sentry.js';
import { getSmtpTransport } from '../config/smtp.js';
import {
  PASSWORD_RESET_TTL_MIN,
  PasswordResetToken,
  generatePasswordResetToken,
  hashPasswordResetToken,
} from '../models/PasswordResetToken.js';
import { User } from '../models/User.js';
import { hashPassword } from '../utils/password.js';

export interface ForgotPasswordContext {
  ip?: string;
  userAgent?: string;
}

/** Step 1: user supplies their email; we mint a token + send a link.
 *
 *  IMPORTANT: this function returns success regardless of whether the
 *  email exists. Otherwise a caller can probe the platform for valid
 *  emails by watching the response. The caller surfaces the same
 *  message to the UI either way ("if your email is registered, you'll
 *  get a link").
 *
 *  Side effects:
 *    - Creates a PasswordResetToken row (if user exists)
 *    - Sends one email via SMTP (if user exists AND SMTP is configured)
 *    - Logs the request either way for audit + abuse-detection. */
export async function requestPasswordReset(
  email: string,
  ctx: ForgotPasswordContext = {},
): Promise<{ sent: boolean }> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    logger.info(
      { email: normalizedEmail, ip: ctx.ip, exists: false },
      'forgot-password: no user — no email sent',
    );
    return { sent: false };
  }
  if (user.status === 'SUSPENDED' || user.status === 'BLOCKED') {
    // We don't want to send reset links to disabled accounts — that's a
    // password-bypass for a suspension. Same opaque response either way.
    logger.warn(
      { userId: String(user._id), status: user.status },
      'forgot-password: disabled account — no email sent',
    );
    return { sent: false };
  }

  const { raw, hash } = generatePasswordResetToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MIN * 60 * 1000);

  await PasswordResetToken.create({
    userId: user._id,
    tokenHash: hash,
    expiresAt,
    requestIp: ctx.ip ?? null,
    requestUserAgent: ctx.userAgent ?? null,
  });

  await sendResetEmail({
    to: user.email,
    name: user.fullName ?? null,
    rawToken: raw,
    expiresAt,
  });

  return { sent: true };
}

/** Step 2: user supplies the raw token from the email + their new
 *  password. We hash the raw token to find the row, validate it, then
 *  update the user. The reset row is marked consumed (one-shot). */
export async function consumePasswordReset(args: {
  token: string;
  password: string;
}): Promise<{ userId: string; tenantId: string }> {
  const { token, password } = args;
  if (!token) throw new AppError('TOKEN_INVALID');
  if (!password || password.length < 8) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'Password must be at least 8 characters',
    });
  }

  const hash = hashPasswordResetToken(token);
  const row = await PasswordResetToken.findOne({ tokenHash: hash });
  if (!row) throw new AppError('TOKEN_INVALID');
  if (row.consumedAt) throw new AppError('TOKEN_INVALID');
  if (row.expiresAt < new Date()) throw new AppError('TOKEN_EXPIRED');

  const user = await User.findById(row.userId).select('+passwordHash');
  if (!user) throw new AppError('TOKEN_INVALID');

  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  // Reset any lockout state so the user can sign in immediately.
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  row.consumedAt = new Date();
  await row.save();

  logger.info(
    { userId: String(user._id) },
    'password-reset: consumed — user can now sign in with new password',
  );
  return { userId: String(user._id), tenantId: String(user.tenantId) };
}

// ────────── Email body builders ──────────

interface SendResetEmailArgs {
  to: string;
  name: string | null;
  rawToken: string;
  expiresAt: Date;
}

async function sendResetEmail(args: SendResetEmailArgs): Promise<void> {
  const transport = getSmtpTransport();
  if (!transport) {
    // SMTP not configured (dev). Log the link so the developer can copy
    // it from stdout — this is a deliberate dev affordance, not a leak,
    // because the only way to reach this branch in prod is to ship
    // without SMTP_HOST set, which we'd catch in deployment review.
    logger.warn(
      {
        to: args.to,
        resetUrl: buildResetUrl(args.rawToken),
        expiresAt: args.expiresAt.toISOString(),
      },
      'forgot-password: SMTP not configured — reset link logged instead of emailed',
    );
    return;
  }

  const resetUrl = buildResetUrl(args.rawToken);
  const text = buildPlainText(args, resetUrl);
  const html = buildHtmlBody(args, resetUrl);

  const start = Date.now();
  try {
    const info = await transport.sendMail({
      from: env.SMTP_FROM,
      to: args.to,
      replyTo: env.SMTP_REPLY_TO,
      subject: 'Reset your TripBng password',
      text,
      html,
    });
    logger.info(
      {
        to: args.to,
        messageId: info.messageId ?? null,
        durationMs: Date.now() - start,
      },
      'forgot-password: reset email sent',
    );
  } catch (err) {
    // We log + swallow w.r.t. the API response — exposing send failures
    // lets a probe distinguish valid emails from invalid ones (since SMTP
    // servers often reject unknown recipients). The user still sees a
    // generic "we sent a link" message.
    //
    // BUT we must NOT silently lose track of the failure — an outage here
    // means real users are locked out of password reset. Capture to Sentry
    // and log loudly so ops gets paged via the existing alert pipeline.
    logger.error(
      { err, to: args.to, durationMs: Date.now() - start },
      'forgot-password: SMTP send failed',
    );
    captureException(err, {
      tags: { service: 'password-reset', channel: 'smtp' },
      extra: { recipient: args.to },
    });
  }
}

function buildResetUrl(rawToken: string): string {
  const base = env.WEB_BASE_URL.replace(/\/+$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

function buildPlainText(args: SendResetEmailArgs, resetUrl: string): string {
  return [
    `Hi ${args.name ?? 'there'},`,
    '',
    'We received a request to reset the password on your TripBng account.',
    `Open this link to set a new password — it works for the next ${PASSWORD_RESET_TTL_MIN} minutes:`,
    '',
    resetUrl,
    '',
    "If you didn't request this, you can safely ignore this email. Your current password stays unchanged.",
    '',
    'Need help? trade@tripbng.com · +91 22 6196 4040',
    '',
    'Tripbng India Private Limited',
    'Mumbai · India',
  ].join('\n');
}

function buildHtmlBody(args: SendResetEmailArgs, resetUrl: string): string {
  // Inline-styled email-safe HTML — most clients strip <style> tags.
  // Layout uses tables for Outlook compatibility.
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f5f7fb;font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f7fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 50%,#f59e0b 100%);padding:28px 32px;color:#ffffff;">
                <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;opacity:0.85;">TripBng · Password reset</p>
                <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25;font-weight:700;">Set a new password</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;">
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${escapeHtml(args.name ?? 'there')},</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">We received a request to reset the password on your TripBng account. Click the button below to set a new password — the link works for the next ${PASSWORD_RESET_TTL_MIN} minutes and can be used once.</p>
                <p style="margin:24px 0;text-align:center;">
                  <a href="${resetUrl}" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:10px;">Reset password</a>
                </p>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#475569;">If the button doesn&rsquo;t work, copy this link into your browser:</p>
                <p style="margin:6px 0 0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="${resetUrl}" style="color:#1e40af;">${escapeHtml(resetUrl)}</a></p>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#475569;">If you didn&rsquo;t request this, you can safely ignore the email — your password stays unchanged.</p>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;padding:18px 32px;border-top:1px solid #e5e7eb;font-size:11px;color:#64748b;line-height:1.6;">
                Need help? <a href="mailto:trade@tripbng.com" style="color:#1e40af;">trade@tripbng.com</a> &middot; +91 22 6196 4040<br/>
                Tripbng India Private Limited &middot; Mumbai, India &middot; DPDP Act 2023 compliant
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
