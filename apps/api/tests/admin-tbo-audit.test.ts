// Pure-function tests for the /admin/tbo/audit query layer.
//
// Covers:
//   - AuditListQuerySchema parsing (defaults, bounds, type coercion)
//   - buildAuditListFilter — Mongo filter shape per query input
//
// Routes themselves are tested via manual smoke + the typecheck — the
// auth wiring (SUPER_ADMIN-only) is enforced by the existing requireRole
// middleware which has its own permissions.test.ts coverage.

import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  AuditListQuerySchema,
  buildAuditListFilter,
} from '../src/routes/admin-tbo.routes.js';

describe('AuditListQuerySchema', () => {
  it('applies sensible defaults for an empty query', () => {
    const parsed = AuditListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(50);
    expect(parsed.erroredOnly).toBe(false);
  });

  it('coerces page + limit from string (Express query strings)', () => {
    const parsed = AuditListQuerySchema.parse({ page: '3', limit: '25' });
    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(25);
  });

  it('clamps limit at 200 (caps export-by-pagination abuse)', () => {
    expect(() => AuditListQuerySchema.parse({ limit: '500' })).toThrow();
  });

  it('rejects page < 1', () => {
    expect(() => AuditListQuerySchema.parse({ page: '0' })).toThrow();
  });

  it('coerces erroredOnly from string', () => {
    expect(AuditListQuerySchema.parse({ erroredOnly: 'true' }).erroredOnly).toBe(true);
    expect(AuditListQuerySchema.parse({ erroredOnly: 'false' }).erroredOnly).toBe(false);
  });

  it('parses ISO date strings into Date objects', () => {
    const parsed = AuditListQuerySchema.parse({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(parsed.from).toBeInstanceOf(Date);
    expect(parsed.to).toBeInstanceOf(Date);
    expect(parsed.from?.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('keeps optional string filters as undefined when absent', () => {
    const parsed = AuditListQuerySchema.parse({});
    expect(parsed.bookingId).toBeUndefined();
    expect(parsed.method).toBeUndefined();
    expect(parsed.traceId).toBeUndefined();
  });
});

describe('buildAuditListFilter', () => {
  const validId = new Types.ObjectId().toHexString();

  it('returns an empty filter when nothing is set', () => {
    const filter = buildAuditListFilter(AuditListQuerySchema.parse({}));
    expect(filter).toEqual({});
  });

  it('coerces bookingId string to ObjectId', () => {
    const filter = buildAuditListFilter(AuditListQuerySchema.parse({ bookingId: validId }));
    expect(filter.bookingId).toBeInstanceOf(Types.ObjectId);
    expect(String(filter.bookingId)).toBe(validId);
  });

  it('throws when bookingId is not a valid ObjectId', () => {
    expect(() =>
      buildAuditListFilter(AuditListQuerySchema.parse({ bookingId: 'not-an-oid' })),
    ).toThrow();
  });

  it('passes bookingCode / traceId / method through verbatim', () => {
    const filter = buildAuditListFilter(
      AuditListQuerySchema.parse({
        bookingCode: 'TR-1234',
        traceId: 'trace-abc',
        method: 'Search',
      }),
    );
    expect(filter.bookingCode).toBe('TR-1234');
    expect(filter.traceId).toBe('trace-abc');
    expect(filter.method).toBe('Search');
  });

  it('builds a $gte/$lte range when both from + to are set', () => {
    const filter = buildAuditListFilter(
      AuditListQuerySchema.parse({ from: '2026-01-01', to: '2026-06-30' }),
    );
    expect(filter.createdAt).toMatchObject({
      $gte: expect.any(Date),
      $lte: expect.any(Date),
    });
  });

  it('builds a half-open range when only from is set', () => {
    const filter = buildAuditListFilter(AuditListQuerySchema.parse({ from: '2026-01-01' }));
    expect(filter.createdAt).toMatchObject({ $gte: expect.any(Date) });
    expect(filter.createdAt).not.toHaveProperty('$lte');
  });

  it('produces an $or for erroredOnly that catches all 3 failure markers', () => {
    const filter = buildAuditListFilter(AuditListQuerySchema.parse({ erroredOnly: 'true' }));
    expect(filter.$or).toEqual([
      { tboStatus: { $ne: 1 } },
      { errorCode: { $ne: null } },
      { httpStatus: { $gte: 400 } },
    ]);
  });

  it('combines multiple filters into a single AND query', () => {
    const filter = buildAuditListFilter(
      AuditListQuerySchema.parse({
        bookingCode: 'TR-9',
        method: 'Book',
        erroredOnly: 'true',
      }),
    );
    expect(filter.bookingCode).toBe('TR-9');
    expect(filter.method).toBe('Book');
    expect(filter.$or).toBeDefined();
  });
});
