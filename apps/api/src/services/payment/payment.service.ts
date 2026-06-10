// PaymentService — gateway-side orchestration. Spec §7.
//
// Responsibilities:
//   1. initiateTopup — creates a PaymentTransaction, calls provider, returns
//      the redirect URL. Idempotent on idempotencyKey (24h via the unique
//      index on PaymentTransaction).
//   2. markSuccess — promotes a PT to SUCCESS, credits the wallet through
//      WalletService, links walletTransactionId. Concurrent calls (webhook +
//      return URL race) converge — second caller sees PT already SUCCESS
//      and short-circuits.
//   3. markFailed — terminal failure, no wallet impact.
//   4. sweepStalePayments — for PTs stuck in PENDING > 30 min, fetchStatus
//      from the provider and mark SUCCESS / FAILED / TIMEOUT accordingly.

import type { Types } from 'mongoose';
import { AppError } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { Counter } from '../../models/Counter.js';
import {
  PaymentTransaction,
  type PaymentTransactionDoc,
  type PaymentStatus,
} from '../../models/PaymentTransaction.js';
import { Wallet } from '../../models/Wallet.js';
import { getProvider } from '../../adapters/payment/registry.js';
import { isValidTransition, PaymentError, type PaymentProviderCode } from '../../adapters/payment/types.js';
import { walletService } from './wallet.service.js';
import { Actor, EVENTS, track } from '../analytics.service.js';
import { enqueueAlert } from '../alerts/index.js';

export interface InitiateTopupInput {
  walletId: Types.ObjectId;
  tenantId: Types.ObjectId;
  amount: number;
  providerCode: 'ICICI_EAZYPAY' | 'ORANGE_PG' | 'PHONEPE' | 'RAZORPAY';
  initiatedByUserId: Types.ObjectId;
  agencyId?: Types.ObjectId | null;
  agencyName?: string;
  distributorId?: Types.ObjectId | null;
  ipAddress?: string;
  userAgent?: string;
  idempotencyKey?: string;
  /** When supplied, the payment-webhook worker will auto-confirm
   *  this booking after the wallet is credited on SUCCESS. The
   *  PaymentTransaction's `purpose` flips to `BOOKING_PAYMENT` so
   *  the worker can branch on it. */
  bookingId?: Types.ObjectId | null;
}

export interface InitiateTopupResult {
  paymentTxnId: Types.ObjectId;
  txnCode: string;
  redirectUrl: string;
  formFields?: Record<string, string>;
  method: 'REDIRECT' | 'FORM_POST';
  expiresAt: Date;
}

export interface SuccessDetails {
  gatewayTxnId?: string;
  verificationMethod: 'WEBHOOK' | 'RETURN_URL' | 'POLL' | 'RECON_SWEEP' | 'MANUAL';
  webhookPayloadId?: Types.ObjectId;
  paymentInstrument?: PaymentTransactionDoc['paymentInstrument'];
  paymentInstrumentDetails?: Record<string, unknown>;
  gatewayResponsePayload?: unknown;
}

export interface FailureDetails {
  failureCode?: string;
  failureReason?: string;
  retryable?: boolean;
  gatewayResponsePayload?: unknown;
}

export class PaymentService {
  // ────────── Initiate ──────────

  async initiateTopup(input: InitiateTopupInput): Promise<InitiateTopupResult> {
    // Idempotency: same key in 24h returns the original PT.
    if (input.idempotencyKey) {
      const existing = await PaymentTransaction.findOne({ idempotencyKey: input.idempotencyKey });
      if (existing) return existingToResult(existing);
    }

    // Wallet must be ACTIVE.
    const wallet = await Wallet.findById(input.walletId);
    if (!wallet) throw new AppError('NOT_FOUND', { reason: 'wallet not found' });
    if (wallet.status !== 'ACTIVE') {
      throw new AppError('VALIDATION_ERROR', { reason: `wallet is ${wallet.status}` });
    }

    const provider = await getProvider({
      tenantId: input.tenantId.toHexString(),
      providerCode: input.providerCode,
    });

    const txnCode = await nextPaymentCode(input.tenantId);

    const pt = await PaymentTransaction.create({
      tenantId: input.tenantId,
      txnCode,
      walletId: input.walletId,
      initiatedByUserId: input.initiatedByUserId,
      agencyId: input.agencyId ?? null,
      distributorId: input.distributorId ?? null,
      // BOOKING_PAYMENT when the topup is linked to a specific
      // booking — webhook worker uses this to auto-confirm the
      // booking after the wallet is credited.
      purpose: input.bookingId ? 'BOOKING_PAYMENT' : 'WALLET_TOPUP',
      bookingId: input.bookingId ?? null,
      amount: input.amount,
      providerCode: input.providerCode,
      status: 'INITIATED',
      idempotencyKey: input.idempotencyKey ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });

    try {
      const session = await provider.initiate({
        paymentTransactionCode: pt.txnCode,
        amountPaise: pt.amount,
        walletId: pt.walletId,
        agencyId: pt.agencyId,
        agencyName: input.agencyName,
        initiatedByUserId: pt.initiatedByUserId,
        purpose: 'WALLET_TOPUP',
        ipAddress: pt.ipAddress ?? undefined,
        userAgent: pt.userAgent ?? undefined,
      });

      pt.status = 'PENDING';
      pt.gatewayTxnId = session.sessionId;
      pt.redirectedAt = new Date();
      pt.gatewayRequestPayload = session.formFields ?? null;
      await pt.save();

      track({
        event: EVENTS.TOPUP_INITIATED,
        distinctId: pt.agencyId
          ? Actor.agency(pt.agencyId.toHexString())
          : Actor.user(pt.initiatedByUserId.toHexString()),
        properties: {
          txn_code: pt.txnCode,
          payment_txn_id: pt._id.toHexString(),
          provider: pt.providerCode,
          amount_paise: pt.amount,
          method: session.method,
          tenant_id: pt.tenantId.toHexString(),
        },
      });

      return {
        paymentTxnId: pt._id,
        txnCode: pt.txnCode,
        redirectUrl: session.redirectUrl,
        formFields: session.formFields,
        method: session.method,
        expiresAt: session.expiresAt,
      };
    } catch (err) {
      pt.status = 'FAILED';
      pt.failureReason = err instanceof Error ? err.message : 'initiate failed';
      pt.failureCode = err instanceof PaymentError ? err.code : 'INITIATE_FAILED';
      await pt.save();
      throw err;
    }
  }

  // ────────── State transitions ──────────

  async markSuccess(paymentTxnId: Types.ObjectId, details: SuccessDetails): Promise<PaymentTransactionDoc> {
    const pt = await PaymentTransaction.findById(paymentTxnId);
    if (!pt) throw new AppError('NOT_FOUND', { reason: 'payment transaction not found' });

    // Concurrency safety — already SUCCESS = no-op (webhook + return URL race).
    if (pt.status === 'SUCCESS') return pt;
    if (!isValidTransition(pt.status, 'SUCCESS')) {
      throw new PaymentError(
        'INVALID_STATE_TRANSITION',
        `cannot transition ${pt.status} → SUCCESS`,
        pt.providerCode as PaymentProviderCode,
      );
    }

    // Credit the wallet — idempotent on PT id.
    const idempotencyKey = `pt-${pt._id.toHexString()}`;
    const walletTxn = await walletService.credit({
      walletId: pt.walletId,
      amount: pt.amount,
      type: 'TOPUP',
      description: `Wallet top-up via ${pt.providerCode}`,
      performedBy: pt.initiatedByUserId,
      paymentTransactionId: pt._id,
      idempotencyKey,
      metadata: {
        providerCode: pt.providerCode,
        gatewayTxnId: details.gatewayTxnId ?? pt.gatewayTxnId,
      },
    });

    pushStatusHistory(pt, 'SUCCESS', {
      reason: `verified via ${details.verificationMethod}`,
      actor: details.verificationMethod === 'MANUAL' ? null : details.verificationMethod,
      verificationMethod: details.verificationMethod,
    });
    pt.status = 'SUCCESS';
    pt.completedAt = new Date();
    pt.verificationMethod = details.verificationMethod;
    if (details.gatewayTxnId) pt.gatewayTxnId = details.gatewayTxnId;
    if (details.paymentInstrument) pt.paymentInstrument = details.paymentInstrument;
    if (details.paymentInstrumentDetails) pt.paymentInstrumentDetails = details.paymentInstrumentDetails;
    if (details.webhookPayloadId) {
      pt.webhookPayloadId = details.webhookPayloadId;
      pt.webhookReceivedAt = new Date();
    }
    if (details.gatewayResponsePayload !== undefined) {
      pt.gatewayResponsePayload = details.gatewayResponsePayload;
    }
    pt.walletTransactionId = walletTxn._id;
    await pt.save();

    logger.info(
      {
        provider: pt.providerCode,
        txnCode: pt.txnCode,
        amount: pt.amount,
        verificationMethod: details.verificationMethod,
      },
      'payment success',
    );

    track({
      event: EVENTS.TOPUP_SUCCEEDED,
      distinctId: pt.agencyId
        ? Actor.agency(pt.agencyId.toHexString())
        : Actor.user(pt.initiatedByUserId.toHexString()),
      properties: {
        txn_code: pt.txnCode,
        payment_txn_id: pt._id.toHexString(),
        provider: pt.providerCode,
        amount_paise: pt.amount,
        instrument: pt.paymentInstrument ?? null,
        verification_method: details.verificationMethod,
        elapsed_ms: pt.completedAt && pt.initiatedAt
          ? pt.completedAt.getTime() - pt.initiatedAt.getTime()
          : null,
        tenant_id: pt.tenantId.toHexString(),
      },
    });

    // Multi-channel alert. Recipients: the user who initiated the top-up
    // (so the agent gets the receipt) AND the agency owner (so cash-flow
    // visibility lives at the top of the org). Dedup happens in the
    // dispatcher when both refs resolve to the same email/mobile.
    void enqueueAlert(
      {
        event: 'TOPUP_SUCCEEDED',
        vars: {
          txnCode: pt.txnCode,
          amountPaise: pt.amount,
          provider: pt.providerCode,
          walletBalancePaise: walletTxn.balanceAfter ?? null,
        },
      },
      pt.agencyId
        ? [
            { kind: 'user', id: pt.initiatedByUserId.toHexString() },
            { kind: 'agency', id: pt.agencyId.toHexString() },
          ]
        : [{ kind: 'user', id: pt.initiatedByUserId.toHexString() }],
      {
        tenantId: pt.tenantId.toHexString(),
        correlationKey: `topup:${pt.txnCode}`,
      },
    );

    // ────────── BOOKING_PAYMENT auto-confirm ──────────
    //
    // When this topup was initiated from a Pay-Now booking flow, the
    // PT carries the booking id. Now that the wallet has the funds,
    // confirm the booking to ticket it immediately. This ensures the
    // booking doesn't sit in HELD until the user manually returns to
    // the result page (or worse, expires while they close the tab).
    //
    // Idempotent: confirmBooking guards against double-ticketing — if
    // the booking is already TICKETED we just no-op. Failure is
    // logged but never thrown — the wallet has the money, the agent
    // can manually confirm from the booking list page if needed.
    if (pt.purpose === 'BOOKING_PAYMENT' && pt.bookingId) {
      void autoConfirmBookingAfterTopup(pt);
    }

    return pt;
  }

  async markFailed(paymentTxnId: Types.ObjectId, details: FailureDetails): Promise<PaymentTransactionDoc> {
    const pt = await PaymentTransaction.findById(paymentTxnId);
    if (!pt) throw new AppError('NOT_FOUND');
    if (pt.status === 'SUCCESS') {
      // Don't fail an already-successful PT — webhook ordering can be weird.
      logger.warn({ txnCode: pt.txnCode }, 'markFailed called on SUCCESS PT — ignoring');
      return pt;
    }
    if (!isValidTransition(pt.status, 'FAILED')) {
      throw new PaymentError(
        'INVALID_STATE_TRANSITION',
        `cannot transition ${pt.status} → FAILED`,
      );
    }
    pushStatusHistory(pt, 'FAILED', {
      reason: details.failureReason ?? details.failureCode ?? 'failure',
    });
    pt.status = 'FAILED';
    pt.completedAt = new Date();
    pt.failureCode = details.failureCode ?? null;
    pt.failureReason = details.failureReason ?? null;
    pt.retryable = !!details.retryable;
    if (details.gatewayResponsePayload !== undefined) {
      pt.gatewayResponsePayload = details.gatewayResponsePayload;
    }
    await pt.save();

    track({
      event: EVENTS.TOPUP_FAILED,
      distinctId: pt.agencyId
        ? Actor.agency(pt.agencyId.toHexString())
        : Actor.user(pt.initiatedByUserId.toHexString()),
      properties: {
        txn_code: pt.txnCode,
        payment_txn_id: pt._id.toHexString(),
        provider: pt.providerCode,
        amount_paise: pt.amount,
        failure_code: pt.failureCode ?? null,
        failure_reason: pt.failureReason ?? null,
        retryable: pt.retryable,
        tenant_id: pt.tenantId.toHexString(),
      },
    });

    void enqueueAlert(
      {
        event: 'TOPUP_FAILED',
        vars: {
          txnCode: pt.txnCode,
          amountPaise: pt.amount,
          provider: pt.providerCode,
          walletBalancePaise: null,
          failureReason: pt.failureReason ?? pt.failureCode ?? null,
        },
      },
      [{ kind: 'user', id: pt.initiatedByUserId.toHexString() }],
      {
        tenantId: pt.tenantId.toHexString(),
        correlationKey: `topup:${pt.txnCode}`,
      },
    );

    return pt;
  }

  async markTimeout(paymentTxnId: Types.ObjectId): Promise<PaymentTransactionDoc> {
    const pt = await PaymentTransaction.findById(paymentTxnId);
    if (!pt) throw new AppError('NOT_FOUND');
    if (pt.status === 'SUCCESS' || pt.status === 'FAILED') return pt;
    pushStatusHistory(pt, 'TIMEOUT', { reason: 'session expired without resolution', actor: 'SYSTEM' });
    pt.status = 'TIMEOUT';
    pt.completedAt = new Date();
    pt.failureCode = 'TIMEOUT';
    pt.failureReason = 'session expired without resolution';
    await pt.save();

    track({
      event: EVENTS.TOPUP_TIMEOUT,
      distinctId: pt.agencyId
        ? Actor.agency(pt.agencyId.toHexString())
        : Actor.user(pt.initiatedByUserId.toHexString()),
      properties: {
        txn_code: pt.txnCode,
        payment_txn_id: pt._id.toHexString(),
        provider: pt.providerCode,
        amount_paise: pt.amount,
        tenant_id: pt.tenantId.toHexString(),
      },
    });

    // Treat timeouts as failures from the user's perspective — they need to
    // know the wallet wasn't credited. Distinct event-name on PostHog
    // (TOPUP_TIMEOUT) for funnel analysis, but the user-facing alert shape is
    // the same as a hard failure.
    void enqueueAlert(
      {
        event: 'TOPUP_FAILED',
        vars: {
          txnCode: pt.txnCode,
          amountPaise: pt.amount,
          provider: pt.providerCode,
          walletBalancePaise: null,
          failureReason: 'gateway did not confirm payment within the session window',
        },
      },
      [{ kind: 'user', id: pt.initiatedByUserId.toHexString() }],
      {
        tenantId: pt.tenantId.toHexString(),
        correlationKey: `topup:${pt.txnCode}`,
      },
    );

    return pt;
  }

  // ────────── Sweep ──────────

  /** For PTs in PENDING/PROCESSING > 30 min, ask the provider for status.
   *  Used by a 5-minute cron AND by ad-hoc reconciliation. */
  async sweepStalePayments(now: Date = new Date()): Promise<{ resolved: number; stillPending: number }> {
    const stale = await PaymentTransaction.find({
      status: { $in: ['PENDING', 'PROCESSING'] },
      initiatedAt: { $lt: new Date(now.getTime() - 30 * 60 * 1000) },
    }).limit(100); // safety bound per sweep

    let resolved = 0;
    let stillPending = 0;

    for (const pt of stale) {
      try {
        const provider = await getProvider({
          tenantId: pt.tenantId.toHexString(),
          providerCode: pt.providerCode as PaymentProviderCode,
        });
        const status = await provider.fetchStatus(pt.gatewayTxnId ?? pt.txnCode);
        if (status.terminal) {
          if (status.status === 'SUCCESS') {
            await this.markSuccess(pt._id, {
              verificationMethod: 'POLL',
              gatewayTxnId: status.gatewayTxnId,
            });
          } else {
            await this.markFailed(pt._id, {
              failureCode: status.failureCode ?? 'UNKNOWN',
              failureReason: status.failureReason,
            });
          }
          resolved++;
        } else if (now.getTime() - pt.initiatedAt.getTime() > 60 * 60 * 1000) {
          // > 1h still not terminal — give up.
          await this.markTimeout(pt._id);
          resolved++;
        } else {
          stillPending++;
        }
      } catch (err) {
        logger.warn({ err, txnCode: pt.txnCode }, 'sweep failed for one PT — continuing');
        stillPending++;
      }
    }

    return { resolved, stillPending };
  }
}

function pushStatusHistory(
  pt: PaymentTransactionDoc,
  to: PaymentStatus,
  meta: { reason?: string; actor?: string | null; verificationMethod?: string },
): void {
  // Mongoose initialises array subdocs to an empty array by default — the
  // explicit-init guard would only fire if the schema setter was bypassed,
  // which we don't do anywhere in the codebase. Just push.
  pt.statusHistory.push({
    from: pt.status,
    to,
    at: new Date(),
    reason: meta.reason ?? null,
    actor: meta.actor ?? null,
    verificationMethod: meta.verificationMethod ?? null,
  });
}

function existingToResult(pt: PaymentTransactionDoc): InitiateTopupResult {
  // For idempotent replays, we don't re-call the gateway — return what we
  // have. If the original PT was never PENDING (initiate failed), the
  // caller gets a redirectUrl that points at the failed-PT result page.
  return {
    paymentTxnId: pt._id,
    txnCode: pt.txnCode,
    redirectUrl: `/wallet/topup/result?ref=${pt.txnCode}`,
    method: 'REDIRECT',
    expiresAt: pt.initiatedAt,
  };
}

async function nextPaymentCode(tenantId: Types.ObjectId): Promise<string> {
  const c = await Counter.findOneAndUpdate(
    { _id: `paytxn-${tenantId.toHexString()}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return `PT${String(c.seq).padStart(7, '0')}`;
}

/**
 * Fire-and-forget booking auto-confirm after a successful gateway
 * topup. Imports are lazy because `booking.service.ts` itself
 * imports from `payment.service.ts` transitively (audit + alerts),
 * which would create a circular import at module-load time if we
 * placed the imports at the top.
 *
 * Failures are logged but not thrown — the wallet credit succeeded,
 * so the platform isn't out of pocket; the agent retains the option
 * to confirm manually from the booking detail page.
 */
async function autoConfirmBookingAfterTopup(pt: PaymentTransactionDoc): Promise<void> {
  try {
    const { Booking } = await import('../../models/Booking.js');
    const { confirmBooking } = await import('../booking.service.js');

    if (!pt.bookingId) return;
    const booking = await Booking.findById(pt.bookingId).lean();
    if (!booking) {
      logger.warn(
        { paymentTxnId: String(pt._id), bookingId: String(pt.bookingId) },
        'auto-confirm skipped — booking not found',
      );
      return;
    }
    // Already ticketed — guard against double-issue. Webhooks and the
    // return-url polling can race, both end up calling confirm.
    if (booking.status === 'TICKETED') {
      logger.info(
        { bookingId: String(booking._id), pnr: booking.pnr },
        'auto-confirm skipped — booking already ticketed',
      );
      return;
    }
    if (booking.status !== 'HOLD') {
      logger.warn(
        { bookingId: String(booking._id), status: booking.status },
        'auto-confirm skipped — booking not in HOLD state',
      );
      return;
    }

    const ticketed = await confirmBooking(
      {
        tenantId: pt.tenantId.toHexString(),
        userId: pt.initiatedByUserId.toHexString(),
        role: 'AGENCY', // booking metadata defines the actual agency; role is for audit only
        agencyId: pt.agencyId?.toHexString() ?? String(booking.agencyId),
        distributorId: pt.distributorId?.toHexString() ?? null,
        ipAddress: pt.ipAddress ?? null,
      },
      { bookingId: String(booking._id), paymentMode: 'WALLET', acceptTerms: true },
    );

    logger.info(
      {
        bookingId: String(booking._id),
        pnr: ticketed.pnr,
        ticketNumbers: ticketed.ticketNumbers,
        paymentTxnId: String(pt._id),
      },
      'booking auto-confirmed after gateway topup',
    );
  } catch (err) {
    logger.error(
      {
        err,
        paymentTxnId: String(pt._id),
        bookingId: String(pt.bookingId),
      },
      'auto-confirm failed — wallet was credited but ticket not issued. Agent can confirm manually.',
    );
  }
}

export const paymentService = new PaymentService();
