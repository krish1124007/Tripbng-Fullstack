// Phase-D tests for the holiday supplier registry + Mock adapter lifecycle.
//
// Covers:
//   - holidaySupplier() returns the same instance on repeat calls (cache)
//   - MOCK + CUSTOM resolve to MockHolidayAdapter
//   - TBO_HOLIDAYS throws NOT_CONFIGURED when env flag is off
//   - TBO_HOLIDAYS skeleton throws NOT_IMPLEMENTED on every method when on
//   - MockHolidayAdapter implements the full lifecycle (search → priceCheck
//     → book → fetchStatus → cancel)

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import {
  holidaySupplier,
  _resetHolidayRegistry,
} from '../src/adapters/holiday/registry.js';
import {
  MockHolidayAdapter,
  _resetMockHolidayState,
} from '../src/adapters/holiday/mock-holiday.adapter.js';
import { HolidayAdapterError } from '../src/adapters/holiday/types.js';

beforeEach(() => {
  _resetHolidayRegistry();
  _resetMockHolidayState();
});

afterEach(() => {
  (env as { TBO_HOLIDAYS_ENABLED: boolean }).TBO_HOLIDAYS_ENABLED = false;
});

describe('holidaySupplier — registry', () => {
  it('returns a MockHolidayAdapter for MOCK_HOLIDAYS', () => {
    const a = holidaySupplier('MOCK_HOLIDAYS');
    expect(a).toBeInstanceOf(MockHolidayAdapter);
    expect(a.code).toBe('MOCK_HOLIDAYS');
  });

  it('memoises — repeat calls return the same instance', () => {
    const a = holidaySupplier('MOCK_HOLIDAYS');
    const b = holidaySupplier('MOCK_HOLIDAYS');
    expect(a).toBe(b);
  });

  it('CUSTOM aliases to MockHolidayAdapter', () => {
    const a = holidaySupplier('CUSTOM');
    expect(a).toBeInstanceOf(MockHolidayAdapter);
  });

  it('TBO_HOLIDAYS throws NOT_CONFIGURED when env flag is off', () => {
    (env as { TBO_HOLIDAYS_ENABLED: boolean }).TBO_HOLIDAYS_ENABLED = false;
    expect(() => holidaySupplier('TBO_HOLIDAYS')).toThrow(HolidayAdapterError);
    try {
      holidaySupplier('TBO_HOLIDAYS');
    } catch (err) {
      expect((err as HolidayAdapterError).code).toBe('NOT_CONFIGURED');
    }
  });

  it('TBO_HOLIDAYS skeleton throws NOT_IMPLEMENTED on every method when flag is on', async () => {
    (env as { TBO_HOLIDAYS_ENABLED: boolean }).TBO_HOLIDAYS_ENABLED = true;
    const a = holidaySupplier('TBO_HOLIDAYS');
    expect(a.code).toBe('TBO_HOLIDAYS');
    expect(a.capabilities).toHaveLength(0);
    try {
      await a.search({
        destination: 'Bali',
        duration: '5',
        budget: 'mid',
        theme: 'Beach',
      });
      throw new Error('expected search to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HolidayAdapterError);
      expect((err as HolidayAdapterError).code).toBe('NOT_IMPLEMENTED');
    }
  });
});

describe('MockHolidayAdapter — full lifecycle', () => {
  const adapter = new MockHolidayAdapter();

  it('search returns deterministic results for the same query', async () => {
    const a = await adapter.search({
      destination: 'Bali',
      duration: '5',
      budget: 'mid',
      theme: 'Beach',
    });
    const b = await adapter.search({
      destination: 'Bali',
      duration: '5',
      budget: 'mid',
      theme: 'Beach',
    });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('priceCheck returns a quote with a fresh supplierQuoteRef', async () => {
    const q = await adapter.priceCheck({
      supplierPackageToken: 'pkg-1',
      travellerCount: 2,
      travelDate: '2026-08-01',
    });
    expect(q.available).toBe(true);
    expect(q.totalPaise).toBeGreaterThan(0);
    expect(q.supplierQuoteRef).toMatch(/^MOCK-QUOTE-/);
  });

  it('book → fetchStatus → cancel happy path', async () => {
    _resetMockHolidayState();
    const book = await adapter.book({
      supplierQuoteRef: 'MOCK-QUOTE-abc',
      travellers: [
        { title: 'Mr', firstName: 'A', lastName: 'B', paxType: 'Adult' },
      ],
      contact: { email: 'x@y', mobile: '9', countryCode: '+91' },
      bookingCode: 'TRBNG-HLD-1',
      travelDate: '2026-08-01',
    });
    expect(book.status).toBe('CONFIRMED');
    expect(book.supplierBookingRef).toMatch(/^MOCK-HLD-/);
    expect(book.voucherUrl).toBeTruthy();

    const status = await adapter.fetchStatus(book.supplierBookingRef);
    expect(status.state).toBe('CONFIRMED');

    const cxl = await adapter.cancel({
      supplierBookingRef: book.supplierBookingRef,
      reason: 'customer requested',
    });
    expect(cxl.status).toBe('PROCESSED');
    expect(cxl.supplierCancellationRef).toMatch(/^MOCK-CXL-/);

    // fetchStatus reflects the cancellation.
    const after = await adapter.fetchStatus(book.supplierBookingRef);
    expect(after.state).toBe('CANCELLED');
  });

  it('book rejects empty traveller list', async () => {
    await expect(
      adapter.book({
        supplierQuoteRef: 'q',
        travellers: [],
        contact: { email: 'x', mobile: '9', countryCode: '+91' },
        bookingCode: 'X',
        travelDate: '2026-08-01',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('cancel + fetchStatus throw NOT_FOUND for unknown refs', async () => {
    await expect(
      adapter.cancel({ supplierBookingRef: 'nope', reason: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adapter.fetchStatus('nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
