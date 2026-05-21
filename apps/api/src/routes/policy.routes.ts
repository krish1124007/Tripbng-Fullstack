import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  CreatePolicyRequestSchema,
  PaginationQuerySchema,
  UpdatePolicyRequestSchema,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { containsRegex } from '../utils/regex.js';
import { ok, created } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { Policy } from '../models/Policy.js';
import { recordAudit } from '../services/audit.service.js';

export const policyRouter: RouterT = Router();

policyRouter.use(authenticate, requireAuth);

function serialize(p: InstanceType<typeof Policy>) {
  return {
    id: String(p._id),
    name: p.name,
    commissionPercent: p.commissionPercent,
    managementFeePaise: p.managementFeePaise,
    b2bMarkupPaise: p.b2bMarkupPaise,
    gstOnMarkupOnly: p.gstOnMarkupOnly,
    gstRateBasisPoints: p.gstRateBasisPoints,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

policyRouter.get(
  '/',
  requirePermission('policy:read'),
  validate(PaginationQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit, q } = req.query as unknown as ReturnType<
        typeof PaginationQuerySchema.parse
      >;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      {
        const re = containsRegex(q);
        if (re) filter.name = re;
      }
      const [items, total] = await Promise.all([
        Policy.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Policy.countDocuments(filter),
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

policyRouter.post(
  '/',
  requirePermission('policy:create'),
  validate(CreatePolicyRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreatePolicyRequestSchema.parse>;
      const policy = await Policy.create({
        tenantId: req.auth!.tenantId,
        ...input,
        createdBy: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'policy.create',
        resource: 'policy',
        resourceId: String(policy._id),
        after: { name: policy.name, commissionPercent: policy.commissionPercent },
      });
      return created(res, serialize(policy));
    } catch (err) {
      next(err);
    }
  },
);

policyRouter.patch(
  '/:id',
  requirePermission('policy:update'),
  validate(UpdatePolicyRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdatePolicyRequestSchema.parse>;
      const updated = await Policy.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.auth!.tenantId },
        { $set: { ...input, updatedBy: req.auth!.userId } },
        { new: true },
      );
      if (!updated) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'policy.update',
        resource: 'policy',
        resourceId: req.params.id,
      });
      return ok(res, serialize(updated));
    } catch (err) {
      next(err);
    }
  },
);

policyRouter.delete('/:id', requirePermission('policy:delete'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const deleted = await Policy.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!deleted) throw new AppError('NOT_FOUND');
    await recordAudit({
      tenantId: req.auth!.tenantId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      action: 'policy.delete',
      resource: 'policy',
      resourceId: req.params.id,
    });
    return ok(res, { ok: true });
  } catch (err) {
    next(err);
  }
});
