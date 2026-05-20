// Tests for the Phase-4 Map Source search filter.
//
// Drives the service directly (no Express, no adapter fanout) — the filter
// is pure given a fixed Map Source row + a list of FanoutFareOptions, so the
// tests build minimal fixtures and assert the behaviour per rule.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Supplier } from '../src/models/Supplier.js';
import { SupplierSource } from '../src/models/SupplierSource.js';
import { AgencyGroup } from '../src/models/AgencyGroup.js';
import { applyMapSourceFilter } from '../src/services/search/map-source-filter.service.js';
import type { FanoutFareOption } from '../src/adapters/registry.js';

let tenantId: Types.ObjectId;
let supplierId: Types.ObjectId;
const SUPPLIER_CODE = 'KAFILA';

beforeAll(async () => {
  await connectMongo();
  const tenant = await Tenant.create({
    code: `msf-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Map Source Filter Test',
    domain: 'msf.test',
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
});

afterAll(async () => {
  await SupplierSource.deleteMany({ tenantId });
  await AgencyGroup.deleteMany({ tenantId });
  await Supplier.deleteOne({ _id: supplierId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await SupplierSource.deleteMany({ tenantId });
  await AgencyGroup.deleteMany({ tenantId });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

interface OptOverrides {
  airline?: string;
  fareClass?: string;
  departureIso?: string;
  supplierCode?: string;
}
function makeOption(overrides: OptOverrides = {}): FanoutFareOption {
  const airline = overrides.airline ?? 'AI';
  const departure = overrides.departureIso ?? '2026-06-15T08:00:00.000Z';
  const arrival = '2026-06-15T10:00:00.000Z';
  return {
    supplierFareId: `sf-${crypto.randomBytes(3).toString('hex')}`,
    supplierCode: overrides.supplierCode ?? SUPPLIER_CODE,
    fareClass: overrides.fareClass,
    segments: [
      {
        flightNumber: `${airline}-100`,
        airline: { code: airline, name: 'Carrier' },
        origin: { code: 'BOM' },
        destination: { code: 'DEL' },
        departure,
        arrival,
        duration: 120,
        stopOver: 0,
      },
    ],
    travelClass: 'ECONOMY',
    perPax: {
      adult: { baseFarePaise: 100_000, taxesPaise: 10_000 },
      child: { baseFarePaise: 75_000, taxesPaise: 7_500 },
      infant: { baseFarePaise: 0, taxesPaise: 0 },
    },
    refundable: true,
    source: 'API',
    supplierFareToken: 'tok',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass-through policy
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMapSourceFilter — pass-through when no Map Source matches', () => {
  it('returns options unchanged when zero Map Source rows exist', async () => {
    const opts = [makeOption(), makeOption({ airline: '6E' })];
    const result = await applyMapSourceFilter(opts, {
      tenantId: String(tenantId),
      agencyGroupIds: [],
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
    });
    expect(result.applied).toBe(false);
    expect(result.options).toHaveLength(2);
    expect(result.dropped).toEqual({});
  });

  it('returns empty when given empty input regardless of config', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      airlineCodes: ['AI'],
    });
    const result = await applyMapSourceFilter([], {
      tenantId: String(tenantId),
      agencyGroupIds: [],
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
    });
    expect(result.applied).toBe(false);
    expect(result.options).toEqual([]);
  });

  it('passes through when Map Source exists but for a different productType', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'HOTEL',
      travelType: 'DOMESTIC',
      airlineCodes: ['AI'],
    });
    const result = await applyMapSourceFilter([makeOption({ airline: '6E' })], {
      tenantId: String(tenantId),
      agencyGroupIds: [],
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
    });
    expect(result.applied).toBe(false);
    expect(result.options).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Airline whitelist
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMapSourceFilter — airline whitelist', () => {
  beforeEach(async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      airlineCodes: ['AI', '6E'], // Air India + IndiGo only
    });
  });

  it('keeps whitelisted airlines and drops others', async () => {
    const opts = [
      makeOption({ airline: 'AI' }),
      makeOption({ airline: '6E' }),
      makeOption({ airline: 'QP' }), // not whitelisted — dropped
      makeOption({ airline: 'IX' }), // not whitelisted — dropped
    ];
    const result = await applyMapSourceFilter(opts, {
      tenantId: String(tenantId),
      agencyGroupIds: [],
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
    });
    expect(result.applied).toBe(true);
    expect(result.options.map((o) => o.segments[0]!.airline.code)).toEqual(['AI', '6E']);
    expect(result.dropped).toEqual({ [SUPPLIER_CODE]: 2 });
  });

  it('matches travelType=BOTH against either DOMESTIC or INTERNATIONAL', async () => {
    await SupplierSource.deleteMany({ tenantId });
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'BOTH',
      airlineCodes: ['AI'],
    });
    const dom = await applyMapSourceFilter([makeOption({ airline: 'AI' })], {
      tenantId: String(tenantId),
      agencyGroupIds: [],
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
    });
    const intl = await applyMapSourceFilter([makeOption({ airline: 'AI' })], {
      tenantId: String(tenantId),
      agencyGroupIds: [],
      productType: 'FLIGHT',
      travelType: 'INTERNATIONAL',
    });
    expect(dom.applied).toBe(true);
    expect(intl.applied).toBe(true);
    expect(dom.options).toHaveLength(1);
    expect(intl.options).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agency-group scoping
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMapSourceFilter — agency group scoping', () => {
  let groupAId: Types.ObjectId;
  let groupBId: Types.ObjectId;

  beforeEach(async () => {
    const groupA = await AgencyGroup.create({ tenantId, name: 'Group A' });
    const groupB = await AgencyGroup.create({ tenantId, name: 'Group B' });
    groupAId = groupA._id as Types.ObjectId;
    groupBId = groupB._id as Types.ObjectId;
  });

  it('Map Source with empty agencyGroupIds applies to all agencies', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      airlineCodes: ['AI'],
      agencyGroupIds: [],
    });
    // Agency belongs to no groups → still matched by an "applies to all" Map Source.
    const result = await applyMapSourceFilter(
      [makeOption({ airline: 'AI' }), makeOption({ airline: '6E' })],
      {
        tenantId: String(tenantId),
        agencyGroupIds: [],
        productType: 'FLIGHT',
        travelType: 'DOMESTIC',
      },
    );
    expect(result.applied).toBe(true);
    expect(result.options).toHaveLength(1);
    expect(result.options[0]?.segments[0]?.airline.code).toBe('AI');
  });

  it('passes through when no Map Source covers the agent’s groups', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      airlineCodes: ['AI'],
      agencyGroupIds: [groupAId],
    });
    // Agent is in Group B — no matching Map Source — pass-through (additive default).
    const result = await applyMapSourceFilter([makeOption({ airline: '6E' })], {
      tenantId: String(tenantId),
      agencyGroupIds: [String(groupBId)],
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
    });
    expect(result.applied).toBe(false);
    expect(result.options).toHaveLength(1);
  });

  it('filters when the agent belongs to at least one of the Map Source’s groups', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      airlineCodes: ['AI'],
      agencyGroupIds: [groupAId],
    });
    const result = await applyMapSourceFilter(
      [makeOption({ airline: 'AI' }), makeOption({ airline: 'QP' })],
      {
        tenantId: String(tenantId),
        agencyGroupIds: [String(groupAId), String(groupBId)],
        productType: 'FLIGHT',
        travelType: 'DOMESTIC',
      },
    );
    expect(result.applied).toBe(true);
    expect(result.options).toHaveLength(1);
    expect(result.options[0]?.segments[0]?.airline.code).toBe('AI');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mask + hide fare types
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMapSourceFilter — mask + hide', () => {
  it('rewrites fareClass through maskBookingClassCodes', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      airlineCodes: ['AI'],
      maskBookingClassCodes: [{ original: 'YA', masked: 'Y' }],
    });
    const result = await applyMapSourceFilter(
      [makeOption({ airline: 'AI', fareClass: 'YA' }), makeOption({ airline: 'AI', fareClass: 'M' })],
      {
        tenantId: String(tenantId),
        agencyGroupIds: [],
        productType: 'FLIGHT',
        travelType: 'DOMESTIC',
      },
    );
    expect(result.applied).toBe(true);
    expect(result.options).toHaveLength(2);
    expect(result.options[0]?.fareClass).toBe('Y'); // rewritten
    expect(result.options[1]?.fareClass).toBe('M'); // unchanged — no mask entry matches
    expect(result.masked).toBe(1);
  });

  it('drops options whose (post-mask) fareClass is in hideFareTypes', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      airlineCodes: ['AI'],
      hideFareTypes: ['SME'],
    });
    const result = await applyMapSourceFilter(
      [
        makeOption({ airline: 'AI', fareClass: 'REGULAR' }),
        makeOption({ airline: 'AI', fareClass: 'SME' }),
        makeOption({ airline: 'AI', fareClass: 'sme' }), // case-insensitive
      ],
      {
        tenantId: String(tenantId),
        agencyGroupIds: [],
        productType: 'FLIGHT',
        travelType: 'DOMESTIC',
      },
    );
    expect(result.applied).toBe(true);
    expect(result.options.map((o) => o.fareClass)).toEqual(['REGULAR']);
  });

  it('passes options whose fareClass is undefined when only hide rules exist', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      airlineCodes: ['AI'],
      hideFareTypes: ['SME'],
    });
    const result = await applyMapSourceFilter(
      [makeOption({ airline: 'AI' })], // no fareClass set
      {
        tenantId: String(tenantId),
        agencyGroupIds: [],
        productType: 'FLIGHT',
        travelType: 'DOMESTIC',
      },
    );
    expect(result.options).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Restrict travel window
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMapSourceFilter — restrictTravel', () => {
  it('drops options outside dateFrom / dateTo', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      airlineCodes: ['AI'],
      restrictTravel: {
        dateFrom: new Date('2026-06-01T00:00:00.000Z'),
        dateTo: new Date('2026-06-30T23:59:59.000Z'),
      },
    });
    const result = await applyMapSourceFilter(
      [
        makeOption({ airline: 'AI', departureIso: '2026-05-15T08:00:00.000Z' }), // before
        makeOption({ airline: 'AI', departureIso: '2026-06-15T08:00:00.000Z' }), // inside — keep
        makeOption({ airline: 'AI', departureIso: '2026-07-15T08:00:00.000Z' }), // after
      ],
      {
        tenantId: String(tenantId),
        agencyGroupIds: [],
        productType: 'FLIGHT',
        travelType: 'DOMESTIC',
      },
    );
    expect(result.options).toHaveLength(1);
    expect(result.options[0]?.segments[0]?.departure).toBe('2026-06-15T08:00:00.000Z');
  });

  it('drops options outside the IST intra-day time window', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      airlineCodes: ['AI'],
      restrictTravel: {
        timeStartMinutes: 360, // 06:00 IST
        timeEndMinutes: 1320, // 22:00 IST
      },
    });
    // UTC 00:00 → IST 05:30 → before window (drop)
    // UTC 03:00 → IST 08:30 → inside window (keep)
    // UTC 17:30 → IST 23:00 → after window (drop)
    const result = await applyMapSourceFilter(
      [
        makeOption({ airline: 'AI', departureIso: '2026-06-15T00:00:00.000Z' }),
        makeOption({ airline: 'AI', departureIso: '2026-06-15T03:00:00.000Z' }),
        makeOption({ airline: 'AI', departureIso: '2026-06-15T17:30:00.000Z' }),
      ],
      {
        tenantId: String(tenantId),
        agencyGroupIds: [],
        productType: 'FLIGHT',
        travelType: 'DOMESTIC',
      },
    );
    expect(result.options).toHaveLength(1);
    expect(result.options[0]?.segments[0]?.departure).toBe('2026-06-15T03:00:00.000Z');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multiple Map Sources for the same supplier
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMapSourceFilter — multiple Map Source rows union the whitelist', () => {
  it('union of airlines across matching rows + INACTIVE rows ignored', async () => {
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      airlineCodes: ['AI'],
      name: 'Kafila Domestic A',
    });
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'BOTH',
      airlineCodes: ['6E', 'IX'],
      name: 'Kafila Both',
    });
    // Inactive row — should be ignored.
    await SupplierSource.create({
      tenantId,
      supplierId,
      productType: 'FLIGHT',
      travelType: 'DOMESTIC',
      airlineCodes: ['QP'],
      status: 'INACTIVE',
      name: 'Kafila Disabled',
    });
    const result = await applyMapSourceFilter(
      [
        makeOption({ airline: 'AI' }),
        makeOption({ airline: '6E' }),
        makeOption({ airline: 'IX' }),
        makeOption({ airline: 'QP' }), // dropped — only INACTIVE row whitelisted
      ],
      {
        tenantId: String(tenantId),
        agencyGroupIds: [],
        productType: 'FLIGHT',
        travelType: 'DOMESTIC',
      },
    );
    expect(result.options.map((o) => o.segments[0]!.airline.code).sort()).toEqual(['6E', 'AI', 'IX']);
  });
});
