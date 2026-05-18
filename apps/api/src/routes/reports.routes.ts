import { Router, type Router as RouterT } from 'express';
import { ReportQuerySchema } from '@tripbng/shared';
import { authenticate, requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { validate } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { reportToExcel, runReport } from '../services/reports.service.js';

export const reportRouter: RouterT = Router();

reportRouter.use(authenticate, requireAuth);

reportRouter.get(
  '/',
  requirePermission('report:run'),
  validate(ReportQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof ReportQuerySchema.parse>;
      const out = await runReport(
        {
          tenantId: req.auth!.tenantId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId,
          distributorId: req.auth!.distributorId,
        },
        q,
      );
      return ok(res, out);
    } catch (err) {
      next(err);
    }
  },
);

reportRouter.get(
  '/export',
  requirePermission('report:run'),
  validate(ReportQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as ReturnType<typeof ReportQuerySchema.parse>;
      const report = await runReport(
        {
          tenantId: req.auth!.tenantId,
          role: req.auth!.role,
          agencyId: req.auth!.agencyId,
          distributorId: req.auth!.distributorId,
        },
        q,
      );
      const buf = await reportToExcel(report);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${q.type.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      );
      res.send(buf);
    } catch (err) {
      next(err);
    }
  },
);
