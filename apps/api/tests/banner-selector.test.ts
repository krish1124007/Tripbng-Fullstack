// Integration tests for the deterministic banner selector. Runs against a
// real Mongo instance (same convention as booking.test.ts) so we exercise
// the full Mongoose query — schedule windows, agency/distributor targeting,
// and priority/weighted-pick math.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Banner } from '../src/models/Banner.js';
import { Booking, type BookingDoc } from '../src/models/Booking.js';
import { Counter } from '../src/models/Counter.js';
import { selectBannerForBooking } from '../src/services/ticket/bannerSelector.js';

process.env.MONGO_URI = 'mongodb://localhost:27017/tripbng_b2b_test_banner';

const tenantA = new Types.ObjectId();
const tenantB = new Types.ObjectId();
const distributorX = new Types.ObjectId();

async function reset(): Promise<void> {
  await Promise.all([
    Banner.deleteMany({}),
    Booking.deleteMany({}),
    Counter.deleteMany({}),
  ]);
}

/** Build a minimal booking doc that satisfies the schema. We only care about
 *  the fields the selector reads: tenantId, distributorId, _id. Everything
 *  else is filled with placeholder values. */
async function makeBooking(opts: {
  tenantId: Types.ObjectId;
  distributorId?: Types.ObjectId | null;
}): Promise<BookingDoc> {
  // Idempotency key set explicitly per booking to avoid the partial-index
  // null-collision behaviour we hit when multiple bookings exist in one test.
  const idempotencyKey = 'idem-' + Math.random().toString(36).slice(2, 14);
  return Booking.create({
    tenantId: opts.tenantId,
    bookingCode: 'TBNG-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
    idempotencyKey,
    channel: 'ONLINE',
    flowSubType: 'LCC',
    productType: 'FLIGHT',
    fareName: 'SkySaver',
    fareNameDescription: '',
    inventoryId: null,
    supplierCode: 'MOCK',
    supplierBookingRef: 'MOCK-' + Date.now(),
    pnr: null,
    airlinePnr: null,
    ticketNumbers: [],
    agencyId: new Types.ObjectId(),
    agencyCode: 'AGY-001',
    agencyName: 'Test Agency',
    distributorId: opts.distributorId ?? null,
    bookedByUserId: new Types.ObjectId(),
    sector: 'BOM-DEL',
    travelDate: new Date(),
    tripType: 'ONEWAY',
    travelClass: 'ECONOMY',
    segments: [
      {
        flightNumber: '6E 123',
        airline: { code: '6E', name: 'IndiGo' },
        origin: { code: 'BOM' },
        destination: { code: 'DEL' },
        departure: new Date(),
        arrival: new Date(Date.now() + 90 * 60 * 1000),
        duration: 90,
        stopOver: 0,
      },
    ],
    passengers: [
      {
        type: 'ADULT',
        title: 'MR',
        firstName: 'Test',
        lastName: 'Buyer',
      },
    ],
    contact: { email: 'test@x.com', mobile: '9999999999' },
    pricing: {
      baseFarePaise: 100000,
      taxesPaise: 10000,
      policyAdjustmentPaise: 0,
      platformMarkupPaise: 0,
      distributorMarkupPaise: 0,
      agencyMarkupPaise: 0,
      discountPaise: 0,
      gstPaise: 0,
      grossAmountPaise: 110000,
      netToSupplierPaise: 110000,
      agencyPayablePaise: 110000,
      distributorEarningsPaise: 0,
      platformEarningsPaise: 0,
      currency: 'INR',
    },
    status: 'TICKETED',
    paymentMode: 'WALLET',
    paymentStatus: 'PAID',
    seatsConsumed: 1,
  } as Parameters<typeof Booking.create>[0]);
}

interface BannerSeed {
  title?: string;
  tenantId?: Types.ObjectId;
  location?: string;
  active?: boolean;
  priority?: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  agencyGroupIds?: Types.ObjectId[];
  distributorIds?: Types.ObjectId[];
  imageUrl?: string;
}

async function makeBanner(seed: BannerSeed = {}) {
  return Banner.create({
    tenantId: seed.tenantId ?? tenantA,
    title: seed.title ?? 'Banner ' + Math.random().toString(36).slice(2, 6),
    imageUrl: seed.imageUrl ?? 'https://cdn.example.com/banner.png',
    href: 'https://example.com/offer',
    body: null,
    type: 'FIXED',
    location: seed.location ?? 'TICKET_FOOTER',
    target: 'ALL',
    agencyGroupIds: seed.agencyGroupIds ?? [],
    distributorIds: seed.distributorIds ?? [],
    frequency: 'PER_SESSION',
    priority: seed.priority ?? 100,
    startsAt: seed.startsAt === undefined ? new Date(Date.now() - 86400000) : seed.startsAt,
    endsAt: seed.endsAt === undefined ? new Date(Date.now() + 86400000) : seed.endsAt,
    active: seed.active ?? true,
  });
}

describe('selectBannerForBooking', () => {
  beforeAll(async () => {
    await connectMongo();
  });
  afterAll(async () => {
    await reset();
    await disconnectMongo();
  });
  beforeEach(reset);

  it('returns null when no banners are seeded', async () => {
    const booking = await makeBooking({ tenantId: tenantA });
    const picked = await selectBannerForBooking(booking);
    expect(picked).toBeNull();
  });

  it('returns the only matching banner', async () => {
    await makeBanner({ title: 'Solo' });
    const booking = await makeBooking({ tenantId: tenantA });
    const picked = await selectBannerForBooking(booking);
    expect(picked?.title).toBe('Solo');
  });

  it('honours tenant scoping — never matches another tenant', async () => {
    await makeBanner({ tenantId: tenantB, title: 'Other-tenant' });
    const booking = await makeBooking({ tenantId: tenantA });
    const picked = await selectBannerForBooking(booking);
    expect(picked).toBeNull();
  });

  it('skips banners outside their schedule window', async () => {
    await makeBanner({
      title: 'Expired',
      startsAt: new Date(Date.now() - 30 * 86400000),
      endsAt: new Date(Date.now() - 1 * 86400000),
    });
    await makeBanner({
      title: 'Upcoming',
      startsAt: new Date(Date.now() + 1 * 86400000),
      endsAt: new Date(Date.now() + 30 * 86400000),
    });
    const booking = await makeBooking({ tenantId: tenantA });
    const picked = await selectBannerForBooking(booking);
    expect(picked).toBeNull();
  });

  it('skips inactive banners', async () => {
    await makeBanner({ title: 'Inactive', active: false });
    const booking = await makeBooking({ tenantId: tenantA });
    const picked = await selectBannerForBooking(booking);
    expect(picked).toBeNull();
  });

  it('skips banners on a different location (e.g. AGENCY_DASHBOARD)', async () => {
    await makeBanner({ title: 'Dashboard banner', location: 'AGENCY_DASHBOARD' });
    const booking = await makeBooking({ tenantId: tenantA });
    const picked = await selectBannerForBooking(booking);
    expect(picked).toBeNull();
  });

  it('picks the highest-priority banner among multiple matches', async () => {
    await makeBanner({ title: 'Low', priority: 50 });
    await makeBanner({ title: 'High', priority: 900 });
    await makeBanner({ title: 'Mid', priority: 500 });
    const booking = await makeBooking({ tenantId: tenantA });
    const picked = await selectBannerForBooking(booking);
    expect(picked?.title).toBe('High');
  });

  it('is deterministic across re-downloads when banners share priority', async () => {
    // Two banners at the same priority — pick must be stable per booking id.
    await makeBanner({ title: 'A-tied', priority: 100 });
    await makeBanner({ title: 'B-tied', priority: 100 });
    const booking = await makeBooking({ tenantId: tenantA });
    const first = await selectBannerForBooking(booking);
    const second = await selectBannerForBooking(booking);
    expect(first?.title).toBe(second?.title);
    expect(['A-tied', 'B-tied']).toContain(first?.title);
  });

  it('respects distributor targeting — non-empty list excludes others', async () => {
    const otherDistributor = new Types.ObjectId();
    await makeBanner({ title: 'X-only', distributorIds: [distributorX] });
    // Booking from a different distributor should NOT match.
    const wrongDistBooking = await makeBooking({
      tenantId: tenantA,
      distributorId: otherDistributor,
    });
    expect(await selectBannerForBooking(wrongDistBooking)).toBeNull();
    // Booking from the targeted distributor SHOULD match.
    const rightDistBooking = await makeBooking({
      tenantId: tenantA,
      distributorId: distributorX,
    });
    const picked = await selectBannerForBooking(rightDistBooking);
    expect(picked?.title).toBe('X-only');
  });

  it('matches when distributor list is empty (means "all distributors")', async () => {
    await makeBanner({ title: 'Universal' });
    const booking = await makeBooking({
      tenantId: tenantA,
      distributorId: distributorX,
    });
    const picked = await selectBannerForBooking(booking);
    expect(picked?.title).toBe('Universal');
  });
});
