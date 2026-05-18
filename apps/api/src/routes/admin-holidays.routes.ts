// Admin CRUD for holiday packages.
//
// Mounted at /api/v1/admin/holidays/packages from routes/index.ts. All five
// endpoints sit behind authenticate + requireAuth + requirePermission('holiday:author').
//
// The shape contract is the AdminHolidayPackageSchema in @tripbng/shared —
// validate() runs it as a one-shot parse before the handler sees the body, so
// nested refines (date ordering, pax ordering, day sequence, city-key uniqueness,
// …) are enforced at the request boundary.

import { Router, type Router as RouterT } from 'express';
import { z } from 'zod';
import {
  AdminHolidayPackageListQuerySchema,
  AdminHolidayPackageSchema,
  AppError,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import {
  createPackage,
  deletePackage,
  getAdminPackage,
  listAdminPackages,
  updatePackage,
} from '../services/holidayPackage.service.js';

export const adminHolidaysRouter: RouterT = Router();

adminHolidaysRouter.use(authenticate, requireAuth, requirePermission('holiday:author'));

const IdParamsSchema = z.object({ id: z.string().min(1).max(120) });

// ────────── List ──────────

adminHolidaysRouter.get(
  '/packages',
  validate(AdminHolidayPackageListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const query = req.query as unknown as z.infer<typeof AdminHolidayPackageListQuerySchema>;
      const items = await listAdminPackages(tenantId, query);
      return ok(res, { items });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Detail ──────────

adminHolidaysRouter.get(
  '/packages/:id',
  validate(IdParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const { id } = req.params as unknown as z.infer<typeof IdParamsSchema>;
      const pkg = await getAdminPackage(tenantId, id);
      return ok(res, pkg);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Create ──────────

adminHolidaysRouter.post(
  '/packages',
  validate(AdminHolidayPackageSchema),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.userId;
      const body = req.body as z.infer<typeof AdminHolidayPackageSchema>;
      const created = await createPackage(tenantId, userId, body);
      return ok(res, created);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Update ──────────

adminHolidaysRouter.put(
  '/packages/:id',
  validate(IdParamsSchema, 'params'),
  validate(AdminHolidayPackageSchema),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.userId;
      const { id } = req.params as unknown as z.infer<typeof IdParamsSchema>;
      const body = req.body as z.infer<typeof AdminHolidayPackageSchema>;
      // Defensive: if the body carries a different `id`, prefer the URL param
      // and surface the mismatch — silent overwriting would mask a typo.
      if (body.id && body.id !== id) {
        throw new AppError('VALIDATION_ERROR', {
          reason: `body.id (${body.id}) does not match URL :id (${id})`,
        });
      }
      const updated = await updatePackage(tenantId, userId, id, { ...body, id });
      return ok(res, updated);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Delete ──────────

adminHolidaysRouter.delete(
  '/packages/:id',
  validate(IdParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const { id } = req.params as unknown as z.infer<typeof IdParamsSchema>;
      await deletePackage(tenantId, id);
      return ok(res, { deleted: true });
    } catch (err) {
      next(err);
    }
  },
);
