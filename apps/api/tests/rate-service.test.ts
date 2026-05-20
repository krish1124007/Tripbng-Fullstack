// Phase-4 tests for the RateService — resolution priority, filter matching,
// markup computation, module mapping, and Redis cache behaviour.
//
// Tests the pure resolution layer (no Express). The route layer (auth +
// validation) is exercised separately when the `/internal/resolve-rate`
// endpoint test lands.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { RateConfiguration } from '../src/models/RateConfiguration.js';
import { redis } from '../src/config/redis.js';
import { clearRateCache, resolveRate } from '../src/services/wallet/rate.service.js';

let tenantId: Types.ObjectId;

async function makeAgency(
  module: 'CREDIT' | 'DI' | 'CASH' | 'DISTRIBUTOR' | 'SUB_AGENT',
): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await Agency.create({
    _id: id,
    tenantId,
    agencyCode: `RT-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Rate Test',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    module,
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  return id;
}

async function makeRate(opts: {
  module: 'CREDIT' | 'DI' | 'CASH';
  scope: 'GLOBAL' | 'AGENCY';
  agencyId?: Types.ObjectId | null;
  service?: 'FLIGHT' | 'HOTEL' | 'INSURANCE';
  airlines?: string[];
  sectors?: Array<{ from: string; to: string }>;
  supplierIds?: string[];
  markupType?: 'PERCENT' | 'ABSOLUTE' | 'TIERED';
  markupBasisPoints?: number;
  markupAbsolutePaise?: number;
  markupTiers?: Array<{ upToAmountPaise: number; markupBasisPoints: number }>;
  priority?: number;
  isActive?: boolean;
  validFrom?: Date;
  validTo?: Date | null;
}) {
  return RateConfiguration.create({
    tenantId,
    module: opts.module,
    service: opts.service ?? 'FLIGHT',
    scope: opts.scope,
    agencyId: opts.agencyId ?? null,
    appliesTo: {
      airlines: opts.airlines ?? [],
      sectors: opts.sectors ?? [],
      supplierIds: opts.supplierIds ?? [],
    },
    markupType: opts.markupType ?? 'PERCENT',
    markupBasisPoints: opts.markupBasisPoints ?? null,
    markupAbsolutePaise: opts.markupAbsolutePaise ?? null,
    markupTiers: opts.markupTiers ?? [],
    priority: opts.priority ?? 0,
    isActive: opts.isActive ?? true,
    validFrom: opts.validFrom ?? new Date(),
    validTo: opts.validTo ?? null,
  });
}

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `rt-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Rate Test',
    domain: 'rt.test',
  });
  tenantId = tenant._id;
});

afterAll(async () => {
  await RateConfiguration.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  // Best-effort Redis cleanup — drop test agencies' cached rates.
  const stream = redis.scanStream({ match: 'rate:*', count: 200 });
  const keys: string[] = [];
  for await (const batch of stream) keys.push(...(batch as string[]));
  if (keys.length > 0) await redis.del(...keys).catch(() => undefined);
  await disconnectMongo();
});

beforeEach(async () => {
  await RateConfiguration.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  // Clear the rate cache too so previous tests don't bleed into this one.
  const stream = redis.scanStream({ match: 'rate:*', count: 200 });
  const keys: string[] = [];
  for await (const batch of stream) keys.push(...(batch as string[]));
  if (keys.length > 0) await redis.del(...keys);
});

describe('resolveRate — priority + scope', () => {
  it('AGENCY scope wins over GLOBAL', async () => {
    const agencyId = await makeAgency('CASH');
    await makeRate({ module: 'CASH', scope: 'GLOBAL', markupBasisPoints: 100 });
    await makeRate({ module: 'CASH', scope: 'AGENCY', agencyId, markupBasisPoints: 250 });

    const r = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(r.config?.scope).toBe('AGENCY');
    expect(r.markupPaise).toBe(2_500); // 2.5% of ₹1000
  });

  it('within same scope, higher priority wins', async () => {
    const agencyId = await makeAgency('CASH');
    await makeRate({ module: 'CASH', scope: 'GLOBAL', priority: 1, markupBasisPoints: 100 });
    await makeRate({ module: 'CASH', scope: 'GLOBAL', priority: 5, markupBasisPoints: 300 });

    const r = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(r.config?.priority).toBe(5);
    expect(r.markupPaise).toBe(3_000);
  });

  it('falls back to GLOBAL when no AGENCY-scoped row exists', async () => {
    const agencyId = await makeAgency('CASH');
    await makeRate({ module: 'CASH', scope: 'GLOBAL', markupBasisPoints: 100 });

    const r = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(r.config?.scope).toBe('GLOBAL');
  });

  it('returns null config + zero markup when no rate matches', async () => {
    const agencyId = await makeAgency('CASH');
    const r = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(r.config).toBeNull();
    expect(r.markupPaise).toBe(0);
  });
});

describe('resolveRate — module mapping', () => {
  it('CREDIT agency picks CREDIT rates', async () => {
    const agencyId = await makeAgency('CREDIT');
    await makeRate({ module: 'CREDIT', scope: 'GLOBAL', markupBasisPoints: 200 });
    await makeRate({ module: 'CASH', scope: 'GLOBAL', markupBasisPoints: 100 });

    const r = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(r.config?.module).toBe('CREDIT');
    expect(r.resolvedModule).toBe('CREDIT');
  });

  it('DISTRIBUTOR maps to CASH', async () => {
    const agencyId = await makeAgency('DISTRIBUTOR');
    await makeRate({ module: 'CASH', scope: 'GLOBAL', markupBasisPoints: 150 });

    const r = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(r.resolvedModule).toBe('CASH');
    expect(r.config?.module).toBe('CASH');
  });

  it('SUB_AGENT maps to CASH (effectiveRateModule not yet implemented)', async () => {
    const agencyId = await makeAgency('SUB_AGENT');
    await makeRate({ module: 'CASH', scope: 'GLOBAL', markupBasisPoints: 150 });

    const r = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(r.resolvedModule).toBe('CASH');
  });
});

describe('resolveRate — appliesTo filters', () => {
  it('airline filter narrows to matching codes only', async () => {
    const agencyId = await makeAgency('CASH');
    await makeRate({
      module: 'CASH',
      scope: 'GLOBAL',
      airlines: ['AI'],
      markupBasisPoints: 500,
    });

    const matched = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      airline: 'AI',
      baseAmountPaise: 100_000,
    });
    expect(matched.markupPaise).toBe(5_000);

    const notMatched = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      airline: '6E',
      baseAmountPaise: 100_000,
    });
    expect(notMatched.config).toBeNull();
  });

  it('sector filter narrows by route', async () => {
    const agencyId = await makeAgency('CASH');
    await makeRate({
      module: 'CASH',
      scope: 'GLOBAL',
      sectors: [{ from: 'BOM', to: 'DEL' }],
      markupBasisPoints: 400,
    });

    const yes = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      route: { from: 'BOM', to: 'DEL' },
      baseAmountPaise: 100_000,
    });
    expect(yes.markupPaise).toBe(4_000);

    const no = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      route: { from: 'BLR', to: 'DEL' },
      baseAmountPaise: 100_000,
    });
    expect(no.config).toBeNull();
  });

  it('supplier filter narrows by supplier id', async () => {
    const agencyId = await makeAgency('CASH');
    await makeRate({
      module: 'CASH',
      scope: 'GLOBAL',
      supplierIds: ['TBO'],
      markupBasisPoints: 300,
    });

    const yes = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      supplierId: 'TBO',
      baseAmountPaise: 100_000,
    });
    expect(yes.config?.appliesTo?.supplierIds).toContain('TBO');

    const no = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      supplierId: 'AIRIQ',
      baseAmountPaise: 100_000,
    });
    expect(no.config).toBeNull();
  });
});

describe('resolveRate — markup computation', () => {
  it('PERCENT: markup = base * bp / 10000', async () => {
    const agencyId = await makeAgency('CASH');
    await makeRate({
      module: 'CASH',
      scope: 'GLOBAL',
      markupType: 'PERCENT',
      markupBasisPoints: 1800, // 18%
    });
    const r = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 50_000,
    });
    expect(r.markupPaise).toBe(9_000); // 18% of 500 = 90 → 9000 paise
  });

  it('ABSOLUTE: markup = fixed paise regardless of base', async () => {
    const agencyId = await makeAgency('CASH');
    await makeRate({
      module: 'CASH',
      scope: 'GLOBAL',
      markupType: 'ABSOLUTE',
      markupAbsolutePaise: 15_000,
    });
    const r = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 50_000,
    });
    expect(r.markupPaise).toBe(15_000);
  });

  it('TIERED: picks the first ceiling that covers the base amount', async () => {
    const agencyId = await makeAgency('CASH');
    await makeRate({
      module: 'CASH',
      scope: 'GLOBAL',
      markupType: 'TIERED',
      markupTiers: [
        { upToAmountPaise: 50_000, markupBasisPoints: 500 }, // 5% under ₹500
        { upToAmountPaise: 500_000, markupBasisPoints: 300 }, // 3% up to ₹5k
        { upToAmountPaise: 100_000_000, markupBasisPoints: 100 }, // 1% above
      ],
    });

    const small = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 30_000,
    });
    expect(small.markupPaise).toBe(1_500); // 5% of 300

    const mid = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 200_000,
    });
    expect(mid.markupPaise).toBe(6_000); // 3% of 2000
  });
});

describe('resolveRate — validity window + isActive', () => {
  it('skips inactive rows', async () => {
    const agencyId = await makeAgency('CASH');
    await makeRate({
      module: 'CASH',
      scope: 'GLOBAL',
      markupBasisPoints: 500,
      isActive: false,
    });
    const r = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(r.config).toBeNull();
  });

  it('skips rows with future validFrom or past validTo', async () => {
    const agencyId = await makeAgency('CASH');
    const future = new Date(Date.now() + 86_400_000); // tomorrow
    const past = new Date(Date.now() - 86_400_000); // yesterday
    await makeRate({
      module: 'CASH',
      scope: 'GLOBAL',
      markupBasisPoints: 500,
      validFrom: future,
    });
    await makeRate({
      module: 'CASH',
      scope: 'GLOBAL',
      markupBasisPoints: 300,
      validTo: past,
    });
    const r = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(r.config).toBeNull();
  });
});

describe('resolveRate — caching', () => {
  it('second identical call hits the cache (fromCache=true)', async () => {
    const agencyId = await makeAgency('CASH');
    await makeRate({ module: 'CASH', scope: 'GLOBAL', markupBasisPoints: 200 });

    const first = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(first.fromCache).toBe(false);

    const second = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(second.fromCache).toBe(true);
    expect(second.markupPaise).toBe(first.markupPaise);
  });

  it('cache misses are cached too (null result is sticky for 60s)', async () => {
    const agencyId = await makeAgency('CASH');
    // No rates configured.
    const first = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(first.fromCache).toBe(false);
    expect(first.config).toBeNull();

    const second = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(second.fromCache).toBe(true);
    expect(second.config).toBeNull();
  });

  it('clearRateCache invalidates entries for an agency', async () => {
    const agencyId = await makeAgency('CASH');
    await makeRate({ module: 'CASH', scope: 'GLOBAL', markupBasisPoints: 100 });

    // Warm the cache.
    await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });

    // Add a higher-priority AGENCY rate; cache still holds old result.
    await makeRate({
      module: 'CASH',
      scope: 'AGENCY',
      agencyId,
      markupBasisPoints: 500,
    });
    const stale = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(stale.fromCache).toBe(true);
    expect(stale.markupPaise).toBe(1_000); // old value

    // Now blow the cache and resolve again.
    await clearRateCache(String(agencyId));
    const fresh = await resolveRate({
      tenantId: String(tenantId),
      agencyId: String(agencyId),
      service: 'FLIGHT',
      baseAmountPaise: 100_000,
    });
    expect(fresh.fromCache).toBe(false);
    expect(fresh.markupPaise).toBe(5_000); // new agency-specific rate
  });
});
