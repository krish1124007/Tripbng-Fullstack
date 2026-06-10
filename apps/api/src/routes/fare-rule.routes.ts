import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  AppError,
  CreateFareRuleRequestSchema,
  FARE_RULE_CABIN_TYPE,
  FARE_RULE_REFUND_TYPE,
  FARE_RULE_STATUS,
  FARE_RULE_TRIP_TYPE,
  PaginationQuerySchema,
  UpdateFareRuleRequestSchema,
} from '@tripbng/shared';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { FareRule } from '../models/FareRule.js';
import { recordAudit } from '../services/audit.service.js';

export const fareRuleRouter: RouterT = Router();

fareRuleRouter.use(authenticate, requireAuth);

// A relation field is either a raw ObjectId or — once populated — a {_id, name}
// subdoc. Extract both the id string and (when available) the display name.
type RefMaybe = Types.ObjectId | { _id: Types.ObjectId; name?: string } | null | undefined;
function refParts(ref: RefMaybe): { id: string | null; name: string | null } {
  if (!ref) return { id: null, name: null };
  if (ref instanceof Types.ObjectId) return { id: String(ref), name: null };
  const o = ref as { _id: Types.ObjectId; name?: string };
  return { id: String(o._id), name: o.name ?? null };
}

function serialize(r: InstanceType<typeof FareRule>) {
  const src = refParts(r.sourceId as unknown as RefMaybe);
  const grp = refParts(r.agencyGroupId as unknown as RefMaybe);
  return {
    id: String(r._id),
    name: r.name,
    tripType: r.tripType ?? 'ALL',
    cabinType: r.cabinType ?? 'ALL',
    refundType: r.refundType ?? 'REFUNDABLE',
    status: r.status ?? 'ACTIVE',
    airline: r.airline || null,
    sourceId: src.id,
    sourceName: src.name,
    agencyGroupId: grp.id,
    agencyGroupName: grp.name,
    conditionAction: r.conditionAction ?? 'INCLUDE',
    scheduleFrom: r.scheduleFrom ? r.scheduleFrom.toISOString() : null,
    scheduleTo: r.scheduleTo ? r.scheduleTo.toISOString() : null,
    conditions: (r.conditions ?? []).map((c) => ({
      origin: c.origin ?? '',
      destination: c.destination ?? '',
      fareType: c.fareType ?? '',
      bookingClass: c.bookingClass ?? '',
      fareBasis: c.fareBasis ?? '',
      sector: c.sector ?? '',
      travelDate: c.travelDate ? c.travelDate.toISOString() : null,
    })),
    cancellationBands: r.cancellationBands ?? [],
    reschedulingBands: r.reschedulingBands ?? [],
    noShowPenaltyPaise: r.noShowPenaltyPaise ?? 0,
    noShowAdditionalFeePaise: r.noShowAdditionalFeePaise ?? 0,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// Manage Fare Rule list query — pagination + the reference search filters.
const FareRuleListQuerySchema = PaginationQuerySchema.extend({
  source: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  agencyGroup: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  tripType: z.enum(FARE_RULE_TRIP_TYPE).optional(),
  cabinType: z.enum(FARE_RULE_CABIN_TYPE).optional(),
  refundType: z.enum(FARE_RULE_REFUND_TYPE).optional(),
  airline: z.string().trim().toUpperCase().min(2).max(3).optional(),
  status: z.enum(FARE_RULE_STATUS).optional(),
});

fareRuleRouter.get(
  '/',
  requirePermission('fare-rule:read'),
  validate(FareRuleListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { page, limit, q, source, agencyGroup, tripType, cabinType, refundType, airline, status } =
        req.query as unknown as ReturnType<typeof FareRuleListQuerySchema.parse>;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (q) filter.name = new RegExp(q, 'i');
      if (source) filter.sourceId = source;
      if (agencyGroup) filter.agencyGroupId = agencyGroup;
      if (tripType) filter.tripType = tripType;
      if (cabinType) filter.cabinType = cabinType;
      if (refundType) filter.refundType = refundType;
      if (airline) filter.airline = airline;
      if (status) filter.status = status;
      const [items, total] = await Promise.all([
        FareRule.find(filter)
          .populate('sourceId', 'name')
          .populate('agencyGroupId', 'name')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        FareRule.countDocuments(filter),
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

fareRuleRouter.get('/:id', requirePermission('fare-rule:read'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const rule = await FareRule.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId })
      .populate('sourceId', 'name')
      .populate('agencyGroupId', 'name');
    if (!rule) throw new AppError('NOT_FOUND');
    return ok(res, serialize(rule));
  } catch (err) {
    next(err);
  }
});

fareRuleRouter.post(
  '/',
  requirePermission('fare-rule:create'),
  validate(CreateFareRuleRequestSchema),
  async (req, res, next) => {
    try {
      const input = req.body as ReturnType<typeof CreateFareRuleRequestSchema.parse>;
      const rule = await FareRule.create({
        tenantId: req.auth!.tenantId,
        ...input,
        // Empty-string relations from the form → null for clean ObjectId storage.
        sourceId: input.sourceId || null,
        agencyGroupId: input.agencyGroupId || null,
        createdBy: req.auth!.userId,
      });
      await rule.populate('sourceId', 'name');
      await rule.populate('agencyGroupId', 'name');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'fare-rule.create',
        resource: 'fare-rule',
        resourceId: String(rule._id),
        after: { name: rule.name },
      });
      return created(res, serialize(rule));
    } catch (err) {
      next(err);
    }
  },
);

fareRuleRouter.patch(
  '/:id',
  requirePermission('fare-rule:update'),
  validate(UpdateFareRuleRequestSchema),
  async (req, res, next) => {
    try {
      if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
      const input = req.body as ReturnType<typeof UpdateFareRuleRequestSchema.parse>;
      const set: Record<string, unknown> = { ...input, updatedBy: req.auth!.userId };
      // Only normalize relations that were actually sent, so a partial update
      // doesn't accidentally clear an unrelated field.
      if ('sourceId' in input) set.sourceId = input.sourceId || null;
      if ('agencyGroupId' in input) set.agencyGroupId = input.agencyGroupId || null;
      const updated = await FareRule.findOneAndUpdate(
        { _id: req.params.id, tenantId: req.auth!.tenantId },
        { $set: set },
        { new: true },
      )
        .populate('sourceId', 'name')
        .populate('agencyGroupId', 'name');
      if (!updated) throw new AppError('NOT_FOUND');
      await recordAudit({
        tenantId: req.auth!.tenantId,
        actorId: req.auth!.userId,
        actorRole: req.auth!.role,
        action: 'fare-rule.update',
        resource: 'fare-rule',
        resourceId: req.params.id,
      });
      return ok(res, serialize(updated));
    } catch (err) {
      next(err);
    }
  },
);

fareRuleRouter.delete('/:id', requirePermission('fare-rule:delete'), async (req, res, next) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError('NOT_FOUND');
    const deleted = await FareRule.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.auth!.tenantId,
    });
    if (!deleted) throw new AppError('NOT_FOUND');
    await recordAudit({
      tenantId: req.auth!.tenantId,
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      action: 'fare-rule.delete',
      resource: 'fare-rule',
      resourceId: req.params.id,
    });
    return ok(res, { ok: true });
  } catch (err) {
    next(err);
  }
});
