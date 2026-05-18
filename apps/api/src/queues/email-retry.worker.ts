import type { Job } from 'bullmq';
import { Notification } from '../models/Notification.js';
import { logger } from '../config/logger.js';

interface EmailRetryJobData {
  notificationId: string;
}

// emailRetryProcessor — re-attempts a failed Resend send. The notification service writes
// jobs to this queue when Resend returns non-2xx OR fetch fails outright. BullMQ handles
// the exponential-backoff retry policy via the queue defaults.
export async function emailRetryProcessor(job: Job<EmailRetryJobData>): Promise<void> {
  const { notificationId } = job.data;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Don't burn retries when there's no provider — bail early so the job marks completed.
    logger.warn({ notificationId }, 'RESEND_API_KEY missing — skipping retry');
    return;
  }
  const n = await Notification.findById(notificationId);
  if (!n) return;
  if (n.deliveredAt) return; // Already delivered out-of-band.

  const email = (n.metadata as { email?: string } | null)?.email;
  if (!email) {
    n.deliveryError = 'no recipient email in metadata';
    await n.save();
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? 'noreply@tripbng.dev',
      to: [email],
      subject: n.title,
      text: n.body,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`resend ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id?: string };
  n.deliveredAt = new Date();
  n.providerRef = json.id ?? null;
  n.deliveryError = null;
  await n.save();
}
