// Admin-only deep-health endpoints — gated behind SUPER_ADMIN.
//
// Distinct from the public healthRouter (liveness / readiness / Prometheus
// scrape) — those are unauthenticated by design so load balancers + ops
// can poll them. The endpoints here expose more sensitive operational
// detail (SMTP host, message-ids) and trigger side effects (test send),
// so they require an authenticated admin.

import { Router, type Router as RouterT } from 'express';
import { z } from 'zod';
import { AppError } from '@tripbng/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { registry } from '../config/metrics.js';
import { getSmtpTransport, verifySmtp } from '../config/smtp.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';

export const adminHealthRouter: RouterT = Router();

adminHealthRouter.use(authenticate, requireAuth, requireRole('SUPER_ADMIN'));

// GET /api/v1/health/smtp — non-destructive SMTP connectivity probe.
//   { configured, reachable, host, latencyMs }
adminHealthRouter.get('/smtp', async (_req, res, next) => {
  try {
    const configured = Boolean(env.SMTP_HOST);
    if (!configured) {
      return ok(res, {
        configured: false,
        reachable: false,
        host: null,
        latencyMs: null,
      });
    }
    const start = Date.now();
    const reachable = await verifySmtp();
    return ok(res, {
      configured: true,
      reachable,
      host: env.SMTP_HOST,
      latencyMs: Date.now() - start,
    });
  } catch (err) {
    next(err);
  }
});

const TestSendSchema = z.object({
  to: z.string().email().max(254),
});

// POST /api/v1/health/smtp/test — sends a small test email to confirm
// end-to-end deliverability. The body is intentionally bland (no PII)
// so the admin can grep their inbox without scrubbing.
adminHealthRouter.post(
  '/smtp/test',
  validate(TestSendSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof TestSendSchema>;
      const transport = getSmtpTransport();
      if (!transport) {
        throw new AppError('SUPPLIER_UNAVAILABLE', {
          reason: 'SMTP not configured (set SMTP_HOST in env)',
        });
      }

      const sentAt = new Date().toISOString();
      const subject = `TripBng SMTP test · ${sentAt}`;
      const text = [
        `This is a test message from the TripBng API.`,
        ``,
        `If you can read this, SMTP delivery is working.`,
        ``,
        `Sent at: ${sentAt}`,
        `Triggered by admin user: ${req.auth!.userId}`,
        `From host: ${env.API_BASE_URL}`,
      ].join('\n');

      const start = Date.now();
      const info = await transport.sendMail({
        from: env.SMTP_FROM,
        to: body.to,
        replyTo: env.SMTP_REPLY_TO ?? undefined,
        subject,
        text,
        headers: { 'X-TripBng-Test': '1' },
      });
      const durationMs = Date.now() - start;

      logger.info(
        {
          messageId: info.messageId,
          to: body.to,
          durationMs,
          triggeredBy: req.auth!.userId,
        },
        'smtp test-send: success',
      );

      return ok(res, {
        sent: true,
        messageId: info.messageId ?? null,
        to: body.to,
        durationMs,
        sentAt,
      });
    } catch (err) {
      logger.warn(
        { err, to: (req.body as { to?: string } | null)?.to },
        'smtp test-send: failed',
      );
      next(err);
    }
  },
);

// GET /api/v1/health/smtp/stats — human-readable snapshot of the SMTP metrics.
// The Prometheus /metrics endpoint is the source of truth; this view is a
// dashboard convenience so an admin can sanity-check counts without
// standing up a separate Prometheus + Grafana stack for dev/staging.
adminHealthRouter.get('/smtp/stats', async (_req, res, next) => {
  try {
    const metrics = await registry.getMetricsAsJSON();
    const sent = metrics.find((m) => m.name === 'email_sent_total');
    const duration = metrics.find((m) => m.name === 'email_send_duration_seconds');
    const attachments = metrics.find((m) => m.name === 'email_attachments_total');

    // Roll up `sent` counter by event+outcome — easier to read than the raw
    // Prom JSON.
    const byEvent: Record<string, { sent: number; skipped: number; failed: number }> = {};
    for (const v of (sent?.values ?? []) as Array<{
      value: number;
      labels: { event?: string; outcome?: string };
    }>) {
      const event = v.labels.event ?? 'unknown';
      const outcome = (v.labels.outcome ?? 'unknown') as 'sent' | 'skipped' | 'failed';
      byEvent[event] = byEvent[event] ?? { sent: 0, skipped: 0, failed: 0 };
      if (outcome === 'sent' || outcome === 'skipped' || outcome === 'failed') {
        byEvent[event][outcome] += v.value;
      }
    }

    const attachmentsByEvent: Record<string, number> = {};
    for (const v of (attachments?.values ?? []) as Array<{
      value: number;
      labels: { event?: string };
    }>) {
      attachmentsByEvent[v.labels.event ?? 'unknown'] = v.value;
    }

    return ok(res, {
      configured: Boolean(env.SMTP_HOST),
      host: env.SMTP_HOST ?? null,
      byEvent,
      attachmentsByEvent,
      // Histogram percentiles aren't exposed by prom-client directly — point
      // the admin at /metrics for full p50/p95/p99 if they need it.
      durationHistogramAvailable: Boolean(duration),
    });
  } catch (err) {
    next(err);
  }
});
