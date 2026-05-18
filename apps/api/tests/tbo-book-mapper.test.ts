// Pure-function tests for the Book + GetBookingDetail response mappers.
//
// These exercise the discriminated-union narrowing — the Book service
// branches entirely on the result.kind, so locking the mapper is the
// cheapest test against state-machine drift.

import { describe, expect, it } from 'vitest';
import {
  mapBookResponse,
  mapBookingDetailResponse,
} from '../src/adapters/tbo/mappers/book.mapper.js';
import type {
  TboBookResponse,
  TboBookingDetailResponse,
} from '../src/adapters/tbo/types/lifecycle.js';

describe('mapBookResponse', () => {
  it('returns confirmed when Status=1 + VoucherStatus=true', () => {
    const tbo: TboBookResponse = {
      Status: 1,
      BookResult: {
        BookingId: 12345,
        BookingRefNo: 'REF-1',
        ConfirmationNo: 'CONF-1',
        VoucherStatus: true,
        HotelBookingStatus: 'Confirmed',
      },
    };
    const out = mapBookResponse(tbo);
    expect(out.kind).toBe('confirmed');
    if (out.kind === 'confirmed') {
      expect(out.refs.bookingId).toBe(12345);
      expect(out.refs.confirmationNo).toBe('CONF-1');
    }
  });

  it('returns held when VoucherStatus=false', () => {
    const tbo: TboBookResponse = {
      Status: 1,
      BookResult: {
        BookingId: 12346,
        VoucherStatus: false,
        HotelBookingStatus: 'Hold',
      },
    };
    expect(mapBookResponse(tbo).kind).toBe('held');
  });

  it('returns pending when HotelBookingStatus="Pending"', () => {
    const tbo: TboBookResponse = {
      Status: 1,
      BookResult: { BookingId: 12347, HotelBookingStatus: 'Pending' },
    };
    expect(mapBookResponse(tbo).kind).toBe('pending');
  });

  it('treats hoisted root fields the same as BookResult fields', () => {
    const tbo: TboBookResponse = {
      Status: 1,
      BookingId: 12348,
      VoucherStatus: true,
      HotelBookingStatus: 'Confirmed',
    };
    const out = mapBookResponse(tbo);
    expect(out.kind).toBe('confirmed');
    if (out.kind === 'confirmed') expect(out.refs.bookingId).toBe(12348);
  });

  it('returns verify_price when IsPriceChanged=true (newer envelope)', () => {
    const tbo: TboBookResponse = {
      Status: 1,
      IsPriceChanged: true,
      IsCancellationPolicyChanged: false,
    };
    const out = mapBookResponse(tbo);
    expect(out.kind).toBe('verify_price');
    if (out.kind === 'verify_price') {
      expect(out.isPriceChanged).toBe(true);
      expect(out.isCancellationPolicyChanged).toBe(false);
    }
  });

  it('returns failed for non-success Status', () => {
    expect(
      mapBookResponse({
        Status: 2,
        Error: { ErrorCode: 100, ErrorMessage: 'TBO went down' },
      }).kind,
    ).toBe('failed');
    expect(
      mapBookResponse({
        Status: 5,
        Error: { ErrorCode: 5, ErrorMessage: 'invalid creds' },
      }).kind,
    ).toBe('failed');
  });

  it('returns failed for unrecognized state combos (defensive)', () => {
    const tbo: TboBookResponse = {
      Status: 1,
      BookResult: { HotelBookingStatus: 'SomethingNew' },
    };
    const out = mapBookResponse(tbo);
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') expect(out.error.code).toBe('UNRECOGNIZED_STATE');
  });

  it('extracts confirmation from the Hotel envelope variant', () => {
    const tbo: TboBookResponse = {
      Status: 1,
      Hotel: {
        BookingId: 555,
        VoucherStatus: true,
        HotelBookingStatus: 'Confirmed',
        ConfirmationNo: 'XYZ',
      },
    };
    const out = mapBookResponse(tbo);
    expect(out.kind).toBe('confirmed');
    if (out.kind === 'confirmed') expect(out.refs.confirmationNo).toBe('XYZ');
  });
});

describe('mapBookingDetailResponse', () => {
  it('confirmed status flips to confirmed', () => {
    const tbo: TboBookingDetailResponse = {
      Status: 1,
      BookingDetail: {
        BookingId: 1,
        VoucherStatus: true,
        HotelBookingStatus: 'Confirmed',
        ConfirmationNo: 'C1',
      },
    };
    expect(mapBookingDetailResponse(tbo).kind).toBe('confirmed');
  });

  it('still-pending stays pending', () => {
    const tbo: TboBookingDetailResponse = {
      Status: 1,
      BookingDetail: { BookingId: 1, HotelBookingStatus: 'Pending' },
    };
    expect(mapBookingDetailResponse(tbo).kind).toBe('pending');
  });

  it('cancelled-at-supplier maps to failed (with SUPPLIER_CANCELLED code)', () => {
    const tbo: TboBookingDetailResponse = {
      Status: 1,
      BookingDetail: { BookingId: 1, HotelBookingStatus: 'Cancelled' },
    };
    const out = mapBookingDetailResponse(tbo);
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') expect(out.error.code).toBe('SUPPLIER_CANCELLED');
  });

  it('failed-at-supplier maps to failed (with SUPPLIER_FAILED code)', () => {
    const tbo: TboBookingDetailResponse = {
      Status: 1,
      BookingDetail: { BookingId: 1, HotelBookingStatus: 'Failed' },
    };
    const out = mapBookingDetailResponse(tbo);
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') expect(out.error.code).toBe('SUPPLIER_FAILED');
  });

  it('unknown status defaults to pending (re-poll)', () => {
    const tbo: TboBookingDetailResponse = {
      Status: 1,
      BookingDetail: { BookingId: 1, HotelBookingStatus: 'WeirdNewState' },
    };
    expect(mapBookingDetailResponse(tbo).kind).toBe('pending');
  });

  it('non-success Status returns failed', () => {
    expect(mapBookingDetailResponse({ Status: 2 }).kind).toBe('failed');
  });
});
