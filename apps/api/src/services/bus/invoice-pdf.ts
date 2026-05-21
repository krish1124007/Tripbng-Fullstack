// Bus GST tax invoice PDF — themed renderer using the shared pdf-theme
// toolkit. Mirrors `services/flight/invoice-pdf.ts` so finance can audit
// both product lines with identical visual structure.
//
// Story arc:
//   1. Brand-deep premium header (logo, wordmark, BUS, invoice #, booking ref)
//   2. Status pills (PAID / CANCELLED)
//   3. Bill-from / Bill-to two-column block
//   4. Line items table (Description, HSN/SAC, Taxable, GST, GST amt, Total)
//   5. Tax-split summary card (Subtotal / CGST+SGST or IGST / TOTAL)
//   6. Slim brand-deep footer
//
// Returns a Buffer — caller streams it directly or writes to disk.

import PDFDocument from 'pdfkit';
import type { BusInvoiceDoc } from '../../models/BusInvoice.js';
import {
  drawPremiumHeader,
  drawStatusPills,
  drawPartyBlock,
  drawLineItemTable,
  drawTaxSummary,
  drawFooter as drawThemeFooter,
  PAGE,
} from '../pdf-theme.js';

/**
 * Render a BusInvoice into a PDF buffer.
 */
export async function renderBusInvoicePdf(invoice: BusInvoiceDoc): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  let y = drawPremiumHeader(doc, {
    product: 'BUS',
    title: 'TAX INVOICE',
    bookingCode: String(invoice.bookingId),
    issuedAt: invoice.issueDate,
    invoiceNumber: invoice.invoiceNumber,
  });

  y = drawStatusPills(doc, y, [
    { label: 'TAX INVOICE', tone: 'success' },
    { label: 'PAID', tone: 'success' },
  ]);

  const colW = (PAGE.CONTENT_W - 24) / 2;
  drawPartyBlock(doc, PAGE.PAD_X, y, colW, 'BILL FROM', {
    name: invoice.billFrom.name,
    address: invoice.billFrom.address,
    gstin: invoice.billFrom.gstin,
    state: invoice.billFrom.state,
    stateCode: invoice.billFrom.stateCode,
  });
  drawPartyBlock(doc, PAGE.PAD_X + colW + 24, y, colW, 'BILL TO', {
    name: invoice.billTo.name,
    address: invoice.billTo.address,
    gstin: invoice.billTo.gstin,
    state: invoice.billTo.state,
    stateCode: invoice.billTo.stateCode,
  });
  y += 138;

  y = drawLineItemTable(
    doc,
    y,
    invoice.lines.map((l) => ({
      description: l.description,
      hsnSacCode: l.hsnSacCode,
      taxableValuePaise: l.taxableValuePaise,
      gstRateBp: l.gstRateBp,
      gstAmountPaise: l.gstAmountPaise,
      totalPaise: l.totalPaise,
    })),
    { showHsn: true, showGstRate: true },
  );

  drawTaxSummary(doc, y, {
    subtotalPaise: invoice.subtotalPaise,
    cgstPaise: invoice.gstSplitKind === 'INTRA_STATE' ? invoice.cgstPaise : 0,
    sgstPaise: invoice.gstSplitKind === 'INTRA_STATE' ? invoice.sgstPaise : 0,
    igstPaise: invoice.gstSplitKind === 'INTRA_STATE' ? 0 : invoice.igstPaise,
    totalPaise: invoice.totalPaise,
  });

  drawThemeFooter(doc, { bookingRef: String(invoice.bookingId) });
  doc.end();
  return finished;
}
