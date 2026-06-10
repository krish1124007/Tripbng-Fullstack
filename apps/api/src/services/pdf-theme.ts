// Shared premium PDF theme — brand-deep header strip, accent rails,
// itinerary cards, summary rows, polished totals box, slim footer.
//
// All product invoices (flight / hotel / holiday / visa / bus) use this
// toolkit so the visual story stays identical across documents. The
// rich flight e-ticket renderer in `booking-pdf.ts` predates this and
// keeps its own bespoke chrome — it's already very rich and tuned for
// boarding-pass cues.
//
// Type pairing (pdfkit built-ins only, no TTF embedding):
//   - Times-Bold / Times-Italic     display headlines + editorial accents
//   - Helvetica / Helvetica-Bold    body, eyebrows, UI labels
//   - Courier-Bold                  mono codes (booking refs, fares, GSTIN)
//
// Helvetica's WinAnsi encoding has no ₹, ✈, ⚠ — we emit ASCII
// alternatives and draw symbols as vector primitives.

import type PDFKit from 'pdfkit';

// ────────── Geometry ──────────

export const PAGE = {
  W: 595,
  H: 842,
  PAD_X: 40,
  CONTENT_W: 595 - 80,
} as const;

// ────────── Color tokens ──────────

export const C = {
  ink1: '#0B1220',
  ink2: '#3A4256',
  ink3: '#6B7488',
  ink4: '#9098A6',
  paper: '#FFFFFF',
  paperWarm: '#FBF9F4',
  paperTint: '#F4F1E9',
  brandDeep: '#0E1A3A',
  brandDeepEdge: '#1A2856',
  onBrandDeep: '#FFFFFF',
  onBrandDeepMuted: '#9DA8C7',
  accent: '#FF5B49',
  accentInk: '#B8311E',
  accentSoft: '#FFE4DF',
  accentSoftEdge: '#FFCFC5',
  success: '#0E8C4D',
  successSoft: '#E1F5EA',
  warning: '#B7791F',
  warningSoft: '#FFF4DD',
  danger: '#B91C1C',
  dangerSoft: '#FEE2E2',
  border: '#E6E3D9',
  divider: '#EFECE2',
  brandSoft: '#EEF2FF',
} as const;

// ────────── Currency / date helpers ──────────

/** Format paise as "Rs 1,23,456.78" — Indian grouping, ASCII rupee. */
export function fmtRupees(paise: number): string {
  const rupees = paise / 100;
  const formatted = rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Rs ${formatted}`;
}

/** Compact paise format with no fractional zeros — for tight totals UI. */
export function fmtRupeesCompact(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 10_000_000) return `Rs ${(rupees / 10_000_000).toFixed(1)}Cr`;
  if (rupees >= 100_000) return `Rs ${(rupees / 100_000).toFixed(1)}L`;
  if (rupees >= 1000) return `Rs ${(rupees / 1000).toFixed(1)}K`;
  return `Rs ${rupees.toFixed(0)}`;
}

export function fmtDateLong(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function fmtDateShort(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function fmtDateTime(d: Date): string {
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ────────── Primitive drawing helpers ──────────

/** A thin hairline divider spanning the content width. */
export function hairline(doc: PDFKit.PDFDocument, y: number): void {
  doc
    .moveTo(PAGE.PAD_X, y)
    .lineTo(PAGE.W - PAGE.PAD_X, y)
    .lineWidth(0.5)
    .strokeColor(C.divider)
    .stroke();
}

/** Eyebrow label — uppercase, tracked, ink-3 muted. */
export function eyebrow(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  w?: number,
): void {
  doc
    .fillColor(C.ink3)
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .text(text, x, y, {
      width: w,
      lineBreak: false,
      characterSpacing: 1.6,
    });
}

/** Section heading — larger than eyebrow, tracks brand voice. */
export function sectionHead(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
): void {
  doc
    .fillColor(C.ink1)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(text, x, y, { lineBreak: false });
}

/** Vector logo: accent square + serif "tb" mark. */
export function drawLogoMark(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  size: number,
): void {
  doc.roundedRect(x, y, size, size, 4).fill(C.accent);
  doc
    .fillColor('#FFFFFF')
    .font('Times-Italic')
    .fontSize(size * 0.62)
    .text('tb', x, y + size * 0.18, {
      width: size,
      align: 'center',
      lineBreak: false,
    });
}

// ────────── Premium brand-deep header ──────────

export interface PremiumHeaderOptions {
  /** Top-line product label — "FLIGHT", "HOTEL", "HOLIDAY", "VISA", "BUS". */
  product: string;
  /** Document title — usually "TAX INVOICE". */
  title: string;
  /** Booking reference shown in the top-right hero slot. */
  bookingCode: string;
  /** Secondary reference label / value (PNR / Confirmation / TIN / App). */
  reference?: { label: string; value: string } | null;
  /** Issue timestamp shown beneath the hero block. */
  issuedAt: Date;
  /** Optional invoice number — shown on the right in mono. */
  invoiceNumber?: string | null;
  /**
   * Per-tenant branding — when provided, swaps the platform header
   * bar colour for the tenant's primaryColor, drops in their logo
   * (PNG/JPEG base64 data URL), and uses their companyName as the
   * wordmark. Falls back to TripBng defaults when omitted.
   */
  branding?: {
    companyName: string;
    primaryColor: string;
    primaryForegroundColor: string;
    /** data:image/...;base64,... — pdfkit's image() takes this directly. */
    logoDataUrl: string | null;
  } | null;
}

/**
 * Brand-deep header strip — 96pt tall. Includes vector logo, wordmark,
 * eyebrow, product label, hero booking code, secondary reference, and
 * issued timestamp. Returns the y-coordinate immediately below the
 * strip so the caller can chain content underneath.
 */
export function drawPremiumHeader(
  doc: PDFKit.PDFDocument,
  opts: PremiumHeaderOptions,
): number {
  const H = 96;
  // Brand-deep band — uses the tenant's primaryColor when branding is
  // passed, falls back to the TripBng platform brand-deep blue.
  const headerBg = opts.branding?.primaryColor ?? C.brandDeep;
  const headerFg = opts.branding?.primaryForegroundColor ?? C.onBrandDeep;
  const headerFgMuted = opts.branding?.primaryForegroundColor
    ? // Approximate "muted" foreground — 65% opacity-equivalent in mono.
      headerFg === '#ffffff' || headerFg === '#fff'
        ? '#cbd5e1'
        : '#475569'
    : C.onBrandDeepMuted;

  doc.rect(0, 0, PAGE.W, H).fill(headerBg);
  doc.rect(0, H - 8, PAGE.W, 8).fillOpacity(0.85).fill(headerBg).fillOpacity(1);

  // Decorative perforation dots, top-right.
  for (let i = 0; i < 12; i++) {
    doc.circle(PAGE.W - PAGE.PAD_X - 6 - i * 12, 18, 1.2).fill(C.accent);
  }

  // Logo + wordmark, top-left. Tenant logo (if any) takes the same
  // 30pt height slot as the platform mark so the rest of the layout
  // doesn't shift.
  const wordmarkX = PAGE.PAD_X + 42;
  if (opts.branding?.logoDataUrl) {
    try {
      // pdfkit can decode a base64 data URL directly via Buffer.from.
      const b64 = opts.branding.logoDataUrl.split(',')[1] ?? '';
      const buf = Buffer.from(b64, 'base64');
      // 36×36 box, letter-boxed by pdfkit's `fit` option so the
      // aspect ratio stays correct.
      doc.image(buf, PAGE.PAD_X, 18, { fit: [36, 36] });
    } catch {
      // If anything goes wrong (bad bytes, unsupported format),
      // fall back to the vector mark.
      drawLogoMark(doc, PAGE.PAD_X, 22, 30);
    }
  } else {
    drawLogoMark(doc, PAGE.PAD_X, 22, 30);
  }
  const wordmark = opts.branding?.companyName ?? 'tripbng';
  doc
    .fillColor(headerFg)
    .font('Times-Bold')
    .fontSize(22)
    .text(wordmark, wordmarkX, 26, { lineBreak: false });

  // Eyebrow under wordmark: PARTNER HUB · TAX INVOICE · PRODUCT
  doc
    .fillColor(headerFgMuted)
    .font('Helvetica')
    .fontSize(7.5)
    .text(`PARTNER HUB  ·  ${opts.title.toUpperCase()}  ·  ${opts.product.toUpperCase()}`, wordmarkX, 54, {
      lineBreak: false,
      characterSpacing: 1.6,
    });

  // Right side — invoice number (mono) + booking hero + issued time.
  const rightBlockW = 240;
  const rx = PAGE.W - PAGE.PAD_X - rightBlockW;
  if (opts.invoiceNumber) {
    doc
      .fillColor(headerFgMuted)
      .font('Helvetica')
      .fontSize(7.5)
      .text('INVOICE', rx, 24, {
        width: rightBlockW,
        align: 'right',
        lineBreak: false,
        characterSpacing: 1.6,
      });
    doc
      .fillColor(headerFg)
      .font('Courier-Bold')
      .fontSize(13)
      .text(opts.invoiceNumber, rx, 35, {
        width: rightBlockW,
        align: 'right',
        lineBreak: false,
      });
  }
  // Hero booking code in mono.
  doc
    .fillColor(headerFgMuted)
    .font('Helvetica')
    .fontSize(7.5)
    .text('BOOKING REF', rx, 53, {
      width: rightBlockW,
      align: 'right',
      lineBreak: false,
      characterSpacing: 1.6,
    });
  doc
    .fillColor(headerFg)
    .font('Courier-Bold')
    .fontSize(14)
    .text(opts.bookingCode, rx, 64, {
      width: rightBlockW,
      align: 'right',
      lineBreak: false,
    });
  // Issued.
  doc
    .fillColor(headerFgMuted)
    .font('Helvetica')
    .fontSize(7.5)
    .text(`Issued ${fmtDateTime(opts.issuedAt)}`, rx, 81, {
      width: rightBlockW,
      align: 'right',
      lineBreak: false,
    });

  // Bottom edge — accent hairline.
  doc.rect(0, H, PAGE.W, 1).fill(C.accent);

  return H + 16; // top of next section
}

// ────────── Status pills row ──────────

export type PillTone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

interface PillSpec {
  label: string;
  tone?: PillTone;
}

/** Draw a row of status pills under the header. Returns next y. */
export function drawStatusPills(
  doc: PDFKit.PDFDocument,
  y: number,
  pills: PillSpec[],
): number {
  let cx = PAGE.PAD_X;
  for (const p of pills) {
    const tone = p.tone ?? 'neutral';
    const bg =
      tone === 'success'
        ? C.successSoft
        : tone === 'warning'
          ? C.warningSoft
          : tone === 'danger'
            ? C.dangerSoft
            : tone === 'accent'
              ? C.accentSoft
              : C.paperTint;
    const fg =
      tone === 'success'
        ? C.success
        : tone === 'warning'
          ? C.warning
          : tone === 'danger'
            ? C.danger
            : tone === 'accent'
              ? C.accentInk
              : C.ink2;
    doc.font('Helvetica-Bold').fontSize(8.5);
    // Measure WITHOUT character spacing then add generous padding so
    // the pill background never clips the text on re-render.
    const textW = doc.widthOfString(p.label);
    const w = textW + 22;
    doc.roundedRect(cx, y, w, 18, 9).fill(bg);
    doc
      .fillColor(fg)
      .text(p.label, cx + 11, y + 5, {
        width: w,
        lineBreak: false,
      });
    cx += w + 6;
  }
  return y + 18 + 14;
}

// ────────── Bill-from / Bill-to two-column block ──────────

export interface PartyBlock {
  name: string;
  address?: string;
  gstin?: string | null;
  state?: string | null;
  stateCode?: string | number | null;
  email?: string | null;
  mobile?: string | null;
}

export function drawPartyBlock(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  label: string,
  party: PartyBlock,
): void {
  eyebrow(doc, label, x, y, w);
  doc
    .fillColor(C.ink1)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(party.name || '—', x, y + 14, { width: w, lineBreak: false });
  if (party.address) {
    doc
      .fillColor(C.ink2)
      .font('Helvetica')
      .fontSize(9)
      .text(party.address, x, y + 32, { width: w });
  }
  if (party.gstin) {
    doc
      .fillColor(C.ink1)
      .font('Courier-Bold')
      .fontSize(9)
      .text(`GSTIN ${party.gstin}`, x, y + 80, { width: w, lineBreak: false });
  }
  if (party.state || party.stateCode) {
    doc
      .fillColor(C.ink3)
      .font('Helvetica')
      .fontSize(8.5)
      .text(
        `State: ${party.state ?? '—'}${
          party.stateCode != null ? `  ·  Code ${party.stateCode}` : ''
        }`,
        x,
        y + 95,
        { width: w, lineBreak: false },
      );
  }
  if (party.email) {
    doc
      .fillColor(C.ink3)
      .font('Helvetica')
      .fontSize(8.5)
      .text(party.email, x, y + 108, { width: w, lineBreak: false });
  }
  if (party.mobile) {
    doc
      .fillColor(C.ink3)
      .font('Helvetica')
      .fontSize(8.5)
      .text(party.mobile, x, y + 120, { width: w, lineBreak: false });
  }
}

// ────────── Itinerary card ──────────

export type ProductGlyph = 'flight' | 'hotel' | 'holiday' | 'visa' | 'bus';

interface ItineraryCell {
  label: string;
  value: string;
}

export interface ItineraryCardOptions {
  glyph: ProductGlyph;
  title: string;
  subtitle?: string | null;
  /** Up to 4 key/value cells laid out as a 2x2 (or 4x1 if 4 narrow ones). */
  cells: ItineraryCell[];
  /** Optional callout chip on the right (e.g. "1 NIGHT" / "ROUNDTRIP"). */
  chip?: string | null;
}

/**
 * A bordered card with an accent rail on the left, a product glyph in
 * a tinted square, a headline title + subtitle, and a row/grid of
 * key/value cells underneath. Returns next y.
 */
export function drawItineraryCard(
  doc: PDFKit.PDFDocument,
  y: number,
  opts: ItineraryCardOptions,
): number {
  const x = PAGE.PAD_X;
  const w = PAGE.CONTENT_W;
  const h = 120 + (opts.cells.length > 2 ? 0 : 0);

  // Card surface — paperWarm with a thin border.
  doc.roundedRect(x, y, w, h, 6).fill(C.paperWarm);
  doc.roundedRect(x, y, w, h, 6).lineWidth(0.5).strokeColor(C.border).stroke();

  // Accent rail on the left.
  doc.rect(x, y, 4, h).fill(C.accent);

  // Glyph tile.
  const tileX = x + 18;
  const tileY = y + 18;
  doc.roundedRect(tileX, tileY, 38, 38, 5).fill(C.brandSoft);
  drawProductGlyph(doc, opts.glyph, tileX + 7, tileY + 7);

  // Title + subtitle.
  doc
    .fillColor(C.ink1)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(opts.title, tileX + 48, tileY + 2, {
      width: w - 80 - (opts.chip ? 100 : 0),
      lineBreak: false,
      ellipsis: true,
    });
  if (opts.subtitle) {
    doc
      .fillColor(C.ink3)
      .font('Helvetica')
      .fontSize(9)
      .text(opts.subtitle, tileX + 48, tileY + 20, {
        width: w - 80 - (opts.chip ? 100 : 0),
        lineBreak: false,
        ellipsis: true,
      });
  }

  // Chip top-right.
  if (opts.chip) {
    doc.font('Helvetica-Bold').fontSize(8);
    const chipW = doc.widthOfString(opts.chip) + 20;
    const chipX = x + w - chipW - 18;
    const chipY = y + 22;
    doc.roundedRect(chipX, chipY, chipW, 16, 8).fill(C.accentSoft);
    doc
      .fillColor(C.accentInk)
      .text(opts.chip, chipX + 10, chipY + 4, {
        width: chipW,
        lineBreak: false,
      });
  }

  // Cells — 2 columns by default.
  const cellAreaY = y + 70;
  const cellAreaX = x + 18;
  const cellsTotalW = w - 36;
  const cellW = cellsTotalW / 2 - 8;
  for (let i = 0; i < Math.min(opts.cells.length, 4); i++) {
    const cell = opts.cells[i]!;
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = cellAreaX + col * (cellW + 16);
    const cy = cellAreaY + row * 24;
    doc
      .fillColor(C.ink3)
      .font('Helvetica-Bold')
      .fontSize(7)
      .text(cell.label.toUpperCase(), cx, cy, {
        width: cellW,
        lineBreak: false,
        characterSpacing: 1.4,
      });
    doc
      .fillColor(C.ink1)
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .text(cell.value, cx, cy + 9, {
        width: cellW,
        lineBreak: false,
        ellipsis: true,
      });
  }

  return y + h + 18;
}

function drawProductGlyph(
  doc: PDFKit.PDFDocument,
  glyph: ProductGlyph,
  x: number,
  y: number,
): void {
  // 24pt glyph square — coordinates are local to (x, y) and reach to
  // approximately (+22, +22) so callers can size the surrounding tile
  // for the glyph at ~24-26pt.
  doc.strokeColor(C.brandDeep).lineWidth(1.5).fillColor(C.brandDeep);
  switch (glyph) {
    case 'flight':
      // simple plane silhouette
      doc.moveTo(x + 4, y + 16).lineTo(x + 20, y + 8).lineTo(x + 22, y + 10).lineTo(x + 12, y + 18).lineTo(x + 12, y + 22).lineTo(x + 10, y + 22).lineTo(x + 8, y + 19).lineTo(x + 4, y + 19).closePath().fill();
      break;
    case 'hotel': {
      // building with windows
      doc.rect(x + 4, y + 6, 16, 16).fill();
      doc.fillColor('#fff');
      doc.rect(x + 7, y + 9, 3, 3).fill();
      doc.rect(x + 12, y + 9, 3, 3).fill();
      doc.rect(x + 7, y + 14, 3, 3).fill();
      doc.rect(x + 12, y + 14, 3, 3).fill();
      doc.fillColor(C.brandDeep);
      break;
    }
    case 'holiday':
      // mountain + sun
      doc.circle(x + 17, y + 9, 3).fill();
      doc.moveTo(x + 3, y + 21).lineTo(x + 10, y + 10).lineTo(x + 14, y + 16).lineTo(x + 18, y + 12).lineTo(x + 22, y + 21).closePath().fill();
      break;
    case 'visa':
      // passport: rect + accent stripe
      doc.roundedRect(x + 5, y + 5, 14, 18, 1.5).fill();
      doc.fillColor(C.accent).rect(x + 5, y + 9, 14, 1.5).fill();
      doc.fillColor(C.brandDeep);
      doc.circle(x + 12, y + 16, 2).fill();
      break;
    case 'bus':
      // bus front
      doc.roundedRect(x + 4, y + 5, 16, 16, 2).fill();
      doc.fillColor('#fff').rect(x + 6, y + 7, 12, 5).fill();
      doc.fillColor(C.brandDeep).circle(x + 8, y + 19, 1.6).fill();
      doc.circle(x + 16, y + 19, 1.6).fill();
      break;
  }
}

// ────────── Summary rows + total card ──────────

export interface SummaryRow {
  label: string;
  paise: number;
  /** Render as credit (negative styling) — defaults from sign of paise. */
  credit?: boolean;
  /** Treat as muted hint row (used for "× N nights" line annotations). */
  muted?: boolean;
}

/**
 * Right-aligned summary rows under a SUMMARY eyebrow. Returns next y.
 * Skips zero-value rows.
 */
export function drawSummaryRows(
  doc: PDFKit.PDFDocument,
  y: number,
  rows: SummaryRow[],
): number {
  const x = PAGE.PAD_X;
  const w = PAGE.CONTENT_W;
  eyebrow(doc, 'SUMMARY', x, y, w);
  let cy = y + 16;
  for (const r of rows) {
    if (r.paise === 0) continue;
    const credit = r.credit ?? r.paise < 0;
    doc
      .fillColor(r.muted ? C.ink3 : C.ink2)
      .font('Helvetica')
      .fontSize(10)
      .text(r.label, x, cy, { width: w / 2, lineBreak: false });
    doc
      .fillColor(credit ? C.success : C.ink1)
      .font(r.muted ? 'Helvetica' : 'Helvetica-Bold')
      .fontSize(10)
      .text(
        `${credit ? '-' : ''}${fmtRupees(Math.abs(r.paise))}`,
        x,
        cy,
        { width: w, align: 'right', lineBreak: false },
      );
    cy += 16;
  }
  return cy + 4;
}

/**
 * Premium total card — right-aligned bordered box with the grand total.
 * Returns next y.
 */
export function drawTotalCard(
  doc: PDFKit.PDFDocument,
  y: number,
  label: string,
  totalPaise: number,
): number {
  const w = 260;
  const h = 56;
  const x = PAGE.W - PAGE.PAD_X - w;

  doc.roundedRect(x, y, w, h, 6).fill(C.brandDeep);
  doc.rect(x, y + h - 4, w, 4).fill(C.accent);

  eyebrow(doc, label.toUpperCase(), x + 16, y + 10, w - 32);
  doc
    .fillColor(C.onBrandDeep)
    .font('Courier-Bold')
    .fontSize(20)
    .text(fmtRupees(totalPaise), x + 16, y + 24, {
      width: w - 32,
      align: 'right',
      lineBreak: false,
    });

  return y + h + 18;
}

// ────────── Line-item table (GST invoice mode) ──────────

export interface TableLine {
  description: string;
  hsnSacCode?: string;
  taxableValuePaise: number;
  gstRateBp?: number;
  gstAmountPaise?: number;
  totalPaise: number;
}

/**
 * Draw a structured line-items table (Description, HSN/SAC, Taxable,
 * GST, GST amt, Total). Returns next y.
 */
export function drawLineItemTable(
  doc: PDFKit.PDFDocument,
  y: number,
  lines: TableLine[],
  options: { showHsn?: boolean; showGstRate?: boolean } = {},
): number {
  const x = PAGE.PAD_X;
  const w = PAGE.CONTENT_W;
  const showHsn = options.showHsn !== false;
  const showGst = options.showGstRate !== false;
  const rowH = 22;

  // Header band.
  doc.roundedRect(x, y, w, rowH, 4).fill(C.brandSoft);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.brandDeep);
  const cols = buildColumns(showHsn, showGst, x);
  for (const c of cols) {
    doc.text(c.label, c.x, y + 7, {
      width: c.w,
      align: c.align,
      lineBreak: false,
      characterSpacing: 0.6,
    });
  }

  let cy = y + rowH;
  doc.font('Helvetica').fontSize(9).fillColor(C.ink1);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    // Zebra striping for readability.
    if (i % 2 === 1) {
      doc.rect(x, cy, w, rowH).fill(C.paperWarm);
    }
    doc
      .moveTo(x, cy)
      .lineTo(x + w, cy)
      .lineWidth(0.4)
      .strokeColor(C.divider)
      .stroke();

    doc.fillColor(C.ink1);
    const values: string[] = [];
    values.push(ln.description);
    if (showHsn) values.push(ln.hsnSacCode ?? '—');
    values.push(fmtRupees(ln.taxableValuePaise));
    if (showGst)
      values.push(
        ln.gstRateBp != null
          ? `${(ln.gstRateBp / 100).toFixed(ln.gstRateBp % 100 === 0 ? 0 : 2)}%`
          : '—',
      );
    if (showGst) values.push(fmtRupees(ln.gstAmountPaise ?? 0));
    values.push(fmtRupees(ln.totalPaise));

    for (let j = 0; j < cols.length; j++) {
      doc
        .font(j === 0 ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(j === 0 ? 9 : 9)
        .fillColor(C.ink1)
        .text(values[j] ?? '', cols[j]!.x, cy + 7, {
          width: cols[j]!.w,
          align: cols[j]!.align,
          lineBreak: false,
          ellipsis: true,
        });
    }
    cy += rowH;
  }
  doc
    .moveTo(x, cy)
    .lineTo(x + w, cy)
    .lineWidth(0.6)
    .strokeColor(C.border)
    .stroke();
  return cy + 12;
}

interface Col {
  label: string;
  x: number;
  w: number;
  align: 'left' | 'right';
}

function buildColumns(showHsn: boolean, showGst: boolean, baseX: number): Col[] {
  // Variable widths depending on which columns are shown.
  if (showHsn && showGst) {
    return [
      { label: 'Description', x: baseX + 10, w: 200, align: 'left' },
      { label: 'HSN/SAC', x: baseX + 218, w: 50, align: 'left' },
      { label: 'Taxable', x: baseX + 272, w: 70, align: 'right' },
      { label: 'GST', x: baseX + 346, w: 40, align: 'right' },
      { label: 'GST amt', x: baseX + 390, w: 60, align: 'right' },
      { label: 'Total', x: baseX + 454, w: 60, align: 'right' },
    ];
  }
  // Minimal — just description + total (used by simpler invoices).
  return [
    { label: 'Description', x: baseX + 10, w: 340, align: 'left' },
    { label: 'Taxable', x: baseX + 356, w: 80, align: 'right' },
    { label: 'Total', x: baseX + 442, w: 72, align: 'right' },
  ];
}

// ────────── Tax-split summary box ──────────

export interface TaxSummaryRows {
  subtotalPaise: number;
  cgstPaise?: number;
  sgstPaise?: number;
  igstPaise?: number;
  /** Optional discount line — rendered as a credit. */
  discountPaise?: number;
  totalPaise: number;
}

/**
 * Right-aligned tax-summary card with sub-rows + emphasised TOTAL.
 * Returns next y.
 */
export function drawTaxSummary(
  doc: PDFKit.PDFDocument,
  y: number,
  rows: TaxSummaryRows,
): number {
  const w = 240;
  const x = PAGE.W - PAGE.PAD_X - w;
  const lineH = 18;

  const summaryRows: Array<[string, number, boolean?]> = [
    ['Subtotal', rows.subtotalPaise],
  ];
  if ((rows.cgstPaise ?? 0) > 0) summaryRows.push(['CGST', rows.cgstPaise!]);
  if ((rows.sgstPaise ?? 0) > 0) summaryRows.push(['SGST', rows.sgstPaise!]);
  if ((rows.igstPaise ?? 0) > 0) summaryRows.push(['IGST', rows.igstPaise!]);
  if ((rows.discountPaise ?? 0) > 0)
    summaryRows.push(['Discount', -rows.discountPaise!, true]);

  const boxH = 8 + summaryRows.length * lineH + 32;
  doc.roundedRect(x, y, w, boxH, 6).fill(C.paperWarm);
  doc.roundedRect(x, y, w, boxH, 6).lineWidth(0.5).strokeColor(C.border).stroke();

  doc.font('Helvetica').fontSize(10);
  summaryRows.forEach(([label, paise, credit], i) => {
    const ry = y + 10 + i * lineH;
    doc
      .fillColor(C.ink2)
      .text(label, x + 14, ry, { width: 80, align: 'left', lineBreak: false });
    doc
      .fillColor(credit ? C.success : C.ink1)
      .font(credit ? 'Helvetica-Bold' : 'Helvetica-Bold')
      .text(
        `${credit ? '-' : ''}${fmtRupees(Math.abs(paise))}`,
        x + 90,
        ry,
        { width: w - 90 - 14, align: 'right', lineBreak: false },
      );
  });

  // Emphasised TOTAL row.
  const totalY = y + 8 + summaryRows.length * lineH + 6;
  doc
    .moveTo(x + 12, totalY)
    .lineTo(x + w - 12, totalY)
    .lineWidth(0.8)
    .strokeColor(C.accent)
    .stroke();
  doc
    .fillColor(C.brandDeep)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('TOTAL', x + 14, totalY + 8, { width: 80, lineBreak: false });
  doc
    .fillColor(C.brandDeep)
    .font('Courier-Bold')
    .fontSize(14)
    .text(fmtRupees(rows.totalPaise), x + 90, totalY + 5, {
      width: w - 90 - 14,
      align: 'right',
      lineBreak: false,
    });

  return y + boxH + 18;
}

// ────────── Footer ──────────

/**
 * Slim brand-deep footer with brand line + page count. Should be the
 * last thing drawn (after bufferPages flush, see usage in caller).
 */
export function drawFooter(
  doc: PDFKit.PDFDocument,
  opts: { bookingRef?: string | null; agencyName?: string | null } = {},
): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const FOOTER_H = 36;
    const fy = PAGE.H - FOOTER_H;
    doc.rect(0, fy, PAGE.W, FOOTER_H).fill(C.brandDeep);
    doc.rect(0, fy, PAGE.W, 2).fill(C.accent);

    doc
      .fillColor(C.onBrandDeepMuted)
      .font('Helvetica')
      .fontSize(7.5)
      .text('TRIPBNG · Computer-generated, no signature required', PAGE.PAD_X, fy + 12, {
        width: PAGE.CONTENT_W / 2,
        lineBreak: false,
      });

    const rightLine = opts.bookingRef
      ? `${opts.bookingRef} · Page ${i + 1}/${range.count}`
      : `Page ${i + 1}/${range.count}`;
    doc
      .fillColor(C.onBrandDeepMuted)
      .font('Helvetica')
      .fontSize(7.5)
      .text(rightLine, PAGE.PAD_X + PAGE.CONTENT_W / 2, fy + 12, {
        width: PAGE.CONTENT_W / 2,
        align: 'right',
        lineBreak: false,
      });
  }
}

/** Diagonal "CANCELLED" watermark — red, semi-transparent. */
export function drawCancelledWatermark(doc: PDFKit.PDFDocument): void {
  doc
    .save()
    .rotate(-28, { origin: [PAGE.W / 2, PAGE.H / 2] })
    .font('Helvetica-Bold')
    .fontSize(96)
    .fillColor(C.danger)
    .opacity(0.18)
    .text('CANCELLED', 0, PAGE.H / 2 - 50, {
      width: PAGE.W,
      align: 'center',
      lineBreak: false,
    })
    .opacity(1)
    .restore();
}

/**
 * Diagonal "PAID" stamp — green, semi-transparent. Positioned roughly
 * mid-page on the right edge so it overlays the itinerary card area
 * (always present in invoices) without colliding with the bill-to
 * block above or the summary below.
 *
 * `atY` lets callers nudge the stamp into a known empty band.
 */
export function drawPaidStamp(doc: PDFKit.PDFDocument, atY = 420): void {
  const stampW = 110;
  const stampH = 50;
  const stampX = PAGE.W - PAGE.PAD_X - stampW - 6;
  doc
    .save()
    .rotate(-10, { origin: [stampX + stampW / 2, atY + stampH / 2] })
    .opacity(0.75)
    .roundedRect(stampX, atY, stampW, stampH, 6)
    .lineWidth(2.2)
    .strokeColor(C.success)
    .stroke()
    .fillColor(C.success)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('PAID', stampX, atY + 13, {
      width: stampW,
      align: 'center',
      lineBreak: false,
    })
    .opacity(1)
    .restore();
}

// ────────── People list (passengers / guests / applicants / travellers) ──────────

export interface PersonRow {
  title?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Secondary label, e.g. paxType, fareCategory, age, seatName. */
  meta?: string | null;
  /** Right-aligned ticket / seat / policy number in mono. */
  ref?: string | null;
}

/**
 * Render a people list — used by passenger / guest / applicant /
 * traveller blocks. Returns next y. Card-style rows with a mono index
 * on the left, name + meta in the middle, optional ref on the right.
 */
export function drawPeopleList(
  doc: PDFKit.PDFDocument,
  y: number,
  label: string,
  people: PersonRow[],
): number {
  const x = PAGE.PAD_X;
  const w = PAGE.CONTENT_W;
  eyebrow(doc, label, x, y, w);
  let cy = y + 16;
  for (let i = 0; i < people.length; i++) {
    const p = people[i]!;
    const rowH = 32;
    // Subtle warm row tint with hairline divider.
    doc.rect(x, cy, w, rowH).fill(C.paperWarm);
    doc
      .moveTo(x, cy + rowH)
      .lineTo(x + w, cy + rowH)
      .lineWidth(0.4)
      .strokeColor(C.divider)
      .stroke();

    // Index badge.
    doc.roundedRect(x + 10, cy + 7, 18, 18, 9).fill(C.brandDeep);
    doc
      .fillColor(C.onBrandDeep)
      .font('Courier-Bold')
      .fontSize(9)
      .text(String(i + 1).padStart(2, '0'), x + 10, cy + 11, {
        width: 18,
        align: 'center',
        lineBreak: false,
      });

    // Name.
    const name = [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim() || '—';
    doc
      .fillColor(C.ink1)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(name, x + 36, cy + 7, {
        width: w - 160,
        lineBreak: false,
        ellipsis: true,
      });
    if (p.meta) {
      doc
        .fillColor(C.ink3)
        .font('Helvetica')
        .fontSize(8.5)
        .text(p.meta, x + 36, cy + 19, {
          width: w - 160,
          lineBreak: false,
          ellipsis: true,
        });
    }

    // Right-aligned ref in mono.
    if (p.ref) {
      doc
        .fillColor(C.ink1)
        .font('Courier-Bold')
        .fontSize(10)
        .text(p.ref, x + w - 130, cy + 12, {
          width: 120,
          align: 'right',
          lineBreak: false,
        });
    }

    cy += rowH;
  }
  return cy + 12;
}

// ────────── Notes / fine-print block ──────────

export function drawNotesBlock(
  doc: PDFKit.PDFDocument,
  y: number,
  label: string,
  notes: string[],
): number {
  const x = PAGE.PAD_X;
  const w = PAGE.CONTENT_W;
  eyebrow(doc, label, x, y, w);
  let cy = y + 16;
  doc.font('Helvetica').fontSize(8.5).fillColor(C.ink3);
  for (const note of notes) {
    // Bullet dot.
    doc.circle(x + 4, cy + 4, 1.2).fillColor(C.accent).fill();
    doc.fillColor(C.ink3).text(note, x + 12, cy, { width: w - 14 });
    cy = doc.y + 4;
  }
  return cy + 6;
}
