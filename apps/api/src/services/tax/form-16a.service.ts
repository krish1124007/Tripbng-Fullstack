// Form 16A — TDS certificate generator per (agency × quarter).
//
// Form 16A is the IT Department's quarterly TDS certificate issued to the
// deductee (each agency we pay incentives to). It mirrors Form 26Q's
// Annexure I but is per-deductee and is sent to the agency for their tax
// filing.
//
// Three concerns this file owns:
//   1. Pull the per-agency TDS_DEDUCT entries + paired INCENTIVE_CREDIT
//      for amount-paid (mirrors form-26q.service.ts but scoped to one agency)
//   2. Compose the certificate's structured data shape
//   3. Render the PDF (pdfkit) — keeps the layout co-located with the
//      data shape so a field rename doesn't drift between the two
//
// Fields the accountant still has to fill in by hand (BSR code, challan
// serial number, date of deposit) appear with a "TO BE FILLED" marker —
// we surface them visibly so the certificate can't accidentally ship
// half-completed.

import { Types } from 'mongoose';
import type { Readable } from 'node:stream';
import PDFDocument from 'pdfkit';
import { Agency } from '../../models/Agency.js';
import { WalletTransaction } from '../../models/WalletTransaction.js';
import { env } from '../../config/env.js';
import { resolveQuarterRange, type Form26QQuarter } from './form-26q.service.js';
import { fmtRupees, fmtDateShort, C, PAGE } from '../pdf-theme.js';
import { AppError, type DeducteeCategory } from '@tripbng/shared';

export interface Form16AOptions {
  tenantId: string;
  agencyId: string;
  financialYear: string;
  quarter: Form26QQuarter;
}

export interface Form16ALineItem {
  /** ISO date — when the gross amount was credited and TDS withheld
   *  (same instant in our flow). */
  date: string;
  /** Section under which deducted (always 194H for our DI commission). */
  section: '194H';
  /** Gross amount paid/credited, in paise. */
  amountPaidPaise: number;
  /** TDS withheld, in paise. */
  tdsPaise: number;
  /** Surcharge — 0 for s.194H. */
  surchargePaise: number;
  /** Health & Education cess — 0 for s.194H. */
  hecPaise: number;
  /** Total tax = TDS + surcharge + HEC. */
  totalTaxPaise: number;
  /** Ledger txnId so the agency can cross-reference if they audit us. */
  ledgerRef: string;
}

export interface Form16ACertificate {
  /** Issued certificate number — synthetic. TripBng-internal pattern; the
   *  real Form 16A certificate number on filing is assigned by NSDL after
   *  Form 26Q is accepted. We mint a stable internal id so the agency can
   *  match their copy to ours. */
  certificateNumber: string;
  financialYear: string;
  quarter: Form26QQuarter;
  /** ISO date — quarter inclusive start. */
  quarterFrom: string;
  /** ISO date — quarter exclusive end (the day after). */
  quarterTo: string;
  generatedAt: string;
  deductor: {
    name: string;
    tan: string;
    pan: string;
    address: string;
  };
  deductee: {
    agencyId: string;
    agencyCode: string;
    name: string;
    pan: string;
    address: string;
    category: DeducteeCategory | null;
  };
  lineItems: Form16ALineItem[];
  totals: {
    amountPaidPaise: number;
    tdsPaise: number;
    surchargePaise: number;
    hecPaise: number;
    totalTaxPaise: number;
  };
  /** Fields the accountant fills in once the quarterly Form 26Q is paid to
   *  the government. Present on the certificate as "TO BE FILLED" until then. */
  challan: {
    bsrCode: string | null;
    dateOfDeposit: string | null;
    challanSerialNumber: string | null;
  };
  /** Blocking issues that the accountant should resolve before issuing
   *  the certificate (missing PAN on agency, etc). The PDF still renders
   *  but visibly flags the gap. */
  warnings: string[];
}

/**
 * Build a Form 16A certificate data object for a single (agency, quarter).
 * Throws NOT_FOUND if the agency doesn't exist or has zero TDS in the period
 * — generating a certificate with zero deductions would mislead the agency
 * into filing it as "no income".
 */
export async function buildForm16A(opts: Form16AOptions): Promise<Form16ACertificate> {
  const { from, to } = resolveQuarterRange(opts.financialYear, opts.quarter);
  const tenantObjectId = new Types.ObjectId(opts.tenantId);
  const agencyObjectId = new Types.ObjectId(opts.agencyId);

  // Pull the deductee record up front — fail fast if it's missing.
  const agency = await Agency.findOne({ _id: agencyObjectId, tenantId: tenantObjectId })
    .select('+pan.number pan.name pan.deducteeCategory companyName agencyCode address city state pincode')
    .lean();
  if (!agency) {
    throw new AppError('NOT_FOUND', {
      reason: `agency ${opts.agencyId} not found in tenant ${opts.tenantId}`,
    });
  }

  // Pull the per-agency TDS_DEDUCT rows in the quarter window.
  const tdsRows = await WalletTransaction.find({
    tenantId: tenantObjectId,
    agencyId: agencyObjectId,
    type: 'TDS_DEDUCT',
    createdAt: { $gte: from, $lt: to },
  })
    .select('_id txnId amount relatedTxnId createdAt')
    .sort({ createdAt: 1 })
    .lean();

  if (tdsRows.length === 0) {
    throw new AppError('NOT_FOUND', {
      reason:
        'no TDS deductions for this agency in the selected quarter — nothing to certify',
    });
  }

  // Paired INCENTIVE_CREDIT lookup for the gross amount.
  const relatedIds = tdsRows.map((r) => r.relatedTxnId).filter(Boolean);
  const incentives = relatedIds.length
    ? await WalletTransaction.find({
        _id: { $in: relatedIds },
        type: 'INCENTIVE_CREDIT',
      })
        .select('_id amount')
        .lean()
    : [];
  const grossByIncentiveId = new Map(incentives.map((i) => [String(i._id), i.amount]));

  const lineItems: Form16ALineItem[] = [];
  let totalGross = 0;
  let totalTds = 0;
  for (const row of tdsRows) {
    const grossPaise =
      row.relatedTxnId ? grossByIncentiveId.get(String(row.relatedTxnId)) ?? 0 : 0;
    const tdsPaise = row.amount;
    const totalTaxPaise = tdsPaise; // surcharge + HEC = 0 for 194H
    lineItems.push({
      date: (row.createdAt as Date).toISOString().slice(0, 10),
      section: '194H',
      amountPaidPaise: grossPaise,
      tdsPaise,
      surchargePaise: 0,
      hecPaise: 0,
      totalTaxPaise,
      ledgerRef: row.txnId ?? String(row._id),
    });
    totalGross += grossPaise;
    totalTds += tdsPaise;
  }

  // Surface filing-blocking gaps but render the certificate anyway —
  // accountant decides whether to issue or send the agency to update.
  const warnings: string[] = [];
  const pan = (agency.pan?.number ?? '').trim().toUpperCase();
  const panName = (agency.pan?.name ?? '').trim();
  const category = agency.pan?.deducteeCategory as DeducteeCategory | null | undefined;
  if (!pan) warnings.push('Deductee PAN is missing — Form 16A is invalid without it.');
  if (!panName) warnings.push('Deductee PAN-holder name is missing.');
  if (!category) warnings.push('Deductee category not set — required for NSDL filing.');

  // Synthetic certificate number — deterministic so re-generates yield the
  // same id. Pattern: TBNG/16A/<FY-without-dash>/<Q>/<agencyCode>.
  const certificateNumber = `TBNG/16A/${opts.financialYear.replace('-', '')}/${
    opts.quarter
  }/${agency.agencyCode}`;

  return {
    certificateNumber,
    financialYear: opts.financialYear,
    quarter: opts.quarter,
    quarterFrom: from.toISOString().slice(0, 10),
    quarterTo: to.toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    deductor: {
      name: env.TRIPBNG_LEGAL_NAME,
      tan: env.TRIPBNG_TAN,
      pan: env.TRIPBNG_PAN || '— TRIPBNG_PAN unset —',
      address: env.TRIPBNG_ADDRESS,
    },
    deductee: {
      agencyId: opts.agencyId,
      agencyCode: agency.agencyCode,
      name: panName || agency.companyName,
      pan,
      address: composeAddress(agency),
      category: category ?? null,
    },
    lineItems,
    totals: {
      amountPaidPaise: totalGross,
      tdsPaise: totalTds,
      surchargePaise: 0,
      hecPaise: 0,
      totalTaxPaise: totalTds,
    },
    challan: {
      // These come from the actual TDS payment + Form 26Q acceptance —
      // we don't have either at certificate-generation time. They print as
      // "TO BE FILLED" so the accountant fills them in before issuing.
      bsrCode: null,
      dateOfDeposit: null,
      challanSerialNumber: null,
    },
    warnings,
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
  if (agency.pincode) parts.push(`PIN ${agency.pincode.trim()}`);
  return parts.join(', ');
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF renderer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a Form 16A certificate as a Readable PDF stream. The PDF is laid
 * out in five blocks: header → deductor → deductee → TDS table → signature.
 * We don't paginate the line-item table because real Form 16A certificates
 * never exceed ~30 entries per quarter per agency in our flow (one entry
 * per DI incentive payout).
 */
export function form16AToPdf(cert: Form16ACertificate): Readable {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const stream = doc as unknown as Readable;

  // ── Header ─────────────────────────────────────────────────────────────
  doc
    .fillColor(C.ink1)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text('FORM NO. 16A', { align: 'center' });
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(C.ink2)
    .text(
      '[See rule 31(1)(b) of the Income-tax Rules, 1962]',
      { align: 'center' },
    )
    .moveDown(0.3);
  doc
    .fontSize(10)
    .fillColor(C.ink1)
    .text(
      'Certificate under section 203 of the Income-tax Act, 1961 for tax deducted at source',
      { align: 'center' },
    )
    .moveDown(0.6);

  // Certificate number + period band (small kv strip).
  const kvY = doc.y;
  const kvCol = (x: number, label: string, value: string, w = 180) => {
    doc
      .fillColor(C.ink3)
      .font('Helvetica-Bold')
      .fontSize(7)
      .text(label.toUpperCase(), x, kvY, { width: w, characterSpacing: 1.4 });
    doc
      .fillColor(C.ink1)
      .font('Helvetica')
      .fontSize(9.5)
      .text(value, x, kvY + 10, { width: w });
  };
  kvCol(40, 'Certificate no.', cert.certificateNumber, 260);
  kvCol(310, 'Period', `${cert.quarterFrom}  →  ${cert.quarterTo} (${cert.quarter})`, 245);
  doc.y = kvY + 30;
  hairline(doc, doc.y);
  doc.moveDown(0.5);

  // ── Warnings (if any) ──────────────────────────────────────────────────
  if (cert.warnings.length > 0) {
    doc
      .fillColor(C.danger)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('Filing-blocking issues — resolve before issuing this certificate:', 40, doc.y);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.accentInk);
    for (const w of cert.warnings) {
      doc.text(`• ${w}`, 50);
    }
    doc.moveDown(0.5);
  }

  // ── Deductor block ─────────────────────────────────────────────────────
  drawPartyBlock(doc, 'Deductor (TripBng / payer)', {
    Name: cert.deductor.name,
    Address: cert.deductor.address,
    TAN: cert.deductor.tan,
    PAN: cert.deductor.pan,
  });
  doc.moveDown(0.4);

  // ── Deductee block ─────────────────────────────────────────────────────
  drawPartyBlock(doc, 'Deductee (agency / payee)', {
    Name: cert.deductee.name || '(name missing)',
    Address: cert.deductee.address || '(address missing)',
    PAN: cert.deductee.pan || '(PAN missing)',
    Category: cert.deductee.category ?? '(not set)',
    'Agency code': cert.deductee.agencyCode,
  });
  doc.moveDown(0.6);

  // ── TDS table ──────────────────────────────────────────────────────────
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(C.ink1)
    .text('Tax deducted at source — under section 194H (commission/brokerage)', 40);
  doc.moveDown(0.3);

  const colXs = [40, 110, 145, 235, 320, 405, 475];
  const headers = ['Date', 'Section', 'Amount paid', 'TDS', 'Surcharge', 'HEC', 'Total tax'];
  doc.fillColor(C.ink3).font('Helvetica-Bold').fontSize(7.5);
  const headerY = doc.y;
  headers.forEach((h, i) => {
    doc.text(h.toUpperCase(), colXs[i]!, headerY, {
      width: i === headers.length - 1 ? 80 : 90,
      characterSpacing: 1.2,
      lineBreak: false,
    });
  });
  doc.y = headerY + 12;
  hairline(doc, doc.y);
  doc.moveDown(0.2);

  doc.fillColor(C.ink1).font('Helvetica').fontSize(8.5);
  for (const item of cert.lineItems) {
    const y = doc.y;
    doc.text(item.date, colXs[0]!, y, { width: 70, lineBreak: false });
    doc.text(item.section, colXs[1]!, y, { width: 35, lineBreak: false });
    doc.text(fmtRupees(item.amountPaidPaise), colXs[2]!, y, { width: 90, lineBreak: false });
    doc.text(fmtRupees(item.tdsPaise), colXs[3]!, y, { width: 85, lineBreak: false });
    doc.text(fmtRupees(item.surchargePaise), colXs[4]!, y, { width: 85, lineBreak: false });
    doc.text(fmtRupees(item.hecPaise), colXs[5]!, y, { width: 70, lineBreak: false });
    doc.text(fmtRupees(item.totalTaxPaise), colXs[6]!, y, { width: 80, lineBreak: false });
    doc.moveDown(0.4);
    if (doc.y > 720) {
      doc.addPage();
    }
  }

  // Totals row
  hairline(doc, doc.y);
  doc.moveDown(0.2);
  const totalY = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink1);
  doc.text('TOTAL', colXs[0]!, totalY, { width: 105, lineBreak: false });
  doc.text(fmtRupees(cert.totals.amountPaidPaise), colXs[2]!, totalY, { width: 90, lineBreak: false });
  doc.text(fmtRupees(cert.totals.tdsPaise), colXs[3]!, totalY, { width: 85, lineBreak: false });
  doc.text(fmtRupees(cert.totals.surchargePaise), colXs[4]!, totalY, { width: 85, lineBreak: false });
  doc.text(fmtRupees(cert.totals.hecPaise), colXs[5]!, totalY, { width: 70, lineBreak: false });
  doc.text(fmtRupees(cert.totals.totalTaxPaise), colXs[6]!, totalY, { width: 80, lineBreak: false });
  doc.y = totalY + 16;
  doc.moveDown(0.6);

  // ── Challan details ────────────────────────────────────────────────────
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(C.ink1)
    .text('Challan details (tax deposited to Central Government)', 40);
  doc.moveDown(0.3);
  const TBD = '— TO BE FILLED BY ACCOUNTANT —';
  drawKvList(doc, [
    ['BSR code of bank branch', cert.challan.bsrCode ?? TBD],
    ['Date of deposit', cert.challan.dateOfDeposit ?? TBD],
    ['Challan serial number', cert.challan.challanSerialNumber ?? TBD],
  ]);
  doc.moveDown(0.6);

  // ── Signature block ────────────────────────────────────────────────────
  if (doc.y > 700) doc.addPage();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(C.ink2)
    .text(
      'Verification: I, the deductor named above, do hereby certify that the information given above is true, complete and correct, and is based on the books of account, documents, TDS statements, TDS deposited and other available records.',
      40,
      doc.y,
      { width: PAGE.CONTENT_W, align: 'justify' },
    )
    .moveDown(1.5);

  const sigY = doc.y;
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(C.ink3)
    .text('Place: ____________________', 40, sigY)
    .text(`Date: ${fmtDateShort(new Date(cert.generatedAt))}`, 40, sigY + 14);

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(C.ink2)
    .text('Signature of person responsible for deduction of tax', 320, sigY)
    .moveDown(0.2)
    .font('Helvetica-Bold')
    .fillColor(C.ink1)
    .text(env.TRIPBNG_DEDUCTOR_OFFICER_NAME, 320, sigY + 16)
    .font('Helvetica')
    .fillColor(C.ink3)
    .text(env.TRIPBNG_DEDUCTOR_OFFICER_DESIGNATION, 320, sigY + 30);

  doc.end();
  return stream;
}

// ── Local layout primitives ────────────────────────────────────────────────

function hairline(doc: PDFKit.PDFDocument, y: number): void {
  doc
    .moveTo(40, y)
    .lineTo(PAGE.W - 40, y)
    .lineWidth(0.5)
    .strokeColor(C.divider)
    .stroke();
}

function drawPartyBlock(
  doc: PDFKit.PDFDocument,
  title: string,
  fields: Record<string, string>,
): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(C.ink1)
    .text(title, 40, doc.y);
  doc.moveDown(0.25);
  const startY = doc.y;
  doc
    .strokeColor(C.border)
    .lineWidth(0.7)
    .rect(40, startY, PAGE.CONTENT_W, 4 + Object.keys(fields).length * 14)
    .stroke();
  doc.y = startY + 6;
  for (const [label, value] of Object.entries(fields)) {
    const rowY = doc.y;
    doc
      .fillColor(C.ink3)
      .font('Helvetica')
      .fontSize(8)
      .text(`${label}:`, 50, rowY, { width: 100, lineBreak: false });
    doc
      .fillColor(C.ink1)
      .font('Helvetica')
      .fontSize(8.5)
      .text(value, 155, rowY, { width: PAGE.CONTENT_W - 120, lineBreak: false });
    doc.y = rowY + 13;
  }
  doc.moveDown(0.3);
}

function drawKvList(
  doc: PDFKit.PDFDocument,
  rows: Array<[string, string]>,
): void {
  for (const [label, value] of rows) {
    const rowY = doc.y;
    doc
      .fillColor(C.ink3)
      .font('Helvetica')
      .fontSize(8.5)
      .text(`${label}:`, 50, rowY, { width: 200, lineBreak: false });
    doc
      .fillColor(C.ink1)
      .font('Helvetica')
      .fontSize(8.5)
      .text(value, 250, rowY, { width: PAGE.CONTENT_W - 220, lineBreak: false });
    doc.y = rowY + 13;
  }
}
