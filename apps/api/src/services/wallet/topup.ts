import {
  AppError,
  type InitiateTopupRequest,
  type InitiateTopupResponse,
  type PaymentMode,
  type Role,
} from '@tripbng/shared';
import { Agency } from '../../models/Agency.js';
import { Distributor } from '../../models/Distributor.js';
import { TopupRequest, type TopupRequestDoc } from '../../models/TopupRequest.js';
import { User } from '../../models/User.js';
import { recordAudit } from '../audit.service.js';
import { enqueueAlert } from '../alerts/index.js';
import { postCredit, type WalletKind } from './ledger.js';

const MANUAL_MODES: PaymentMode[] = ['BANK', 'UPI', 'CASH'];

export interface ActorContext {
  tenantId: string;
  userId: string;
  role: Role;
  agencyId: string | null;
  distributorId: string | null;
  ipAddress?: string | null;
}

interface ResolvedTarget {
  walletKind: WalletKind;
  walletOwnerId: string;
}

// resolveTarget — figures out *whose* wallet this top-up will land in.
// Agencies / sub-agents top up their agency. Distributors top up their distributor wallet.
// Super admin can target any agency or distributor by passing an explicit id.
export async function resolveTopupTarget(
  ctx: ActorContext,
  body: { agencyId?: string; distributorId?: string },
): Promise<ResolvedTarget> {
  if (ctx.role === 'SUPER_ADMIN' || ctx.role === 'ACCOUNTS_USER') {
    if (body.agencyId) {
      const a = await Agency.findOne({ _id: body.agencyId, tenantId: ctx.tenantId }).lean();
      if (!a) throw new AppError('AGENCY_NOT_FOUND');
      return { walletKind: 'AGENCY', walletOwnerId: body.agencyId };
    }
    if (body.distributorId) {
      const d = await Distributor.findOne({
        _id: body.distributorId,
        tenantId: ctx.tenantId,
      }).lean();
      if (!d) throw new AppError('DISTRIBUTOR_NOT_FOUND');
      return { walletKind: 'DISTRIBUTOR', walletOwnerId: body.distributorId };
    }
    throw new AppError('VALIDATION_ERROR', { reason: 'agencyId or distributorId required' });
  }
  if (ctx.role === 'DISTRIBUTOR') {
    if (!ctx.distributorId) throw new AppError('FORBIDDEN');
    return { walletKind: 'DISTRIBUTOR', walletOwnerId: ctx.distributorId };
  }
  if (ctx.role === 'AGENCY' || ctx.role === 'SUB_AGENT') {
    if (!ctx.agencyId) throw new AppError('FORBIDDEN');
    return { walletKind: 'AGENCY', walletOwnerId: ctx.agencyId };
  }
  throw new AppError('FORBIDDEN');
}

// initiateTopup — creates a TopupRequest. Return shape varies by mode:
//   BANK/UPI/CASH → request enters PENDING approval queue.
//   ADMIN_CREDIT → super admin manually credits via /wallet/adjust; not this path.
// Gateway top-ups (PhonePe / ICICI Orange PG) go through paymentService.initiateTopup
// instead — that path lives in apps/api/src/services/payment/payment.service.ts.
export async function initiateTopup(
  ctx: ActorContext,
  input: InitiateTopupRequest,
): Promise<{ topup: TopupRequestDoc; response: InitiateTopupResponse }> {
  const target = await resolveTopupTarget(ctx, input);

  const baseDoc = {
    tenantId: ctx.tenantId,
    amountPaise: input.amountPaise,
    paymentMode: input.paymentMode,
    requestedByUserId: ctx.userId,
    notes: input.notes ?? null,
    agencyId: target.walletKind === 'AGENCY' ? target.walletOwnerId : null,
    distributorId: target.walletKind === 'DISTRIBUTOR' ? target.walletOwnerId : null,
  };

  if (MANUAL_MODES.includes(input.paymentMode)) {
    const topup = await TopupRequest.create({
      ...baseDoc,
      referenceNumber: input.referenceNumber ?? null,
      proofUrl: input.proofUrl ?? null,
    });
    return {
      topup,
      response: { mode: 'MANUAL', topupId: String(topup._id), status: 'PENDING' },
    };
  }

  // DEPOSIT / WALLET / CREDIT variants we haven't implemented yet — guard explicitly.
  throw new AppError('VALIDATION_ERROR', {
    reason: `Top-up mode ${input.paymentMode} unsupported`,
  });
}

export async function approveManualTopup(
  ctx: ActorContext,
  topupId: string,
  notes?: string,
): Promise<TopupRequestDoc> {
  const topup = await TopupRequest.findOne({ _id: topupId, tenantId: ctx.tenantId });
  if (!topup) throw new AppError('NOT_FOUND');
  if (topup.status !== 'PENDING') {
    throw new AppError('VALIDATION_ERROR', { reason: `topup is ${topup.status}` });
  }

  const txn = await postCredit({
    tenantId: ctx.tenantId,
    walletKind: topup.agencyId ? 'AGENCY' : 'DISTRIBUTOR',
    walletOwnerId: String(topup.agencyId ?? topup.distributorId),
    type: 'TOPUP',
    amountPaise: topup.amountPaise,
    performedBy: ctx.userId,
    topupRequestId: String(topup._id),
    description: `Manual top-up approved (${topup.paymentMode}${topup.referenceNumber ? ' #' + topup.referenceNumber : ''})`,
    ipAddress: ctx.ipAddress ?? null,
  });

  topup.status = 'APPROVED';
  topup.approvedByUserId = ctx.userId as unknown as typeof topup.approvedByUserId;
  topup.walletTxnId = txn._id;
  topup.settledAt = new Date();
  if (notes) topup.notes = notes;
  await topup.save();

  await recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: 'wallet.topup.approve',
    resource: 'topup',
    resourceId: String(topup._id),
    before: { status: 'PENDING' },
    after: { status: 'APPROVED', txnId: String(txn._id) },
  });

  void enqueueManualTopupAlert(topup, ctx.userId, 'MANUAL_TOPUP_APPROVED');

  return topup;
}

export async function rejectTopup(
  ctx: ActorContext,
  topupId: string,
  reason: string,
): Promise<TopupRequestDoc> {
  const topup = await TopupRequest.findOne({ _id: topupId, tenantId: ctx.tenantId });
  if (!topup) throw new AppError('NOT_FOUND');
  if (topup.status !== 'PENDING') {
    throw new AppError('VALIDATION_ERROR', { reason: `topup is ${topup.status}` });
  }
  topup.status = 'REJECTED';
  topup.rejectedByUserId = ctx.userId as unknown as typeof topup.rejectedByUserId;
  topup.rejectionReason = reason;
  topup.settledAt = new Date();
  await topup.save();
  await recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: 'wallet.topup.reject',
    resource: 'topup',
    resourceId: topupId,
    after: { reason },
  });

  void enqueueManualTopupAlert(topup, ctx.userId, 'MANUAL_TOPUP_REJECTED', reason);

  return topup;
}

/**
 * Shared helper for the approve + reject paths. Resolves the admin's name
 * (for the "Approved by Foo" line) and fans out the alert to the user who
 * originally requested the top-up.
 */
async function enqueueManualTopupAlert(
  topup: TopupRequestDoc,
  decidedByUserId: string,
  event: 'MANUAL_TOPUP_APPROVED' | 'MANUAL_TOPUP_REJECTED',
  rejectionReason?: string,
): Promise<void> {
  // Look up the deciding admin's name. Best-effort — fall back to "Admin"
  // if the lookup fails (deleted user, transient Mongo issue) so the alert
  // still goes out with reasonable copy.
  let decidedByName = 'Admin';
  try {
    const u = await User.findById(decidedByUserId).select('fullName').lean();
    if (u?.fullName) decidedByName = u.fullName;
  } catch {
    // ignore
  }

  await enqueueAlert(
    {
      event,
      vars: {
        txnCode: String(topup._id), // TopupRequest doesn't have a txnCode field; use the doc id
        amountPaise: topup.amountPaise,
        decidedBy: decidedByName,
        rejectionReason: rejectionReason ?? null,
      },
    },
    [{ kind: 'user', id: String(topup.requestedByUserId) }],
    {
      tenantId: String(topup.tenantId),
      correlationKey: `topup-manual:${String(topup._id)}`,
    },
  );
}

export async function serializeTopup(t: TopupRequestDoc) {
  // Optionally fetch agency/distributor names for nicer UI display. Lean lookups, no joins.
  const [agency, distributor] = await Promise.all([
    t.agencyId ? Agency.findById(t.agencyId).select('agencyCode companyName').lean() : null,
    t.distributorId
      ? Distributor.findById(t.distributorId).select('distributorCode companyName').lean()
      : null,
  ]);
  return {
    id: String(t._id),
    amountPaise: t.amountPaise,
    currency: t.currency ?? 'INR',
    paymentMode: t.paymentMode,
    status: t.status,
    agencyId: t.agencyId ? String(t.agencyId) : null,
    agencyCode: agency?.agencyCode ?? null,
    agencyName: agency?.companyName ?? null,
    distributorId: t.distributorId ? String(t.distributorId) : null,
    distributorCode: distributor?.distributorCode ?? null,
    distributorName: distributor?.companyName ?? null,
    requestedByUserId: String(t.requestedByUserId),
    approvedByUserId: t.approvedByUserId ? String(t.approvedByUserId) : null,
    rejectedByUserId: t.rejectedByUserId ? String(t.rejectedByUserId) : null,
    rejectionReason: t.rejectionReason,
    referenceNumber: t.referenceNumber,
    proofUrl: t.proofUrl,
    notes: t.notes,
    walletTxnId: t.walletTxnId ? String(t.walletTxnId) : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
