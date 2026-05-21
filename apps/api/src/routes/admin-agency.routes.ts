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
import { requireRole } from '../middleware/rbac.js';
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
import { PendingAdjustment } from '../models/PendingAdjustment.js';
import {
  approveAdjustment,
  cancelAdjustment,
  proposeAdjustment,
  rejectAdjustment,
} from '../services/wallet/adjust-approval.service.js';
import {
  runCreditExposureReport,
  runDiPayoutReport,
} from '../services/wallet/reports.service.js';
import {
  creditExposureToPdf,
  creditExposureToXlsx,
  diPayoutToPdf,
  diPayoutToXlsx,
} from '../services/wallet/report-exporters.js';

export const adminAgencyRouter: RouterT = Router();

// Every route below this line is admin-gated. Router-level `requireRole`
// is the first defence; the `requireSuperAdmin` check inside each service is
// the second layer (defence-in-depth). Before this guard the router relied
// solely on the service-layer check — a missed call there would silently
// expose admin operations to any authenticated user.
adminAgencyRouter.use(authenticate, requireAuth, requireRole('SUPER_ADMIN'));

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

// ── Manual wallet adjustments — two-person approval (spec §7) ──
const ProposeAdjustmentBodySchema = z
  .object({
    direction: z.enum(['CREDIT', 'DEBIT']),
    amountPaise: z.number().int().positive(),
    reason: z.string().min(3).max(1000),
    agencyId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional().nullable(),
    distributorId: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/)
      .optional()
      .nullable(),
  })
  .refine(
    (d) => Boolean(d.agencyId) !== Boolean(d.distributorId),
    { message: 'exactly one of agencyId or distributorId required' },
  );

const RejectAdjustmentBodySchema = z.object({
  reason: z.string().min(3).max(500),
});

const ListAdjustmentsQuerySchema = z.object({
  status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/adjustments — propose a manual wallet adjustment. Below
// threshold executes immediately; above stages for two-person approval.
// ─────────────────────────────────────────────────────────────────────────────

adminAgencyRouter.post(
  '/adjustments',
  validate(ProposeAdjustmentBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as ReturnType<typeof ProposeAdjustmentBodySchema.parse>;
      const result = await proposeAdjustment(
        {
          tenantId: req.auth!.tenantId,
          userId: req.auth!.userId,
          role: req.auth!.role,
          ipAddress: req.ip ?? null,
        },
        {
          direction: body.direction,
          amountPaise: body.amountPaise,
          reason: body.reason,
          ...(body.agencyId ? { agencyId: body.agencyId } : {}),
          ...(body.distributorId ? { distributorId: body.distributorId } : {}),
        },
      );
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/adjustments — list pending / approved / rejected adjustments
// ─────────────────────────────────────────────────────────────────────────────

adminAgencyRouter.get(
  '/adjustments',
  validate(ListAdjustmentsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      if (req.auth!.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN');
      const query = req.query as unknown as ReturnType<typeof ListAdjustmentsQuerySchema.parse>;
      const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      if (query.status) filter.status = query.status;
      const rows = await PendingAdjustment.find(filter)
        .sort({ createdAt: -1 })
        .limit(query.limit)
        .lean();
      return ok(res, {
        items: rows.map((r) => ({
          id: String(r._id),
          agencyId: r.agencyId ? String(r.agencyId) : null,
          distributorId: r.distributorId ? String(r.distributorId) : null,
          direction: r.direction,
          amountPaise: r.amountPaise,
          reason: r.reason,
          status: r.status,
          proposedBy: String(r.proposedBy),
          proposedAt: r.proposedAt,
          approvedBy: r.approvedBy ? String(r.approvedBy) : null,
          approvedAt: r.approvedAt,
          rejectionReason: r.rejectionReason,
          ledgerTxnId: r.ledgerTxnId ? String(r.ledgerTxnId) : null,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/adjustments/:id/approve — second admin approves + executes
// ─────────────────────────────────────────────────────────────────────────────

adminAgencyRouter.post('/adjustments/:id/approve', async (req, res, next) => {
  try {
    const pending = await approveAdjustment(
      {
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
        role: req.auth!.role,
        ipAddress: req.ip ?? null,
      },
      req.params.id!,
    );
    return ok(res, {
      id: String(pending._id),
      status: pending.status,
      ledgerTxnId: pending.ledgerTxnId ? String(pending.ledgerTxnId) : null,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/adjustments/:id/reject — second admin rejects
// ─────────────────────────────────────────────────────────────────────────────

adminAgencyRouter.post(
  '/adjustments/:id/reject',
  validate(RejectAdjustmentBodySchema),
  async (req, res, next) => {
    try {
      const { reason } = req.body as ReturnType<typeof RejectAdjustmentBodySchema.parse>;
      const pending = await rejectAdjustment(
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
        id: String(pending._id),
        status: pending.status,
        rejectionReason: pending.rejectionReason,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/adjustments/:id/cancel — proposer withdraws their own request
// ─────────────────────────────────────────────────────────────────────────────

adminAgencyRouter.post('/adjustments/:id/cancel', async (req, res, next) => {
  try {
    const pending = await cancelAdjustment(
      {
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
        role: req.auth!.role,
        ipAddress: req.ip ?? null,
      },
      req.params.id!,
    );
    return ok(res, {
      id: String(pending._id),
      status: pending.status,
    });
  } catch (err) {
    next(err);
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// Report exports
//
// All three formats — JSON / XLSX / PDF — go through the same endpoint, picked
// by `?format=`. Default is JSON so the admin UI's table view can hit the same
// URL it already does. The XLSX/PDF branches share a JSON pipeline (no extra
// query) so the data on screen is byte-for-byte the data in the download.
// ─────────────────────────────────────────────────────────────────────────────

const ReportFormat = z.enum(['json', 'xlsx', 'pdf']).default('json');

function attachDownloadHeaders(
  res: import('express').Response,
  format: 'xlsx' | 'pdf',
  filename: string,
): void {
  const mime =
    format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';
  res.setHeader('Content-Type', mime);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.${format}"`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/reports/credit-exposure — credit outstanding aging report
//   Optional query:
//     ?minOutstandingPaise=N    (default 1, i.e. exclude zeros)
//     ?format=json|xlsx|pdf     (default json)
// ─────────────────────────────────────────────────────────────────────────────

const CreditExposureQuerySchema = z.object({
  minOutstandingPaise: z.coerce.number().int().nonnegative().optional(),
  format: ReportFormat,
});

adminAgencyRouter.get(
  '/reports/credit-exposure',
  validate(CreditExposureQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      if (req.auth!.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN');
      const query = req.query as unknown as ReturnType<
        typeof CreditExposureQuerySchema.parse
      >;
      const report = await runCreditExposureReport({
        tenantId: req.auth!.tenantId,
        ...(query.minOutstandingPaise !== undefined
          ? { minOutstandingPaise: query.minOutstandingPaise }
          : {}),
      });
      if (query.format === 'xlsx') {
        const buf = await creditExposureToXlsx(report);
        attachDownloadHeaders(res, 'xlsx', 'credit-exposure');
        res.send(buf);
        return;
      }
      if (query.format === 'pdf') {
        attachDownloadHeaders(res, 'pdf', 'credit-exposure');
        creditExposureToPdf(report).pipe(res);
        return;
      }
      return ok(res, report);
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/reports/di-payouts?from=&to=
//   Period-wise DI incentive + TDS aggregation. Drives Form 26Q feed.
//     ?format=json|xlsx|pdf     (default json)
// ─────────────────────────────────────────────────────────────────────────────

const DiPayoutQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime().optional(),
    format: ReportFormat,
  })
  .refine((d) => !d.to || d.from < d.to, { message: 'from must be before to' });

adminAgencyRouter.get(
  '/reports/di-payouts',
  validate(DiPayoutQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      if (req.auth!.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN');
      const query = req.query as unknown as ReturnType<typeof DiPayoutQuerySchema.parse>;
      const report = await runDiPayoutReport({
        tenantId: req.auth!.tenantId,
        from: new Date(query.from),
        ...(query.to ? { to: new Date(query.to) } : {}),
      });
      if (query.format === 'xlsx') {
        const buf = await diPayoutToXlsx(report);
        attachDownloadHeaders(res, 'xlsx', 'di-payouts');
        res.send(buf);
        return;
      }
      if (query.format === 'pdf') {
        attachDownloadHeaders(res, 'pdf', 'di-payouts');
        diPayoutToPdf(report).pipe(res);
        return;
      }
      return ok(res, report);
    } catch (err) {
      next(err);
    }
  },
);
