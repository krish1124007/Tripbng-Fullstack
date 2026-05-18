// Hotel-booking approval workflow endpoints.
//
// Routes:
//   GET   /api/v1/hotel-approvals/pending        — approver's queue
//   POST  /api/v1/hotel-approvals/:id/approve    — approve + execute TBO Book
//   POST  /api/v1/hotel-approvals/:id/reject     — reject + persist reason
//
// Authorization: scoped to the calling user. SUPER_ADMIN sees everything in
// their tenant. Other users see only bookings where pendingApproval.approverUserId
// matches their userId. The /approve and /reject service-layer calls do
// their own auth check too — defence in depth.

import { Router, type Router as RouterT } from 'express';
import {
  ApproveBookingRequestSchema,
  RejectBookingRequestSchema,
} from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { ok } from '../utils/response.js';
import { validate } from '../utils/validate.js';
import {
  approveBooking,
  listPendingApprovals,
  rejectBooking,
} from '../services/tbo/approval.service.js';

export const hotelApprovalsRouter: RouterT = Router();

hotelApprovalsRouter.use(authenticate, requireAuth, requirePermission('booking:approve'));

hotelApprovalsRouter.get('/pending', async (req, res, next) => {
  try {
    const items = await listPendingApprovals({
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      role: req.auth!.role,
    });
    return ok(res, items);
  } catch (err) {
    next(err);
  }
});

hotelApprovalsRouter.post(
  '/:id/approve',
  validate(ApproveBookingRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof ApproveBookingRequestSchema.parse>;
      const result = await approveBooking(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
        },
        req.params.id,
        body.note,
      );
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

hotelApprovalsRouter.post(
  '/:id/reject',
  validate(RejectBookingRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof RejectBookingRequestSchema.parse>;
      const result = await rejectBooking(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
        },
        req.params.id,
        body.reason,
      );
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);
