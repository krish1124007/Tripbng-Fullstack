// GST tax invoice PDF — pdfkit, single page A4.
//
// Layout is deliberately conservative — Indian tax invoices are
// audited by humans (CA / GST officer) who care about being able to
// recompute every line. We optimise for legibility over branding:
//
//   1. Header strip with TRIPBNG_LEGAL_NAME + invoice number/date
//   2. Bill-from + Bill-to two-column block
//   3. Line items table (HSN/SAC, taxable, GST rate, GST amount, total)
//   4. Tax summary box (CGST/SGST or IGST + grand total)
//   5. Note + footer (booking ref, bank-reference style strip)
//
// Returns a Buffer — caller streams it directly or writes to disk.

import PDFDocument from 'pdfkit';
import type { BusInvoiceDoc } from '../../models/BusInvoice.js';

const MARGIN = 36;
const PAGE_WIDTH = 595; // A4 portrait, 72-dpi.
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLORS = {
  ink: '#0F172A',
  inkSoft: '#475569',
  inkDim: '#94A3B8',
  hairline: '#E2E8F0',
  brand: '#0F1F4F',
  brandSoft: '#EEF2FF',
  okGreen: '#15803D',
} as const;

/** Format paise as `₹1,23,456.78` (Indian-style grouping). */
function formatRupees(paise: number): string {
  const rupees = paise / 100;
  // Manual Indian grouping — Intl.NumberFormat 'en-IN' is correct but
  // we want the explicit ₹ glyph alternative. pdfkit's Helvetica
  // doesn't ship ₹; we use the ASCII fallback "Rs ".
  const formatted = rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Rs ${formatted}`;
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}-${mm}-${yyyy}`;
}

function formatRateBp(bp: number): string {
  return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
}

/**
 * Render a BusInvoice into a PDF buffer.
 */
export async function renderBusInvoicePdf(invoice: BusInvoiceDoc): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // ── 1. Header ──
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(COLORS.brand)
    .text('TAX INVOICE', MARGIN, MARGIN, { width: CONTENT_WIDTH });

  // Invoice number + date in the top-right.
  const headerRight = MARGIN + CONTENT_WIDTH;
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.inkSoft)
    .text(`Invoice #${invoice.invoiceNumber}`, MARGIN, MARGIN + 22, {
      width: CONTENT_WIDTH,
      align: 'right',
    })
    .text(`Issued ${formatDate(invoice.issueDate)}`, MARGIN, MARGIN + 36, {
      width: CONTENT_WIDTH,
      align: 'right',
    });

  // Hairline divider.
  doc
    .moveTo(MARGIN, MARGIN + 56)
    .lineTo(headerRight, MARGIN + 56)
    .lineWidth(0.5)
    .strokeColor(COLORS.hairline)
    .stroke();

  // ── 2. Bill-from / Bill-to ──
  const billY = MARGIN + 70;
  const colWidth = (CONTENT_WIDTH - 24) / 2;

  drawParty(doc, MARGIN, billY, colWidth, 'BILL FROM', invoice.billFrom);
  drawParty(doc, MARGIN + colWidth + 24, billY, colWidth, 'BILL TO', invoice.billTo);

  // ── 3. Line items ──
  const tableY = billY + 130;
  drawLineTable(doc, tableY, invoice);

  // ── 4. Tax summary ──
  // Position right under the table.
  const summaryY = tableY + 24 + invoice.lines.length * 22 + 16;
  drawTaxSummary(doc, summaryY, invoice);

  // ── 5. Footer ──
  const footerY = 800;
  doc
    .moveTo(MARGIN, footerY - 10)
    .lineTo(headerRight, footerY - 10)
    .strokeColor(COLORS.hairline)
    .lineWidth(0.5)
    .stroke();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.inkDim)
    .text(
      `This is a computer-generated tax invoice. Booking ref: ${String(invoice.bookingId)}.`,
      MARGIN,
      footerY,
      { width: CONTENT_WIDTH, align: 'left' },
    );

  doc.end();
  return finished;
}

function drawParty(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  party: BusInvoiceDoc['billFrom'],
): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(COLORS.inkDim)
    .text(label, x, y, { width });
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.ink)
    .text(party.name, x, y + 14, { width });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.inkSoft)
    .text(party.address, x, y + 32, { width });
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLORS.ink)
    .text(`GSTIN ${party.gstin || '—'}`, x, y + 80, { width });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.inkSoft)
    .text(`State: ${party.state}  ·  Code: ${party.stateCode}`, x, y + 96, { width });
}

function drawLineTable(doc: PDFKit.PDFDocument, y: number, invoice: BusInvoiceDoc): void {
  const rowHeight = 22;
  const headers = [
    { label: 'Description', x: MARGIN, w: 240 },
    { label: 'HSN/SAC', x: MARGIN + 248, w: 60 },
    { label: 'Taxable', x: MARGIN + 312, w: 70 },
    { label: 'GST', x: MARGIN + 386, w: 50 },
    { label: 'GST amt', x: MARGIN + 440, w: 60 },
    { label: 'Total', x: MARGIN + 504, w: 60 },
  ];

  // Header row.
  doc
    .rect(MARGIN, y, CONTENT_WIDTH, rowHeight)
    .fillColor(COLORS.brandSoft)
    .fill();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.brand);
  for (const h of headers) {
    const align = ['Description', 'HSN/SAC'].includes(h.label) ? 'left' : 'right';
    doc.text(h.label, h.x, y + 7, { width: h.w, align });
  }

  // Body rows.
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink);
  let cursorY = y + rowHeight;
  for (const line of invoice.lines) {
    doc
      .moveTo(MARGIN, cursorY)
      .lineTo(MARGIN + CONTENT_WIDTH, cursorY)
      .lineWidth(0.5)
      .strokeColor(COLORS.hairline)
      .stroke();
    doc.text(line.description, headers[0]!.x, cursorY + 7, {
      width: headers[0]!.w,
      align: 'left',
      ellipsis: true,
    });
    doc.text(line.hsnSacCode, headers[1]!.x, cursorY + 7, {
      width: headers[1]!.w,
      align: 'left',
    });
    doc.text(formatRupees(line.taxableValuePaise), headers[2]!.x, cursorY + 7, {
      width: headers[2]!.w,
      align: 'right',
    });
    doc.text(formatRateBp(line.gstRateBp), headers[3]!.x, cursorY + 7, {
      width: headers[3]!.w,
      align: 'right',
    });
    doc.text(formatRupees(line.gstAmountPaise), headers[4]!.x, cursorY + 7, {
      width: headers[4]!.w,
      align: 'right',
    });
    doc.text(formatRupees(line.totalPaise), headers[5]!.x, cursorY + 7, {
      width: headers[5]!.w,
      align: 'right',
    });
    cursorY += rowHeight;
  }

  // Bottom rule.
  doc
    .moveTo(MARGIN, cursorY)
    .lineTo(MARGIN + CONTENT_WIDTH, cursorY)
    .lineWidth(0.5)
    .strokeColor(COLORS.hairline)
    .stroke();
}

function drawTaxSummary(doc: PDFKit.PDFDocument, y: number, invoice: BusInvoiceDoc): void {
  const boxX = MARGIN + CONTENT_WIDTH - 220;
  const boxY = y;
  const boxWidth = 220;
  const lineHeight = 18;

  doc
    .rect(boxX, boxY, boxWidth, 6 * lineHeight + 8)
    .fillColor('#F8FAFC')
    .fill();

  const rows: Array<[string, string]> = [
    ['Subtotal', formatRupees(invoice.subtotalPaise)],
  ];
  if (invoice.gstSplitKind === 'INTRA_STATE') {
    rows.push(['CGST', formatRupees(invoice.cgstPaise)]);
    rows.push(['SGST', formatRupees(invoice.sgstPaise)]);
  } else {
    rows.push(['IGST', formatRupees(invoice.igstPaise)]);
  }

  doc.font('Helvetica').fontSize(10).fillColor(COLORS.inkSoft);
  rows.forEach((row, i) => {
    const ry = boxY + 8 + i * lineHeight;
    doc.text(row[0], boxX + 12, ry, { width: 80, align: 'left' });
    doc.text(row[1], boxX + boxWidth - 100 - 8, ry, { width: 100, align: 'right' });
  });

  // Grand total — emphasised row.
  const totalY = boxY + 8 + rows.length * lineHeight + 4;
  doc
    .moveTo(boxX + 8, totalY)
    .lineTo(boxX + boxWidth - 8, totalY)
    .lineWidth(0.75)
    .strokeColor(COLORS.brand)
    .stroke();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.brand);
  doc.text('TOTAL', boxX + 12, totalY + 6, { width: 80, align: 'left' });
  doc.text(formatRupees(invoice.totalPaise), boxX + boxWidth - 100 - 8, totalY + 6, {
    width: 100,
    align: 'right',
  });
}
