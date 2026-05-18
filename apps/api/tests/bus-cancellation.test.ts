// Bus cancellation tests — preview, user cancel (full + partial),
// operator-side cancel via processOperatorCancellation.
//
// Reuses the same test DB scaffolding as bus-booking-flow.test.ts.

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
import { BusCancellation } from '../src/models/BusCancellation.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { postCredit } from '../src/services/wallet/ledger.js';
import {
  submitBusApproval,
  approveApproval,
} from '../src/services/approval/approval.service.js';
import { createBusBooking } from '../src/services/bus/booking.service.js';
import {
  cancelBooking,
  previewCancellation,
  processOperatorCancellation,
} from '../src/services/bus/cancellation.service.js';
import { MockSeatSellerClient } from '../src/adapters/seatseller/mock-client.js';
import { _resetSeatSellerClientForTests } from '../src/adapters/seatseller/factory.js';

process.env.MONGO_URI = 'mongodb://localhost:27017/tripbng_b2b_test_bus_cancel';

let tenantId: string;
let userId: string;
let agencyId: string;
let employeeId: string;
let mock: MockSeatSellerClient;

const FARE_PAISE = 120_000; // ₹1,200 — matches the mock seat L3 fare

const reasonOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    throw new Error('expected rejection');
  } catch (err) {
    return (
      (err as { details?: { reason?: string }; message?: string }).details?.reason
      ?? (err as Error).message
      ?? ''
    );
  }
};

async function reset(): Promise<void> {
  await Promise.all([
    BusCancellation.deleteMany({}),
    BusBooking.deleteMany({}),
    ApprovalRequest.deleteMany({}),
    Employee.deleteMany({}),
    TravelPolicy.deleteMany({}),
    WalletTransaction.deleteMany({}),
    Agency.deleteMany({}),
    Distributor.deleteMany({}),
    Tenant.deleteMany({}),
    User.deleteMany({}),
    Counter.deleteMany({}),
  ]);
  await redis.flushdb().catch(() => undefined);

  const tenant = await Tenant.create({ code: 'busc', name: 'Cancel Test' });
  tenantId = String(tenant._id);

  const user = await User.create({
    tenantId,
    userCode: 'CANCEL-1',
    role: 'AGENCY',
    email: 'cancel@test.dev',
    mobile: '+910000099992',
    fullName: 'Cancel Tester',
    passwordHash: 'x'.repeat(60),
    status: 'ACTIVE',
  });
  userId = String(user._id);

  const distributor = await Distributor.create({
    tenantId,
    distributorCode: 'D000098',
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
    agencyCode: 'AT000098',
    companyName: 'Agency Cancel',
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
    empCode: 'EMP-CANCEL',
    name: 'Cancel Test Traveller',
    email: 'traveller@cancel.test',
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

// ────────── Helpers ──────────

const tomorrowDoj = (): string =>
  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const seedBookedBooking = async (seats: string[] = ['L3']) => {
  const doj = tomorrowDoj();
  const tripId = `MOCK-TRIP-122-124-${doj}`;
  const inventoryId = `MOCK-INV-122-124-${doj}`;
  const submitted = await submitBusApproval(
    { tenantId, userId, role: 'AGENCY' },
    {
      employeeId,
      sourceCityId: 122,
      destinationCityId: 124,
      doj,
      tripId,
      inventoryId,
      seatNumbers: seats,
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
      passengers: seats.map((seatName, i) => ({
        seatName,
        title: 'Mrs' as const,
        name: `Traveller ${i + 1}`,
        age: 30,
        gender: 'FEMALE' as const,
        mobile: '+919876543210',
        email: `traveller${i + 1}@cancel.test`,
        primary: i === 0,
      })),
    },
  );
  return booking;
};

const cancelActor = () => ({
  tenantId,
  userId,
  role: 'AGENCY',
  agencyId,
  ipAddress: '127.0.0.1',
});

// ────────── Tests — preview ──────────

describe('previewCancellation', () => {
  it('returns the live SeatSeller preview with paise figures', async () => {
    const booking = await seedBookedBooking();
    const preview = await previewCancellation(cancelActor(), String(booking._id));

    expect(preview.bookingId).toBe(String(booking._id));
    expect(preview.bookingRef).toMatch(/^TBNG-BUS-/);
    expect(preview.seats).toHaveLength(1);
    expect(preview.seats[0]!.seatName).toBe('L3');
    // Mock charges 10% of 1200 = ₹120 = 12000 paise; refund = 1080 INR = 108000 paise.
    expect(preview.totalChargePaise).toBe(12_000);
    expect(preview.totalRefundPaise).toBe(108_000);
  });

  it('rejects when booking belongs to another tenant', async () => {
    const booking = await seedBookedBooking();
    const otherActor = { ...cancelActor(), tenantId: new Types.ObjectId().toString() };
    expect(await reasonOf(previewCancellation(otherActor, String(booking._id)))).toMatch(
      /not found/i,
    );
  });

  it('rejects when booking is already CANCELLED', async () => {
    const booking = await seedBookedBooking();
    await BusBooking.updateOne({ _id: booking._id }, { $set: { status: 'CANCELLED' } });
    expect(await reasonOf(previewCancellation(cancelActor(), String(booking._id)))).toMatch(
      /cannot preview/i,
    );
  });
});

// ────────── Tests — user cancellation (full) ──────────

describe('cancelBooking — full cancel', () => {
  it('cancels at SeatSeller, refunds wallet, transitions booking to CANCELLED', async () => {
    const booking = await seedBookedBooking();
    const result = await cancelBooking(cancelActor(), String(booking._id), {});

    expect(result.booking.status).toBe('CANCELLED');
    expect(result.booking.cancelledAt).not.toBeNull();
    expect(result.cancellation.status).toBe('COMPLETED');
    expect(result.cancellation.reason).toBe('USER');
    expect(result.refundPaise).toBe(108_000);
    expect(result.chargePaise).toBe(12_000);

    // Wallet credited.
    const agency = await Agency.findById(agencyId).lean();
    // Started at 1_000_000 (TOPUP), debited 120_000 on book, refunded 108_000 on cancel
    expect(agency?.walletBalance).toBe(1_000_000 - FARE_PAISE + 108_000);

    // BusCancellation row written.
    const rows = await BusCancellation.find({ bookingId: booking._id });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.refundTxnId).toBeTruthy();
  });

  it('marks the cancellation row with refundTxnId for finance reconciliation', async () => {
    const booking = await seedBookedBooking();
    const result = await cancelBooking(cancelActor(), String(booking._id), {
      note: 'Trip postponed by client',
    });
    expect(result.cancellation.note).toBe('Trip postponed by client');
    expect(result.cancellation.refundTxnId).toBeTruthy();
    // Linked WalletTransaction exists.
    const txn = await WalletTransaction.findById(result.cancellation.refundTxnId).lean();
    expect(txn?.type).toBe('REFUND_CREDIT');
    expect(txn?.amount).toBe(108_000);
  });
});

// ────────── Tests — partial cancellation ──────────

describe('cancelBooking — partial cancel', () => {
  it('keeps booking in PARTIALLY_CANCELLED when only some seats cancelled', async () => {
    const booking = await seedBookedBooking(['L3', 'L4']);
    expect(booking.passengers).toHaveLength(2);

    const result = await cancelBooking(cancelActor(), String(booking._id), {
      seatsToCancel: ['L3'],
    });
    expect(result.booking.status).toBe('PARTIALLY_CANCELLED');
    expect(result.cancellation.seatsCancelled).toEqual(['L3']);
  });

  it('flips to CANCELLED when stacked partials cover all seats', async () => {
    const booking = await seedBookedBooking(['L3', 'L4']);
    await cancelBooking(cancelActor(), String(booking._id), { seatsToCancel: ['L3'] });
    const second = await cancelBooking(cancelActor(), String(booking._id), {
      seatsToCancel: ['L4'],
    });
    expect(second.booking.status).toBe('CANCELLED');
    const rows = await BusCancellation.find({ bookingId: booking._id });
    expect(rows).toHaveLength(2);
  });

  it('rejects re-cancelling a seat already cancelled in a prior row', async () => {
    const booking = await seedBookedBooking(['L3', 'L4']);
    await cancelBooking(cancelActor(), String(booking._id), { seatsToCancel: ['L3'] });
    expect(
      await reasonOf(
        cancelBooking(cancelActor(), String(booking._id), { seatsToCancel: ['L3'] }),
      ),
    ).toMatch(/already cancelled/i);
  });

  it('rejects cancelling a seat that was never on the booking', async () => {
    const booking = await seedBookedBooking(['L3']);
    expect(
      await reasonOf(
        cancelBooking(cancelActor(), String(booking._id), { seatsToCancel: ['L99'] }),
      ),
    ).toMatch(/not on this booking/i);
  });
});

// ────────── Tests — state guards ──────────

describe('cancelBooking — state guards', () => {
  it('rejects a BLOCKED booking (no tin yet)', async () => {
    const booking = await seedBookedBooking();
    await BusBooking.updateOne(
      { _id: booking._id },
      { $set: { status: 'BLOCKED', tin: null } },
    );
    expect(
      await reasonOf(cancelBooking(cancelActor(), String(booking._id), {})),
    ).toMatch(/no SeatSeller tin/i);
  });

  it('rejects a FAILED booking', async () => {
    const booking = await seedBookedBooking();
    await BusBooking.updateOne({ _id: booking._id }, { $set: { status: 'FAILED' } });
    expect(
      await reasonOf(cancelBooking(cancelActor(), String(booking._id), {})),
    ).toMatch(/cannot cancel/i);
  });
});

// ────────── Tests — operator-side cancellation ──────────

describe('processOperatorCancellation', () => {
  it('flips booking to OPERATOR_CANCELLED + refunds full booking total', async () => {
    const booking = await seedBookedBooking();
    expect(booking.status).toBe('BOOKED');

    // Force the mock's internal state to reflect an operator cancel.
    // The mock's getTicket returns whatever status the internal block
    // map says. We flip it through a direct cancelTicket call (which
    // marks the mock's internal state to CANCELLED).
    await mock.cancelTicket({ tin: booking.tin! });

    const result = await processOperatorCancellation(booking.tin!);
    expect(result.bookingId).toBe(String(booking._id));
    // Mock's getTicket doesn't surface refundAmountINR — we fall back
    // to the booking total.
    expect(result.refundPaise).toBe(FARE_PAISE);
    expect(result.reason).toBe('BUS_CANCELLATION');

    const updated = await BusBooking.findById(booking._id);
    expect(updated?.status).toBe('OPERATOR_CANCELLED');
    expect(updated?.operatorCancelledAt).not.toBeNull();

    // Wallet credited.
    const agency = await Agency.findById(agencyId).lean();
    expect(agency?.walletBalance).toBe(1_000_000 - FARE_PAISE + FARE_PAISE);
  });

  it('skips already-cancelled bookings (idempotency)', async () => {
    const booking = await seedBookedBooking();
    await mock.cancelTicket({ tin: booking.tin! });
    await processOperatorCancellation(booking.tin!);
    const second = await processOperatorCancellation(booking.tin!);
    expect(second.skipped).toBe('already-cancelled');
  });

  it('skips when tin is unknown (not in our DB)', async () => {
    const result = await processOperatorCancellation('TIN-UNKNOWN');
    expect(result.skipped).toBe('not-found');
    expect(result.bookingId).toBeNull();
  });
});
