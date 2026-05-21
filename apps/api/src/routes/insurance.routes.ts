// Insurance routes — ASEGO B2B Travel Insurance integration.
//
// Phase 2 surface:
//   GET  /currencies                   master, cached 24h
//   GET  /categories                   master, cached 24h
//   GET  /master                       plan master for our partner, cached 24h
//   GET  /reasons/:type                cancellation/endorsement reasons, cached 30d
//   POST /quote                        live priced plans
//   POST /cache/invalidate             admin op (drop master cache)
//
// Phase 3 will add /validate, /issue, /endorse, /cancel, /policy/:n/pdf.
//
// All routes sit behind `search:flights` for now — same permission gating the
// other booking-trade verticals (hotels, buses, holiday, visa). When the RBAC
// catalog grows an insurance-specific permission, switch in place.

import { Router, type Router as RouterT } from 'express';
import { z } from 'zod';
import {
  InsuranceCancelRequestSchema,
  InsuranceEndorseRequestSchema,
  InsuranceIssueRequestSchema,
  InsuranceValidateRequestSchema,
  type InsuranceCancelRequest,
  type InsuranceEndorseRequest,
  type InsuranceIssueRequest,
  type InsuranceValidateRequest,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { searchAgencyLimit, bookingAgencyLimit } from '../middleware/agency-rate-limit.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import {
  invalidateMasterCache,
  listCategories,
  listCurrencies,
  listPlanMaster,
  listReasons,
} from '../services/insurance/master.service.js';
import { fetchQuote } from '../services/insurance/quote.service.js';
import { issuePolicy, validatePolicyDraft } from '../services/insurance/policy.service.js';
import { streamPolicyPdf } from '../services/insurance/download.service.js';
import { cancelPolicy } from '../services/insurance/cancel.service.js';
import { endorsePolicy } from '../services/insurance/endorse.service.js';

export const insuranceRouter: RouterT = Router();

// ────────── Health / liveness (UNAUTHENTICATED) ──────────

// Mounted BEFORE authenticate so load balancers + uptime probes don't need
// a token. Returns 200 when ASEGO master is reachable (cached 24h, so this
// is a cheap call that doesn't hit ASEGO most of the time), 503 otherwise.
insuranceRouter.get('/health', async (_req, res) => {
  try {
    const cats = await listCategories();
    return res.json({
      success: true,
      data: { ok: true, categoryCount: cats.length, supplier: 'ASEGO' },
    });
  } catch (err) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'SUPPLIER_UNAVAILABLE',
        message: err instanceof Error ? err.message : 'ASEGO unreachable',
      },
    });
  }
});

// All other routes are authenticated.
insuranceRouter.use(authenticate, requireAuth);

// All read paths share the booking-trade gate.
const gate = requirePermission('search:flights');

// ────────── Master / catalog ──────────

insuranceRouter.get('/currencies', gate, async (_req, res, next) => {
  try {
    return ok(res, await listCurrencies());
  } catch (err) {
    next(err);
  }
});

insuranceRouter.get('/categories', gate, async (_req, res, next) => {
  try {
    return ok(res, await listCategories());
  } catch (err) {
    next(err);
  }
});

insuranceRouter.get('/master', gate, async (_req, res, next) => {
  try {
    return ok(res, await listPlanMaster());
  } catch (err) {
    next(err);
  }
});

insuranceRouter.get('/reasons/:type', gate, async (req, res, next) => {
  try {
    return ok(res, await listReasons(req.params.type));
  } catch (err) {
    next(err);
  }
});

// ────────── Live quote ──────────

const QuoteRequestSchema = z.object({
  duration: z.number().int().min(1).max(365),
  age: z.number().int().min(1).max(80),
  // ASEGO category ids are UUID-shaped but not hex-strict (e.g. Asia is
  // `296a9c2f-3071-4395-g416-...`). Don't use Zod's .uuid() validator here.
  category: z.string().min(1).max(64),
  destination: z.string().max(120).optional(),
});

insuranceRouter.post('/quote', searchAgencyLimit, gate, validate(QuoteRequestSchema), async (req, res, next) => {
  try {
    const out = await fetchQuote(req.body as ReturnType<typeof QuoteRequestSchema.parse>);
    return ok(res, out);
  } catch (err) {
    next(err);
  }
});

// ────────── Validate / Issue / PDF ──────────

insuranceRouter.post(
  '/validate',
  gate,
  validate(InsuranceValidateRequestSchema),
  async (req, res, next) => {
    try {
      const out = await validatePolicyDraft(
        { tenantId: req.auth!.tenantId, userId: req.auth!.userId },
        req.body as InsuranceValidateRequest,
      );
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

insuranceRouter.post(
  '/issue',
  bookingAgencyLimit,
  gate,
  validate(InsuranceIssueRequestSchema),
  async (req, res, next) => {
    try {
      const out = await issuePolicy(
        { tenantId: req.auth!.tenantId, userId: req.auth!.userId },
        req.body as InsuranceIssueRequest,
      );
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

// PDF proxy. Streams binary directly — DO NOT wrap in `ok()` (which forces JSON).
insuranceRouter.get('/policy/:policyNumber/pdf', gate, async (req, res, next) => {
  try {
    await streamPolicyPdf({ tenantId: req.auth!.tenantId }, req.params.policyNumber, res);
  } catch (err) {
    next(err);
  }
});

// ────────── Lifecycle: endorse / cancel ──────────

insuranceRouter.post(
  '/endorse',
  gate,
  validate(InsuranceEndorseRequestSchema),
  async (req, res, next) => {
    try {
      const out = await endorsePolicy(
        { tenantId: req.auth!.tenantId, userId: req.auth!.userId },
        req.body as InsuranceEndorseRequest,
      );
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

insuranceRouter.post(
  '/cancel',
  gate,
  validate(InsuranceCancelRequestSchema),
  async (req, res, next) => {
    try {
      const out = await cancelPolicy(
        { tenantId: req.auth!.tenantId, userId: req.auth!.userId },
        req.body as InsuranceCancelRequest,
      );
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Admin: cache invalidate ──────────

insuranceRouter.post(
  '/cache/invalidate',
  // SUPER_ADMIN only — same gate used by other admin operations. We hand-roll the
  // role check here because there's no insurance-specific admin permission yet.
  (req, res, next) => {
    if (req.auth?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'SUPER_ADMIN only' },
      });
    }
    next();
  },
  async (_req, res, next) => {
    try {
      const out = await invalidateMasterCache();
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);
