// Two-person approval workflow for manual wallet adjustments (spec §7).
//
// Routing:
//   proposeAdjustment(ctx, args)
//     amountPaise ≤ threshold  → executes adjustWallet immediately,
//                                returns { executed: true, ledgerTxnId }
//     amountPaise >  threshold → creates PendingAdjustment row with
//                                status=PENDING_APPROVAL, returns
//                                { executed: false, pendingId }
//
//   approveAdjustment(ctx, id)
//     Different admin than proposer required. Flips row to APPROVED,
//     calls adjustWallet, stamps the resulting ledgerTxnId on the row.
//
//   rejectAdjustment(ctx, id, reason)
//     Terminal — no ledger impact, captures the reason for audit.
//
// Why we don't just rely on RBAC for one-person approval:
//   Manual ledger postings are the highest-risk operator action — a single
//   compromised admin account could move arbitrary money. Spec §7 calls
//   for two-person approval above the threshold (default ₹10,000), the
//   most basic SOX-style separation-of-duties control.
//
// Audit
//   The propose/approve/reject path each writes an audit log row. The
//   eventual ledger entry (when status=APPROVED) is itself audit-logged
//   by adjustWallet, with the PendingAdjustment id in metadata.

import { AppError, type Role } from '@tripbng/shared';
import { env } from '../../config/env.js';
import { Agency } from '../../models/Agency.js';
import { Distributor } from '../../models/Distributor.js';
import {
  PendingAdjustment,
  type PendingAdjustmentDoc,
} from '../../models/PendingAdjustment.js';
import { recordAudit } from '../audit.service.js';
import { adjustWallet } from './adjust.js';

// Local context — admins don't carry an `agencyId` / `distributorId`, so we
// don't burden callers with passing nulls for those. Matches the pattern
// distributor-transfer.service.ts uses for its admin paths.
export interface AdjustApprovalContext {
  tenantId: string;
  userId: string;
  role: Role;
  ipAddress?: string | null;
}

export interface ProposeAdjustmentInput {
  direction: 'CREDIT' | 'DEBIT';
  amountPaise: number;
  reason: string;
  /** Exactly one of these must be set. */
  agencyId?: string | null;
  distributorId?: string | null;
}

export type ProposeAdjustmentResult =
  | {
      executed: true;
      ledgerTxnId: string;
      /** Always null on the immediate path; populated on the approval path. */
      pendingId: null;
    }
  | {
      executed: false;
      pendingId: string;
      ledgerTxnId: null;
    };

/**
 * Entry point for admin-initiated manual wallet adjustments. Routes between
 * the immediate-execute path and the two-person-approval path based on the
 * configured threshold.
 */
export async function proposeAdjustment(
  ctx: AdjustApprovalContext,
  input: ProposeAdjustmentInput,
): Promise<ProposeAdjustmentResult> {
  assertAdmin(ctx);
  validateInput(input);
  await validateOwnerExists(ctx, input);

  const threshold = env.WALLET_ADJUSTMENT_APPROVAL_THRESHOLD_PAISE;
  if (input.amountPaise <= threshold) {
    // Below threshold — direct execute. adjustWallet does its own audit row.
    const result = await adjustWallet(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        role: ctx.role,
        agencyId: null,
        distributorId: null,
        ipAddress: ctx.ipAddress ?? null,
      },
      {
        direction: input.direction,
        amountPaise: input.amountPaise,
        reason: input.reason,
        ...(input.agencyId ? { agencyId: input.agencyId } : {}),
        ...(input.distributorId ? { distributorId: input.distributorId } : {}),
      },
    );
    return { executed: true, ledgerTxnId: result.txnId, pendingId: null };
  }

  // Above threshold — stage for second-admin approval.
  const pending = await PendingAdjustment.create({
    tenantId: ctx.tenantId,
    agencyId: input.agencyId ?? null,
    distributorId: input.distributorId ?? null,
    direction: input.direction,
    amountPaise: input.amountPaise,
    reason: input.reason,
    proposedBy: ctx.userId,
    status: 'PENDING_APPROVAL',
    thresholdAtTime: threshold,
  });

  await recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: 'wallet.adjustment.proposed',
    resource: 'pending-adjustment',
    resourceId: String(pending._id),
    after: {
      direction: input.direction,
      amountPaise: input.amountPaise,
      reason: input.reason,
      agencyId: input.agencyId ?? null,
      distributorId: input.distributorId ?? null,
    },
    ip: ctx.ipAddress ?? null,
  });

  return { executed: false, pendingId: String(pending._id), ledgerTxnId: null };
}

/**
 * Second admin's approval. Different user than the proposer required —
 * approving your own proposal would defeat the purpose of the control.
 *
 * Idempotent on already-APPROVED rows: re-calling returns the row without
 * posting a second ledger entry.
 */
export async function approveAdjustment(
  ctx: AdjustApprovalContext,
  pendingId: string,
): Promise<PendingAdjustmentDoc> {
  assertAdmin(ctx);
  const pending = await loadPending(ctx, pendingId);

  if (pending.status === 'APPROVED') {
    return pending;
  }
  if (pending.status !== 'PENDING_APPROVAL') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `adjustment is ${pending.status}, cannot approve`,
    });
  }
  if (String(pending.proposedBy) === ctx.userId) {
    throw new AppError('FORBIDDEN', {
      reason: 'approver must be a different admin than the proposer',
    });
  }

  // Execute the underlying ledger entry FIRST, then mark approved. If the
  // ledger write fails, the row stays PENDING and ops can investigate; we
  // don't want a row marked APPROVED with no matching ledger entry.
  const result = await adjustWallet(
    {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      role: ctx.role,
      // adjustWallet's ActorContext requires these on the underlying type;
      // admins don't carry them, so we pass null per its signature.
      agencyId: null,
      distributorId: null,
      ipAddress: ctx.ipAddress ?? null,
    },
    {
      direction: pending.direction,
      amountPaise: pending.amountPaise,
      reason: `[approved: ${String(pending._id)}] ${pending.reason}`,
      ...(pending.agencyId ? { agencyId: String(pending.agencyId) } : {}),
      ...(pending.distributorId ? { distributorId: String(pending.distributorId) } : {}),
    },
  );

  pending.status = 'APPROVED';
  pending.approvedBy = ctx.userId as unknown as PendingAdjustmentDoc['approvedBy'];
  pending.approvedAt = new Date();
  pending.ledgerTxnId = result.txnId as unknown as PendingAdjustmentDoc['ledgerTxnId'];
  await pending.save();

  await recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: 'wallet.adjustment.approved',
    resource: 'pending-adjustment',
    resourceId: String(pending._id),
    after: {
      direction: pending.direction,
      amountPaise: pending.amountPaise,
      ledgerTxnId: result.txnId,
    },
    ip: ctx.ipAddress ?? null,
  });

  return pending;
}

export async function rejectAdjustment(
  ctx: AdjustApprovalContext,
  pendingId: string,
  reason: string,
): Promise<PendingAdjustmentDoc> {
  assertAdmin(ctx);
  if (!reason || reason.length < 3) {
    throw new AppError('VALIDATION_ERROR', { reason: 'rejection reason required' });
  }
  const pending = await loadPending(ctx, pendingId);
  if (pending.status !== 'PENDING_APPROVAL') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `adjustment is ${pending.status}, cannot reject`,
    });
  }
  pending.status = 'REJECTED';
  pending.rejectionReason = reason;
  pending.approvedBy = ctx.userId as unknown as PendingAdjustmentDoc['approvedBy'];
  pending.approvedAt = new Date();
  await pending.save();

  await recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: 'wallet.adjustment.rejected',
    resource: 'pending-adjustment',
    resourceId: String(pending._id),
    after: { reason },
    ip: ctx.ipAddress ?? null,
  });
  return pending;
}

/** Self-service cancel — only the original proposer may cancel their own
 *  pending row. Distinct from REJECTED (which represents a second admin's
 *  decision). */
export async function cancelAdjustment(
  ctx: AdjustApprovalContext,
  pendingId: string,
): Promise<PendingAdjustmentDoc> {
  assertAdmin(ctx);
  const pending = await loadPending(ctx, pendingId);
  if (String(pending.proposedBy) !== ctx.userId) {
    throw new AppError('FORBIDDEN', {
      reason: 'only the original proposer may cancel a pending adjustment',
    });
  }
  if (pending.status !== 'PENDING_APPROVAL') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `adjustment is ${pending.status}, cannot cancel`,
    });
  }
  pending.status = 'CANCELLED';
  pending.approvedAt = new Date();
  await pending.save();
  await recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: 'wallet.adjustment.cancelled',
    resource: 'pending-adjustment',
    resourceId: String(pending._id),
    ip: ctx.ipAddress ?? null,
  });
  return pending;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function assertAdmin(ctx: AdjustApprovalContext): void {
  if (ctx.role !== ('SUPER_ADMIN' as Role)) {
    throw new AppError('FORBIDDEN', { reason: 'admin-only action' });
  }
}

function validateInput(input: ProposeAdjustmentInput): void {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'amountPaise must be a positive integer' });
  }
  if (!input.reason || input.reason.length < 3) {
    throw new AppError('VALIDATION_ERROR', { reason: 'reason required (min 3 chars)' });
  }
  const ownerCount = [input.agencyId, input.distributorId].filter(Boolean).length;
  if (ownerCount !== 1) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'exactly one of agencyId or distributorId required',
    });
  }
}

async function validateOwnerExists(
  ctx: AdjustApprovalContext,
  input: ProposeAdjustmentInput,
): Promise<void> {
  if (input.agencyId) {
    const a = await Agency.findOne({ _id: input.agencyId, tenantId: ctx.tenantId })
      .select('_id')
      .lean();
    if (!a) throw new AppError('AGENCY_NOT_FOUND');
  } else if (input.distributorId) {
    const d = await Distributor.findOne({ _id: input.distributorId, tenantId: ctx.tenantId })
      .select('_id')
      .lean();
    if (!d) throw new AppError('DISTRIBUTOR_NOT_FOUND');
  }
}

async function loadPending(
  ctx: AdjustApprovalContext,
  pendingId: string,
): Promise<PendingAdjustmentDoc> {
  const row = await PendingAdjustment.findOne({ _id: pendingId, tenantId: ctx.tenantId });
  if (!row) throw new AppError('NOT_FOUND');
  return row;
}
