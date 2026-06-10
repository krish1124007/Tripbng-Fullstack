// Wallet reports — admin-facing aggregations for credit exposure and DI
// payouts (spec §9).
//
// Aggregation shape is deliberately JSON-first. An XLSX/PDF exporter sits
// on top later (re-uses exceljs, already a dep of the booking ticket flow).
// Doing the JSON layer first means the admin UI can drive the same data
// from a table render OR an export button.
//
// Tenancy: callers are admin endpoints already gated by SUPER_ADMIN; we
// scope queries by the caller's tenantId.

import { Agency } from '../../models/Agency.js';
import { Wallet } from '../../models/Wallet.js';
import { WalletTransaction } from '../../models/WalletTransaction.js';

// ─────────────────────────────────────────────────────────────────────────────
// Credit exposure report (spec §9 — outstanding credit per agency, aged)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreditExposureRow {
  agencyId: string;
  agencyCode: string;
  companyName: string;
  creditLimitPaise: number;
  creditUsedPaise: number;
  creditAvailablePaise: number;
  utilisationPercent: number;
  /** Null when no due date is configured. */
  creditDueDate: Date | null;
  /** Signed days from now to due date — negative means overdue. Null when
   *  no due date. */
  daysToDue: number | null;
  /** Aging bucket label. "current" = not overdue or no due date. */
  agingBucket: '0-7' | '8-15' | '16-30' | '30+' | 'current';
  bookingBlocked: boolean;
  blockReason: string | null;
}

export interface CreditExposureReport {
  generatedAt: Date;
  totalAgencies: number;
  /** Sum across all CREDIT-module agencies' creditUsed in paise. */
  totalOutstandingPaise: number;
  /** Sum across all CREDIT-module agencies' creditLimit in paise. */
  totalLimitPaise: number;
  /** Breakdown by aging bucket. */
  byBucket: Record<CreditExposureRow['agingBucket'], { count: number; outstandingPaise: number }>;
  rows: CreditExposureRow[];
}

export interface CreditExposureOptions {
  tenantId: string;
  /** Restrict to agencies whose outstanding is at least this many paise.
   *  Default 1 — zero-outstanding rows are excluded by default. */
  minOutstandingPaise?: number;
  /** Override "now" for testing. */
  now?: Date;
}

export async function runCreditExposureReport(
  opts: CreditExposureOptions,
): Promise<CreditExposureReport> {
  const now = opts.now ?? new Date();
  // Normalize "now" to UTC midnight so daysToDue is a whole-day delta — a
  // due-date stored at 00:00 UTC compared against 15:08 UTC would otherwise
  // floor down to one extra day overdue.
  const nowMidnightMs = Math.floor(now.getTime() / 86_400_000) * 86_400_000;
  const minOutstanding = opts.minOutstandingPaise ?? 1;

  const agencies = await Agency.find({
    tenantId: opts.tenantId,
    module: 'CREDIT',
  })
    .select('_id agencyCode companyName creditLimit creditDueDate bookingBlocked blockReason')
    .lean();

  const wallets = await Wallet.find({
    agencyId: { $in: agencies.map((a) => a._id) },
  })
    .select('agencyId creditUsed')
    .lean();
  const walletByAgency = new Map(wallets.map((w) => [String(w.agencyId), w]));

  const rows: CreditExposureRow[] = [];
  let totalOutstanding = 0;
  let totalLimit = 0;
  const byBucket = makeEmptyBucketSummary();

  for (const agency of agencies) {
    const wallet = walletByAgency.get(String(agency._id));
    const creditUsed = wallet?.creditUsed ?? 0;
    const creditLimit = agency.creditLimit ?? 0;
    if (creditUsed < minOutstanding) continue;

    const dueDate = (agency.creditDueDate as Date | null) ?? null;
    const daysToDue = dueDate
      ? Math.floor((dueDate.getTime() - nowMidnightMs) / 86_400_000)
      : null;
    const bucket = bucketFor(daysToDue);
    const utilisationPercent = creditLimit > 0
      ? Math.round((creditUsed / creditLimit) * 1000) / 10 // 1 decimal place
      : 0;

    rows.push({
      agencyId: String(agency._id),
      agencyCode: agency.agencyCode,
      companyName: agency.companyName,
      creditLimitPaise: creditLimit,
      creditUsedPaise: creditUsed,
      creditAvailablePaise: Math.max(0, creditLimit - creditUsed),
      utilisationPercent,
      creditDueDate: dueDate,
      daysToDue,
      agingBucket: bucket,
      bookingBlocked: agency.bookingBlocked ?? false,
      blockReason: (agency.blockReason as string | null) ?? null,
    });
    totalOutstanding += creditUsed;
    totalLimit += creditLimit;
    byBucket[bucket].count++;
    byBucket[bucket].outstandingPaise += creditUsed;
  }

  // Sort: most overdue first (smallest daysToDue), null due dates last.
  rows.sort((a, b) => {
    if (a.daysToDue === null && b.daysToDue === null) return 0;
    if (a.daysToDue === null) return 1;
    if (b.daysToDue === null) return -1;
    return a.daysToDue - b.daysToDue;
  });

  return {
    generatedAt: now,
    totalAgencies: rows.length,
    totalOutstandingPaise: totalOutstanding,
    totalLimitPaise: totalLimit,
    byBucket,
    rows,
  };
}

function makeEmptyBucketSummary(): CreditExposureReport['byBucket'] {
  return {
    'current': { count: 0, outstandingPaise: 0 },
    '0-7': { count: 0, outstandingPaise: 0 },
    '8-15': { count: 0, outstandingPaise: 0 },
    '16-30': { count: 0, outstandingPaise: 0 },
    '30+': { count: 0, outstandingPaise: 0 },
  };
}

/**
 * Bucket assignment per spec §6.1.
 *   daysToDue >= 0 (not yet overdue) OR no due date set → 'current'
 *   1-7 days overdue → '0-7'
 *   8-15 days overdue → '8-15'
 *   16-30 days overdue → '16-30'
 *   >30 days overdue → '30+'
 */
function bucketFor(daysToDue: number | null): CreditExposureRow['agingBucket'] {
  if (daysToDue === null) return 'current';
  if (daysToDue >= 0) return 'current';
  const overdue = -daysToDue;
  if (overdue <= 7) return '0-7';
  if (overdue <= 15) return '8-15';
  if (overdue <= 30) return '16-30';
  return '30+';
}

// ─────────────────────────────────────────────────────────────────────────────
// DI payout summary (spec §9 — incentive paid + TDS collected, period-wise)
// ─────────────────────────────────────────────────────────────────────────────

export interface DiPayoutAgencyRow {
  agencyId: string;
  agencyCode: string;
  companyName: string;
  /** Number of incentive credits in the period. */
  incentiveCount: number;
  /** Sum of INCENTIVE_CREDIT amounts (gross, in paise). */
  grossIncentivePaise: number;
  /** Sum of TDS_DEDUCT amounts (in paise). */
  tdsPaise: number;
  /** Net wallet credit = gross - tds. */
  netCreditPaise: number;
}

export interface DiPayoutReport {
  generatedAt: Date;
  /** Inclusive start of the period, ISO datetime. */
  from: Date;
  /** Exclusive end of the period, ISO datetime. */
  to: Date;
  totalAgencies: number;
  /** Aggregate across the period — used for the Form 26Q feed. */
  totalGrossIncentivePaise: number;
  totalTdsPaise: number;
  totalNetCreditPaise: number;
  rows: DiPayoutAgencyRow[];
}

export interface DiPayoutOptions {
  tenantId: string;
  /** Inclusive period start. */
  from: Date;
  /** Exclusive period end. Defaults to now. */
  to?: Date;
}

export async function runDiPayoutReport(opts: DiPayoutOptions): Promise<DiPayoutReport> {
  const to = opts.to ?? new Date();
  // Aggregate the two ledger types per-agency in a single pipeline.
  const pipeline = [
    {
      $match: {
        tenantId: typeof opts.tenantId === 'string'
          ? new (await import('mongoose')).Types.ObjectId(opts.tenantId)
          : opts.tenantId,
        type: { $in: ['INCENTIVE_CREDIT', 'TDS_DEDUCT'] },
        createdAt: { $gte: opts.from, $lt: to },
        agencyId: { $ne: null },
      },
    },
    {
      $group: {
        _id: { agencyId: '$agencyId', type: '$type' },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ];
  const grouped = (await WalletTransaction.aggregate(pipeline)) as Array<{
    _id: { agencyId: unknown; type: 'INCENTIVE_CREDIT' | 'TDS_DEDUCT' };
    total: number;
    count: number;
  }>;

  // Pivot: agencyId → { incentive, tds }
  type Pivot = { incentive: number; incentiveCount: number; tds: number };
  const byAgency = new Map<string, Pivot>();
  for (const g of grouped) {
    const id = String(g._id.agencyId);
    if (!byAgency.has(id)) byAgency.set(id, { incentive: 0, incentiveCount: 0, tds: 0 });
    const slot = byAgency.get(id)!;
    if (g._id.type === 'INCENTIVE_CREDIT') {
      slot.incentive = g.total;
      slot.incentiveCount = g.count;
    } else {
      slot.tds = g.total;
    }
  }

  // Resolve agency display fields in one round-trip.
  const agencyIds = Array.from(byAgency.keys());
  const agencies = await Agency.find({ _id: { $in: agencyIds } })
    .select('_id agencyCode companyName')
    .lean();
  const displayById = new Map(
    agencies.map((a) => [String(a._id), { agencyCode: a.agencyCode, companyName: a.companyName }]),
  );

  let totalGross = 0;
  let totalTds = 0;
  const rows: DiPayoutAgencyRow[] = [];
  for (const [agencyId, pivot] of byAgency.entries()) {
    const display = displayById.get(agencyId) ?? { agencyCode: '—', companyName: '(missing)' };
    const net = pivot.incentive - pivot.tds;
    rows.push({
      agencyId,
      agencyCode: display.agencyCode,
      companyName: display.companyName,
      incentiveCount: pivot.incentiveCount,
      grossIncentivePaise: pivot.incentive,
      tdsPaise: pivot.tds,
      netCreditPaise: net,
    });
    totalGross += pivot.incentive;
    totalTds += pivot.tds;
  }
  // Sort: largest payout first.
  rows.sort((a, b) => b.grossIncentivePaise - a.grossIncentivePaise);

  return {
    generatedAt: new Date(),
    from: opts.from,
    to,
    totalAgencies: rows.length,
    totalGrossIncentivePaise: totalGross,
    totalTdsPaise: totalTds,
    totalNetCreditPaise: totalGross - totalTds,
    rows,
  };
}
