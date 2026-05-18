// Payment webhook processor — drains the PAYMENT_WEBHOOK queue.
//
// Why this queue exists: webhooks must respond 200 in under a few hundred ms
// or the gateway retries. Doing the full PT-update + wallet-credit chain
// inline blocks the event loop on slow Mongo or supplier latency. The route
// handler now persists the WebhookEvent + 200's the request, then enqueues
// here. The worker drains at its own pace (concurrency 20 — DB-bound).
//
// Idempotency: dedupe key (provider, gatewayTxnId, eventType) is checked
// inside the processor too, so even if BullMQ ever delivers a job twice
// (which it doesn't, but defensive), the wallet credit is single-shot.

import type { Job } from 'bullmq';
import { Types } from 'mongoose';
import { logger } from '../config/logger.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { PaymentTransaction } from '../models/PaymentTransaction.js';
import { paymentService } from '../services/payment/payment.service.js';
import { getProvider } from '../adapters/payment/registry.js';
import type { PaymentProviderCode } from '../adapters/payment/types.js';
import { runWithoutTenant } from '../middleware/tenant-context.js';

export interface PaymentWebhookJobData {
  webhookEventId: string;
}

export async function paymentWebhookProcessor(job: Job<PaymentWebhookJobData>): Promise<void> {
  const { webhookEventId } = job.data;
  // The webhook spans tenants — gateway POST doesn't carry our tenant id, so
  // every job runs with tenant guards bypassed. Each PT we touch carries its
  // own tenantId which the service layer scopes against where needed.
  await runWithoutTenant(async () => {
    const evt = await WebhookEvent.findById(webhookEventId);
    if (!evt) {
      logger.warn({ webhookEventId }, 'webhook job: event not found');
      return;
    }
    if (evt.processingStatus === 'PROCESSED' || evt.processingStatus === 'DUPLICATE') {
      return; // already drained, nothing to do
    }

    try {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(evt.rawBody) as Record<string, unknown>;
      } catch {
        parsed = { raw: evt.rawBody.slice(0, 500) };
      }
      const payload = (parsed['payload'] as { merchantOrderId?: string } | undefined) ?? {};
      const merchantOrderId = payload.merchantOrderId;
      if (!merchantOrderId) {
        evt.processingStatus = 'IGNORED';
        evt.processingError = 'no merchantOrderId';
        await evt.save();
        return;
      }

      const pt = await PaymentTransaction.findOne({ txnCode: merchantOrderId });
      if (!pt) {
        evt.processingStatus = 'FAILED';
        evt.processingError = 'PT not found';
        evt.gatewayTxnId = merchantOrderId;
        await evt.save();
        return;
      }

      // Re-verify signature (route handler may have skipped it on bad signatures).
      const provider = await getProvider({
        tenantId: pt.tenantId.toHexString(),
        providerCode: evt.providerCode as PaymentProviderCode,
      });
      const verified = provider.verifyWebhookSignature({
        headers: (evt.rawHeaders ?? {}) as Record<string, string>,
        rawBody: evt.rawBody,
        sourceIp: evt.sourceIp ?? undefined,
      });

      // Dedupe: same (provider, gatewayTxnId, eventType) already PROCESSED elsewhere.
      const dup = await WebhookEvent.findOne({
        providerCode: evt.providerCode,
        gatewayTxnId: merchantOrderId,
        eventType: verified.eventType,
        processingStatus: 'PROCESSED',
        _id: { $ne: evt._id },
      });
      if (dup) {
        evt.processingStatus = 'DUPLICATE';
        evt.gatewayTxnId = merchantOrderId;
        evt.parsedPayload = verified.parsed;
        evt.eventType = verified.eventType;
        evt.signatureValid = verified.signatureValid;
        evt.paymentTxnId = pt._id;
        await evt.save();
        return;
      }

      if (!verified.signatureValid) {
        logger.warn({ webhookEventId }, 'webhook signature invalid (in worker)');
        evt.processingStatus = 'FAILED';
        evt.processingError = 'signature invalid';
        evt.gatewayTxnId = merchantOrderId;
        evt.eventType = verified.eventType;
        evt.signatureValid = false;
        evt.parsedPayload = verified.parsed;
        evt.paymentTxnId = pt._id;
        await evt.save();
        return;
      }

      const eventType = verified.eventType.toUpperCase();
      if (eventType.includes('SUCCESS') || eventType.includes('COMPLETED')) {
        await paymentService.markSuccess(pt._id, {
          verificationMethod: 'WEBHOOK',
          webhookPayloadId: new Types.ObjectId(webhookEventId),
          gatewayTxnId: merchantOrderId,
          gatewayResponsePayload: verified.parsed,
        });
      } else if (eventType.includes('FAILED') || eventType.includes('CANCELLED')) {
        await paymentService.markFailed(pt._id, {
          failureCode: eventType,
          failureReason: 'gateway reported failure',
          gatewayResponsePayload: verified.parsed,
        });
      }

      evt.processingStatus = 'PROCESSED';
      evt.processedAt = new Date();
      evt.gatewayTxnId = merchantOrderId;
      evt.eventType = verified.eventType;
      evt.signatureValid = true;
      evt.parsedPayload = verified.parsed;
      evt.paymentTxnId = pt._id;
      evt.processingAttempts = (evt.processingAttempts ?? 0) + 1;
      await evt.save();
    } catch (err) {
      logger.error({ err, webhookEventId }, 'payment webhook worker failed — will retry');
      evt.processingAttempts = (evt.processingAttempts ?? 0) + 1;
      evt.processingError = err instanceof Error ? err.message : String(err);
      await evt.save().catch(() => undefined);
      throw err; // BullMQ records as failed → retries with backoff
    }
  });
}
