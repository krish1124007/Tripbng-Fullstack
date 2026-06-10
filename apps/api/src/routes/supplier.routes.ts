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
import { invalidateSearchCache } from '../services/search-cache.js';
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
      if (q) {
        filter.$or = [{ code: new RegExp(q, 'i') }, { name: new RegExp(q, 'i') }];
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
      // Supplier status / airline / capability edits change what search returns.
      await invalidateSearchCache(req.auth!.tenantId);
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

// Supplier sources — sub-resource for routing supplier × productType × travelType.
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
      if (!exists) throw new AppError('NOT_FOUND');
      const src = await SupplierSource.create({
        tenantId: req.auth!.tenantId,
        ...input,
        createdBy: req.auth!.userId,
      });
      await invalidateSearchCache(req.auth!.tenantId);
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
      const src = await SupplierSource.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.auth!.tenantId },
        { $set: { ...input, updatedBy: req.auth!.userId } },
        { new: true },
      );
      if (!src) throw new AppError('NOT_FOUND');
      await invalidateSearchCache(req.auth!.tenantId);
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
      await invalidateSearchCache(req.auth!.tenantId);
      return ok(res, { ok: true });
    } catch (err) {
      next(err);
    }
  },
);
