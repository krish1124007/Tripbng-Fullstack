// /internal/* — service-to-service endpoints for the booking engine ↔ wallet
// integration (spec §4.4). Every route under this router is gated by the
// `X-Internal-Key` shared-secret check; see middleware/internal-auth.ts.
//
// Why a separate router (not just a few /admin paths)
//   These calls originate inside our own infra, never from a customer
//   browser. Splitting them into their own namespace makes the threat model
//   explicit, lets us tighten the auth pattern (shared secret → mTLS) in
//   one place, and keeps rate-limit / CORS policy simple for the public
//   surface.

import { Router, type Router as RouterT } from 'express';
import { z } from 'zod';
import { AppError } from '@tripbng/shared';
import { requireInternalApiKey } from '../middleware/internal-auth.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { resolveRate } from '../services/wallet/rate.service.js';
import { RATE_SERVICE } from '../models/RateConfiguration.js';

export const internalRouter: RouterT = Router();

internalRouter.use(requireInternalApiKey);

// ─────────────────────────────────────────────────────────────────────────────
// POST /internal/resolve-rate
//   Used by the booking engine to fetch the applicable markup for a given
//   (agency, service, supplier, route). Returns the resolved config (or
//   null) plus the computed markup in paise.
// ─────────────────────────────────────────────────────────────────────────────

const ResolveRateBodySchema = z.object({
  tenantId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  agencyId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  service: z.enum(RATE_SERVICE),
  supplierId: z.string().optional().nullable(),
  route: z
    .object({
      from: z.string().min(2).max(8),
      to: z.string().min(2).max(8),
    })
    .optional()
    .nullable(),
  airline: z.string().min(2).max(4).optional().nullable(),
  baseAmountPaise: z.number().int().nonnegative().optional().nullable(),
});

internalRouter.post(
  '/resolve-rate',
  validate(ResolveRateBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof ResolveRateBodySchema.parse>;
      const result = await resolveRate({
        tenantId: body.tenantId,
        agencyId: body.agencyId,
        service: body.service,
        supplierId: body.supplierId ?? null,
        route: body.route ?? null,
        airline: body.airline ?? null,
        baseAmountPaise: body.baseAmountPaise ?? null,
      });

      return ok(res, {
        // Serialise the config defensively — callers shouldn't need the
        // mongo internals.
        config: result.config
          ? {
              id: String(result.config._id),
              module: result.config.module,
              service: result.config.service,
              scope: result.config.scope,
              markupType: result.config.markupType,
              priority: result.config.priority,
            }
          : null,
        resolvedModule: result.resolvedModule,
        markupPaise: result.markupPaise,
        fromCache: result.fromCache,
      });
    } catch (err) {
      // Map "agency not found" → 404 for callers; otherwise propagate.
      if (err instanceof AppError) return next(err);
      return next(err);
    }
  },
);
