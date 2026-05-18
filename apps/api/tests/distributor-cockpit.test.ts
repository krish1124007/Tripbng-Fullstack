import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { Agency } from '../src/models/Agency.js';
import { Distributor } from '../src/models/Distributor.js';
import { Booking } from '../src/models/Booking.js';
import { Counter } from '../src/models/Counter.js';
import {
  loadDashboardSummary,
  loadDormantAgencies,
  loadEarningsBreakdown,
} from '../src/services/distributor-cockpit.service.js';

process.env.MONGO_URI = 'mongodb://localhost:27017/tripbng_b2b_test_cockpit';

let tenantId: string;
let distributorId: string;
let agencyA: string;
let agencyB: string;
let unrelatedAgency: string;

const DAY_MS = 24 * 60 * 60 * 1000;

async function reset(): Promise<void> {
  // Drop the whole bookings collection so any stale indexes (e.g. an older idempotencyKey
  // unique index without a partial filter) are recreated from the current schema. Plain
  // deleteMany leaves the indexes alone.
  await Booking.collection.drop().catch(() => undefined);
  await Promise.all([
    Agency.deleteMany({}),
    Distributor.deleteMany({}),
    Tenant.deleteMany({}),
    User.deleteMany({}),
    Counter.deleteMany({}),
  ]);
  await Booking.syncIndexes();

  const tenant = await Tenant.create({ code: 'test', name: 'Test' });
  tenantId = String(tenant._id);

  const user = await User.create({
    tenantId,
    userCode: 'TST000001',
    role: 'DISTRIBUTOR',
    email: 'dist@test.dev',
    mobile: '+910000000001',
    fullName: 'Dist',
    passwordHash: 'x'.repeat(60),
    status: 'ACTIVE',
  });

  const distributor = await Distributor.create({
    tenantId,
    distributorCode: 'D000001',
    companyName: 'Cockpit Distributor',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: '1 St',
    ownerUserId: user._id,
    walletBalance: 250_000,
    overrideCommissionPercent: 2, // schema stores plain percent 0..100
    status: 'ACTIVE',
  });
  distributorId = String(distributor._id);

  const a = await Agency.create({
    tenantId,
    agencyCode: 'AT000001',
    companyName: 'Agency A',
    state: 'MH',
    city: 'Pune',
    pincode: '411001',
    address: '2 St',
    distributorId: distributor._id,
    ownerUserId: user._id,
    status: 'ACTIVE',
  });
  agencyA = String(a._id);

  const b = await Agency.create({
    tenantId,
    agencyCode: 'AT000002',
    companyName: 'Agency B',
    state: 'KA',
    city: 'Bengaluru',
    pincode: '560001',
    address: '3 St',
    distributorId: distributor._id,
    ownerUserId: user._id,
    status: 'ACTIVE',
  });
  agencyB = String(b._id);

  // Unrelated agency under no distributor — must NEVER show in this distributor's cockpit.
  const u = await Agency.create({
    tenantId,
    agencyCode: 'AT000003',
    companyName: 'Unrelated Agency',
    state: 'TN',
    city: 'Chennai',
    pincode: '600001',
    address: '4 St',
    distributorId: null,
    ownerUserId: user._id,
    status: 'ACTIVE',
  });
  unrelatedAgency = String(u._id);
}

async function seedBooking(opts: {
  agencyId: string;
  agencyCode: string;
  agencyName: string;
  distributorId: string | null;
  status: 'TICKETED' | 'CONFIRMED' | 'CANCELLED' | 'HOLD' | 'INITIATED' | 'EXPIRED' | 'FAILED';
  ticketedAt?: Date;
  earningsPaise?: number;
  grossPaise?: number;
  bookingCode: string;
}) {
  return Booking.create({
    tenantId,
    bookingCode: opts.bookingCode,
    channel: 'ONLINE',
    flowSubType: 'SERIES',
    productType: 'FLIGHT',
    supplierCode: 'SERIES',
    agencyId: opts.agencyId,
    agencyCode: opts.agencyCode,
    agencyName: opts.agencyName,
    distributorId: opts.distributorId ?? null,
    bookedByUserId: new Types.ObjectId(),
    sector: 'BOM-DEL',
    travelDate: new Date(Date.now() + 7 * DAY_MS),
    tripType: 'ONEWAY',
    travelClass: 'ECONOMY',
    segments: [
      {
        flightNumber: 'TBT 100',
        airline: { code: '6E' },
        origin: { code: 'BOM' },
        destination: { code: 'DEL' },
        departure: new Date(Date.now() + 7 * DAY_MS),
        arrival: new Date(Date.now() + 7 * DAY_MS + 150 * 60_000),
        duration: 150,
        stopOver: 0,
      },
    ],
    passengers: [],
    pricing: {
      baseFarePaise: 500_000,
      taxesPaise: 50_000,
      grossAmountPaise: opts.grossPaise ?? 600_000,
      agencyPayablePaise: opts.grossPaise ?? 600_000,
      distributorEarningsPaise: opts.earningsPaise ?? 12_000,
    },
    paymentStatus: opts.status === 'TICKETED' || opts.status === 'CONFIRMED' ? 'PAID' : 'PENDING',
    status: opts.status,
    ticketedAt: opts.ticketedAt ?? null,
    seatsConsumed: 1,
  });
}

beforeAll(async () => {
  await connectMongo();
});
afterAll(async () => {
  await disconnectMongo();
});
beforeEach(async () => {
  await reset();
});

describe('distributor cockpit - dashboard', () => {
  it('aggregates earnings only from TICKETED/CONFIRMED bookings within distributor scope', async () => {
    const now = new Date();
    await seedBooking({
      agencyId: agencyA,
      agencyCode: 'AT000001',
      agencyName: 'Agency A',
      distributorId,
      status: 'TICKETED',
      ticketedAt: now,
      earningsPaise: 10_000,
      grossPaise: 500_000,
      bookingCode: 'B1',
    });
    await seedBooking({
      agencyId: agencyB,
      agencyCode: 'AT000002',
      agencyName: 'Agency B',
      distributorId,
      status: 'CONFIRMED',
      ticketedAt: now,
      earningsPaise: 5_000,
      grossPaise: 200_000,
      bookingCode: 'B2',
    });
    // Cancelled: should NOT contribute to earnings or bookingCount.
    await seedBooking({
      agencyId: agencyA,
      agencyCode: 'AT000001',
      agencyName: 'Agency A',
      distributorId,
      status: 'CANCELLED',
      ticketedAt: now,
      earningsPaise: 99_000,
      grossPaise: 999_000,
      bookingCode: 'B3',
    });
    // HOLD: not earnings.
    await seedBooking({
      agencyId: agencyA,
      agencyCode: 'AT000001',
      agencyName: 'Agency A',
      distributorId,
      status: 'HOLD',
      earningsPaise: 99_000,
      grossPaise: 999_000,
      bookingCode: 'B4',
    });
    // Unrelated agency under different distributor — must be excluded.
    await seedBooking({
      agencyId: unrelatedAgency,
      agencyCode: 'AT000003',
      agencyName: 'Unrelated',
      distributorId: null,
      status: 'TICKETED',
      ticketedAt: now,
      earningsPaise: 50_000,
      grossPaise: 500_000,
      bookingCode: 'B5',
    });

    const summary = await loadDashboardSummary({ tenantId, distributorId });
    expect(summary.thisMonth.earningsPaise).toBe(15_000);
    expect(summary.thisMonth.bookingCount).toBe(2);
    expect(summary.thisMonth.grossGmvPaise).toBe(700_000);
    expect(summary.thisMonth.activeAgencies).toBe(2);
    expect(summary.lifetime.earningsPaise).toBe(15_000);
    expect(summary.agencies.total).toBe(2); // unrelated agency excluded
  });

  it('top agencies sorted by earnings desc', async () => {
    const now = new Date();
    await seedBooking({
      agencyId: agencyA,
      agencyCode: 'AT000001',
      agencyName: 'Agency A',
      distributorId,
      status: 'TICKETED',
      ticketedAt: now,
      earningsPaise: 5_000,
      bookingCode: 'B1',
    });
    await seedBooking({
      agencyId: agencyB,
      agencyCode: 'AT000002',
      agencyName: 'Agency B',
      distributorId,
      status: 'TICKETED',
      ticketedAt: now,
      earningsPaise: 30_000,
      bookingCode: 'B2',
    });
    await seedBooking({
      agencyId: agencyB,
      agencyCode: 'AT000002',
      agencyName: 'Agency B',
      distributorId,
      status: 'TICKETED',
      ticketedAt: now,
      earningsPaise: 30_000,
      bookingCode: 'B3',
    });

    const summary = await loadDashboardSummary({ tenantId, distributorId });
    expect(summary.topAgencies[0]?.companyName).toBe('Agency B');
    expect(summary.topAgencies[0]?.earningsPaise).toBe(60_000);
    expect(summary.topAgencies[1]?.companyName).toBe('Agency A');
  });

  it('30-day trend backfills missing days with zero', async () => {
    const summary = await loadDashboardSummary({ tenantId, distributorId });
    expect(summary.trend).toHaveLength(30);
    expect(summary.trend.every((d) => d.bookingCount === 0)).toBe(true);
  });

  it('last-month earnings counted only inside last month window', async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthMid = new Date(startOfMonth.getTime() - 5 * DAY_MS);

    await seedBooking({
      agencyId: agencyA,
      agencyCode: 'AT000001',
      agencyName: 'Agency A',
      distributorId,
      status: 'TICKETED',
      ticketedAt: lastMonthMid,
      earningsPaise: 7_500,
      bookingCode: 'B1',
    });
    await seedBooking({
      agencyId: agencyA,
      agencyCode: 'AT000001',
      agencyName: 'Agency A',
      distributorId,
      status: 'TICKETED',
      ticketedAt: now,
      earningsPaise: 4_000,
      bookingCode: 'B2',
    });

    const summary = await loadDashboardSummary({ tenantId, distributorId });
    expect(summary.thisMonth.earningsPaise).toBe(4_000);
    expect(summary.lastMonth.earningsPaise).toBe(7_500);
  });
});

describe('distributor cockpit - earnings breakdown', () => {
  it('groupBy=agency sums per agency and sorts desc', async () => {
    const now = new Date();
    await seedBooking({
      agencyId: agencyA,
      agencyCode: 'AT000001',
      agencyName: 'Agency A',
      distributorId,
      status: 'TICKETED',
      ticketedAt: now,
      earningsPaise: 1_000,
      bookingCode: 'B1',
    });
    await seedBooking({
      agencyId: agencyB,
      agencyCode: 'AT000002',
      agencyName: 'Agency B',
      distributorId,
      status: 'TICKETED',
      ticketedAt: now,
      earningsPaise: 5_000,
      bookingCode: 'B2',
    });
    await seedBooking({
      agencyId: agencyB,
      agencyCode: 'AT000002',
      agencyName: 'Agency B',
      distributorId,
      status: 'CANCELLED',
      ticketedAt: now,
      earningsPaise: 999,
      bookingCode: 'B3',
    });

    const out = await loadEarningsBreakdown(
      { tenantId, distributorId },
      {
        from: new Date(Date.now() - 7 * DAY_MS),
        to: new Date(Date.now() + DAY_MS),
        groupBy: 'agency',
      },
    );
    expect(out.rows.length).toBe(2);
    expect(out.rows[0]?.label).toContain('Agency B');
    expect(out.rows[0]?.earningsPaise).toBe(5_000);
    expect(out.rows[0]?.cancelledCount).toBe(1);
    expect(out.totals.earningsPaise).toBe(6_000);
    expect(out.totals.cancelledCount).toBe(1);
  });

  it('groupBy=day groups same-day bookings', async () => {
    const day1 = new Date('2026-04-15T08:00:00Z');
    const day2 = new Date('2026-04-16T08:00:00Z');
    await seedBooking({
      agencyId: agencyA,
      agencyCode: 'AT000001',
      agencyName: 'Agency A',
      distributorId,
      status: 'TICKETED',
      ticketedAt: day1,
      earningsPaise: 1000,
      bookingCode: 'B1',
    });
    await seedBooking({
      agencyId: agencyA,
      agencyCode: 'AT000001',
      agencyName: 'Agency A',
      distributorId,
      status: 'TICKETED',
      ticketedAt: day1,
      earningsPaise: 2000,
      bookingCode: 'B2',
    });
    await seedBooking({
      agencyId: agencyA,
      agencyCode: 'AT000001',
      agencyName: 'Agency A',
      distributorId,
      status: 'TICKETED',
      ticketedAt: day2,
      earningsPaise: 5000,
      bookingCode: 'B3',
    });

    const out = await loadEarningsBreakdown(
      { tenantId, distributorId },
      { from: day1, to: new Date(day2.getTime() + DAY_MS), groupBy: 'day' },
    );
    expect(out.rows).toHaveLength(2);
    const apr15 = out.rows.find((r) => r.key === '2026-04-15');
    const apr16 = out.rows.find((r) => r.key === '2026-04-16');
    expect(apr15?.earningsPaise).toBe(3000);
    expect(apr16?.earningsPaise).toBe(5000);
  });
});

describe('distributor cockpit - dormant agencies', () => {
  it('flags agencies with no TICKETED in cutoff window', async () => {
    const now = new Date();
    // Agency A: ticketed 60 days ago — dormant when cutoff is 30.
    await seedBooking({
      agencyId: agencyA,
      agencyCode: 'AT000001',
      agencyName: 'Agency A',
      distributorId,
      status: 'TICKETED',
      ticketedAt: new Date(now.getTime() - 60 * DAY_MS),
      bookingCode: 'B1',
    });
    // Agency B: ticketed yesterday — active.
    await seedBooking({
      agencyId: agencyB,
      agencyCode: 'AT000002',
      agencyName: 'Agency B',
      distributorId,
      status: 'TICKETED',
      ticketedAt: new Date(now.getTime() - 1 * DAY_MS),
      bookingCode: 'B2',
    });

    const dormant = await loadDormantAgencies({ tenantId, distributorId }, 30);
    expect(dormant).toHaveLength(1);
    expect(dormant[0]?.agencyCode).toBe('AT000001');
    expect(dormant[0]?.daysSinceLastBooking).toBeGreaterThanOrEqual(60);
    expect(dormant[0]?.totalLifetimeBookings).toBe(1);
  });

  it('treats never-booked agencies as dormant with null lastBookingAt', async () => {
    const dormant = await loadDormantAgencies({ tenantId, distributorId }, 30);
    expect(dormant).toHaveLength(2);
    expect(dormant.every((a) => a.lastBookingAt === null)).toBe(true);
    expect(dormant.every((a) => a.daysSinceLastBooking === null)).toBe(true);
  });

  it('CANCELLED bookings do not count toward "active" — agency stays dormant', async () => {
    const now = new Date();
    await seedBooking({
      agencyId: agencyA,
      agencyCode: 'AT000001',
      agencyName: 'Agency A',
      distributorId,
      status: 'CANCELLED',
      ticketedAt: now,
      bookingCode: 'B1',
    });
    const dormant = await loadDormantAgencies({ tenantId, distributorId }, 30);
    const dormantA = dormant.find((d) => d.agencyId === agencyA);
    expect(dormantA).toBeTruthy();
  });
});
