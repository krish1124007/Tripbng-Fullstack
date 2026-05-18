import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  CreateIncentiveRequestSchema,
  PaginationQuerySchema,
  UpdateIncentiveRequestSchema,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { Incentive, type IncentiveDoc } from '../models/Incentive.js';
import { recordAudit } from '../services/audit.service.js';

export const incentiveRouter: RouterT = Router();
incentiveRouter.use(authenticate, requireAuth);

function serialize(i: IncentiveDoc) {
  return {
    id: String(i._id),
    name: i.name,
    description: i.description,
    slabs: (i.slabs ?? []).map((s) => ({
      minDepositPaise: s.minDepositPaise,
      maxDepositPaise: s.maxDepositPaise ?? null,
      valueType: s.valueType ?? 'PERCENT',
      value: s.value,
      tdsPercent: s.tdsPercent ?? 0,
    })),
    validFrom: i.validFrom.toISOString(),
    validTo: i.validTo.toISOString(),
    target: i.target ?? 'ALL',
    agencyGroupIds: (i.agencyGroupIds ?? []).map(String),
    distributorIds: (i.distributorIds ?? []).map(String),
    active: i.active ?? true,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

incentiveRouter.get(
  '/',
  requirePermission('incentive:read'),
  validate(PaginationQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit } = req.query as unknown as ReturnType<
        typeof PaginationQuerySchema.parse
      >;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      // Non-admins see only active and currently valid schemes.
      if (req.auth!.role !== 'SUPER_ADMIN') {
        const now = new Date();
        filter.active = true;
        filter.validFrom = { $lte: now };
        filter.validTo = { $gte: now };
      }
      const [items, total] = await Promise.all([
        Incentive.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Incentive.countDocuments(filter),
      ]);
      return ok(res, items.map(serialize), {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      next(err);
    }
  },
);

incentiveRouter.post(
  '/',
  requirePermission('incentive:create'),
  validate(CreateIncentiveRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateIncentiveRequestSchema.parse>;
      const inc = await Incentive.create({
        tenantId: req.auth!.tenantId,
        ...input,
        createdBy: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'incentive.create',
        resource: 'incentive',
        resourceId: String(inc._id),
        after: { name: inc.name, slabs: inc.slabs?.length ?? 0 },
      });
      return created(res, serialize(inc));
    } catch (err) {
      next(err);
    }
  },
);

incentiveRouter.patch(
  '/:id',
  requirePermission('incentive:update'),
  validate(UpdateIncentiveRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateIncentiveRequestSchema.parse>;
      const updated = await Incentive.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.auth!.tenantId },
        { $set: { ...input, updatedBy: req.auth!.userId } },
        { new: true },
      );
      if (!updated) throw new AppError('NOT_FOUND');
      return ok(res, serialize(updated));
    } catch (err) {
      next(err);
    }
  },
);

incentiveRouter.delete('/:id', requirePermission('incentive:delete'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const deleted = await Incentive.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!deleted) throw new AppError('NOT_FOUND');
    return ok(res, { ok: true });
  } catch (err) {
    next(err);
  }
});
