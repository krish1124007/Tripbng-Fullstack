// Form 26Q quarterly TDS-return preparation service.
//
// Form 26Q is the IT Department's quarterly TDS return for non-salary payments
// (s.194H commission/brokerage being the relevant slab for our DI incentives).
// The actual e-filing happens in the NSDL "Return Preparation Utility" (RPU)
// which consumes a fixed-width text file generated from validated rows. We
// don't generate that flat file directly — accountants prefer a reviewable
// CSV they can audit and hand into the RPU's import-from-Excel feature. This
// service produces both the structured JSON (admin UI consumption) and the
// RPU-aligned CSV (download).
//
// Scope:
//   • One row per (deductee × deduction event). NSDL allows aggregation, but
//     row-level granularity keeps the audit trail intact and matches the
//     ledger one-to-one — easier reconciliation when ROC questions a row.
//   • Section 194H only (commission to non-banking agents). Other sections
//     can be added later by widening the type filter and threading a
//     `sectionCode` argument through.
//   • Missing-PAN / missing-deducteeCategory deductees surface as warnings
//     in the JSON output AND appear in the CSV with an empty PAN cell so
//     the accountant sees exactly which rows need backfilling. We don't
//     drop them silently.
//
// Indian fiscal year:
//   FY 2025-26 quarters:
//     Q1 = 01-Apr-2025 → 30-Jun-2025
//     Q2 = 01-Jul-2025 → 30-Sep-2025
//     Q3 = 01-Oct-2025 → 31-Dec-2025
//     Q4 = 01-Jan-2026 → 31-Mar-2026
//
// Source of truth:
//   WalletTransaction with type='TDS_DEDUCT'. The DI-incentive worker pairs
//   each INCENTIVE_CREDIT with a TDS_DEDUCT (related via relatedTxnId), so
//   we can compute "amount paid/credited" (the gross incentive) by joining
//   to the matching INCENTIVE_CREDIT row.

import { Types } from 'mongoose';
import { Agency } from '../../models/Agency.js';
import { WalletTransaction } from '../../models/WalletTransaction.js';
import {
  DEDUCTEE_CATEGORY_TO_NSDL_CODE,
  type DeducteeCategory,
} from '@tripbng/shared';

export type Form26QQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

/** TDS section under which the deduction was made. We currently only emit
 *  194H (commission/brokerage) — incentives paid to non-banking agents fall
 *  here per CBDT circular. */
export const TDS_SECTION_CODE = '194H' as const;
export type TdsSectionCode = typeof TDS_SECTION_CODE;

export interface Form26QOptions {
  tenantId: string;
  /** Financial year in `YYYY-YY` format (e.g. `2025-26`). */
  financialYear: string;
  /** Quarter — Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar. */
  quarter: Form26QQuarter;
}

/** One row in the Form 26Q Annexure I (deductee detail table). Field names
 *  mirror the NSDL RPU column headers so the CSV exporter is a direct
 *  pass-through of these keys. */
export interface Form26QRow {
  /** 1-based serial number — assigned at row-emission time, NOT stable. */
  srNo: number;
  /** NSDL deductee_code (1=Individual, 3=Company, …). Empty string when
   *  the agency has no `pan.deducteeCategory` configured. */
  deducteeCode: string;
  /** Human label corresponding to deducteeCode — for the JSON view + audit. */
  deducteeCategory: DeducteeCategory | null;
  /** Deductee PAN — uppercase, exactly 10 chars when present. Empty string
   *  when the agency has no PAN — these rows MUST be filed at the higher
   *  20% TDS rate per s.206AA. */
  panOfDeductee: string;
  /** Deductee legal name — as it appears on the PAN card. */
  nameOfDeductee: string;
  /** Postal address — for Form 16A. Composed from agency.address + city +
   *  state + pincode. */
  address: string;
  /** TDS section under which the deduction was made (currently always 194H). */
  sectionCode: TdsSectionCode;
  /** ISO date of the payment/credit (when the gross incentive landed). */
  dateOfPaymentOrCredit: string;
  /** Gross amount paid/credited in paise — pre-TDS incentive. */
  amountPaidOrCreditedPaise: number;
  /** TDS amount in paise. */
  tdsAmountPaise: number;
  /** Surcharge — 0 for s.194H. */
  surchargePaise: number;
  /** Health & Education cess — 0 for s.194H. */
  hecPaise: number;
  /** Total tax deducted = tds + surcharge + hec. */
  totalTaxDeductedPaise: number;
  /** ISO date of tax deduction — same as date of credit for our flow. */
  dateOfTaxDeduction: string;
  /** Reason for non-deduction / lower deduction (s.197 certificate). Empty
   *  for vanilla flows. */
  reasonForNonDeduction: string;
  /** Internal — links back to the WalletTransaction.txnId so accountants
   *  can chase a row to the ledger. Not part of the NSDL spec; the CSV
   *  exporter drops it but the JSON view includes it. */
  ledgerTxnId: string;
}

export interface Form26QWarning {
  /** Agency id missing some tax-filing data. */
  agencyId: string;
  /** Display label for ops. */
  agencyName: string;
  /** What's missing. */
  reasons: Array<'MISSING_PAN' | 'MISSING_DEDUCTEE_CATEGORY' | 'MISSING_PAN_NAME'>;
  /** How many ledger rows in this quarter are affected. */
  affectedRowCount: number;
}

export interface Form26QReport {
  tenantId: string;
  financialYear: string;
  quarter: Form26QQuarter;
  /** Inclusive ISO date of the quarter start. */
  quarterFrom: string;
  /** Exclusive ISO date — the day AFTER the quarter end. */
  quarterTo: string;
  generatedAt: string;
  /** Rows for the Annexure I deductee table. */
  rows: Form26QRow[];
  /** Sums across all rows — drives the CSV total line and the admin UI banner. */
  totals: {
    deducteeCount: number;
    rowCount: number;
    grossAmountPaise: number;
    tdsAmountPaise: number;
    surchargePaise: number;
    hecPaise: number;
    totalTaxDeductedPaise: number;
  };
  /** Filing-blocking issues — every warning here needs an admin fix before
   *  the return is FVU-valid. */
  warnings: Form26QWarning[];
}

/**
 * Resolve a (FY, Quarter) pair to the inclusive-from / exclusive-to UTC
 * date pair. We use UTC dates because the ledger rows store UTC; conversion
 * to IST happens at display time elsewhere. The fiscal year boundary still
 * works correctly because the IST/UTC offset is constant year-round (+5:30)
 * and the boundaries we care about are mid-day Apr 1 / Jul 1 / Oct 1 / Jan 1
 * — none of which a UTC-day calc can misalign for ledger entries made
 * during normal business hours IST.
 */
export function resolveQuarterRange(fy: string, quarter: Form26QQuarter): {
  from: Date;
  to: Date;
} {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) {
    throw new Error(`form-26q: invalid financialYear ${fy} (expected YYYY-YY)`);
  }
  const startYear = Number(m[1]);
  // The two-digit suffix must be the next year. e.g. 2025-26 → 26.
  const endYear = startYear + 1;
  const endYY = String(endYear).slice(-2);
  if (m[2] !== endYY) {
    throw new Error(`form-26q: financialYear ${fy} — suffix must be ${endYY}`);
  }

  switch (quarter) {
    case 'Q1':
      return {
        from: new Date(Date.UTC(startYear, 3, 1)), // Apr 1
        to: new Date(Date.UTC(startYear, 6, 1)), // Jul 1 (exclusive)
      };
    case 'Q2':
      return {
        from: new Date(Date.UTC(startYear, 6, 1)),
        to: new Date(Date.UTC(startYear, 9, 1)),
      };
    case 'Q3':
      return {
        from: new Date(Date.UTC(startYear, 9, 1)),
        to: new Date(Date.UTC(endYear, 0, 1)),
      };
    case 'Q4':
      return {
        from: new Date(Date.UTC(endYear, 0, 1)),
        to: new Date(Date.UTC(endYear, 3, 1)),
      };
  }
}

/**
 * Build the Form 26Q deductee-detail rows for the requested quarter.
 * Pure aggregation — no side effects, safe to call repeatedly.
 */
export async function runForm26QExport(opts: Form26QOptions): Promise<Form26QReport> {
  const { from, to } = resolveQuarterRange(opts.financialYear, opts.quarter);
  const tenantObjectId = new Types.ObjectId(opts.tenantId);

  // Pull every TDS_DEDUCT row in the window. We don't aggregate at the DB
  // layer because each row becomes a separate Form 26Q deductee-detail
  // entry (NSDL accepts both row-level and aggregated formats; row-level
  // makes audit-trace one-to-one with the ledger).
  const tdsRows = await WalletTransaction.find({
    tenantId: tenantObjectId,
    type: 'TDS_DEDUCT',
    createdAt: { $gte: from, $lt: to },
    agencyId: { $ne: null },
  })
    .select('_id txnId agencyId amount relatedTxnId createdAt')
    .lean();

  // Pull the matching INCENTIVE_CREDIT rows so we can populate
  // amountPaidOrCreditedPaise (the gross incentive on which the TDS was
  // computed). The pairing is via `relatedTxnId` set by the DI worker.
  const relatedIds = tdsRows.map((r) => r.relatedTxnId).filter(Boolean);
  const incentiveRows = relatedIds.length
    ? await WalletTransaction.find({
        _id: { $in: relatedIds },
        type: 'INCENTIVE_CREDIT',
      })
        .select('_id amount')
        .lean()
    : [];
  const incentiveById = new Map(incentiveRows.map((r) => [String(r._id), r.amount]));

  // Pull deductee identity for every agency touched. `select: false` on
  // pan.number means we need to explicitly select it back.
  const agencyIds = Array.from(new Set(tdsRows.map((r) => String(r.agencyId))));
  const agencies = await Agency.find({ _id: { $in: agencyIds } })
    .select('+pan.number pan.name pan.deducteeCategory companyName agencyCode address city state pincode')
    .lean();
  const agencyById = new Map(agencies.map((a) => [String(a._id), a]));

  // Per-agency warning aggregator — flagged once per agency, even when
  // multiple ledger rows hit the same gap.
  const warningsByAgency = new Map<string, Form26QWarning>();
  function flagAgency(
    agencyId: string,
    agencyName: string,
    reason: Form26QWarning['reasons'][number],
  ): void {
    let w = warningsByAgency.get(agencyId);
    if (!w) {
      w = { agencyId, agencyName, reasons: [], affectedRowCount: 0 };
      warningsByAgency.set(agencyId, w);
    }
    if (!w.reasons.includes(reason)) w.reasons.push(reason);
    w.affectedRowCount++;
  }

  const rows: Form26QRow[] = [];
  let srCursor = 1;
  for (const tds of tdsRows) {
    const agencyId = String(tds.agencyId);
    const agency = agencyById.get(agencyId);
    if (!agency) {
      // Deleted agency — shouldn't happen but be defensive. Skip the row;
      // a single dropped TDS row would distort the total but the
      // alternative (crashing the export) is worse.
      continue;
    }
    const grossPaise =
      tds.relatedTxnId ? incentiveById.get(String(tds.relatedTxnId)) ?? 0 : 0;
    const tdsPaise = tds.amount;
    const surchargePaise = 0;
    const hecPaise = 0;
    const totalPaise = tdsPaise + surchargePaise + hecPaise;

    const pan = (agency.pan?.number ?? '').trim().toUpperCase();
    const panName = (agency.pan?.name ?? '').trim();
    const category = agency.pan?.deducteeCategory as DeducteeCategory | null | undefined;
    const agencyName = agency.companyName ?? '(unnamed agency)';

    if (!pan) flagAgency(agencyId, agencyName, 'MISSING_PAN');
    if (!panName) flagAgency(agencyId, agencyName, 'MISSING_PAN_NAME');
    if (!category) flagAgency(agencyId, agencyName, 'MISSING_DEDUCTEE_CATEGORY');

    const address = composeAddress(agency);
    const isoDate = (tds.createdAt as Date).toISOString().slice(0, 10);

    rows.push({
      srNo: srCursor++,
      deducteeCode: category ? DEDUCTEE_CATEGORY_TO_NSDL_CODE[category] : '',
      deducteeCategory: category ?? null,
      panOfDeductee: pan,
      nameOfDeductee: panName || agencyName,
      address,
      sectionCode: TDS_SECTION_CODE,
      dateOfPaymentOrCredit: isoDate,
      amountPaidOrCreditedPaise: grossPaise,
      tdsAmountPaise: tdsPaise,
      surchargePaise,
      hecPaise,
      totalTaxDeductedPaise: totalPaise,
      dateOfTaxDeduction: isoDate,
      reasonForNonDeduction: '',
      ledgerTxnId: tds.txnId ?? String(tds._id),
    });
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.rowCount++;
      acc.grossAmountPaise += r.amountPaidOrCreditedPaise;
      acc.tdsAmountPaise += r.tdsAmountPaise;
      acc.surchargePaise += r.surchargePaise;
      acc.hecPaise += r.hecPaise;
      acc.totalTaxDeductedPaise += r.totalTaxDeductedPaise;
      return acc;
    },
    {
      deducteeCount: 0,
      rowCount: 0,
      grossAmountPaise: 0,
      tdsAmountPaise: 0,
      surchargePaise: 0,
      hecPaise: 0,
      totalTaxDeductedPaise: 0,
    },
  );
  totals.deducteeCount = new Set(rows.map((r) => r.panOfDeductee || r.nameOfDeductee))
    .size;

  return {
    tenantId: opts.tenantId,
    financialYear: opts.financialYear,
    quarter: opts.quarter,
    quarterFrom: from.toISOString().slice(0, 10),
    quarterTo: to.toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    rows,
    totals,
    warnings: Array.from(warningsByAgency.values()).sort(
      (a, b) => b.affectedRowCount - a.affectedRowCount,
    ),
  };
}

function composeAddress(agency: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}): string {
  const parts: string[] = [];
  if (agency.address) parts.push(agency.address.trim());
  if (agency.city) parts.push(agency.city.trim());
  if (agency.state) parts.push(agency.state.trim());
  if (agency.pincode) parts.push(agency.pincode.trim());
  return parts.join(', ');
}

/**
 * Render a Form 26Q report as a CSV suitable for the NSDL RPU's
 * "Import from Excel" feature. The column order matches RPU's Annexure I
 * tab; the accountant pastes this in and runs FVU validation locally.
 */
export function form26QToCsv(report: Form26QReport): string {
  const header = [
    'Sr. No.',
    'Deductee Code',
    'PAN of Deductee',
    'Name of Deductee',
    'Address of Deductee',
    'Section under which Deducted',
    'Date of Payment or Credit (yyyy-mm-dd)',
    'Amount Paid or Credited (Rs.)',
    'TDS Amount (Rs.)',
    'Surcharge (Rs.)',
    'Health & Education Cess (Rs.)',
    'Total Tax Deducted (Rs.)',
    'Date of Tax Deduction (yyyy-mm-dd)',
    'Reason for Non-deduction / Lower deduction',
  ];

  const lines = [header.map(csvField).join(',')];

  for (const r of report.rows) {
    lines.push(
      [
        String(r.srNo),
        r.deducteeCode,
        r.panOfDeductee,
        r.nameOfDeductee,
        r.address,
        r.sectionCode,
        r.dateOfPaymentOrCredit,
        paiseToRupees(r.amountPaidOrCreditedPaise),
        paiseToRupees(r.tdsAmountPaise),
        paiseToRupees(r.surchargePaise),
        paiseToRupees(r.hecPaise),
        paiseToRupees(r.totalTaxDeductedPaise),
        r.dateOfTaxDeduction,
        r.reasonForNonDeduction,
      ]
        .map(csvField)
        .join(','),
    );
  }

  // Totals line — accountant uses this for the manual cross-check before
  // FVU import. RPU itself recomputes from row sums so this is purely
  // diagnostic.
  lines.push(
    [
      'TOTAL',
      '',
      '',
      `${report.totals.deducteeCount} unique deductees`,
      '',
      '',
      '',
      paiseToRupees(report.totals.grossAmountPaise),
      paiseToRupees(report.totals.tdsAmountPaise),
      paiseToRupees(report.totals.surchargePaise),
      paiseToRupees(report.totals.hecPaise),
      paiseToRupees(report.totals.totalTaxDeductedPaise),
      '',
      '',
    ]
      .map(csvField)
      .join(','),
  );

  return lines.join('\r\n') + '\r\n';
}

/** Escape a CSV field per RFC 4180 — wrap in quotes if needed, double internal quotes. */
function csvField(v: string): string {
  if (v === '') return '';
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function paiseToRupees(paise: number): string {
  // Form 26Q expects rupees with two decimal places, no thousands separators.
  // The RPU rejects rows with currency symbols or commas.
  return (paise / 100).toFixed(2);
}
