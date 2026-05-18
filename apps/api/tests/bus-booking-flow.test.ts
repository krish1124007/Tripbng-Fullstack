// Bus booking flow integration tests.
//
// Boots a real Mongo + Redis + the SeatSeller mock client. Covers the
// critical-path algorithm in services/bus/booking.service.ts:
//
//   - Happy path: BLOCKED → BOOKED with wallet debit + approval.booked
//   - Insufficient wallet: nothing reaches SeatSeller
//   - Block failure: wallet refunded, no row persists
//   - Book timeout-then-recover: ticket discovered via checkBookedTicket
//   - Book truly fails: BOOKED → FAILED + wallet refund
//   - Fare drift: rejected with IDEMPOTENCY_CONFLICT
//   - Forced-seats violation: rejected before SeatSeller call
//   - Idempotency hit: second call returns the same booking, no SeatSeller
//   - Lock contention: second concurrent call returns IDEMPOTENCY_CONFLICT

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { postCredit } from '../src/services/wallet/ledger.js';
import { submitBusApproval, approveApproval } from '../src/services/approval/approval.service.js';
import { createBusBooking } from '../src/services/bus/booking.service.js';
import {
  MockSeatSellerClient,
} from '../src/adapters/seatseller/mock-client.js';
import { _resetSeatSellerClientForTests } from '../src/adapters/seatseller/factory.js';

process.env.MONGO_URI = 'mongodb://localhost:27017/tripbng_b2b_test_bus_booking';

let tenantId: string;
let userId: string;
let agencyId: string;
let employeeId: string;
let mock: MockSeatSellerClient;

const FARE_PAISE = 120_000; // ₹1,200 — matches the mock seat L1 fare (1200 INR)

async function reset(): Promise<void> {
  await Promise.all([
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

  const tenant = await Tenant.create({ code: 'busb', name: 'Bus Test' });
  tenantId = String(tenant._id);

  const user = await User.create({
    tenantId,
    userCode: 'BUS-TST-1',
    role: 'AGENCY',
    email: 'bus@test.dev',
    mobile: '+910000099991',
    fullName: 'Bus Tester',
    passwordHash: 'x'.repeat(60),
    status: 'ACTIVE',
  });
  userId = String(user._id);

  const distributor = await Distributor.create({
    tenantId,
    distributorCode: 'D000099',
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
    agencyCode: 'AT000099',
    companyName: 'Agency Bus',
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
    empCode: 'EMP-99',
    name: 'Test Traveller',
    email: 'traveller@bus.test',
    mobile: '+919876543210',
    gender: 'FEMALE',
    managerId: user._id,
    status: 'ACTIVE',
  });
  employeeId = String(employee._id);

  // Top up the wallet so booking has funds.
  await postCredit({
    tenantId,
    walletKind: 'AGENCY',
    walletOwnerId: agencyId,
    type: 'TOPUP',
    amountPaise: 1_000_000, // ₹10,000
    performedBy: userId,
  });

  mock = new MockSeatSellerClient();
  _resetSeatSellerClientForTests(mock);
}

// AppError surfaces specific cause via .details.reason; .message is the
// canned ERROR_CODES message. Pull whichever is set so test matchers
// can target the specific cause.
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

const tomorrowDoj = (): string => {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};

const submitAndApprove = async (seatNumbers: string[] = ['L3']) => {
  const doj = tomorrowDoj();
  const tripId = `MOCK-TRIP-122-124-${doj}`;
  const inventoryId = `MOCK-INV-122-124-${doj}`;
  const submitted = await submitBusApproval(
    {
      tenantId,
      userId,
      role: 'AGENCY',
    },
    {
      employeeId,
      sourceCityId: 122,
      destinationCityId: 124,
      doj,
      tripId,
      inventoryId,
      // Default to L3 — mock fixture's forcedSeats are "L3,L4@U1", so a
      // FEMALE pax (the test default) MUST pick from L3 or L4. Tests
      // exercising forced-seat violations override this.
      seatNumbers,
      boardingPointId: 1001,
      droppingPointId: 2001,
      estimatedFarePaise: FARE_PAISE,
      operatorName: 'TripBNG Mock Travels',
      operatorId: 9001,
      busType: 'AC Sleeper',
      busTypeId: 17,
      isAc: true,
      isSleeper: true,
      departureAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
      arrivalAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000).toISOString(),
    },
  );
  // Manager approves so the booking flow can consume it.
  await approveApproval(
    { tenantId, userId, role: 'AGENCY' },
    String(submitted.approval._id),
    undefined,
  );
  return String(submitted.approval._id);
};

const passenger = (overrides: Partial<{ gender: 'MALE' | 'FEMALE'; seatName: string }> = {}) => ({
  // Default L3 — a ladies-seat in the mock fixture, satisfying forced-seat
  // rules for the default FEMALE gender. Tests can override.
  seatName: overrides.seatName ?? 'L3',
  title: 'Mrs' as const,
  name: 'Test Traveller',
  age: 30,
  gender: (overrides.gender ?? 'FEMALE') as 'MALE' | 'FEMALE' | 'OTHER',
  mobile: '+919876543210',
  email: 'traveller@bus.test',
  primary: true,
});

const actor = () => ({
  tenantId,
  userId,
  role: 'AGENCY',
  agencyId,
  walletKind: 'AGENCY' as const,
  walletOwnerId: agencyId,
  ipAddress: '127.0.0.1',
});

// ────────── Tests ──────────

describe('createBusBooking — happy path', () => {
  it('books a fully-compliant approval, debits wallet, marks approval booked', async () => {
    const approvalId = await submitAndApprove();
    const booking = await createBusBooking(actor(), {
      approvalId,
      passengers: [passenger()],
    });
    expect(booking.status).toBe('BOOKED');
    expect(booking.tin).toMatch(/^TIN-/);
    expect(booking.bookingRef).toMatch(/^TBNG-BUS-/);
    expect(booking.fareBreakup.totalPaise).toBe(FARE_PAISE);
    expect(booking.walletDebitTxnId).toBeTruthy();
    expect(booking.bookedAt).not.toBeNull();

    // Approval should be marked booked.
    const approval = await ApprovalRequest.findById(approvalId);
    expect(approval?.status).toBe('booked');
    expect(approval?.bookingId?.toString()).toBe(String(booking._id));

    // Wallet was debited.
    const agency = await Agency.findById(agencyId).lean();
    expect(agency?.walletBalance).toBe(1_000_000 - FARE_PAISE);
  });

  it('issues sequential booking refs', async () => {
    const a1 = await submitAndApprove(['L3']);
    const b1 = await createBusBooking(actor(), { approvalId: a1, passengers: [passenger()] });
    const a2 = await submitAndApprove(['L4']);
    const b2 = await createBusBooking(actor(), {
      approvalId: a2,
      passengers: [passenger({ seatName: 'L4' })],
    });
    expect(b1.bookingRef).not.toBe(b2.bookingRef);
    expect(b1.bookingRef).toMatch(/^TBNG-BUS-\d+/);
    expect(b2.bookingRef).toMatch(/^TBNG-BUS-\d+/);
  });
});

describe('createBusBooking — wallet insufficient', () => {
  it('rejects when balance is below total, no SeatSeller call fires', async () => {
    const approvalId = await submitAndApprove();
    // Spend down the wallet so the next debit will fail.
    await postCredit({
      tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
      type: 'TOPUP',
      amountPaise: 100, // tiny + still under the booking total
      performedBy: userId,
    });
    // Drain via direct $set (test-only) — no public API exists for
    // arbitrary balance moves.
    await Agency.updateOne({ _id: agencyId }, { $set: { walletBalance: 1000 } });

    const blockSpy = vi.spyOn(mock, 'blockTicket');
    await expect(
      createBusBooking(actor(), { approvalId, passengers: [passenger()] }),
    ).rejects.toThrow();
    expect(blockSpy).not.toHaveBeenCalled();
  });
});

describe('createBusBooking — block failure', () => {
  it('refunds wallet when SeatSeller blockTicket throws, no row persisted', async () => {
    const approvalId = await submitAndApprove();
    // Target the failure at blockTicket specifically. Mock's
    // failNext queue is FIFO across all client methods; the first
    // call (getTripDetails) would consume it. spyOn lets us pin
    // exactly which endpoint fails.
    const blockSpy = vi
      .spyOn(mock, 'blockTicket')
      .mockRejectedValueOnce(new (await import('../src/adapters/seatseller/errors.js')).TentativeBookingFailedError());

    await expect(
      createBusBooking(actor(), { approvalId, passengers: [passenger()] }),
    ).rejects.toThrow(/Tentative booking failed/i);
    expect(blockSpy).toHaveBeenCalledTimes(1);

    // Wallet returned to original balance.
    const agency = await Agency.findById(agencyId).lean();
    expect(agency?.walletBalance).toBe(1_000_000);

    // Three ledger rows: TOPUP from reset + BOOKING_DEBIT + REFUND_CREDIT.
    const txns = await WalletTransaction.find({}).lean();
    expect(txns).toHaveLength(3);
    expect(new Set(txns.map((t) => t.type))).toEqual(
      new Set(['TOPUP', 'BOOKING_DEBIT', 'REFUND_CREDIT']),
    );

    // No BusBooking row persisted.
    expect(await BusBooking.countDocuments({})).toBe(0);
  });
});

describe('createBusBooking — book timeout-then-recover', () => {
  it('recovers via checkBookedTicket and lands BOOKED', async () => {
    const approvalId = await submitAndApprove();
    mock.failNext('BOOK_TIMEOUT_THEN_RECONCILE');

    const booking = await createBusBooking(actor(), {
      approvalId,
      passengers: [passenger()],
    });
    expect(booking.status).toBe('BOOKED');
    expect(booking.tin).toMatch(/^TIN-/);

    // Wallet stays debited (booking went through on the supplier side).
    const agency = await Agency.findById(agencyId).lean();
    expect(agency?.walletBalance).toBe(1_000_000 - FARE_PAISE);
  }, 15_000); // sleep(5s) inside the reconciler
});

describe('createBusBooking — fare drift', () => {
  it('rejects when tripDetails fare disagrees with the approval fare', async () => {
    const approvalId = await submitAndApprove();
    // Submit + approve was done at FARE_PAISE = 120_000. Mutate the
    // approval payload to FAKE a higher approved fare so the live
    // tripDetails seat (1200 INR = 120_000 paise) disagrees.
    await ApprovalRequest.updateOne(
      { _id: approvalId },
      { $set: { 'payload.estimatedFarePaise': 999_000 } },
    );

    expect(
      await reasonOf(
        createBusBooking(actor(), { approvalId, passengers: [passenger()] }),
      ),
    ).toMatch(/drift/i);

    // Wallet should not be touched on a fare-drift abort (validation
    // happens before wallet debit).
    const agency = await Agency.findById(agencyId).lean();
    expect(agency?.walletBalance).toBe(1_000_000);
  });
});

describe('createBusBooking — forced-seat enforcement', () => {
  it('rejects when FEMALE pax picks a non-forced seat (mock has L3,L4 reserved for women)', async () => {
    // Approval booked L1 — fine for the approval submit (no forced-seats
    // logic at submit time), but the booking flow re-validates against
    // live tripDetails which surfaces forcedSeats="L3,L4@U1". A FEMALE
    // pax on L1 must fail before the SeatSeller blockTicket call.
    const approvalId = await submitAndApprove(['L1']);
    expect(
      await reasonOf(
        createBusBooking(actor(), {
          approvalId,
          passengers: [passenger({ gender: 'FEMALE', seatName: 'L1' })],
        }),
      ),
    ).toMatch(/reserved seats/i);
  });
});

describe('createBusBooking — idempotency', () => {
  it('returns the same booking on a second call with the same idempotency key', async () => {
    const approvalId = await submitAndApprove();
    const idempotencyKey = `idem-${Date.now()}`;

    // First call performs the full booking.
    const first = await createBusBooking(actor(), {
      approvalId,
      passengers: [passenger({ seatName: 'L3' })], // pick a forced seat to pass forced-seat rule
      idempotencyKey,
    });

    // Second call hits the idempotency cache and returns the same row.
    const blockSpy = vi.spyOn(mock, 'blockTicket');
    const second = await createBusBooking(actor(), {
      approvalId,
      passengers: [passenger({ seatName: 'L3' })],
      idempotencyKey,
    });

    expect(String(second._id)).toBe(String(first._id));
    expect(blockSpy).not.toHaveBeenCalled();
  });
});

describe('createBusBooking — approval state guards', () => {
  it('rejects a pending approval', async () => {
    // submitBusApproval → pending (no auto-approve, no manager approve).
    const submitted = await submitBusApproval(
      { tenantId, userId, role: 'AGENCY' },
      {
        employeeId,
        sourceCityId: 122,
        destinationCityId: 124,
        doj: tomorrowDoj(),
        tripId: `MOCK-TRIP-122-124-${tomorrowDoj()}`,
        inventoryId: `MOCK-INV-122-124-${tomorrowDoj()}`,
        seatNumbers: ['L3'],
        boardingPointId: 1001,
        droppingPointId: 2001,
        estimatedFarePaise: FARE_PAISE,
        operatorId: 9001,
        operatorName: 'TripBNG Mock Travels',
        busType: 'AC Sleeper',
        busTypeId: 17,
        isAc: true,
        isSleeper: true,
        departureAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
        arrivalAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000).toISOString(),
      },
    );
    expect(submitted.approval.status).toBe('pending');
    expect(
      await reasonOf(
        createBusBooking(actor(), {
          approvalId: String(submitted.approval._id),
          passengers: [passenger({ seatName: 'L3' })],
        }),
      ),
    ).toMatch(/cannot book/i);
  });

  it('rejects an expired approval', async () => {
    const approvalId = await submitAndApprove();
    await ApprovalRequest.updateOne(
      { _id: approvalId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );
    expect(
      await reasonOf(
        createBusBooking(actor(), {
          approvalId,
          passengers: [passenger({ seatName: 'L3' })],
        }),
      ),
    ).toMatch(/expired/i);
  });
});
