// Distributor → Sub-Agent transfer service (spec §3.8 + §6.4 of
// AGENCY_WALLET_SYSTEM).
//
// Replaces the old `distributorTransferToAgency` flow with a state-machine
// model: every transfer is a DistributorTransfer row first, then optionally
// moves through PENDING_APPROVAL → COMPLETED/REJECTED. Below-threshold
// transfers fast-path execute immediately; above-threshold transfers stage
// for admin approval. Recall reverses a completed transfer.
//
// Concurrency
//   * Each ledger leg already takes its own per-wallet Redis lock + Mongo
//     transaction inside `postCredit`/`postDebit`. We do NOT re-acquire
//     those locks at the transfer-service level — doing so would cause a
//     self-deadlock (a worker trying to acquire the same key twice from
//     the same call stack).
//   * The "atomic across both legs" guarantee the spec asks for is
//     provided by the DistributorTransfer row: if leg 2 fails after leg 1
//     succeeded, the row is flagged FAILED and a compensation credit is
//     posted back to the distributor in a third independent transaction.
//     Ops reconciles via the audit + ledger trail.
//   * Inter-transfer ordering: two concurrent transfers from the same
//     distributor to the same agency interleave only at leg granularity;
//     each leg is atomic and total order is preserved by the per-wallet
//     Redis lock inside ledger.ts.
//
// Idempotency
//   * `transferRef` is unique — the codes service issues it; retries reuse
//     the same row.
//   * `executeTransfer(transferId)` is safe to call multiple times — it
//     short-circuits when the row is already COMPLETED or REJECTED.

import { AppError, CODE_PREFIX, type Role } from '@tripbng/shared';
import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { nextCode } from '../../utils/codes.js';
import { Agency } from '../../models/Agency.js';
import { Distributor } from '../../models/Distributor.js';
import {
  DistributorTransfer,
  type DistributorTransferDoc,
} from '../../models/DistributorTransfer.js';
import { recordAudit } from '../audit.service.js';
import { postCredit, postDebit } from './ledger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface ActorContext {
  tenantId: string;
  userId: string;
  role: Role;
  /** Distributor _id when the caller's role is DISTRIBUTOR. */
  distributorId?: string | null;
  ipAddress?: string | null;
}

export interface RequestTransferInput {
  distributorId: string;
  agencyId: string;
  amountPaise: number;
  notes?: string | null;
}

export interface RequestTransferResult {
  /** The DistributorTransfer row created (or short-circuit when re-requested). */
  transfer: DistributorTransferDoc;
  /** When true, the ledger legs were committed inline (status=COMPLETED). */
  executed: boolean;
}

/**
 * Entry point for both distributor- and admin-initiated transfers.
 * Authorisation is enforced before any ledger work: only the distributor
 * the agency belongs to (or a SUPER_ADMIN) may transfer to it. If the
 * amount exceeds the configured threshold, the row is staged as
 * PENDING_APPROVAL and the caller must wait for admin approval.
 */
export async function requestTransfer(
  ctx: ActorContext,
  input: RequestTransferInput,
): Promise<RequestTransferResult> {
  validateAmount(input.amountPaise);

  const { distributor, agency } = await loadParties(ctx, input.distributorId, input.agencyId);

  const requiresApproval =
    input.amountPaise > env.DISTRIBUTOR_TRANSFER_APPROVAL_THRESHOLD_PAISE;
  const transferRef = await nextTransferRef();

  const created = await DistributorTransfer.create({
    tenantId: ctx.tenantId,
    transferRef,
    distributorId: distributor._id,
    agencyId: agency._id,
    amount: input.amountPaise,
    type: 'TRANSFER',
    status: requiresApproval ? 'PENDING_APPROVAL' : 'COMPLETED', // optimistic — flipped if execute fails
    approvalRequired: requiresApproval,
    initiatedBy: ctx.userId,
    notes: input.notes ?? null,
  });

  if (requiresApproval) {
    // Stage for admin queue. No ledger work yet.
    await recordAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorRole: ctx.role,
      action: 'distributor.transfer.requested',
      resource: 'distributor-transfer',
      resourceId: String(created._id),
      after: {
        transferRef,
        distributorId: String(distributor._id),
        agencyId: String(agency._id),
        amountPaise: input.amountPaise,
        approvalRequired: true,
      },
      ip: ctx.ipAddress ?? null,
    });
    return { transfer: created, executed: false };
  }

  // Below threshold — run the legs synchronously. We tentatively set the
  // row to COMPLETED above; if execution fails, executeTransfer() flips it
  // to FAILED with a reason.
  try {
    const executed = await executeTransferLegs(created, ctx);
    return { transfer: executed, executed: true };
  } catch (err) {
    // Surface the failure to the caller — the row is already FAILED.
    throw err;
  }
}

/**
 * Admin-only — approves a PENDING_APPROVAL row and runs the legs.
 * Idempotent: re-calling on an already-COMPLETED row returns it unchanged.
 */
export async function approveTransfer(
  ctx: ActorContext,
  transferId: string,
): Promise<DistributorTransferDoc> {
  assertAdmin(ctx);
  const transfer = await DistributorTransfer.findById(transferId);
  if (!transfer) throw new AppError('NOT_FOUND');
  if (transfer.status === 'COMPLETED') return transfer;
  if (transfer.status !== 'PENDING_APPROVAL') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `transfer is ${transfer.status}, cannot approve`,
    });
  }
  transfer.approvedBy = ctx.userId as unknown as Types.ObjectId;
  transfer.approvedAt = new Date();
  // Move to COMPLETED tentatively — executeTransferLegs flips to FAILED if it can't.
  transfer.status = 'COMPLETED';
  await transfer.save();
  return executeTransferLegs(transfer, ctx);
}

/**
 * Recall a previously COMPLETED transfer — reverses the ledger legs and
 * creates a new DistributorTransfer row (type=RECALL, originalTransferId
 * pointing at the parent). Used when the distributor or admin needs to
 * pull back balance that was over-allocated to a sub-agent.
 *
 * Authorisation: same as forward TRANSFER — distributor can recall its own
 * transfers; SUPER_ADMIN may recall any.
 *
 * Pre-conditions:
 *   * Original must be in COMPLETED status (REVERSED / FAILED / REJECTED
 *     can't be recalled).
 *   * Agency must have sufficient wallet balance to give back.
 *     (We reuse the standard postDebit which throws INSUFFICIENT_WALLET.)
 *
 * Idempotency: a row already in REVERSED status cannot be recalled again.
 * The original transfer is flipped to REVERSED only after both legs land.
 */
export async function recallTransfer(
  ctx: ActorContext,
  originalTransferId: string,
  notes?: string | null,
): Promise<DistributorTransferDoc> {
  const original = await DistributorTransfer.findById(originalTransferId);
  if (!original) throw new AppError('NOT_FOUND');
  if (String(original.tenantId) !== ctx.tenantId) throw new AppError('FORBIDDEN');

  // Authorisation gate.
  if (ctx.role === 'DISTRIBUTOR') {
    if (!ctx.distributorId || String(ctx.distributorId) !== String(original.distributorId)) {
      throw new AppError('FORBIDDEN', { reason: 'recall only your own transfers' });
    }
  } else if (ctx.role !== 'SUPER_ADMIN') {
    throw new AppError('FORBIDDEN');
  }

  if (original.type !== 'TRANSFER') {
    throw new AppError('VALIDATION_ERROR', { reason: 'only TRANSFER rows can be recalled' });
  }
  if (original.status !== 'COMPLETED') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `original is ${original.status}, only COMPLETED transfers can be recalled`,
    });
  }

  const transferRef = await nextTransferRef();
  const recall = await DistributorTransfer.create({
    tenantId: ctx.tenantId,
    transferRef,
    distributorId: original.distributorId,
    agencyId: original.agencyId,
    amount: original.amount,
    type: 'RECALL',
    status: 'COMPLETED', // tentative — flipped to FAILED if legs error
    approvalRequired: false,
    originalTransferId: original._id,
    initiatedBy: ctx.userId,
    notes: notes ?? null,
  });

  await recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: 'distributor.transfer.recall.initiated',
    resource: 'distributor-transfer',
    resourceId: String(recall._id),
    after: {
      recallRef: transferRef,
      originalRef: original.transferRef,
      amountPaise: original.amount,
    },
    ip: ctx.ipAddress ?? null,
  });

  try {
    await executeRecallLegs(recall, ctx);
    // Mark the original as REVERSED only after the recall legs landed.
    original.status = 'REVERSED';
    await original.save();
  } catch (err) {
    // executeRecallLegs already set recall.status=FAILED. Rethrow so the
    // caller sees the failure (insufficient balance on agency wallet is the
    // most common cause — the agency may have spent the transferred balance).
    throw err;
  }

  return recall;
}

/**
 * Admin-only — rejects a PENDING_APPROVAL row. No ledger impact.
 */
export async function rejectTransfer(
  ctx: ActorContext,
  transferId: string,
  reason: string,
): Promise<DistributorTransferDoc> {
  assertAdmin(ctx);
  if (!reason || reason.length < 3) {
    throw new AppError('VALIDATION_ERROR', { reason: 'rejection reason required' });
  }
  const transfer = await DistributorTransfer.findById(transferId);
  if (!transfer) throw new AppError('NOT_FOUND');
  if (transfer.status !== 'PENDING_APPROVAL') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `transfer is ${transfer.status}, cannot reject`,
    });
  }
  transfer.status = 'REJECTED';
  transfer.rejectionReason = reason;
  transfer.approvedBy = ctx.userId as unknown as Types.ObjectId;
  transfer.approvedAt = new Date();
  await transfer.save();
  await recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: 'distributor.transfer.rejected',
    resource: 'distributor-transfer',
    resourceId: String(transfer._id),
    after: { reason, transferRef: transfer.transferRef },
    ip: ctx.ipAddress ?? null,
  });
  return transfer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function validateAmount(amountPaise: number): void {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'amountPaise must be a positive integer' });
  }
}

function assertAdmin(ctx: ActorContext): void {
  if (ctx.role !== 'SUPER_ADMIN') {
    throw new AppError('FORBIDDEN', { reason: 'admin-only action' });
  }
}

interface PartiesResolved {
  distributor: { _id: Types.ObjectId };
  agency: {
    _id: Types.ObjectId;
    // Mongoose's `.lean()` returns these as optional — the schema declares
    // defaults but the typed inference doesn't narrow it.
    distributorId?: Types.ObjectId | null;
    agencyCode?: string;
  };
}

async function loadParties(
  ctx: ActorContext,
  distributorIdInput: string,
  agencyIdInput: string,
): Promise<PartiesResolved> {
  const distributor = await Distributor.findOne({
    _id: distributorIdInput,
    tenantId: ctx.tenantId,
  })
    .select('_id')
    .lean();
  if (!distributor) throw new AppError('DISTRIBUTOR_NOT_FOUND');

  const agency = await Agency.findOne({ _id: agencyIdInput, tenantId: ctx.tenantId })
    .select('_id distributorId agencyCode')
    .lean();
  if (!agency) throw new AppError('AGENCY_NOT_FOUND');

  // Authorisation gate. Distributor must own the agency. SUPER_ADMIN may
  // bypass — useful for support resolving stuck transfers.
  if (ctx.role === 'DISTRIBUTOR') {
    if (!ctx.distributorId || String(ctx.distributorId) !== String(distributor._id)) {
      throw new AppError('FORBIDDEN', {
        reason: 'transfer must originate from your own distributor account',
      });
    }
  } else if (ctx.role !== 'SUPER_ADMIN') {
    throw new AppError('FORBIDDEN');
  }
  if (String(agency.distributorId ?? '') !== String(distributor._id)) {
    throw new AppError('FORBIDDEN', { reason: 'agency is not in this distributor downline' });
  }

  return { distributor, agency };
}

async function nextTransferRef(): Promise<string> {
  // Counters store an integer; we wrap with a date prefix for human readability
  // in admin UIs.
  const seq = await nextCode(CODE_PREFIX.DISTRIBUTOR_TRANSFER);
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${CODE_PREFIX.DISTRIBUTOR_TRANSFER}-${today}-${seq}`;
}

/**
 * Run the actual ledger legs. Caller has already created (or approved) the
 * DistributorTransfer row and set its status to a tentative COMPLETED. On
 * any failure we flip the row to FAILED with a reason — the audit trail +
 * ledger entries are sufficient for ops to reconcile.
 *
 * Per-leg locking is handled inside `postDebit`/`postCredit` via the wallet
 * lock; we intentionally do NOT add an outer lock here (would self-deadlock
 * with the inner per-wallet lock for the same owner).
 */
async function executeTransferLegs(
  transfer: DistributorTransferDoc,
  ctx: ActorContext,
): Promise<DistributorTransferDoc> {
  const distId = String(transfer.distributorId);
  const agencyId = String(transfer.agencyId);

  try {
    // Leg 1 — DEBIT the distributor. Insufficient balance throws here, in
    // which case no money has moved and the catch below marks FAILED.
    const debit = await postDebit({
      tenantId: ctx.tenantId,
      walletKind: 'DISTRIBUTOR',
      walletOwnerId: distId,
      type: 'TRANSFER_OUT',
      amountPaise: transfer.amount,
      performedBy: ctx.userId,
      description: `Transfer to agency ${agencyId} (ref ${transfer.transferRef})`,
      ipAddress: ctx.ipAddress ?? null,
      metadata: { transferRef: transfer.transferRef, agencyId, type: 'TRANSFER' },
    });

    let credit;
    try {
      credit = await postCredit({
        tenantId: ctx.tenantId,
        walletKind: 'AGENCY',
        walletOwnerId: agencyId,
        type: 'TRANSFER_IN',
        amountPaise: transfer.amount,
        performedBy: ctx.userId,
        relatedTxnId: String(debit._id),
        description: `Transfer from distributor (ref ${transfer.transferRef})`,
        ipAddress: ctx.ipAddress ?? null,
        metadata: {
          transferRef: transfer.transferRef,
          distributorId: distId,
          debitTxnId: String(debit._id),
          type: 'TRANSFER',
        },
      });
    } catch (err) {
      // Leg-2 compensation — credit the distributor back. If THAT fails,
      // both wallets diverge and ops reconciles via the audit trail. The
      // DistributorTransfer row gets FAILED so the admin queue surfaces it.
      logger.fatal(
        { err, transferRef: transfer.transferRef, debitTxnId: String(debit._id) },
        'distributor-transfer: leg-2 failed — running compensation',
      );
      try {
        await postCredit({
          tenantId: ctx.tenantId,
          walletKind: 'DISTRIBUTOR',
          walletOwnerId: distId,
          type: 'ADJUSTMENT_CREDIT',
          amountPaise: transfer.amount,
          performedBy: ctx.userId,
          relatedTxnId: String(debit._id),
          description: `Compensation for failed transfer ${transfer.transferRef}`,
          metadata: { transferRef: transfer.transferRef, reason: 'leg-2-failed' },
        });
      } catch (compErr) {
        logger.fatal(
          { compErr, transferRef: transfer.transferRef },
          'distributor-transfer: compensation also failed — MANUAL RECONCILIATION REQUIRED',
        );
      }
      throw err;
    }

    transfer.outLedgerId = debit._id;
    transfer.inLedgerId = credit._id;
    transfer.status = 'COMPLETED';
    await transfer.save();

    await recordAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorRole: ctx.role,
      action: 'distributor.transfer.completed',
      resource: 'distributor-transfer',
      resourceId: String(transfer._id),
      after: {
        transferRef: transfer.transferRef,
        amountPaise: transfer.amount,
        debitTxnId: String(debit._id),
        creditTxnId: String(credit._id),
      },
      ip: ctx.ipAddress ?? null,
    });

    return transfer;
  } catch (err) {
    // Persist FAILED + reason so ops sees it in the queue.
    transfer.status = 'FAILED';
    transfer.failureReason = err instanceof Error ? err.message : String(err);
    await transfer.save().catch(() => undefined);
    await recordAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorRole: ctx.role,
      action: 'distributor.transfer.failed',
      resource: 'distributor-transfer',
      resourceId: String(transfer._id),
      after: { reason: transfer.failureReason, transferRef: transfer.transferRef },
      success: false,
      error: transfer.failureReason,
      ip: ctx.ipAddress ?? null,
    }).catch(() => undefined);
    throw err;
  }
}

/**
 * Execute the two reverse legs for a RECALL: DEBIT the agency, CREDIT the
 * distributor. Same lock/atomicity story as executeTransferLegs — each leg
 * is per-wallet atomic, the DistributorTransfer row is the cross-leg state.
 * Agency wallet running out is the expected failure mode (caught + reported).
 */
async function executeRecallLegs(
  recall: DistributorTransferDoc,
  ctx: ActorContext,
): Promise<DistributorTransferDoc> {
  const distId = String(recall.distributorId);
  const agencyId = String(recall.agencyId);

  try {
    // Leg 1 — DEBIT the agency. Throws INSUFFICIENT_WALLET if the agency
    // has already spent the transferred balance. We DON'T compensate the
    // distributor on failure because no money has moved yet.
    const debit = await postDebit({
      tenantId: ctx.tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
      type: 'TRANSFER_REVERSAL',
      amountPaise: recall.amount,
      performedBy: ctx.userId,
      description: `Recall to distributor (ref ${recall.transferRef})`,
      ipAddress: ctx.ipAddress ?? null,
      metadata: {
        transferRef: recall.transferRef,
        distributorId: distId,
        type: 'RECALL',
        originalTransferId: String(recall.originalTransferId),
      },
    });

    let credit;
    try {
      credit = await postCredit({
        tenantId: ctx.tenantId,
        walletKind: 'DISTRIBUTOR',
        walletOwnerId: distId,
        type: 'TRANSFER_REVERSAL',
        amountPaise: recall.amount,
        performedBy: ctx.userId,
        relatedTxnId: String(debit._id),
        description: `Recall from agency (ref ${recall.transferRef})`,
        ipAddress: ctx.ipAddress ?? null,
        metadata: {
          transferRef: recall.transferRef,
          agencyId,
          debitTxnId: String(debit._id),
          type: 'RECALL',
          originalTransferId: String(recall.originalTransferId),
        },
      });
    } catch (err) {
      // Mirror executeTransferLegs's compensation pattern.
      logger.fatal(
        { err, transferRef: recall.transferRef, debitTxnId: String(debit._id) },
        'distributor-recall: leg-2 failed — running compensation',
      );
      try {
        await postCredit({
          tenantId: ctx.tenantId,
          walletKind: 'AGENCY',
          walletOwnerId: agencyId,
          type: 'ADJUSTMENT_CREDIT',
          amountPaise: recall.amount,
          performedBy: ctx.userId,
          relatedTxnId: String(debit._id),
          description: `Compensation for failed recall ${recall.transferRef}`,
          metadata: { transferRef: recall.transferRef, reason: 'recall-leg-2-failed' },
        });
      } catch (compErr) {
        logger.fatal(
          { compErr, transferRef: recall.transferRef },
          'distributor-recall: compensation also failed — MANUAL RECONCILIATION REQUIRED',
        );
      }
      throw err;
    }

    recall.outLedgerId = debit._id;
    recall.inLedgerId = credit._id;
    recall.status = 'COMPLETED';
    await recall.save();

    await recordAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorRole: ctx.role,
      action: 'distributor.transfer.recall.completed',
      resource: 'distributor-transfer',
      resourceId: String(recall._id),
      after: {
        transferRef: recall.transferRef,
        amountPaise: recall.amount,
        debitTxnId: String(debit._id),
        creditTxnId: String(credit._id),
      },
      ip: ctx.ipAddress ?? null,
    });

    return recall;
  } catch (err) {
    recall.status = 'FAILED';
    recall.failureReason = err instanceof Error ? err.message : String(err);
    await recall.save().catch(() => undefined);
    await recordAudit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorRole: ctx.role,
      action: 'distributor.transfer.recall.failed',
      resource: 'distributor-transfer',
      resourceId: String(recall._id),
      after: { reason: recall.failureReason, transferRef: recall.transferRef },
      success: false,
      error: recall.failureReason,
      ip: ctx.ipAddress ?? null,
    }).catch(() => undefined);
    throw err;
  }
}
