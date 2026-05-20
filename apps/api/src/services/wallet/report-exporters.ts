// Exporters for the wallet admin reports (credit-exposure aging, DI payout).
//
// Two formats:
//   • XLSX — for finance teams that want to pivot/sort/filter (ExcelJS).
//   • PDF  — for emailed snapshots and printable handouts (pdfkit).
//
// Design notes:
//   • Paise values are divided by 100 on the way out so spreadsheet users
//     get rupees with the cell formatted as currency. We never keep paise as
//     a fractional rupee in the source data — the divide-by-100 lives only
//     here, at the boundary.
//   • PDF uses pdfkit (already a dep) instead of headless Chromium — both
//     reports are tabular, so we don't need HTML rendering. Lower memory,
//     deterministic output, no browser to manage.
//   • Each exporter returns a Buffer (xlsx) or Readable (pdf) to mirror the
//     existing house style in services/reports.service.ts + wallet/statement.ts.

import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Readable } from 'node:stream';
import type {
  CreditExposureReport,
  CreditExposureRow,
  DiPayoutReport,
} from './reports.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return d.toISOString().slice(0, 10);
}

// Light fills for bucket cells in the XLSX — gradient from green (current)
// through amber to red (30+). Hex is ARGB-without-alpha per ExcelJS convention.
const BUCKET_FILL: Record<CreditExposureRow['agingBucket'], string> = {
  current: 'FFE8F5E9', // very light green
  '0-7': 'FFFFF8E1', // very light amber
  '8-15': 'FFFFE0B2', // light amber
  '16-30': 'FFFFCDD2', // light red
  '30+': 'FFEF9A9A', // medium red
};

// ─────────────────────────────────────────────────────────────────────────────
// Credit-exposure exporters
// ─────────────────────────────────────────────────────────────────────────────

export async function creditExposureToXlsx(report: CreditExposureReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TripBng';
  wb.created = report.generatedAt;

  // Sheet 1: per-agency rows
  const ws = wb.addWorksheet('Credit Exposure');
  ws.columns = [
    { header: 'Agency Code', key: 'agencyCode', width: 14 },
    { header: 'Company', key: 'companyName', width: 28 },
    { header: 'Credit Limit', key: 'creditLimit', width: 16 },
    { header: 'Outstanding', key: 'creditUsed', width: 16 },
    { header: 'Available', key: 'creditAvailable', width: 16 },
    { header: 'Utilisation %', key: 'utilisation', width: 14 },
    { header: 'Due Date', key: 'dueDate', width: 12 },
    { header: 'Days to Due', key: 'daysToDue', width: 12 },
    { header: 'Bucket', key: 'bucket', width: 10 },
    { header: 'Blocked', key: 'blocked', width: 10 },
    { header: 'Block Reason', key: 'blockReason', width: 24 },
  ];

  for (const row of report.rows) {
    const added = ws.addRow({
      agencyCode: row.agencyCode,
      companyName: row.companyName,
      creditLimit: row.creditLimitPaise / 100,
      creditUsed: row.creditUsedPaise / 100,
      creditAvailable: row.creditAvailablePaise / 100,
      utilisation: row.utilisationPercent,
      dueDate: row.creditDueDate ? formatDate(row.creditDueDate) : '',
      daysToDue: row.daysToDue ?? '',
      bucket: row.agingBucket,
      blocked: row.bookingBlocked ? 'YES' : 'no',
      blockReason: row.blockReason ?? '',
    });
    // Colour the bucket cell so the eye is drawn straight to overdues.
    const bucketCell = added.getCell('bucket');
    bucketCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: BUCKET_FILL[row.agingBucket] },
    };
    if (row.bookingBlocked) {
      added.getCell('blocked').font = { bold: true, color: { argb: 'FFB71C1C' } };
    }
  }

  // Totals row.
  const totalsRow = ws.addRow({
    agencyCode: 'TOTAL',
    companyName: `${report.totalAgencies} agencies`,
    creditLimit: report.totalLimitPaise / 100,
    creditUsed: report.totalOutstandingPaise / 100,
    creditAvailable: (report.totalLimitPaise - report.totalOutstandingPaise) / 100,
    utilisation:
      report.totalLimitPaise > 0
        ? Math.round((report.totalOutstandingPaise / report.totalLimitPaise) * 1000) / 10
        : 0,
    dueDate: '',
    daysToDue: '',
    bucket: '',
    blocked: '',
    blockReason: '',
  });
  totalsRow.font = { bold: true };
  totalsRow.eachCell((c) => {
    c.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6E3D9' },
    };
  });

  // Currency formatting on the money columns.
  for (const key of ['creditLimit', 'creditUsed', 'creditAvailable'] as const) {
    ws.getColumn(key).numFmt = '₹#,##0.00';
  }
  ws.getColumn('utilisation').numFmt = '0.0"%"';
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Sheet 2: bucket summary — handy for at-a-glance ageing.
  const sum = wb.addWorksheet('Aging Summary');
  sum.columns = [
    { header: 'Bucket', key: 'bucket', width: 14 },
    { header: 'Agency Count', key: 'count', width: 14 },
    { header: 'Outstanding', key: 'outstanding', width: 18 },
  ];
  const bucketOrder: CreditExposureRow['agingBucket'][] = [
    'current',
    '0-7',
    '8-15',
    '16-30',
    '30+',
  ];
  for (const b of bucketOrder) {
    const slot = report.byBucket[b];
    const r = sum.addRow({
      bucket: b,
      count: slot.count,
      outstanding: slot.outstandingPaise / 100,
    });
    r.getCell('bucket').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: BUCKET_FILL[b] },
    };
  }
  sum.getColumn('outstanding').numFmt = '₹#,##0.00';
  sum.getRow(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function creditExposureToPdf(report: CreditExposureReport): Readable {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const stream = doc as unknown as Readable;

  // Header
  doc.fontSize(18).fillColor('#0B1220').text('TripBng — Credit Exposure');
  doc
    .fontSize(9)
    .fillColor('#6B7488')
    .text(`Generated ${report.generatedAt.toISOString()}`)
    .moveDown(0.6);

  // Summary block — total exposure, blended utilisation.
  const totalUtil =
    report.totalLimitPaise > 0
      ? `${((report.totalOutstandingPaise / report.totalLimitPaise) * 100).toFixed(1)}%`
      : '—';
  const summaryY = doc.y;
  const col = (x: number, label: string, value: string) => {
    doc.fillColor('#6B7488').fontSize(8).text(label, x, summaryY);
    doc
      .fillColor('#0B1220')
      .fontSize(11)
      .text(value, x, summaryY + 12);
  };
  col(40, 'AGENCIES', String(report.totalAgencies));
  col(150, 'OUTSTANDING', formatINR(report.totalOutstandingPaise));
  col(310, 'LIMIT', formatINR(report.totalLimitPaise));
  col(450, 'UTILISATION', totalUtil);
  doc.y = summaryY + 32;
  doc.moveDown(0.6);

  // Bucket breakdown — one line each.
  doc.fillColor('#3A4256').fontSize(9).text('Aging breakdown:', 40, doc.y);
  doc.moveDown(0.3);
  const bucketOrder: CreditExposureRow['agingBucket'][] = [
    'current',
    '0-7',
    '8-15',
    '16-30',
    '30+',
  ];
  for (const b of bucketOrder) {
    const slot = report.byBucket[b];
    doc
      .fillColor('#0B1220')
      .fontSize(9)
      .text(
        `  • ${b.padEnd(8)} — ${String(slot.count).padStart(3)} agencies, ${formatINR(slot.outstandingPaise)}`,
        50,
      );
  }
  doc.moveDown(0.8);

  // Table header.
  const headers = ['Code', 'Company', 'Limit', 'Outstanding', 'Util%', 'Due', 'Days', 'Bucket'];
  const colXs = [40, 95, 230, 290, 360, 400, 450, 490];
  doc.fillColor('#3A4256').fontSize(8);
  headers.forEach((h, i) =>
    doc.text(h.toUpperCase(), colXs[i]!, doc.y, { lineBreak: false, width: 60 }),
  );
  doc.moveDown(0.6);
  doc
    .strokeColor('#E6E3D9')
    .lineWidth(0.5)
    .moveTo(40, doc.y)
    .lineTo(555, doc.y)
    .stroke()
    .moveDown(0.3);

  doc.fillColor('#0B1220').fontSize(8);
  if (report.rows.length === 0) {
    doc
      .fillColor('#6B7488')
      .text('No agencies with outstanding credit in this report.', 40)
      .moveDown(0.4);
  } else {
    for (const r of report.rows) {
      const y = doc.y;
      // Tint overdue rows lightly so the eye picks them up.
      if (r.agingBucket !== 'current') {
        doc
          .save()
          .rect(40, y - 2, 515, 12)
          .fillColor('#FFF8E1')
          .fillOpacity(0.6)
          .fill()
          .restore();
      }
      doc.fillColor('#0B1220').fontSize(8);
      doc.text(r.agencyCode, colXs[0]!, y, { lineBreak: false, width: 50 });
      doc.text(r.companyName.slice(0, 22), colXs[1]!, y, { lineBreak: false, width: 130 });
      doc.text(formatINR(r.creditLimitPaise), colXs[2]!, y, { lineBreak: false, width: 60 });
      doc.text(formatINR(r.creditUsedPaise), colXs[3]!, y, { lineBreak: false, width: 65 });
      doc.text(`${r.utilisationPercent.toFixed(1)}%`, colXs[4]!, y, {
        lineBreak: false,
        width: 35,
      });
      doc.text(formatDate(r.creditDueDate), colXs[5]!, y, { lineBreak: false, width: 45 });
      doc.text(r.daysToDue === null ? '—' : String(r.daysToDue), colXs[6]!, y, {
        lineBreak: false,
        width: 35,
      });
      doc.text(r.agingBucket, colXs[7]!, y, { lineBreak: false, width: 50 });
      doc.moveDown(0.5);
      // Crude page-break — pdfkit doesn't auto-flow tables.
      if (doc.y > 780) doc.addPage();
    }
  }

  doc.end();
  return stream;
}

// ─────────────────────────────────────────────────────────────────────────────
// DI payout exporters
// ─────────────────────────────────────────────────────────────────────────────

export async function diPayoutToXlsx(report: DiPayoutReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TripBng';
  wb.created = report.generatedAt;

  const ws = wb.addWorksheet('DI Payout');

  // Period banner — pinned at the top so finance has context when the sheet
  // gets archived. We use a merged title row instead of column headers on row 1.
  ws.mergeCells('A1:F1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `Distributor Incentive Payout — ${formatDate(report.from)} to ${formatDate(report.to)}`;
  titleCell.font = { bold: true, size: 12 };
  titleCell.alignment = { horizontal: 'left' };

  ws.getRow(3).values = [
    'Agency Code',
    'Company',
    'Incentive Count',
    'Gross Incentive',
    'TDS',
    'Net Credit',
  ];
  ws.getRow(3).font = { bold: true };
  ws.columns = [
    { key: 'agencyCode', width: 14 },
    { key: 'companyName', width: 28 },
    { key: 'incentiveCount', width: 14 },
    { key: 'gross', width: 16 },
    { key: 'tds', width: 14 },
    { key: 'net', width: 16 },
  ];

  for (const r of report.rows) {
    ws.addRow({
      agencyCode: r.agencyCode,
      companyName: r.companyName,
      incentiveCount: r.incentiveCount,
      gross: r.grossIncentivePaise / 100,
      tds: r.tdsPaise / 100,
      net: r.netCreditPaise / 100,
    });
  }

  const totalsRow = ws.addRow({
    agencyCode: 'TOTAL',
    companyName: `${report.totalAgencies} agencies`,
    incentiveCount: report.rows.reduce((s, r) => s + r.incentiveCount, 0),
    gross: report.totalGrossIncentivePaise / 100,
    tds: report.totalTdsPaise / 100,
    net: report.totalNetCreditPaise / 100,
  });
  totalsRow.font = { bold: true };
  totalsRow.eachCell((c) => {
    c.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6E3D9' },
    };
  });

  for (const key of ['gross', 'tds', 'net'] as const) {
    ws.getColumn(key).numFmt = '₹#,##0.00';
  }
  ws.views = [{ state: 'frozen', ySplit: 3 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function diPayoutToPdf(report: DiPayoutReport): Readable {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const stream = doc as unknown as Readable;

  doc.fontSize(18).fillColor('#0B1220').text('TripBng — DI Payout Summary');
  doc
    .fontSize(9)
    .fillColor('#6B7488')
    .text(
      `Period ${formatDate(report.from)} → ${formatDate(report.to)}  ·  Generated ${report.generatedAt.toISOString()}`,
    )
    .moveDown(0.6);

  // Summary band.
  const summaryY = doc.y;
  const col = (x: number, label: string, value: string) => {
    doc.fillColor('#6B7488').fontSize(8).text(label, x, summaryY);
    doc
      .fillColor('#0B1220')
      .fontSize(11)
      .text(value, x, summaryY + 12);
  };
  col(40, 'AGENCIES', String(report.totalAgencies));
  col(150, 'GROSS', formatINR(report.totalGrossIncentivePaise));
  col(290, 'TDS', formatINR(report.totalTdsPaise));
  col(420, 'NET', formatINR(report.totalNetCreditPaise));
  doc.y = summaryY + 32;
  doc.moveDown(0.6);
  doc
    .strokeColor('#E6E3D9')
    .lineWidth(0.5)
    .moveTo(40, doc.y)
    .lineTo(555, doc.y)
    .stroke()
    .moveDown(0.4);

  // Table.
  const headers = ['Code', 'Company', 'Count', 'Gross', 'TDS', 'Net'];
  const colXs = [40, 105, 260, 320, 410, 480];
  doc.fillColor('#3A4256').fontSize(8);
  headers.forEach((h, i) =>
    doc.text(h.toUpperCase(), colXs[i]!, doc.y, { lineBreak: false, width: 70 }),
  );
  doc.moveDown(0.6);
  doc
    .strokeColor('#E6E3D9')
    .lineWidth(0.5)
    .moveTo(40, doc.y)
    .lineTo(555, doc.y)
    .stroke()
    .moveDown(0.3);

  doc.fillColor('#0B1220').fontSize(8);
  if (report.rows.length === 0) {
    doc
      .fillColor('#6B7488')
      .text('No DI incentive activity in this period.', 40)
      .moveDown(0.4);
  } else {
    for (const r of report.rows) {
      const y = doc.y;
      doc.fillColor('#0B1220').fontSize(8);
      doc.text(r.agencyCode, colXs[0]!, y, { lineBreak: false, width: 60 });
      doc.text(r.companyName.slice(0, 28), colXs[1]!, y, { lineBreak: false, width: 150 });
      doc.text(String(r.incentiveCount), colXs[2]!, y, { lineBreak: false, width: 50 });
      doc.text(formatINR(r.grossIncentivePaise), colXs[3]!, y, { lineBreak: false, width: 85 });
      doc.text(formatINR(r.tdsPaise), colXs[4]!, y, { lineBreak: false, width: 65 });
      doc.text(formatINR(r.netCreditPaise), colXs[5]!, y, { lineBreak: false, width: 75 });
      doc.moveDown(0.5);
      if (doc.y > 780) doc.addPage();
    }
  }

  doc.end();
  return stream;
}
