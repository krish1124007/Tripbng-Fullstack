// Alert dispatch worker — consumes alert-dispatch jobs and fans out to
// SMTP / WhatsApp / in-app channels.
//
// Why one job, multiple channels (vs. one job per channel):
//   - Channels are usually independent and fast (~1s each), so the per-job
//     overhead of three jobs would dominate the actual send time.
//   - We DO want per-channel retry isolation though — so we run all channels
//     in parallel inside the job and let individual channel-level failures
//     bubble up only if ALL of them fail. Partial success = job done.
//   - If a channel needs aggressive retries (e.g. SMTP times out), the whole
//     job retries — but the channels are idempotent in practice (SMTP dedup
//     via idempotency-keys-in-headers, WA dedup via duplicate-message-id
//     handling, in-app is a Mongo upsert). v1 accepts the small risk of
//     duplicate sends; v2 can split into per-channel jobs if it bites us.
//
// Job payload is the AlertJobData below — exactly what alertService.send()
// constructs. The worker re-resolves the recipient at process time so prefs
// changes (opt-out toggles) take effect even if the job sat in the queue.

import type { Job } from 'bullmq';
import type { ResolvedBranding } from '@tripbng/shared';
import { logger } from '../config/logger.js';
import { runWithoutTenant } from '../middleware/tenant-context.js';
import { Booking } from '../models/Booking.js';
import { sendInApp } from '../services/alerts/channels/inapp.channel.js';
import { sendEmail } from '../services/alerts/channels/smtp.channel.js';
import { sendWhatsApp } from '../services/alerts/channels/whatsapp.channel.js';
import { resolveRecipient } from '../services/alerts/recipient-resolver.js';
import { applyRecipientPrefs, channelsForEvent } from '../services/alerts/router.js';
import { TEMPLATES } from '../services/alerts/templates/index.js';
import {
  platformDefaults,
  resolveForBooking,
} from '../services/branding/branded-document.service.js';
import type {
  AlertChannel,
  AlertPayload,
  HoldExpiryVars,
  RecipientRef,
  ResolvedRecipient,
} from '../services/alerts/types.js';

export interface AlertJobData {
  event: AlertPayload['event'];
  vars: AlertPayload['vars'];
  recipients: RecipientRef[];
  /** Per-event channel override; null = use the router default. */
  channels?: AlertChannel[] | null;
  /** Tenant scope — needed by the in-app channel for the Notification doc. */
  tenantId: string;
  /** Free-form tag used for grouping logs (e.g. `booking:TR-1234`). */
  correlationKey?: string;
}

interface ChannelOutcome {
  channel: AlertChannel;
  recipient: string;
  status: string;
  reason?: string;
  messageId?: string | null;
}

export async function alertDispatchProcessor(job: Job<AlertJobData>): Promise<void> {
  const data = job.data;
  const template = TEMPLATES[data.event];
  if (!template) {
    logger.warn({ event: data.event }, 'alert dispatch: no template registered, skipping');
    return;
  }

  // Precondition gate — for events that may go stale between enqueue and
  // dispatch (delayed jobs in particular), skip dispatch when the underlying
  // state has changed. Currently only HOLD_EXPIRY_WARNING qualifies, but
  // future delayed alerts (low-balance auto-recheck, etc.) plug in here.
  if (!(await preconditionMet(data))) {
    logger.debug(
      { event: data.event, correlationKey: data.correlationKey },
      'alert dispatch: precondition no longer holds, skipping',
    );
    return;
  }

  const baseChannels = channelsForEvent(data.event, data.channels ?? null);
  const payload = { event: data.event, vars: data.vars } as AlertPayload;

  // Resolve per-tenant branding ONCE per job — every email render
  // shares the same colour palette + logo URL. We pick the booking_
  // contact recipient ref if present (that's the canonical "this
  // alert belongs to a booking" marker); transactional alerts that
  // don't carry a bookingId get platform defaults (no surprise
  // re-branding for system events like low-wallet-balance).
  const bookingContactRef = data.recipients.find(
    (r): r is Extract<RecipientRef, { kind: 'booking_contact' }> =>
      r.kind === 'booking_contact',
  );
  const branding: ResolvedBranding = bookingContactRef
    ? await resolveForBooking(String(bookingContactRef.bookingId)).catch(() =>
        platformDefaults(),
      )
    : platformDefaults();

  // Resolve every recipient once at the top — saves duplicate Mongo lookups
  // when the same agency owner is in `recipients` more than once (e.g.
  // bookedByUser === agencyOwner for sole proprietors).
  const resolved: Array<{ ref: RecipientRef; recipient: ResolvedRecipient | null }> =
    await Promise.all(
      data.recipients.map(async (ref) => ({
        ref,
        recipient: await resolveRecipient(ref).catch((err) => {
          logger.warn({ err, ref }, 'alert dispatch: recipient resolve failed');
          return null;
        }),
      })),
    );

  // Spread sends across recipients × channels in parallel. Promise.allSettled
  // so one channel exception doesn't tank the whole batch.
  //
  // Per-recipient prefs are applied INSIDE this loop so the same dispatch
  // can land different channel sets on different recipients (e.g. agency
  // owner gets all 3 channels, but the booking_contact who's a customer
  // not an agency-system user gets the global defaults).
  const tasks: Array<Promise<ChannelOutcome>> = [];
  for (const { ref, recipient } of resolved) {
    if (!recipient) {
      logger.debug({ ref, event: data.event }, 'alert dispatch: recipient unresolved, skipped');
      continue;
    }
    const channels = applyRecipientPrefs(
      baseChannels,
      data.event,
      recipient.notificationPrefs,
    );
    if (channels.length === 0) {
      logger.debug(
        { ref, event: data.event, agencyId: recipient.agencyId },
        'alert dispatch: recipient prefs disabled all channels, skipped',
      );
      continue;
    }
    for (const channel of channels) {
      tasks.push(
        runChannel(channel, recipient, payload, template, {
          tenantId: data.tenantId,
          event: data.event,
          correlationKey: data.correlationKey,
          branding,
        }),
      );
    }
  }

  const results = await Promise.allSettled(tasks);
  const outcomes = results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : ({ channel: 'unknown', recipient: 'unknown', status: 'failed', reason: String(r.reason) } as unknown as ChannelOutcome),
  );

  const failed = outcomes.filter((o) => o.status === 'failed');
  // Throw to trigger BullMQ retry only when EVERY channel failed AND we had
  // at least one to attempt — partial success counts as job done.
  if (tasks.length > 0 && failed.length === tasks.length) {
    throw new Error(
      `all channels failed for ${data.event}: ${failed.map((f) => f.reason).join('; ').slice(0, 500)}`,
    );
  }

  logger.info(
    {
      event: data.event,
      correlationKey: data.correlationKey,
      total: outcomes.length,
      sent: outcomes.filter((o) => o.status === 'sent').length,
      skipped: outcomes.filter((o) => o.status === 'skipped').length,
      failed: failed.length,
    },
    'alert dispatched',
  );
}

/**
 * Per-event precondition checks. Return false when the alert should be
 * dropped silently. Default-true so events without a check fall through.
 */
async function preconditionMet(data: AlertJobData): Promise<boolean> {
  if (data.event === 'HOLD_EXPIRY_WARNING') {
    const v = data.vars as HoldExpiryVars;
    const b = await runWithoutTenant(() =>
      Booking.findOne({ bookingCode: v.bookingCode }).select('status').lean(),
    );
    // Drop if booking confirmed / cancelled / expired before warning fires.
    return b?.status === 'HOLD';
  }
  return true;
}

async function runChannel(
  channel: AlertChannel,
  recipient: ResolvedRecipient,
  payload: AlertPayload,
  template: NonNullable<(typeof TEMPLATES)[AlertPayload['event']]>,
  ctx: {
    tenantId: string;
    event: AlertPayload['event'];
    correlationKey?: string;
    branding: ResolvedBranding;
  },
): Promise<ChannelOutcome> {
  // We wrap each channel send in runWithoutTenant() because the worker runs
  // outside the AsyncLocalStorage tenant context. The notification.service
  // emit() path explicitly passes tenantId, so we don't need a tenant set —
  // but the tenancy guard's safety check throws if neither is present.
  return runWithoutTenant(async () => {
    try {
      if (channel === 'email') {
        if (!template.email) {
          return { channel, recipient: recipient.email ?? '—', status: 'skipped', reason: 'template lacks email' };
        }
        // Pass branding as the second arg — templates that ignore it
        // (e.g. internal ops alerts) render with platform defaults.
        const rendered = template.email(payload, ctx.branding);
        const r = await sendEmail(recipient, rendered, { correlationKey: ctx.correlationKey });
        return { channel, recipient: recipient.email ?? '—', ...r };
      }
      if (channel === 'whatsapp') {
        if (!template.whatsapp) {
          return { channel, recipient: recipient.mobile ?? '—', status: 'skipped', reason: 'template lacks whatsapp' };
        }
        const rendered = template.whatsapp(payload);
        const r = await sendWhatsApp(recipient, rendered, { correlationKey: ctx.correlationKey });
        return { channel, recipient: recipient.mobile ?? '—', ...r };
      }
      if (channel === 'inapp') {
        if (!template.inapp) {
          return { channel, recipient: recipient.userId ?? '—', status: 'skipped', reason: 'template lacks inapp' };
        }
        const rendered = template.inapp(payload);
        const r = await sendInApp(recipient, rendered, {
          tenantId: ctx.tenantId,
          event: ctx.event,
        });
        return { channel, recipient: recipient.userId ?? '—', ...r };
      }
      return { channel, recipient: '—', status: 'skipped', reason: `unknown channel ${channel}` };
    } catch (err) {
      // Channel-level throws (e.g. SMTP outage) — surface as failed; the
      // dispatcher will decide whether to retry the whole job based on the
      // failed-vs-total ratio above.
      return {
        channel,
        recipient: recipient.email ?? recipient.mobile ?? recipient.userId ?? '—',
        status: 'failed',
        reason: err instanceof Error ? err.message : 'channel threw',
      };
    }
  });
}
