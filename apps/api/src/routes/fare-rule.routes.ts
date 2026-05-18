import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  CreateFareRuleRequestSchema,
  PaginationQuerySchema,
  UpdateFareRuleRequestSchema,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { FareRule } from '../models/FareRule.js';
import { recordAudit } from '../services/audit.service.js';

export const fareRuleRouter: RouterT = Router();

fareRuleRouter.use(authenticate, requireAuth);

function serialize(r: InstanceType<typeof FareRule>) {
  return {
    id: String(r._id),
    name: r.name,
    cancellationBands: r.cancellationBands ?? [],
    reschedulingBands: r.reschedulingBands ?? [],
    noShowFeePaise: r.noShowFeePaise ?? 0,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

fareRuleRouter.get(
  '/',
  requirePermission('fare-rule:read'),
  validate(PaginationQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit, q } = req.query as unknown as ReturnType<
        typeof PaginationQuerySchema.parse
      >;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (q) filter.name = new RegExp(q, 'i');
      const [items, total] = await Promise.all([
        FareRule.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        FareRule.countDocuments(filter),
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

fareRuleRouter.post(
  '/',
  requirePermission('fare-rule:create'),
  validate(CreateFareRuleRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateFareRuleRequestSchema.parse>;
      const rule = await FareRule.create({
        tenantId: req.auth!.tenantId,
        ...input,
        createdBy: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'fare-rule.create',
        resource: 'fare-rule',
        resourceId: String(rule._id),
        after: { name: rule.name },
      });
      return created(res, serialize(rule));
    } catch (err) {
      next(err);
    }
  },
);

fareRuleRouter.patch(
  '/:id',
  requirePermission('fare-rule:update'),
  validate(UpdateFareRuleRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateFareRuleRequestSchema.parse>;
      const updated = await FareRule.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.auth!.tenantId },
        { $set: { ...input, updatedBy: req.auth!.userId } },
        { new: true },
      );
      if (!updated) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'fare-rule.update',
        resource: 'fare-rule',
        resourceId: req.params.id,
      });
      return ok(res, serialize(updated));
    } catch (err) {
      next(err);
    }
  },
);

fareRuleRouter.delete('/:id', requirePermission('fare-rule:delete'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const deleted = await FareRule.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!deleted) throw new AppError('NOT_FOUND');
    await recordAudit({
      tenantId: req.auth!.tenantId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      action: 'fare-rule.delete',
      resource: 'fare-rule',
      resourceId: req.params.id,
    });
    return ok(res, { ok: true });
  } catch (err) {
    next(err);
  }
});
