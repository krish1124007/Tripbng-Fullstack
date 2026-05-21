import { Router, type Request, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  AppError,
  CostCentreSchema,
  CreateAgencyRequestSchema,
  DEFAULT_HOTEL_POLICIES,
  DEFAULT_NOTIFICATION_PREFS,
  GlCodeSchema,
  PaginationQuerySchema,
  UpdateAgencyRequestSchema,
  UpdateHotelPoliciesSchema,
  UpdateNotificationPrefsSchema,
  type HotelPolicies,
  type NotificationPrefs,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { Agency } from '../models/Agency.js';
import { createAgency, serializeAgency, updateAgency } from '../services/agency.service.js';
import { recordAudit } from '../services/audit.service.js';
import { readAgencyBalance, readAgencyBalances } from '../services/wallet/balance-reader.js';
import { containsRegex } from '../utils/regex.js';

export const agencyRouter: RouterT = Router();

agencyRouter.use(authenticate, requireAuth);

agencyRouter.get('/', validate(PaginationQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { page, limit, q } = req.query as unknown as ReturnType<
      typeof PaginationQuerySchema.parse
    >;
    const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
    if (req.auth!.role === 'DISTRIBUTOR') filter.distributorId = req.auth!.distributorId;
    if (req.auth!.role === 'AGENCY') filter._id = req.auth!.agencyId;
    if (req.auth!.role === 'SUB_AGENT') filter._id = req.auth!.agencyId;
    {
      const re = containsRegex(q);
      if (re) filter.$or = [{ companyName: re }, { agencyCode: re }];
    }
    const [items, total] = await Promise.all([
      Agency.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Agency.countDocuments(filter),
    ]);
    // Resolve wallet balances in a single round-trip — list endpoints would
    // otherwise eat an N+1 lookup per row.
    const balances = await readAgencyBalances(items.map((a) => a._id));
    return ok(
      res,
      items.map((a) =>
        serializeAgency(a, { walletBalanceOverride: balances.get(String(a._id)) }),
      ),
      { page, limit, total, totalPages: Math.ceil(total / limit) },
    );
  } catch (err) {
    next(err);
  }
});

agencyRouter.get('/:id', async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('AGENCY_NOT_FOUND');
    const filter: Record<string, unknown> = {
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    };
    if (req.auth!.role === 'DISTRIBUTOR') filter.distributorId = req.auth!.distributorId;
    if (req.auth!.role === 'AGENCY' && String(req.auth!.agencyId) !== req.params.id) {
      throw new AppError('FORBIDDEN');
    }
    const agency = await Agency.findOne(filter);
    if (!agency) throw new AppError('AGENCY_NOT_FOUND');
    const walletBalanceOverride = await readAgencyBalance(agency._id);
    return ok(res, serializeAgency(agency, { walletBalanceOverride }));
  } catch (err) {
    next(err);
  }
});

agencyRouter.post(
  '/',
  requirePermission('agency:create'),
  validate(CreateAgencyRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateAgencyRequestSchema.parse>;
      // Distributors may only create agencies under themselves.
      if (req.auth!.role === 'DISTRIBUTOR') {
        input.distributorId = req.auth!.distributorId ?? undefined;
      }
      const { agency } = await createAgency(req.auth!.tenantId, input, req.auth!.userId);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'agency.create',
        resource: 'agency',
        resourceId: String(agency._id),
        after: { companyName: agency.companyName, agencyCode: agency.agencyCode },
      });
      return created(res, serializeAgency(agency));
    } catch (err) {
      next(err);
    }
  },
);

agencyRouter.patch(
  '/:id',
  requirePermission('agency:update'),
  validate(UpdateAgencyRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('AGENCY_NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateAgencyRequestSchema.parse>;
      const before = await Agency.findOne({
        _id: req.params.id,
        tenantId: req.auth!.tenantId,
      }).lean();
      if (!before) throw new AppError('AGENCY_NOT_FOUND');
      if (
        req.auth!.role === 'DISTRIBUTOR' &&
        String(before.distributorId) !== req.auth!.distributorId
      ) {
        throw new AppError('FORBIDDEN');
      }
      const agency = await updateAgency(req.params.id, input, req.auth!.userId);
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'agency.update',
        resource: 'agency',
        resourceId: req.params.id,
        before: { status: before.status, creditLimit: before.creditLimit },
        after: { status: agency.status, creditLimit: agency.creditLimit },
      });
      return ok(res, serializeAgency(agency));
    } catch (err) {
      next(err);
    }
  },
);

// ───────── Notification preferences ─────────
//
// GET  /agencies/:id/notification-prefs — read the current per-agency prefs
// PUT  /agencies/:id/notification-prefs — partial update (any field optional)
//
// Authorization rules:
//   - SUPER_ADMIN can read/write any agency's prefs
//   - DISTRIBUTOR can read/write agencies under their downline
//   - AGENCY (and SUB_AGENT scoped to that agency) can read/write only their own
//
// We re-use the same scoping pattern as the rest of agency.routes.ts to
// keep the auth surface uniform.
async function loadAgencyForPrefs(req: Request) {
  const id = req.params.id;
  if (!id || !Types.ObjectId.isValid(id)) throw new AppError('AGENCY_NOT_FOUND');
  const auth = req.auth!;
  const filter: Record<string, unknown> = {
    _id: id,
    tenantId: auth.tenantId,
  };
  if (auth.role === 'DISTRIBUTOR') filter.distributorId = auth.distributorId;
  if (
    (auth.role === 'AGENCY' || auth.role === 'SUB_AGENT') &&
    String(auth.agencyId) !== id
  ) {
    throw new AppError('FORBIDDEN');
  }
  const agency = await Agency.findOne(filter);
  if (!agency) throw new AppError('AGENCY_NOT_FOUND');
  return agency;
}

agencyRouter.get('/:id/notification-prefs', async (req, res, next) => {
  try {
    const agency = await loadAgencyForPrefs(req);
    const raw = agency.notificationPrefs;
    // Build a fully-defaulted view so callers never have to handle null
    // sub-fields. Older agency docs created before the schema landed get
    // the default shape transparently.
    const prefs: NotificationPrefs = {
      channels: {
        email: raw?.channels?.email ?? DEFAULT_NOTIFICATION_PREFS.channels.email,
        whatsapp: raw?.channels?.whatsapp ?? DEFAULT_NOTIFICATION_PREFS.channels.whatsapp,
        inapp: raw?.channels?.inapp ?? DEFAULT_NOTIFICATION_PREFS.channels.inapp,
      },
      events: (raw?.events as NotificationPrefs['events']) ?? {},
      lowBalanceThresholdPaise: raw?.lowBalanceThresholdPaise ?? null,
    };
    return ok(res, prefs);
  } catch (err) {
    next(err);
  }
});

agencyRouter.put(
  '/:id/notification-prefs',
  validate(UpdateNotificationPrefsSchema),
  async (req, res, next) => {
    try {
      const agency = await loadAgencyForPrefs(req);
      const input = req.body as ReturnType<typeof UpdateNotificationPrefsSchema.parse>;

      // Merge the partial update on top of whatever's already stored. We
      // don't blow away unspecified fields — partial PUTs are the natural UX.
      // Cast to the Mongoose-inferred subdoc shape; older agency docs that
      // pre-date the schema may have undefined sub-fields, hence all the
      // optional chaining + defaults below.
      const current = (agency.notificationPrefs ?? {}) as Partial<{
        channels: Partial<NotificationPrefs['channels']>;
        events: NotificationPrefs['events'];
        lowBalanceThresholdPaise: number | null;
      }>;
      const next: NotificationPrefs = {
        channels: {
          email:
            input.channels?.email ??
            current.channels?.email ??
            DEFAULT_NOTIFICATION_PREFS.channels.email,
          whatsapp:
            input.channels?.whatsapp ??
            current.channels?.whatsapp ??
            DEFAULT_NOTIFICATION_PREFS.channels.whatsapp,
          inapp:
            input.channels?.inapp ??
            current.channels?.inapp ??
            DEFAULT_NOTIFICATION_PREFS.channels.inapp,
        },
        events: input.events ?? current.events ?? {},
        lowBalanceThresholdPaise:
          input.lowBalanceThresholdPaise !== undefined
            ? input.lowBalanceThresholdPaise
            : (current.lowBalanceThresholdPaise ?? null),
      };

      agency.notificationPrefs = next as typeof agency.notificationPrefs;
      await agency.save();

      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'agency.notification-prefs.update',
        resource: 'agency',
        resourceId: String(agency._id),
        before: { notificationPrefs: current },
        after: { notificationPrefs: next },
      });

      return ok(res, next);
    } catch (err) {
      next(err);
    }
  },
);

// ───────── Hotel travel policies ─────────

agencyRouter.get('/:id/policies/hotel', async (req, res, next) => {
  try {
    const agency = await loadAgencyForPrefs(req);
    const raw = agency.hotelPolicies;
    const policies: HotelPolicies = {
      maxPerNightPaise: raw?.maxPerNightPaise ?? DEFAULT_HOTEL_POLICIES.maxPerNightPaise,
      refundableOnly: raw?.refundableOnly ?? DEFAULT_HOTEL_POLICIES.refundableOnly,
      preferredChains: raw?.preferredChains ?? DEFAULT_HOTEL_POLICIES.preferredChains,
      blockedChains: raw?.blockedChains ?? DEFAULT_HOTEL_POLICIES.blockedChains,
      allowedStarRatings:
        raw?.allowedStarRatings ?? DEFAULT_HOTEL_POLICIES.allowedStarRatings,
      requireApprovalAbovePaise:
        raw?.requireApprovalAbovePaise ?? DEFAULT_HOTEL_POLICIES.requireApprovalAbovePaise,
      defaultApproverUserId: raw?.defaultApproverUserId
        ? String(raw.defaultApproverUserId)
        : null,
      markupPercent: raw?.markupPercent ?? DEFAULT_HOTEL_POLICIES.markupPercent,
    };
    return ok(res, policies);
  } catch (err) {
    next(err);
  }
});

agencyRouter.put(
  '/:id/policies/hotel',
  validate(UpdateHotelPoliciesSchema),
  async (req, res, next) => {
    try {
      const agency = await loadAgencyForPrefs(req);
      const input = req.body as ReturnType<typeof UpdateHotelPoliciesSchema.parse>;
      const current = (agency.hotelPolicies ?? {}) as Partial<HotelPolicies> & {
        defaultApproverUserId?: { toString(): string } | string | null;
      };
      const merged: HotelPolicies = {
        maxPerNightPaise:
          input.maxPerNightPaise !== undefined
            ? input.maxPerNightPaise
            : current.maxPerNightPaise ?? null,
        refundableOnly: input.refundableOnly ?? current.refundableOnly ?? false,
        preferredChains: input.preferredChains ?? current.preferredChains ?? [],
        blockedChains: input.blockedChains ?? current.blockedChains ?? [],
        allowedStarRatings:
          input.allowedStarRatings ?? current.allowedStarRatings ?? [],
        requireApprovalAbovePaise:
          input.requireApprovalAbovePaise !== undefined
            ? input.requireApprovalAbovePaise
            : current.requireApprovalAbovePaise ?? null,
        defaultApproverUserId:
          input.defaultApproverUserId !== undefined
            ? input.defaultApproverUserId
            : current.defaultApproverUserId == null
            ? null
            : String(current.defaultApproverUserId),
        markupPercent:
          input.markupPercent !== undefined ? input.markupPercent : current.markupPercent ?? null,
      };
      agency.hotelPolicies = merged as typeof agency.hotelPolicies;
      await agency.save();
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'agency.hotel-policies.update',
        resource: 'agency',
        resourceId: String(agency._id),
        before: { hotelPolicies: current },
        after: { hotelPolicies: merged },
      });
      return ok(res, merged);
    } catch (err) {
      next(err);
    }
  },
);

// ───────── Cost centres ─────────

agencyRouter.get('/:id/cost-centres', async (req, res, next) => {
  try {
    const agency = await loadAgencyForPrefs(req);
    return ok(res, agency.costCentres ?? []);
  } catch (err) {
    next(err);
  }
});

agencyRouter.post(
  '/:id/cost-centres',
  validate(CostCentreSchema),
  async (req, res, next) => {
    try {
      const agency = await loadAgencyForPrefs(req);
      const input = req.body as ReturnType<typeof CostCentreSchema.parse>;
      // Upsert by code — repeated POSTs of the same code update name/active.
      const existing = (agency.costCentres ?? []).find((c) => c.code === input.code);
      if (existing) {
        existing.name = input.name;
        existing.isActive = input.isActive;
      } else {
        agency.costCentres.push(input);
      }
      await agency.save();
      return ok(res, agency.costCentres);
    } catch (err) {
      next(err);
    }
  },
);

agencyRouter.delete('/:id/cost-centres/:code', async (req, res, next) => {
  try {
    const agency = await loadAgencyForPrefs(req);
    const code = req.params.code;
    // Soft delete — flip isActive false rather than splice. Past bookings
    // still reference the code; finance reports need the lookup to work.
    const cc = (agency.costCentres ?? []).find((c) => c.code === code);
    if (!cc) throw new AppError('NOT_FOUND', { reason: 'cost centre not found' });
    cc.isActive = false;
    await agency.save();
    return ok(res, agency.costCentres);
  } catch (err) {
    next(err);
  }
});

// ───────── GL codes ─────────

agencyRouter.get('/:id/gl-codes', async (req, res, next) => {
  try {
    const agency = await loadAgencyForPrefs(req);
    return ok(res, agency.glCodes ?? []);
  } catch (err) {
    next(err);
  }
});

agencyRouter.post(
  '/:id/gl-codes',
  validate(GlCodeSchema),
  async (req, res, next) => {
    try {
      const agency = await loadAgencyForPrefs(req);
      const input = req.body as ReturnType<typeof GlCodeSchema.parse>;
      const existing = (agency.glCodes ?? []).find((c) => c.code === input.code);
      if (existing) {
        existing.name = input.name;
        existing.category = input.category ?? null;
        existing.isActive = input.isActive;
      } else {
        agency.glCodes.push({
          code: input.code,
          name: input.name,
          category: input.category ?? null,
          isActive: input.isActive,
        });
      }
      await agency.save();
      return ok(res, agency.glCodes);
    } catch (err) {
      next(err);
    }
  },
);

agencyRouter.delete('/:id/gl-codes/:code', async (req, res, next) => {
  try {
    const agency = await loadAgencyForPrefs(req);
    const code = req.params.code;
    const gl = (agency.glCodes ?? []).find((c) => c.code === code);
    if (!gl) throw new AppError('NOT_FOUND', { reason: 'GL code not found' });
    gl.isActive = false;
    await agency.save();
    return ok(res, agency.glCodes);
  } catch (err) {
    next(err);
  }
});
