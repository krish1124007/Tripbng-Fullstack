// ApprovalRequest CRUD + state-machine service.
//
// Public surface (consumed by REST routes + booking flow in Phase 6):
//
//   submitBusApproval(actor, input)   — create a request; auto-approves
//                                       when fare ≤ autoApproveBelowPaise
//   approveApproval(actor, id, note?) — pending → approved
//   rejectApproval(actor, id, note)   — pending → rejected (note ≥ 10 chars)
//   markApprovalBooked(id, bookingId) — approved → booked (Phase 6 hook)
//   getMyApprovals(actor, filters)    — list for the calling employee
//   getPendingForManager(actor)       — manager's queue
//   sweepExpired()                    — bulk expire stale pending requests
//                                       (called by the BullMQ sweeper)
//
// Authorisation gates:
//   - submit: any tenant member who has an Employee row
//   - approve / reject: must be the employee's `managerId` OR a
//     tenant_admin / SUPER_ADMIN
//   - read: employee sees own; manager/tenant_admin see their queue;
//     SUPER_ADMIN sees all

import { Types } from 'mongoose';
import { AppError } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { recordAudit } from '../audit.service.js';
import { Employee } from '../../models/Employee.js';
import {
  ApprovalRequest,
  APPROVAL_STATUS,
  isValidApprovalTransition,
  type ApprovalRequestDoc,
  type ApprovalStatus,
} from '../../models/ApprovalRequest.js';
import { resolvePolicyForEmployee } from './policy.service.js';
import {
  evaluateBusPolicy,
  type PolicyEvalContext,
  type PolicyEvalResult,
} from './policy-eval.js';

export interface ApprovalActor {
  tenantId: string;
  userId: string;
  role: string;
  /** Set when the actor is acting on behalf of a specific employee.
   *  Routes that read JWT auth populate this from the request body
   *  (`employeeId`) after permission checks. */
  employeeId?: string;
  ipAddress?: string | null;
}

export interface SubmitBusApprovalInput {
  /** Who's travelling. The actor.userId may differ if a travel-desk
   *  admin is submitting on behalf of an employee. */
  employeeId: string;

  /** Trip context — snapshotted into the ApprovalRequest payload. */
  sourceCityId: number;
  destinationCityId: number;
  doj: string;
  tripId: string;
  inventoryId: string;
  seatNumbers: string[];
  boardingPointId: number;
  droppingPointId: number;
  estimatedFarePaise: number;
  operatorName?: string;
  operatorId: number;
  busType?: string;
  busTypeId?: number;
  isAc?: boolean;
  isSleeper?: boolean;
  departureAt: string;
  arrivalAt: string;
}

export interface SubmitBusApprovalResult {
  approval: ApprovalRequestDoc;
  /** What policy-eval said. Useful for the SPA to surface "auto-approved"
   *  vs "out of policy: X" inline before showing the manager-pending
   *  state. */
  policy: PolicyEvalResult;
}

// ────────── Submit ──────────

export async function submitBusApproval(
  actor: ApprovalActor,
  input: SubmitBusApprovalInput,
): Promise<SubmitBusApprovalResult> {
  if (!Types.ObjectId.isValid(input.employeeId)) {
    throw new AppError('VALIDATION_ERROR', { reason: 'employeeId must be a valid ObjectId' });
  }
  if (input.seatNumbers.length === 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'at least one seat is required' });
  }
  if (input.estimatedFarePaise <= 0 || !Number.isInteger(input.estimatedFarePaise)) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'estimatedFarePaise must be a positive integer',
    });
  }

  // Tenant scope: the employee must live under the actor's tenant.
  const employee = await Employee.findOne({
    _id: input.employeeId,
    tenantId: actor.tenantId,
  })
    .select({ _id: 1, tenantId: 1, managerId: 1, status: 1, travelPolicyId: 1 })
    .lean();
  if (!employee) throw new AppError('NOT_FOUND', { reason: 'employee not found' });
  if (employee.status !== 'ACTIVE') {
    throw new AppError('VALIDATION_ERROR', { reason: 'employee is INACTIVE' });
  }

  const policy = await resolvePolicyForEmployee(employee._id);
  const policyCtx: PolicyEvalContext = policy
    ? {
        rules: policy.rules ?? null,
        autoApproveBelowPaise: policy.autoApproveBelowPaise ?? null,
      }
    : { rules: null, autoApproveBelowPaise: null };

  const evalResult = evaluateBusPolicy(
    {
      busTypeId: input.busTypeId,
      operatorId: input.operatorId,
      isAc: input.isAc,
      isSleeper: input.isSleeper,
      departureAt: input.departureAt,
    },
    { farePaise: input.estimatedFarePaise },
    policyCtx,
  );

  // Auto-approve when policy passes AND fare is within auto-approve
  // threshold AND no extra approval required by fare-band rules.
  // Anything else lands in `pending`.
  const autoApproved =
    evalResult.ok && evalResult.autoApproveEligible && !evalResult.requiresApproval;

  // Expiry: prefer policy override; fall back to 24h.
  const expiryHours = policy?.approvalExpiryHours ?? 24;
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60_000);

  const totalPaise = input.estimatedFarePaise * input.seatNumbers.length;

  const doc = await ApprovalRequest.create({
    tenantId: new Types.ObjectId(actor.tenantId),
    type: 'bus',
    employeeId: employee._id,
    managerId: employee.managerId ?? null,
    submittedByUserId: new Types.ObjectId(actor.userId),
    payload: {
      sourceCityId: input.sourceCityId,
      destinationCityId: input.destinationCityId,
      doj: input.doj,
      tripId: input.tripId,
      inventoryId: input.inventoryId,
      seatNumbers: input.seatNumbers,
      boardingPointId: input.boardingPointId,
      droppingPointId: input.droppingPointId,
      estimatedFarePaise: input.estimatedFarePaise,
      estimatedTotalPaise: totalPaise,
      operatorName: input.operatorName ?? '',
      busType: input.busType ?? '',
      isAc: input.isAc ?? false,
      isSleeper: input.isSleeper ?? false,
      departureAt: input.departureAt,
      arrivalAt: input.arrivalAt,
    },
    travelPolicyId: policy?._id ?? null,
    status: autoApproved ? 'approved' : 'pending',
    policyViolations: evalResult.violations,
    decidedAt: autoApproved ? new Date() : null,
    decidedByUserId: autoApproved ? new Types.ObjectId(actor.userId) : null,
    expiresAt,
    approverNote: autoApproved ? 'Auto-approved (within policy threshold)' : null,
  });

  await recordAudit({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'approval.submit',
    resource: 'approval',
    resourceId: String(doc._id),
    after: {
      type: 'bus',
      status: doc.status,
      autoApproved,
      violations: evalResult.violations,
      estimatedTotalPaise: totalPaise,
    },
    ip: actor.ipAddress ?? null,
  });

  return { approval: doc, policy: evalResult };
}

// ────────── Approve / Reject ──────────

export async function approveApproval(
  actor: ApprovalActor,
  approvalId: string,
  note: string | undefined,
): Promise<ApprovalRequestDoc> {
  return decideApproval(actor, approvalId, 'approved', note);
}

export async function rejectApproval(
  actor: ApprovalActor,
  approvalId: string,
  note: string,
): Promise<ApprovalRequestDoc> {
  if (!note || note.trim().length < 10) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'rejection note must be ≥ 10 characters',
    });
  }
  return decideApproval(actor, approvalId, 'rejected', note);
}

async function decideApproval(
  actor: ApprovalActor,
  approvalId: string,
  newStatus: 'approved' | 'rejected',
  note: string | undefined,
): Promise<ApprovalRequestDoc> {
  if (!Types.ObjectId.isValid(approvalId)) {
    throw new AppError('VALIDATION_ERROR', { reason: 'invalid approvalId' });
  }
  const approval = await ApprovalRequest.findOne({
    _id: approvalId,
    tenantId: actor.tenantId,
  });
  if (!approval) throw new AppError('NOT_FOUND', { reason: 'approval not found' });

  // State guard. expired/booked are terminal and never decideable.
  if (!isValidApprovalTransition(approval.status as ApprovalStatus, newStatus)) {
    throw new AppError('VALIDATION_ERROR', {
      reason: `cannot transition ${approval.status} → ${newStatus}`,
    });
  }

  // Authorisation: must be the assigned manager OR a privileged role.
  const isManagerOnRecord =
    approval.managerId !== null && String(approval.managerId) === actor.userId;
  const isPrivileged = actor.role === 'SUPER_ADMIN' || actor.role === 'TENANT_ADMIN';
  if (!isManagerOnRecord && !isPrivileged) {
    throw new AppError('FORBIDDEN', { reason: 'not authorised to decide this approval' });
  }

  approval.status = newStatus;
  approval.decidedAt = new Date();
  approval.decidedByUserId = new Types.ObjectId(actor.userId);
  approval.approverNote = note ?? null;
  await approval.save();

  await recordAudit({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorRole: actor.role,
    action: `approval.${newStatus}`,
    resource: 'approval',
    resourceId: String(approval._id),
    after: { status: newStatus, note: note ?? null },
    ip: actor.ipAddress ?? null,
  });

  return approval;
}

// ────────── Booking-flow hook (Phase 6) ──────────

/**
 * Mark an approved request as consumed by a successful booking.
 * Phase 5 only validates the transition; Phase 6 wires this into the
 * booking-service flow. Idempotent: re-marking the same approval with
 * the same bookingId is a no-op.
 */
export async function markApprovalBooked(
  approvalId: Types.ObjectId | string,
  bookingId: Types.ObjectId | string,
): Promise<ApprovalRequestDoc> {
  const approval = await ApprovalRequest.findById(approvalId);
  if (!approval) throw new AppError('NOT_FOUND', { reason: 'approval not found' });
  if (approval.bookingId && String(approval.bookingId) === String(bookingId)) {
    return approval;
  }
  if (!isValidApprovalTransition(approval.status as ApprovalStatus, 'booked')) {
    throw new AppError('VALIDATION_ERROR', {
      reason: `cannot transition ${approval.status} → booked`,
    });
  }
  approval.status = 'booked';
  approval.bookingId = new Types.ObjectId(String(bookingId));
  await approval.save();
  return approval;
}

// ────────── Reads ──────────

export interface ApprovalListFilter {
  status?: ApprovalStatus;
  page?: number;
  limit?: number;
}

export async function getMyApprovals(
  actor: ApprovalActor,
  employeeId: string,
  filter: ApprovalListFilter = {},
): Promise<{ items: ApprovalRequestDoc[]; total: number }> {
  if (!Types.ObjectId.isValid(employeeId)) {
    throw new AppError('VALIDATION_ERROR', { reason: 'invalid employeeId' });
  }
  // Tenant scoping is the only authorisation gate here — employees
  // see their own list. The route-layer permission gate restricts who
  // can call.
  const q: Record<string, unknown> = {
    tenantId: actor.tenantId,
    employeeId,
  };
  if (filter.status) q.status = filter.status;
  return runListQuery(q, filter);
}

export async function getPendingForManager(
  actor: ApprovalActor,
  filter: ApprovalListFilter = {},
): Promise<{ items: ApprovalRequestDoc[]; total: number }> {
  // Privileged roles see ALL tenant pendings; managers see only theirs.
  const q: Record<string, unknown> = {
    tenantId: actor.tenantId,
    status: filter.status ?? 'pending',
  };
  if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'TENANT_ADMIN') {
    q.managerId = actor.userId;
  }
  return runListQuery(q, filter);
}

async function runListQuery(
  q: Record<string, unknown>,
  filter: ApprovalListFilter,
): Promise<{ items: ApprovalRequestDoc[]; total: number }> {
  const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
  const page = Math.max(1, filter.page ?? 1);
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    ApprovalRequest.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ApprovalRequest.countDocuments(q),
  ]);
  return { items, total };
}

// ────────── Sweeper ──────────

/**
 * Mark all pending approvals past their expiresAt as `expired`. Returns
 * the number of rows touched. Idempotent: re-running sweeps nothing on
 * a clean tick.
 *
 * Called from queues/approval-expiry-sweeper.worker.ts on a 1-minute
 * cron (CLAUDE.md §2 architecture diagram).
 */
export async function sweepExpiredApprovals(now: Date = new Date()): Promise<number> {
  const result = await ApprovalRequest.updateMany(
    { status: 'pending', expiresAt: { $lte: now } },
    { $set: { status: 'expired', decidedAt: now } },
  );
  if (result.modifiedCount > 0) {
    logger.info({ count: result.modifiedCount }, 'approval-expiry-sweeper: expired pending requests');
  }
  return result.modifiedCount;
}

/** Convenience export for tests/admin tools. */
export { APPROVAL_STATUS };
