import { Types } from 'mongoose';
import ExcelJS from 'exceljs';
import {
  AppError,
  type ReportColumn,
  type ReportQuery,
  type ReportResponse,
} from '@tripbng/shared';
import { Booking } from '../models/Booking.js';
import { Agency } from '../models/Agency.js';
import { Amendment } from '../models/Amendment.js';
import { WalletTransaction } from '../models/WalletTransaction.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ROW_LIMIT = 1000; // cap for transactional (row-level) reports

interface ReportContext {
  tenantId: string;
  role: string;
  agencyId: string | null;
  distributorId: string | null;
}

const EARNING_STATUSES = ['TICKETED', 'CONFIRMED'];

// scopeFilter — every report respects the caller's role. Agencies see only their own data,
// distributors see their downline, super admin / accounts see everything (with optional
// explicit filters in the query).
function scopeFilter(
  ctx: ReportContext,
  q: ReportQuery,
  dateField = 'ticketedAt',
): Record<string, unknown> {
  const f: Record<string, unknown> = { tenantId: new Types.ObjectId(ctx.tenantId) };
  if (ctx.role === 'AGENCY' || ctx.role === 'SUB_AGENT') {
    if (!ctx.agencyId) throw new AppError('FORBIDDEN');
    f.agencyId = new Types.ObjectId(ctx.agencyId);
  } else if (ctx.role === 'DISTRIBUTOR') {
    if (!ctx.distributorId) throw new AppError('FORBIDDEN');
    f.distributorId = new Types.ObjectId(ctx.distributorId);
  } else {
    if (q.agencyId) f.agencyId = new Types.ObjectId(q.agencyId);
    if (q.distributorId) f.distributorId = new Types.ObjectId(q.distributorId);
  }
  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = q.from;
    if (q.to) range.$lte = q.to;
    f[dateField] = range;
  } else {
    // Default to last 30 days for unbounded queries — keeps aggregations bounded.
    f[dateField] = { $gte: new Date(Date.now() - 30 * DAY_MS) };
  }
  // Free-text agency search (code or company name) — admin/accounts only.
  if (q.agencyName && ctx.role !== 'AGENCY' && ctx.role !== 'SUB_AGENT') {
    const rx = new RegExp(q.agencyName, 'i');
    f.$or = [{ agencyCode: rx }, { agencyName: rx }];
  }
  if (q.bookingStatus) f.status = q.bookingStatus;
  if (q.supplierCode) f.supplierCode = q.supplierCode;
  if (q.airline) f['segments.airline.code'] = q.airline.toUpperCase();
  if (q.origin) f['segments.0.origin.code'] = q.origin.toUpperCase();
  if (q.destination) {
    f['segments.0.destination.code'] = q.destination.toUpperCase();
  }
  return f;
}

const passengerName = (b: {
  passengers?: { firstName?: string; lastName?: string }[];
}): string => {
  const list = b.passengers ?? [];
  if (list.length === 0) return '—';
  const first = `${list[0]?.firstName ?? ''} ${list[0]?.lastName ?? ''}`.trim();
  return list.length > 1 ? `${first} +${list.length - 1}` : first || '—';
};

const isoDate = (d: Date | null | undefined): string | null =>
  d ? new Date(d).toISOString().slice(0, 10) : null;

// ── Booking Report — one row per booking with the full money breakdown. ──
async function runBooking(ctx: ReportContext, q: ReportQuery): Promise<ReportResponse> {
  const filter = scopeFilter(ctx, q, 'createdAt');
  const docs = await Booking.find(filter).sort({ createdAt: -1 }).limit(ROW_LIMIT).lean();
  const columns: ReportColumn[] = [
    { key: 'bookingDate', label: 'Booking Date', format: 'date' },
    { key: 'travelDate', label: 'Travel Date', format: 'date' },
    { key: 'agencyName', label: 'Agency', format: 'string' },
    { key: 'pnr', label: 'PNR', format: 'string' },
    { key: 'ticketNo', label: 'Ticket No', format: 'string' },
    { key: 'passenger', label: 'Passenger', format: 'string' },
    { key: 'sector', label: 'Sector', format: 'string' },
    { key: 'airline', label: 'Airline', format: 'string' },
    { key: 'baseFarePaise', label: 'Base Fare', format: 'paise' },
    { key: 'taxesPaise', label: 'Taxes', format: 'paise' },
    { key: 'markupPaise', label: 'Markup', format: 'paise' },
    { key: 'commissionPaise', label: 'Commission', format: 'paise' },
    { key: 'totalPaise', label: 'Total', format: 'paise' },
    { key: 'status', label: 'Status', format: 'string' },
  ];
  const rows = docs.map((b) => {
    const p = b.pricing;
    return {
      bookingDate: isoDate(b.createdAt),
      travelDate: isoDate(b.travelDate),
      agencyName: `${b.agencyName} (${b.agencyCode})`,
      pnr: b.pnr || b.airlinePnr || '—',
      ticketNo: (b.ticketNumbers ?? []).join(', ') || '—',
      passenger: passengerName(b),
      sector: b.sector,
      airline: b.segments?.[0]?.airline?.code ?? '—',
      baseFarePaise: p?.baseFarePaise ?? 0,
      taxesPaise: p?.taxesPaise ?? 0,
      markupPaise:
        (p?.platformMarkupPaise ?? 0) +
        (p?.distributorMarkupPaise ?? 0) +
        (p?.agencyMarkupPaise ?? 0),
      commissionPaise: p?.platformEarningsPaise ?? 0,
      totalPaise: p?.agencyPayablePaise ?? 0,
      status: b.status,
    };
  });
  return finalize('BOOKING', columns, rows, q);
}

// ── Cancellation Report — cancelled / refunded bookings. ──
async function runCancellation(ctx: ReportContext, q: ReportQuery): Promise<ReportResponse> {
  const filter = scopeFilter(ctx, q, 'createdAt');
  // Unless the caller picked a specific status, scope to the cancellation lifecycle.
  if (!q.bookingStatus) {
    filter.status = { $in: ['CANCEL_REQUESTED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'] };
  }
  const docs = await Booking.find(filter).sort({ createdAt: -1 }).limit(ROW_LIMIT).lean();
  const columns: ReportColumn[] = [
    { key: 'bookingDate', label: 'Booking Date', format: 'date' },
    { key: 'travelDate', label: 'Travel Date', format: 'date' },
    { key: 'agencyName', label: 'Agency', format: 'string' },
    { key: 'pnr', label: 'PNR', format: 'string' },
    { key: 'sector', label: 'Sector', format: 'string' },
    { key: 'airline', label: 'Airline', format: 'string' },
    { key: 'totalPaise', label: 'Booking Total', format: 'paise' },
    { key: 'status', label: 'Status', format: 'string' },
  ];
  const rows = docs.map((b) => ({
    bookingDate: isoDate(b.createdAt),
    travelDate: isoDate(b.travelDate),
    agencyName: `${b.agencyName} (${b.agencyCode})`,
    pnr: b.pnr || b.airlinePnr || '—',
    sector: b.sector,
    airline: b.segments?.[0]?.airline?.code ?? '—',
    totalPaise: b.pricing?.agencyPayablePaise ?? 0,
    status: b.status,
  }));
  return finalize('CANCELLATION', columns, rows, q);
}

// ── Commission Earned Report — per ticketed booking, platform commission. ──
async function runCommission(ctx: ReportContext, q: ReportQuery): Promise<ReportResponse> {
  const filter = scopeFilter(ctx, q, 'ticketedAt');
  if (!q.bookingStatus) filter.status = { $in: EARNING_STATUSES };
  const docs = await Booking.find(filter).sort({ ticketedAt: -1 }).limit(ROW_LIMIT).lean();
  const columns: ReportColumn[] = [
    { key: 'ticketedDate', label: 'Ticketed Date', format: 'date' },
    { key: 'agencyName', label: 'Agency', format: 'string' },
    { key: 'pnr', label: 'PNR', format: 'string' },
    { key: 'sector', label: 'Sector', format: 'string' },
    { key: 'airline', label: 'Airline', format: 'string' },
    { key: 'baseFarePaise', label: 'Base Fare', format: 'paise' },
    { key: 'commissionPaise', label: 'Commission Earned', format: 'paise' },
    { key: 'gstPaise', label: 'GST', format: 'paise' },
  ];
  const rows = docs.map((b) => {
    const p = b.pricing;
    return {
      ticketedDate: isoDate(b.ticketedAt ?? b.createdAt),
      agencyName: `${b.agencyName} (${b.agencyCode})`,
      pnr: b.pnr || b.airlinePnr || '—',
      sector: b.sector,
      airline: b.segments?.[0]?.airline?.code ?? '—',
      baseFarePaise: p?.baseFarePaise ?? 0,
      commissionPaise: p?.platformEarningsPaise ?? 0,
      gstPaise: p?.gstPaise ?? 0,
    };
  });
  return finalize('COMMISSION', columns, rows, q);
}

// ── Agency Ledger Report — wallet debits/credits in createdAt order. ──
async function runLedger(ctx: ReportContext, q: ReportQuery): Promise<ReportResponse> {
  const filter: Record<string, unknown> = { tenantId: new Types.ObjectId(ctx.tenantId) };
  if (ctx.role === 'AGENCY' || ctx.role === 'SUB_AGENT') {
    if (!ctx.agencyId) throw new AppError('FORBIDDEN');
    filter.agencyId = new Types.ObjectId(ctx.agencyId);
  } else if (ctx.role === 'DISTRIBUTOR') {
    if (!ctx.distributorId) throw new AppError('FORBIDDEN');
    filter.distributorId = new Types.ObjectId(ctx.distributorId);
  } else if (q.agencyId) {
    filter.agencyId = new Types.ObjectId(q.agencyId);
  }
  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = q.from;
    if (q.to) range.$lte = q.to;
    filter.createdAt = range;
  } else {
    filter.createdAt = { $gte: new Date(Date.now() - 30 * DAY_MS) };
  }
  const txns = await WalletTransaction.find(filter).sort({ createdAt: -1 }).limit(ROW_LIMIT).lean();
  const columns: ReportColumn[] = [
    { key: 'date', label: 'Date', format: 'date' },
    { key: 'txnId', label: 'Txn ID', format: 'string' },
    { key: 'type', label: 'Type', format: 'string' },
    { key: 'direction', label: 'Dr/Cr', format: 'string' },
    { key: 'amountPaise', label: 'Amount', format: 'paise' },
    { key: 'balancePaise', label: 'Balance After', format: 'paise' },
    { key: 'description', label: 'Description', format: 'string' },
  ];
  const rows = txns.map((t) => ({
    date: isoDate(t.createdAt),
    txnId: t.txnId,
    type: t.type,
    direction: t.direction,
    amountPaise: t.amount ?? 0,
    balancePaise: t.balanceAfter ?? 0,
    description: t.description ?? '—',
  }));
  return finalize('LEDGER', columns, rows, q);
}

function effectiveRange(q: ReportQuery): { from: Date | null; to: Date | null } {
  return { from: q.from ?? null, to: q.to ?? null };
}

// Sales — by day with totals.
async function runSales(ctx: ReportContext, q: ReportQuery): Promise<ReportResponse> {
  const filter = scopeFilter(ctx, q);
  filter.status = { $in: EARNING_STATUSES };
  const rows = await Booking.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$ticketedAt' } },
        bookings: { $sum: 1 },
        gmvPaise: { $sum: '$pricing.grossAmountPaise' },
        netToSupplierPaise: { $sum: '$pricing.netToSupplierPaise' },
        platformEarningsPaise: { $sum: '$pricing.platformEarningsPaise' },
        distributorEarningsPaise: { $sum: '$pricing.distributorEarningsPaise' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const columns: ReportColumn[] = [
    { key: 'date', label: 'Date', format: 'date' },
    { key: 'bookings', label: 'Bookings', format: 'number' },
    { key: 'gmvPaise', label: 'GMV', format: 'paise' },
    { key: 'netToSupplierPaise', label: 'Net to supplier', format: 'paise' },
    { key: 'platformEarningsPaise', label: 'Platform earnings', format: 'paise' },
    { key: 'distributorEarningsPaise', label: 'Distributor earnings', format: 'paise' },
  ];
  return finalize(
    'SALES',
    columns,
    rows.map((r) => ({ date: r._id as string, ...r })),
    q,
  );
}

// Agency performance — bookings, GMV, refund rate, avg ticket size.
async function runAgencyPerformance(ctx: ReportContext, q: ReportQuery): Promise<ReportResponse> {
  const filter = scopeFilter(ctx, q);
  // Drop the booking-status filter so cancelled count works in the same aggregation.
  const rows = await Booking.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { agencyId: '$agencyId', agencyCode: '$agencyCode', agencyName: '$agencyName' },
        bookings: {
          $sum: { $cond: [{ $in: ['$status', EARNING_STATUSES] }, 1, 0] },
        },
        gmvPaise: {
          $sum: {
            $cond: [{ $in: ['$status', EARNING_STATUSES] }, '$pricing.grossAmountPaise', 0],
          },
        },
        cancelled: {
          $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] },
        },
      },
    },
    { $sort: { gmvPaise: -1 } },
  ]);
  const columns: ReportColumn[] = [
    { key: 'agencyCode', label: 'Code', format: 'string' },
    { key: 'agencyName', label: 'Agency', format: 'string' },
    { key: 'bookings', label: 'Bookings', format: 'number' },
    { key: 'gmvPaise', label: 'GMV', format: 'paise' },
    { key: 'avgTicketPaise', label: 'Avg ticket', format: 'paise' },
    { key: 'cancelled', label: 'Cancelled', format: 'number' },
    { key: 'refundRate', label: 'Refund rate', format: 'percent' },
  ];
  return finalize(
    'AGENCY_PERFORMANCE',
    columns,
    rows.map((r) => {
      const total = r.bookings + r.cancelled;
      return {
        agencyCode: r._id.agencyCode,
        agencyName: r._id.agencyName,
        bookings: r.bookings,
        gmvPaise: r.gmvPaise,
        avgTicketPaise: r.bookings > 0 ? Math.round(r.gmvPaise / r.bookings) : 0,
        cancelled: r.cancelled,
        refundRate: total > 0 ? Math.round((r.cancelled / total) * 10000) / 100 : 0,
      };
    }),
    q,
  );
}

// Supplier comparison — bookings, gmv, win rate against the total.
async function runSupplierComparison(ctx: ReportContext, q: ReportQuery): Promise<ReportResponse> {
  const filter = scopeFilter(ctx, q);
  filter.status = { $in: EARNING_STATUSES };
  const rows = await Booking.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$supplierCode',
        bookings: { $sum: 1 },
        gmvPaise: { $sum: '$pricing.grossAmountPaise' },
        avgFarePaise: { $avg: '$pricing.grossAmountPaise' },
      },
    },
    { $sort: { bookings: -1 } },
  ]);
  const total = rows.reduce((s, r) => s + r.bookings, 0) || 1;
  const columns: ReportColumn[] = [
    { key: 'supplierCode', label: 'Supplier', format: 'string' },
    { key: 'bookings', label: 'Bookings', format: 'number' },
    { key: 'winRate', label: 'Win rate', format: 'percent' },
    { key: 'gmvPaise', label: 'GMV', format: 'paise' },
    { key: 'avgFarePaise', label: 'Avg fare', format: 'paise' },
  ];
  return finalize(
    'SUPPLIER_COMPARISON',
    columns,
    rows.map((r) => ({
      supplierCode: r._id as string,
      bookings: r.bookings,
      gmvPaise: r.gmvPaise,
      avgFarePaise: Math.round(r.avgFarePaise as number),
      winRate: Math.round((r.bookings / total) * 10000) / 100,
    })),
    q,
  );
}

// Route profitability — by sector, margin %, refund cost.
async function runRouteProfitability(ctx: ReportContext, q: ReportQuery): Promise<ReportResponse> {
  const filter = scopeFilter(ctx, q);
  const rows = await Booking.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$sector',
        bookings: {
          $sum: { $cond: [{ $in: ['$status', EARNING_STATUSES] }, 1, 0] },
        },
        gmvPaise: {
          $sum: {
            $cond: [{ $in: ['$status', EARNING_STATUSES] }, '$pricing.grossAmountPaise', 0],
          },
        },
        platformEarningsPaise: {
          $sum: {
            $cond: [{ $in: ['$status', EARNING_STATUSES] }, '$pricing.platformEarningsPaise', 0],
          },
        },
        refundCostPaise: {
          $sum: {
            $cond: [{ $eq: ['$status', 'CANCELLED'] }, '$pricing.agencyPayablePaise', 0],
          },
        },
      },
    },
    { $sort: { gmvPaise: -1 } },
  ]);
  const columns: ReportColumn[] = [
    { key: 'sector', label: 'Sector', format: 'string' },
    { key: 'bookings', label: 'Bookings', format: 'number' },
    { key: 'gmvPaise', label: 'GMV', format: 'paise' },
    { key: 'platformEarningsPaise', label: 'Platform earnings', format: 'paise' },
    { key: 'marginPercent', label: 'Margin %', format: 'percent' },
    { key: 'refundCostPaise', label: 'Refund cost', format: 'paise' },
  ];
  return finalize(
    'ROUTE_PROFITABILITY',
    columns,
    rows.map((r) => ({
      sector: r._id as string,
      bookings: r.bookings,
      gmvPaise: r.gmvPaise,
      platformEarningsPaise: r.platformEarningsPaise,
      marginPercent:
        r.gmvPaise > 0 ? Math.round((r.platformEarningsPaise / r.gmvPaise) * 10000) / 100 : 0,
      refundCostPaise: r.refundCostPaise,
    })),
    q,
  );
}

// Refund tracker — pending vs processed amendments.
async function runRefundTracker(ctx: ReportContext, q: ReportQuery): Promise<ReportResponse> {
  const filter: Record<string, unknown> = {
    tenantId: new Types.ObjectId(ctx.tenantId),
    type: { $in: ['CANCEL', 'REFUND', 'RESCHEDULE'] },
  };
  if (ctx.role === 'AGENCY' || ctx.role === 'SUB_AGENT')
    filter.agencyId = new Types.ObjectId(ctx.agencyId!);
  if (ctx.role === 'DISTRIBUTOR') filter.distributorId = new Types.ObjectId(ctx.distributorId!);
  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = q.from;
    if (q.to) range.$lte = q.to;
    filter.createdAt = range;
  }
  const rows = await Amendment.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalRefundPaise: { $sum: '$refundPaise' },
        totalFeePaise: { $sum: '$feePaise' },
        avgCycleHours: {
          $avg: {
            $cond: [
              { $ne: ['$settledAt', null] },
              {
                $divide: [{ $subtract: ['$settledAt', '$createdAt'] }, 60 * 60 * 1000],
              },
              null,
            ],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const columns: ReportColumn[] = [
    { key: 'status', label: 'Status', format: 'string' },
    { key: 'count', label: 'Count', format: 'number' },
    { key: 'totalRefundPaise', label: 'Total refund', format: 'paise' },
    { key: 'totalFeePaise', label: 'Total fees', format: 'paise' },
    { key: 'avgCycleHours', label: 'Avg cycle (h)', format: 'number' },
  ];
  return finalize(
    'REFUND_TRACKER',
    columns,
    rows.map((r) => ({
      status: r._id as string,
      count: r.count,
      totalRefundPaise: r.totalRefundPaise,
      totalFeePaise: r.totalFeePaise,
      avgCycleHours: Math.round((r.avgCycleHours ?? 0) * 100) / 100,
    })),
    q,
  );
}

// Outstanding — agencies with credit utilisation.
async function runOutstanding(ctx: ReportContext, q: ReportQuery): Promise<ReportResponse> {
  const filter: Record<string, unknown> = { tenantId: ctx.tenantId, status: 'ACTIVE' };
  if (ctx.role === 'DISTRIBUTOR') filter.distributorId = ctx.distributorId;
  const agencies = await Agency.find(filter)
    .select('agencyCode companyName creditLimit outstandingAmount walletBalance')
    .lean();
  // Resolve canonical balances from Wallet (Phase-15) so a 2-week-stale
  // Agency.walletBalance doesn't show up on the OUTSTANDING report.
  const balances = await readAgencyBalances(agencies.map((a) => a._id));
  const rows = agencies
    .filter((a) => (a.creditLimit ?? 0) > 0 || (a.outstandingAmount ?? 0) > 0)
    .map((a) => ({
      agencyCode: a.agencyCode,
      agencyName: a.companyName,
      walletBalancePaise: balances.get(String(a._id)) ?? a.walletBalance ?? 0,
      creditLimitPaise: a.creditLimit ?? 0,
      outstandingPaise: a.outstandingAmount ?? 0,
      utilisation:
        (a.creditLimit ?? 0) > 0
          ? Math.round(((a.outstandingAmount ?? 0) / (a.creditLimit ?? 1)) * 10000) / 100
          : 0,
    }));
  rows.sort((a, b) => b.utilisation - a.utilisation);
  const columns: ReportColumn[] = [
    { key: 'agencyCode', label: 'Code', format: 'string' },
    { key: 'agencyName', label: 'Agency', format: 'string' },
    { key: 'walletBalancePaise', label: 'Wallet', format: 'paise' },
    { key: 'creditLimitPaise', label: 'Credit limit', format: 'paise' },
    { key: 'outstandingPaise', label: 'Outstanding', format: 'paise' },
    { key: 'utilisation', label: 'Utilisation', format: 'percent' },
  ];
  return finalize('OUTSTANDING', columns, rows, q);
}

// GST — sum of GST collected over the period.
async function runGst(ctx: ReportContext, q: ReportQuery): Promise<ReportResponse> {
  const filter = scopeFilter(ctx, q);
  filter.status = { $in: EARNING_STATUSES };
  const rows = await Booking.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$ticketedAt' } },
        bookings: { $sum: 1 },
        gstCollectedPaise: { $sum: '$pricing.gstPaise' },
        platformEarningsPaise: { $sum: '$pricing.platformEarningsPaise' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const columns: ReportColumn[] = [
    { key: 'month', label: 'Month', format: 'string' },
    { key: 'bookings', label: 'Bookings', format: 'number' },
    { key: 'gstCollectedPaise', label: 'GST collected', format: 'paise' },
    { key: 'platformEarningsPaise', label: 'Platform earnings', format: 'paise' },
  ];
  return finalize(
    'GST',
    columns,
    rows.map((r) => ({
      month: r._id as string,
      bookings: r.bookings,
      gstCollectedPaise: r.gstCollectedPaise,
      platformEarningsPaise: r.platformEarningsPaise,
    })),
    q,
  );
}

function finalize(
  type: ReportResponse['type'],
  columns: ReportColumn[],
  rows: Record<string, string | number | null>[],
  q: ReportQuery,
): ReportResponse {
  const range = effectiveRange(q);
  const totals: Record<string, number> = {};
  for (const c of columns) {
    if (c.format === 'paise' || c.format === 'number') {
      totals[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    }
  }
  return {
    type,
    generatedAt: new Date().toISOString(),
    from: range.from?.toISOString() ?? null,
    to: range.to?.toISOString() ?? null,
    columns,
    rows,
    totals: Object.keys(totals).length > 0 ? totals : null,
  };
}

export async function runReport(ctx: ReportContext, q: ReportQuery): Promise<ReportResponse> {
  switch (q.type) {
    case 'BOOKING':
      return runBooking(ctx, q);
    case 'CANCELLATION':
      return runCancellation(ctx, q);
    case 'COMMISSION':
      return runCommission(ctx, q);
    case 'LEDGER':
      return runLedger(ctx, q);
    case 'SALES':
      return runSales(ctx, q);
    case 'AGENCY_PERFORMANCE':
      return runAgencyPerformance(ctx, q);
    case 'SUPPLIER_COMPARISON':
      return runSupplierComparison(ctx, q);
    case 'ROUTE_PROFITABILITY':
      return runRouteProfitability(ctx, q);
    case 'REFUND_TRACKER':
      return runRefundTracker(ctx, q);
    case 'OUTSTANDING':
      return runOutstanding(ctx, q);
    case 'GST':
      return runGst(ctx, q);
    default:
      throw new AppError('VALIDATION_ERROR', { reason: 'unknown report type' });
  }
}

// Excel export — single tidy sheet with header, totals row, and currency formatting on
// paise columns (divided by 100 because Excel users want rupees).
export async function reportToExcel(report: ReportResponse): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(report.type);

  ws.columns = report.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: 20,
  }));

  for (const row of report.rows) {
    const out: Record<string, string | number | null> = {};
    for (const c of report.columns) {
      const v = row[c.key];
      if (c.format === 'paise' && typeof v === 'number') out[c.key] = v / 100;
      else out[c.key] = v ?? null;
    }
    ws.addRow(out);
  }

  if (report.totals) {
    const totalsRow: Record<string, string | number | null> = {};
    let labelSet = false;
    for (const c of report.columns) {
      if (c.format === 'paise' && report.totals[c.key] != null) {
        totalsRow[c.key] = report.totals[c.key]! / 100;
      } else if (c.format === 'number' && report.totals[c.key] != null) {
        totalsRow[c.key] = report.totals[c.key]!;
      } else if (!labelSet) {
        totalsRow[c.key] = 'TOTAL';
        labelSet = true;
      } else {
        totalsRow[c.key] = '';
      }
    }
    const tr = ws.addRow(totalsRow);
    tr.font = { bold: true };
  }

  // Format paise columns as currency.
  for (let i = 0; i < report.columns.length; i++) {
    const col = report.columns[i]!;
    if (col.format === 'paise') {
      ws.getColumn(i + 1).numFmt = '₹#,##0.00';
    } else if (col.format === 'percent') {
      ws.getColumn(i + 1).numFmt = '0.00"%"';
    }
  }
  ws.getRow(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
