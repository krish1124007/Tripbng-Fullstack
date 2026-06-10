// Tests for the extended SupplierSource ("Map Source") model.
//
// Covers the new fields and the enabled↔status mirroring hooks. The CRUD
// surface lives in apps/api/src/routes/supplier.routes.ts and is covered
// by the route tests in Phase 2.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Supplier } from '../src/models/Supplier.js';
import { SupplierSource } from '../src/models/SupplierSource.js';

let tenantId: Types.ObjectId;
let supplierId: Types.ObjectId;

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `ms-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Map Source Test',
    domain: 'ms.test',
  });
  tenantId = tenant._id;
  const supplier = await Supplier.create({
    tenantId,
    code: `KAFILA-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    name: 'Kafila',
    type: 'CONSOLIDATOR',
    productTypes: ['FLIGHT'],
    config: { endpoint: 'https://example.invalid' },
    status: 'ACTIVE',
  });
  supplierId = supplier._id as Types.ObjectId;
});

afterAll(async () => {
  await SupplierSource.deleteMany({ tenantId });
  await Supplier.deleteOne({ _id: supplierId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await SupplierSource.deleteMany({ tenantId });
});

describe('SupplierSource — minimal create + defaults', () => {
  it('creates a row with safe defaults for the new fields', async () => {
    const src = await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'INTERNATIONAL',
      airlineCodes: ['AI', '6E'],
    });
    // Read back to exercise the model's defaults instead of trusting
    // the create-time projection.
    const fresh = await SupplierSource.findById(src._id).lean();
    expect(fresh?.name).toBeNull();
    expect(fresh?.supplierGroup).toBeNull();
    expect(fresh?.agencyGroupIds ?? []).toEqual([]);
    expect(fresh?.maskBookingClassCodes ?? []).toEqual([]);
    expect(fresh?.maskFareTypes ?? []).toEqual([]);
    expect(fresh?.hideFareTypes ?? []).toEqual([]);
    expect(fresh?.restrictTravel).toBeDefined();
    expect(fresh?.restrictTravel?.dateFrom).toBeNull();
    expect(fresh?.manualIssuance?.pendingBooking).toBe(false);
    expect(fresh?.manualIssuance?.applyForNonStopFlight).toBe(false);
    expect(fresh?.status).toBe('ACTIVE');
    expect(fresh?.enabled).toBe(true);
  });

  it('persists masks, hides, restrictions and manual-issuance criteria', async () => {
    const src = await SupplierSource.create({
      tenantId,
      supplierId,
      name: 'Kafila International',
      supplierGroup: 'tripbng group1',
      productType: 'FLIGHT',
      travelType: 'INTERNATIONAL',
      airlineCodes: ['AI', '6E', 'QP', 'IX'],
      agencyGroupIds: [new Types.ObjectId(), new Types.ObjectId()],
      maskBookingClassCodes: [{ original: 'YA', masked: 'Y' }],
      maskFareTypes: [{ original: 'INSTANT_OFFER', masked: 'Promo' }],
      hideFareTypes: ['SME', 'Corporate'],
      restrictTravel: {
        dateFrom: new Date('2026-06-01T00:00:00.000Z'),
        dateTo: new Date('2026-12-31T00:00:00.000Z'),
        timeStartMinutes: 360, // 06:00 IST
        timeEndMinutes: 1320, // 22:00 IST
      },
      manualIssuance: {
        pendingBooking: true,
        maximumPax: 9,
        minAmountPaisePerPax: 100_000,
        maxAmountPaisePerPax: 500_000,
        tripType: 'ONEWAY',
        bookingClass: 'K,T,YJ',
        fareBasis: '1R,USAVLMIF',
        applyForNonStopFlight: true,
        applyForStopFlight: false,
        sector: 'DEL-BOM,DEL-DXB',
      },
    });
    const fresh = await SupplierSource.findById(src._id).lean();
    expect(fresh?.name).toBe('Kafila International');
    expect(fresh?.supplierGroup).toBe('tripbng group1');
    expect(fresh?.airlineCodes).toEqual(['AI', '6E', 'QP', 'IX']);
    expect(fresh?.agencyGroupIds).toHaveLength(2);
    expect(fresh?.maskBookingClassCodes).toEqual([
      expect.objectContaining({ original: 'YA', masked: 'Y' }),
    ]);
    expect(fresh?.maskFareTypes).toEqual([
      expect.objectContaining({ original: 'INSTANT_OFFER', masked: 'Promo' }),
    ]);
    expect(fresh?.hideFareTypes).toEqual(['SME', 'Corporate']);
    expect(fresh?.restrictTravel?.timeStartMinutes).toBe(360);
    expect(fresh?.manualIssuance?.pendingBooking).toBe(true);
    expect(fresh?.manualIssuance?.maximumPax).toBe(9);
    expect(fresh?.manualIssuance?.bookingClass).toBe('K,T,YJ');
    expect(fresh?.manualIssuance?.sector).toBe('DEL-BOM,DEL-DXB');
  });
});

describe('SupplierSource — status ↔ enabled mirror', () => {
  it('flipping status INACTIVE flips enabled false on save', async () => {
    const src = await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'BOTH',
    });
    expect(src.status).toBe('ACTIVE');
    expect(src.enabled).toBe(true);

    src.status = 'INACTIVE';
    await src.save();
    const fresh = await SupplierSource.findById(src._id).lean();
    expect(fresh?.status).toBe('INACTIVE');
    expect(fresh?.enabled).toBe(false);
  });

  it('flipping enabled false flips status INACTIVE on save', async () => {
    const src = await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'BOTH',
    });

    src.enabled = false;
    await src.save();
    const fresh = await SupplierSource.findById(src._id).lean();
    expect(fresh?.enabled).toBe(false);
    expect(fresh?.status).toBe('INACTIVE');
  });

  it('findOneAndUpdate { status: "INACTIVE" } also flips enabled', async () => {
    const src = await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'BOTH',
    });
    await SupplierSource.findOneAndUpdate(
      { _id: src._id },
      { $set: { status: 'INACTIVE' } },
    );
    const fresh = await SupplierSource.findById(src._id).lean();
    expect(fresh?.status).toBe('INACTIVE');
    expect(fresh?.enabled).toBe(false);
  });

  it('findOneAndUpdate { enabled: false } also flips status', async () => {
    const src = await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'BOTH',
    });
    await SupplierSource.findOneAndUpdate(
      { _id: src._id },
      { $set: { enabled: false } },
    );
    const fresh = await SupplierSource.findById(src._id).lean();
    expect(fresh?.status).toBe('INACTIVE');
    expect(fresh?.enabled).toBe(false);
  });

  it('explicit both-set still works (admin sets both deliberately)', async () => {
    const src = await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'BOTH',
      status: 'INACTIVE',
      enabled: false,
    });
    expect(src.status).toBe('INACTIVE');
    expect(src.enabled).toBe(false);
  });
});

describe('SupplierSource — index range queries', () => {
  it('queries by (tenantId, productType, status) hit the new index', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      status: 'ACTIVE',
    });
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'INTERNATIONAL',
      status: 'INACTIVE',
    });
    const active = await SupplierSource.find({
      tenantId,
      productType: 'FLIGHT',
      status: 'ACTIVE',
    }).lean();
    expect(active).toHaveLength(1);
    expect(active[0]?.travelType).toBe('DOMESTIC');
  });
});
