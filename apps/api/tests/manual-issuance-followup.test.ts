// Phase-B tests for the manual-issuance follow-up worker.
//
// Covers:
//   - pickTier (pure) — tier ladder + sub-threshold returns null.
//   - runManualIssuanceFollowup integration — picks up stale PENDING_MANUAL,
//     skips fresh ones, dedupes within a tier window, escalates to the
//     next tier when the booking ages past the threshold.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Booking, type BookingDoc } from '../src/models/Booking.js';
import { redis } from '../src/config/redis.js';
import {
  pickTier,
  runManualIssuanceFollowup,
} from '../src/services/booking/manual-issuance-followup.service.js';

let tenantId: Types.ObjectId;

async function makePendingManualBooking(opts: {
  /** Subtract this many hours from `now` for the booking's updatedAt. */
  pendingHours: number;
  status?: string;
  internalNotes?: string;
}): Promise<BookingDoc> {
  const code = `PM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const past = new Date(Date.now() - opts.pendingHours * 60 * 60 * 1000);
  const doc = await Booking.create({
    tenantId,
    bookingCode: code,
    channel: 'ONLINE',
    flowSubType: 'LCC',
    productType: 'FLIGHT',
    supplierCode: 'KAFILA',
    agencyId: new Types.ObjectId(),
    agencyCode: 'AT-MI-001',
    agencyName: 'Followup Test Agency',
    bookedByUserId: new Types.ObjectId(),
    sector: 'BOM-DEL',
    travelDate: new Date('2026-08-01T08:00:00.000Z'),
    tripType: 'ONEWAY',
    travelClass: 'ECONOMY',
    segments: [
      {
        flightNumber: 'AI-101',
        airline: { code: 'AI', name: 'Air India' },
        origin: { code: 'BOM' },
        destination: { code: 'DEL' },
        departure: new Date('2026-08-01T08:00:00.000Z'),
        arrival: new Date('2026-08-01T10:00:00.000Z'),
        duration: 120,
        stopOver: 0,
      },
    ],
    passengers: [{ type: 'ADULT', title: 'MR', firstName: 'Pax', lastName: 'A' }],
    pricing: { agencyPayablePaise: 250_000 },
    status: opts.status ?? 'PENDING_MANUAL',
    internalNotes: opts.internalNotes ?? null,
  });

  // Force updatedAt back in time. Mongoose's timestamps plugin runs again
  // on save(), so we use updateOne with timestamps:false to land an
  // explicit value the followup sweep will see.
  await Booking.collection.updateOne(
    { _id: doc._id },
    { $set: { updatedAt: past, createdAt: past } },
  );
  return doc;
}

async function clearRedisDedupe(): Promise<void> {
  const stream = redis.scanStream({
    match: 'manual-issuance-followup:fired:*',
    count: 200,
  });
  const keys: string[] = [];
  for await (const batch of stream) keys.push(...(batch as string[]));
  if (keys.length > 0) await redis.del(...keys).catch(() => undefined);
}

beforeAll(async () => {
  await connectMongo();
  const t = await Tenant.create({
    code: `mif-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Manual Issuance Followup',
    domain: 'mif.test',
  });
  tenantId = t._id;
});

afterAll(async () => {
  await Booking.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await clearRedisDedupe();
  await disconnectMongo();
});

beforeEach(async () => {
  await Booking.deleteMany({ tenantId });
  await clearRedisDedupe();
});

describe('pickTier — pure', () => {
  it('returns null below the lowest threshold', () => {
    expect(pickTier(0)).toBeNull();
    expect(pickTier(1)).toBeNull();
    expect(pickTier(3.9)).toBeNull();
  });

  it('REMINDER at 4-11h', () => {
    expect(pickTier(4)).toBe('REMINDER');
    expect(pickTier(11)).toBe('REMINDER');
  });

  it('ESCALATION at 12-23h', () => {
    expect(pickTier(12)).toBe('ESCALATION');
    expect(pickTier(23)).toBe('ESCALATION');
  });

  it('CRITICAL at 24-47h', () => {
    expect(pickTier(24)).toBe('CRITICAL');
    expect(pickTier(47)).toBe('CRITICAL');
  });

  it('CRITICAL_HIGH at 48h and beyond', () => {
    expect(pickTier(48)).toBe('CRITICAL_HIGH');
    expect(pickTier(168)).toBe('CRITICAL_HIGH'); // a week stuck
  });
});

describe('runManualIssuanceFollowup — integration', () => {
  it('fires on a booking parked > 4h in PENDING_MANUAL', async () => {
    await makePendingManualBooking({ pendingHours: 5 });
    const r = await runManualIssuanceFollowup({ tenantId: String(tenantId) });
    expect(r.scannedBookings).toBe(1);
    expect(r.firedReminders).toBe(1);
    expect(r.skippedTooFresh).toBe(0);
  });

  it('skips bookings parked < 4h', async () => {
    await makePendingManualBooking({ pendingHours: 2 });
    const r = await runManualIssuanceFollowup({ tenantId: String(tenantId) });
    // The Mongo updatedAt $lte filter excludes < 4h bookings up front —
    // they don't appear in the scan.
    expect(r.scannedBookings).toBe(0);
    expect(r.firedReminders).toBe(0);
  });

  it('does not touch non-PENDING_MANUAL bookings', async () => {
    await makePendingManualBooking({ pendingHours: 10, status: 'TICKETED' });
    const r = await runManualIssuanceFollowup({ tenantId: String(tenantId) });
    expect(r.scannedBookings).toBe(0);
    expect(r.firedReminders).toBe(0);
  });

  it('dedupes a second tick within the tier window', async () => {
    await makePendingManualBooking({ pendingHours: 6 });

    const first = await runManualIssuanceFollowup({ tenantId: String(tenantId) });
    expect(first.firedReminders).toBe(1);

    const second = await runManualIssuanceFollowup({ tenantId: String(tenantId) });
    expect(second.firedReminders).toBe(0);
    expect(second.skippedDeduped).toBe(1);
  });

  it('escalates to the next tier when the booking ages past the threshold', async () => {
    const booking = await makePendingManualBooking({ pendingHours: 5 });
    const first = await runManualIssuanceFollowup({ tenantId: String(tenantId) });
    expect(first.firedReminders).toBe(1);

    // Age the booking to 13h pending (now on the ESCALATION tier). The
    // dedupe key is per (bookingId, tier) so the ESCALATION fire is fresh.
    const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000);
    await Booking.collection.updateOne(
      { _id: booking._id },
      { $set: { updatedAt: thirteenHoursAgo } },
    );

    const second = await runManualIssuanceFollowup({ tenantId: String(tenantId) });
    expect(second.firedReminders).toBe(1);
    expect(second.skippedDeduped).toBe(0);
  });
});
