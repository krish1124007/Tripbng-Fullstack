// Bus-specific reports.
//
// Mirrors the existing flight `reports.service.ts` pattern but
// aggregates BusBooking + BusCancellation collections instead of the
// flight Booking model.
//
// Four report types ship in Phase 9:
//   - SUMMARY      — booking + cancellation counts + spend by status
//   - BY_EMPLOYEE  — per-employee spend (top spenders, cancellation rate)
//   - BY_MONTH     — month-over-month trend
//   - BY_OPERATOR  — operator-level spend + bookings
//
// Each returns rows + columns suitable for the existing UI / CSV
// export plumbing. Spend in paise; CSV serialiser converts at the
// boundary for human-readable values.
//
// Scope: agency owners see only their own agency; SUPER_ADMIN sees the
// whole tenant. Distributor scoping isn't applied here (bus is not yet
// in the distributor cockpit) — easy to add via the same filter shape
// used by the flight report.

import { Types } from 'mongoose';
import { AppError } from '@tripbng/shared';
import { BusBooking } from '../../models/BusBooking.js';

// ────────── Shared types ──────────

export const BUS_REPORT_TYPES = [
  'SUMMARY',
  'BY_EMPLOYEE',
  'BY_MONTH',
  'BY_OPERATOR',
] as const;
export type BusReportType = (typeof BUS_REPORT_TYPES)[number];

export interface BusReportQuery {
  type: BusReportType;
  from?: Date;
  to?: Date;
  /** Override agency filter — only honoured for SUPER_ADMIN. */
  agencyId?: string;
  /** Optional refinement: include only this status. */
  status?: string;
}

export interface BusReportColumn {
  key: string;
  label: string;
  format: 'number' | 'paise' | 'percent' | 'date' | 'string';
}

export interface BusReportResponse {
  type: BusReportType;
  generatedAt: string;
  from: string | null;
  to: string | null;
  columns: BusReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  totals: Record<string, number> | null;
}

interface BusReportContext {
  tenantId: string;
  role: string;
  agencyId: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ────────── Public entry point ──────────

export async function runBusReport(
  ctx: BusReportContext,
  q: BusReportQuery,
): Promise<BusReportResponse> {
  switch (q.type) {
    case 'SUMMARY':
      return runSummary(ctx, q);
    case 'BY_EMPLOYEE':
      return runByEmployee(ctx, q);
    case 'BY_MONTH':
      return runByMonth(ctx, q);
    case 'BY_OPERATOR':
      return runByOperator(ctx, q);
  }
}

// ────────── Filter ──────────

function scopeFilter(ctx: BusReportContext, q: BusReportQuery): Record<string, unknown> {
  const f: Record<string, unknown> = { tenantId: new Types.ObjectId(ctx.tenantId) };

  // Agency scope is mandatory unless SUPER_ADMIN explicitly widens.
  if (ctx.role === 'AGENCY' || ctx.role === 'SUB_AGENT') {
    if (!ctx.agencyId) throw new AppError('FORBIDDEN');
    f.agencyId = new Types.ObjectId(ctx.agencyId);
  } else if (ctx.role === 'SUPER_ADMIN' && q.agencyId) {
    f.agencyId = new Types.ObjectId(q.agencyId);
  }
  // else (SUPER_ADMIN with no override) → tenant-wide.

  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = q.from;
    if (q.to) range.$lte = q.to;
    f.createdAt = range;
  } else {
    // 90-day default keeps unbounded queries fast.
    f.createdAt = { $gte: new Date(Date.now() - 90 * DAY_MS) };
  }

  if (q.status) f.status = q.status;
  return f;
}

// ────────── SUMMARY ──────────
//
// One row per status with bookings count + total spend. Useful for the
// dashboard tile "₹X spent across N bookings" + a stacked-status chart.

async function runSummary(
  ctx: BusReportContext,
  q: BusReportQuery,
): Promise<BusReportResponse> {
  const filter = scopeFilter(ctx, q);
  const rows = await BusBooking.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalPaise: { $sum: '$fareBreakup.totalPaise' },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const columns: BusReportColumn[] = [
    { key: 'status', label: 'Status', format: 'string' },
    { key: 'count', label: 'Bookings', format: 'number' },
    { key: 'totalPaise', label: 'Total spend', format: 'paise' },
  ];

  const totalsRow = rows.reduce(
    (acc, r) => {
      acc.count += Number(r.count) || 0;
      acc.totalPaise += Number(r.totalPaise) || 0;
      return acc;
    },
    { count: 0, totalPaise: 0 },
  );

  return finalize(
    'SUMMARY',
    columns,
    rows.map((r) => ({
      status: String(r._id),
      count: Number(r.count) || 0,
      totalPaise: Number(r.totalPaise) || 0,
    })),
    q,
    totalsRow,
  );
}

// ────────── BY_EMPLOYEE ──────────

async function runByEmployee(
  ctx: BusReportContext,
  q: BusReportQuery,
): Promise<BusReportResponse> {
  const filter = scopeFilter(ctx, q);
  const rows = await BusBooking.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$employeeId',
        bookings: { $sum: 1 },
        // Total spend includes all status — analytics, not accounting.
        totalPaise: { $sum: '$fareBreakup.totalPaise' },
        cancelledCount: {
          $sum: {
            $cond: [
              {
                $in: ['$status', ['CANCELLED', 'PARTIALLY_CANCELLED', 'OPERATOR_CANCELLED']],
              },
              1,
              0,
            ],
          },
        },
        bookedCount: {
          $sum: { $cond: [{ $eq: ['$status', 'BOOKED'] }, 1, 0] },
        },
      },
    },
    {
      $lookup: {
        from: 'employees',
        localField: '_id',
        foreignField: '_id',
        as: 'employee',
      },
    },
    {
      $project: {
        _id: 1,
        employeeName: { $arrayElemAt: ['$employee.name', 0] },
        empCode: { $arrayElemAt: ['$employee.empCode', 0] },
        bookings: 1,
        totalPaise: 1,
        cancelledCount: 1,
        bookedCount: 1,
      },
    },
    { $sort: { totalPaise: -1 } },
    { $limit: 200 },
  ]);

  const columns: BusReportColumn[] = [
    { key: 'employeeName', label: 'Employee', format: 'string' },
    { key: 'empCode', label: 'Code', format: 'string' },
    { key: 'bookings', label: 'Bookings', format: 'number' },
    { key: 'bookedCount', label: 'Confirmed', format: 'number' },
    { key: 'cancelledCount', label: 'Cancelled', format: 'number' },
    { key: 'totalPaise', label: 'Total spend', format: 'paise' },
  ];

  const totals = rows.reduce(
    (acc, r) => {
      acc.bookings += Number(r.bookings) || 0;
      acc.totalPaise += Number(r.totalPaise) || 0;
      acc.cancelledCount += Number(r.cancelledCount) || 0;
      acc.bookedCount += Number(r.bookedCount) || 0;
      return acc;
    },
    { bookings: 0, totalPaise: 0, cancelledCount: 0, bookedCount: 0 },
  );

  return finalize(
    'BY_EMPLOYEE',
    columns,
    rows.map((r) => ({
      employeeName: r.employeeName ?? '—',
      empCode: r.empCode ?? '—',
      bookings: Number(r.bookings) || 0,
      bookedCount: Number(r.bookedCount) || 0,
      cancelledCount: Number(r.cancelledCount) || 0,
      totalPaise: Number(r.totalPaise) || 0,
    })),
    q,
    totals,
  );
}

// ────────── BY_MONTH ──────────

async function runByMonth(
  ctx: BusReportContext,
  q: BusReportQuery,
): Promise<BusReportResponse> {
  const filter = scopeFilter(ctx, q);
  const rows = await BusBooking.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
        bookings: { $sum: 1 },
        totalPaise: { $sum: '$fareBreakup.totalPaise' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const columns: BusReportColumn[] = [
    { key: 'month', label: 'Month', format: 'string' },
    { key: 'bookings', label: 'Bookings', format: 'number' },
    { key: 'totalPaise', label: 'Total spend', format: 'paise' },
  ];

  const totals = rows.reduce(
    (acc, r) => {
      acc.bookings += Number(r.bookings) || 0;
      acc.totalPaise += Number(r.totalPaise) || 0;
      return acc;
    },
    { bookings: 0, totalPaise: 0 },
  );

  return finalize(
    'BY_MONTH',
    columns,
    rows.map((r) => ({
      month: String(r._id),
      bookings: Number(r.bookings) || 0,
      totalPaise: Number(r.totalPaise) || 0,
    })),
    q,
    totals,
  );
}

// ────────── BY_OPERATOR ──────────

async function runByOperator(
  ctx: BusReportContext,
  q: BusReportQuery,
): Promise<BusReportResponse> {
  const filter = scopeFilter(ctx, q);
  const rows = await BusBooking.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { $ifNull: ['$trip.operatorName', '—'] },
        bookings: { $sum: 1 },
        totalPaise: { $sum: '$fareBreakup.totalPaise' },
      },
    },
    { $sort: { totalPaise: -1 } },
    { $limit: 100 },
  ]);

  const columns: BusReportColumn[] = [
    { key: 'operator', label: 'Operator', format: 'string' },
    { key: 'bookings', label: 'Bookings', format: 'number' },
    { key: 'totalPaise', label: 'Total spend', format: 'paise' },
  ];

  const totals = rows.reduce(
    (acc, r) => {
      acc.bookings += Number(r.bookings) || 0;
      acc.totalPaise += Number(r.totalPaise) || 0;
      return acc;
    },
    { bookings: 0, totalPaise: 0 },
  );

  return finalize(
    'BY_OPERATOR',
    columns,
    rows.map((r) => ({
      operator: String(r._id),
      bookings: Number(r.bookings) || 0,
      totalPaise: Number(r.totalPaise) || 0,
    })),
    q,
    totals,
  );
}

// ────────── Finalise ──────────

function finalize(
  type: BusReportType,
  columns: BusReportColumn[],
  rows: Array<Record<string, string | number | null>>,
  q: BusReportQuery,
  totals: Record<string, number> | null,
): BusReportResponse {
  return {
    type,
    generatedAt: new Date().toISOString(),
    from: q.from?.toISOString() ?? null,
    to: q.to?.toISOString() ?? null,
    columns,
    rows,
    totals,
  };
}

// ────────── CSV serialiser ──────────
//
// Pure helper. Used by both the route layer and tests. Converts paise
// to rupees with 2dp at the cell boundary.

export function reportToCsv(report: BusReportResponse): string {
  const headers = report.columns.map((c) => csvCell(c.label));
  const lines = [headers.join(',')];

  for (const row of report.rows) {
    const cells = report.columns.map((col) => {
      const v = row[col.key];
      if (v === null || v === undefined) return '';
      if (col.format === 'paise' && typeof v === 'number') {
        return (v / 100).toFixed(2);
      }
      return csvCell(String(v));
    });
    lines.push(cells.join(','));
  }

  if (report.totals) {
    const cells = report.columns.map((col) => {
      const v = report.totals![col.key];
      if (v === undefined) return col.key === report.columns[0]!.key ? 'TOTAL' : '';
      if (col.format === 'paise') return (v / 100).toFixed(2);
      return String(v);
    });
    lines.push(cells.join(','));
  }

  return lines.join('\n');
}

function csvCell(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
