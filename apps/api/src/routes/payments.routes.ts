// Payment routes — gateway returns + webhooks (UNAUTHENTICATED), plus the
// authenticated top-up + status endpoints.
//
// The /webhook routes use a raw-body parser inline (not the global JSON
// middleware) because we need the EXACT bytes received to verify signatures.

import { Router, type Request, type Router as RouterT } from 'express';
import express from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  AppError,
  GatewayInitiateTopupRequestSchema,
  type GatewayInitiateTopupRequest,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { requireNotFrozen } from '../middleware/cutover-freeze.js';
import { topupAgencyLimit } from '../middleware/agency-rate-limit.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { logger } from '../config/logger.js';
import { PaymentTransaction } from '../models/PaymentTransaction.js';
import { Wallet } from '../models/Wallet.js';
import { WebhookEvent, type WebhookEventDoc } from '../models/WebhookEvent.js';
import { Agency } from '../models/Agency.js';
import { paymentService } from '../services/payment/payment.service.js';
import { walletService } from '../services/payment/wallet.service.js';
import { getProvider } from '../adapters/payment/registry.js';
import type { PaymentProviderCode } from '../adapters/payment/types.js';
import { getPaymentWebhookQueue } from '../queues/index.js';

export const paymentsRouter: RouterT = Router();

// ────────── Webhooks + return URLs (UNAUTHENTICATED, BEFORE auth middleware) ──────────

/**
 * PhonePe webhook. Spec §6.6.
 *   - Always responds 200 OK to prevent retries (PhonePe retries on non-2xx).
 *   - Stores the raw body verbatim for forensic replay.
 *   - Verifies signature; on mismatch, stores + warns but does not process.
 *   - Idempotent: dedupe key is (provider, gatewayTxnId, eventType).
 *   - Async processing: webhook handler returns 200 immediately, then a
 *     follow-up tick promotes the PT.
 */
paymentsRouter.post(
  '/phonepe/webhook',
  express.raw({ type: '*/*', limit: '256kb' }),
  async (req, res) => {
    // Always respond 200 immediately. Persist the raw event + enqueue for
    // async processing. PhonePe retries on non-2xx, so we never want
    // anything in this handler that can throw before the 200 lands.
    const rawBody = (req.body as Buffer | undefined)?.toString('utf8') ?? '';
    let event: WebhookEventDoc | null = null;
    try {
      event = (await WebhookEvent.create({
        providerCode: 'PHONEPE',
        rawHeaders: req.headers,
        rawBody,
        signature: (req.headers.authorization as string | undefined) ?? null,
        signatureValid: false, // worker re-verifies + updates
        sourceIp: req.ip,
        eventType: 'UNKNOWN',
      })) as WebhookEventDoc;
    } catch (err) {
      logger.error({ err }, 'failed to persist phonepe webhook (still 200ing PhonePe)');
    }

    res.status(200).json({ received: true });

    if (!event) return;
    try {
      const queue = getPaymentWebhookQueue();
      await queue.add(
        'phonepe',
        { webhookEventId: event._id.toString() },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      );
    } catch (err) {
      // If the queue is down, fall back to synchronous processing — better
      // to land slowly than to lose the event entirely.
      logger.error({ err, webhookEventId: event._id }, 'failed to enqueue webhook — processing inline as fallback');
      const { paymentWebhookProcessor } = await import('../queues/payment-webhook.worker.js');
      await paymentWebhookProcessor({ data: { webhookEventId: event._id.toString() } } as Parameters<typeof paymentWebhookProcessor>[0]);
    }
  },
);

/**
 * ICICI Orange PG return URL (browser POST after the customer completes
 * payment at the bank). UX path only — the wallet credit decision is also
 * made here, but the Payment Advice handler below is the authoritative
 * notification: a user who closes their browser mid-flow is reconciled
 * via that path.
 *
 *   1. Persist the raw body to WebhookEvent BEFORE any logic — forensic
 *      replay is the entire reason WebhookEvent exists.
 *   2. Verify the V1 secureHash. On mismatch we still 200 (so the browser
 *      lands on a result page) but the PT is NOT promoted; the advice
 *      handler or recon cron will resolve it.
 *   3. Branch on responseCode → markSuccess / markFailed. Idempotent —
 *      a second call (e.g. advice handler also hitting paymentService)
 *      converges via the state-transition guards inside paymentService.
 *   4. 302 to the existing result page (/payments/return?txnCode=...).
 */
paymentsRouter.post(
  '/icici-orange/return',
  express.urlencoded({ extended: true, limit: '64kb' }),
  async (req, res) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const merchantTxnNo = (body.merchantTxnNo ?? '').toString();
    const rawBody = new URLSearchParams(body).toString();

    // 1. Forensic replay — never depend on processing succeeding.
    let event: WebhookEventDoc | null = null;
    try {
      event = (await WebhookEvent.create({
        providerCode: 'ICICI_ORANGE_PG',
        eventType: body.responseCode ?? 'UNKNOWN',
        rawHeaders: req.headers,
        rawBody,
        signature: body.secureHash ?? null,
        signatureValid: false, // updated after verify
        sourceIp: req.ip,
      })) as WebhookEventDoc;
    } catch (err) {
      logger.error({ err, merchantTxnNo }, 'icici-orange return: failed to persist webhook event');
    }

    if (!merchantTxnNo) {
      return res.redirect('/payments/return?error=no-reference');
    }

    try {
      const pt = await PaymentTransaction.findOne({ txnCode: merchantTxnNo });
      if (!pt) {
        logger.warn({ merchantTxnNo }, 'icici-orange return: no matching PaymentTransaction');
        return res.redirect(`/payments/return?txnCode=${merchantTxnNo}&error=not-found`);
      }

      const provider = await getProvider({
        tenantId: pt.tenantId.toHexString(),
        providerCode: 'ICICI_ORANGE_PG',
      });
      const verified = await provider.verify({
        paymentTransactionCode: merchantTxnNo,
        // Pass through the body AND the raw bytes so the hash math runs
        // on what was actually received.
        rawPayload: { ...body, __rawBody: rawBody },
      });

      if (event) {
        event.signatureValid = true; // verify() throws on signature mismatch
        event.parsedPayload = verified.parsed;
        event.paymentTxnId = pt._id;
        event.processedAt = new Date();
        event.processingStatus = 'PROCESSED';
        await event.save();
      }

      if (verified.status === 'SUCCESS') {
        await paymentService.markSuccess(pt._id, {
          verificationMethod: 'RETURN_URL',
          gatewayTxnId: verified.gatewayTxnId,
          paymentInstrument: verified.paymentInstrument,
          paymentInstrumentDetails: verified.paymentInstrumentDetails,
          gatewayResponsePayload: verified.parsed,
          webhookPayloadId: event?._id,
        });
      } else if (verified.status === 'FAILED') {
        await paymentService.markFailed(pt._id, {
          failureCode: verified.failureCode,
          failureReason: verified.failureReason,
          gatewayResponsePayload: verified.parsed,
        });
      }
      // PENDING — let the advice handler / recon cron resolve.

      return res.redirect(`/payments/return?txnCode=${pt.txnCode}`);
    } catch (err) {
      logger.error({ err, merchantTxnNo }, 'icici-orange return-URL handler failed');
      if (event) {
        event.processingStatus = 'FAILED';
        event.processingError = err instanceof Error ? err.message : 'unknown';
        await event.save().catch(() => undefined);
      }
      return res.redirect(`/payments/return?txnCode=${merchantTxnNo}&error=verify-failed`);
    }
  },
);

/**
 * ICICI Orange PG Payment Advice (server-to-server). Authoritative — the
 * return URL above is for UX; this fires regardless of whether the user
 * closed their browser. Accepts both application/x-www-form-urlencoded
 * AND application/json (configured per-merchant during onboarding).
 *
 * ICICI retries on non-2xx, so this handler ALWAYS returns 200 unless
 * the payload is malformed or the signature is wrong.
 */
paymentsRouter.post(
  '/icici-orange/advice',
  express.raw({ type: '*/*', limit: '256kb' }),
  async (req, res) => {
    const rawBody = (req.body as Buffer | undefined)?.toString('utf8') ?? '';
    const contentType = req.headers['content-type'];

    let event: WebhookEventDoc | null = null;
    try {
      event = (await WebhookEvent.create({
        providerCode: 'ICICI_ORANGE_PG',
        eventType: 'ADVICE',
        rawHeaders: req.headers,
        rawBody,
        signatureValid: false,
        sourceIp: req.ip,
      })) as WebhookEventDoc;
    } catch (err) {
      logger.error({ err }, 'icici-orange advice: failed to persist webhook event');
    }

    // Always 200 immediately — async-process the rest so a slow path
    // here doesn't trigger ICICI retries.
    res.status(200).json({ received: true });

    if (!event) return;

    try {
      // We don't have a PT yet — look it up from the parsed body. The
      // provider's verifyWebhookSignature does the hash check.
      let probeEntries: Array<[string, string]>;
      if (contentType?.toString().includes('application/json')) {
        const parsed = JSON.parse(rawBody) as Record<string, unknown>;
        probeEntries = Object.entries(parsed)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
      } else {
        probeEntries = Array.from(new URLSearchParams(rawBody).entries());
      }
      const probeBody = new URLSearchParams(probeEntries);
      const merchantTxnNo = probeBody.get('merchantTxnNo') ?? '';
      const pt = merchantTxnNo
        ? await PaymentTransaction.findOne({ txnCode: merchantTxnNo })
        : null;

      const tenantId = pt ? pt.tenantId.toHexString() : null;
      if (!tenantId) {
        event.processingStatus = 'IGNORED';
        event.processingError = 'no matching PaymentTransaction';
        await event.save();
        return;
      }

      const provider = await getProvider({
        tenantId,
        providerCode: 'ICICI_ORANGE_PG',
      });
      const result = provider.verifyWebhookSignature({
        headers: req.headers as Record<string, string | string[] | undefined>,
        rawBody,
        sourceIp: req.ip,
      });

      event.signatureValid = result.signatureValid;
      event.parsedPayload = result.parsed;
      event.paymentTxnId = pt!._id;
      event.gatewayTxnId = result.gatewayTxnId ?? null;
      event.eventType = result.eventType;

      if (!result.signatureValid) {
        event.processingStatus = 'FAILED';
        event.processingError = 'secureHash mismatch';
        await event.save();
        return;
      }

      const responseCode = (result.parsed as { responseCode?: string }).responseCode ?? '';
      if (responseCode === '000' || responseCode === '0000') {
        await paymentService.markSuccess(pt!._id, {
          verificationMethod: 'WEBHOOK',
          gatewayTxnId: result.gatewayTxnId,
          gatewayResponsePayload: result.parsed,
          webhookPayloadId: event._id,
        });
      } else if (responseCode) {
        await paymentService.markFailed(pt!._id, {
          failureCode: responseCode,
          failureReason: (result.parsed as { respDescription?: string }).respDescription,
          gatewayResponsePayload: result.parsed,
        });
      }

      event.processingStatus = 'PROCESSED';
      event.processedAt = new Date();
      await event.save();
    } catch (err) {
      logger.error({ err }, 'icici-orange advice processing failed');
      if (event) {
        event.processingStatus = 'FAILED';
        event.processingError = err instanceof Error ? err.message : 'unknown';
        await event.save().catch(() => undefined);
      }
    }
  },
);

/** Orange PG (ICICI pgpay) return URL (POST). Verifies the V1 secureHash,
 *  marks the payment success/failed (markSuccess credits the wallet). */
paymentsRouter.post(
  '/orange-pg/return',
  express.urlencoded({ extended: true, limit: '64kb' }),
  async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const merchantTxnNo = (body['merchantTxnNo'] as string) ?? '';
    if (!merchantTxnNo) {
      return res.redirect('/wallet/topup/result?error=no-reference');
    }
    try {
      // gatewayTxnId was set to the provider session id (= merchantTxnNo) at
      // initiate; fall back to txnCode for safety.
      const pt =
        (await PaymentTransaction.findOne({ gatewayTxnId: merchantTxnNo })) ??
        (await PaymentTransaction.findOne({ txnCode: merchantTxnNo }));
      if (!pt) {
        return res.redirect(`/wallet/topup/result?ref=${merchantTxnNo}&error=not-found`);
      }
      const provider = await getProvider({
        tenantId: pt.tenantId.toHexString(),
        providerCode: 'ORANGE_PG',
      });
      const verified = await provider.verify({
        paymentTransactionCode: pt.txnCode,
        rawPayload: body,
      });
      if (verified.status === 'SUCCESS') {
        await paymentService.markSuccess(pt._id, {
          verificationMethod: 'RETURN_URL',
          gatewayTxnId: verified.gatewayTxnId,
          paymentInstrument: verified.paymentInstrument,
          paymentInstrumentDetails: verified.paymentInstrumentDetails,
          gatewayResponsePayload: verified.parsed,
        });
      } else if (verified.status === 'FAILED') {
        await paymentService.markFailed(pt._id, {
          failureCode: verified.failureCode,
          failureReason: verified.failureReason,
          gatewayResponsePayload: verified.parsed,
        });
      }
      return res.redirect(`/wallet/topup/result?ref=${pt.txnCode}`);
    } catch (err) {
      logger.error({ err, merchantTxnNo }, 'orange-pg return-URL handler failed');
      return res.redirect(`/wallet/topup/result?ref=${merchantTxnNo}&error=verify-failed`);
    }
  },
);

// ────────── Authenticated routes ──────────

paymentsRouter.use(authenticate, requireAuth);

const gate = requirePermission('search:flights'); // booking-trade gate; no separate "wallet:topup" yet

/** POST /api/v1/payments/topups/initiate */
paymentsRouter.post(
  '/topups/initiate',
  requireNotFrozen('topup'),
  topupAgencyLimit,
  gate,
  validate(GatewayInitiateTopupRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as GatewayInitiateTopupRequest;
      const tenantId = new Types.ObjectId(req.auth!.tenantId);

      // Resolve target wallet — caller's own agency wallet by default.
      let walletId: Types.ObjectId;
      if (body.walletId) {
        // Admin-only override.
        if (req.auth!.role !== 'SUPER_ADMIN') {
          throw new AppError('FORBIDDEN', { reason: 'walletId override is admin-only' });
        }
        walletId = new Types.ObjectId(body.walletId);
      } else if (req.auth!.agencyId) {
        const agency = await Agency.findById(req.auth!.agencyId).select('_id companyName').lean();
        if (!agency) throw new AppError('NOT_FOUND', { reason: 'agency not found' });
        const wallet = await walletService.findOrCreateForAgency(tenantId, agency._id);
        walletId = wallet._id;
      } else if (req.auth!.distributorId) {
        const wallet = await walletService.findOrCreateForDistributor(
          tenantId,
          new Types.ObjectId(req.auth!.distributorId),
        );
        walletId = wallet._id;
      } else {
        throw new AppError('FORBIDDEN', { reason: 'no wallet context for caller' });
      }

      const idempotencyKey = (req.headers['idempotency-key'] as string | undefined) ?? undefined;
      const result = await paymentService.initiateTopup({
        tenantId,
        walletId,
        amount: body.amount,
        providerCode: body.providerCode,
        initiatedByUserId: new Types.ObjectId(req.auth!.userId),
        agencyId: req.auth!.agencyId ? new Types.ObjectId(req.auth!.agencyId) : null,
        distributorId: req.auth!.distributorId
          ? new Types.ObjectId(req.auth!.distributorId)
          : null,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
        idempotencyKey,
        // When the agent kicked off this payment from a booking flow
        // (Pay Now → gateway), the bookingId travels through so the
        // webhook worker can auto-confirm the booking on SUCCESS.
        bookingId: body.bookingId ? new Types.ObjectId(body.bookingId) : null,
      });

      return ok(res, {
        paymentTxnId: result.paymentTxnId.toString(),
        txnCode: result.txnCode,
        redirectUrl: result.redirectUrl,
        method: result.method,
        formFields: result.formFields,
        expiresAt: result.expiresAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/v1/payments/:txnCode/status — poll endpoint for the result page. */
paymentsRouter.get('/:txnCode/status', gate, async (req, res, next) => {
  try {
    const tenantId = new Types.ObjectId(req.auth!.tenantId);
    const pt = await PaymentTransaction.findOne({ tenantId, txnCode: req.params.txnCode }).lean();
    if (!pt) throw new AppError('NOT_FOUND');
    return ok(res, {
      txnCode: pt.txnCode,
      status: pt.status,
      amount: pt.amount,
      providerCode: pt.providerCode,
      paymentInstrument: pt.paymentInstrument,
      failureReason: pt.failureReason,
      failureCode: pt.failureCode,
      completedAt: pt.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// ────────── Read endpoints ──────────

paymentsRouter.get('/topups', gate, async (req, res, next) => {
  try {
    const tenantId = new Types.ObjectId(req.auth!.tenantId);
    const filter: Record<string, unknown> = { tenantId, purpose: 'WALLET_TOPUP' };
    if (req.auth!.agencyId) filter.agencyId = new Types.ObjectId(req.auth!.agencyId);
    const list = await PaymentTransaction.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return ok(res, list);
  } catch (err) {
    next(err);
  }
});

paymentsRouter.get('/wallet/me', gate, async (req, res, next) => {
  try {
    const tenantId = new Types.ObjectId(req.auth!.tenantId);
    const filter = req.auth!.agencyId
      ? { tenantId, agencyId: new Types.ObjectId(req.auth!.agencyId) }
      : req.auth!.distributorId
        ? { tenantId, distributorId: new Types.ObjectId(req.auth!.distributorId) }
        : null;
    if (!filter) throw new AppError('FORBIDDEN');
    const wallet = await Wallet.findOne(filter).lean();
    if (!wallet) {
      // Lazy-create on first read so agency dashboards don't 404.
      const created = req.auth!.agencyId
        ? await walletService.findOrCreateForAgency(
            tenantId,
            new Types.ObjectId(req.auth!.agencyId),
          )
        : await walletService.findOrCreateForDistributor(
            tenantId,
            new Types.ObjectId(req.auth!.distributorId!),
          );
      return ok(res, created.toObject());
    }
    return ok(res, wallet);
  } catch (err) {
    next(err);
  }
});

const TransferSchema = z.object({
  toWalletId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  amount: z.number().int().min(1),
  note: z.string().max(240).optional(),
});

paymentsRouter.post(
  '/wallet/transfer',
  gate,
  validate(TransferSchema),
  async (req, res, next) => {
    try {
      // Source wallet = caller's own.
      const tenantId = new Types.ObjectId(req.auth!.tenantId);
      const fromOwner = req.auth!.distributorId
        ? await walletService.findOrCreateForDistributor(
            tenantId,
            new Types.ObjectId(req.auth!.distributorId),
          )
        : await walletService.findOrCreateForAgency(
            tenantId,
            new Types.ObjectId(req.auth!.agencyId!),
          );
      const idem = (req.headers['idempotency-key'] as string | undefined) ?? `xfer-${Date.now()}`;
      const out = await walletService.transfer({
        fromWalletId: fromOwner._id,
        toWalletId: new Types.ObjectId((req.body as { toWalletId: string }).toWalletId),
        amount: (req.body as { amount: number }).amount,
        description: (req.body as { note?: string }).note ?? 'Wallet transfer',
        performedBy: new Types.ObjectId(req.auth!.userId),
        idempotencyKey: idem,
      });
      return ok(res, {
        debitTxnId: out.debitTxn.txnId,
        creditTxnId: out.creditTxn.txnId,
      });
    } catch (err) {
      next(err);
    }
  },
);
