// Map Policy admin routes — Phase 6 of the admin panel spec
// (PDF screenshots 4 + 5).
//
// REST surface (mounted under /api/v1/map-policies):
//   GET    /                 — list with filters + hydrated label arrays
//   GET    /:id              — single full payload for the edit form
//   POST   /                 — create (cross-tenant guards on agencyGroupIds + mapSourceIds)
//   PATCH  /:id              — update (same guards; status↔morePayoutAny recomputed in pre hook)
//   DELETE /:id              — delete (audit row written before drop)
//
// Pricing wiring (Phase 8) reads this same shape from the DB.

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  AppError,
  CreateMapPolicySchema,
  PRODUCT_TYPE,
  UpdateMapPolicySchema,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { containsRegex } from '../utils/regex.js';
import { ok, created } from '../utils/response.js';
import { MapPolicy, type MapPolicyDoc } from '../models/MapPolicy.js';
import { SupplierSource } from '../models/SupplierSource.js';
import { AgencyGroup } from '../models/AgencyGroup.js';
import { recordAudit } from '../services/audit.service.js';

export const mapPolicyRouter: RouterT = Router();

mapPolicyRouter.use(authenticate, requireAuth);

interface HydrateMaps {
  mapSourceMap: Map<string, string>;
  agencyGroupMap: Map<string, string>;
}

function serializeMapPolicy(
  p: MapPolicyDoc & { toObject?: () => Record<string, unknown> },
  hydrate: HydrateMaps,
): Record<string, unknown> {
  const o = (p.toObject?.() ?? p) as Record<string, unknown> & {
    _id: { toString(): string };
    createdAt: Date;
    updatedAt: Date;
  };
  const criteria = (o.criteria as Record<string, unknown> | undefined) ?? {};
  const agencyGroupIds = ((criteria.agencyGroupIds as Array<{ toString(): string }> | undefined) ?? []).map(
    (id) => id.toString(),
  );
  const mapSourceIds = ((criteria.mapSourceIds as Array<{ toString(): string }> | undefined) ?? []).map(
    (id) => id.toString(),
  );
  return {
    id: o._id.toString(),
    name: o.name,
    productType: o.productType,
    status: o.status,
    commission: o.commission ?? {},
    plb: o.plb ?? {},
    b2bMarkup: o.b2bMarkup ?? {},
    managementFee: o.managementFee ?? {},
    criteria: {
      supplierGroup: (criteria.supplierGroup as string | null) ?? null,
      mapSourceIds,
      airlineCodes: criteria.airlineCodes ?? [],
      fareTypes: criteria.fareTypes ?? [],
      agencyGroupIds,
    },
    priority: o.priority,
    morePayoutAny: o.morePayoutAny ?? false,
    mapSourceNames: mapSourceIds
      .map((id) => hydrate.mapSourceMap.get(id))
      .filter((v): v is string => Boolean(v)),
    agencyGroupNames: agencyGroupIds
      .map((id) => hydrate.agencyGroupMap.get(id))
      .filter((v): v is string => Boolean(v)),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

const MapPolicyListQuerySchema = z.object({
  productType: z.enum(PRODUCT_TYPE).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  q: z.string().optional(),
  /** Find policies that reference a particular Map Source. Useful from the
   *  Map Source detail screen ("which policies use this source?"). */
  mapSourceId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
});

mapPolicyRouter.get(
  '/',
  requirePermission('policy:read'),
  validate(MapPolicyListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof MapPolicyListQuerySchema.parse>;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (q.productType) filter.productType = q.productType;
      if (q.status) filter.status = q.status;
      {
        const re = containsRegex(q.q);
        if (re) filter.name = re;
      }
      if (q.mapSourceId) filter['criteria.mapSourceIds'] = q.mapSourceId;

      const items = await MapPolicy.find(filter)
        .sort({ priority: 1, createdAt: -1 })
        .limit(500);

      const mapSourceIds = Array.from(
        new Set(
          items.flatMap((i) =>
            ((i.criteria?.mapSourceIds ?? []) as Array<{ toString(): string }>).map((id) => id.toString()),
          ),
        ),
      );
      const agencyGroupIds = Array.from(
        new Set(
          items.flatMap((i) =>
            ((i.criteria?.agencyGroupIds ?? []) as Array<{ toString(): string }>).map((id) => id.toString()),
          ),
        ),
      );

      const [sources, groups] = await Promise.all([
        mapSourceIds.length
          ? SupplierSource.find({
              _id: { $in: mapSourceIds },
              tenantId: req.auth!.tenantId,
            })
              .select({ _id: 1, name: 1 })
              .lean()
          : [],
        agencyGroupIds.length
          ? AgencyGroup.find({
              _id: { $in: agencyGroupIds },
              tenantId: req.auth!.tenantId,
            })
              .select({ _id: 1, name: 1 })
              .lean()
          : [],
      ]);

      const mapSourceMap = new Map(
        sources.map((s) => [s._id.toString(), s.name ?? 'Map Source']),
      );
      const agencyGroupMap = new Map(groups.map((g) => [g._id.toString(), g.name]));

      return ok(
        res,
        items.map((p) => serializeMapPolicy(p, { mapSourceMap, agencyGroupMap })),
      );
    } catch (err) {
      next(err);
    }
  },
);

mapPolicyRouter.get('/:id', requirePermission('policy:read'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const policy = await MapPolicy.findOne({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!policy) throw new AppError('NOT_FOUND');

    const mapSourceIds = ((policy.criteria?.mapSourceIds ?? []) as Array<{
      toString(): string;
    }>).map((id) => id.toString());
    const agencyGroupIds = ((policy.criteria?.agencyGroupIds ?? []) as Array<{
      toString(): string;
    }>).map((id) => id.toString());
    const [sources, groups] = await Promise.all([
      mapSourceIds.length
        ? SupplierSource.find({ _id: { $in: mapSourceIds }, tenantId: req.auth!.tenantId })
            .select({ _id: 1, name: 1 })
            .lean()
        : [],
      agencyGroupIds.length
        ? AgencyGroup.find({ _id: { $in: agencyGroupIds }, tenantId: req.auth!.tenantId })
            .select({ _id: 1, name: 1 })
            .lean()
        : [],
    ]);
    const mapSourceMap = new Map(sources.map((s) => [s._id.toString(), s.name ?? 'Map Source']));
    const agencyGroupMap = new Map(groups.map((g) => [g._id.toString(), g.name]));

    return ok(res, serializeMapPolicy(policy, { mapSourceMap, agencyGroupMap }));
  } catch (err) {
    next(err);
  }
});

/** Validate that every ObjectId in the criteria block belongs to the same
 *  tenant. Cheap two-query check — refuses to persist a policy that points
 *  at another tenant's Map Source or Agency Group. */
async function verifyCriteriaScoping(
  tenantId: string,
  criteria: { mapSourceIds?: string[]; agencyGroupIds?: string[] } | undefined,
): Promise<void> {
  if (!criteria) return;
  if (criteria.mapSourceIds?.length) {
    const found = await SupplierSource.countDocuments({
      _id: { $in: criteria.mapSourceIds },
      tenantId,
    });
    if (found !== criteria.mapSourceIds.length) {
      throw new AppError('VALIDATION_ERROR', {
        reason: 'one or more mapSourceIds do not belong to this tenant',
      });
    }
  }
  if (criteria.agencyGroupIds?.length) {
    const found = await AgencyGroup.countDocuments({
      _id: { $in: criteria.agencyGroupIds },
      tenantId,
    });
    if (found !== criteria.agencyGroupIds.length) {
      throw new AppError('VALIDATION_ERROR', {
        reason: 'one or more agencyGroupIds do not belong to this tenant',
      });
    }
  }
}

mapPolicyRouter.post(
  '/',
  requirePermission('policy:create'),
  validate(CreateMapPolicySchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateMapPolicySchema.parse>;
      await verifyCriteriaScoping(req.auth!.tenantId, input.criteria);
      const policy = await MapPolicy.create({
        tenantId: req.auth!.tenantId,
        ...input,
        createdBy: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'map-policy.create',
        resource: 'mapPolicy',
        resourceId: String(policy._id),
        after: {
          name: policy.name,
          productType: policy.productType,
          status: policy.status,
        },
        ip: req.ip ?? null,
      });
      return created(res, { id: String(policy._id) });
    } catch (err) {
      next(err);
    }
  },
);

mapPolicyRouter.patch(
  '/:id',
  requirePermission('policy:update'),
  validate(UpdateMapPolicySchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateMapPolicySchema.parse>;
      await verifyCriteriaScoping(req.auth!.tenantId, input.criteria);
      const before = await MapPolicy.findOne({
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      }).lean();
      if (!before) throw new AppError('NOT_FOUND');
      const policy = await MapPolicy.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.auth!.tenantId },
        { $set: { ...input, updatedBy: req.auth!.userId } },
        { new: true },
      );
      if (!policy) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'map-policy.update',
        resource: 'mapPolicy',
        resourceId: String(policy._id),
        before: { status: before.status, name: before.name },
        after: { status: policy.status, name: policy.name },
        ip: req.ip ?? null,
      });
      return ok(res, { id: String(policy._id) });
    } catch (err) {
      next(err);
    }
  },
);

mapPolicyRouter.delete(
  '/:id',
  requirePermission('policy:delete'),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const policy = await MapPolicy.findOneAndDelete({
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      });
      if (!policy) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'map-policy.delete',
        resource: 'mapPolicy',
        resourceId: String(policy._id),
        before: { name: policy.name, productType: policy.productType },
        ip: req.ip ?? null,
      });
      return ok(res, { ok: true });
    } catch (err) {
      next(err);
    }
  },
);
