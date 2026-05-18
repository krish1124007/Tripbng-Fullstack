// WhatsApp channel — wraps the generic sendWhatsAppTemplate helper.
//
// Returns the same shape as the SMTP channel for uniform dispatcher handling.
// We DON'T throw on Meta errors — many of them are non-retryable (template
// not approved, recipient outside 24hr window, malformed param count). The
// dispatcher decides retry policy based on the result, not on thrown errors.

import { sendWhatsAppTemplate } from '../../notifications/whatsapp.service.js';
import type { RenderedWhatsApp, ResolvedRecipient } from '../types.js';

export interface WhatsAppSendResult {
  status: 'sent' | 'skipped' | 'failed';
  messageId?: string | null;
  reason?: string;
}

export async function sendWhatsApp(
  recipient: ResolvedRecipient,
  rendered: RenderedWhatsApp,
  opts?: { correlationKey?: string },
): Promise<WhatsAppSendResult> {
  if (!recipient.mobile) {
    return { status: 'skipped', reason: 'no recipient mobile' };
  }

  return sendWhatsAppTemplate({
    to: recipient.mobile,
    countryCode: recipient.countryCode ?? '+91',
    templateName: rendered.templateName,
    language: rendered.language,
    bodyParams: rendered.bodyParams,
    correlationKey: opts?.correlationKey,
  });
}
