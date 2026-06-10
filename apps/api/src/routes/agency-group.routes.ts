import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  AGENCY_GROUP_STATUS,
  AppError,
  CreateAgencyGroupRequestSchema,
  PaginationQuerySchema,
  UpdateAgencyGroupRequestSchema,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { AgencyGroup } from '../models/AgencyGroup.js';
import { Agency } from '../models/Agency.js';
import { recordAudit } from '../services/audit.service.js';

export const agencyGroupRouter: RouterT = Router();

agencyGroupRouter.use(authenticate, requireAuth);

function serialize(g: InstanceType<typeof AgencyGroup>) {
  return {
    id: String(g._id),
    name: g.name,
    description: g.description,
    agencyIds: (g.agencyIds ?? []).map(String),
    agencyCount: g.agencyIds?.length ?? 0,
    airlineCodes: g.airlineCodes ?? [],
    airlineCount: g.airlineCodes?.length ?? 0,
    status: g.status ?? 'ACTIVE',
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

const AgencyGroupListQuerySchema = PaginationQuerySchema.extend({
  agencyId: z.string().trim().optional(),
  agencyName: z.string().trim().optional(),
  status: z.enum(AGENCY_GROUP_STATUS).optional(),
});

agencyGroupRouter.get(
  '/',
  requirePermission('agency-group:read'),
  validate(AgencyGroupListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit, q, agencyId, agencyName, status } = req.query as unknown as ReturnType<
        typeof AgencyGroupListQuerySchema.parse
      >;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (req.auth!.role === 'DISTRIBUTOR') {
        filter.distributorId = req.auth!.distributorId;
      }
      if (q) filter.name = new RegExp(q, 'i');
      if (status) filter.status = status;

      // "Agency id" / "Agency name" filter the groups DOWN to those that contain
      // a matching sub-agency. Resolve the agencies first, then match groups whose
      // agencyIds intersect. An ObjectId in agencyId matches directly.
      if (agencyId || agencyName) {
        const agencyFilter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
        const or: Record<string, unknown>[] = [];
        if (agencyId) {
          if (Types.ObjectId.isValid(agencyId)) or.push({ _id: agencyId });
          or.push({ agencyCode: new RegExp(agencyId, 'i') });
        }
        if (agencyName) or.push({ companyName: new RegExp(agencyName, 'i') });
        agencyFilter.$or = or;
        const matchedAgencies = await Agency.find(agencyFilter).select('_id').lean();
        filter.agencyIds = { $in: matchedAgencies.map((a) => a._id) };
      }

      const [items, total] = await Promise.all([
        AgencyGroup.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        AgencyGroup.countDocuments(filter),
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

agencyGroupRouter.post(
  '/',
  requirePermission('agency-group:create'),
  validate(CreateAgencyGroupRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateAgencyGroupRequestSchema.parse>;
      const group = await AgencyGroup.create({
        tenantId: req.auth!.tenantId,
        distributorId: req.auth!.role === 'DISTRIBUTOR' ? req.auth!.distributorId : null,
        ...input,
        createdBy: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'agency-group.create',
        resource: 'agency-group',
        resourceId: String(group._id),
        after: { name: group.name, count: group.agencyIds?.length ?? 0 },
      });
      return created(res, serialize(group));
    } catch (err) {
      next(err);
    }
  },
);

agencyGroupRouter.patch(
  '/:id',
  requirePermission('agency-group:update'),
  validate(UpdateAgencyGroupRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const filter: Record<string, unknown> = {
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      };
      if (req.auth!.role === 'DISTRIBUTOR') filter.distributorId = req.auth!.distributorId;
      const input = req.body as ReturnType<typeof UpdateAgencyGroupRequestSchema.parse>;
      const updated = await AgencyGroup.findOneAndUpdate(
        filter,
        { $set: { ...input, updatedBy: req.auth!.userId } },
        { new: true },
      );
      if (!updated) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'agency-group.update',
        resource: 'agency-group',
        resourceId: req.params.id,
      });
      return ok(res, serialize(updated));
    } catch (err) {
      next(err);
    }
  },
);

agencyGroupRouter.delete(
  '/:id',
  requirePermission('agency-group:delete'),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const filter: Record<string, unknown> = {
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      };
      if (req.auth!.role === 'DISTRIBUTOR') filter.distributorId = req.auth!.distributorId;
      const deleted = await AgencyGroup.findOneAndDelete(filter);
      if (!deleted) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'agency-group.delete',
        resource: 'agency-group',
        resourceId: req.params.id,
      });
      return ok(res, { ok: true });
    } catch (err) {
      next(err);
    }
  },
);
