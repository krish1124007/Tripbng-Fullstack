// Phase-16 — distributor-context resolver tests.
//
// Verifies the read-side seam that abstracts over today's two-collection
// representation of distributors (standalone Distributor vs. Agency with
// module=DISTRIBUTOR). When the unification migration eventually flips,
// only the resolution-order branches inside the resolver change — these
// tests pin the public contract so callers stay put.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Distributor } from '../src/models/Distributor.js';
import {
  isDistributor,
  resolveDistributorContext,
  resolveDistributorContexts,
} from '../src/services/wallet/distributor-context.js';

let tenantId: Types.ObjectId;

async function makeDistributor(): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await Distributor.create({
    _id: id,
    tenantId,
    distributorCode: `DIST-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Standalone Distributor',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  return id;
}

async function makeDistributorShapedAgency(): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await Agency.create({
    _id: id,
    tenantId,
    agencyCode: `AGY-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Unified Distributor (Agency row)',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    module: 'DISTRIBUTOR',
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  return id;
}

async function makePlainAgency(): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await Agency.create({
    _id: id,
    tenantId,
    agencyCode: `AGY-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Plain Agency',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    module: 'CASH',
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  return id;
}

beforeAll(async () => {
  await connectMongo();
  const t = await Tenant.create({
    code: `dc-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Distributor Context Test',
    domain: 'dc.test',
  });
  tenantId = t._id;
});

afterAll(async () => {
  await Distributor.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await Distributor.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
});

describe('resolveDistributorContext (single)', () => {
  it('returns a context with source=distributor for a standalone Distributor row', async () => {
    const id = await makeDistributor();
    const ctx = await resolveDistributorContext(id);
    expect(ctx).not.toBeNull();
    expect(ctx!.source).toBe('distributor');
    expect(ctx!.id).toBe(String(id));
    expect(ctx!.code.startsWith('DIST-')).toBe(true);
  });

  it('returns source=agency for an Agency row with module=DISTRIBUTOR', async () => {
    const id = await makeDistributorShapedAgency();
    const ctx = await resolveDistributorContext(id);
    expect(ctx).not.toBeNull();
    expect(ctx!.source).toBe('agency');
    expect(ctx!.id).toBe(String(id));
    expect(ctx!.code.startsWith('AGY-')).toBe(true);
  });

  it('returns null for an Agency that is NOT module=DISTRIBUTOR', async () => {
    const id = await makePlainAgency();
    const ctx = await resolveDistributorContext(id);
    expect(ctx).toBeNull();
  });

  it('returns null for an id that exists in neither collection', async () => {
    const ctx = await resolveDistributorContext(new Types.ObjectId());
    expect(ctx).toBeNull();
  });

  it('accepts a string ObjectId argument', async () => {
    const id = await makeDistributor();
    const ctx = await resolveDistributorContext(String(id));
    expect(ctx).not.toBeNull();
    expect(ctx!.source).toBe('distributor');
  });
});

describe('resolveDistributorContexts (batch)', () => {
  it('resolves a mixed batch — Distributor + Agency unified — in one Map', async () => {
    const a = await makeDistributor();
    const b = await makeDistributorShapedAgency();
    const c = await makePlainAgency();
    const result = await resolveDistributorContexts([a, b, c]);
    expect(result.size).toBe(2);
    expect(result.get(String(a))!.source).toBe('distributor');
    expect(result.get(String(b))!.source).toBe('agency');
    // Plain agency is absent from the Map — caller checks .has().
    expect(result.has(String(c))).toBe(false);
  });

  it('empty input returns an empty Map', async () => {
    const result = await resolveDistributorContexts([]);
    expect(result.size).toBe(0);
  });

  it('all-missing input returns an empty Map (no throw)', async () => {
    const result = await resolveDistributorContexts([
      new Types.ObjectId(),
      new Types.ObjectId(),
    ]);
    expect(result.size).toBe(0);
  });

  it('Distributor wins when an id somehow exists in BOTH collections (collision safety)', async () => {
    // Construct a collision: same _id in both. Should never happen in
    // production but the resolver must not double-emit or get confused.
    const id = new Types.ObjectId();
    await Distributor.create({
      _id: id,
      tenantId,
      distributorCode: `DIST-${crypto.randomBytes(4).toString('hex')}`,
      companyName: 'Distributor wins',
      state: 'MH',
      city: 'Mumbai',
      pincode: '400001',
      address: 'x',
      status: 'ACTIVE',
      ownerUserId: new Types.ObjectId(),
    });
    await Agency.create({
      _id: id,
      tenantId,
      agencyCode: `AGY-${crypto.randomBytes(4).toString('hex')}`,
      companyName: 'Agency loses',
      state: 'MH',
      city: 'Mumbai',
      pincode: '400001',
      address: 'x',
      module: 'DISTRIBUTOR',
      status: 'ACTIVE',
      ownerUserId: new Types.ObjectId(),
    });
    const result = await resolveDistributorContexts([id]);
    expect(result.size).toBe(1);
    expect(result.get(String(id))!.source).toBe('distributor');
    expect(result.get(String(id))!.companyName).toBe('Distributor wins');
  });
});

describe('isDistributor', () => {
  it('returns true for a standalone Distributor', async () => {
    const id = await makeDistributor();
    expect(await isDistributor(id)).toBe(true);
  });

  it('returns true for an Agency with module=DISTRIBUTOR', async () => {
    const id = await makeDistributorShapedAgency();
    expect(await isDistributor(id)).toBe(true);
  });

  it('returns false for a plain agency', async () => {
    const id = await makePlainAgency();
    expect(await isDistributor(id)).toBe(false);
  });

  it('returns false for an unknown id', async () => {
    expect(await isDistributor(new Types.ObjectId())).toBe(false);
  });
});
