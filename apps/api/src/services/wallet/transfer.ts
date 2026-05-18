import { AppError } from '@tripbng/shared';
import { Agency } from '../../models/Agency.js';
import { recordAudit } from '../audit.service.js';
import { postCredit, postDebit } from './ledger.js';
import { logger } from '../../config/logger.js';
import type { ActorContext } from './topup.js';

// distributorTransferToAgency — 2-leg ledger entry. Debits the distributor first; if that
// succeeds, credits the destination agency. If the credit fails after debit is posted, we log
// a fatal and the operator must manually compensate.
//
// Constraints:
// - Only the agency's own distributor can transfer to it (or super admin).
// - Distributor's wallet must hold sufficient balance.
export async function distributorTransferToAgency(
  ctx: ActorContext,
  toAgencyId: string,
  amountPaise: number,
  notes?: string,
): Promise<{ debitTxnId: string; creditTxnId: string }> {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'amountPaise must be a positive integer' });
  }

  const agency = await Agency.findOne({ _id: toAgencyId, tenantId: ctx.tenantId });
  if (!agency) throw new AppError('AGENCY_NOT_FOUND');

  if (ctx.role === 'DISTRIBUTOR') {
    if (!ctx.distributorId) throw new AppError('FORBIDDEN');
    if (String(agency.distributorId) !== ctx.distributorId) {
      throw new AppError('FORBIDDEN', { reason: 'agency not in your downline' });
    }
  } else if (ctx.role !== 'SUPER_ADMIN') {
    throw new AppError('FORBIDDEN');
  }

  const sourceDistributorId =
    ctx.role === 'SUPER_ADMIN'
      ? agency.distributorId
        ? String(agency.distributorId)
        : null
      : ctx.distributorId;
  if (!sourceDistributorId) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'agency is direct under platform — no distributor to transfer from',
    });
  }

  // Leg 1: debit distributor wallet (atomic — must have sufficient balance).
  const debit = await postDebit({
    tenantId: ctx.tenantId,
    walletKind: 'DISTRIBUTOR',
    walletOwnerId: sourceDistributorId,
    type: 'TRANSFER_OUT',
    amountPaise,
    performedBy: ctx.userId,
    description: `Transfer to ${agency.agencyCode} (${agency.companyName})${notes ? ` — ${notes}` : ''}`,
    ipAddress: ctx.ipAddress ?? null,
    metadata: { toAgencyId, agencyCode: agency.agencyCode },
  });

  // Leg 2: credit agency wallet, linked to leg 1 via relatedTxnId.
  let credit;
  try {
    credit = await postCredit({
      tenantId: ctx.tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: String(agency._id),
      type: 'TRANSFER_IN',
      amountPaise,
      performedBy: ctx.userId,
      relatedTxnId: String(debit._id),
      description: `Transfer from distributor${notes ? ` — ${notes}` : ''}`,
      ipAddress: ctx.ipAddress ?? null,
      metadata: { fromDistributorId: sourceDistributorId, debitTxnId: String(debit._id) },
    });
  } catch (err) {
    // Best-effort compensation: credit the distributor back. If THAT fails, both wallets
    // need manual reconciliation — the audit + ledger trail make that tractable.
    logger.fatal(
      { err, debitTxnId: String(debit._id), agencyId: toAgencyId, amountPaise },
      'transfer leg-2 failed — attempting compensation credit on distributor',
    );
    try {
      await postCredit({
        tenantId: ctx.tenantId,
        walletKind: 'DISTRIBUTOR',
        walletOwnerId: sourceDistributorId,
        type: 'ADJUSTMENT_CREDIT',
        amountPaise,
        performedBy: ctx.userId,
        relatedTxnId: String(debit._id),
        description: 'Compensation: transfer credit-leg failed',
        metadata: { reason: 'transfer-leg-2-failed' },
      });
    } catch (compErr) {
      logger.fatal(
        { compErr, debitTxnId: String(debit._id) },
        'transfer compensation also failed — MANUAL RECONCILIATION REQUIRED',
      );
    }
    throw err;
  }

  await recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: 'wallet.transfer',
    resource: 'agency',
    resourceId: String(agency._id),
    after: {
      amountPaise,
      fromDistributorId: sourceDistributorId,
      debitTxnId: String(debit._id),
      creditTxnId: String(credit._id),
    },
  });

  return { debitTxnId: String(debit._id), creditTxnId: String(credit._id) };
}
