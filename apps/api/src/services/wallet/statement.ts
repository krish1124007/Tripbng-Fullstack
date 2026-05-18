import PDFDocument from 'pdfkit';
import type { Readable } from 'node:stream';
import { Agency } from '../../models/Agency.js';
import { Distributor } from '../../models/Distributor.js';
import { WalletTransaction } from '../../models/WalletTransaction.js';
import { AppError } from '@tripbng/shared';

interface StatementInput {
  tenantId: string;
  walletKind: 'AGENCY' | 'DISTRIBUTOR';
  walletOwnerId: string;
  from: Date;
  to: Date;
}

function formatINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// generateStatementPdf — streams a styled PDF using pdfkit. No headless Chromium required;
// fast, low-memory, deterministic. Phase 6 will swap to Puppeteer for tickets/invoices that
// need rich HTML, but a statement is just a table.
export async function generateStatementPdf(input: StatementInput): Promise<Readable> {
  const owner =
    input.walletKind === 'AGENCY'
      ? await Agency.findOne({ _id: input.walletOwnerId, tenantId: input.tenantId }).lean()
      : await Distributor.findOne({ _id: input.walletOwnerId, tenantId: input.tenantId }).lean();
  if (!owner) {
    throw new AppError(
      input.walletKind === 'AGENCY' ? 'AGENCY_NOT_FOUND' : 'DISTRIBUTOR_NOT_FOUND',
    );
  }

  const filter: Record<string, unknown> = {
    tenantId: input.tenantId,
    createdAt: { $gte: input.from, $lte: input.to },
  };
  if (input.walletKind === 'AGENCY') filter.agencyId = input.walletOwnerId;
  else filter.distributorId = input.walletOwnerId;

  const txns = await WalletTransaction.find(filter).sort({ createdAt: 1 }).lean();

  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const stream = doc as unknown as Readable;

  const ownerCode =
    input.walletKind === 'AGENCY'
      ? (owner as { agencyCode: string }).agencyCode
      : (owner as { distributorCode: string }).distributorCode;
  const ownerName = (owner as { companyName: string }).companyName;

  // Header
  doc.fontSize(20).text('TripBng', { continued: false });
  doc.fontSize(11).fillColor('#6B7488').text('Statement of Account').moveDown(0.6);

  doc.fillColor('#0B1220').fontSize(10);
  doc.text(`Account: ${ownerName}`);
  doc.text(`Code: ${ownerCode}`);
  doc.text(`Type: ${input.walletKind}`);
  doc.text(
    `Period: ${input.from.toISOString().slice(0, 10)} — ${input.to.toISOString().slice(0, 10)}`,
  );
  doc.text(`Generated: ${new Date().toISOString()}`);
  doc.moveDown(0.8);

  // Summary
  const totalCredits = txns
    .filter((t) => t.direction === 'CREDIT')
    .reduce((s, t) => s + t.amount, 0);
  const totalDebits = txns.filter((t) => t.direction === 'DEBIT').reduce((s, t) => s + t.amount, 0);
  const closingBalance = txns.length > 0 ? txns[txns.length - 1]!.balanceAfter : null;
  const openingBalance =
    txns.length > 0
      ? txns[0]!.balanceAfter -
        (txns[0]!.direction === 'CREDIT' ? txns[0]!.amount : -txns[0]!.amount)
      : null;

  doc
    .strokeColor('#E6E3D9')
    .lineWidth(0.5)
    .moveTo(48, doc.y)
    .lineTo(547, doc.y)
    .stroke()
    .moveDown(0.4);

  const summaryY = doc.y;
  const col = (x: number, label: string, value: string) => {
    doc.fillColor('#6B7488').fontSize(8).text(label, x, summaryY);
    doc
      .fillColor('#0B1220')
      .fontSize(11)
      .text(value, x, summaryY + 12);
  };
  col(48, 'OPENING', openingBalance != null ? formatINR(openingBalance) : '—');
  col(180, 'TOTAL CREDIT', formatINR(totalCredits));
  col(312, 'TOTAL DEBIT', formatINR(totalDebits));
  col(444, 'CLOSING', closingBalance != null ? formatINR(closingBalance) : '—');
  doc.y = summaryY + 32;
  doc.moveDown(0.6);
  doc
    .strokeColor('#E6E3D9')
    .lineWidth(0.5)
    .moveTo(48, doc.y)
    .lineTo(547, doc.y)
    .stroke()
    .moveDown(0.6);

  // Transaction table
  const headers = ['Date', 'Txn ID', 'Type', 'Description', 'Amount', 'Balance'];
  const colXs = [48, 130, 215, 295, 430, 495];

  doc.fillColor('#3A4256').fontSize(8);
  headers.forEach((h, i) => doc.text(h.toUpperCase(), colXs[i]!, doc.y, { lineBreak: false }));
  doc.moveDown(0.6);

  doc.fillColor('#0B1220').fontSize(9);
  if (txns.length === 0) {
    doc.fillColor('#6B7488').text('No transactions in this period.', 48);
  } else {
    for (const t of txns) {
      if (doc.y > 760) doc.addPage();
      const rowY = doc.y;
      doc
        .fillColor('#0B1220')
        .text(new Date(t.createdAt).toISOString().slice(0, 16).replace('T', ' '), colXs[0]!, rowY, {
          lineBreak: false,
        });
      doc.text(t.txnId, colXs[1]!, rowY, { lineBreak: false });
      doc.text(t.type, colXs[2]!, rowY, { lineBreak: false });
      doc.text((t.description ?? '').slice(0, 32), colXs[3]!, rowY, { lineBreak: false });
      doc
        .fillColor(t.direction === 'CREDIT' ? '#1F9D55' : '#C53030')
        .text(`${t.direction === 'CREDIT' ? '+' : '−'} ${formatINR(t.amount)}`, colXs[4]!, rowY, {
          lineBreak: false,
        });
      doc.fillColor('#0B1220').text(formatINR(t.balanceAfter), colXs[5]!, rowY, {
        lineBreak: false,
      });
      doc.moveDown(0.6);
    }
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc
      .fillColor('#8C8676')
      .fontSize(8)
      .text(`Page ${i + 1} of ${range.count} · TripBng confidential`, 48, 800, {
        align: 'center',
        width: 499,
      });
  }

  doc.end();
  return stream;
}
