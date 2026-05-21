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

import { Types } from 'mongoose';
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
import { env } from '../../config/env.js';
import { applyPayment, simulatePayment } from '../wallet/waterfall.service.js';

export interface InitiateTopupInput {
  walletId: Types.ObjectId;
  tenantId: Types.ObjectId;
  amount: number;
  providerCode: 'ICICI_ORANGE_PG' | 'PHONEPE';
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

    // ────────── Wallet credit — waterfall vs. legacy ──────────
    //
    // Branch:
    //   env.WATERFALL_LIVE === true  AND  pt.agencyId != null  → waterfall
    //   otherwise                                              → legacy
    //
    // The waterfall handles credit-settlement splits, CreditSettlement
    // snapshots, and the async DI incentive hand-off. It only knows about
    // agencies — distributor / user-attributed top-ups (no agencyId on the
    // PT) keep using the legacy walletService.credit path. The legacy path
    // also remains the safety net for fast-rollback (flip WATERFALL_LIVE
    // off in env, no code revert needed).
    //
    // The PT's walletTransactionId still links to a single row even when
    // the waterfall produces two — convention is to link to the TOPUP leg
    // (bucket=WALLET) so admin UI / drilldown views land in the place
    // operators expect. When the entire payment goes to credit settlement
    // (toWallet === 0), we link to the CREDIT_SETTLEMENT leg so the PT is
    // never orphaned.
    const idempotencyKey = `pt-${pt._id.toHexString()}`;
    let walletTxnLinkId: Types.ObjectId;
    let walletBalanceAfterForAlert: number | null = null;
    let waterfallApplied = false;

    if (env.WATERFALL_LIVE && pt.agencyId) {
      const result = await applyPayment({
        tenantId: pt.tenantId.toHexString(),
        agencyId: pt.agencyId.toHexString(),
        amountPaise: pt.amount,
        pgReferenceId: details.gatewayTxnId ?? pt.gatewayTxnId ?? `pt-${pt._id.toHexString()}`,
        pgGateway: pt.providerCode as 'ICICI_ORANGE_PG' | 'PHONEPE' | 'MANUAL',
        performedBy: pt.initiatedByUserId.toHexString(),
        description: `Wallet top-up via ${pt.providerCode}`,
        metadata: { paymentTransactionId: pt._id.toHexString(), idempotencyKey },
      });
      waterfallApplied = result.applied;
      // Pick the link row: prefer the TOPUP leg (it's where most followups
      // look), fall back to the CREDIT_SETTLEMENT leg if everything went to
      // settle credit. If `applied === false` (duplicate webhook), the
      // CreditSettlement row exists but ledgerEntries is empty — leave the
      // PT linkage unchanged in that case.
      const topupLeg = result.ledgerEntries.find((l) => l.type === 'TOPUP');
      const creditLeg = result.ledgerEntries.find((l) => l.type === 'CREDIT_SETTLEMENT');
      const linkLeg = topupLeg ?? creditLeg;
      if (linkLeg) {
        walletTxnLinkId = linkLeg._id;
      } else {
        // Duplicate webhook path. PT.walletTransactionId already points at
        // the row from the first call; preserve it.
        walletTxnLinkId = pt.walletTransactionId ?? new Types.ObjectId();
      }
      walletBalanceAfterForAlert = result.settlement.walletBalanceAfter;
    } else {
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
      walletTxnLinkId = walletTxn._id;
      walletBalanceAfterForAlert = walletTxn.balanceAfter ?? null;
    }

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
    pt.walletTransactionId = walletTxnLinkId;
    await pt.save();

    logger.info(
      {
        provider: pt.providerCode,
        txnCode: pt.txnCode,
        amount: pt.amount,
        verificationMethod: details.verificationMethod,
        // creditPath = how we landed the money: 'waterfall' splits credit
        // settlement vs. wallet, 'legacy' just credits the wallet flat.
        // Useful in the rollout window for filtering log slices.
        creditPath: env.WATERFALL_LIVE && pt.agencyId ? 'waterfall' : 'legacy',
        waterfallApplied,
      },
      'payment success',
    );

    // ────────── SHADOW_WALLET observation log (Phase 9, spec §18) ──────────
    //
    // The legacy walletService.credit above does a flat "amount → wallet"
    // top-up. The waterfall (waterfall.service.ts:applyPayment) would split
    // the same payment across credit-settlement + wallet + DI incentive + TDS
    // based on the agency's module. We're not ready to swap the live path
    // yet — but for the 2-week shadow window we run simulatePayment() AFTER
    // the legacy credit and emit a single structured log line that ops can
    // diff against the real ledger. Failures here MUST NOT poison a
    // successful payment, so the whole block is fire-and-forget under
    // try/catch.
    //
    // When WATERFALL_LIVE is on the simulation is a no-op — the legacy row
    // it was diffing against no longer exists, so the comparison would be
    // meaningless (and noisy). The post-cutover audit shifts from "shadow
    // vs. live" to "live waterfall vs. expected", which the Phase-10 admin
    // reports already cover.
    if (env.SHADOW_WALLET && !env.WATERFALL_LIVE && pt.agencyId) {
      const agencyId = pt.agencyId.toHexString();
      const tenantId = pt.tenantId.toHexString();
      void (async () => {
        try {
          const sim = await simulatePayment({
            tenantId,
            agencyId,
            amountPaise: pt.amount,
            pgReferenceId: pt.gatewayTxnId ?? `pt-${pt._id.toHexString()}`,
            pgGateway: pt.providerCode as 'ICICI_ORANGE_PG' | 'PHONEPE' | 'MANUAL',
            performedBy: pt.initiatedByUserId.toHexString(),
          });
          logger.info(
            {
              shadow: true,
              ptId: pt._id.toHexString(),
              txnCode: pt.txnCode,
              agencyId,
              module: sim.module,
              amountPaise: sim.amountReceivedPaise,
              legacyCreditedToWalletPaise: pt.amount,
              waterfallAppliedToCreditPaise: sim.appliedToCreditPaise,
              waterfallAppliedToWalletPaise: sim.appliedToWalletPaise,
              walletBalanceBeforePaise: sim.walletBalanceBeforePaise,
              creditUsedBeforePaise: sim.creditUsedBeforePaise,
              diIncentive: sim.diIncentive,
              // Drift flag: if these don't match, the agency would have
              // received a different settlement under the waterfall.
              wouldHaveDiverged: sim.appliedToCreditPaise > 0 || sim.diIncentive !== null,
            },
            'shadow.waterfall: simulation completed',
          );
        } catch (err) {
          logger.warn(
            { err, ptId: pt._id.toHexString(), agencyId },
            'shadow.waterfall: simulation failed — payment was still credited via legacy path',
          );
        }
      })();
    }

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
          walletBalancePaise: walletBalanceAfterForAlert,
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

  // ────────── Refund state transitions ──────────
  //
  // The refund lifecycle:
  //   SUCCESS → REFUND_INITIATED   (we received a refund-accepted webhook OR
  //                                  the provider's refund() call returned
  //                                  INITIATED — the gateway acknowledged
  //                                  the request but hasn't settled)
  //   REFUND_INITIATED → REFUNDED  (refund-completed webhook OR provider
  //                                  returned COMPLETED synchronously — at
  //                                  this moment we MUST debit the wallet
  //                                  so our balance stays truthful)
  //   REFUND_INITIATED → FAILED    (refund-failed webhook — undo the
  //                                  INITIATED transition; no wallet impact)
  //
  // Waterfall caveat: if the original topup was applied through the credit-
  // settlement waterfall (env.WATERFALL_LIVE && agencyId), reversing it
  // cleanly would require unwinding the split between WALLET / CREDIT /
  // DEPOSIT_INCENTIVE / TDS_DEDUCT. We don't attempt that here — instead we
  // mark the PT REFUNDED, emit a `gatewayResponsePayload` audit, and rely
  // on the ops alert + manual reconciliation. The booking gate already
  // refuses further drawdown when the agency owes money.

  async markRefundInitiated(
    paymentTxnId: Types.ObjectId,
    details: {
      gatewayRefundId?: string;
      gatewayResponsePayload?: Record<string, unknown>;
      reason?: string;
    },
  ): Promise<PaymentTransactionDoc> {
    const pt = await PaymentTransaction.findById(paymentTxnId);
    if (!pt) throw new AppError('NOT_FOUND');
    if (pt.status === 'REFUND_INITIATED' || pt.status === 'REFUNDED') return pt;
    if (!isValidTransition(pt.status, 'REFUND_INITIATED')) {
      throw new PaymentError(
        'INVALID_STATE_TRANSITION',
        `cannot transition ${pt.status} → REFUND_INITIATED`,
        pt.providerCode as PaymentProviderCode,
      );
    }
    pushStatusHistory(pt, 'REFUND_INITIATED', {
      reason: details.reason ?? 'refund requested',
      actor: 'WEBHOOK',
    });
    pt.status = 'REFUND_INITIATED';
    if (details.gatewayRefundId) pt.gatewayPaymentId = details.gatewayRefundId;
    if (details.gatewayResponsePayload !== undefined) {
      pt.gatewayResponsePayload = details.gatewayResponsePayload;
    }
    await pt.save();
    logger.info(
      {
        provider: pt.providerCode,
        txnCode: pt.txnCode,
        gatewayRefundId: details.gatewayRefundId,
      },
      'payment refund initiated',
    );
    return pt;
  }

  async markRefunded(
    paymentTxnId: Types.ObjectId,
    details: {
      gatewayRefundId?: string;
      gatewayResponsePayload?: Record<string, unknown>;
      webhookPayloadId?: Types.ObjectId;
    },
  ): Promise<PaymentTransactionDoc> {
    const pt = await PaymentTransaction.findById(paymentTxnId);
    if (!pt) throw new AppError('NOT_FOUND');
    if (pt.status === 'REFUNDED') return pt; // idempotent
    if (!isValidTransition(pt.status, 'REFUNDED')) {
      throw new PaymentError(
        'INVALID_STATE_TRANSITION',
        `cannot transition ${pt.status} → REFUNDED`,
        pt.providerCode as PaymentProviderCode,
      );
    }

    // Debit the wallet to reverse the original topup. Idempotent via
    // `pt-${id}-refund` key so duplicate refund-completed webhooks are safe.
    // We use `allowNegative: true` because the topup may have been spent;
    // the agency now owes the platform until they re-topup.
    //
    // For waterfall'd topups we still post a single TOPUP_REVERSAL row —
    // ops gets paged via the alert below and manually unwinds the credit-
    // settlement + DI / TDS legs. Doing it inline would double-spend the
    // reversal logic into the waterfall service.
    const wasWaterfall = env.WATERFALL_LIVE && !!pt.agencyId;
    const idempotencyKey = `pt-${pt._id.toHexString()}-refund`;
    let walletReversalTxnId: Types.ObjectId | null = null;
    try {
      const reversal = await walletService.debit({
        walletId: pt.walletId,
        amount: pt.amount,
        type: 'TOPUP_REVERSAL',
        description: `Refund of ${pt.txnCode} (gateway-pushed)`,
        performedBy: 'SYSTEM',
        paymentTransactionId: pt._id,
        relatedTxnId: pt.walletTransactionId ?? null,
        idempotencyKey,
        allowNegative: true,
        metadata: {
          providerCode: pt.providerCode,
          gatewayRefundId: details.gatewayRefundId,
          waterfallOriginal: wasWaterfall,
        },
      });
      walletReversalTxnId = reversal._id;
    } catch (err) {
      logger.error(
        { err, txnCode: pt.txnCode, gatewayRefundId: details.gatewayRefundId },
        'markRefunded: wallet debit FAILED — PT state still flipped to REFUNDED, ops must reconcile manually',
      );
      // Continue to mark REFUNDED anyway — the money DID leave the gateway,
      // and silently leaving the PT in REFUND_INITIATED is worse than a
      // ledger-mismatch row in the audit log.
    }

    pushStatusHistory(pt, 'REFUNDED', {
      reason: 'gateway confirmed refund settled',
      actor: 'WEBHOOK',
    });
    pt.status = 'REFUNDED';
    pt.refundedAt = new Date();
    if (details.gatewayRefundId) pt.gatewayPaymentId = details.gatewayRefundId;
    if (details.gatewayResponsePayload !== undefined) {
      pt.gatewayResponsePayload = details.gatewayResponsePayload;
    }
    if (details.webhookPayloadId) {
      pt.webhookPayloadId = details.webhookPayloadId;
      pt.webhookReceivedAt = new Date();
    }
    await pt.save();

    logger.info(
      {
        provider: pt.providerCode,
        txnCode: pt.txnCode,
        amount: pt.amount,
        gatewayRefundId: details.gatewayRefundId,
        walletReversalTxnId: walletReversalTxnId?.toHexString(),
        wasWaterfall,
      },
      'payment refunded — wallet reversed',
    );
    return pt;
  }

  async markRefundFailed(
    paymentTxnId: Types.ObjectId,
    details: {
      failureCode?: string;
      failureReason?: string;
      gatewayResponsePayload?: Record<string, unknown>;
    },
  ): Promise<PaymentTransactionDoc> {
    const pt = await PaymentTransaction.findById(paymentTxnId);
    if (!pt) throw new AppError('NOT_FOUND');
    // Only meaningful from REFUND_INITIATED. From any other state the gateway
    // can't actually fail a refund (because no refund was ever requested).
    if (pt.status !== 'REFUND_INITIATED') {
      logger.warn(
        { txnCode: pt.txnCode, status: pt.status },
        'markRefundFailed called on non-REFUND_INITIATED PT — ignoring',
      );
      return pt;
    }
    if (!isValidTransition(pt.status, 'FAILED')) {
      throw new PaymentError(
        'INVALID_STATE_TRANSITION',
        `cannot transition ${pt.status} → FAILED (refund-failed)`,
        pt.providerCode as PaymentProviderCode,
      );
    }
    pushStatusHistory(pt, 'FAILED', {
      reason: details.failureReason ?? details.failureCode ?? 'refund failed',
      actor: 'WEBHOOK',
    });
    pt.status = 'FAILED';
    pt.failureCode = details.failureCode ?? 'REFUND_FAILED';
    pt.failureReason = details.failureReason ?? 'gateway reported refund failure';
    if (details.gatewayResponsePayload !== undefined) {
      pt.gatewayResponsePayload = details.gatewayResponsePayload;
    }
    await pt.save();
    logger.warn(
      {
        provider: pt.providerCode,
        txnCode: pt.txnCode,
        failureCode: pt.failureCode,
      },
      'payment refund FAILED — wallet untouched',
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
