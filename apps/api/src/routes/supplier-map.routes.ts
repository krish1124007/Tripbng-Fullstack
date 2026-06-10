import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  CreateSupplierMapSchema,
  PaginationQuerySchema,
  UpdateSupplierMapSchema,
  type PublicSupplierMap,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { SupplierMap, type SupplierMapDoc } from '../models/SupplierMap.js';
import { recordAudit } from '../services/audit.service.js';
import { invalidateSearchCache } from '../services/search-cache.js';

// Module 3 admin surface — CRUD over SupplierMap rules. Reuses the supplier:*
// permission set (SUPER_ADMIN only); a mapping change reshapes inventory
// visibility for every agency, so every mutation is audited.
export const supplierMapRouter: RouterT = Router();

supplierMapRouter.use(authenticate, requireAuth);

function serialize(m: SupplierMapDoc): PublicSupplierMap {
  return {
    id: String(m._id),
    name: m.name,
    productType: m.productType,
    travelType: m.travelType,
    supplierIds: (m.supplierIds ?? []).map(String),
    agencyGroupIds: (m.agencyGroupIds ?? []).map(String),
    airlineCodes: m.airlineCodes ?? [],
    dateStart: m.dateStart ? m.dateStart.toISOString() : null,
    dateEnd: m.dateEnd ? m.dateEnd.toISOString() : null,
    allowPendingBooking: m.allowPendingBooking,
    priority: m.priority,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

supplierMapRouter.get(
  '/',
  requirePermission('supplier:read'),
  validate(PaginationQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit, q } = req.query as unknown as ReturnType<
        typeof PaginationQuerySchema.parse
      >;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (q) filter.name = new RegExp(q, 'i');
      const [items, total] = await Promise.all([
        SupplierMap.find(filter)
          .sort({ priority: 1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        SupplierMap.countDocuments(filter),
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

supplierMapRouter.get('/:id', requirePermission('supplier:read'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const m = await SupplierMap.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId });
    if (!m) throw new AppError('NOT_FOUND');
    return ok(res, serialize(m));
  } catch (err) {
    next(err);
  }
});

supplierMapRouter.post(
  '/',
  requirePermission('supplier:create'),
  validate(CreateSupplierMapSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateSupplierMapSchema.parse>;
      const m = await SupplierMap.create({
        tenantId: req.auth!.tenantId,
        ...input,
        createdBy: req.auth!.userId,
      });
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'supplier_map.create',
        resource: 'supplier_map',
        resourceId: String(m._id),
        after: { name: m.name, productType: m.productType, status: m.status },
      });
      await invalidateSearchCache(req.auth!.tenantId);
      return created(res, serialize(m));
    } catch (err) {
      next(err);
    }
  },
);

supplierMapRouter.patch(
  '/:id',
  requirePermission('supplier:update'),
  validate(UpdateSupplierMapSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateSupplierMapSchema.parse>;
      const before = await SupplierMap.findOne({
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      }).lean();
      if (!before) throw new AppError('NOT_FOUND');
      const m = await SupplierMap.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.auth!.tenantId },
        { $set: { ...input, updatedBy: req.auth!.userId } },
        { new: true },
      );
      if (!m) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'supplier_map.update',
        resource: 'supplier_map',
        resourceId: req.params.id,
        before: { status: before.status, name: before.name },
        after: { status: m.status, name: m.name },
      });
      await invalidateSearchCache(req.auth!.tenantId);
      return ok(res, serialize(m));
    } catch (err) {
      next(err);
    }
  },
);

supplierMapRouter.delete('/:id', requirePermission('supplier:delete'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const m = await SupplierMap.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!m) throw new AppError('NOT_FOUND');
    await recordAudit({
      tenantId: req.auth!.tenantId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      action: 'supplier_map.delete',
      resource: 'supplier_map',
      resourceId: req.params.id,
      before: { name: m.name },
    });
    await invalidateSearchCache(req.auth!.tenantId);
    return ok(res, { ok: true });
  } catch (err) {
    next(err);
  }
});
