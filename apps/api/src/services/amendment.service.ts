import {
  AppError,
  CODE_PREFIX,
  computePolicyBandFeePaise,
  matchPolicyBand,
  type AmendmentType,
  type CreateAmendmentRequest,
  type PublicAmendment,
} from '@tripbng/shared';
import { Booking } from '../models/Booking.js';
import { FareRule } from '../models/FareRule.js';
import { Inventory } from '../models/Inventory.js';
import { Amendment, type AmendmentDoc } from '../models/Amendment.js';
import { recordAudit } from './audit.service.js';
import { postCredit, postDebit } from './wallet/ledger.js';
import { nextCode } from '../utils/codes.js';
import { emit } from './notification.service.js';
import { logger } from '../config/logger.js';

export interface AmendmentActor {
  tenantId: string;
  userId: string;
  role: string;
  agencyId: string;
  distributorId: string | null;
  ipAddress?: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

// computeFee — looks up the booking's fare rule and finds the band whose hours-before-departure
// covers the current moment. Mirrors the Phase 4 cancel logic so reschedules charge consistently.
async function computeFee(bookingId: string, type: AmendmentType): Promise<number> {
  const booking = await Booking.findById(bookingId).select('travelDate inventoryId pricing').lean();
  if (!booking || !booking.travelDate) return 0;
  const inv = booking.inventoryId
    ? await Inventory.findById(booking.inventoryId).select('fareRuleId').lean()
    : null;
  if (!inv?.fareRuleId) return 0;
  const rule = await FareRule.findById(inv.fareRuleId).lean();
  if (!rule) return 0;

  const hoursBefore = Math.max(
    0,
    Math.floor((booking.travelDate.getTime() - Date.now()) / HOUR_MS),
  );
  const bands = type === 'RESCHEDULE' ? rule.reschedulingBands : rule.cancellationBands;
  const matched = matchPolicyBand(bands ?? [], hoursBefore);
  if (!matched) return 0;
  const base = booking.pricing?.agencyPayablePaise ?? 0;
  return computePolicyBandFeePaise(matched, base);
}

export async function createAmendment(
  actor: AmendmentActor,
  input: CreateAmendmentRequest,
): Promise<AmendmentDoc> {
  const booking = await Booking.findOne({
    _id: input.bookingId,
    tenantId: actor.tenantId,
    agencyId: actor.agencyId,
  });
  if (!booking) throw new AppError('NOT_FOUND');

  if (input.type !== 'CANCEL' && booking.status !== 'TICKETED' && booking.status !== 'CONFIRMED') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `cannot ${input.type.toLowerCase()} a ${booking.status} booking`,
    });
  }
  if (input.type === 'RESCHEDULE' && !input.reschedule) {
    throw new AppError('VALIDATION_ERROR', { reason: 'reschedule details required' });
  }

  const feePaise = await computeFee(input.bookingId, input.type);
  const refundPaise = Math.max(0, (booking.pricing?.agencyPayablePaise ?? 0) - feePaise);

  const amendmentCode = await nextCode(CODE_PREFIX.AMENDMENT);
  const amendment = await Amendment.create({
    tenantId: actor.tenantId,
    amendmentCode,
    bookingId: booking._id,
    bookingCode: booking.bookingCode,
    type: input.type,
    status: 'PENDING_APPROVAL',
    reason: input.reason,
    feePaise,
    refundPaise,
    reschedule:
      input.type === 'RESCHEDULE' && input.reschedule
        ? {
            oldTravelDate: booking.travelDate,
            newTravelDate: input.reschedule.newTravelDate,
            notes: input.reschedule.notes ?? null,
          }
        : { oldTravelDate: null, newTravelDate: null, notes: null },
    requestedByUserId: actor.userId,
    agencyId: actor.agencyId,
    distributorId: actor.distributorId,
  });

  // Move the booking into a holding state — locks operations until ops resolve the request.
  if (input.type === 'CANCEL' || input.type === 'REFUND') {
    booking.status = 'CANCEL_REQUESTED';
  }
  await booking.save();

  await recordAudit({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'amendment.create',
    resource: 'amendment',
    resourceId: String(amendment._id),
    after: {
      type: input.type,
      bookingCode: booking.bookingCode,
      feePaise,
      refundPaise,
    },
    ip: actor.ipAddress ?? null,
  });

  return amendment;
}

export async function approveAmendment(
  actor: AmendmentActor,
  amendmentId: string,
  override: { feePaise?: number; notes?: string } = {},
): Promise<AmendmentDoc> {
  const amendment = await Amendment.findOne({
    _id: amendmentId,
    tenantId: actor.tenantId,
  });
  if (!amendment) throw new AppError('NOT_FOUND');
  if (amendment.status !== 'PENDING_APPROVAL') {
    throw new AppError('VALIDATION_ERROR', { reason: `amendment is ${amendment.status}` });
  }
  const booking = await Booking.findById(amendment.bookingId);
  if (!booking) throw new AppError('NOT_FOUND');

  const feePaise = override.feePaise ?? amendment.feePaise;
  const refundPaise = Math.max(0, (booking.pricing?.agencyPayablePaise ?? 0) - feePaise);

  amendment.feePaise = feePaise;
  amendment.refundPaise = refundPaise;
  amendment.approvedByUserId = actor.userId as unknown as typeof amendment.approvedByUserId;
  amendment.approvalNotes = override.notes ?? null;

  if (refundPaise > 0) {
    try {
      const refund = await postCredit({
        tenantId: actor.tenantId,
        walletKind: 'AGENCY',
        walletOwnerId: String(booking.agencyId),
        type: 'REFUND_CREDIT',
        amountPaise: refundPaise,
        performedBy: actor.userId,
        bookingId: String(booking._id),
        amendmentId: String(amendment._id),
        relatedTxnId: booking.walletDebitTxnId ? String(booking.walletDebitTxnId) : undefined,
        description: `Amendment ${amendment.amendmentCode} refund for ${booking.bookingCode}`,
      });
      amendment.refundTxnId = refund._id;
    } catch (err) {
      logger.fatal({ err, amendmentId }, 'amendment refund failed — manual fix needed');
      amendment.status = 'FAILED';
      await amendment.save();
      throw err;
    }
  }

  if (feePaise > 0) {
    try {
      const fee = await postDebit({
        tenantId: actor.tenantId,
        walletKind: 'AGENCY',
        walletOwnerId: String(booking.agencyId),
        type: 'CANCELLATION_FEE',
        amountPaise: feePaise,
        performedBy: actor.userId,
        bookingId: String(booking._id),
        amendmentId: String(amendment._id),
        description: `Fee for amendment ${amendment.amendmentCode}`,
        // Refund came in first; fee won't push balance negative under normal flow.
      });
      amendment.feeTxnId = fee._id;
    } catch (err) {
      logger.error({ err, amendmentId }, 'fee debit failed — refund already credited');
    }
  }

  // Final booking state.
  if (amendment.type === 'CANCEL' || amendment.type === 'REFUND') {
    booking.status = 'CANCELLED';
    booking.cancelledAt = new Date();
    booking.paymentStatus = 'REFUNDED';
    if (booking.inventoryId && booking.seatsConsumed > 0) {
      await Inventory.updateOne(
        { _id: booking.inventoryId },
        { $inc: { seatsRemaining: booking.seatsConsumed } },
      );
    }
  }
  if (amendment.type === 'RESCHEDULE' && amendment.reschedule?.newTravelDate) {
    booking.travelDate = amendment.reschedule.newTravelDate;
  }
  await booking.save();

  amendment.status = 'COMPLETED';
  amendment.settledAt = new Date();
  await amendment.save();

  // Tell the agency owner.
  await emit({
    tenantId: actor.tenantId,
    userId: String(booking.bookedByUserId),
    agencyId: String(booking.agencyId),
    distributorId: booking.distributorId ? String(booking.distributorId) : null,
    category: 'TRANSACTIONAL',
    title: `Amendment ${amendment.amendmentCode} approved`,
    body: `Booking ${booking.bookingCode} — ${amendment.type.toLowerCase()} approved. Refund ₹${(refundPaise / 100).toFixed(2)}, fee ₹${(feePaise / 100).toFixed(2)}.`,
    href: `/bookings/${booking._id}`,
  });

  await recordAudit({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'amendment.approve',
    resource: 'amendment',
    resourceId: amendmentId,
    after: { feePaise, refundPaise, type: amendment.type },
  });

  return amendment;
}

export async function rejectAmendment(
  actor: AmendmentActor,
  amendmentId: string,
  reason: string,
): Promise<AmendmentDoc> {
  const amendment = await Amendment.findOne({
    _id: amendmentId,
    tenantId: actor.tenantId,
  });
  if (!amendment) throw new AppError('NOT_FOUND');
  if (amendment.status !== 'PENDING_APPROVAL') {
    throw new AppError('VALIDATION_ERROR', { reason: `amendment is ${amendment.status}` });
  }
  const booking = await Booking.findById(amendment.bookingId);
  if (!booking) throw new AppError('NOT_FOUND');

  amendment.status = 'REJECTED';
  amendment.rejectedByUserId = actor.userId as unknown as typeof amendment.rejectedByUserId;
  amendment.rejectionReason = reason;
  amendment.settledAt = new Date();
  await amendment.save();

  // Roll the booking back to its prior state.
  if (booking.status === 'CANCEL_REQUESTED') {
    booking.status = booking.ticketedAt ? 'TICKETED' : 'HOLD';
    await booking.save();
  }

  await emit({
    tenantId: actor.tenantId,
    userId: String(booking.bookedByUserId),
    agencyId: String(booking.agencyId),
    category: 'OPERATIONAL',
    title: `Amendment ${amendment.amendmentCode} rejected`,
    body: `Booking ${booking.bookingCode}: ${reason}`,
    href: `/bookings/${booking._id}`,
  });

  await recordAudit({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'amendment.reject',
    resource: 'amendment',
    resourceId: amendmentId,
    after: { reason },
  });

  return amendment;
}

export function serializeAmendment(a: AmendmentDoc): PublicAmendment {
  return {
    id: String(a._id),
    amendmentCode: a.amendmentCode,
    bookingId: String(a.bookingId),
    bookingCode: a.bookingCode,
    type: a.type,
    status: a.status,
    reason: a.reason,
    feePaise: a.feePaise ?? 0,
    refundPaise: a.refundPaise ?? 0,
    reschedule: a.reschedule?.newTravelDate
      ? {
          oldTravelDate: a.reschedule.oldTravelDate?.toISOString() ?? '',
          newTravelDate: a.reschedule.newTravelDate.toISOString(),
          notes: a.reschedule.notes ?? null,
        }
      : null,
    requestedByUserId: String(a.requestedByUserId),
    approvedByUserId: a.approvedByUserId ? String(a.approvedByUserId) : null,
    rejectedByUserId: a.rejectedByUserId ? String(a.rejectedByUserId) : null,
    rejectionReason: a.rejectionReason ?? null,
    approvalNotes: a.approvalNotes ?? null,
    refundTxnId: a.refundTxnId ? String(a.refundTxnId) : null,
    feeTxnId: a.feeTxnId ? String(a.feeTxnId) : null,
    agencyId: String(a.agencyId),
    distributorId: a.distributorId ? String(a.distributorId) : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
