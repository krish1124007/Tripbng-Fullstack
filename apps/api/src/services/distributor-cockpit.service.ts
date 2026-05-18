import {
  AppError,
  type DistributorDashboardSummary,
  type DormantAgency,
  type EarningsResponse,
  type EarningsRow,
} from '@tripbng/shared';
import { Booking } from '../models/Booking.js';
import { Agency } from '../models/Agency.js';
import { Distributor } from '../models/Distributor.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Booking statuses that count as "earnings-bearing" for the distributor — TICKETED money
// is real money owed; CONFIRMED is the same in series flows. Cancelled/refunded gets a
// negative impact via the cancelledCount column rather than reverting earnings.
const EARNING_STATUSES = ['TICKETED', 'CONFIRMED'];

interface CockpitContext {
  tenantId: string;
  distributorId: string;
}

export async function loadDashboardSummary(
  ctx: CockpitContext,
): Promise<DistributorDashboardSummary> {
  const distributor = await Distributor.findOne({
    _id: ctx.distributorId,
    tenantId: ctx.tenantId,
  }).lean();
  if (!distributor) throw new AppError('DISTRIBUTOR_NOT_FOUND');

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(startOfMonth.getTime() - 1);

  const [
    thisMonth,
    lastMonth,
    lifetime,
    agencies,
    activeAgenciesThisMonth,
    dormant,
    trendRaw,
    topAgenciesRaw,
  ] = await Promise.all([
    aggregatePeriod(ctx.tenantId, ctx.distributorId, startOfMonth, now),
    aggregatePeriod(ctx.tenantId, ctx.distributorId, startOfLastMonth, endOfLastMonth),
    aggregatePeriod(ctx.tenantId, ctx.distributorId, new Date(0), now),
    Agency.countDocuments({ tenantId: ctx.tenantId, distributorId: ctx.distributorId }),
    activeAgencyCount(ctx.tenantId, ctx.distributorId, startOfMonth, now),
    dormantAgencyIds(ctx.tenantId, ctx.distributorId, 30),
    dailyTrend(ctx.tenantId, ctx.distributorId, 30),
    topAgenciesByEarnings(ctx.tenantId, ctx.distributorId, startOfMonth, now, 5),
  ]);

  return {
    distributorId: String(distributor._id),
    distributorCode: distributor.distributorCode,
    distributorName: distributor.companyName,

    thisMonth: {
      ...thisMonth,
      activeAgencies: activeAgenciesThisMonth,
    },
    lastMonth,
    lifetime,

    agencies: {
      total: agencies,
      active: activeAgenciesThisMonth,
      dormant: dormant.length,
    },

    walletBalancePaise: distributor.walletBalance ?? 0,
    overrideCommissionPercent: distributor.overrideCommissionPercent ?? 0,

    trend: trendRaw,
    topAgencies: topAgenciesRaw,
  };
}

interface PeriodAggregate {
  earningsPaise: number;
  bookingCount: number;
  grossGmvPaise: number;
}

async function aggregatePeriod(
  tenantId: string,
  distributorId: string,
  from: Date,
  to: Date,
): Promise<PeriodAggregate> {
  const result = await Booking.aggregate<{
    earningsPaise: number;
    bookingCount: number;
    grossGmvPaise: number;
  }>([
    {
      $match: {
        tenantId: toObjectId(tenantId),
        distributorId: toObjectId(distributorId),
        status: { $in: EARNING_STATUSES },
        ticketedAt: { $gte: from, $lte: to },
      },
    },
    {
      $group: {
        _id: null,
        earningsPaise: { $sum: '$pricing.distributorEarningsPaise' },
        bookingCount: { $sum: 1 },
        grossGmvPaise: { $sum: '$pricing.grossAmountPaise' },
      },
    },
  ]);
  const r = result[0];
  return {
    earningsPaise: r?.earningsPaise ?? 0,
    bookingCount: r?.bookingCount ?? 0,
    grossGmvPaise: r?.grossGmvPaise ?? 0,
  };
}

async function activeAgencyCount(
  tenantId: string,
  distributorId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const ids = await Booking.distinct('agencyId', {
    tenantId: toObjectId(tenantId),
    distributorId: toObjectId(distributorId),
    status: { $in: EARNING_STATUSES },
    ticketedAt: { $gte: from, $lte: to },
  });
  return ids.length;
}

async function dormantAgencyIds(
  tenantId: string,
  distributorId: string,
  cutoffDays: number,
): Promise<string[]> {
  const cutoff = new Date(Date.now() - cutoffDays * DAY_MS);
  // Agencies under this distributor that haven't ticketed anything since cutoff.
  const allAgencies = await Agency.find({
    tenantId,
    distributorId,
    status: 'ACTIVE',
  })
    .select('_id')
    .lean();
  if (allAgencies.length === 0) return [];

  const recentBookers = await Booking.distinct('agencyId', {
    tenantId: toObjectId(tenantId),
    distributorId: toObjectId(distributorId),
    status: { $in: EARNING_STATUSES },
    ticketedAt: { $gte: cutoff },
  });
  const recent = new Set(recentBookers.map(String));

  return allAgencies.map((a) => String(a._id)).filter((id) => !recent.has(id));
}

async function dailyTrend(
  tenantId: string,
  distributorId: string,
  days: number,
): Promise<DistributorDashboardSummary['trend']> {
  const from = new Date(Date.now() - days * DAY_MS);
  const result = await Booking.aggregate<{
    _id: string;
    earningsPaise: number;
    bookingCount: number;
  }>([
    {
      $match: {
        tenantId: toObjectId(tenantId),
        distributorId: toObjectId(distributorId),
        status: { $in: EARNING_STATUSES },
        ticketedAt: { $gte: from },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$ticketedAt' } },
        earningsPaise: { $sum: '$pricing.distributorEarningsPaise' },
        bookingCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Backfill missing days with zeros so the chart line looks continuous.
  const map = new Map(result.map((r) => [r._id, r]));
  const trend: DistributorDashboardSummary['trend'] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key);
    trend.push({
      day: key,
      earningsPaise: row?.earningsPaise ?? 0,
      bookingCount: row?.bookingCount ?? 0,
    });
  }
  return trend;
}

async function topAgenciesByEarnings(
  tenantId: string,
  distributorId: string,
  from: Date,
  to: Date,
  limit: number,
): Promise<DistributorDashboardSummary['topAgencies']> {
  const result = await Booking.aggregate<{
    _id: { agencyId: unknown; agencyCode: string; agencyName: string };
    earningsPaise: number;
    bookingCount: number;
    grossGmvPaise: number;
  }>([
    {
      $match: {
        tenantId: toObjectId(tenantId),
        distributorId: toObjectId(distributorId),
        status: { $in: EARNING_STATUSES },
        ticketedAt: { $gte: from, $lte: to },
      },
    },
    {
      $group: {
        _id: {
          agencyId: '$agencyId',
          agencyCode: '$agencyCode',
          agencyName: '$agencyName',
        },
        earningsPaise: { $sum: '$pricing.distributorEarningsPaise' },
        bookingCount: { $sum: 1 },
        grossGmvPaise: { $sum: '$pricing.grossAmountPaise' },
      },
    },
    { $sort: { earningsPaise: -1 } },
    { $limit: limit },
  ]);

  return result.map((r) => ({
    agencyId: String(r._id.agencyId),
    agencyCode: r._id.agencyCode,
    companyName: r._id.agencyName,
    earningsPaise: r.earningsPaise,
    bookingCount: r.bookingCount,
    grossGmvPaise: r.grossGmvPaise,
  }));
}

export async function loadEarningsBreakdown(
  ctx: CockpitContext,
  query: { from?: Date; to?: Date; groupBy: 'day' | 'month' | 'agency' },
): Promise<EarningsResponse> {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(Date.now() - 30 * DAY_MS);

  const match = {
    tenantId: toObjectId(ctx.tenantId),
    distributorId: toObjectId(ctx.distributorId),
    ticketedAt: { $gte: from, $lte: to },
  };

  let rows: EarningsRow[] = [];
  let totals = {
    earningsPaise: 0,
    bookingCount: 0,
    grossGmvPaise: 0,
    cancelledCount: 0,
  };

  if (query.groupBy === 'day' || query.groupBy === 'month') {
    const fmt = query.groupBy === 'day' ? '%Y-%m-%d' : '%Y-%m';
    const result = await Booking.aggregate<{
      _id: string;
      earningsPaise: number;
      bookingCount: number;
      grossGmvPaise: number;
      cancelledCount: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: fmt, date: '$ticketedAt' } },
          earningsPaise: {
            $sum: {
              $cond: [
                { $in: ['$status', EARNING_STATUSES] },
                '$pricing.distributorEarningsPaise',
                0,
              ],
            },
          },
          bookingCount: {
            $sum: { $cond: [{ $in: ['$status', EARNING_STATUSES] }, 1, 0] },
          },
          grossGmvPaise: {
            $sum: {
              $cond: [{ $in: ['$status', EARNING_STATUSES] }, '$pricing.grossAmountPaise', 0],
            },
          },
          cancelledCount: {
            $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    rows = result.map((r) => ({
      key: r._id,
      label: r._id,
      earningsPaise: r.earningsPaise,
      bookingCount: r.bookingCount,
      grossGmvPaise: r.grossGmvPaise,
      cancelledCount: r.cancelledCount,
    }));
  } else {
    // groupBy=agency
    const result = await Booking.aggregate<{
      _id: { agencyId: unknown; agencyCode: string; agencyName: string };
      earningsPaise: number;
      bookingCount: number;
      grossGmvPaise: number;
      cancelledCount: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: {
            agencyId: '$agencyId',
            agencyCode: '$agencyCode',
            agencyName: '$agencyName',
          },
          earningsPaise: {
            $sum: {
              $cond: [
                { $in: ['$status', EARNING_STATUSES] },
                '$pricing.distributorEarningsPaise',
                0,
              ],
            },
          },
          bookingCount: {
            $sum: { $cond: [{ $in: ['$status', EARNING_STATUSES] }, 1, 0] },
          },
          grossGmvPaise: {
            $sum: {
              $cond: [{ $in: ['$status', EARNING_STATUSES] }, '$pricing.grossAmountPaise', 0],
            },
          },
          cancelledCount: {
            $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] },
          },
        },
      },
      { $sort: { earningsPaise: -1 } },
    ]);
    rows = result.map((r) => ({
      key: String(r._id.agencyId),
      label: `${r._id.agencyName} · ${r._id.agencyCode}`,
      earningsPaise: r.earningsPaise,
      bookingCount: r.bookingCount,
      grossGmvPaise: r.grossGmvPaise,
      cancelledCount: r.cancelledCount,
    }));
  }

  totals = rows.reduce(
    (acc, r) => ({
      earningsPaise: acc.earningsPaise + r.earningsPaise,
      bookingCount: acc.bookingCount + r.bookingCount,
      grossGmvPaise: acc.grossGmvPaise + r.grossGmvPaise,
      cancelledCount: acc.cancelledCount + r.cancelledCount,
    }),
    { earningsPaise: 0, bookingCount: 0, grossGmvPaise: 0, cancelledCount: 0 },
  );

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    groupBy: query.groupBy,
    rows,
    totals,
  };
}

export async function loadDormantAgencies(
  ctx: CockpitContext,
  cutoffDays: number,
): Promise<DormantAgency[]> {
  const cutoff = new Date(Date.now() - cutoffDays * DAY_MS);
  const agencies = await Agency.find({
    tenantId: ctx.tenantId,
    distributorId: ctx.distributorId,
    status: 'ACTIVE',
  })
    .select('_id agencyCode companyName city walletBalance status')
    .lean();
  if (agencies.length === 0) return [];

  // For every agency, find most recent TICKETED booking and lifetime count in two scans.
  const lastBookings = await Booking.aggregate<{
    _id: unknown;
    last: Date;
    total: number;
  }>([
    {
      $match: {
        tenantId: toObjectId(ctx.tenantId),
        distributorId: toObjectId(ctx.distributorId),
        status: { $in: EARNING_STATUSES },
      },
    },
    {
      $group: {
        _id: '$agencyId',
        last: { $max: '$ticketedAt' },
        total: { $sum: 1 },
      },
    },
  ]);
  const lastMap = new Map(lastBookings.map((r) => [String(r._id), r]));

  const dormant: DormantAgency[] = [];
  for (const a of agencies) {
    const stats = lastMap.get(String(a._id));
    const last = stats?.last ?? null;
    const isDormant = !last || last < cutoff;
    if (!isDormant) continue;
    dormant.push({
      agencyId: String(a._id),
      agencyCode: a.agencyCode,
      companyName: a.companyName,
      city: a.city,
      walletBalancePaise: a.walletBalance ?? 0,
      lastBookingAt: last ? last.toISOString() : null,
      daysSinceLastBooking: last ? Math.floor((Date.now() - last.getTime()) / DAY_MS) : null,
      totalLifetimeBookings: stats?.total ?? 0,
      status: a.status,
    });
  }
  // Most-stale first.
  dormant.sort((a, b) => {
    if (!a.lastBookingAt && b.lastBookingAt) return 1;
    if (a.lastBookingAt && !b.lastBookingAt) return -1;
    return new Date(a.lastBookingAt ?? 0).getTime() - new Date(b.lastBookingAt ?? 0).getTime();
  });
  return dormant;
}

import { Types } from 'mongoose';
function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}
