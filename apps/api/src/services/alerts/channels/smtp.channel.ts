// SMTP channel — sends rendered email via nodemailer.
//
// Throws on transport-level failures so the BullMQ retry policy kicks in.
// Returns the provider message-id so the dispatcher can persist it for
// delivery tracking (later: handle bounces via SES bounce notifications etc).

import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { getSmtpTransport } from '../../../config/smtp.js';
import type { RenderedEmail, ResolvedRecipient } from '../types.js';

export interface SmtpSendResult {
  status: 'sent' | 'skipped' | 'failed';
  messageId?: string | null;
  reason?: string;
}

export async function sendEmail(
  recipient: ResolvedRecipient,
  rendered: RenderedEmail,
  opts?: { correlationKey?: string },
): Promise<SmtpSendResult> {
  const transport = getSmtpTransport();
  if (!transport) return { status: 'skipped', reason: 'SMTP not configured' };

  if (!recipient.email) {
    return { status: 'skipped', reason: 'no recipient email' };
  }

  try {
    const info = await transport.sendMail({
      from: env.SMTP_FROM,
      to: recipient.email,
      replyTo: env.SMTP_REPLY_TO ?? undefined,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: opts?.correlationKey
        ? { 'X-TripBng-Alert': opts.correlationKey }
        : undefined,
    });
    logger.info(
      {
        messageId: info.messageId,
        to: recipient.email,
        subject: rendered.subject,
        correlationKey: opts?.correlationKey,
      },
      'smtp sent',
    );
    return { status: 'sent', messageId: info.messageId ?? null };
  } catch (err) {
    logger.warn(
      { err, to: recipient.email, subject: rendered.subject },
      'smtp send failed',
    );
    // Re-throw so BullMQ retries. If the transport is down for a sustained
    // period, the queue's max-retries cap will eventually park the job.
    throw err;
  }
}
