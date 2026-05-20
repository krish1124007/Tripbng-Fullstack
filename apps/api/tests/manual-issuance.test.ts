// Phase 5 — manual-issuance matcher + confirmBooking routing + admin
// issueManually transition.
//
// Tests the matcher in isolation (mostly pure math given a SupplierSource
// row + a Booking digest) plus the confirmBooking integration that lands
// matched bookings in PENDING_MANUAL.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Supplier } from '../src/models/Supplier.js';
import { SupplierSource } from '../src/models/SupplierSource.js';
import { AgencyGroup } from '../src/models/AgencyGroup.js';
import { Agency } from '../src/models/Agency.js';
import { Distributor } from '../src/models/Distributor.js';
import { User } from '../src/models/User.js';
import { Booking, type BookingDoc } from '../src/models/Booking.js';
import {
  matchManualIssuance,
} from '../src/services/booking/manual-issuance-matcher.service.js';
import { issueManually } from '../src/services/booking.service.js';
import { AppError } from '@tripbng/shared';

let tenantId: Types.ObjectId;
let supplierId: Types.ObjectId;
let agencyId: Types.ObjectId;
let distributorId: Types.ObjectId;
let userId: Types.ObjectId;
const SUPPLIER_CODE = 'KAFILA';

interface BookingOverrides {
  pax?: number;
  totalPaise?: number;
  tripType?: 'ONEWAY' | 'ROUNDTRIP' | 'MULTICITY';
  sector?: string;
  travelDate?: Date;
  stopOver?: number;
  segments?: number; // count
  supplierCode?: string;
  agencyId?: Types.ObjectId;
}

async function makeBooking(overrides: BookingOverrides = {}): Promise<BookingDoc> {
  const pax = overrides.pax ?? 1;
  const total = overrides.totalPaise ?? 200_000;
  const sector = overrides.sector ?? 'BOM-DEL';
  const tripType = overrides.tripType ?? 'ONEWAY';
  const travelDate = overrides.travelDate ?? new Date('2026-06-15T08:00:00.000Z');
  const stopOver = overrides.stopOver ?? 0;
  const segmentCount = overrides.segments ?? 1;
  const segments = Array.from({ length: segmentCount }).map((_, i) => ({
    flightNumber: `AI-${100 + i}`,
    airline: { code: 'AI', name: 'Air India' },
    origin: { code: i === 0 ? 'BOM' : 'BLR' },
    destination: { code: i === segmentCount - 1 ? 'DEL' : 'BLR' },
    departure: travelDate,
    arrival: new Date(travelDate.getTime() + 2 * 3600 * 1000),
    duration: 120,
    stopOver,
  }));
  const passengers = Array.from({ length: pax }).map((_, i) => ({
    type: 'ADULT' as const,
    title: 'MR',
    firstName: `Pax${i}`,
    lastName: 'Test',
  }));
  return Booking.create({
    tenantId,
    bookingCode: `BK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    channel: 'ONLINE',
    flowSubType: 'LCC',
    productType: 'FLIGHT',
    supplierCode: overrides.supplierCode ?? SUPPLIER_CODE,
    agencyId: overrides.agencyId ?? agencyId,
    agencyCode: 'AT000001',
    agencyName: 'Test Agency',
    distributorId,
    bookedByUserId: userId,
    sector,
    travelDate,
    tripType,
    travelClass: 'ECONOMY',
    segments,
    passengers,
    pricing: { agencyPayablePaise: total },
    status: 'HOLD',
  });
}

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `mi-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Manual Issuance Test',
    domain: 'mi.test',
  });
  tenantId = tenant._id;

  const supplier = await Supplier.create({
    tenantId,
    code: SUPPLIER_CODE,
    name: 'Kafila',
    type: 'CONSOLIDATOR',
    productTypes: ['FLIGHT'],
    config: { endpoint: 'https://example.invalid' },
    status: 'ACTIVE',
  });
  supplierId = supplier._id as Types.ObjectId;

  const user = await User.create({
    tenantId,
    userCode: 'MI-USER-1',
    role: 'AGENCY',
    email: 'agent@mi.test',
    mobile: '+910000000099',
    fullName: 'Agent',
    passwordHash: 'x'.repeat(60),
    status: 'ACTIVE',
  });
  userId = user._id as Types.ObjectId;

  const distributor = await Distributor.create({
    tenantId,
    distributorCode: 'D-MI-1',
    companyName: 'Dist',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    ownerUserId: user._id,
    walletBalance: 0,
    status: 'ACTIVE',
  });
  distributorId = distributor._id as Types.ObjectId;

  const agency = await Agency.create({
    tenantId,
    agencyCode: 'A-MI-1',
    companyName: 'Agency',
    state: 'MH',
    city: 'Pune',
    pincode: '411001',
    address: 'x',
    distributorId: distributor._id,
    ownerUserId: user._id,
    walletBalance: 0,
    status: 'ACTIVE',
  });
  agencyId = agency._id as Types.ObjectId;
});

afterAll(async () => {
  await Booking.deleteMany({ tenantId });
  await SupplierSource.deleteMany({ tenantId });
  await AgencyGroup.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Distributor.deleteMany({ tenantId });
  await User.deleteMany({ tenantId });
  await Supplier.deleteOne({ _id: supplierId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await Booking.deleteMany({ tenantId });
  await SupplierSource.deleteMany({ tenantId });
});

// ─────────────────────────────────────────────────────────────────────────────
// matchManualIssuance
// ─────────────────────────────────────────────────────────────────────────────

describe('matchManualIssuance — pass-through cases', () => {
  it('no matching Map Source → matched=false', async () => {
    const booking = await makeBooking();
    const result = await matchManualIssuance(booking, {
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      agencyGroupIds: [],
    });
    expect(result.matched).toBe(false);
    expect(result.mapSourceId).toBeNull();
  });

  it('Map Source with pendingBooking=false is ignored even when criteria match', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
      manualIssuance: { pendingBooking: false, maximumPax: 9 },
    });
    const booking = await makeBooking();
    const result = await matchManualIssuance(booking, {
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      agencyGroupIds: [],
    });
    expect(result.matched).toBe(false);
  });

  it('Map Source for the wrong supplier is ignored', async () => {
    // A different supplier, same tenant.
    const other = await Supplier.create({
      tenantId,
      code: 'OTHER',
      name: 'Other',
      type: 'CONSOLIDATOR',
      productTypes: ['FLIGHT'],
      config: { endpoint: 'https://example.invalid' },
      status: 'ACTIVE',
    });
    await SupplierSource.create({
      tenantId,
      supplierId: other._id,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
      manualIssuance: { pendingBooking: true },
    });
    const booking = await makeBooking(); // supplierCode = KAFILA
    const result = await matchManualIssuance(booking, {
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      agencyGroupIds: [],
    });
    expect(result.matched).toBe(false);
    await Supplier.deleteOne({ _id: other._id });
  });

  it('INACTIVE Map Source is ignored', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'INACTIVE',
      manualIssuance: { pendingBooking: true },
    });
    const booking = await makeBooking();
    const result = await matchManualIssuance(booking, {
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      agencyGroupIds: [],
    });
    expect(result.matched).toBe(false);
  });
});

describe('matchManualIssuance — criteria gates', () => {
  it('matches with the master switch + no criteria (all null)', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      name: 'Kafila Manual',
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
      manualIssuance: { pendingBooking: true },
    });
    const booking = await makeBooking();
    const result = await matchManualIssuance(booking, {
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      agencyGroupIds: [],
    });
    expect(result.matched).toBe(true);
    expect(result.mapSourceId).toBeTruthy();
    expect(result.reason).toMatch(/Kafila Manual/);
  });

  it('respects maximumPax — fails when pax exceeds', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
      manualIssuance: { pendingBooking: true, maximumPax: 2 },
    });
    const ok = await makeBooking({ pax: 2 });
    const fail = await makeBooking({ pax: 3 });
    expect((await matchManualIssuance(ok, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(true);
    expect((await matchManualIssuance(fail, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(false);
  });

  it('respects min/max per-pax amount', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
      manualIssuance: {
        pendingBooking: true,
        minAmountPaisePerPax: 100_000,
        maxAmountPaisePerPax: 300_000,
      },
    });
    // 1 pax × 50k → below min
    const below = await makeBooking({ pax: 1, totalPaise: 50_000 });
    // 1 pax × 200k → inside window
    const inside = await makeBooking({ pax: 1, totalPaise: 200_000 });
    // 1 pax × 500k → above max
    const above = await makeBooking({ pax: 1, totalPaise: 500_000 });
    expect((await matchManualIssuance(below, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(false);
    expect((await matchManualIssuance(inside, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(true);
    expect((await matchManualIssuance(above, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(false);
  });

  it('respects tripType (Map Source uses ROUND_TRIP; Booking uses ROUNDTRIP)', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
      manualIssuance: { pendingBooking: true, tripType: 'ROUND_TRIP' },
    });
    const rt = await makeBooking({ tripType: 'ROUNDTRIP' });
    const ow = await makeBooking({ tripType: 'ONEWAY' });
    expect((await matchManualIssuance(rt, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(true);
    expect((await matchManualIssuance(ow, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(false);
  });

  it('respects sector list (case-insensitive)', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
      manualIssuance: { pendingBooking: true, sector: 'BOM-DEL,DEL-DXB' },
    });
    const yes = await makeBooking({ sector: 'BOM-DEL' });
    const no = await makeBooking({ sector: 'BLR-MAA' });
    expect((await matchManualIssuance(yes, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(true);
    expect((await matchManualIssuance(no, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(false);
  });

  it('respects travel-date window', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
      manualIssuance: {
        pendingBooking: true,
        fromDate: new Date('2026-06-01T00:00:00.000Z'),
        toDate: new Date('2026-06-30T23:59:59.000Z'),
      },
    });
    const before = await makeBooking({ travelDate: new Date('2026-05-15T08:00:00.000Z') });
    const inside = await makeBooking({ travelDate: new Date('2026-06-15T08:00:00.000Z') });
    const after = await makeBooking({ travelDate: new Date('2026-07-15T08:00:00.000Z') });
    expect((await matchManualIssuance(before, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(false);
    expect((await matchManualIssuance(inside, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(true);
    expect((await matchManualIssuance(after, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(false);
  });

  it('respects applyForNonStopFlight / applyForStopFlight narrowing', async () => {
    // Non-stop only.
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
      manualIssuance: {
        pendingBooking: true,
        applyForNonStopFlight: true,
        applyForStopFlight: false,
      },
    });
    const direct = await makeBooking({ segments: 1, stopOver: 0 });
    const connecting = await makeBooking({ segments: 2 });
    expect((await matchManualIssuance(direct, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(true);
    expect((await matchManualIssuance(connecting, { tenantId: String(tenantId), agencyId: String(agencyId), agencyGroupIds: [] })).matched).toBe(false);
  });

  it('surfaces bookingClass / fareBasis as skippedFields when Booking lacks the data', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
      manualIssuance: {
        pendingBooking: true,
        bookingClass: 'K,T',
        fareBasis: 'USAVLMIF',
      },
    });
    const booking = await makeBooking();
    const result = await matchManualIssuance(booking, {
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      agencyGroupIds: [],
    });
    // Booking has no fareClass / fareBasis fields today — match still
    // succeeds (the other criteria are all null) but diagnostics flag what
    // was uncheckable.
    expect(result.matched).toBe(true);
    expect(result.skippedFields.sort()).toEqual(['bookingClass', 'fareBasis']);
  });
});

describe('matchManualIssuance — agency-group scoping', () => {
  it('row scoped to a group an agency doesn\'t belong to → no match', async () => {
    const group = await AgencyGroup.create({ tenantId, name: 'Group X' });
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
      agencyGroupIds: [group._id],
      manualIssuance: { pendingBooking: true },
    });
    const booking = await makeBooking();
    const result = await matchManualIssuance(booking, {
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      agencyGroupIds: [], // agent not in Group X
    });
    expect(result.matched).toBe(false);
  });

  it('row scoped to a group the agency IS in → match', async () => {
    const group = await AgencyGroup.create({ tenantId, name: 'Group Y' });
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
      agencyGroupIds: [group._id],
      manualIssuance: { pendingBooking: true },
    });
    const booking = await makeBooking();
    const result = await matchManualIssuance(booking, {
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      agencyGroupIds: [String(group._id)],
    });
    expect(result.matched).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// issueManually — admin transition PENDING_MANUAL → TICKETED
// ─────────────────────────────────────────────────────────────────────────────

describe('issueManually', () => {
  async function pendingBooking(): Promise<BookingDoc> {
    const b = await makeBooking();
    b.status = 'PENDING_MANUAL';
    b.paymentStatus = 'PAID';
    await b.save();
    return b;
  }

  it('stamps PNR + ticket numbers and transitions to TICKETED', async () => {
    const b = await pendingBooking();
    const result = await issueManually(
      {
        tenantId: String(tenantId),
        userId: String(userId),
        role: 'SUPER_ADMIN',
        agencyId: String(agencyId),
        distributorId: null,
        ipAddress: null,
      },
      String(b._id),
      {
        pnr: 'AI123ABC',
        ticketNumbers: ['098-2345678901'],
        supplierBookingRef: 'SUP-REF-001',
        note: 'Issued via Sabre',
      },
    );
    expect(result.status).toBe('TICKETED');
    expect(result.pnr).toBe('AI123ABC');
    expect(result.ticketNumbers).toEqual(['098-2345678901']);
    expect(result.supplierBookingRef).toBe('SUP-REF-001');
    expect(result.ticketedAt).toBeTruthy();
    expect(result.internalNotes).toMatch(/Issued via Sabre/);
  });

  it('rejects non-PENDING_MANUAL bookings', async () => {
    const b = await makeBooking();
    // Default status is HOLD.
    await expect(
      issueManually(
        {
          tenantId: String(tenantId),
          userId: String(userId),
          role: 'SUPER_ADMIN',
          agencyId: String(agencyId),
          distributorId: null,
          ipAddress: null,
        },
        String(b._id),
        { pnr: 'X', ticketNumbers: ['Y'] },
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects bookings from another tenant', async () => {
    const otherTenant = await Tenant.create({
      code: `mi-other-${crypto.randomBytes(3).toString('hex')}`,
      name: 'Other',
      domain: 'other.test',
    });
    const b = await pendingBooking();
    await expect(
      issueManually(
        {
          tenantId: String(otherTenant._id),
          userId: String(userId),
          role: 'SUPER_ADMIN',
          agencyId: '',
          distributorId: null,
          ipAddress: null,
        },
        String(b._id),
        { pnr: 'X', ticketNumbers: ['Y'] },
      ),
    ).rejects.toBeInstanceOf(AppError);
    await Tenant.deleteOne({ _id: otherTenant._id });
  });
});
