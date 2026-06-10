// Quick smoke harness — renders all 6 themed invoice PDFs to /tmp so
// we can visually inspect the new chrome. Not wired into the test
// suite (test suite covers correctness via buffer length + magic
// bytes); this is purely a developer aid.

import { renderBusInvoicePdf } from '../services/bus/invoice-pdf.js';
import { renderFlightInvoicePdf } from '../services/flight/invoice-pdf.js';
import {
  generateInvoicePdf,
  generateHotelInvoicePdf,
  generateHolidayInvoicePdf,
  generateVisaInvoicePdf,
} from '../services/booking-pdf.js';
import { writeFileSync, createWriteStream } from 'node:fs';
import { Types } from 'mongoose';

async function main() {
  const oid = new Types.ObjectId();

  const billFrom = {
    name: 'TripBng Travel Pvt Ltd',
    address: 'Andheri East, Mumbai, Maharashtra, India - 400099',
    gstin: '27AABCT1234A1Z5',
    state: 'Maharashtra',
    stateCode: 27,
  };
  const billTo = {
    name: 'Acme Travel Agency',
    address: 'MG Road, Bangalore, Karnataka, India - 560001',
    gstin: '29ABCDE1234F1Z2',
    state: 'Karnataka',
    stateCode: 29,
  };

  // Structured flight + bus invoices.
  const flightInvoice: any = {
    _id: oid,
    invoiceNumber: 'TBNG-FL-2026-000001',
    bookingId: oid,
    issueDate: new Date(),
    status: 'ISSUED',
    billFrom,
    billTo,
    lines: [
      {
        description: 'Air ticket BLR -> HYD (12 Jun 2026, 6E-1234)',
        hsnSacCode: '996425',
        taxableValuePaise: 450000,
        gstRateBp: 1800,
        gstAmountPaise: 81000,
        totalPaise: 531000,
      },
      {
        description: 'Convenience fee',
        hsnSacCode: '996425',
        taxableValuePaise: 5000,
        gstRateBp: 1800,
        gstAmountPaise: 900,
        totalPaise: 5900,
      },
    ],
    subtotalPaise: 455000,
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 81900,
    totalPaise: 536900,
    gstSplitKind: 'INTER_STATE',
  };
  const busInvoice: any = {
    ...flightInvoice,
    invoiceNumber: 'TBNG-BUS-2026-000001',
    gstSplitKind: 'INTRA_STATE',
    cgstPaise: 40950,
    sgstPaise: 40950,
    igstPaise: 0,
    totalPaise: 536900,
    billTo: { ...billTo, state: 'Maharashtra', stateCode: 27 },
  };

  // Legacy booking snapshot for the four booking-pdf invoices.
  const baseBooking: any = {
    _id: oid,
    bookingCode: 'TBNG-FL-2026-000001',
    status: 'TICKETED',
    paymentStatus: 'PAID',
    pnr: 'AB12CD',
    agencyName: 'Acme Travel Agency',
    agencyCode: 'AGY-001',
    sector: 'BLR -> HYD',
    travelDate: new Date('2026-06-12T00:00:00Z'),
    tripType: 'ONEWAY',
    travelClass: 'ECONOMY',
    createdAt: new Date(),
    ticketedAt: new Date(),
    segments: [
      {
        airline: { code: '6E', name: 'IndiGo' },
        flightNumber: '1234',
        origin: { code: 'BLR' },
        destination: { code: 'HYD' },
        departure: new Date('2026-06-12T06:00:00Z'),
        arrival: new Date('2026-06-12T07:25:00Z'),
        duration: 85,
        stopOver: 0,
      },
    ],
    passengers: [
      { type: 'ADULT', title: 'Mr', firstName: 'John', lastName: 'Doe', ticketNumber: '6E1234ABCD', fareCategory: 'REGULAR' },
      { type: 'ADULT', title: 'Ms', firstName: 'Jane', lastName: 'Doe', ticketNumber: '6E1234EFGH', fareCategory: 'REGULAR' },
    ],
    contact: { email: 'agent@acme.in', mobile: '9876543210', countryCode: '+91' },
    gst: { number: '29ABCDE1234F1Z2', companyName: 'Acme Travel Pvt Ltd', address: 'MG Road, Bangalore' },
    pricing: {
      baseFarePaise: 450000,
      taxesPaise: 32000,
      policyAdjustmentPaise: 0,
      platformMarkupPaise: 10000,
      distributorMarkupPaise: 0,
      agencyMarkupPaise: 5000,
      discountPaise: 1000,
      gstPaise: 81900,
      agencyPayablePaise: 577900,
    },
  };
  const hotelBooking: any = {
    _id: oid,
    bookingCode: 'TBNG-HTL-2026-000001',
    status: 'CONFIRMED',
    supplierRefs: { confirmationNo: 'HTL-99887766' },
    confirmedAt: new Date(),
    createdAt: new Date(),
    checkIn: new Date('2026-06-12T14:00:00Z'),
    checkOut: new Date('2026-06-15T11:00:00Z'),
    nights: 3,
    hotel: { name: 'The Park Hotel', address: 'Bangalore, Karnataka', starRating: 5 },
    rooms: [{ name: 'Deluxe Room', adults: 2, children: 0, mealPlan: 'Breakfast included' }],
    guests: [
      { title: 'Mr', firstName: 'John', lastName: 'Doe', isLeadPassenger: true },
      { title: 'Ms', firstName: 'Jane', lastName: 'Doe', isLeadPassenger: false },
    ],
    gst: { gstin: '29ABCDE1234F1Z2', companyName: 'Acme Travel Pvt Ltd', companyAddress: 'MG Road, Bangalore' },
    pricing: { perNightPaise: 800000, totalSellingPaise: 2832000 },
    taxBreakup: [{ taxType: 'GST', taxPercentage: 18, taxAmountPaise: 432000 }],
  };
  const holidayBooking: any = {
    _id: oid,
    bookingCode: 'TBNG-HOL-2026-000001',
    status: 'CONFIRMED',
    supplierRefs: { confirmationNo: 'HOL-554433' },
    confirmedAt: new Date(),
    createdAt: new Date(),
    packageTitle: 'Magical Bali · 5 Nights / 6 Days',
    destination: 'Bali, Indonesia',
    themeLabel: 'Beach Honeymoon',
    departureCity: 'Mumbai',
    departureDate: new Date('2026-06-12T00:00:00Z'),
    returnDate: new Date('2026-06-18T00:00:00Z'),
    nights: 5,
    sharingType: 'Double',
    adults: 2,
    childrenWithBed: 0,
    childrenWithoutBed: 0,
    travellers: [
      { title: 'Mr', firstName: 'John', lastName: 'Doe', paxType: 'ADULT' },
      { title: 'Ms', firstName: 'Jane', lastName: 'Doe', paxType: 'ADULT' },
    ],
    gst: { gstin: '29ABCDE1234F1Z2', companyName: 'Acme Travel Pvt Ltd', companyAddress: 'MG Road, Bangalore' },
    pricing: { perAdultPaise: 4500000, gstPaise: 450000, totalPaise: 9450000 },
  };
  const visaBooking: any = {
    _id: oid,
    bookingCode: 'TBNG-VISA-2026-000001',
    status: 'CONFIRMED',
    supplierRefs: { applicationNo: 'VFS-887766' },
    confirmedAt: new Date(),
    createdAt: new Date(),
    productName: 'Schengen Tourist Visa',
    countryName: 'France',
    purpose: 'tourism',
    processingMode: 'sticker',
    entryType: 'multi',
    stayDays: 30,
    validityDays: 90,
    processingDays: 15,
    urgent: false,
    expectedTravelDate: new Date('2026-08-01T00:00:00Z'),
    applicants: [
      { title: 'Mr', firstName: 'John', lastName: 'Doe', paxType: 'ADULT', nationality: 'IN' },
    ],
    gst: { gstin: '29ABCDE1234F1Z2', companyName: 'Acme Travel Pvt Ltd', companyAddress: 'MG Road, Bangalore' },
    pricing: { applicants: 1, consulateFeePaise: 800000, serviceFeePaise: 200000, urgentSurchargePaise: 0, gstPaise: 180000, totalPaise: 1180000 },
  };

  const pipeStream = async (stream: any, path: string) => {
    const out = createWriteStream(path);
    stream.pipe(out);
    await new Promise<void>((r) => out.on('finish', () => r()));
  };

  const flightPdf = await renderFlightInvoicePdf(flightInvoice);
  writeFileSync('/tmp/preview-flight-invoice-structured.pdf', flightPdf);
  const busPdf = await renderBusInvoicePdf(busInvoice);
  writeFileSync('/tmp/preview-bus-invoice-structured.pdf', busPdf);
  await pipeStream(generateInvoicePdf(baseBooking), '/tmp/preview-flight-invoice-legacy.pdf');
  await pipeStream(generateHotelInvoicePdf(hotelBooking), '/tmp/preview-hotel-invoice.pdf');
  await pipeStream(generateHolidayInvoicePdf(holidayBooking), '/tmp/preview-holiday-invoice.pdf');
  await pipeStream(generateVisaInvoicePdf(visaBooking), '/tmp/preview-visa-invoice.pdf');

  console.log('Generated all 6 themed invoice PDFs in /tmp/preview-*.pdf');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
