// Approval routes — manager-gated workflow for travel bookings.
//
// Mounted at /api/v1/bus/approvals (under busRouter). Auth + permission
// middleware match the rest of the bus surface; service layer handles
// the manager-vs-actor authorisation per request.
//
// Routes:
//   POST  /            — submit a new bus approval request
//   GET   /mine        — current actor's own approvals (employee inbox)
//   GET   /pending     — manager queue (own scope by default; tenant_admin
//                        sees the full tenant)
//   POST  /:id/approve — manager decides → approved
//   POST  /:id/reject  — manager decides → rejected (note ≥10 chars)

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  ApprovalApproveSchema,
  ApprovalListQuerySchema,
  ApprovalRejectSchema,
  BusApprovalSubmitSchema,
  type PublicApproval,
  type ApprovalListResponse,
  type BusApprovalSubmitResponse,
} from '@tripbng/shared';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import {
  approveApproval,
  getMyApprovals,
  getPendingForManager,
  rejectApproval,
  submitBusApproval,
  type ApprovalActor,
} from '../services/approval/approval.service.js';
import type { ApprovalRequestDoc } from '../models/ApprovalRequest.js';
import type { PolicyEvalResult } from '../services/approval/policy-eval.js';

export const approvalRouter: RouterT = Router();

// Auth + tenant scoping is set up by the parent (busRouter applies
// authenticate + requireAuth before mounting this router).

const actorFromReq = (req: import('express').Request): ApprovalActor => ({
  tenantId: req.auth!.tenantId,
  userId: req.auth!.userId,
  role: req.auth!.role,
  ipAddress: req.ip ?? null,
});

// ────────── Submit ──────────

approvalRouter.post(
  '/',
  requirePermission('travel-approval:submit'),
  validate(BusApprovalSubmitSchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof BusApprovalSubmitSchema.parse>;
      const result = await submitBusApproval(actorFromReq(req), body);
      const response: BusApprovalSubmitResponse = {
        approval: toPublicApproval(result.approval),
        policy: toPublicPolicy(result.policy),
      };
      return ok(res, response);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Reads ──────────

/** Employee inbox — query param `employeeId` lets a travel-desk admin
 *  pull someone else's list; absent = caller's own employee row (resolved
 *  by the service through actor.userId in a future polish). */
approvalRouter.get(
  '/mine',
  requirePermission('travel-approval:read:own'),
  validate(ApprovalListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const employeeId = (req.query.employeeId as string | undefined) ?? '';
      if (!Types.ObjectId.isValid(employeeId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'employeeId query param required' },
        });
      }
      const filter = req.query as unknown as ReturnType<typeof ApprovalListQuerySchema.parse>;
      const result = await getMyApprovals(actorFromReq(req), employeeId, filter);
      const response: ApprovalListResponse = {
        items: result.items.map(toPublicApproval),
        total: result.total,
        page: filter.page,
        limit: filter.limit,
      };
      return ok(res, response);
    } catch (err) {
      next(err);
    }
  },
);

/** Manager queue — sees own pending requests by default; tenant_admin
 *  sees full tenant. Service layer enforces. */
approvalRouter.get(
  '/pending',
  requirePermission('travel-approval:read:pending'),
  validate(ApprovalListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const filter = req.query as unknown as ReturnType<typeof ApprovalListQuerySchema.parse>;
      const result = await getPendingForManager(actorFromReq(req), filter);
      const response: ApprovalListResponse = {
        items: result.items.map(toPublicApproval),
        total: result.total,
        page: filter.page,
        limit: filter.limit,
      };
      return ok(res, response);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Decide ──────────

approvalRouter.post(
  '/:id/approve',
  requirePermission('travel-approval:decide'),
  validate(ApprovalApproveSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { note } = req.body as ReturnType<typeof ApprovalApproveSchema.parse>;
      const doc = await approveApproval(actorFromReq(req), id!, note);
      return ok(res, toPublicApproval(doc));
    } catch (err) {
      next(err);
    }
  },
);

approvalRouter.post(
  '/:id/reject',
  requirePermission('travel-approval:decide'),
  validate(ApprovalRejectSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { note } = req.body as ReturnType<typeof ApprovalRejectSchema.parse>;
      const doc = await rejectApproval(actorFromReq(req), id!, note);
      return ok(res, toPublicApproval(doc));
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Mappers ──────────

function toPublicApproval(d: ApprovalRequestDoc): PublicApproval {
  const p = d.payload;
  return {
    id: String(d._id),
    type: 'bus',
    status: d.status as PublicApproval['status'],
    employeeId: String(d.employeeId),
    managerId: d.managerId ? String(d.managerId) : null,
    travelPolicyId: d.travelPolicyId ? String(d.travelPolicyId) : null,
    payload: {
      sourceCityId: p.sourceCityId,
      destinationCityId: p.destinationCityId,
      doj: p.doj,
      tripId: p.tripId,
      inventoryId: p.inventoryId,
      seatNumbers: p.seatNumbers,
      boardingPointId: p.boardingPointId,
      droppingPointId: p.droppingPointId,
      estimatedFarePaise: p.estimatedFarePaise,
      estimatedTotalPaise: p.estimatedTotalPaise,
      operatorName: p.operatorName ?? '',
      busType: p.busType ?? '',
      departureAt: p.departureAt,
      arrivalAt: p.arrivalAt,
    },
    policyViolations: d.policyViolations,
    approverNote: d.approverNote ?? null,
    expiresAt: d.expiresAt.toISOString(),
    decidedAt: d.decidedAt ? d.decidedAt.toISOString() : null,
    decidedByUserId: d.decidedByUserId ? String(d.decidedByUserId) : null,
    bookingId: d.bookingId ? String(d.bookingId) : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function toPublicPolicy(p: PolicyEvalResult) {
  return {
    ok: p.ok,
    violations: p.violations,
    requiresApproval: p.requiresApproval,
    autoApproveEligible: p.autoApproveEligible,
  };
}
