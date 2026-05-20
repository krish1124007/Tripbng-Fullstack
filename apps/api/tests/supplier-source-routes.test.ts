// End-to-end tests for the Map Source admin REST surface
// (Phase 2 of the admin panel spec).
//
// Boots a tiny Express app with just the supplier router + the global
// error handler. Walks a SUPER_ADMIN user through create / list / get /
// update / delete on `/suppliers/sources/...`, exercising the auth gate,
// validation, tenant scoping, agency-group cross-tenant guard, and the
// status ↔ enabled mirror.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import request from 'supertest';
import express, { type ErrorRequestHandler } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Supplier } from '../src/models/Supplier.js';
import { SupplierSource } from '../src/models/SupplierSource.js';
import { AgencyGroup } from '../src/models/AgencyGroup.js';
import { User } from '../src/models/User.js';
import { supplierRouter } from '../src/routes/supplier.routes.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { AppError, ERROR_CODES } from '@tripbng/shared';

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const status = ERROR_CODES[err.code]?.http ?? 500;
    res.status(status).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/suppliers', supplierRouter);
  app.use(errorHandler);
  return app;
}

let tenantId: Types.ObjectId;
let otherTenantId: Types.ObjectId;
let supplierId: Types.ObjectId;
let agencyGroupAId: Types.ObjectId;
let agencyGroupBId: Types.ObjectId;
let foreignAgencyGroupId: Types.ObjectId;
let adminToken: string;

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `msr-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Map Source Routes Test',
    domain: 'msr.test',
  });
  tenantId = tenant._id;
  const other = await Tenant.create({
    code: `msr-other-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Other Tenant',
    domain: 'other.test',
  });
  otherTenantId = other._id;

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

  const groupA = await AgencyGroup.create({ tenantId, name: 'tripbng group1' });
  const groupB = await AgencyGroup.create({ tenantId, name: 'TAMIL NADU' });
  const foreign = await AgencyGroup.create({ tenantId: otherTenantId, name: 'foreign' });
  agencyGroupAId = groupA._id as Types.ObjectId;
  agencyGroupBId = groupB._id as Types.ObjectId;
  foreignAgencyGroupId = foreign._id as Types.ObjectId;

  // A real SUPER_ADMIN user — the auth middleware looks the user up by id and
  // verifies status + reads custom permissions, so a stub JWT alone isn't
  // enough; the row has to exist.
  const adminUser = await User.create({
    tenantId,
    userCode: 'MSR-ADM-1',
    role: 'SUPER_ADMIN',
    email: 'admin@msr.test',
    mobile: '+919999999990',
    fullName: 'Map Source Admin',
    passwordHash: 'x'.repeat(60),
    status: 'ACTIVE',
  });
  adminToken = signAccessToken({
    sub: String(adminUser._id),
    role: 'SUPER_ADMIN',
    agencyId: null,
    distributorId: null,
  });
});

afterAll(async () => {
  await SupplierSource.deleteMany({ tenantId });
  await AgencyGroup.deleteMany({ tenantId });
  await AgencyGroup.deleteMany({ tenantId: otherTenantId });
  await Supplier.deleteOne({ _id: supplierId });
  await User.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await Tenant.deleteOne({ _id: otherTenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await SupplierSource.deleteMany({ tenantId });
});

const auth = () => ({ Authorization: `Bearer ${adminToken}` });

describe('POST /suppliers/sources — create Map Source', () => {
  it('rejects unauthenticated requests', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/suppliers/sources')
      .send({
        supplierId: String(supplierId),
        productType: 'FLIGHT',
        travelType: 'INTERNATIONAL',
      });
    expect(res.status).toBe(401);
  });

  it('creates a minimal Map Source row', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/suppliers/sources')
      .set(auth())
      .send({
        supplierId: String(supplierId),
        productType: 'FLIGHT',
        travelType: 'INTERNATIONAL',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();

    const fresh = await SupplierSource.findById(res.body.data.id).lean();
    expect(fresh?.tenantId.toString()).toBe(String(tenantId));
    expect(fresh?.status).toBe('ACTIVE');
    expect(fresh?.enabled).toBe(true);
  });

  it('persists the full Map Source payload', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/suppliers/sources')
      .set(auth())
      .send({
        name: 'Kafila International',
        supplierGroup: 'tripbng group1',
        supplierId: String(supplierId),
        productType: 'FLIGHT',
        travelType: 'INTERNATIONAL',
        airlineCodes: ['AI', '6E', 'QP'],
        agencyGroupIds: [String(agencyGroupAId), String(agencyGroupBId)],
        maskBookingClassCodes: [{ original: 'YA', masked: 'Y' }],
        maskFareTypes: [{ original: 'INSTANT_OFFER', masked: 'Promo' }],
        hideFareTypes: ['SME'],
        restrictTravel: { timeStartMinutes: 360, timeEndMinutes: 1320 },
        manualIssuance: {
          pendingBooking: true,
          maximumPax: 9,
          minAmountPaisePerPax: 100_000,
          maxAmountPaisePerPax: 500_000,
          applyForNonStopFlight: true,
          applyForStopFlight: false,
          sector: 'DEL-BOM',
          tripType: 'ONEWAY',
        },
        priority: 50,
      });
    expect(res.status).toBe(201);
    const fresh = await SupplierSource.findById(res.body.data.id).lean();
    expect(fresh?.name).toBe('Kafila International');
    expect(fresh?.supplierGroup).toBe('tripbng group1');
    expect(fresh?.airlineCodes).toEqual(['AI', '6E', 'QP']);
    expect(fresh?.agencyGroupIds?.map((id) => id.toString())).toEqual([
      String(agencyGroupAId),
      String(agencyGroupBId),
    ]);
    expect(fresh?.maskBookingClassCodes?.[0]?.original).toBe('YA');
    expect(fresh?.hideFareTypes).toEqual(['SME']);
    expect(fresh?.manualIssuance?.pendingBooking).toBe(true);
    expect(fresh?.manualIssuance?.sector).toBe('DEL-BOM');
    expect(fresh?.priority).toBe(50);
  });

  it('rejects when supplierId does not belong to the caller tenant', async () => {
    const app = buildApp();
    const fakeId = new Types.ObjectId();
    const res = await request(app)
      .post('/suppliers/sources')
      .set(auth())
      .send({
        supplierId: String(fakeId),
        productType: 'FLIGHT',
        travelType: 'INTERNATIONAL',
      });
    expect(res.status).toBe(404);
  });

  it('rejects when agencyGroupIds reference another tenant', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/suppliers/sources')
      .set(auth())
      .send({
        supplierId: String(supplierId),
        productType: 'FLIGHT',
        travelType: 'INTERNATIONAL',
        agencyGroupIds: [String(foreignAgencyGroupId)],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects manual-issuance with min > max amounts', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/suppliers/sources')
      .set(auth())
      .send({
        supplierId: String(supplierId),
        productType: 'FLIGHT',
        travelType: 'INTERNATIONAL',
        manualIssuance: {
          pendingBooking: true,
          minAmountPaisePerPax: 500_000,
          maxAmountPaisePerPax: 100_000,
        },
      });
    expect(res.status).toBe(400);
  });
});

describe('GET /suppliers/sources — list with filters', () => {
  beforeEach(async () => {
    await SupplierSource.deleteMany({ tenantId });
    await SupplierSource.create([
      {
        tenantId,
        supplierId,
        name: 'Kafila International',
        supplierGroup: 'tripbng group1',
        productType: 'FLIGHT',
        travelType: 'INTERNATIONAL',
        status: 'ACTIVE',
        airlineCodes: ['AI', '6E'],
      },
      {
        tenantId,
        supplierId,
        name: 'Kafila Domestic',
        supplierGroup: 'tripbng group1',
        productType: 'FLIGHT',
        travelType: 'DOMESTIC',
        status: 'INACTIVE',
        airlineCodes: ['6E', 'QP'],
      },
    ]);
  });

  it('returns hydrated rows', async () => {
    const app = buildApp();
    const res = await request(app).get('/suppliers/sources').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const intl = res.body.data.find((r: { name: string }) => r.name === 'Kafila International');
    expect(intl.supplierName).toBe('Kafila');
    expect(intl.supplierCode).toMatch(/^KAFILA-/);
    expect(intl.airlineCodes).toEqual(['AI', '6E']);
    expect(intl.status).toBe('ACTIVE');
  });

  it('filters by status', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/suppliers/sources?status=ACTIVE')
      .set(auth());
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].travelType).toBe('INTERNATIONAL');
  });

  it('filters by travelType', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/suppliers/sources?travelType=DOMESTIC')
      .set(auth());
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Kafila Domestic');
  });

  it('text search matches by Map Source name', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/suppliers/sources?q=international')
      .set(auth());
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Kafila International');
  });

  it('returns hydrated agency-group names', async () => {
    await SupplierSource.deleteMany({ tenantId });
    await SupplierSource.create({
      tenantId,
      supplierId,
      name: 'With Groups',
      productType: 'FLIGHT',
      travelType: 'BOTH',
      agencyGroupIds: [agencyGroupAId, agencyGroupBId],
    });
    const app = buildApp();
    const res = await request(app).get('/suppliers/sources').set(auth());
    expect(res.body.data[0].agencyGroupNames.sort()).toEqual(['TAMIL NADU', 'tripbng group1']);
  });
});

describe('GET /suppliers/sources/:id — single row for the edit form', () => {
  it('returns the full payload including masks + manual issuance', async () => {
    const src = await SupplierSource.create({
      tenantId,
      supplierId,
      name: 'Detail row',
      productType: 'FLIGHT',
      travelType: 'INTERNATIONAL',
      maskBookingClassCodes: [{ original: 'YA', masked: 'Y' }],
      manualIssuance: { pendingBooking: true, maximumPax: 4 },
    });
    const app = buildApp();
    const res = await request(app)
      .get(`/suppliers/sources/${src._id}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Detail row');
    expect(res.body.data.maskBookingClassCodes[0]).toMatchObject({ original: 'YA', masked: 'Y' });
    expect(res.body.data.manualIssuance.pendingBooking).toBe(true);
    expect(res.body.data.manualIssuance.maximumPax).toBe(4);
  });

  it('404s on a foreign tenant id', async () => {
    const foreign = await SupplierSource.create({
      tenantId: otherTenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'INTERNATIONAL',
    });
    const app = buildApp();
    const res = await request(app)
      .get(`/suppliers/sources/${foreign._id}`)
      .set(auth());
    expect(res.status).toBe(404);
    await SupplierSource.deleteOne({ _id: foreign._id });
  });
});

describe('PATCH /suppliers/sources/:id — update Map Source', () => {
  it('updates the row and flips status / enabled together', async () => {
    const src = await SupplierSource.create({
      tenantId,
      supplierId,
      name: 'before',
      productType: 'FLIGHT',
      travelType: 'BOTH',
      status: 'ACTIVE',
    });
    const app = buildApp();
    const res = await request(app)
      .patch(`/suppliers/sources/${src._id}`)
      .set(auth())
      .send({ name: 'after', status: 'INACTIVE' });
    expect(res.status).toBe(200);
    const fresh = await SupplierSource.findById(src._id).lean();
    expect(fresh?.name).toBe('after');
    expect(fresh?.status).toBe('INACTIVE');
    expect(fresh?.enabled).toBe(false);
  });

  it('rejects update referencing another tenant’s agency group', async () => {
    const src = await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'BOTH',
    });
    const app = buildApp();
    const res = await request(app)
      .patch(`/suppliers/sources/${src._id}`)
      .set(auth())
      .send({ agencyGroupIds: [String(foreignAgencyGroupId)] });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /suppliers/sources/:id', () => {
  it('deletes the row', async () => {
    const src = await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'BOTH',
    });
    const app = buildApp();
    const res = await request(app)
      .delete(`/suppliers/sources/${src._id}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(await SupplierSource.findById(src._id)).toBeNull();
  });

  it('404s when the row is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .delete(`/suppliers/sources/${new Types.ObjectId()}`)
      .set(auth());
    expect(res.status).toBe(404);
  });
});
