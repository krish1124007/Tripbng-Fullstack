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

/** ICICI Eazypay return URL (POST). Decrypts, marks success/failed. */
paymentsRouter.post(
  '/icici-eazypay/return',
  express.urlencoded({ extended: true, limit: '64kb' }),
  async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const referenceNo = (body['Reference No'] as string) ?? (body['ReferenceNo'] as string);
    if (!referenceNo) {
      return res.redirect('/wallet/topup/result?error=no-reference');
    }
    try {
      const pt = await PaymentTransaction.findOne({ txnCode: referenceNo });
      if (!pt) {
        return res.redirect(`/wallet/topup/result?ref=${referenceNo}&error=not-found`);
      }
      const provider = await getProvider({
        tenantId: pt.tenantId.toHexString(),
        providerCode: 'ICICI_EAZYPAY',
      });
      const verified = await provider.verify({
        paymentTransactionCode: referenceNo,
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
      logger.error({ err, referenceNo }, 'eazypay return-URL handler failed');
      return res.redirect(`/wallet/topup/result?ref=${referenceNo}&error=verify-failed`);
    }
  },
);

// ────────── Authenticated routes ──────────

paymentsRouter.use(authenticate, requireAuth);

const gate = requirePermission('search:flights'); // booking-trade gate; no separate "wallet:topup" yet

/** POST /api/v1/payments/topups/initiate */
paymentsRouter.post(
  '/topups/initiate',
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
