import { Router } from 'express';
import { AuditLogQuerySchema } from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { AuditLog } from '../models/AuditLog.js';

export const auditRouter = Router();

auditRouter.use(authenticate, requireAuth);

auditRouter.get(
  '/',
  requirePermission('audit:read'),
  validate(AuditLogQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit, actorId, action, resource, resourceId, from, to } =
        req.query as unknown as ReturnType<typeof AuditLogQuerySchema.parse>;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (actorId) filter.actorId = actorId;
      if (action) filter.action = new RegExp(`^${action}`);
      if (resource) filter.resource = resource;
      if (resourceId) filter.resourceId = resourceId;
      if (from || to) {
        const range: Record<string, Date> = {};
        if (from) range.$gte = from;
        if (to) range.$lte = to;
        filter.createdAt = range;
      }

      const [items, total] = await Promise.all([
        AuditLog.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        AuditLog.countDocuments(filter),
      ]);
      return ok(
        res,
        items.map((it) => ({
          id: String(it._id),
          actorId: it.actorId ? String(it.actorId) : null,
          actorRole: it.actorRole,
          impersonatorId: it.impersonatorId ? String(it.impersonatorId) : null,
          action: it.action,
          resource: it.resource,
          resourceId: it.resourceId,
          before: it.before,
          after: it.after,
          ip: it.ip,
          userAgent: it.userAgent,
          success: it.success,
          error: it.error,
          createdAt: it.createdAt.toISOString(),
        })),
        { page, limit, total, totalPages: Math.ceil(total / limit) },
      );
    } catch (err) {
      next(err);
    }
  },
);
