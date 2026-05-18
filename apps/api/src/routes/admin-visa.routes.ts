// Admin CRUD for visa products.
//
// Mounted at /api/v1/admin/visa/products from routes/index.ts. All five
// endpoints sit behind authenticate + requireAuth + requirePermission('visa:author').
//
// The shape contract is the AdminVisaProductSchema in @tripbng/shared —
// validate() runs it as a one-shot parse before the handler sees the body, so
// nested refines (pax ordering, process-step sequence, document-code uniqueness,
// stage uniqueness, urgent-fields-required-when-toggled, age range) are
// enforced at the request boundary.

import { Router, type Router as RouterT } from 'express';
import { z } from 'zod';
import { AdminVisaProductListQuerySchema, AdminVisaProductSchema, AppError } from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import {
  createProduct,
  deleteProduct,
  getAdminProduct,
  listAdminProducts,
  updateProduct,
} from '../services/visaProduct.service.js';

export const adminVisaRouter: RouterT = Router();

adminVisaRouter.use(authenticate, requireAuth, requirePermission('visa:author'));

const IdParamsSchema = z.object({ id: z.string().min(1).max(120) });

// ────────── List ──────────

adminVisaRouter.get(
  '/products',
  validate(AdminVisaProductListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const query = req.query as unknown as z.infer<typeof AdminVisaProductListQuerySchema>;
      const items = await listAdminProducts(tenantId, query);
      return ok(res, { items });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Detail ──────────

adminVisaRouter.get('/products/:id', validate(IdParamsSchema, 'params'), async (req, res, next) => {
  try {
    const tenantId = req.auth!.tenantId;
    const { id } = req.params as unknown as z.infer<typeof IdParamsSchema>;
    const product = await getAdminProduct(tenantId, id);
    return ok(res, product);
  } catch (err) {
    next(err);
  }
});

// ────────── Create ──────────

adminVisaRouter.post('/products', validate(AdminVisaProductSchema), async (req, res, next) => {
  try {
    const tenantId = req.auth!.tenantId;
    const userId = req.auth!.userId;
    const body = req.body as z.infer<typeof AdminVisaProductSchema>;
    const created = await createProduct(tenantId, userId, body);
    return ok(res, created);
  } catch (err) {
    next(err);
  }
});

// ────────── Update ──────────

adminVisaRouter.put(
  '/products/:id',
  validate(IdParamsSchema, 'params'),
  validate(AdminVisaProductSchema),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const userId = req.auth!.userId;
      const { id } = req.params as unknown as z.infer<typeof IdParamsSchema>;
      const body = req.body as z.infer<typeof AdminVisaProductSchema>;
      if (body.id && body.id !== id) {
        throw new AppError('VALIDATION_ERROR', {
          reason: `body.id (${body.id}) does not match URL :id (${id})`,
        });
      }
      const updated = await updateProduct(tenantId, userId, id, { ...body, id });
      return ok(res, updated);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Delete ──────────

adminVisaRouter.delete(
  '/products/:id',
  validate(IdParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const { id } = req.params as unknown as z.infer<typeof IdParamsSchema>;
      await deleteProduct(tenantId, id);
      return ok(res, { deleted: true });
    } catch (err) {
      next(err);
    }
  },
);
