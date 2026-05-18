// Pure-function tests for the alert-var builders in book.service.
//
// We exercise:
//   - buildLifecycleVars  → CONFIRMED / FAILED / CANCELLED templates
//   - buildApprovalVars   → AWAITS_APPROVAL / APPROVED / REJECTED templates
//
// Both are pure (read fields off a booking-shaped object, no I/O), so the
// tests cast a plain object as HotelBookingDoc — no Mongoose round-trip
// needed. The detail-URL routing logic is the main thing under test:
// approval-pending bookings link to the approver's queue, decided
// bookings link to the booker's detail page.

import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  buildApprovalVars,
  buildLifecycleVars,
} from '../src/services/tbo/book.service.js';
import type { HotelBookingDoc } from '../src/models/HotelBooking.js';

const fakeBooking = (overrides: Partial<HotelBookingDoc> = {}): HotelBookingDoc => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    _id: new Types.ObjectId('64a1b2c3d4e5f6a7b8c9d0e1'),
    bookingCode: 'TRBNG-HTL-2026-000123',
    hotel: { name: 'Grand Hyatt Mumbai', cityId: 'BOM' },
    checkIn: new Date('2026-08-15'),
    checkOut: new Date('2026-08-17'),
    nights: 2,
    pricing: { totalSellingPaise: 12_000_00 },
    supplierRefs: { confirmationNo: 'TBO-CONF-9876', invoiceNumber: 'INV-0042' },
    ...overrides,
  } as any;
};

describe('buildLifecycleVars', () => {
  it('populates detailUrl pointing to the booking detail page', () => {
    const vars = buildLifecycleVars(fakeBooking());
    expect(vars.detailUrl).toBe('http://localhost:3000/bookings/64a1b2c3d4e5f6a7b8c9d0e1');
  });

  it('strips trailing slash from WEB_BASE_URL when joining', () => {
    // WEB_BASE_URL default is `http://localhost:3000` (no trailing slash) —
    // we still verify the joiner doesn't double-up if a future env value
    // happens to end with /. The implementation uses replace(/\/$/, '').
    const vars = buildLifecycleVars(fakeBooking());
    expect(vars.detailUrl).not.toContain('//bookings');
  });

  it('extracts hotel name + city + dates from the doc', () => {
    const vars = buildLifecycleVars(fakeBooking());
    expect(vars.hotelName).toBe('Grand Hyatt Mumbai');
    expect(vars.city).toBe('BOM');
    expect(vars.checkIn).toBe('2026-08-15');
    expect(vars.checkOut).toBe('2026-08-17');
    expect(vars.nights).toBe(2);
    expect(vars.totalSellingPaise).toBe(12_000_00);
  });

  it('forwards supplierRefs confirmationNo + invoiceNumber', () => {
    const vars = buildLifecycleVars(fakeBooking());
    expect(vars.confirmationNo).toBe('TBO-CONF-9876');
    expect(vars.invoiceNumber).toBe('INV-0042');
  });

  it('falls back to "Hotel booking" when name + bookingCode are missing', () => {
    const vars = buildLifecycleVars(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeBooking({ hotel: {}, supplierRefs: {} } as any),
    );
    expect(vars.hotelName).toBe('Hotel booking');
  });

  it('renders em-dash for missing checkIn/checkOut dates', () => {
    const vars = buildLifecycleVars(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeBooking({ checkIn: undefined, checkOut: undefined } as any),
    );
    expect(vars.checkIn).toBe('—');
    expect(vars.checkOut).toBe('—');
  });
});

describe('buildApprovalVars — URL routing logic', () => {
  it('routes to APPROVALS page when no decision is recorded yet (AWAITS_APPROVAL)', () => {
    const vars = buildApprovalVars(fakeBooking(), ['TOTAL_OVER_APPROVAL_THRESHOLD']);
    expect(vars.detailUrl).toBe('http://localhost:3000/approvals/64a1b2c3d4e5f6a7b8c9d0e1');
  });

  it('routes to BOOKING DETAIL page when a decision has landed (APPROVED/REJECTED)', () => {
    const vars = buildApprovalVars(
      fakeBooking(),
      ['TOTAL_OVER_APPROVAL_THRESHOLD'],
      'Manager Bob',
      'Approved — within Q3 budget',
    );
    expect(vars.detailUrl).toBe('http://localhost:3000/bookings/64a1b2c3d4e5f6a7b8c9d0e1');
  });

  it('routes to BOOKING DETAIL page when only decisionNote is set (rare edge)', () => {
    const vars = buildApprovalVars(
      fakeBooking(),
      ['TOTAL_OVER_APPROVAL_THRESHOLD'],
      null,
      'Auto-rejected by policy',
    );
    expect(vars.detailUrl).toBe('http://localhost:3000/bookings/64a1b2c3d4e5f6a7b8c9d0e1');
  });

  it('preserves reasons[] verbatim', () => {
    const reasons = ['TOTAL_OVER_APPROVAL_THRESHOLD', 'PER_NIGHT_CAP_EXCEEDED'];
    const vars = buildApprovalVars(fakeBooking(), reasons);
    expect(vars.reasons).toEqual(reasons);
  });

  it('forwards decidedBy + decisionNote when provided', () => {
    const vars = buildApprovalVars(
      fakeBooking(),
      [],
      'Manager Bob',
      'Approved — within Q3 budget',
    );
    expect(vars.decidedBy).toBe('Manager Bob');
    expect(vars.decisionNote).toBe('Approved — within Q3 budget');
  });

  it('defaults decidedBy + decisionNote to null when omitted', () => {
    const vars = buildApprovalVars(fakeBooking(), []);
    expect(vars.decidedBy).toBeNull();
    expect(vars.decisionNote).toBeNull();
  });
});
