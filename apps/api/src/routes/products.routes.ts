// Routes for the 5 non-flight product modules. All endpoints require auth +
// the standard `search:flights` permission (the same permission gates booking-trade
// access in general — extending later if hotels/visa want their own permission key).
//
// Once a real supplier integration ships, swap the adapter wired in
// services/products.service.ts. The route surface stays identical.

import { Router, type Router as RouterT } from 'express';
import { z } from 'zod';
import {
  AdminHolidayPackageListQuerySchema,
  BusSearchRequestSchema,
  HolidaySearchRequestSchema,
  HotelSearchRequestSchema,
  InsuranceQuoteRequestSchema,
  VisaQuoteRequestSchema,
  type BusSearchRequest,
  type HolidaySearchRequest,
  type HotelSearchRequest,
  type InsuranceQuoteRequest,
  type VisaQuoteRequest,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import {
  quoteInsurance,
  quoteVisa,
  searchBuses,
  searchHolidays,
  searchHotels,
} from '../services/products.service.js';
import { getPublicPackage, listPublicPackages } from '../services/holidayPackage.service.js';
import {
  getPublicProduct,
  listProductsForCountry,
  listPublicProducts,
} from '../services/visaProduct.service.js';

export const productsRouter: RouterT = Router();

productsRouter.use(authenticate, requireAuth);

// All 5 endpoints sit behind the same booking-trade permission used for /search/flights.
// Refactor to per-product permissions later if RBAC needs to differentiate.
const gate = requirePermission('search:flights');

// ────────── HOTELS ──────────

productsRouter.post(
  '/hotels/search',
  gate,
  validate(HotelSearchRequestSchema),
  async (req, res, next) => {
    try {
      const out = await searchHotels(req.body as HotelSearchRequest);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── BUSES ──────────

productsRouter.post(
  '/buses/search',
  gate,
  validate(BusSearchRequestSchema),
  async (req, res, next) => {
    try {
      const out = await searchBuses(req.body as BusSearchRequest);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── HOLIDAYS ──────────

productsRouter.post(
  '/holidays/search',
  gate,
  validate(HolidaySearchRequestSchema),
  async (req, res, next) => {
    try {
      const out = await searchHolidays(req.body as HolidaySearchRequest);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

// Admin-authored holiday packages — public reads. Tenant-scoped, gated to
// `published: true`, distinct from the legacy /holidays/search mock above.
// Both surfaces coexist; the search endpoint will keep working until the
// customer detail page (Phase D) consumes admin-authored packages.

const HolidayPackageIdParamsSchema = z.object({ id: z.string().min(1).max(120) });

productsRouter.get(
  '/holidays/packages',
  gate,
  validate(AdminHolidayPackageListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const query = req.query as unknown as z.infer<typeof AdminHolidayPackageListQuerySchema>;
      const items = await listPublicPackages(tenantId, query);
      return ok(res, { items });
    } catch (err) {
      next(err);
    }
  },
);

productsRouter.get(
  '/holidays/packages/:id',
  gate,
  validate(HolidayPackageIdParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const { id } = req.params as unknown as z.infer<typeof HolidayPackageIdParamsSchema>;
      const pkg = await getPublicPackage(tenantId, id);
      return ok(res, pkg);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── VISA ──────────

productsRouter.post(
  '/visa/quote',
  gate,
  validate(VisaQuoteRequestSchema),
  async (req, res, next) => {
    try {
      const out = await quoteVisa(req.body as VisaQuoteRequest);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

// Admin-authored visa products — public reads. Tenant-scoped, gated to
// `published: true`. Distinct from the legacy /visa/quote mock above; both
// surfaces coexist while the customer detail page (Phase D) is built out.

const VisaProductIdParamsSchema = z.object({ id: z.string().min(1).max(120) });
const VisaCountryParamsSchema = z.object({ countryId: z.string().min(1).max(120) });
const VisaPublicListQuerySchema = z.object({
  q: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  iso2: z.string().length(2).optional(),
  purpose: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

productsRouter.get(
  '/visa/products',
  gate,
  validate(VisaPublicListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const query = req.query as unknown as z.infer<typeof VisaPublicListQuerySchema>;
      const items = await listPublicProducts(tenantId, query);
      return ok(res, { items });
    } catch (err) {
      next(err);
    }
  },
);

productsRouter.get(
  '/visa/products/:id',
  gate,
  validate(VisaProductIdParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const { id } = req.params as unknown as z.infer<typeof VisaProductIdParamsSchema>;
      const product = await getPublicProduct(tenantId, id);
      return ok(res, product);
    } catch (err) {
      next(err);
    }
  },
);

// "Curated visa products" surface used by the customer page on
// /visa/countries/[id]. We don't have a separate countries collection; this
// just returns the published products keyed to the country slug.
productsRouter.get(
  '/visa/countries/:countryId',
  gate,
  validate(VisaCountryParamsSchema, 'params'),
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const { countryId } = req.params as unknown as z.infer<typeof VisaCountryParamsSchema>;
      const products = await listProductsForCountry(tenantId, countryId);
      return ok(res, { countryId, products });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── INSURANCE ──────────

productsRouter.post(
  '/insurance/quote',
  gate,
  validate(InsuranceQuoteRequestSchema),
  async (req, res, next) => {
    try {
      const out = await quoteInsurance(req.body as InsuranceQuoteRequest);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);
