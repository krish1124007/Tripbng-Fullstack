// "What's new" updates — admin CRUD + dashboard read path.
//
// Read scoping:
//   - SUPER_ADMIN  : sees every row in the tenant, regardless of
//                    active / publishedAt / expiresAt — used by the
//                    admin manager page.
//   - everyone else: sees only active rows currently in their visibility
//                    window (publishedAt <= now <= expiresAt, with nulls
//                    treated as "open").
//
// Sort order: priority ASC, then publishedAt DESC. Lower-priority numbers
// float to the top of the feed; ties broken by recency.

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  CreateUpdateRequestSchema,
  PaginationQuerySchema,
  UpdateUpdateRequestSchema,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { UpdateModel, type UpdateDoc } from '../models/Update.js';
import { recordAudit } from '../services/audit.service.js';

export const updateRouter: RouterT = Router();
updateRouter.use(authenticate, requireAuth);

function serialize(u: UpdateDoc) {
  return {
    id: String(u._id),
    title: u.title,
    body: u.body,
    tag: u.tag ?? 'New',
    tone: u.tone ?? 'accent',
    icon: u.icon ?? 'Sparkles',
    href: u.href ?? null,
    priority: u.priority ?? 100,
    publishedAt: (u.publishedAt ?? u.createdAt).toISOString(),
    expiresAt: u.expiresAt ? u.expiresAt.toISOString() : null,
    active: u.active ?? true,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

// GET /updates — paginated. Admins see every row in the tenant. Non-admins
// only see active rows within their visibility window.
updateRouter.get(
  '/',
  requirePermission('update:read'),
  validate(PaginationQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit } = req.query as unknown as ReturnType<
        typeof PaginationQuerySchema.parse
      >;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (req.auth!.role !== 'SUPER_ADMIN') {
        const now = new Date();
        filter.active = true;
        filter.$and = [
          { $or: [{ publishedAt: null }, { publishedAt: { $lte: now } }] },
          { $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }] },
        ];
      }
      const [items, total] = await Promise.all([
        UpdateModel.find(filter)
          .sort({ priority: 1, publishedAt: -1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        UpdateModel.countDocuments(filter),
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

updateRouter.post(
  '/',
  requirePermission('update:create'),
  validate(CreateUpdateRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateUpdateRequestSchema.parse>;
      const u = await UpdateModel.create({
        tenantId: req.auth!.tenantId,
        ...input,
        createdBy: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'update.create',
        resource: 'update',
        resourceId: String(u._id),
        after: {
          title: u.title,
          tag: u.tag,
          tone: u.tone,
          active: u.active,
        },
      });
      return created(res, serialize(u));
    } catch (err) {
      next(err);
    }
  },
);

updateRouter.patch(
  '/:id',
  requirePermission('update:update'),
  validate(UpdateUpdateRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateUpdateRequestSchema.parse>;
      const updated = await UpdateModel.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.auth!.tenantId },
        { $set: { ...input, updatedBy: req.auth!.userId } },
        { new: true },
      );
      if (!updated) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'update.update',
        resource: 'update',
        resourceId: req.params.id,
        after: {
          title: updated.title,
          tag: updated.tag,
          tone: updated.tone,
          active: updated.active,
        },
      });
      return ok(res, serialize(updated));
    } catch (err) {
      next(err);
    }
  },
);

updateRouter.delete('/:id', requirePermission('update:delete'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const deleted = await UpdateModel.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!deleted) throw new AppError('NOT_FOUND');
    await recordAudit({
      tenantId: req.auth!.tenantId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      action: 'update.delete',
      resource: 'update',
      resourceId: req.params.id,
    });
    return ok(res, { ok: true });
  } catch (err) {
    next(err);
  }
});
