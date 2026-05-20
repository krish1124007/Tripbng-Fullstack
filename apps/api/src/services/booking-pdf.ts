// Premium e-Ticket PDF generator — editorial print + boarding-pass cues.
//
// Type pairing (pdfkit's built-in fonts only — no TTF embedding required):
//   - Times-Bold / Times-Italic     display headlines, editorial accents
//   - Helvetica / Helvetica-Bold    body, eyebrows, UI labels
//   - Courier-Bold                  mono codes (PNR, flight number, IATA, fares)
//
// Visual story:
//   1. Brand-deep header strip — vector logo, wordmark, hero PNR, booking ref.
//   2. Status pills row — Confirmed / Fare name / Date.
//   3. Journey hero — huge IATA codes + plane glyph timeline.
//   4. Segment cards — left accent rail, circular airline mark, time pair.
//   5. Layover stub between segments (warning band on terminal change).
//   6. Passenger roster — mono index, QR right-aligned, hairline dividers.
//   7. Receipt-style fare breakdown + traveller contact two-column block.
//   8. Essential info — 6 condensed items, vector bullet markers.
//   9. Sponsored banner card (collapses if no snapshot).
//   10. Slim brand-deep footer with brand line + page count.
//
// Helvetica's WinAnsi encoding has no ₹, ✈, ⚠ — we use ASCII alternatives
// throughout and draw symbols as vector primitives.

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { Readable } from 'node:stream';
import type { BookingDoc } from '../models/Booking.js';
import type { HotelBookingDoc } from '../models/HotelBooking.js';

const PAGE_W = 595;
const PAGE_H = 842;
const PAD_X = 40;
const CONTENT_W = PAGE_W - PAD_X * 2;

// Brand tokens (print-tuned).
const C = {
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
  border: '#E6E3D9',
  divider: '#EFECE2',
};

// ────────── Public API ──────────

export interface TicketBannerSnapshot {
  imageUrl?: string | null;
  href?: string | null;
  title?: string | null;
}

export async function generateETicketPdf(
  booking: BookingDoc,
  options: { banner?: TicketBannerSnapshot | null } = {},
): Promise<Readable> {
  // Pre-fetch QR codes (one per passenger) AND the banner image (when present)
  // before opening the PDF — the renderer is otherwise synchronous, and we
  // want the page-break math to know exactly how tall the banner block will be.
  const qrPngs: Buffer[] = await Promise.all(
    (booking.passengers ?? []).map((_, idx) =>
      QRCode.toBuffer(`tripbng://booking/${booking.bookingCode}/pax/${idx + 1}`, {
        margin: 0,
        width: 88,
        color: { dark: C.ink1, light: '#FFFFFF' },
      }),
    ),
  );
  const bannerImage = options.banner?.imageUrl
    ? await fetchBannerImage(options.banner.imageUrl)
    : null;

  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  const stream = doc as unknown as Readable;

  drawHeaderStrip(doc, booking);
  drawStatusRow(doc, booking);
  drawJourneyHero(doc, booking);
  drawSegments(doc, booking);
  drawPassengerRoster(doc, booking, qrPngs);
  drawFareBlock(doc, booking);
  drawEssentialInfo(doc, booking);
  drawBanner(doc, options.banner ?? null, bannerImage);
  drawFooter(doc, booking);
  drawCompactHeaderOnOverflowPages(doc, booking);

  doc.end();
  return stream;
}

/**
 * Best-effort image fetch with a short timeout. Returns null on any failure
 * (404, slow upstream, malformed) — the banner section degrades to the
 * text-only card so a broken image never breaks ticket generation.
 *
 * Only PNG/JPEG/WEBP are accepted (pdfkit's `doc.image` only handles PNG/JPEG;
 * WEBP gets rejected at decode time). Cache layer is the caller's job — this
 * runs once per ticket render which is fine at our current volume.
 */
async function fetchBannerImage(url: string): Promise<Buffer | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!/image\/(png|jpe?g)/i.test(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 5 * 1024 * 1024) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ────────── 1. Header strip ──────────

function drawHeaderStrip(doc: PDFKit.PDFDocument, booking: BookingDoc): void {
  const H = 96;
  // Two-tone deep band — a subtle gradient effect using stacked rects.
  doc.rect(0, 0, PAGE_W, H).fill(C.brandDeep);
  doc.rect(0, H - 8, PAGE_W, 8).fill(C.brandDeepEdge);

  // Decorative perforation row of accent dots, top-right.
  for (let i = 0; i < 12; i++) {
    doc.circle(PAGE_W - PAD_X - 6 - i * 12, 18, 1.2).fill(C.accent);
  }

  // Logo mark — accent square with white "TB" serif in italic.
  drawLogoMark(doc, PAD_X, 22, 30);

  // Wordmark.
  doc
    .fillColor(C.onBrandDeep)
    .font('Times-Bold')
    .fontSize(24)
    .text('tripbng', PAD_X + 42, 24, { lineBreak: false });
  doc
    .fillColor(C.accent)
    .font('Times-Bold')
    .fontSize(24)
    .text('.', PAD_X + 42 + doc.widthOfString('tripbng'), 24, { lineBreak: false });

  // Eyebrow caption under wordmark.
  doc
    .fillColor(C.onBrandDeepMuted)
    .font('Helvetica')
    .fontSize(7.5)
    .text('PARTNER HUB  ·  E-TICKET  ·  v1.0', PAD_X + 42, 54, {
      lineBreak: false,
      characterSpacing: 1.6,
    });

  // Right side — PNR hero + booking ref + issued.
  const rightBlockW = 220;
  const rx = PAGE_W - PAD_X - rightBlockW;
  doc
    .fillColor(C.onBrandDeepMuted)
    .font('Helvetica')
    .fontSize(7.5)
    .text('PASSENGER NAME RECORD', rx, 24, {
      width: rightBlockW,
      align: 'right',
      lineBreak: false,
      characterSpacing: 1.6,
    });
  doc
    .fillColor(C.onBrandDeep)
    .font('Courier-Bold')
    .fontSize(26)
    .text(booking.pnr ?? booking.bookingCode, rx, 36, {
      width: rightBlockW,
      align: 'right',
      lineBreak: false,
    });
  doc
    .fillColor(C.onBrandDeepMuted)
    .font('Helvetica')
    .fontSize(8)
    .text(`BOOKING ${booking.bookingCode}`, rx, 68, {
      width: rightBlockW,
      align: 'right',
      lineBreak: false,
      characterSpacing: 0.8,
    });
  doc
    .fillColor(C.onBrandDeepMuted)
    .fontSize(7.5)
    .text(`Issued ${fmtDateTime(booking.ticketedAt ?? booking.createdAt)}`, rx, 79, {
      width: rightBlockW,
      align: 'right',
      lineBreak: false,
    });

  // Bottom edge — accent hairline.
  doc.rect(0, H, PAGE_W, 1).fill(C.accent);

  doc.y = H + 4;
}

// Vector logo: accent square with white serif "TB" mark.
function drawLogoMark(doc: PDFKit.PDFDocument, x: number, y: number, size: number): void {
  doc.roundedRect(x, y, size, size, 4).fill(C.accent);
  doc
    .fillColor('#FFFFFF')
    .font('Times-Italic')
    .fontSize(size * 0.62)
    .text('tb', x, y + size * 0.18, { width: size, align: 'center', lineBreak: false });
}

// ────────── 2. Status row ──────────

function drawStatusRow(doc: PDFKit.PDFDocument, booking: BookingDoc): void {
  const Y = doc.y + 12;
  const H = 28;

  // Three pills in a row.
  let x = PAD_X;
  const drawPill = (
    label: string,
    value: string,
    bg: string,
    fg: string,
    valueFont = 'Helvetica-Bold',
  ): number => {
    const labelText = label;
    const valueText = value;
    doc.font('Helvetica').fontSize(7);
    const lw = doc.widthOfString(labelText) + 2;
    doc.font(valueFont).fontSize(10);
    const vw = doc.widthOfString(valueText);
    const pillW = lw + vw + 28;
    doc.roundedRect(x, Y, pillW, H, H / 2).fill(bg);
    doc
      .fillColor(fg)
      .font('Helvetica')
      .fontSize(7)
      .text(labelText, x + 14, Y + 7, { lineBreak: false, characterSpacing: 1.2 });
    doc
      .fillColor(fg)
      .font(valueFont)
      .fontSize(10)
      .text(valueText, x + 14 + lw + 6, Y + 8, { lineBreak: false });
    return pillW;
  };

  const status =
    booking.status === 'CONFIRMED' || booking.status === 'TICKETED'
      ? 'CONFIRMED'
      : (booking.status ?? 'BOOKED').toString();
  const statusColors =
    status === 'CONFIRMED' ? { bg: C.successSoft, fg: C.success } : { bg: C.paperTint, fg: C.ink2 };

  x += drawPill('STATUS', status, statusColors.bg, statusColors.fg) + 8;
  x += drawPill('FARE', booking.fareName ?? 'SkySaver', C.accentSoft, C.accentInk) + 8;
  const firstSeg = booking.segments?.[0];
  if (firstSeg?.departure) {
    x +=
      drawPill('TRAVEL', fmtDateShort(firstSeg.departure), C.paperTint, C.ink1, 'Helvetica-Bold') +
      8;
  }

  // Description tail (italic editorial accent), if present.
  if (booking.fareNameDescription) {
    doc
      .fillColor(C.ink3)
      .font('Times-Italic')
      .fontSize(9.5)
      .text(booking.fareNameDescription, x, Y + 9, {
        width: PAGE_W - PAD_X - x,
        lineBreak: false,
        ellipsis: true,
      });
  }

  doc.y = Y + H + 6;
}

// ────────── 3. Journey hero ──────────

function drawJourneyHero(doc: PDFKit.PDFDocument, booking: BookingDoc): void {
  const segments = booking.segments ?? [];
  if (segments.length === 0) return;
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const fromCode = first.origin?.code ?? '';
  const toCode = last.destination?.code ?? '';
  const fromCity = first.origin?.name ?? fromCode;
  const toCity = last.destination?.name ?? toCode;
  const totalMin = segments.reduce((s, x) => s + (x.duration ?? 0) + (x.stopOver ?? 0), 0);
  const stops = Math.max(0, segments.length - 1);

  const Y = doc.y + 12;
  // Big city codes — Times-Bold for editorial weight.
  doc
    .fillColor(C.ink1)
    .font('Times-Bold')
    .fontSize(40)
    .text(fromCode, PAD_X, Y, { lineBreak: false });
  doc
    .fillColor(C.ink1)
    .font('Times-Bold')
    .fontSize(40)
    .text(toCode, PAGE_W - PAD_X - 130, Y, { width: 130, align: 'right', lineBreak: false });

  // City names below codes.
  const cityY = Y + 44;
  doc
    .fillColor(C.ink3)
    .font('Helvetica')
    .fontSize(9.5)
    .text(fromCity, PAD_X, cityY, { width: 200, lineBreak: false });
  doc.text(toCity, PAGE_W - PAD_X - 200, cityY, {
    width: 200,
    align: 'right',
    lineBreak: false,
  });

  // Center timeline.
  const lineX1 = PAD_X + 130;
  const lineX2 = PAGE_W - PAD_X - 130;
  const lineY = Y + 24;
  doc.strokeColor(C.divider).lineWidth(1).moveTo(lineX1, lineY).lineTo(lineX2, lineY).stroke();
  // End caps.
  doc.circle(lineX1, lineY, 3.5).fill(C.accent);
  doc.circle(lineX2, lineY, 3.5).fill(C.accent);
  // Stop dots along the line for multi-segment.
  if (stops > 0) {
    const step = (lineX2 - lineX1) / (stops + 1);
    for (let i = 1; i <= stops; i++) {
      doc.circle(lineX1 + step * i, lineY, 2.5).fill(C.ink4);
    }
  }
  // Plane glyph centered (vector triangle) on a paper disc.
  const midX = (lineX1 + lineX2) / 2;
  doc.circle(midX, lineY, 9).fill(C.paper);
  doc.circle(midX, lineY, 9).strokeColor(C.accent).lineWidth(1).stroke();
  drawPlaneGlyph(doc, midX, lineY, 9, C.accent);

  // Above the timeline: total duration.
  doc
    .fillColor(C.ink2)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(fmtDuration(totalMin), lineX1, lineY - 14, {
      width: lineX2 - lineX1,
      align: 'center',
      characterSpacing: 1.4,
    });
  // Below the timeline: stops.
  doc
    .fillColor(C.ink3)
    .font('Helvetica')
    .fontSize(8)
    .text(stops === 0 ? 'NON-STOP' : `${stops} STOP${stops === 1 ? '' : 'S'}`, lineX1, lineY + 8, {
      width: lineX2 - lineX1,
      align: 'center',
      characterSpacing: 1.4,
    });

  doc.y = cityY + 12;
}

// Vector plane: small filled triangle pointing right.
function drawPlaneGlyph(
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const r = size * 0.55;
  doc.save();
  doc
    .moveTo(cx - r, cy - r * 0.4)
    .lineTo(cx + r, cy)
    .lineTo(cx - r, cy + r * 0.4)
    .lineTo(cx - r * 0.45, cy)
    .closePath()
    .fill(color);
  doc.restore();
}

// ────────── 4. Segments ──────────

function drawSegments(doc: PDFKit.PDFDocument, booking: BookingDoc): void {
  const segments = booking.segments ?? [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    drawSegmentCard(doc, s, booking);
    if (i < segments.length - 1) {
      const next = segments[i + 1]!;
      drawLayoverStub(doc, s, next);
    }
  }
}

function drawSegmentCard(
  doc: PDFKit.PDFDocument,
  s: NonNullable<BookingDoc['segments']>[number],
  booking: BookingDoc,
): void {
  ensureSpace(doc, 92);
  const Y = doc.y + 4;
  const H = 84;
  const airline = s.airline!;
  const origin = s.origin!;
  const destination = s.destination!;

  // Card bg.
  doc.roundedRect(PAD_X, Y, CONTENT_W, H, 6).fill(C.paperWarm);
  // Left accent rail (the boarding-pass stub edge).
  doc.rect(PAD_X, Y, 4, H).fill(C.accent);
  // Outline.
  doc.roundedRect(PAD_X, Y, CONTENT_W, H, 6).strokeColor(C.border).lineWidth(0.5).stroke();

  // Airline circle mark.
  const airlineCx = PAD_X + 32;
  const airlineCy = Y + 22;
  doc.circle(airlineCx, airlineCy, 12).fill(C.brandDeep);
  doc
    .fillColor(C.onBrandDeep)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(airline.code, airlineCx - 14, airlineCy - 4, {
      width: 28,
      align: 'center',
      lineBreak: false,
      characterSpacing: 0.6,
    });

  // Flight number + airline name, stacked.
  const rawFlight = (s.flightNumber ?? '').toString();
  const flightNum = rawFlight.toUpperCase().startsWith(airline.code.toUpperCase())
    ? rawFlight.slice(airline.code.length).trim()
    : rawFlight;
  // Flight number only — airline code is already in the circular mark.
  doc
    .fillColor(C.ink1)
    .font('Courier-Bold')
    .fontSize(12)
    .text(flightNum, PAD_X + 54, Y + 10, { lineBreak: false });
  doc
    .fillColor(C.ink3)
    .font('Helvetica')
    .fontSize(8)
    .text(airline.name ?? '', PAD_X + 54, Y + 24, { lineBreak: false, width: 220 });

  // Right side meta — cabin / fare / baggage.
  const cabin = `${booking.travelClass ?? 'ECONOMY'}  ·  ${booking.fareName ?? 'SkySaver'}`;
  doc
    .fillColor(C.ink2)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(cabin, PAGE_W - PAD_X - 240, Y + 10, {
      width: 224,
      align: 'right',
      lineBreak: false,
      characterSpacing: 0.6,
    });
  doc
    .fillColor(C.ink3)
    .font('Helvetica')
    .fontSize(7.5)
    .text('CHECK-IN 15 KG  ·  CABIN 7 KG', PAGE_W - PAD_X - 240, Y + 24, {
      width: 224,
      align: 'right',
      lineBreak: false,
      characterSpacing: 0.8,
    });

  // Bottom row: depart — duration — arrive.
  const blockY = Y + 42;
  doc
    .fillColor(C.ink1)
    .font('Times-Bold')
    .fontSize(20)
    .text(fmtTime(s.departure), PAD_X + 16, blockY, { lineBreak: false });
  doc
    .fillColor(C.ink2)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(
      `${origin.code}${origin.terminal ? ' · T' + origin.terminal : ''}`,
      PAD_X + 16,
      blockY + 22,
      {
        lineBreak: false,
        characterSpacing: 0.8,
      },
    );
  doc
    .fillColor(C.ink3)
    .font('Helvetica')
    .fontSize(7.5)
    .text(fmtDateLong(s.departure), PAD_X + 16, blockY + 32, { lineBreak: false });

  // Center duration + hairline.
  const cX1 = PAD_X + 200;
  const cX2 = PAGE_W - PAD_X - 200;
  const cY = blockY + 14;
  doc.strokeColor(C.divider).lineWidth(0.5).moveTo(cX1, cY).lineTo(cX2, cY).stroke();
  drawPlaneGlyph(doc, (cX1 + cX2) / 2, cY, 7, C.accent);
  doc
    .fillColor(C.ink3)
    .font('Helvetica')
    .fontSize(7.5)
    .text(fmtDuration(s.duration ?? 0), cX1, cY - 14, {
      width: cX2 - cX1,
      align: 'center',
      characterSpacing: 1.2,
    });
  doc
    .fillColor(C.ink3)
    .fontSize(7.5)
    .text('NON-STOP', cX1, cY + 8, {
      width: cX2 - cX1,
      align: 'center',
      characterSpacing: 1.4,
    });

  // Right time block.
  doc
    .fillColor(C.ink1)
    .font('Times-Bold')
    .fontSize(20)
    .text(fmtTime(s.arrival), PAGE_W - PAD_X - 110, blockY, {
      width: 94,
      align: 'right',
      lineBreak: false,
    });
  doc
    .fillColor(C.ink2)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(
      `${destination.code}${destination.terminal ? ' · T' + destination.terminal : ''}`,
      PAGE_W - PAD_X - 200,
      blockY + 22,
      { width: 184, align: 'right', lineBreak: false, characterSpacing: 0.8 },
    );
  doc
    .fillColor(C.ink3)
    .font('Helvetica')
    .fontSize(7.5)
    .text(fmtDateLong(s.arrival), PAGE_W - PAD_X - 200, blockY + 32, {
      width: 184,
      align: 'right',
      lineBreak: false,
    });

  doc.y = Y + H + 4;
}

function drawLayoverStub(
  doc: PDFKit.PDFDocument,
  prev: NonNullable<BookingDoc['segments']>[number],
  next: NonNullable<BookingDoc['segments']>[number],
): void {
  ensureSpace(doc, 28);
  const Y = doc.y + 2;
  const H = 22;
  const layoverMin = Math.max(
    0,
    Math.round((next.departure.getTime() - prev.arrival.getTime()) / 60000),
  );
  const at = prev.destination?.code ?? '';
  const terminalChange =
    !!prev.destination?.terminal &&
    !!next.origin?.terminal &&
    prev.destination.terminal !== next.origin.terminal;
  const bg = terminalChange ? C.warningSoft : C.paperTint;
  const fg = terminalChange ? C.warning : C.ink2;
  const inset = 80;

  doc.roundedRect(PAD_X + inset, Y, CONTENT_W - inset * 2, H, H / 2).fill(bg);
  doc
    .fillColor(fg)
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .text(
      terminalChange
        ? `LAYOVER  ${fmtDuration(layoverMin)}  AT  ${at}     (!) TERMINAL CHANGE`
        : `LAYOVER  ${fmtDuration(layoverMin)}  AT  ${at}`,
      PAD_X + inset,
      Y + 7,
      { width: CONTENT_W - inset * 2, align: 'center', characterSpacing: 1.6 },
    );
  doc.y = Y + H + 4;
}

// ────────── 5. Passenger roster ──────────

function drawPassengerRoster(doc: PDFKit.PDFDocument, booking: BookingDoc, qrPngs: Buffer[]): void {
  const passengers = booking.passengers ?? [];
  if (passengers.length === 0) return;
  ensureSpace(doc, 60);

  const sectionY = doc.y + 10;
  doc
    .fillColor(C.ink2)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('PASSENGERS', PAD_X, sectionY, { characterSpacing: 1.6 });
  // Right side — pax count.
  doc
    .fillColor(C.ink3)
    .font('Helvetica')
    .fontSize(8)
    .text(`${passengers.length} TRAVELLER${passengers.length === 1 ? '' : 'S'}`, PAD_X, sectionY, {
      width: CONTENT_W,
      align: 'right',
      characterSpacing: 1.4,
    });
  doc.y = sectionY + 14;

  for (let i = 0; i < passengers.length; i++) {
    const p = passengers[i]!;
    ensureSpace(doc, 50);
    const Y = doc.y;
    const H = 44;

    // Hairline divider top.
    if (i > 0)
      doc
        .strokeColor(C.divider)
        .lineWidth(0.5)
        .moveTo(PAD_X, Y)
        .lineTo(PAGE_W - PAD_X, Y)
        .stroke();

    // Mono index.
    doc
      .fillColor(C.ink4)
      .font('Courier-Bold')
      .fontSize(20)
      .text(String(i + 1).padStart(2, '0'), PAD_X, Y + 12, { lineBreak: false });

    // Name (display weight).
    const nameLine = `${p.title} ${p.firstName} ${p.lastName}`.trim().toUpperCase();
    doc
      .fillColor(C.ink1)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(nameLine, PAD_X + 38, Y + 13, {
        lineBreak: false,
        width: CONTENT_W - 140,
        characterSpacing: 0.5,
      });

    // Pax type pill + meta. Use IATA passenger-type codes (ADT/CHD/INF), not
    // a naive 3-char slice of "ADULT" / "CHILD" / "INFANT".
    const typePillX = PAD_X + 38;
    const typePillY = Y + 30;
    const typeText = paxTypeCode(p.type ?? 'ADULT');
    doc.font('Helvetica-Bold').fontSize(7);
    const pillW = doc.widthOfString(typeText) + 10;
    doc.roundedRect(typePillX, typePillY, pillW, 11, 5.5).fill(C.paperTint);
    doc
      .fillColor(C.ink2)
      .font('Helvetica-Bold')
      .fontSize(7)
      .text(typeText, typePillX, typePillY + 3, {
        width: pillW,
        align: 'center',
        lineBreak: false,
        characterSpacing: 0.8,
      });

    // Meta line — ticket, seat, meal.
    const meta = [
      p.ticketNumber ? `Ticket ${p.ticketNumber}` : 'Confirmed',
      p.seatNumber ? `Seat ${p.seatNumber}` : 'Seat at airport',
      p.mealPreference ? `Meal ${p.mealPreference}` : 'Meal —',
    ].join('   ·   ');
    doc
      .fillColor(C.ink3)
      .font('Helvetica')
      .fontSize(8)
      .text(meta, typePillX + pillW + 8, typePillY + 1, {
        width: CONTENT_W - 200,
        lineBreak: false,
        ellipsis: true,
      });

    // QR (right) — framed.
    if (qrPngs[i]) {
      doc
        .roundedRect(PAGE_W - PAD_X - 38, Y + 4, 38, 38, 3)
        .strokeColor(C.border)
        .lineWidth(0.5)
        .stroke();
      doc.image(qrPngs[i]!, PAGE_W - PAD_X - 35, Y + 7, { width: 32, height: 32 });
    }

    doc.y = Y + H;
  }

  // Closing hairline.
  doc
    .strokeColor(C.divider)
    .lineWidth(0.5)
    .moveTo(PAD_X, doc.y)
    .lineTo(PAGE_W - PAD_X, doc.y)
    .stroke();
  doc.y += 4;
}

// ────────── 6. Fare + Contact two-column ──────────

function drawFareBlock(doc: PDFKit.PDFDocument, booking: BookingDoc): void {
  ensureSpace(doc, 110);
  const Y = doc.y + 8;
  const H = 100;
  const colW = (CONTENT_W - 12) / 2;

  // Left card — fare breakdown.
  doc.roundedRect(PAD_X, Y, colW, H, 6).fill(C.paperWarm);
  doc.roundedRect(PAD_X, Y, colW, H, 6).strokeColor(C.border).lineWidth(0.5).stroke();
  doc
    .fillColor(C.ink2)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('FARE BREAKDOWN', PAD_X + 14, Y + 12, { characterSpacing: 1.6 });

  const rows: [string, number][] = [
    ['Base fare', booking.pricing?.baseFarePaise ?? 0],
    ['Taxes & airline fees', booking.pricing?.taxesPaise ?? 0],
    [
      'Service & markup',
      (booking.pricing?.platformMarkupPaise ?? 0) +
        (booking.pricing?.distributorMarkupPaise ?? 0) +
        (booking.pricing?.agencyMarkupPaise ?? 0),
    ],
    ['GST', booking.pricing?.gstPaise ?? 0],
  ];
  let rowY = Y + 28;
  doc.font('Helvetica').fontSize(8.5);
  for (const [label, value] of rows) {
    if (value === 0 && label !== 'Base fare') continue;
    doc.fillColor(C.ink3).text(label, PAD_X + 14, rowY, { lineBreak: false });
    doc
      .fillColor(C.ink1)
      .font('Courier-Bold')
      .fontSize(8.5)
      .text(rupees(value), PAD_X + 14, rowY, {
        width: colW - 28,
        align: 'right',
        lineBreak: false,
      });
    doc.font('Helvetica');
    rowY += 11;
  }
  // Hairline.
  doc
    .strokeColor(C.divider)
    .lineWidth(0.5)
    .moveTo(PAD_X + 14, Y + H - 32)
    .lineTo(PAD_X + colW - 14, Y + H - 32)
    .stroke();
  // Total — display weight.
  doc
    .fillColor(C.ink2)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('TOTAL PAYABLE', PAD_X + 14, Y + H - 24, { characterSpacing: 1.4, lineBreak: false });
  doc
    .fillColor(C.accent)
    .font('Times-Bold')
    .fontSize(15)
    .text(rupees(booking.pricing?.agencyPayablePaise ?? 0), PAD_X + 14, Y + H - 26, {
      width: colW - 28,
      align: 'right',
      lineBreak: false,
    });
  doc
    .fillColor(C.ink4)
    .font('Times-Italic')
    .fontSize(7.5)
    .text('Inclusive of all taxes and fees.', PAD_X + 14, Y + H - 11, {
      width: colW - 28,
      align: 'right',
      lineBreak: false,
    });

  // Right card — contact + issued by.
  const rx = PAD_X + colW + 12;
  doc.roundedRect(rx, Y, colW, H, 6).strokeColor(C.border).lineWidth(0.5).stroke();
  doc
    .fillColor(C.ink2)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('TRAVELLER CONTACT', rx + 14, Y + 12, { characterSpacing: 1.6 });
  doc
    .fillColor(C.ink1)
    .font('Helvetica')
    .fontSize(9.5)
    .text(booking.contact?.email ?? '—', rx + 14, Y + 28);
  doc
    .fillColor(C.ink1)
    .font('Courier-Bold')
    .fontSize(9.5)
    .text(booking.contact?.mobile ?? '—', rx + 14, Y + 41);

  // Hairline mid.
  doc
    .strokeColor(C.divider)
    .lineWidth(0.5)
    .moveTo(rx + 14, Y + 60)
    .lineTo(rx + colW - 14, Y + 60)
    .stroke();

  doc
    .fillColor(C.ink2)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('ISSUED BY', rx + 14, Y + 70, { characterSpacing: 1.6 });
  doc
    .fillColor(C.ink1)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(booking.agencyName, rx + 14, Y + 84);
  doc
    .fillColor(C.ink3)
    .font('Helvetica')
    .fontSize(8)
    .text(booking.agencyCode, rx + 14, Y + 97);
  if (booking.gst?.number) {
    doc
      .fillColor(C.ink3)
      .font('Courier-Bold')
      .fontSize(7.5)
      .text(`GSTIN ${booking.gst.number}`, rx + 14, Y + 97, {
        width: colW - 28,
        align: 'right',
        lineBreak: false,
      });
  }

  doc.y = Y + H + 4;
}

// ────────── 7. Essential information ──────────

function drawEssentialInfo(doc: PDFKit.PDFDocument, booking: BookingDoc): void {
  ensureSpace(doc, 76);
  const Y = doc.y + 6;
  doc
    .fillColor(C.ink2)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('ESSENTIAL INFORMATION', PAD_X, Y, { characterSpacing: 1.6 });

  const items = [
    'Carry valid government photo ID at check-in.',
    'Domestic check-in opens 3h before, closes 60 min prior. International: 4h / 75 min.',
    'Schedule subject to airline change — reconfirm 24h prior to travel.',
    booking.flowSubType === 'SERIES'
      ? 'Group / series fares are non-refundable unless explicitly stated.'
      : 'Refunds and changes follow the supplier fare rule on this booking.',
    'For infants, a valid birth certificate is required at check-in.',
    'Contact your agency immediately for any flight delay or cancellation.',
  ];

  let y = Y + 12;
  for (const item of items) {
    // Bullet — small accent square.
    doc.rect(PAD_X, y + 3, 3, 3).fill(C.accent);
    doc
      .fillColor(C.ink2)
      .font('Helvetica')
      .fontSize(8)
      .text(item, PAD_X + 10, y, { width: CONTENT_W - 10, lineBreak: true });
    y = doc.y + 1;
  }
  doc.y = y + 2;
}

// ────────── 8. Banner ──────────

function drawBanner(
  doc: PDFKit.PDFDocument,
  banner: TicketBannerSnapshot | null,
  imageBuf: Buffer | null,
): void {
  if (!banner || !banner.imageUrl) return;

  // Two render modes:
  //   - With image (preferred): full-bleed banner image at the spec's 4:1
  //     aspect, click-through wrapped in `doc.link`.
  //   - Without image (fetch failed / not embeddable): the editorial card
  //     fallback we shipped first — accent ribbon + title + URL.

  if (imageBuf) {
    ensureSpace(doc, 60);
    const Y = doc.y + 6;
    // Spec §3.5: aspect ~4:1 ideal, full content width (~180mm).
    const W = CONTENT_W;
    const H = Math.round(W / 4);
    ensureSpace(doc, H + 8);
    const yStart = doc.y + 4;
    // Tiny outer hairline for contrast against white page.
    doc.roundedRect(PAD_X, yStart, W, H, 6).strokeColor(C.border).lineWidth(0.5).stroke();
    // pdfkit's `cover` keeps aspect by cropping. The admin uploader validates
    // ratio between 3:1 and 5:1, so cropping is minimal.
    try {
      doc.save();
      doc.roundedRect(PAD_X, yStart, W, H, 6).clip();
      doc.image(imageBuf, PAD_X, yStart, { width: W, height: H, cover: [W, H] });
      doc.restore();
    } catch {
      // pdfkit refuses non-PNG/JPEG silently — fall through to text fallback.
      drawBannerFallback(doc, banner, yStart);
      return;
    }
    // SPONSORED eyebrow chip overlaid bottom-left.
    doc.roundedRect(PAD_X + 8, yStart + H - 16, 84, 12, 6).fill(C.brandDeep);
    doc
      .fillColor(C.accent)
      .font('Helvetica-Bold')
      .fontSize(6)
      .text('SPONSORED', PAD_X + 8, yStart + H - 12, {
        width: 84,
        align: 'center',
        lineBreak: false,
        characterSpacing: 1.4,
      });
    if (banner.href) doc.link(PAD_X, yStart, W, H, banner.href);
    doc.y = yStart + H + 4;
    return;
  }

  drawBannerFallback(doc, banner);
}

/** Editorial card fallback when no image is available. Same look as v1.0. */
function drawBannerFallback(
  doc: PDFKit.PDFDocument,
  banner: TicketBannerSnapshot,
  forcedY?: number,
): void {
  ensureSpace(doc, 56);
  const Y = forcedY ?? doc.y + 6;
  const H = 46;
  doc.roundedRect(PAD_X, Y, CONTENT_W, H, 8).fill(C.brandDeep);
  doc.rect(PAD_X, Y, 4, H).fill(C.accent);
  doc
    .polygon([PAGE_W - PAD_X - 60, Y], [PAGE_W - PAD_X, Y], [PAGE_W - PAD_X, Y + 18])
    .fill(C.accent);
  doc
    .fillColor(C.accent)
    .font('Helvetica-Bold')
    .fontSize(6.5)
    .text('SPONSORED  ·  PARTNER OFFER', PAD_X + 14, Y + 8, {
      lineBreak: false,
      characterSpacing: 1.6,
    });
  doc
    .fillColor(C.onBrandDeep)
    .font('Times-Bold')
    .fontSize(13)
    .text(banner.title ?? 'Featured offer', PAD_X + 14, Y + 18, {
      lineBreak: false,
      width: CONTENT_W - 100,
      ellipsis: true,
    });
  if (banner.href) {
    doc
      .fillColor(C.onBrandDeepMuted)
      .font('Courier-Bold')
      .fontSize(7.5)
      .text(banner.href, PAD_X + 14, Y + 34, {
        lineBreak: false,
        width: CONTENT_W - 32,
        ellipsis: true,
      });
    doc.link(PAD_X, Y, CONTENT_W, H, banner.href);
  }
  doc.y = Y + H + 4;
}

// ────────── 9. Footer ──────────

function drawFooter(doc: PDFKit.PDFDocument, booking: BookingDoc): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const H = 24;
    const Y = PAGE_H - H;
    doc.rect(0, Y, PAGE_W, H).fill(C.brandDeep);
    // Accent dot row.
    for (let k = 0; k < 5; k++) {
      doc.circle(PAD_X + 100 + k * 10, Y + 7, 1).fill(C.accent);
    }
    doc
      .fillColor(C.onBrandDeepMuted)
      .font('Helvetica')
      .fontSize(7)
      .text(
        `${booking.agencyName}  ·  partnerhub.tripbng.com  ·  ${booking.contact?.mobile ?? ''}`,
        PAD_X,
        Y + 9,
        { width: CONTENT_W, align: 'left', lineBreak: false },
      );
    doc
      .fillColor(C.onBrandDeepMuted)
      .font('Courier-Bold')
      .fontSize(7)
      .text(
        `Page ${i + 1}/${range.count}  ·  ${fmtDateShort(new Date()).toUpperCase()}  ·  v1.0`,
        PAD_X,
        Y + 9,
        { width: CONTENT_W, align: 'right', lineBreak: false },
      );
  }
}

/**
 * Compact header strip drawn on overflow pages (page 2+). Re-renders just
 * enough context — brand + PNR — so a printed page 2 can stand on its own
 * if it gets separated from page 1 (common in agency print + hand-off
 * workflows). Spec §3.5: "Repeat header-strip + PNR on page 2 (compact mode)."
 */
function drawCompactHeaderOnOverflowPages(
  doc: PDFKit.PDFDocument,
  booking: BookingDoc,
): void {
  const range = doc.bufferedPageRange();
  if (range.count <= 1) return; // single-page tickets don't need it
  const H = 28;
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(i);
    // Slim brand-deep band hugging the top of the page.
    doc.rect(0, 0, PAGE_W, H).fill(C.brandDeep);
    doc.rect(0, H, PAGE_W, 1).fill(C.accent);
    // Mini logo + wordmark left.
    drawLogoMark(doc, PAD_X, 6, 16);
    doc
      .fillColor(C.onBrandDeep)
      .font('Times-Bold')
      .fontSize(13)
      .text('tripbng', PAD_X + 22, 8, { lineBreak: false });
    doc
      .fillColor(C.accent)
      .font('Times-Bold')
      .fontSize(13)
      .text('.', PAD_X + 22 + doc.widthOfString('tripbng'), 8, { lineBreak: false });
    // PNR + booking ref right.
    doc
      .fillColor(C.onBrandDeepMuted)
      .font('Helvetica')
      .fontSize(6.5)
      .text('PNR', PAGE_W - PAD_X - 200, 8, {
        width: 200,
        align: 'right',
        lineBreak: false,
        characterSpacing: 1.4,
      });
    doc
      .fillColor(C.onBrandDeep)
      .font('Courier-Bold')
      .fontSize(13)
      .text(booking.pnr ?? booking.bookingCode, PAGE_W - PAD_X - 200, 6, {
        width: 200,
        align: 'right',
        lineBreak: false,
      });
    doc
      .fillColor(C.onBrandDeepMuted)
      .font('Helvetica')
      .fontSize(6.5)
      .text(`BOOKING ${booking.bookingCode}`, PAGE_W - PAD_X - 200, 20, {
        width: 200,
        align: 'right',
        lineBreak: false,
        characterSpacing: 0.6,
      });
  }
}

// ────────── Helpers ──────────

function ensureSpace(doc: PDFKit.PDFDocument, neededPt: number): void {
  const limit = PAGE_H - 36; // reserve room for the footer band
  if (doc.y + neededPt > limit) {
    doc.addPage();
    // Leave room for the compact header on overflow pages.
    doc.y = 36;
  }
}

function rupees(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateTime(d: Date): string {
  return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtDateShort(d: Date): string {
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtDateLong(d: Date): string {
  return new Date(d).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtTime(d: Date): string {
  return new Date(d).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** IATA passenger-type code (ADT/CHD/INF) from our internal pax type. */
function paxTypeCode(type: string): string {
  switch (type.toUpperCase()) {
    case 'CHILD':
      return 'CHD';
    case 'INFANT':
      return 'INF';
    case 'ADULT':
    default:
      return 'ADT';
  }
}

// ────────── Invoice (kept from prior version, unchanged) ──────────

export function generateInvoicePdf(booking: BookingDoc): Readable {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const stream = doc as unknown as Readable;

  doc.fontSize(20).fillColor(C.ink1).text('Tax Invoice', 48, 48);
  doc.fontSize(10).fillColor(C.ink3).text('Computer-generated, no signature required', 48, 72);

  doc.moveDown(1.2);
  doc.fillColor(C.ink1).fontSize(11).text(`Invoice for ${booking.bookingCode}`, 48);
  doc.fontSize(10).fillColor(C.ink3);
  doc.text(`Issued: ${fmtDateTime(booking.ticketedAt ?? booking.createdAt)}`);
  doc.text(`Booking PNR: ${booking.pnr ?? '—'}`);

  doc.moveDown(0.8);
  doc.fillColor(C.ink2).fontSize(10).text('BILLED TO');
  doc.moveDown(0.2);
  doc.fillColor(C.ink1).fontSize(10).text(booking.agencyName);
  doc.fillColor(C.ink3).fontSize(9).text(booking.agencyCode);

  if (booking.gst?.number) {
    doc.moveDown(0.4);
    doc.fillColor(C.ink2).fontSize(10).text('GST DETAILS');
    doc.fillColor(C.ink1).fontSize(10).text(`GSTIN: ${booking.gst.number}`);
    doc.text(`Company: ${booking.gst.companyName}`);
    doc.text(`Address: ${booking.gst.address}`);
  }

  doc.moveDown(0.8);
  doc.strokeColor(C.border).lineWidth(0.5).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.6);

  doc.fillColor(C.ink2).fontSize(10).text('SUMMARY');
  doc.moveDown(0.3);
  doc.fillColor(C.ink1).fontSize(10);
  const rows: [string, number][] = [
    ['Base fare', booking.pricing?.baseFarePaise ?? 0],
    ['Taxes (supplier)', booking.pricing?.taxesPaise ?? 0],
    ['Policy adjustment', booking.pricing?.policyAdjustmentPaise ?? 0],
    ['Platform markup', booking.pricing?.platformMarkupPaise ?? 0],
    ['Distributor markup', booking.pricing?.distributorMarkupPaise ?? 0],
    ['Agency markup', booking.pricing?.agencyMarkupPaise ?? 0],
    ['Discount', -(booking.pricing?.discountPaise ?? 0)],
    ['GST', booking.pricing?.gstPaise ?? 0],
  ];
  for (const [label, value] of rows) {
    if (value === 0) continue;
    doc.text(label, 48, doc.y, { continued: true });
    doc.text(rupees(Math.abs(value)) + (value < 0 ? ' (cr)' : ''), { align: 'right' });
  }

  doc.moveDown(0.4);
  doc.strokeColor(C.border).lineWidth(0.5).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.4);

  doc.fontSize(13).fillColor(C.ink1).text('Total payable', 48, doc.y, { continued: true });
  doc.text(rupees(booking.pricing?.agencyPayablePaise ?? 0), { align: 'right' });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc
      .fillColor(C.ink3)
      .fontSize(8)
      .text(`Page ${i + 1} of ${range.count} · TripBng`, 48, 800, { align: 'center', width: 499 });
  }
  doc.end();
  return stream;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hotel invoice PDF — mirrors generateInvoicePdf() above but reads from
// HotelBookingDoc. Pdfkit-based, no Chromium. Mock supplier owns the
// voucher so we issue the invoice off the booking row directly; once
// a real HotelInvoice model lands (with sequential GST numbers etc.),
// this falls back the same way the flight invoice route does.
// ─────────────────────────────────────────────────────────────────────────────

export function generateHotelInvoicePdf(booking: HotelBookingDoc): Readable {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const stream = doc as unknown as Readable;

  doc.fontSize(20).fillColor(C.ink1).text('Tax Invoice — Hotel', 48, 48);
  doc.fontSize(10).fillColor(C.ink3).text('Computer-generated, no signature required', 48, 72);

  doc.moveDown(1.2);
  const code = booking.bookingCode ?? String(booking._id);
  doc.fillColor(C.ink1).fontSize(11).text(`Invoice for ${code}`, 48);
  doc.fontSize(10).fillColor(C.ink3);
  doc.text(`Issued: ${fmtDateTime(booking.vouchredAt ?? booking.confirmedAt ?? booking.createdAt)}`);
  doc.text(`Confirmation: ${booking.supplierRefs?.confirmationNo ?? '—'}`);

  doc.moveDown(0.6);
  doc.fillColor(C.ink2).fontSize(10).text('PROPERTY');
  doc.moveDown(0.2);
  doc.fillColor(C.ink1).fontSize(10).text(booking.hotel?.name ?? '—');
  doc.fillColor(C.ink3).fontSize(9).text(booking.hotel?.address ?? '');
  if (booking.hotel?.starRating) {
    doc.text(`${booking.hotel.starRating}-star`);
  }

  doc.moveDown(0.6);
  doc.fillColor(C.ink2).fontSize(10).text('STAY');
  doc.moveDown(0.2);
  doc.fillColor(C.ink1).fontSize(10);
  doc.text(`Check-in:  ${fmtDateTime(booking.checkIn)}`);
  doc.text(`Check-out: ${fmtDateTime(booking.checkOut)}`);
  doc.text(`Nights:    ${booking.nights}`);
  if ((booking.rooms ?? []).length > 0) {
    const r0 = booking.rooms[0]!;
    doc.text(
      `Room:      ${r0.name ?? 'Standard'} · ${r0.adults} adult${r0.adults === 1 ? '' : 's'}${
        (r0.children ?? 0) > 0 ? ` + ${r0.children} child` : ''
      }${r0.mealPlan ? ` · ${r0.mealPlan}` : ''}`,
    );
  }

  if ((booking.guests ?? []).length > 0) {
    doc.moveDown(0.6);
    doc.fillColor(C.ink2).fontSize(10).text('GUESTS');
    doc.moveDown(0.2);
    doc.fillColor(C.ink1).fontSize(10);
    for (const g of booking.guests ?? []) {
      doc.text(`${g.title ?? ''} ${g.firstName ?? ''} ${g.lastName ?? ''}`.trim());
    }
  }

  if (booking.gst?.gstin) {
    doc.moveDown(0.6);
    doc.fillColor(C.ink2).fontSize(10).text('GST DETAILS');
    doc.fillColor(C.ink1).fontSize(10).text(`GSTIN: ${booking.gst.gstin}`);
    if (booking.gst.companyName) doc.text(`Company: ${booking.gst.companyName}`);
    if (booking.gst.companyAddress) doc.text(`Address: ${booking.gst.companyAddress}`);
  }

  doc.moveDown(0.8);
  doc.strokeColor(C.border).lineWidth(0.5).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.6);

  doc.fillColor(C.ink2).fontSize(10).text('SUMMARY');
  doc.moveDown(0.3);
  doc.fillColor(C.ink1).fontSize(10);
  const perNight = booking.pricing?.perNightPaise ?? 0;
  const nights = booking.nights;
  const totalSelling = booking.pricing?.totalSellingPaise ?? 0;
  const rows: [string, number][] = [
    [`Room rate × ${nights} night${nights === 1 ? '' : 's'}`, perNight * nights],
  ];
  for (const t of booking.taxBreakup ?? []) {
    if (t.taxAmountPaise > 0) {
      rows.push([
        `${t.taxType}${t.taxPercentage ? ` @ ${t.taxPercentage}%` : ''}`,
        t.taxAmountPaise,
      ]);
    }
  }
  for (const [label, value] of rows) {
    if (value === 0) continue;
    doc.text(label, 48, doc.y, { continued: true });
    doc.text(rupees(value), { align: 'right' });
  }

  doc.moveDown(0.4);
  doc.strokeColor(C.border).lineWidth(0.5).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.4);

  doc.fontSize(13).fillColor(C.ink1).text('Total payable', 48, doc.y, { continued: true });
  doc.text(rupees(totalSelling), { align: 'right' });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc
      .fillColor(C.ink3)
      .fontSize(8)
      .text(`Page ${i + 1} of ${range.count} · TripBng`, 48, 800, { align: 'center', width: 499 });
  }
  doc.end();
  return stream;
}
