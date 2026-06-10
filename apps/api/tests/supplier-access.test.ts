import { describe, it, expect } from 'vitest';
import {
  airlineAllowed,
  evaluateSupplierAccess,
  type AccessInput,
  type CandidateSupplier,
  type MapRow,
  type SourceRow,
} from '../src/services/supplier-access/resolver.js';
import { travelTypeForRequest } from '../src/services/supplier-access/index.js';
import type { SearchRequest } from '@tripbng/shared';

// ── Factories ────────────────────────────────────────────────────────────────
const SUP_A = '507f1f77bcf86cd799439011';
const SUP_B = '507f1f77bcf86cd799439012';
const GROUP_GOLD = '607f1f77bcf86cd799439021';
const GROUP_SILVER = '607f1f77bcf86cd799439022';

const candidate = (over: Partial<CandidateSupplier> = {}): CandidateSupplier => ({
  code: 'ETRAV',
  supplierId: SUP_A,
  status: 'ACTIVE',
  ...over,
});

const source = (over: Partial<SourceRow> = {}): SourceRow => ({
  supplierId: SUP_A,
  productType: 'FLIGHT',
  travelType: 'BOTH',
  airlineCodes: [],
  enabled: true,
  ...over,
});

const map = (over: Partial<MapRow> = {}): MapRow => ({
  productType: 'FLIGHT',
  travelType: 'BOTH',
  supplierIds: [],
  agencyGroupIds: [],
  airlineCodes: [],
  dateStart: null,
  dateEnd: null,
  allowPendingBooking: false,
  status: 'ACTIVE',
  ...over,
});

const input = (over: Partial<AccessInput> = {}): AccessInput => ({
  productType: 'FLIGHT',
  travelType: 'DOMESTIC',
  travelDate: new Date('2026-07-15'),
  agencyGroupIds: [GROUP_GOLD],
  candidates: [candidate()],
  sources: [],
  maps: [],
  ...over,
});

// ── Fail-open: nothing configured ────────────────────────────────────────────
describe('evaluateSupplierAccess — fail-open', () => {
  it('allows every active candidate when no sources and no maps exist', () => {
    const d = evaluateSupplierAccess(
      input({ candidates: [candidate({ code: 'ETRAV' }), candidate({ code: 'TBO', supplierId: SUP_B })] }),
    );
    expect(d.allowedCodes.sort()).toEqual(['ETRAV', 'TBO']);
    expect(d.byCode.ETRAV.allowedAirlines).toBeNull();
    expect(d.byCode.ETRAV.allowPendingBooking).toBe(true);
  });

  it('allows env-registered adapters that have no Supplier row', () => {
    const d = evaluateSupplierAccess(
      input({ candidates: [candidate({ code: 'SERIES', supplierId: null, status: null })] }),
    );
    expect(d.byCode.SERIES.allowed).toBe(true);
  });
});

// ── Layer 1: Supplier Active ─────────────────────────────────────────────────
describe('layer 1 — supplier active', () => {
  it('denies a supplier whose DB row is PAUSED', () => {
    const d = evaluateSupplierAccess(input({ candidates: [candidate({ status: 'PAUSED' })] }));
    expect(d.byCode.ETRAV.allowed).toBe(false);
    expect(d.byCode.ETRAV.reason).toBe('SUPPLIER_INACTIVE');
  });

  it('denies a DISABLED supplier even when a mapping would otherwise allow it', () => {
    const d = evaluateSupplierAccess(
      input({ candidates: [candidate({ status: 'DISABLED' })], maps: [map({ supplierIds: [SUP_A] })] }),
    );
    expect(d.byCode.ETRAV.reason).toBe('SUPPLIER_INACTIVE');
  });
});

// ── Layer 2: Source Active ───────────────────────────────────────────────────
describe('layer 2 — source active', () => {
  it('denies when the supplier has only disabled sources', () => {
    const d = evaluateSupplierAccess(input({ sources: [source({ enabled: false })] }));
    expect(d.byCode.ETRAV.reason).toBe('SOURCE_INACTIVE');
  });

  it('denies when no source matches the search travel type', () => {
    const d = evaluateSupplierAccess(
      input({ travelType: 'INTERNATIONAL', sources: [source({ travelType: 'DOMESTIC' })] }),
    );
    expect(d.byCode.ETRAV.reason).toBe('SOURCE_INACTIVE');
  });

  it('passes a supplier with an enabled matching source and carries its airline list', () => {
    const d = evaluateSupplierAccess(
      input({ sources: [source({ airlineCodes: ['6E', 'AI'] })] }),
    );
    expect(d.byCode.ETRAV.allowed).toBe(true);
    expect(d.byCode.ETRAV.allowedAirlines).toEqual(['6E', 'AI']);
  });

  it('does not gate a supplier that has no source rows at all (fail-open)', () => {
    const d = evaluateSupplierAccess(
      input({ candidates: [candidate({ code: 'TBO', supplierId: SUP_B })], sources: [source()] }),
    );
    // Source rows exist for SUP_A only; SUP_B has none → not blocked by layer 2.
    expect(d.byCode.TBO.allowed).toBe(true);
  });
});

// ── Layers 3 & 4: Mapping + Agency ───────────────────────────────────────────
describe('layers 3 & 4 — mapping + agency', () => {
  it('switches to enforcement once any active map exists and denies unmatched suppliers', () => {
    const d = evaluateSupplierAccess(
      input({
        candidates: [candidate({ code: 'ETRAV' }), candidate({ code: 'TBO', supplierId: SUP_B })],
        maps: [map({ supplierIds: [SUP_A] })],
      }),
    );
    expect(d.byCode.ETRAV.allowed).toBe(true);
    expect(d.byCode.TBO.allowed).toBe(false);
    expect(d.byCode.TBO.reason).toBe('MAPPING_DENIED');
  });

  it('an INACTIVE map does not trigger enforcement (fail-open stays on)', () => {
    const d = evaluateSupplierAccess(input({ maps: [map({ status: 'INACTIVE', supplierIds: [SUP_B] })] }));
    expect(d.byCode.ETRAV.allowed).toBe(true);
  });

  it('denies when the travel date falls outside the rule window', () => {
    const d = evaluateSupplierAccess(
      input({
        travelDate: new Date('2026-07-15'),
        maps: [map({ dateStart: new Date('2026-08-01'), dateEnd: new Date('2026-08-31') })],
      }),
    );
    expect(d.byCode.ETRAV.reason).toBe('MAPPING_DENIED');
  });

  it('allows on the inclusive date boundary', () => {
    const d = evaluateSupplierAccess(
      input({
        travelDate: new Date('2026-08-31'),
        maps: [map({ dateStart: new Date('2026-08-01'), dateEnd: new Date('2026-08-31') })],
      }),
    );
    expect(d.byCode.ETRAV.allowed).toBe(true);
  });

  it('denies when the caller is not in the rule’s agency-group scope', () => {
    const d = evaluateSupplierAccess(
      input({ agencyGroupIds: [GROUP_SILVER], maps: [map({ agencyGroupIds: [GROUP_GOLD] })] }),
    );
    expect(d.byCode.ETRAV.reason).toBe('AGENCY_DENIED');
  });

  it('allows when the caller shares an agency group with the rule', () => {
    const d = evaluateSupplierAccess(
      input({ agencyGroupIds: [GROUP_GOLD], maps: [map({ agencyGroupIds: [GROUP_GOLD] })] }),
    );
    expect(d.byCode.ETRAV.allowed).toBe(true);
  });

  it('bypassAgency satisfies layer 4 (SUPER_ADMIN preview)', () => {
    const d = evaluateSupplierAccess(
      input({ bypassAgency: true, agencyGroupIds: [], maps: [map({ agencyGroupIds: [GROUP_GOLD] })] }),
    );
    expect(d.byCode.ETRAV.allowed).toBe(true);
  });

  it('propagates allowPendingBooking from the matched rule', () => {
    const d = evaluateSupplierAccess(input({ maps: [map({ allowPendingBooking: true })] }));
    expect(d.byCode.ETRAV.allowPendingBooking).toBe(true);
  });
});

// ── Airline restriction merge ────────────────────────────────────────────────
describe('airline restriction', () => {
  it('intersects source and mapping airline allow-lists', () => {
    const d = evaluateSupplierAccess(
      input({
        sources: [source({ airlineCodes: ['6E', 'AI', 'UK'] })],
        maps: [map({ airlineCodes: ['6E', 'AI'] })],
      }),
    );
    expect(d.byCode.ETRAV.allowedAirlines!.sort()).toEqual(['6E', 'AI']);
  });

  it('an empty list on either layer means unrestricted for that layer', () => {
    const d = evaluateSupplierAccess(
      input({ sources: [source({ airlineCodes: ['AI'] })], maps: [map({ airlineCodes: [] })] }),
    );
    expect(d.byCode.ETRAV.allowedAirlines).toEqual(['AI']);
  });

  it('airlineAllowed honors the allow-list and is case-insensitive', () => {
    const d = evaluateSupplierAccess(input({ maps: [map({ airlineCodes: ['6E'] })] }));
    const dec = d.byCode.ETRAV;
    expect(airlineAllowed(dec, '6e')).toBe(true);
    expect(airlineAllowed(dec, 'AI')).toBe(false);
  });
});

// ── travelTypeForRequest (uses the airports reference data) ───────────────────
describe('travelTypeForRequest', () => {
  const req = (origin: string, destination: string): SearchRequest =>
    ({
      tripType: 'ONEWAY',
      segments: [{ origin, destination, date: new Date('2026-07-15') }],
      travelClass: 'ECONOMY',
      pax: { adults: 1, children: 0, infants: 0 },
    }) as SearchRequest;

  it('classifies an all-India route as DOMESTIC', () => {
    expect(travelTypeForRequest(req('BOM', 'DEL'))).toBe('DOMESTIC');
  });

  it('classifies a cross-border route as INTERNATIONAL', () => {
    expect(travelTypeForRequest(req('DEL', 'DXB'))).toBe('INTERNATIONAL');
  });

  it('treats an unknown airport code conservatively as INTERNATIONAL', () => {
    expect(travelTypeForRequest(req('DEL', 'ZZZ'))).toBe('INTERNATIONAL');
  });
});
