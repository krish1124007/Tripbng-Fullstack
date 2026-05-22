// SMTP channel — sends rendered email via nodemailer.
//
// Throws on transport-level failures so the BullMQ retry policy kicks in.
// Returns the provider message-id so the dispatcher can persist it for
// delivery tracking (later: handle bounces via SES bounce notifications etc).

import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import {
  emailAttachments as emailAttachmentsMetric,
  emailSendDuration,
  emailSent,
} from '../../../config/metrics.js';
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
  opts?: { correlationKey?: string; event?: string },
): Promise<SmtpSendResult> {
  // The event label drives metric breakdowns. Defaults to `direct` for
  // sends that bypass the alert system (test endpoint, etc.) — the
  // dispatcher passes the real AlertEvent through.
  const eventLabel = opts?.event ?? 'direct';

  const transport = getSmtpTransport();
  if (!transport) {
    emailSent.inc({ event: eventLabel, outcome: 'skipped' });
    return { status: 'skipped', reason: 'SMTP not configured' };
  }

  if (!recipient.email) {
    emailSent.inc({ event: eventLabel, outcome: 'skipped' });
    return { status: 'skipped', reason: 'no recipient email' };
  }

  const startTimer = emailSendDuration.startTimer({ event: eventLabel });
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
      // nodemailer accepts Buffer attachments verbatim — keeps the BullMQ
      // job payload small if we ever need to retry (vs. embedding the file
      // bytes into the job data).
      attachments: rendered.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    startTimer({ outcome: 'sent' });
    emailSent.inc({ event: eventLabel, outcome: 'sent' });
    if (rendered.attachments && rendered.attachments.length > 0) {
      emailAttachmentsMetric.inc(
        { event: eventLabel },
        rendered.attachments.length,
      );
    }
    logger.info(
      {
        messageId: info.messageId,
        to: recipient.email,
        subject: rendered.subject,
        correlationKey: opts?.correlationKey,
        attachmentCount: rendered.attachments?.length ?? 0,
      },
      'smtp sent',
    );
    return { status: 'sent', messageId: info.messageId ?? null };
  } catch (err) {
    startTimer({ outcome: 'failed' });
    emailSent.inc({ event: eventLabel, outcome: 'failed' });
    logger.warn(
      { err, to: recipient.email, subject: rendered.subject },
      'smtp send failed',
    );
    // Re-throw so BullMQ retries. If the transport is down for a sustained
    // period, the queue's max-retries cap will eventually park the job.
    throw err;
  }
}
