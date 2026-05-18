// Approval workflow for AWAITING_APPROVAL hotel bookings.
//
// Three operations:
//
//   approveBooking(bookingId, byUserId, note?)
//     1. Loads the AWAITING_APPROVAL row
//     2. Authorises the caller (must be the assigned approver OR SUPER_ADMIN)
//     3. Updates pendingApproval.decision = APPROVED + decidedAt + decidedBy
//     4. Transitions DRAFT → APPROVED → executes the actual TBO Book via
//        executeApprovedBooking. The result is whatever the TBO call returns
//        (confirmed / held / pending / verify_price / failed).
//
//   rejectBooking(bookingId, byUserId, reason)
//     1. Same auth check
//     2. pendingApproval.decision = REJECTED + reason
//     3. Status → BOOK_FAILED with the rejection reason in statusHistory
//     4. No wallet movement (debit never happened — gate held it).
//
//   listPendingApprovals(approverUserId)
//     Returns all bookings with status=AWAITING_APPROVAL and approverUserId
//     matching the given user. Used by the approver dashboard.
//
// Re-PreBook on stale approvals: spec §11.3 notes that if approval takes
// hours, the price may have drifted. For v1 we don't auto-re-PreBook —
// the executeTboBook path will surface VerifyPrice naturally if TBO
// disagrees, and the user can re-confirm. A future enhancement: trigger a
// PreBook before executeApprovedBooking if pendingApproval.requestedAt is
// > 1h old.

import { Types } from 'mongoose';
import { AppError } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { HotelBooking, type HotelBookingDoc } from '../../models/HotelBooking.js';
import { User } from '../../models/User.js';
import { buildApprovalVars, executeApprovedBooking, type BookResult } from './book.service.js';
import { enqueueAlert } from '../alerts/index.js';

export interface ApprovalContext {
  tenantId: string;
  userId: string;
  role: string;
}

export interface PendingApprovalSummary {
  bookingId: string;
  hotelName: string | null;
  checkIn: Date;
  checkOut: Date;
  totalSellingPaise: number;
  reasons: string[];
  requestedAt: Date | null;
  requestedByUserId: string | null;
  bookerName?: string | null; // populated by route layer
}

/**
 * Manager approves a flagged booking. Returns the BookResult from the
 * subsequent TBO Book call — which may itself be confirmed / held / pending
 * / verify_price / failed depending on supplier behaviour.
 */
export async function approveBooking(
  ctx: ApprovalContext,
  bookingId: string,
  note?: string,
): Promise<BookResult> {
  const doc = await loadAndAuthorize(ctx, bookingId);
  if (doc.status !== 'AWAITING_APPROVAL') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `cannot approve booking in status ${doc.status}`,
    });
  }

  doc.pendingApproval = {
    ...(doc.pendingApproval ?? {}),
    isVoucherBooking: doc.pendingApproval?.isVoucherBooking ?? null,
    requestedAt: doc.pendingApproval?.requestedAt ?? null,
    requestedByUserId: doc.pendingApproval?.requestedByUserId ?? null,
    approverUserId: doc.pendingApproval?.approverUserId ?? null,
    reasons: doc.pendingApproval?.reasons ?? [],
    decision: 'APPROVED',
    decidedAt: new Date(),
    decidedByUserId: new Types.ObjectId(ctx.userId),
    decisionNote: note ?? null,
  };
  doc.status = 'APPROVED';
  doc.statusHistory.push({
    status: 'APPROVED',
    at: new Date(),
    by: new Types.ObjectId(ctx.userId),
    note: note ?? `Approved by ${ctx.userId}`,
  });
  await doc.save();

  logger.info(
    { bookingId, approverUserId: ctx.userId },
    'tbo.approval: approved, executing TBO Book',
  );

  // Notify the original booker (best-effort). Decision is good news so we
  // include the approver's name in the alert vars. Any failure here is
  // logged inside enqueueAlert and never blocks Book execution.
  void notifyDecision(doc, 'HOTEL_BOOKING_APPROVED', ctx, note ?? null);

  // Hand off to the shared TBO executor — result mirrors the original
  // /book route's return shape.
  return await executeApprovedBooking(doc);
}

/**
 * Manager rejects a flagged booking. Terminal state — the booker would
 * need to re-PreBook + re-submit if they want to try again.
 */
export async function rejectBooking(
  ctx: ApprovalContext,
  bookingId: string,
  reason: string,
): Promise<{ bookingId: string; status: 'BOOK_FAILED' }> {
  const doc = await loadAndAuthorize(ctx, bookingId);
  if (doc.status !== 'AWAITING_APPROVAL') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `cannot reject booking in status ${doc.status}`,
    });
  }

  doc.pendingApproval = {
    ...(doc.pendingApproval ?? {}),
    isVoucherBooking: doc.pendingApproval?.isVoucherBooking ?? null,
    requestedAt: doc.pendingApproval?.requestedAt ?? null,
    requestedByUserId: doc.pendingApproval?.requestedByUserId ?? null,
    approverUserId: doc.pendingApproval?.approverUserId ?? null,
    reasons: doc.pendingApproval?.reasons ?? [],
    decision: 'REJECTED',
    decidedAt: new Date(),
    decidedByUserId: new Types.ObjectId(ctx.userId),
    decisionNote: reason,
  };
  doc.status = 'BOOK_FAILED';
  doc.statusHistory.push({
    status: 'BOOK_FAILED',
    at: new Date(),
    by: new Types.ObjectId(ctx.userId),
    note: `Rejected by approver: ${reason}`,
  });
  await doc.save();

  logger.info({ bookingId, approverUserId: ctx.userId, reason }, 'tbo.approval: rejected');

  // Notify the booker that their request was declined.
  void notifyDecision(doc, 'HOTEL_BOOKING_REJECTED', ctx, reason);

  return { bookingId, status: 'BOOK_FAILED' };
}

/** Resolve the approver's display name + dispatch the decision alert.
 *  Best-effort throughout — any failure here logs and swallows. */
async function notifyDecision(
  doc: HotelBookingDoc,
  event: 'HOTEL_BOOKING_APPROVED' | 'HOTEL_BOOKING_REJECTED',
  ctx: ApprovalContext,
  decisionNote: string | null,
): Promise<void> {
  let decidedBy = 'Manager';
  try {
    const u = await User.findById(ctx.userId).select('fullName').lean();
    if (u?.fullName) decidedBy = u.fullName;
  } catch {
    // ignore
  }

  // Recipients: the original booker (always), plus the booking_contact ref
  // when distinct (covers customer-facing bookings made on behalf of a
  // traveller different from the agent who clicked Book).
  const recipients: Array<{ kind: 'user'; id: string } | { kind: 'booking_contact'; bookingId: string }> = [];
  if (doc.bookedByUserId) {
    recipients.push({ kind: 'user', id: String(doc.bookedByUserId) });
  }
  recipients.push({ kind: 'booking_contact', bookingId: String(doc._id) });

  await enqueueAlert(
    {
      event,
      vars: buildApprovalVars(doc, doc.pendingApproval?.reasons ?? [], decidedBy, decisionNote),
    },
    recipients,
    {
      tenantId: ctx.tenantId,
      correlationKey: `hotel-approval:${String(doc._id)}`,
    },
  );
}

/**
 * Pending approvals visible to a given user. Includes both bookings
 * explicitly assigned to them AND (if no explicit approver was set on the
 * agency) any unassigned bookings on agencies they own.
 */
export async function listPendingApprovals(
  ctx: ApprovalContext,
): Promise<PendingApprovalSummary[]> {
  const filter: Record<string, unknown> = {
    tenantId: ctx.tenantId,
    status: 'AWAITING_APPROVAL',
  };
  if (ctx.role === 'SUPER_ADMIN') {
    // SUPER_ADMIN sees everything in their tenant.
  } else {
    // Approver match — explicit ON THE BOOKING. Implicit-via-agency-owner
    // is handled by the route layer (Phase 5+ enhancement).
    filter['pendingApproval.approverUserId'] = new Types.ObjectId(ctx.userId);
  }

  const docs = await HotelBooking.find(filter)
    .sort({ 'pendingApproval.requestedAt': 1 })
    .limit(100)
    .lean();

  return docs.map((d) => ({
    bookingId: String(d._id),
    hotelName: d.hotel?.name ?? null,
    checkIn: d.checkIn,
    checkOut: d.checkOut,
    totalSellingPaise: d.pricing?.totalSellingPaise ?? 0,
    reasons: d.pendingApproval?.reasons ?? [],
    requestedAt: d.pendingApproval?.requestedAt ?? null,
    requestedByUserId: d.pendingApproval?.requestedByUserId
      ? String(d.pendingApproval.requestedByUserId)
      : null,
  }));
}

// ────────── helpers ──────────

async function loadAndAuthorize(
  ctx: ApprovalContext,
  bookingId: string,
): Promise<HotelBookingDoc> {
  if (!Types.ObjectId.isValid(bookingId)) throw new AppError('NOT_FOUND');
  const doc = await HotelBooking.findOne({
    _id: bookingId,
    tenantId: ctx.tenantId,
  });
  if (!doc) throw new AppError('NOT_FOUND');

  // SUPER_ADMIN can approve anything in their tenant. Otherwise, the caller
  // must be the assigned approver (when one is set on the booking).
  if (ctx.role !== 'SUPER_ADMIN') {
    const approverUserId = doc.pendingApproval?.approverUserId
      ? String(doc.pendingApproval.approverUserId)
      : null;
    if (approverUserId && approverUserId !== ctx.userId) {
      throw new AppError('FORBIDDEN', { reason: 'not the assigned approver' });
    }
    // No explicit approver assigned and caller isn't SUPER_ADMIN → 403.
    if (!approverUserId) {
      throw new AppError('FORBIDDEN', { reason: 'no approver assigned to this booking' });
    }
  }

  return doc;
}
