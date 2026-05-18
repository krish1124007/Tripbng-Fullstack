import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPriority,
  PublicNotification,
} from '@tripbng/shared';
import { Notification, type NotificationDoc } from '../models/Notification.js';
import { logger } from '../config/logger.js';

export interface NotificationInput {
  tenantId: string;
  userId: string;
  agencyId?: string | null;
  distributorId?: string | null;
  category: NotificationCategory;
  channel?: NotificationChannel;
  priority?: NotificationPriority;
  title: string;
  body: string;
  href?: string | null;
  metadata?: Record<string, unknown> | null;
}

// emit — central choke point for everything that lights up notifications. In-app records
// always land in Mongo; EMAIL/SMS additionally fan out to provider stubs so the UX of having
// "queued" the message is honest even when the prod provider isn't configured.
export async function emit(input: NotificationInput): Promise<NotificationDoc> {
  const channel = input.channel ?? 'IN_APP';
  const doc = await Notification.create({
    tenantId: input.tenantId,
    userId: input.userId,
    agencyId: input.agencyId ?? null,
    distributorId: input.distributorId ?? null,
    category: input.category,
    channel,
    priority: input.priority ?? 'NORMAL',
    title: input.title,
    body: input.body,
    href: input.href ?? null,
    metadata: input.metadata ?? null,
  });

  if (channel === 'EMAIL') {
    void deliverEmail(doc).catch((err) => {
      logger.error({ err, notificationId: String(doc._id) }, 'email delivery failed');
    });
  }
  if (channel === 'SMS') {
    void deliverSms(doc).catch((err) => {
      logger.error({ err, notificationId: String(doc._id) }, 'sms delivery failed');
    });
  }

  return doc;
}

// emitToAgencyMembers — fan out the same notification to every active user under an agency.
// Used when a system event affects the whole team (booking ticketed, refund processed).
export async function emitToAgencyMembers(
  tenantId: string,
  agencyId: string,
  payload: Omit<NotificationInput, 'tenantId' | 'userId' | 'agencyId'>,
): Promise<NotificationDoc[]> {
  const { User } = await import('../models/User.js');
  const users = await User.find({
    tenantId,
    agencyId,
    status: 'ACTIVE',
  })
    .select('_id')
    .lean();
  return Promise.all(
    users.map((u) => emit({ ...payload, tenantId, userId: String(u._id), agencyId })),
  );
}

export function serializeNotification(n: NotificationDoc): PublicNotification {
  return {
    id: String(n._id),
    category: n.category,
    channel: n.channel ?? 'IN_APP',
    priority: n.priority ?? 'NORMAL',
    title: n.title,
    body: n.body,
    href: n.href ?? null,
    read: n.read ?? false,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    metadata: n.metadata ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

// deliverEmail — Resend is the spec primary. Without a key, log and mark as queued; the
// audit trail remains. The same shape extends to AWS SES later by swapping the provider.
async function deliverEmail(notification: NotificationDoc): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn(
      { notificationId: String(notification._id) },
      'RESEND_API_KEY not set — email queued in-DB, no outbound send',
    );
    notification.deliveryError = 'provider not configured';
    await notification.save();
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? 'noreply@tripbng.dev',
        to: [notification.metadata?.email].filter(Boolean),
        subject: notification.title,
        text: notification.body,
      }),
    });
    if (!res.ok) {
      throw new Error(`resend ${res.status}`);
    }
    const json = (await res.json()) as { id?: string };
    notification.deliveredAt = new Date();
    notification.providerRef = json.id ?? null;
    await notification.save();
  } catch (err) {
    notification.deliveryError = (err as Error).message;
    await notification.save();
    // Push to the retry queue with exponential backoff. The worker picks it up.
    try {
      const { getEmailRetryQueue } = await import('../queues/index.js');
      await getEmailRetryQueue().add(
        'retry',
        { notificationId: String(notification._id) },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: 50,
          removeOnFail: 200,
        },
      );
    } catch (queueErr) {
      logger.error(
        { queueErr, notificationId: String(notification._id) },
        'failed to enqueue retry',
      );
    }
    throw err;
  }
}

// deliverSms — MSG91 is the spec primary for India. Same configured-or-queue pattern.
async function deliverSms(notification: NotificationDoc): Promise<void> {
  const authKey = process.env.MSG91_AUTH_KEY;
  if (!authKey) {
    logger.warn(
      { notificationId: String(notification._id) },
      'MSG91_AUTH_KEY not set — sms queued in-DB, no outbound send',
    );
    notification.deliveryError = 'provider not configured';
    await notification.save();
    return;
  }
  // MSG91's flow API expects DLT-templated payloads; the wiring is documented per template.
  // For Phase 6 we record the intent — Phase 7 wires real templates per use case.
  notification.deliveryError = 'sms provider integration pending DLT template wiring';
  await notification.save();
}
