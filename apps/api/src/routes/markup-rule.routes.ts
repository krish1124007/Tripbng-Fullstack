import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  AppError,
  CreateMarkupRuleRequestSchema,
  MARKUP_STATUS,
  PaginationQuerySchema,
  PAX_TYPE,
  TRAVEL_TYPE,
  UpdateMarkupRuleRequestSchema,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { containsRegex } from '../utils/regex.js';
import { ok, created } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { MarkupRule } from '../models/MarkupRule.js';
import { recordAudit } from '../services/audit.service.js';

export const markupRuleRouter: RouterT = Router();

markupRuleRouter.use(authenticate, requireAuth);

function serialize(r: InstanceType<typeof MarkupRule>) {
  return {
    id: String(r._id),
    name: r.name,
    scope: r.scope,
    distributorId: r.distributorId ? String(r.distributorId) : null,
    agencyId: r.agencyId ? String(r.agencyId) : null,
    valueType: r.valueType,
    value: r.value,
    maxValuePaise: r.maxValuePaise,
    priority: r.priority,
    status: r.status,
    conditions: r.conditions ?? {},
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// Scope read access: PLATFORM rules visible to admin, distributors only see their own
// (or PLATFORM ones that affect them — but those they can't edit). Agencies see only theirs.
import type { AuthContext } from '../middleware/auth.js';
function scopeFilter(auth: AuthContext) {
  const filter: Record<string, unknown> = { tenantId: auth.tenantId };
  if (auth.role === 'DISTRIBUTOR') {
    filter.$or = [{ scope: 'DISTRIBUTOR', distributorId: auth.distributorId }];
  } else if (auth.role === 'AGENCY') {
    filter.$or = [{ scope: 'AGENCY', agencyId: auth.agencyId }];
  }
  return filter;
}

// Agency Markup list query — pagination + the reference search filters
// (Description, Airline, Travel Type, Pax Type, Status).
const MarkupListQuerySchema = PaginationQuerySchema.extend({
  airline: z.string().trim().toUpperCase().min(2).max(3).optional(),
  travelType: z.enum(TRAVEL_TYPE).optional(),
  paxType: z.enum(PAX_TYPE).optional(),
  status: z.enum(MARKUP_STATUS).optional(),
});

markupRuleRouter.get(
  '/',
  requirePermission('markup-rule:read'),
  validate(MarkupListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit, q, airline, travelType, paxType, status } = req.query as unknown as ReturnType<
        typeof MarkupListQuerySchema.parse
      >;
      const filter: Record<string, unknown> = scopeFilter(req.auth!);
      if (q) filter.name = new RegExp(q, 'i');
      // conditions.airlines / conditions.paxTypes are arrays — equality matches membership.
      if (airline) filter['conditions.airlines'] = airline;
      if (travelType) filter['conditions.travelType'] = travelType;
      if (paxType) filter['conditions.paxTypes'] = paxType;
      if (status) filter.status = status;
      const [items, total] = await Promise.all([
        MarkupRule.find(filter)
          .sort({ priority: 1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        MarkupRule.countDocuments(filter),
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

markupRuleRouter.post(
  '/',
  requirePermission('markup-rule:create'),
  validate(CreateMarkupRuleRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateMarkupRuleRequestSchema.parse>;

      // Enforce scope per role to prevent privilege escalation.
      if (req.auth!.role === 'DISTRIBUTOR' && input.scope !== 'DISTRIBUTOR') {
        throw new AppError('FORBIDDEN', {
          reason: 'distributors can only create DISTRIBUTOR rules',
        });
      }
      if (req.auth!.role === 'AGENCY' && input.scope !== 'AGENCY') {
        throw new AppError('FORBIDDEN', { reason: 'agencies can only create AGENCY rules' });
      }
      if (input.scope === 'DISTRIBUTOR' && req.auth!.role === 'DISTRIBUTOR') {
        input.distributorId = req.auth!.distributorId ?? input.distributorId;
      }
      if (input.scope === 'AGENCY' && req.auth!.role === 'AGENCY') {
        input.agencyId = req.auth!.agencyId ?? input.agencyId;
      }

      const rule = await MarkupRule.create({
        tenantId: req.auth!.tenantId,
        ...input,
        createdBy: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'markup-rule.create',
        resource: 'markup-rule',
        resourceId: String(rule._id),
        after: { name: rule.name, scope: rule.scope, value: rule.value, valueType: rule.valueType },
      });
      return created(res, serialize(rule));
    } catch (err) {
      next(err);
    }
  },
);

markupRuleRouter.patch(
  '/:id',
  requirePermission('markup-rule:update'),
  validate(UpdateMarkupRuleRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const filter = scopeFilter(req.auth!);
      filter._id = req.params.id;
      const before = await MarkupRule.findOne(filter).lean();
      if (!before) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateMarkupRuleRequestSchema.parse>;
      const updated = await MarkupRule.findOneAndUpdate(
        filter,
        { $set: { ...input, updatedBy: req.auth!.userId } },
        { new: true },
      );
      if (!updated) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'markup-rule.update',
        resource: 'markup-rule',
        resourceId: req.params.id,
        before: { value: before.value, status: before.status },
        after: { value: updated.value, status: updated.status },
      });
      return ok(res, serialize(updated));
    } catch (err) {
      next(err);
    }
  },
);

// Clone — duplicate a rule (reference "Clone" action). The copy is created
// PAUSED with a "(copy)" suffix so it never silently changes live pricing.
markupRuleRouter.post(
  '/:id/clone',
  requirePermission('markup-rule:create'),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const filter = scopeFilter(req.auth!);
      filter._id = req.params.id;
      const src = await MarkupRule.findOne(filter).lean();
      if (!src) throw new AppError('NOT_FOUND');

      const {
        _id: _omitId,
        createdAt: _omitCreated,
        updatedAt: _omitUpdated,
        createdBy: _omitBy,
        updatedBy: _omitUpdBy,
        ...rest
      } = src as Record<string, unknown>;
      const clone = await MarkupRule.create({
        ...rest,
        name: `${src.name} (copy)`,
        status: 'PAUSED',
        createdBy: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'markup-rule.clone',
        resource: 'markup-rule',
        resourceId: String(clone._id),
        after: { name: clone.name, clonedFrom: req.params.id },
      });
      return created(res, serialize(clone));
    } catch (err) {
      next(err);
    }
  },
);

markupRuleRouter.delete('/:id', requirePermission('markup-rule:delete'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const filter = scopeFilter(req.auth!);
    filter._id = req.params.id;
    const deleted = await MarkupRule.findOneAndDelete(filter);
    if (!deleted) throw new AppError('NOT_FOUND');
    await recordAudit({
      tenantId: req.auth!.tenantId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      action: 'markup-rule.delete',
      resource: 'markup-rule',
      resourceId: req.params.id,
      before: { name: deleted.name, scope: deleted.scope },
    });
    return ok(res, { ok: true });
  } catch (err) {
    next(err);
  }
});
