import { AppError } from '@tripbng/shared';
import { Agency } from '../../models/Agency.js';
import { Distributor } from '../../models/Distributor.js';
import { recordAudit } from '../audit.service.js';
import { postCredit, postDebit, type WalletKind } from './ledger.js';
import type { ActorContext } from './topup.js';

// adjustWallet — admin-only manual credit/debit for incident recovery, refunds-by-hand,
// or compensation. Always audit-logged with the supplied reason. DEBIT may go below zero.
export async function adjustWallet(
  ctx: ActorContext,
  args: {
    direction: 'CREDIT' | 'DEBIT';
    amountPaise: number;
    reason: string;
    agencyId?: string;
    distributorId?: string;
  },
): Promise<{ txnId: string }> {
  if (!Number.isInteger(args.amountPaise) || args.amountPaise <= 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'amountPaise must be a positive integer' });
  }

  let kind: WalletKind;
  let ownerId: string;
  if (args.agencyId) {
    const a = await Agency.findOne({ _id: args.agencyId, tenantId: ctx.tenantId }).lean();
    if (!a) throw new AppError('AGENCY_NOT_FOUND');
    kind = 'AGENCY';
    ownerId = args.agencyId;
  } else if (args.distributorId) {
    const d = await Distributor.findOne({
      _id: args.distributorId,
      tenantId: ctx.tenantId,
    }).lean();
    if (!d) throw new AppError('DISTRIBUTOR_NOT_FOUND');
    kind = 'DISTRIBUTOR';
    ownerId = args.distributorId;
  } else {
    throw new AppError('VALIDATION_ERROR', { reason: 'agencyId or distributorId required' });
  }

  const txn =
    args.direction === 'CREDIT'
      ? await postCredit({
          tenantId: ctx.tenantId,
          walletKind: kind,
          walletOwnerId: ownerId,
          type: 'ADJUSTMENT_CREDIT',
          amountPaise: args.amountPaise,
          performedBy: ctx.userId,
          description: `Admin credit: ${args.reason}`,
          ipAddress: ctx.ipAddress ?? null,
          metadata: { reason: args.reason },
        })
      : await postDebit({
          tenantId: ctx.tenantId,
          walletKind: kind,
          walletOwnerId: ownerId,
          type: 'ADJUSTMENT_DEBIT',
          amountPaise: args.amountPaise,
          performedBy: ctx.userId,
          description: `Admin debit: ${args.reason}`,
          ipAddress: ctx.ipAddress ?? null,
          metadata: { reason: args.reason },
          // Admin override — allow going below zero (e.g. clawback after a wrongful credit).
          requireSufficientBalance: false,
        });

  await recordAudit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: 'wallet.adjust',
    resource: kind === 'AGENCY' ? 'agency' : 'distributor',
    resourceId: ownerId,
    after: {
      direction: args.direction,
      amountPaise: args.amountPaise,
      reason: args.reason,
      txnId: String(txn._id),
    },
  });

  return { txnId: String(txn._id) };
}
