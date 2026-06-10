// Phase-6 tests — MapPolicy model defaults + admin REST endpoints.
//
// Mirrors the supplier-source-routes.test.ts shape: tiny Express app
// mounted with just the map-policy router + an error handler that turns
// AppError into the wire envelope. Real SUPER_ADMIN user → JWT signed
// with the test secret so the auth middleware passes.

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
import { MapPolicy } from '../src/models/MapPolicy.js';
import { mapPolicyRouter } from '../src/routes/map-policy.routes.js';
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
  app.use('/map-policies', mapPolicyRouter);
  app.use(errorHandler);
  return app;
}

let tenantId: Types.ObjectId;
let otherTenantId: Types.ObjectId;
let mapSourceId: Types.ObjectId;
let foreignMapSourceId: Types.ObjectId;
let agencyGroupAId: Types.ObjectId;
let agencyGroupBId: Types.ObjectId;
let foreignAgencyGroupId: Types.ObjectId;
let adminToken: string;

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `mp-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Map Policy Test',
    domain: 'mp.test',
  });
  tenantId = tenant._id;
  const other = await Tenant.create({
    code: `mp-other-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Other Tenant',
    domain: 'mpo.test',
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
  const src = await SupplierSource.create({
    tenantId,
    supplierId: supplier._id,
    name: 'Kafila International',
    productType: 'FLIGHT',
    travelType: 'INTERNATIONAL',
  });
  mapSourceId = src._id as Types.ObjectId;
  const otherSrc = await SupplierSource.create({
    tenantId: otherTenantId,
    supplierId: supplier._id,
    name: 'Foreign Source',
    productType: 'FLIGHT',
    travelType: 'DOMESTIC',
  });
  foreignMapSourceId = otherSrc._id as Types.ObjectId;

  const groupA = await AgencyGroup.create({ tenantId, name: 'tripbng group1' });
  const groupB = await AgencyGroup.create({ tenantId, name: 'TAMIL NADU' });
  const fg = await AgencyGroup.create({ tenantId: otherTenantId, name: 'foreign' });
  agencyGroupAId = groupA._id as Types.ObjectId;
  agencyGroupBId = groupB._id as Types.ObjectId;
  foreignAgencyGroupId = fg._id as Types.ObjectId;

  const admin = await User.create({
    tenantId,
    userCode: 'MP-ADM',
    role: 'SUPER_ADMIN',
    email: 'admin@mp.test',
    mobile: '+919999999991',
    fullName: 'Map Policy Admin',
    passwordHash: 'x'.repeat(60),
    status: 'ACTIVE',
  });
  adminToken = signAccessToken({
    sub: String(admin._id),
    role: 'SUPER_ADMIN',
    agencyId: null,
    distributorId: null,
  });
});

afterAll(async () => {
  await MapPolicy.deleteMany({});
  await SupplierSource.deleteMany({});
  await AgencyGroup.deleteMany({});
  await Supplier.deleteMany({});
  await User.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await Tenant.deleteOne({ _id: otherTenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await MapPolicy.deleteMany({ tenantId });
});

const auth = () => ({ Authorization: `Bearer ${adminToken}` });

// ─────────────────────────────────────────────────────────────────────────────
// Model defaults
// ─────────────────────────────────────────────────────────────────────────────

describe('MapPolicy model — defaults + morePayoutAny hook', () => {
  it('creates a row with safe defaults for every component', async () => {
    const p = await MapPolicy.create({
      tenantId,
      name: 'minimal',
      productType: 'FLIGHT',
    });
    const fresh = await MapPolicy.findById(p._id).lean();
    expect(fresh?.status).toBe('ACTIVE');
    expect(fresh?.commission?.enabled).toBe(false);
    expect(fresh?.commission?.payoutPercent).toBe(0);
    expect(fresh?.plb?.enabled).toBe(false);
    expect(fresh?.b2bMarkup?.enabled).toBe(false);
    expect(fresh?.b2bMarkup?.valueType).toBe('ABSOLUTE');
    expect(fresh?.managementFee?.enabled).toBe(false);
    expect(fresh?.criteria?.airlineCodes).toEqual([]);
    expect(fresh?.morePayoutAny).toBe(false);
  });

  it('keeps morePayoutAny in sync via the pre-save hook', async () => {
    const p = await MapPolicy.create({
      tenantId,
      name: '70% PASS',
      productType: 'FLIGHT',
      commission: { enabled: true, payoutPercent: 70, morePayout: true },
    });
    expect(p.morePayoutAny).toBe(true);

    p.commission.morePayout = false;
    await p.save();
    const after = await MapPolicy.findById(p._id).lean();
    expect(after?.morePayoutAny).toBe(false);
  });

  it('keeps morePayoutAny in sync via the findOneAndUpdate hook', async () => {
    const p = await MapPolicy.create({
      tenantId,
      name: 'plb only',
      productType: 'FLIGHT',
      plb: { enabled: true, payoutPercent: 5, morePayout: true },
    });
    expect(p.morePayoutAny).toBe(true);
    await MapPolicy.findOneAndUpdate(
      { _id: p._id },
      { $set: { plb: { enabled: true, payoutPercent: 5, morePayout: false } } },
    );
    const after = await MapPolicy.findById(p._id).lean();
    expect(after?.morePayoutAny).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /map-policies
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /map-policies', () => {
  it('rejects unauthenticated requests', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/map-policies')
      .send({ name: 'no auth', productType: 'FLIGHT' });
    expect(res.status).toBe(401);
  });

  it('creates a minimal policy', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/map-policies')
      .set(auth())
      .send({ name: 'Kafila IndiGo', productType: 'FLIGHT' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    const fresh = await MapPolicy.findById(res.body.data.id).lean();
    expect(fresh?.tenantId.toString()).toBe(String(tenantId));
    expect(fresh?.status).toBe('ACTIVE');
  });

  it('persists the full payload (commission + management fee + criteria)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/map-policies')
      .set(auth())
      .send({
        name: '70% PASS',
        productType: 'FLIGHT',
        commission: { enabled: true, name: 'Standard', payoutPercent: 70 },
        managementFee: {
          enabled: true,
          name: 'IDRS',
          valueType: 'ABSOLUTE',
          value: 1000,
          hideFromAgent: false,
        },
        criteria: {
          mapSourceIds: [String(mapSourceId)],
          airlineCodes: ['6E'],
          fareTypes: ['Regular'],
          agencyGroupIds: [String(agencyGroupAId)],
        },
      });
    expect(res.status).toBe(201);
    const fresh = await MapPolicy.findById(res.body.data.id).lean();
    expect(fresh?.commission?.enabled).toBe(true);
    expect(fresh?.commission?.payoutPercent).toBe(70);
    expect(fresh?.managementFee?.value).toBe(1000);
    expect(fresh?.criteria?.airlineCodes).toEqual(['6E']);
    expect(fresh?.criteria?.fareTypes).toEqual(['Regular']);
    expect(fresh?.criteria?.mapSourceIds?.map((id) => id.toString())).toEqual([
      String(mapSourceId),
    ]);
  });

  it('rejects mapSourceIds from another tenant', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/map-policies')
      .set(auth())
      .send({
        name: 'x',
        productType: 'FLIGHT',
        criteria: { mapSourceIds: [String(foreignMapSourceId)] },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects agencyGroupIds from another tenant', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/map-policies')
      .set(auth())
      .send({
        name: 'x',
        productType: 'FLIGHT',
        criteria: { agencyGroupIds: [String(foreignAgencyGroupId)] },
      });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /map-policies
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /map-policies', () => {
  beforeEach(async () => {
    await MapPolicy.deleteMany({ tenantId });
    await MapPolicy.create([
      {
        tenantId,
        name: '70% PASS',
        productType: 'FLIGHT',
        status: 'ACTIVE',
        commission: { enabled: true, payoutPercent: 70, morePayout: true },
        criteria: {
          mapSourceIds: [mapSourceId],
          agencyGroupIds: [agencyGroupAId],
        },
      },
      {
        tenantId,
        name: 'Hotels markup',
        productType: 'HOTEL',
        status: 'INACTIVE',
      },
    ]);
  });

  it('returns hydrated rows with mapSourceNames + agencyGroupNames', async () => {
    const app = buildApp();
    const res = await request(app).get('/map-policies').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const flight = res.body.data.find((p: { name: string }) => p.name === '70% PASS');
    expect(flight.morePayoutAny).toBe(true);
    expect(flight.mapSourceNames).toEqual(['Kafila International']);
    expect(flight.agencyGroupNames).toEqual(['tripbng group1']);
  });

  it('filters by productType', async () => {
    const app = buildApp();
    const res = await request(app).get('/map-policies?productType=HOTEL').set(auth());
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Hotels markup');
  });

  it('filters by status', async () => {
    const app = buildApp();
    const res = await request(app).get('/map-policies?status=ACTIVE').set(auth());
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('70% PASS');
  });

  it('text-searches by policy name', async () => {
    const app = buildApp();
    const res = await request(app).get('/map-policies?q=hotels').set(auth());
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Hotels markup');
  });

  it('filters by mapSourceId', async () => {
    const app = buildApp();
    const res = await request(app)
      .get(`/map-policies?mapSourceId=${String(mapSourceId)}`)
      .set(auth());
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('70% PASS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /map-policies/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /map-policies/:id', () => {
  it('returns the full payload', async () => {
    const p = await MapPolicy.create({
      tenantId,
      name: 'detail',
      productType: 'FLIGHT',
      managementFee: { enabled: true, valueType: 'PERCENT', value: 5 },
      criteria: { agencyGroupIds: [agencyGroupBId] },
    });
    const app = buildApp();
    const res = await request(app).get(`/map-policies/${p._id}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('detail');
    expect(res.body.data.managementFee.value).toBe(5);
    expect(res.body.data.agencyGroupNames).toEqual(['TAMIL NADU']);
  });

  it('404s on foreign tenant id', async () => {
    const foreign = await MapPolicy.create({
      tenantId: otherTenantId,
      name: 'foreign',
      productType: 'FLIGHT',
    });
    const app = buildApp();
    const res = await request(app).get(`/map-policies/${foreign._id}`).set(auth());
    expect(res.status).toBe(404);
    await MapPolicy.deleteOne({ _id: foreign._id });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH + DELETE
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /map-policies/:id', () => {
  it('updates fields and refreshes morePayoutAny', async () => {
    const p = await MapPolicy.create({
      tenantId,
      name: 'before',
      productType: 'FLIGHT',
      commission: { enabled: true, payoutPercent: 50, morePayout: false },
    });
    const app = buildApp();
    const res = await request(app)
      .patch(`/map-policies/${p._id}`)
      .set(auth())
      .send({
        name: 'after',
        commission: { enabled: true, payoutPercent: 60, morePayout: true },
      });
    expect(res.status).toBe(200);
    const fresh = await MapPolicy.findById(p._id).lean();
    expect(fresh?.name).toBe('after');
    expect(fresh?.commission?.payoutPercent).toBe(60);
    expect(fresh?.morePayoutAny).toBe(true);
  });

  it('rejects update referencing foreign mapSourceId', async () => {
    const p = await MapPolicy.create({ tenantId, name: 'x', productType: 'FLIGHT' });
    const app = buildApp();
    const res = await request(app)
      .patch(`/map-policies/${p._id}`)
      .set(auth())
      .send({ criteria: { mapSourceIds: [String(foreignMapSourceId)] } });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /map-policies/:id', () => {
  it('drops the row', async () => {
    const p = await MapPolicy.create({ tenantId, name: 'doomed', productType: 'FLIGHT' });
    const app = buildApp();
    const res = await request(app).delete(`/map-policies/${p._id}`).set(auth());
    expect(res.status).toBe(200);
    expect(await MapPolicy.findById(p._id)).toBeNull();
  });

  it('404s when the row is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .delete(`/map-policies/${new Types.ObjectId()}`)
      .set(auth());
    expect(res.status).toBe(404);
  });
});
