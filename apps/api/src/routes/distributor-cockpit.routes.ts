// Companion router under /distributors/:id/. Sits beside the regular distributorRouter and
// owns dashboard / earnings / dormant / nudge endpoints — keeps the cockpit concern grouped
// without overloading the main distributor CRUD file.
import { Router, type Request, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  DormantQuerySchema,
  EarningsQuerySchema,
  NudgeRequestSchema,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { Agency } from '../models/Agency.js';
import { User } from '../models/User.js';
import { recordAudit } from '../services/audit.service.js';
import { emit } from '../services/notification.service.js';
import {
  loadDashboardSummary,
  loadDormantAgencies,
  loadEarningsBreakdown,
} from '../services/distributor-cockpit.service.js';

export const distributorCockpitRouter: RouterT = Router({ mergeParams: true });
distributorCockpitRouter.use(authenticate, requireAuth);

// Distributors can only target themselves; super admin can target any distributor.
function assertScope(req: Request<{ id?: string }>): string {
  const id = req.params.id;
  if (!id || !Types.ObjectId.isValid(id)) throw new AppError('DISTRIBUTOR_NOT_FOUND');
  if (req.auth!.role === 'DISTRIBUTOR' && req.auth!.distributorId !== id) {
    throw new AppError('FORBIDDEN');
  }
  return id;
}

distributorCockpitRouter.get(
  '/dashboard',
  requirePermission('distributor:cockpit:read'),
  async (req, res, next) => {
    try {
      const distributorId = assertScope(req);
      const summary = await loadDashboardSummary({
        tenantId: req.auth!.tenantId,
        distributorId,
      });
      return ok(res, summary);
    } catch (err) {
      next(err);
    }
  },
);

distributorCockpitRouter.get(
  '/earnings',
  requirePermission('distributor:earnings:read'),
  validate(EarningsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const distributorId = assertScope(req);
      const q = req.query as unknown as ReturnType<typeof EarningsQuerySchema.parse>;
      const out = await loadEarningsBreakdown({ tenantId: req.auth!.tenantId, distributorId }, q);
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

distributorCockpitRouter.get(
  '/dormant-agencies',
  requirePermission('distributor:cockpit:read'),
  validate(DormantQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const distributorId = assertScope(req);
      const { cutoffDays } = req.query as unknown as ReturnType<typeof DormantQuerySchema.parse>;
      const out = await loadDormantAgencies(
        { tenantId: req.auth!.tenantId, distributorId },
        cutoffDays,
      );
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

distributorCockpitRouter.post(
  '/nudge',
  requirePermission('distributor:nudge'),
  validate(NudgeRequestSchema),
  async (req, res, next) => {
    try {
      const distributorId = assertScope(req);
      const body = req.body as ReturnType<typeof NudgeRequestSchema.parse>;

      // Sanity-check the target agency belongs to this distributor (or super admin).
      const agency = await Agency.findOne({
        _id: body.agencyId,
        tenantId: req.auth!.tenantId,
      }).lean();
      if (!agency) throw new AppError('AGENCY_NOT_FOUND');
      if (String(agency.distributorId) !== distributorId && req.auth!.role !== 'SUPER_ADMIN') {
        throw new AppError('FORBIDDEN');
      }

      // Drop a notification per active user under the agency. EMAIL/SMS go through provider
      // stubs (configured-or-queue) inside the notification service.
      const owners = await User.find({
        tenantId: req.auth!.tenantId,
        agencyId: body.agencyId,
        status: 'ACTIVE',
      })
        .select('_id email')
        .lean();
      const message =
        body.message ??
        `Hey, we noticed you haven't booked recently. Reach out if there's anything we can help with.`;
      await Promise.all(
        owners.map((u) =>
          emit({
            tenantId: req.auth!.tenantId,
            userId: String(u._id),
            agencyId: body.agencyId,
            distributorId,
            category: 'OPERATIONAL',
            channel: body.channel,
            priority: 'NORMAL',
            title: 'Re-engagement nudge',
            body: message,
            metadata: body.channel === 'EMAIL' ? { email: u.email } : null,
          }),
        ),
      );

      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'distributor.nudge',
        resource: 'agency',
        resourceId: body.agencyId,
        after: {
          channel: body.channel,
          message,
          distributorId,
          recipientCount: owners.length,
        },
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });

      return ok(res, {
        ok: true,
        agencyId: body.agencyId,
        channel: body.channel,
        recipients: owners.length,
        deliveryNote:
          body.channel === 'IN_APP'
            ? 'Notification posted to the agency feed.'
            : 'Queued for delivery (provider keys may be unset in dev).',
      });
    } catch (err) {
      next(err);
    }
  },
);
