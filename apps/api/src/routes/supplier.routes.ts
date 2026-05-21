import { Router } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  CreateSupplierRequestSchema,
  CreateSupplierSourceSchema,
  PaginationQuerySchema,
  UpdateSupplierRequestSchema,
  UpdateSupplierSourceSchema,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { containsRegex } from '../utils/regex.js';
import { ok, created } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { Supplier } from '../models/Supplier.js';
import { SupplierSource } from '../models/SupplierSource.js';
import {
  createSupplier,
  serializeSupplier,
  testSupplierConnection,
  updateSupplier,
} from '../services/supplier.service.js';
import {
  getIntegrationStatuses,
  probeIntegrationHealth,
  setIntegrationOverride,
} from '../services/integration-status.service.js';
import { recordAudit } from '../services/audit.service.js';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.js';

export const supplierRouter = Router();

supplierRouter.use(authenticate, requireAuth);

// ────────── Live integrations registry ──────────
//
// These three routes power the top section of the admin Suppliers page —
// the inventory + per-integration health + enable/disable toggle that
// reflects the code-registered adapters (Kafila, AirIQ, eTrav, TBO,
// SeatSeller, Asego, Mock, Series). Custom Mongo suppliers continue to
// use the routes further down. SUPER_ADMIN-only — toggling an
// integration affects every tenant.

supplierRouter.get(
  '/integrations',
  requireRole('SUPER_ADMIN'),
  async (req, res, next) => {
    try {
      const force = req.query.force === 'true' || req.query.force === '1';
      const rows = await getIntegrationStatuses({ forceHealth: force });
      return ok(res, rows);
    } catch (err) {
      next(err);
    }
  },
);

supplierRouter.post(
  '/integrations/:code/test-connection',
  requireRole('SUPER_ADMIN'),
  async (req, res, next) => {
    try {
      const code = String(req.params.code ?? '').toUpperCase();
      const snap = await probeIntegrationHealth(code);
      return ok(res, snap);
    } catch (err) {
      next(err);
    }
  },
);

const ToggleSchema = z.object({
  disabled: z.boolean(),
  note: z.string().max(500).optional(),
});

supplierRouter.post(
  '/integrations/:code/toggle',
  requireRole('SUPER_ADMIN'),
  validate(ToggleSchema),
  async (req, res, next) => {
    try {
      const code = String(req.params.code ?? '').toUpperCase();
      const { disabled, note } = req.body as z.infer<typeof ToggleSchema>;
      await setIntegrationOverride({
        code,
        disabled,
        note,
        userId: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: disabled
          ? 'supplier.integration_disabled'
          : 'supplier.integration_enabled',
        resource: 'integration',
        resourceId: code,
        after: { code, disabled, note: note ?? '' },
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      return ok(res, { code, disabled, note: note ?? '' });
    } catch (err) {
      next(err);
    }
  },
);

supplierRouter.get(
  '/',
  requirePermission('supplier:read'),
  validate(PaginationQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit, q } = req.query as unknown as ReturnType<
        typeof PaginationQuerySchema.parse
      >;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      {
        const re = containsRegex(q);
        if (re) filter.$or = [{ code: re }, { name: re }];
      }
      const [items, total] = await Promise.all([
        Supplier.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Supplier.countDocuments(filter),
      ]);
      return ok(res, items.map(serializeSupplier), {
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

// NB: the generic `GET /:id` handler for Supplier itself is registered LATER
// in this file (after the Map Source block). Express matches in registration
// order; placing `/:id` first would shadow `/sources` and friends because
// "sources" would be interpreted as the `:id` param.

supplierRouter.post(
  '/',
  requirePermission('supplier:create'),
  validate(CreateSupplierRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateSupplierRequestSchema.parse>;
      const supplier = await createSupplier(req.auth!.tenantId, input, req.auth!.userId);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'supplier.create',
        resource: 'supplier',
        resourceId: String(supplier._id),
        after: { code: supplier.code, name: supplier.name, type: supplier.type },
      });
      return created(res, serializeSupplier(supplier));
    } catch (err) {
      next(err);
    }
  },
);

supplierRouter.patch(
  '/:id',
  requirePermission('supplier:update'),
  validate(UpdateSupplierRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateSupplierRequestSchema.parse>;
      const before = await Supplier.findOne({
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      }).lean();
      if (!before) throw new AppError('NOT_FOUND');
      const supplier = await updateSupplier(req.params.id, input, req.auth!.userId);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'supplier.update',
        resource: 'supplier',
        resourceId: req.params.id,
        before: { status: before.status, name: before.name },
        after: { status: supplier.status, name: supplier.name },
      });
      return ok(res, serializeSupplier(supplier));
    } catch (err) {
      next(err);
    }
  },
);

supplierRouter.post(
  '/:id/test-connection',
  requirePermission('supplier:test'),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const result = await testSupplierConnection(req.params.id);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'supplier.test',
        resource: 'supplier',
        resourceId: req.params.id,
        after: result,
      });
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Map Source (Manage Supplier → Map Source) admin endpoints.
//
// These extend the existing `/sources` paths with the full payload defined in
// PublicSupplierSourceSchema (joined supplier name + agency-group names so
// the list view renders without per-row round-trips). The GET surface accepts
// filters that mirror the admin list page's filter card.
// ─────────────────────────────────────────────────────────────────────────────

// Lazy import to avoid pulling the AgencyGroup model into the file's module
// graph when it isn't needed.
async function serializeSupplierSource(
  src: InstanceType<typeof SupplierSource> & { toObject?: () => Record<string, unknown> },
  hydrate: { supplierMap: Map<string, { code: string; name: string }>; agencyGroupMap: Map<string, string> },
): Promise<Record<string, unknown>> {
  const s = (src.toObject?.() ?? src) as Record<string, unknown> & {
    _id: { toString(): string };
    supplierId: { toString(): string };
    agencyGroupIds?: Array<{ toString(): string }>;
    createdAt: Date;
    updatedAt: Date;
    manualIssuance?: Record<string, unknown>;
    restrictTravel?: Record<string, unknown>;
    travelCriteria?: Record<string, unknown>;
  };
  const supplierKey = s.supplierId.toString();
  const supplier = hydrate.supplierMap.get(supplierKey);
  const agencyGroupIds = (s.agencyGroupIds ?? []).map((id) => id.toString());
  return {
    id: s._id.toString(),
    name: (s.name as string | null) ?? null,
    supplierGroup: (s.supplierGroup as string | null) ?? null,
    supplierId: supplierKey,
    supplierCode: supplier?.code,
    supplierName: supplier?.name,
    productType: s.productType,
    travelType: s.travelType,
    airlineCodes: (s.airlineCodes as string[] | undefined) ?? [],
    agencyGroupIds,
    agencyGroupNames: agencyGroupIds
      .map((id) => hydrate.agencyGroupMap.get(id))
      .filter((v): v is string => Boolean(v)),
    maskBookingClassCodes: (s.maskBookingClassCodes as unknown[] | undefined) ?? [],
    maskFareTypes: (s.maskFareTypes as unknown[] | undefined) ?? [],
    hideFareTypes: (s.hideFareTypes as string[] | undefined) ?? [],
    restrictTravel: s.restrictTravel ?? {},
    manualIssuance: s.manualIssuance ?? { pendingBooking: false },
    travelCriteria: s.travelCriteria ?? {},
    priority: s.priority,
    status: s.status,
    enabled: s.enabled,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

const MapSourceListQuerySchema = z.object({
  productType: z.string().optional(),
  travelType: z.enum(['DOMESTIC', 'INTERNATIONAL', 'BOTH']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  supplierId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  supplierGroup: z.string().optional(),
  /** Free-text search across `name` + supplier name. Case-insensitive
   *  contains-match. Empty string treated as absent. */
  q: z.string().optional(),
});

supplierRouter.get(
  '/sources',
  requirePermission('supplier:read'),
  validate(MapSourceListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof MapSourceListQuerySchema.parse>;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (q.productType) filter.productType = q.productType;
      if (q.travelType) filter.travelType = q.travelType;
      if (q.status) filter.status = q.status;
      if (q.supplierId) filter.supplierId = q.supplierId;
      if (q.supplierGroup) filter.supplierGroup = q.supplierGroup;

      // `q` matches against `name`. Supplier-name match goes through a
      // sub-query (Supplier model) so we don't have to denormalise on each
      // SupplierSource row. Two-step is fine — the supplier list per tenant
      // is small (tens of rows).
      {
        const needle = containsRegex(q.q);
        if (needle) {
          const supMatches = await Supplier.find({
            tenantId: req.auth!.tenantId,
            name: needle,
          })
            .select({ _id: 1 })
            .lean();
          const supIds = supMatches.map((s) => s._id);
          filter.$or = [{ name: needle }, { supplierId: { $in: supIds } }];
        }
      }

      const items = await SupplierSource.find(filter)
        .sort({ priority: 1, createdAt: -1 })
        .limit(500);

      // Hydrate display fields in a single round-trip rather than per-row.
      const supIds = Array.from(new Set(items.map((i) => i.supplierId.toString())));
      const suppliers = await Supplier.find({
        _id: { $in: supIds },
        tenantId: req.auth!.tenantId,
      })
        .select({ _id: 1, code: 1, name: 1 })
        .lean();
      const supplierMap = new Map(
        suppliers.map((s) => [s._id.toString(), { code: s.code, name: s.name }]),
      );

      const agencyGroupIds = Array.from(
        new Set(items.flatMap((i) => (i.agencyGroupIds ?? []).map((id) => id.toString()))),
      );
      const { AgencyGroup } = await import('../models/AgencyGroup.js');
      const agencyGroups = agencyGroupIds.length
        ? await AgencyGroup.find({
            _id: { $in: agencyGroupIds },
            tenantId: req.auth!.tenantId,
          })
            .select({ _id: 1, name: 1 })
            .lean()
        : [];
      const agencyGroupMap = new Map(agencyGroups.map((g) => [g._id.toString(), g.name]));

      const payload = await Promise.all(
        items.map((s) => serializeSupplierSource(s, { supplierMap, agencyGroupMap })),
      );
      return ok(res, payload);
    } catch (err) {
      next(err);
    }
  },
);

supplierRouter.get('/sources/:id', requirePermission('supplier:read'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const src = await SupplierSource.findOne({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!src) throw new AppError('NOT_FOUND');
    const supplier = await Supplier.findById(src.supplierId)
      .select({ _id: 1, code: 1, name: 1 })
      .lean();
    const supplierMap = new Map<string, { code: string; name: string }>();
    if (supplier) {
      supplierMap.set(supplier._id.toString(), { code: supplier.code, name: supplier.name });
    }
    const { AgencyGroup } = await import('../models/AgencyGroup.js');
    const agencyGroups = src.agencyGroupIds?.length
      ? await AgencyGroup.find({
          _id: { $in: src.agencyGroupIds },
          tenantId: req.auth!.tenantId,
        })
          .select({ _id: 1, name: 1 })
          .lean()
      : [];
    const agencyGroupMap = new Map(agencyGroups.map((g) => [g._id.toString(), g.name]));
    return ok(res, await serializeSupplierSource(src, { supplierMap, agencyGroupMap }));
  } catch (err) {
    next(err);
  }
});

// Back-compat: the original `/sources/list` returns the minimal shape. Kept
// so any unmigrated callers don't break. New consumers should use
// `GET /sources` above.
supplierRouter.get('/sources/list', requirePermission('supplier:read'), async (req, res, next) => {
  try {
    const items = await SupplierSource.find({ tenantId: req.auth!.tenantId }).sort({
      priority: 1,
      createdAt: -1,
    });
    return ok(
      res,
      items.map((s) => ({
        id: String(s._id),
        supplierId: String(s.supplierId),
        productType: s.productType,
        travelType: s.travelType,
        airlineCodes: s.airlineCodes ?? [],
        priority: s.priority,
        enabled: s.enabled,
      })),
    );
  } catch (err) {
    next(err);
  }
});

supplierRouter.post(
  '/sources',
  requirePermission('supplier:update'),
  validate(CreateSupplierSourceSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateSupplierSourceSchema.parse>;
      const exists = await Supplier.findOne({
        _id: input.supplierId,
        tenantId: req.auth!.tenantId,
      }).lean();
      if (!exists) throw new AppError('NOT_FOUND', { reason: 'supplier not found' });

      // Validate agency-group references belong to the same tenant so an
      // admin can't accidentally cross-link from another tenant. Cheap one
      // query.
      if (input.agencyGroupIds?.length) {
        const { AgencyGroup } = await import('../models/AgencyGroup.js');
        const found = await AgencyGroup.countDocuments({
          _id: { $in: input.agencyGroupIds },
          tenantId: req.auth!.tenantId,
        });
        if (found !== input.agencyGroupIds.length) {
          throw new AppError('VALIDATION_ERROR', {
            reason: 'one or more agencyGroupIds do not belong to this tenant',
          });
        }
      }

      const src = await SupplierSource.create({
        tenantId: req.auth!.tenantId,
        ...input,
        createdBy: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'supplier.source.create',
        resource: 'supplierSource',
        resourceId: String(src._id),
        after: {
          name: src.name,
          supplierId: String(src.supplierId),
          productType: src.productType,
          travelType: src.travelType,
        },
        ip: req.ip ?? null,
      });
      return created(res, { id: String(src._id) });
    } catch (err) {
      next(err);
    }
  },
);

supplierRouter.patch(
  '/sources/:id',
  requirePermission('supplier:update'),
  validate(UpdateSupplierSourceSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateSupplierSourceSchema.parse>;

      // Same tenant-scoped agency-group check on update.
      if (input.agencyGroupIds?.length) {
        const { AgencyGroup } = await import('../models/AgencyGroup.js');
        const found = await AgencyGroup.countDocuments({
          _id: { $in: input.agencyGroupIds },
          tenantId: req.auth!.tenantId,
        });
        if (found !== input.agencyGroupIds.length) {
          throw new AppError('VALIDATION_ERROR', {
            reason: 'one or more agencyGroupIds do not belong to this tenant',
          });
        }
      }

      const before = await SupplierSource.findOne({
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      }).lean();
      if (!before) throw new AppError('NOT_FOUND');

      const src = await SupplierSource.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.auth!.tenantId },
        { $set: { ...input, updatedBy: req.auth!.userId } },
        { new: true },
      );
      if (!src) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'supplier.source.update',
        resource: 'supplierSource',
        resourceId: String(src._id),
        before: { status: before.status, airlineCodes: before.airlineCodes },
        after: { status: src.status, airlineCodes: src.airlineCodes },
        ip: req.ip ?? null,
      });
      return ok(res, { id: String(src._id) });
    } catch (err) {
      next(err);
    }
  },
);

supplierRouter.delete(
  '/sources/:id',
  requirePermission('supplier:update'),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const src = await SupplierSource.findOneAndDelete({
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      });
      if (!src) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'supplier.source.delete',
        resource: 'supplierSource',
        resourceId: String(src._id),
        before: { name: src.name, supplierId: String(src.supplierId) },
        ip: req.ip ?? null,
      });
      return ok(res, { ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Supplier `/:id` catch-all — MUST stay at the bottom of the file. Any more
// specific GET pattern (like `/sources`) must register before this or it gets
// shadowed.
// ─────────────────────────────────────────────────────────────────────────────
supplierRouter.get('/:id', requirePermission('supplier:read'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const supplier = await Supplier.findOne({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!supplier) throw new AppError('NOT_FOUND');
    return ok(res, serializeSupplier(supplier));
  } catch (err) {
    next(err);
  }
});
