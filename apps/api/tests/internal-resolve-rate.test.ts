// Phase-4 — /internal/resolve-rate endpoint test.
//
// Boots a tiny Express app with just the internal router + the global
// error handler the real app uses. Exercises both the auth gate and the
// happy-path resolution end-to-end (the service layer is covered in
// detail by rate-service.test.ts; this file is here to lock the wiring).

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import request from 'supertest';
import express, { type ErrorRequestHandler } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { RateConfiguration } from '../src/models/RateConfiguration.js';
import { internalRouter } from '../src/routes/internal.routes.js';
import { AppError, ERROR_CODES } from '@tripbng/shared';

// Shared-secret matches what's pre-set in vitest.config (so env.ts picks it
// up at import time — the middleware's `env.INTERNAL_API_KEY` lookup is
// cached after the first import).
const TEST_KEY = 'test-internal-key-min-32-chars-xxxxx';

// Tiny error handler mirroring the prod one — turns AppError → JSON.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const status = ERROR_CODES[err.code]?.http ?? 500;
    res.status(status).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/internal', internalRouter);
  app.use(errorHandler);
  return app;
}

let tenantId: Types.ObjectId;
let agencyId: Types.ObjectId;

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `irt-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Internal Rate Test',
    domain: 'irt.test',
  });
  tenantId = tenant._id;
  agencyId = new Types.ObjectId();
  await Agency.create({
    _id: agencyId,
    tenantId,
    agencyCode: `IRT-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Internal Rate Test',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    module: 'CASH',
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
});

afterAll(async () => {
  await RateConfiguration.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await RateConfiguration.deleteMany({ tenantId });
});

describe('POST /internal/resolve-rate', () => {
  it('returns 401-ish (TOKEN_INVALID) when X-Internal-Key is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/internal/resolve-rate')
      .send({
        tenantId: String(tenantId),
        agencyId: String(agencyId),
        service: 'FLIGHT',
      });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('returns TOKEN_INVALID when the key is wrong', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/internal/resolve-rate')
      .set('X-Internal-Key', 'definitely-wrong-key-but-also-32+chars-long')
      .send({
        tenantId: String(tenantId),
        agencyId: String(agencyId),
        service: 'FLIGHT',
      });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('returns the resolved config + markup with the correct key', async () => {
    await RateConfiguration.create({
      tenantId,
      module: 'CASH',
      service: 'FLIGHT',
      scope: 'GLOBAL',
      markupType: 'PERCENT',
      markupBasisPoints: 500,
      isActive: true,
      validFrom: new Date(),
    });
    const app = buildApp();
    const res = await request(app)
      .post('/internal/resolve-rate')
      .set('X-Internal-Key', TEST_KEY)
      .send({
        tenantId: String(tenantId),
        agencyId: String(agencyId),
        service: 'FLIGHT',
        baseAmountPaise: 100_000,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.resolvedModule).toBe('CASH');
    expect(res.body.data.config?.module).toBe('CASH');
    expect(res.body.data.markupPaise).toBe(5_000);
  });

  it('returns 400-shape on invalid body', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/internal/resolve-rate')
      .set('X-Internal-Key', TEST_KEY)
      .send({ tenantId: 'not-an-objectid' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });
});
