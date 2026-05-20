import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AdjustWalletRequestSchema,
  ApproveTopupRequestSchema,
  AppError,
  InitiateTopupRequestSchema,
  RejectTopupRequestSchema,
  StatementQuerySchema,
  TransferRequestSchema,
  WalletQuerySchema,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { Agency } from '../models/Agency.js';
import { Distributor } from '../models/Distributor.js';
import { TopupRequest } from '../models/TopupRequest.js';
import { WalletTransaction } from '../models/WalletTransaction.js';
import { recordAudit } from '../services/audit.service.js';
import { getWalletBalance, serializeTxn } from '../services/wallet/ledger.js';
import {
  approveManualTopup,
  initiateTopup,
  rejectTopup,
  serializeTopup,
  type ActorContext,
} from '../services/wallet/topup.js';
import { distributorTransferToAgency } from '../services/wallet/transfer.js';
import { adjustWallet } from '../services/wallet/adjust.js';
import { generateStatementPdf } from '../services/wallet/statement.js';

export const walletRouter: RouterT = Router();

walletRouter.use(authenticate, requireAuth);

import type { Request } from 'express';

function actorFromReq(req: Request): ActorContext {
  return {
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    role: req.auth!.role,
    agencyId: req.auth!.agencyId,
    distributorId: req.auth!.distributorId,
    ipAddress: (req.ip as string | undefined) ?? null,
  };
}

// GET /wallet/me — balance summary for the caller's wallet (or admin override).
walletRouter.get('/me', async (req, res, next) => {
  try {
    const explicitAgencyId =
      typeof req.query.agencyId === 'string' ? req.query.agencyId : undefined;
    const explicitDistributorId =
      typeof req.query.distributorId === 'string' ? req.query.distributorId : undefined;

    let kind: 'AGENCY' | 'DISTRIBUTOR';
    let ownerId: string;
    let ownerCode = '';
    let ownerName = '';

    if (req.auth!.role === 'SUPER_ADMIN' || req.auth!.role === 'ACCOUNTS_USER') {
      if (explicitAgencyId) {
        const a = await Agency.findOne({
          _id: explicitAgencyId,
          tenantId: req.auth!.tenantId,
        }).lean();
        if (!a) throw new AppError('AGENCY_NOT_FOUND');
        kind = 'AGENCY';
        ownerId = explicitAgencyId;
        ownerCode = a.agencyCode;
        ownerName = a.companyName;
      } else if (explicitDistributorId) {
        const d = await Distributor.findOne({
          _id: explicitDistributorId,
          tenantId: req.auth!.tenantId,
        }).lean();
        if (!d) throw new AppError('DISTRIBUTOR_NOT_FOUND');
        kind = 'DISTRIBUTOR';
        ownerId = explicitDistributorId;
        ownerCode = d.distributorCode;
        ownerName = d.companyName;
      } else {
        throw new AppError('VALIDATION_ERROR', {
          reason: 'super admin must specify agencyId or distributorId',
        });
      }
    } else if (req.auth!.role === 'DISTRIBUTOR') {
      if (!req.auth!.distributorId) throw new AppError('FORBIDDEN');
      const d = await Distributor.findById(req.auth!.distributorId).lean();
      if (!d) throw new AppError('DISTRIBUTOR_NOT_FOUND');
      kind = 'DISTRIBUTOR';
      ownerId = req.auth!.distributorId;
      ownerCode = d.distributorCode;
      ownerName = d.companyName;
    } else if (req.auth!.role === 'AGENCY' || req.auth!.role === 'SUB_AGENT') {
      if (!req.auth!.agencyId) throw new AppError('FORBIDDEN');
      const a = await Agency.findById(req.auth!.agencyId).lean();
      if (!a) throw new AppError('AGENCY_NOT_FOUND');
      kind = 'AGENCY';
      ownerId = req.auth!.agencyId;
      ownerCode = a.agencyCode;
      ownerName = a.companyName;
    } else {
      throw new AppError('FORBIDDEN');
    }

    const balance = await getWalletBalance(kind, ownerId);
    return ok(res, {
      walletKind: kind,
      ownerId,
      ownerCode,
      ownerName,
      walletBalancePaise: balance.balancePaise,
      creditLimitPaise: balance.creditLimitPaise,
      outstandingPaise: balance.outstandingPaise,
      currency: 'INR',
    });
  } catch (err) {
    next(err);
  }
});

// GET /wallet/transactions — paginated ledger view, scope-filtered.
walletRouter.get('/transactions', validate(WalletQuerySchema, 'query'), async (req, res, next) => {
  try {
    const q = req.query as unknown as ReturnType<typeof WalletQuerySchema.parse>;
    const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };

    // Scope by role.
    if (req.auth!.role === 'AGENCY' || req.auth!.role === 'SUB_AGENT') {
      filter.agencyId = req.auth!.agencyId;
    } else if (req.auth!.role === 'DISTRIBUTOR') {
      filter.distributorId = req.auth!.distributorId;
    } else {
      if (q.agencyId) filter.agencyId = q.agencyId;
      if (q.distributorId) filter.distributorId = q.distributorId;
    }

    if (q.type) filter.type = q.type;
    if (q.direction) filter.direction = q.direction;
    if (q.bookingId) filter.bookingId = q.bookingId;
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.$gte = q.from;
      if (q.to) range.$lte = q.to;
      filter.createdAt = range;
    }

    const [items, total] = await Promise.all([
      WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit),
      WalletTransaction.countDocuments(filter),
    ]);
    return ok(res, items.map(serializeTxn), {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    });
  } catch (err) {
    next(err);
  }
});

// POST /wallet/topup — initiate a manual (BANK/UPI/CASH) top-up.
// Gateway top-ups (PhonePe / ICICI Orange PG) go through POST /api/v1/payments/topups/initiate.
walletRouter.post(
  '/topup',
  requirePermission('wallet:topup:request'),
  validate(InitiateTopupRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof InitiateTopupRequestSchema.parse>;
      const { topup, response } = await initiateTopup(actorFromReq(req), input);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'wallet.topup.initiate',
        resource: 'topup',
        resourceId: String(topup._id),
        after: { mode: input.paymentMode, amountPaise: input.amountPaise },
      });
      return ok(res, response, undefined, 201);
    } catch (err) {
      next(err);
    }
  },
);

// List top-up requests (queue or own history).
walletRouter.get('/topups', async (req, res, next) => {
  try {
    const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };

    if (req.auth!.role === 'AGENCY' || req.auth!.role === 'SUB_AGENT') {
      filter.agencyId = req.auth!.agencyId;
    } else if (req.auth!.role === 'DISTRIBUTOR') {
      filter.$or = [
        { distributorId: req.auth!.distributorId },
        // Distributor can also see top-ups submitted by their downline agencies.
        { agencyId: { $in: await downlineAgencyIds(req.auth!.distributorId, req.auth!.tenantId) } },
      ];
    }
    // SUPER_ADMIN/ACCOUNTS_USER see everything.

    if (typeof req.query.status === 'string') filter.status = req.query.status;

    const items = await TopupRequest.find(filter).sort({ createdAt: -1 }).limit(200);
    const data = await Promise.all(items.map(serializeTopup));
    return ok(res, data);
  } catch (err) {
    next(err);
  }
});

walletRouter.post(
  '/topups/:id/approve',
  requirePermission('wallet:topup:approve'),
  validate(ApproveTopupRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const body = req.body as ReturnType<typeof ApproveTopupRequestSchema.parse>;
      const t = await approveManualTopup(actorFromReq(req), req.params.id, body.notes);
      return ok(res, await serializeTopup(t));
    } catch (err) {
      next(err);
    }
  },
);

walletRouter.post(
  '/topups/:id/reject',
  requirePermission('wallet:topup:reject'),
  validate(RejectTopupRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const body = req.body as ReturnType<typeof RejectTopupRequestSchema.parse>;
      const t = await rejectTopup(actorFromReq(req), req.params.id, body.reason);
      return ok(res, await serializeTopup(t));
    } catch (err) {
      next(err);
    }
  },
);

// POST /wallet/transfer — distributor → agency (or super admin doing the same).
walletRouter.post(
  '/transfer',
  requirePermission('wallet:transfer:to-agency'),
  validate(TransferRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof TransferRequestSchema.parse>;
      const result = await distributorTransferToAgency(
        actorFromReq(req),
        input.toAgencyId,
        input.amountPaise,
        input.notes,
      );
      return ok(res, result, undefined, 201);
    } catch (err) {
      next(err);
    }
  },
);

walletRouter.post(
  '/adjust',
  requirePermission('wallet:adjust'),
  validate(AdjustWalletRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof AdjustWalletRequestSchema.parse>;
      const out = await adjustWallet(actorFromReq(req), input);
      return ok(res, out, undefined, 201);
    } catch (err) {
      next(err);
    }
  },
);

// GET /wallet/statement — streams a PDF of the period.
walletRouter.get(
  '/statement',
  requirePermission('wallet:statement:download'),
  validate(StatementQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof StatementQuerySchema.parse>;
      let kind: 'AGENCY' | 'DISTRIBUTOR';
      let ownerId: string;
      if (req.auth!.role === 'AGENCY' || req.auth!.role === 'SUB_AGENT') {
        if (!req.auth!.agencyId) throw new AppError('FORBIDDEN');
        kind = 'AGENCY';
        ownerId = req.auth!.agencyId;
      } else if (req.auth!.role === 'DISTRIBUTOR') {
        if (!req.auth!.distributorId) throw new AppError('FORBIDDEN');
        kind = 'DISTRIBUTOR';
        ownerId = req.auth!.distributorId;
      } else if (q.agencyId) {
        kind = 'AGENCY';
        ownerId = q.agencyId;
      } else if (q.distributorId) {
        kind = 'DISTRIBUTOR';
        ownerId = q.distributorId;
      } else {
        throw new AppError('VALIDATION_ERROR', { reason: 'agencyId or distributorId required' });
      }

      const stream = await generateStatementPdf({
        tenantId: req.auth!.tenantId,
        walletKind: kind,
        walletOwnerId: ownerId,
        from: q.from,
        to: q.to,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="statement-${ownerId}-${q.from.toISOString().slice(0, 10)}.pdf"`,
      );
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  },
);

async function downlineAgencyIds(
  distributorId: string | null,
  tenantId: string,
): Promise<string[]> {
  if (!distributorId) return [];
  const ids = await Agency.find({ distributorId, tenantId }).select('_id').lean();
  return ids.map((d) => String(d._id));
}
