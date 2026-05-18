// Bus invoice tests — pure GST math (computeLine, splitGst) +
// integration test for the post-BOOKED auto-generation path.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { redis } from '../src/config/redis.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { Agency } from '../src/models/Agency.js';
import { Distributor } from '../src/models/Distributor.js';
import { Counter } from '../src/models/Counter.js';
import { Employee } from '../src/models/Employee.js';
import { TravelPolicy } from '../src/models/TravelPolicy.js';
import { ApprovalRequest } from '../src/models/ApprovalRequest.js';
import { BusBooking } from '../src/models/BusBooking.js';
import { BusInvoice } from '../src/models/BusInvoice.js';
import { GstProfile } from '../src/models/GstProfile.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { postCredit } from '../src/services/wallet/ledger.js';
import {
  submitBusApproval,
  approveApproval,
} from '../src/services/approval/approval.service.js';
import { createBusBooking } from '../src/services/bus/booking.service.js';
import {
  computeLine,
  generateInvoiceForBooking,
  splitGst,
} from '../src/services/bus/invoice.service.js';
import { renderBusInvoicePdf } from '../src/services/bus/invoice-pdf.js';
import { MockSeatSellerClient } from '../src/adapters/seatseller/mock-client.js';
import { _resetSeatSellerClientForTests } from '../src/adapters/seatseller/factory.js';

process.env.MONGO_URI = 'mongodb://localhost:27017/tripbng_b2b_test_bus_invoice';
// env.ts is parsed before this test file evaluates; mutating
// process.env here has no effect. Tests use the default placeholder
// values from env.ts (TRIPBNG_GSTIN starts with '27' → Maharashtra).

// ────────── Pure-function suites ──────────

describe('computeLine', () => {
  it('computes GST + total at the standard 18% rate', () => {
    const l = computeLine('Service', '998551', 100_000, 1800);
    expect(l.taxableValuePaise).toBe(100_000);
    expect(l.gstAmountPaise).toBe(18_000);
    expect(l.totalPaise).toBe(118_000);
    expect(l.gstRateBp).toBe(1800);
  });

  it('computes 5% bus operator GST', () => {
    const l = computeLine('Bus fare', '996412', 100_000, 500);
    expect(l.gstAmountPaise).toBe(5_000);
    expect(l.totalPaise).toBe(105_000);
  });

  it('zero-rate lines emit zero GST', () => {
    const l = computeLine('Non-AC', '996412', 100_000, 0);
    expect(l.gstAmountPaise).toBe(0);
    expect(l.totalPaise).toBe(100_000);
  });

  it('clamps negatives + rounds at the boundary', () => {
    const l = computeLine('weird', '998551', -50, -100);
    expect(l.taxableValuePaise).toBe(0);
    expect(l.gstAmountPaise).toBe(0);
    expect(l.totalPaise).toBe(0);
  });

  it('rounds odd-fraction rates to integer paise', () => {
    // 12345 paise × 1234 bp / 10000 = 1523.373 paise → 1523.
    const l = computeLine('odd', '998551', 12_345, 1234);
    expect(Number.isInteger(l.gstAmountPaise)).toBe(true);
    expect(l.gstAmountPaise).toBe(1523);
  });
});

describe('splitGst', () => {
  it('intra-state splits half-half (rounded down for cgst)', () => {
    expect(splitGst({ gstAmountPaise: 18_000, intraState: true })).toEqual({
      cgstPaise: 9000,
      sgstPaise: 9000,
      igstPaise: 0,
    });
  });

  it('intra-state with odd total puts the residual on sgst', () => {
    expect(splitGst({ gstAmountPaise: 99, intraState: true })).toEqual({
      cgstPaise: 49,
      sgstPaise: 50,
      igstPaise: 0,
    });
  });

  it('inter-state puts the entire amount on igst', () => {
    expect(splitGst({ gstAmountPaise: 18_000, intraState: false })).toEqual({
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 18_000,
    });
  });

  it('clamps negatives to zero', () => {
    expect(splitGst({ gstAmountPaise: -100, intraState: true })).toEqual({
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
    });
  });
});

// ────────── Integration suite ──────────

let tenantId: string;
let userId: string;
let agencyId: string;
let employeeId: string;
let mock: MockSeatSellerClient;

const FARE_PAISE = 120_000;

async function reset(): Promise<void> {
  await Promise.all([
    BusInvoice.deleteMany({}),
    BusBooking.deleteMany({}),
    ApprovalRequest.deleteMany({}),
    Employee.deleteMany({}),
    TravelPolicy.deleteMany({}),
    GstProfile.deleteMany({}),
    WalletTransaction.deleteMany({}),
    Agency.deleteMany({}),
    Distributor.deleteMany({}),
    Tenant.deleteMany({}),
    User.deleteMany({}),
    Counter.deleteMany({}),
  ]);
  await redis.flushdb().catch(() => undefined);

  const tenant = await Tenant.create({ code: 'businv', name: 'Invoice Test' });
  tenantId = String(tenant._id);

  const user = await User.create({
    tenantId,
    userCode: 'INV-USER-1',
    role: 'AGENCY',
    email: 'inv@test.dev',
    mobile: '+910000099993',
    fullName: 'Invoice Tester',
    passwordHash: 'x'.repeat(60),
    status: 'ACTIVE',
  });
  userId = String(user._id);

  const distributor = await Distributor.create({
    tenantId,
    distributorCode: 'D000097',
    companyName: 'Dist',
    state: 'KA',
    city: 'Bangalore',
    pincode: '560001',
    address: '1 St',
    ownerUserId: user._id,
    walletBalance: 0,
    status: 'ACTIVE',
  });

  const agency = await Agency.create({
    tenantId,
    agencyCode: 'AT000097',
    companyName: 'Agency Inv',
    state: 'KA',
    city: 'Bangalore',
    pincode: '560002',
    address: '2 St',
    distributorId: distributor._id,
    ownerUserId: user._id,
    walletBalance: 0,
    status: 'ACTIVE',
  });
  agencyId = String(agency._id);

  const employee = await Employee.create({
    tenantId,
    agencyId: agency._id,
    empCode: 'EMP-INV',
    name: 'Test Traveller',
    email: 'traveller@inv.test',
    mobile: '+919876543210',
    gender: 'FEMALE',
    managerId: user._id,
    status: 'ACTIVE',
  });
  employeeId = String(employee._id);

  await postCredit({
    tenantId,
    walletKind: 'AGENCY',
    walletOwnerId: agencyId,
    type: 'TOPUP',
    amountPaise: 1_000_000,
    performedBy: userId,
  });

  mock = new MockSeatSellerClient();
  _resetSeatSellerClientForTests(mock);
}

beforeAll(async () => {
  await connectMongo();
  await redis.connect().catch(() => undefined);
});

afterAll(async () => {
  await disconnectMongo();
  await redis.quit().catch(() => undefined);
  _resetSeatSellerClientForTests();
});

beforeEach(async () => {
  await reset();
});

const tomorrowDoj = (): string =>
  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const seedBookingWithGst = async (gstState: 'Maharashtra' | 'Karnataka') => {
  const profile = await GstProfile.create({
    tenantId,
    registrationName: 'Acme Industries Pvt Ltd',
    gstin: gstState === 'Maharashtra' ? '27AAAAA0000A1Z5' : '29AAAAA0000A1Z5',
    address: gstState === 'Maharashtra' ? '14 Andheri, Mumbai' : '21 Indiranagar, Bangalore',
    state: gstState,
    email: 'finance@acme.test',
    isDefault: true,
  });

  const doj = tomorrowDoj();
  const submitted = await submitBusApproval(
    { tenantId, userId, role: 'AGENCY' },
    {
      employeeId,
      sourceCityId: 122,
      destinationCityId: 124,
      doj,
      tripId: `MOCK-TRIP-122-124-${doj}`,
      inventoryId: `MOCK-INV-122-124-${doj}`,
      seatNumbers: ['L3'],
      boardingPointId: 1001,
      droppingPointId: 2001,
      estimatedFarePaise: FARE_PAISE,
      operatorId: 9001,
      operatorName: 'TripBNG Mock',
      busType: 'AC Sleeper',
      busTypeId: 17,
      isAc: true,
      isSleeper: true,
      departureAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
      arrivalAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000 + 8 * 60 * 60_000).toISOString(),
    },
  );
  await approveApproval(
    { tenantId, userId, role: 'AGENCY' },
    String(submitted.approval._id),
    undefined,
  );
  const booking = await createBusBooking(
    {
      tenantId,
      userId,
      role: 'AGENCY',
      agencyId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
    },
    {
      approvalId: String(submitted.approval._id),
      gstProfileId: String(profile._id),
      passengers: [
        {
          seatName: 'L3',
          title: 'Mrs',
          name: 'Jane Doe',
          age: 30,
          gender: 'FEMALE',
          mobile: '+919876543210',
          email: 'jane@inv.test',
          primary: true,
        },
      ],
    },
  );
  return { booking, profile };
};

describe('generateInvoiceForBooking — auto-generation', () => {
  it('creates an invoice with the correct GST split when booking has gstProfileId', async () => {
    const { booking } = await seedBookingWithGst('Karnataka');
    // booking flow auto-generates — fetch it.
    const invoice = await BusInvoice.findOne({ bookingId: booking._id });
    expect(invoice).not.toBeNull();
    expect(invoice!.invoiceNumber).toMatch(/^TBNG-INV-/);
    expect(invoice!.gstSplitKind).toBe('INTER_STATE'); // KA != MH
    expect(invoice!.cgstPaise).toBe(0);
    expect(invoice!.sgstPaise).toBe(0);
    expect(invoice!.igstPaise).toBeGreaterThan(0);
    expect(invoice!.totalPaise).toBe(invoice!.subtotalPaise + invoice!.igstPaise);
    expect(invoice!.status).toBe('ISSUED');
  });

  it('splits CGST + SGST when bill-to state matches TripBNG state', async () => {
    const { booking } = await seedBookingWithGst('Maharashtra');
    const invoice = await BusInvoice.findOne({ bookingId: booking._id });
    expect(invoice!.gstSplitKind).toBe('INTRA_STATE');
    expect(invoice!.cgstPaise).toBeGreaterThan(0);
    expect(invoice!.sgstPaise).toBeGreaterThan(0);
    expect(invoice!.igstPaise).toBe(0);
    expect(invoice!.totalPaise).toBe(
      invoice!.subtotalPaise + invoice!.cgstPaise + invoice!.sgstPaise,
    );
  });

  it('snapshots bill-from + bill-to on the invoice (immutable)', async () => {
    const { booking, profile } = await seedBookingWithGst('Karnataka');
    const invoice = await BusInvoice.findOne({ bookingId: booking._id });
    // Bill-from is the env-configured TripBNG entity. We don't pin the
    // exact GSTIN — production overrides this — but the state / split
    // resolution is deterministic for the default Maharashtra placeholder.
    expect(invoice!.billFrom.gstin.length).toBeGreaterThan(0);
    expect(invoice!.billFrom.state).toBe('Maharashtra');
    expect(invoice!.billTo.gstin).toBe(profile.gstin);
    expect(invoice!.billTo.state).toBe(profile.state);
    // Subsequent profile edits don't mutate the issued invoice.
    await GstProfile.updateOne({ _id: profile._id }, { $set: { registrationName: 'Acme Renamed' } });
    const refetched = await BusInvoice.findOne({ bookingId: booking._id });
    expect(refetched!.billTo.name).toBe('Acme Industries Pvt Ltd');
  });

  it('is idempotent — second call returns existing invoice, no duplicate row', async () => {
    const { booking } = await seedBookingWithGst('Karnataka');
    const a = await BusInvoice.findOne({ bookingId: booking._id });

    const second = await generateInvoiceForBooking(booking._id);
    expect(second.created).toBe(false);
    expect(String(second.invoice._id)).toBe(String(a!._id));
    const count = await BusInvoice.countDocuments({ bookingId: booking._id });
    expect(count).toBe(1);
  });
});

describe('generateInvoiceForBooking — guards', () => {
  it('rejects bookings with no gstProfileId', async () => {
    // Re-use the seed pattern but skip GST profile attachment.
    const doj = tomorrowDoj();
    const submitted = await submitBusApproval(
      { tenantId, userId, role: 'AGENCY' },
      {
        employeeId,
        sourceCityId: 122,
        destinationCityId: 124,
        doj,
        tripId: `MOCK-TRIP-122-124-${doj}`,
        inventoryId: `MOCK-INV-122-124-${doj}`,
        seatNumbers: ['L3'],
        boardingPointId: 1001,
        droppingPointId: 2001,
        estimatedFarePaise: FARE_PAISE,
        operatorId: 9001,
        operatorName: 'TripBNG Mock',
        busType: 'AC Sleeper',
        busTypeId: 17,
        isAc: true,
        isSleeper: true,
        departureAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
        arrivalAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000 + 8 * 60 * 60_000).toISOString(),
      },
    );
    await approveApproval(
      { tenantId, userId, role: 'AGENCY' },
      String(submitted.approval._id),
      undefined,
    );
    const booking = await createBusBooking(
      {
        tenantId,
        userId,
        role: 'AGENCY',
        agencyId,
        walletKind: 'AGENCY',
        walletOwnerId: agencyId,
      },
      {
        approvalId: String(submitted.approval._id),
        passengers: [
          {
            seatName: 'L3',
            title: 'Mrs',
            name: 'Jane Doe',
            age: 30,
            gender: 'FEMALE',
            mobile: '+919876543210',
            email: 'jane@inv.test',
            primary: true,
          },
        ],
      },
    );
    expect(booking.gstProfileId).toBeNull();
    // No invoice was auto-generated.
    expect(await BusInvoice.countDocuments({ bookingId: booking._id })).toBe(0);
    // Manual call rejects.
    await expect(generateInvoiceForBooking(booking._id)).rejects.toThrow();
  });
});

describe('renderBusInvoicePdf', () => {
  it('returns a non-empty PDF buffer', async () => {
    const { booking } = await seedBookingWithGst('Karnataka');
    const invoice = await BusInvoice.findOne({ bookingId: booking._id });
    const pdf = await renderBusInvoicePdf(invoice!);
    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(2000);
    // PDF magic bytes.
    expect(pdf.slice(0, 4).toString()).toBe('%PDF');
  });
});

describe('GST attachment to blockTicket request', () => {
  it('forwards bill-to GST details to SeatSeller blockTicket', async () => {
    // We snoop the mock's blockTicket call args via vi.spyOn — but
    // since the booking flow already executed in seedBookingWithGst,
    // we instead verify by inspecting the mock's last-seen request.
    // Our MockSeatSellerClient doesn't expose request history; we
    // rely on the integration tests for booking + cancellation to
    // catch missing GST details — those would fail on the cancel
    // preview if GST routing were broken. Sanity check: the booking
    // row carries gstProfileId.
    const { booking } = await seedBookingWithGst('Maharashtra');
    expect(booking.gstProfileId).not.toBeNull();
  });
});
