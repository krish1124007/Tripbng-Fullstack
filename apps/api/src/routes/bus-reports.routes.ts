// Bus reports + audit-log viewer routes.
//
// Mounted at /api/v1/bus/reports + /api/v1/bus/audit-log under
// busRouter. Auth + tenant scoping inherited from the parent.
//
// Two flavours of every report:
//   - JSON (default)
//   - CSV (?format=csv) — same data + Content-Disposition attachment

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import {
  AppError,
  BusAuditLogQuerySchema,
  BusReportQuerySchema,
  type BusAuditLogResponse,
  type PublicAuditLogEntry,
} from '@tripbng/shared';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { AuditLog } from '../models/AuditLog.js';
import {
  reportToCsv,
  runBusReport,
  type BusReportType,
} from '../services/bus/reports.service.js';

// ────────── Reports ──────────

export const busReportsRouter: RouterT = Router();

busReportsRouter.get(
  '/',
  requirePermission('bus-reports:read'),
  validate(BusReportQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof BusReportQuerySchema.parse>;
      const ctx = {
        tenantId: req.auth!.tenantId,
        role: req.auth!.role,
        agencyId: req.auth!.agencyId ?? null,
      };
      const report = await runBusReport(ctx, q);

      // CSV branch — same data, different envelope.
      if (typeof req.query.format === 'string' && req.query.format.toLowerCase() === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="bus-${q.type.toLowerCase()}-${todayStamp()}.csv"`,
        );
        res.send(reportToCsv(report));
        return;
      }

      return ok(res, report);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Audit-log viewer ──────────
//
// Tenant-scoped lookup. Agency owners see only their tenant's entries
// (further refined by service-layer filters in a future polish);
// SUPER_ADMIN sees the whole tenant. The `resource` filter pre-narrows
// to bus-related resources (busBooking / busInvoice / approval) so the
// dashboard doesn't accidentally surface unrelated tenant audit rows.

export const busAuditLogRouter: RouterT = Router();

const BUS_AUDIT_RESOURCES = new Set<string>([
  'busBooking',
  'busInvoice',
  'busCancellation',
  'approval',
]);

busAuditLogRouter.get(
  '/',
  requirePermission('bus-audit:read'),
  validate(BusAuditLogQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof BusAuditLogQuerySchema.parse>;
      const filter: Record<string, unknown> = {
        tenantId: new Types.ObjectId(req.auth!.tenantId),
      };

      // Resource scoping. When q.resource is supplied, validate it's
      // a known bus resource. When omitted, we restrict to the bus
      // resource set so the agency dashboard doesn't accidentally
      // surface flight/hotel/etc. audit rows.
      if (q.resource) {
        if (!BUS_AUDIT_RESOURCES.has(q.resource)) {
          throw new AppError('VALIDATION_ERROR', {
            reason: `unknown bus resource: ${q.resource}`,
          });
        }
        filter.resource = q.resource;
      } else {
        filter.resource = { $in: Array.from(BUS_AUDIT_RESOURCES) };
      }

      if (q.resourceId) filter.resourceId = q.resourceId;
      if (q.actionPrefix) {
        filter.action = { $regex: `^${escapeRegex(q.actionPrefix)}` };
      }
      if (q.actorId) filter.actorId = new Types.ObjectId(q.actorId);
      if (q.from || q.to) {
        const range: Record<string, Date> = {};
        if (q.from) range.$gte = q.from;
        if (q.to) range.$lte = q.to;
        filter.createdAt = range;
      }

      const skip = (q.page - 1) * q.limit;
      const [items, total] = await Promise.all([
        AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(q.limit).lean(),
        AuditLog.countDocuments(filter),
      ]);

      const response: BusAuditLogResponse = {
        items: items.map(toPublicEntry),
        total,
        page: q.page,
        limit: q.limit,
      };
      return ok(res, response);
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Helpers ──────────

function todayStamp(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toPublicEntry(d: Record<string, unknown>): PublicAuditLogEntry {
  return {
    id: String((d as { _id: unknown })._id),
    actorId: d.actorId ? String(d.actorId) : null,
    actorRole: typeof d.actorRole === 'string' ? d.actorRole : null,
    action: String(d.action),
    resource: String(d.resource),
    resourceId: d.resourceId ? String(d.resourceId) : null,
    before: d.before ?? null,
    after: d.after ?? null,
    ip: typeof d.ip === 'string' ? d.ip : null,
    success: typeof d.success === 'boolean' ? d.success : true,
    error: typeof d.error === 'string' ? d.error : null,
    createdAt: (d.createdAt instanceof Date ? d.createdAt : new Date(String(d.createdAt))).toISOString(),
  };
}

// Suppress unused-import warning when BusReportType isn't directly
// referenced — the JSON branch types itself via the runBusReport
// return value, but downstream callers may want the union.
export type { BusReportType };
