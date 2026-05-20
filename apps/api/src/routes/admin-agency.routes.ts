// Admin-only endpoints for the agency-wallet Phase-1..4 features.
// Surfaces the services in services/wallet/agency-config + the
// distributor-transfer admin actions. Every route here requires SUPER_ADMIN.
//
// Mounted at `/admin` so the URLs read as /admin/agencies/:id/module etc.
// (matches the spec §4.3 layout). Sits alongside the existing public
// /agencies routes — those keep working unchanged.

import { Router, type Router as RouterT } from 'express';
import { z } from 'zod';
import { AGENCY_MODULE, AppError } from '@tripbng/shared';
import { ok } from '../utils/response.js';
import { validate } from '../utils/validate.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import {
  setCreditConfig,
  switchAgencyModule,
  upsertDiConfig,
  type AdminContext,
} from '../services/wallet/agency-config.service.js';
import {
  approveTransfer,
  recallTransfer,
  rejectTransfer,
} from '../services/wallet/distributor-transfer.service.js';
import { DistributorTransfer } from '../models/DistributorTransfer.js';

export const adminAgencyRouter: RouterT = Router();

// Every route below this line is admin-gated. The `requireSuperAdmin` check
// itself lives inside each service for defence-in-depth.
adminAgencyRouter.use(authenticate, requireAuth);

function ctx(req: Parameters<typeof authenticate>[0]): AdminContext {
  return {
    tenantId: req.auth!.tenantId,
    userId: req.auth!.userId,
    role: req.auth!.role,
    ipAddress: req.ip ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /admin/agencies/:id/module — switch billing/pricing module
// ─────────────────────────────────────────────────────────────────────────────

const SwitchModuleBodySchema = z.object({
  module: z.enum(AGENCY_MODULE),
  force: z.boolean().optional(),
  notes: z.string().max(500).optional().nullable(),
});

adminAgencyRouter.patch(
  '/agencies/:id/module',
  validate(SwitchModuleBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof SwitchModuleBodySchema.parse>;
      const result = await switchAgencyModule(ctx(req), {
        agencyId: req.params.id!,
        newModule: body.module,
        force: body.force ?? false,
        notes: body.notes ?? null,
      });
      return ok(res, {
        agencyId: String(result.agency._id),
        previousModule: result.previousModule,
        currentModule: result.agency.module,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /admin/agencies/:id/credit-config — set credit-line fields
// ─────────────────────────────────────────────────────────────────────────────

const CreditConfigBodySchema = z.object({
  creditLimitPaise: z.number().int().nonnegative().optional(),
  creditExpiryDate: z.string().datetime().optional().nullable(),
  creditDueDate: z.string().datetime().optional().nullable(),
  blockOnDueDateCross: z.boolean().optional(),
});

adminAgencyRouter.patch(
  '/agencies/:id/credit-config',
  validate(CreditConfigBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof CreditConfigBodySchema.parse>;
      const agency = await setCreditConfig(ctx(req), {
        agencyId: req.params.id!,
        ...body,
      });
      return ok(res, {
        agencyId: String(agency._id),
        creditLimit: agency.creditLimit,
        creditExpiryDate: agency.creditExpiryDate,
        creditDueDate: agency.creditDueDate,
        blockOnDueDateCross: agency.blockOnDueDateCross,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /admin/agencies/:id/di-config — upsert DI module config
// ─────────────────────────────────────────────────────────────────────────────

const DiConfigBodySchema = z.object({
  isActive: z.boolean().optional(),
  incentiveMode: z.enum(['PERCENT', 'ABSOLUTE']).optional(),
  incentiveBasisPoints: z.number().int().min(0).max(1_000_000).optional().nullable(),
  incentiveAbsolutePaise: z.number().int().min(0).optional().nullable(),
  minDepositForIncentivePaise: z.number().int().min(0).optional().nullable(),
  maxIncentivePerTxnPaise: z.number().int().min(0).optional().nullable(),
  tdsApplicable: z.boolean().optional(),
  tdsBasisPoints: z.number().int().min(0).max(10_000).optional(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional().nullable(),
});

adminAgencyRouter.put(
  '/agencies/:id/di-config',
  validate(DiConfigBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof DiConfigBodySchema.parse>;
      const config = await upsertDiConfig(ctx(req), {
        agencyId: req.params.id!,
        ...body,
      });
      return ok(res, {
        id: String(config._id),
        agencyId: config.agencyId ? String(config.agencyId) : null,
        isActive: config.isActive,
        incentiveMode: config.incentiveMode,
        incentiveBasisPoints: config.incentiveBasisPoints,
        tdsBasisPoints: config.tdsBasisPoints,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/transfers — pending-approval queue (filterable by status)
// ─────────────────────────────────────────────────────────────────────────────

const ListTransfersQuerySchema = z.object({
  status: z
    .enum(['PENDING_APPROVAL', 'COMPLETED', 'REJECTED', 'REVERSED', 'FAILED'])
    .optional(),
  distributorId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

adminAgencyRouter.get(
  '/transfers',
  validate(ListTransfersQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      if (req.auth!.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN');
      const query = req.query as unknown as ReturnType<typeof ListTransfersQuerySchema.parse>;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (query.status) filter.status = query.status;
      if (query.distributorId) filter.distributorId = query.distributorId;
      const rows = await DistributorTransfer.find(filter)
        .sort({ createdAt: -1 })
        .limit(query.limit)
        .lean();
      return ok(res, {
        items: rows.map((r) => ({
          id: String(r._id),
          transferRef: r.transferRef,
          distributorId: String(r.distributorId),
          agencyId: String(r.agencyId),
          amountPaise: r.amount,
          type: r.type,
          status: r.status,
          approvalRequired: r.approvalRequired,
          createdAt: r.createdAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/transfers/:id/approve — approve a pending transfer
// ─────────────────────────────────────────────────────────────────────────────

adminAgencyRouter.post('/transfers/:id/approve', async (req, res, next) => {
  try {
    const transfer = await approveTransfer(
      {
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
        role: req.auth!.role,
        ipAddress: req.ip ?? null,
      },
      req.params.id!,
    );
    return ok(res, {
      id: String(transfer._id),
      transferRef: transfer.transferRef,
      status: transfer.status,
      outLedgerId: transfer.outLedgerId ? String(transfer.outLedgerId) : null,
      inLedgerId: transfer.inLedgerId ? String(transfer.inLedgerId) : null,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/transfers/:id/reject — reject a pending transfer
// ─────────────────────────────────────────────────────────────────────────────

const RejectTransferBodySchema = z.object({
  reason: z.string().min(3).max(500),
});

const RecallTransferBodySchema = z.object({
  notes: z.string().max(500).optional().nullable(),
});

adminAgencyRouter.post(
  '/transfers/:id/reject',
  validate(RejectTransferBodySchema),
  async (req, res, next) => {
    try {
      const { reason } = req.body as ReturnType<typeof RejectTransferBodySchema.parse>;
      const transfer = await rejectTransfer(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          ipAddress: req.ip ?? null,
        },
        req.params.id!,
        reason,
      );
      return ok(res, {
        id: String(transfer._id),
        transferRef: transfer.transferRef,
        status: transfer.status,
        rejectionReason: transfer.rejectionReason,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/transfers/:id/recall — reverse a COMPLETED transfer
// ─────────────────────────────────────────────────────────────────────────────

adminAgencyRouter.post(
  '/transfers/:id/recall',
  validate(RecallTransferBodySchema),
  async (req, res, next) => {
    try {
      const { notes } = req.body as ReturnType<typeof RecallTransferBodySchema.parse>;
      const recall = await recallTransfer(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          ipAddress: req.ip ?? null,
        },
        req.params.id!,
        notes ?? null,
      );
      return ok(res, {
        id: String(recall._id),
        transferRef: recall.transferRef,
        type: recall.type,
        status: recall.status,
        originalTransferId: recall.originalTransferId
          ? String(recall.originalTransferId)
          : null,
        outLedgerId: recall.outLedgerId ? String(recall.outLedgerId) : null,
        inLedgerId: recall.inLedgerId ? String(recall.inLedgerId) : null,
      });
    } catch (err) {
      next(err);
    }
  },
);
