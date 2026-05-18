/**
 * Render the premium e-ticket with synthetic data and write the PDF to disk
 * so we can eyeball the layout. No Mongo, no API server — just the renderer.
 *
 *   pnpm --filter @tripbng/api exec tsx src/scripts/ticket-render-smoke.ts
 *   open /tmp/tripbng-ticket-sample.pdf
 */
import { writeFileSync } from 'node:fs';
import { generateETicketPdf } from '../services/booking-pdf.js';
import type { BookingDoc } from '../models/Booking.js';

const fakeBooking = {
  _id: 'fake',
  tenantId: 'fake',
  bookingCode: 'TBNG300400164',
  pnr: 'HFQE9R',
  status: 'TICKETED',
  travelClass: 'ECONOMY',
  flowSubType: 'SERIES',
  fareName: 'SkyFlex',
  fareNameDescription: 'Refundable up to 24h before departure · Free date change',
  agencyName: 'Tankar Solutions Pvt Ltd',
  agencyCode: 'TANKAR-001',
  ticketedAt: new Date('2026-04-30T19:21:00+05:30'),
  createdAt: new Date('2026-04-30T19:21:00+05:30'),
  contact: { email: 'info@tripbng.com', mobile: '+91 8541 033 333' },
  gst: { number: '24AAGCT1234F1Z5', companyName: 'Tankar', address: 'Rajkot' },
  segments: [
    {
      flightNumber: '6E 2283',
      airline: { code: '6E', name: 'IndiGo' },
      origin: { code: 'HSR', name: 'Rajkot', terminal: '1' },
      destination: { code: 'BOM', name: 'Mumbai T2', terminal: '2' },
      departure: new Date('2026-05-03T13:45:00+05:30'),
      arrival: new Date('2026-05-03T14:55:00+05:30'),
      duration: 70,
      stopOver: 120,
    },
    {
      flightNumber: '6E 6802',
      airline: { code: '6E', name: 'IndiGo' },
      origin: { code: 'BOM', name: 'Mumbai T2', terminal: '2' },
      destination: { code: 'NAG', name: 'Nagpur (Dr Ambedkar Intl)', terminal: '1' },
      departure: new Date('2026-05-03T16:55:00+05:30'),
      arrival: new Date('2026-05-03T18:30:00+05:30'),
      duration: 95,
      stopOver: 0,
    },
  ],
  passengers: [
    {
      type: 'ADULT',
      title: 'Mr',
      firstName: 'Balvantbhai',
      lastName: 'Detroja',
      ticketNumber: '098-2284551234',
    },
    { type: 'ADULT', title: 'Mr', firstName: 'Rukesh', lastName: 'Kumar' },
  ],
  pricing: {
    baseFarePaise: 960800,
    taxesPaise: 442600,
    platformMarkupPaise: 2000,
    distributorMarkupPaise: 0,
    agencyMarkupPaise: 0,
    gstPaise: 360,
    agencyPayablePaise: 1405760,
  },
} as unknown as BookingDoc;

async function main() {
  const stream = await generateETicketPdf(fakeBooking, {
    banner: {
      title: 'Save 12% on hotels in Mumbai',
      href: 'https://partnerhub.tripbng.com/hotels',
      imageUrl: 'placeholder',
    },
  });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const out = Buffer.concat(chunks);
  const outPath = '/tmp/tripbng-ticket-sample.pdf';
  writeFileSync(outPath, out);
  console.warn(`✓ wrote ${out.length} bytes → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
