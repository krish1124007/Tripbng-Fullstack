import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { Agency } from '../src/models/Agency.js';
import { Distributor } from '../src/models/Distributor.js';
import { Inventory } from '../src/models/Inventory.js';
import { FareRule } from '../src/models/FareRule.js';
import { Booking } from '../src/models/Booking.js';
import { WalletTransaction } from '../src/models/WalletTransaction.js';
import { Wallet } from '../src/models/Wallet.js';
import { TopupRequest } from '../src/models/TopupRequest.js';
import { Counter } from '../src/models/Counter.js';
import { SeriesAdapter } from '../src/adapters/series.adapter.js';
import { MockAdapter } from '../src/adapters/mock.adapter.js';
import { holdBooking, confirmBooking, cancelBooking } from '../src/services/booking.service.js';
import { postCredit } from '../src/services/wallet/ledger.js';
import { redis } from '../src/config/redis.js';

process.env.MONGO_URI = 'mongodb://localhost:27017/tripbng_b2b_test_booking';

let tenantId: string;
let userId: string;
let agencyId: string;
let distributorId: string;
let inventoryId: string;
let fareRuleId: string;

async function reset(): Promise<void> {
  await Promise.all([
    Booking.deleteMany({}),
    WalletTransaction.deleteMany({}),
    Wallet.deleteMany({}),
    TopupRequest.deleteMany({}),
    Inventory.deleteMany({}),
    FareRule.deleteMany({}),
    Agency.deleteMany({}),
    Distributor.deleteMany({}),
    Tenant.deleteMany({}),
    User.deleteMany({}),
    Counter.deleteMany({}),
  ]);

  const tenant = await Tenant.create({ code: 'test', name: 'Test' });
  tenantId = String(tenant._id);

  const user = await User.create({
    tenantId,
    userCode: 'TST000001',
    role: 'AGENCY',
    email: 'agent@test.dev',
    mobile: '+910000000001',
    fullName: 'Agent',
    passwordHash: 'x'.repeat(60),
    status: 'ACTIVE',
  });
  userId = String(user._id);

  const distributor = await Distributor.create({
    tenantId,
    distributorCode: 'D000001',
    companyName: 'Dist',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: '1 St',
    ownerUserId: user._id,
    walletBalance: 0,
    status: 'ACTIVE',
  });
  distributorId = String(distributor._id);

  const agency = await Agency.create({
    tenantId,
    agencyCode: 'AT000001',
    companyName: 'Agency',
    state: 'MH',
    city: 'Pune',
    pincode: '411001',
    address: '2 St',
    distributorId: distributor._id,
    ownerUserId: user._id,
    walletBalance: 0,
    status: 'ACTIVE',
  });
  agencyId = String(agency._id);

  const fareRule = await FareRule.create({
    tenantId,
    name: 'Standard',
    cancellationBands: [
      { hoursBeforeFrom: 72, hoursBeforeTo: null, feeType: 'PERCENT', feeValue: 1500 }, // 15%
      { hoursBeforeFrom: 0, hoursBeforeTo: 72, feeType: 'NON_REFUNDABLE', feeValue: 0 },
    ],
    reschedulingBands: [],
    noShowFeePaise: 0,
  });
  fareRuleId = String(fareRule._id);

  // Tomorrow's flight (so hours-before > 72 won't match the 0-72 band).
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 7);
  tomorrow.setHours(8, 0, 0, 0);

  const inv = await Inventory.create({
    tenantId,
    inventoryCode: 'INV000001',
    inventoryName: 'BOM-DEL test series',
    status: 'ACTIVE',
    travelType: 'DOMESTIC',
    travelClass: 'ECONOMY',
    origin: { code: 'BOM' },
    destination: { code: 'DEL' },
    seriesStartDate: new Date(Date.now() - 86_400_000),
    seriesEndDate: new Date(Date.now() + 30 * 86_400_000),
    daysOfOperation: [0, 1, 2, 3, 4, 5, 6],
    totalSeats: 100,
    seatsPerDay: 10,
    seatsRemaining: 100,
    isRealTimeBooking: false,
    segments: [
      {
        flightNumber: 'TBT 100',
        airline: { code: '6E' },
        origin: { code: 'BOM' },
        destination: { code: 'DEL' },
        departureTime: '08:00',
        arrivalTime: '10:30',
        duration: 150,
        stopOver: 0,
      },
    ],
    fare: {
      adultFare: 500_000,
      childFare: 350_000,
      infantFare: 50_000,
      discount: 0,
      b2bMarkup: 0,
      gstOnMarkup: false,
      refundable: true,
    },
    bucketPricing: [],
    fareRuleId: fareRule._id,
  });
  inventoryId = String(inv._id);
}

beforeAll(async () => {
  await connectMongo();
  await redis.connect().catch(() => undefined);
});
afterAll(async () => {
  await redis.quit().catch(() => undefined);
  await disconnectMongo();
});
beforeEach(async () => {
  await reset();
});

const actor = () => ({
  tenantId,
  userId,
  role: 'AGENCY',
  agencyId,
  distributorId,
  ipAddress: null,
});

// Tiny helper: directly write a search response into Redis cache so booking tests don't
// have to round-trip the search service. Booking.service reads via getCachedSearch(searchId).
async function seedSearchCache(searchId: string, fareToken: string, totalGrossPaise = 1_000_000) {
  const segment = await Inventory.findById(inventoryId).lean();
  const departureDate = new Date();
  departureDate.setDate(departureDate.getDate() + 7);
  departureDate.setHours(8, 0, 0, 0);
  const arrivalDate = new Date(departureDate);
  arrivalDate.setMinutes(arrivalDate.getMinutes() + 150);
  const fare = segment!.fare!;

  const result = {
    id: 'r1',
    supplierCode: 'SERIES',
    supplierName: 'TripBng Series',
    source: 'SERIES' as const,
    inventoryId,
    segments: [
      {
        flightNumber: 'TBT 100',
        airline: { code: '6E', name: 'IndiGo' },
        origin: { code: 'BOM' },
        destination: { code: 'DEL' },
        departure: departureDate.toISOString(),
        arrival: arrivalDate.toISOString(),
        duration: 150,
        stopOver: 0,
      },
    ],
    totalDuration: 150,
    stops: 0,
    travelClass: 'ECONOMY' as const,
    refundable: true,
    baggageCheckin: null,
    baggageCabin: null,
    seatsRemaining: 100,
    fareRuleDescription: null,
    perPax: {
      adult: blank(fare.adultFare, totalGrossPaise),
      child: blank(fare.childFare, Math.round(totalGrossPaise * 0.75)),
      infant: blank(fare.infantFare, fare.infantFare),
    },
    totalGrossPaise,
    totalAgencyPayablePaise: totalGrossPaise,
    totalNetToSupplierPaise: fare.adultFare,
    currency: 'INR',
    fareToken,
  };

  const response = {
    searchId,
    request: {
      tripType: 'ONEWAY' as const,
      segments: [{ origin: 'BOM', destination: 'DEL', date: departureDate }],
      travelClass: 'ECONOMY' as const,
      pax: { adults: 1, children: 0, infants: 0 },
    },
    results: [result],
    errors: [],
    cachedAt: new Date().toISOString(),
    ttlSeconds: 300,
  };
  await redis.set(`search:id:${searchId}`, JSON.stringify(response), 'EX', 300);
}

function blank(base: number, gross: number) {
  return {
    baseFarePaise: base,
    taxesPaise: 0,
    policyAdjustmentPaise: 0,
    platformMarkupPaise: 0,
    distributorMarkupPaise: 0,
    agencyMarkupPaise: 0,
    discountPaise: 0,
    gstPaise: 0,
    grossAmountPaise: gross,
    netToSupplierPaise: base,
    agencyPayablePaise: gross,
    distributorEarningsPaise: 0,
    platformEarningsPaise: 0,
    currency: 'INR',
  };
}

function buildFareToken(): string {
  return Buffer.from(
    JSON.stringify({
      supplierCode: 'SERIES',
      supplierFareToken: inventoryId,
      inventoryId,
    }),
  ).toString('base64url');
}

describe('SeriesAdapter', () => {
  it('returns matching inventory when route + date + class line up', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const adapter = new SeriesAdapter(tenantId);
    const r = await adapter.search({
      searchId: 's1',
      request: {
        tripType: 'ONEWAY',
        segments: [{ origin: 'BOM', destination: 'DEL', date: tomorrow }],
        travelClass: 'ECONOMY',
        pax: { adults: 1, children: 0, infants: 0 },
      },
    });
    expect(r.options.length).toBeGreaterThan(0);
    expect(r.options[0]?.source).toBe('SERIES');
  });

  it('returns nothing when route mismatches', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const adapter = new SeriesAdapter(tenantId);
    const r = await adapter.search({
      searchId: 's1',
      request: {
        tripType: 'ONEWAY',
        segments: [{ origin: 'BLR', destination: 'CCU', date: tomorrow }],
        travelClass: 'ECONOMY',
        pax: { adults: 1, children: 0, infants: 0 },
      },
    });
    expect(r.options.length).toBe(0);
  });

  it('hold atomically decrements seatsRemaining', async () => {
    const adapter = new SeriesAdapter(tenantId);
    const before = await Inventory.findById(inventoryId).lean();
    expect(before?.seatsRemaining).toBe(100);

    const out = await adapter.hold({
      supplierFareToken: inventoryId,
      passengerCount: { adults: 2, children: 0, infants: 0 },
    });
    expect(out.supplierBookingRef).toMatch(/^SR-INV/);

    const after = await Inventory.findById(inventoryId).lean();
    expect(after?.seatsRemaining).toBe(98);
  });

  it('hold throws EXHAUSTED when seats insufficient', async () => {
    const adapter = new SeriesAdapter(tenantId);
    await expect(
      adapter.hold({
        supplierFareToken: inventoryId,
        passengerCount: { adults: 200, children: 0, infants: 0 },
      }),
    ).rejects.toMatchObject({ code: 'EXHAUSTED' });
  });
});

describe('MockAdapter', () => {
  it('produces deterministic results per route+date', async () => {
    const adapter = new MockAdapter();
    const date = new Date('2026-06-01');
    const a = await adapter.search({
      searchId: 's1',
      request: {
        tripType: 'ONEWAY',
        segments: [{ origin: 'BOM', destination: 'DEL', date }],
        travelClass: 'ECONOMY',
        pax: { adults: 1, children: 0, infants: 0 },
      },
    });
    const b = await adapter.search({
      searchId: 's2',
      request: {
        tripType: 'ONEWAY',
        segments: [{ origin: 'BOM', destination: 'DEL', date }],
        travelClass: 'ECONOMY',
        pax: { adults: 1, children: 0, infants: 0 },
      },
    });
    expect(a.options.map((o) => o.supplierFareId)).toEqual(b.options.map((o) => o.supplierFareId));
  });
});

describe('booking flow', () => {
  it('hold creates booking, decrements seats, status=HOLD with expiresAt', async () => {
    const searchId = 'sX1';
    const fareToken = buildFareToken();
    await seedSearchCache(searchId, fareToken, 600_000);

    const b = await holdBooking(actor(), {
      searchId,
      fareToken,
      passengers: [
        {
          type: 'ADULT',
          title: 'MR',
          firstName: 'Test',
          lastName: 'User',
          fareCategory: 'REGULAR',
        },
      ],
      contact: { email: 'test@example.com', mobile: '+919999988888', countryCode: '+91' },
    });
    expect(b.status).toBe('HOLD');
    expect(b.bookingCode).toMatch(/^TBNG/);
    expect(b.seatsConsumed).toBe(1);
    expect(b.expiresAt).toBeTruthy();

    const inv = await Inventory.findById(inventoryId).lean();
    expect(inv?.seatsRemaining).toBe(99);
  });

  it('confirm without funds throws and reverts to HOLD', async () => {
    const searchId = 'sX2';
    const fareToken = buildFareToken();
    await seedSearchCache(searchId, fareToken, 1_000_000);
    const b = await holdBooking(actor(), {
      searchId,
      fareToken,
      passengers: [
        { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'B', fareCategory: 'REGULAR' },
      ],
      contact: { email: 'a@b.com', mobile: '+910000000000', countryCode: '+91' },
    });

    await expect(
      confirmBooking(actor(), {
        bookingId: String(b._id),
        paymentMode: 'WALLET',
        acceptTerms: true,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_WALLET' });

    const reread = await Booking.findById(b._id);
    expect(reread?.status).toBe('HOLD');
  });

  it('confirm with funds debits wallet and transitions to TICKETED', async () => {
    await postCredit({
      tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
      type: 'TOPUP',
      amountPaise: 5_000_000,
      performedBy: userId,
    });
    const searchId = 'sX3';
    const fareToken = buildFareToken();
    await seedSearchCache(searchId, fareToken, 600_000);
    const b = await holdBooking(actor(), {
      searchId,
      fareToken,
      passengers: [
        { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'B', fareCategory: 'REGULAR' },
      ],
      contact: { email: 'a@b.com', mobile: '+910000000000', countryCode: '+91' },
    });
    const ticketed = await confirmBooking(actor(), {
      bookingId: String(b._id),
      paymentMode: 'WALLET',
      acceptTerms: true,
    });
    expect(ticketed.status).toBe('TICKETED');
    expect(ticketed.paymentStatus).toBe('PAID');
    expect(ticketed.walletDebitTxnId).toBeTruthy();

    const agency = await Agency.findById(agencyId).lean();
    expect(agency?.walletBalance).toBe(5_000_000 - 600_000);
  });

  it('cancel restores seats and refunds wallet (less cancellation fee)', async () => {
    await postCredit({
      tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
      type: 'TOPUP',
      amountPaise: 5_000_000,
      performedBy: userId,
    });
    const searchId = 'sX4';
    const fareToken = buildFareToken();
    await seedSearchCache(searchId, fareToken, 1_000_000);
    const b = await holdBooking(actor(), {
      searchId,
      fareToken,
      passengers: [
        { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'B', fareCategory: 'REGULAR' },
      ],
      contact: { email: 'a@b.com', mobile: '+910000000000', countryCode: '+91' },
    });
    const ticketed = await confirmBooking(actor(), {
      bookingId: String(b._id),
      paymentMode: 'WALLET',
      acceptTerms: true,
    });
    expect(ticketed.status).toBe('TICKETED');

    const cancelled = await cancelBooking(actor(), String(b._id), 'changed plans');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.paymentStatus).toBe('REFUNDED');

    // Travel is in 7 days → > 72h band → 15% fee applies → refund = 850000.
    const agency = await Agency.findById(agencyId).lean();
    expect(agency?.walletBalance).toBe(5_000_000 - 1_000_000 + 850_000 - 150_000);

    const inv = await Inventory.findById(inventoryId).lean();
    expect(inv?.seatsRemaining).toBe(100);

    // Series adapter is synchronous — supplierCancellationStatus should be
    // PROCESSED immediately (no async settlement pipeline). No
    // cancellationReference because Series doesn't issue one.
    expect(cancelled.supplierCancellationStatus).toBe('PROCESSED');
    expect(cancelled.supplierCancellationRef).toBeNull();
  });

  it('expired holds cannot be confirmed and seats are released', async () => {
    const searchId = 'sX5';
    const fareToken = buildFareToken();
    await seedSearchCache(searchId, fareToken, 600_000);
    const b = await holdBooking(actor(), {
      searchId,
      fareToken,
      passengers: [
        { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'B', fareCategory: 'REGULAR' },
      ],
      contact: { email: 'a@b.com', mobile: '+910000000000', countryCode: '+91' },
    });
    // Force-expire the hold.
    b.expiresAt = new Date(Date.now() - 60_000);
    await b.save();

    await expect(
      confirmBooking(actor(), {
        bookingId: String(b._id),
        paymentMode: 'WALLET',
        acceptTerms: true,
      }),
    ).rejects.toMatchObject({ code: 'HOLD_EXPIRED' });

    const inv = await Inventory.findById(inventoryId).lean();
    expect(inv?.seatsRemaining).toBe(100); // recovered
  });

  it('concurrent /confirm calls only debit the wallet once', async () => {
    // Regression for the Phase-A optimistic-locking fix. Earlier confirmBooking
    // read → status-check → save without a Mongo-level guard; two simultaneous
    // POST /confirm calls could both pass the `status === HOLD` check before
    // either save committed, causing a double wallet debit + double supplier
    // ticket call. We now `findOneAndUpdate({status:'HOLD'},...)` atomically.
    await postCredit({
      tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: agencyId,
      type: 'TOPUP',
      amountPaise: 5_000_000,
      performedBy: userId,
    });
    const searchId = 'sX-race';
    const fareToken = buildFareToken();
    await seedSearchCache(searchId, fareToken, 600_000);
    const b = await holdBooking(actor(), {
      searchId,
      fareToken,
      passengers: [
        { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'B', fareCategory: 'REGULAR' },
      ],
      contact: { email: 'a@b.com', mobile: '+910000000000', countryCode: '+91' },
    });

    // Fire two confirms in parallel. Exactly one must win.
    const results = await Promise.allSettled([
      confirmBooking(actor(), {
        bookingId: String(b._id),
        paymentMode: 'WALLET',
        acceptTerms: true,
      }),
      confirmBooking(actor(), {
        bookingId: String(b._id),
        paymentMode: 'WALLET',
        acceptTerms: true,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Wallet was debited once for the booking total — not twice.
    const agency = await Agency.findById(agencyId).lean();
    expect(agency?.walletBalance).toBe(5_000_000 - 600_000);
  });

  it('hold rejects when fare is not in the cached search', async () => {
    const searchId = 'sX6';
    const fareToken = buildFareToken();
    await seedSearchCache(searchId, fareToken, 600_000);

    const wrongToken = Buffer.from(
      JSON.stringify({
        supplierCode: 'SERIES',
        supplierFareToken: new Types.ObjectId().toString(),
      }),
    ).toString('base64url');
    await expect(
      holdBooking(actor(), {
        searchId,
        fareToken: wrongToken,
        passengers: [
          { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'B', fareCategory: 'REGULAR' },
        ],
        contact: { email: 'a@b.com', mobile: '+910000000000', countryCode: '+91' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
