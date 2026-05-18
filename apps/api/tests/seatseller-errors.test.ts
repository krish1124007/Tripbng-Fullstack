// SeatSeller error mapper tests. The mapper's job is to turn free-text
// error bodies into typed errors so the booking service can branch on
// `instanceof` without substring-matching at the call site.

import { describe, expect, it } from 'vitest';
import {
  GenderRestrictionError,
  InsufficientBalanceError,
  InvalidBoardingPointError,
  ItineraryExpiredError,
  OAuthError,
  SeatNoLongerAvailableError,
  SeatSellerError,
  TentativeBookingFailedError,
  VendorFailureError,
  mapSeatSellerError,
} from '../src/adapters/seatseller/errors.js';

describe('mapSeatSellerError', () => {
  it('maps "Seat is not available" → SeatNoLongerAvailableError', () => {
    expect(mapSeatSellerError('Seat is not available')).toBeInstanceOf(SeatNoLongerAvailableError);
  });

  it('maps "Tentative booking failed" → TentativeBookingFailedError', () => {
    expect(mapSeatSellerError('Tentative booking failed')).toBeInstanceOf(
      TentativeBookingFailedError,
    );
    expect(mapSeatSellerError('block failed for some reason')).toBeInstanceOf(
      TentativeBookingFailedError,
    );
  });

  it('maps "Insufficient balance" → InsufficientBalanceError', () => {
    expect(mapSeatSellerError('Insufficient balance in wallet')).toBeInstanceOf(
      InsufficientBalanceError,
    );
  });

  it('maps "Itinerary expired" → ItineraryExpiredError', () => {
    expect(mapSeatSellerError('Itinerary expired')).toBeInstanceOf(ItineraryExpiredError);
    expect(mapSeatSellerError('Block expired')).toBeInstanceOf(ItineraryExpiredError);
  });

  it('maps "Invalid boarding point" → InvalidBoardingPointError', () => {
    expect(mapSeatSellerError('Invalid boarding point')).toBeInstanceOf(InvalidBoardingPointError);
    expect(mapSeatSellerError('Invalid dropping point')).toBeInstanceOf(InvalidBoardingPointError);
  });

  it('maps gender mismatch → GenderRestrictionError with allowedSeats', () => {
    const err = mapSeatSellerError('Gender restriction violated', {}, { allowedSeats: ['L1', 'L2'] });
    expect(err).toBeInstanceOf(GenderRestrictionError);
    expect((err as GenderRestrictionError).allowedSeats).toEqual(['L1', 'L2']);
  });

  it('maps "Vendor failure" → VendorFailureError', () => {
    expect(mapSeatSellerError('Vendor failure on operator side')).toBeInstanceOf(
      VendorFailureError,
    );
  });

  it('maps HTTP 401 → OAuthError', () => {
    const err = mapSeatSellerError('unauthorized', {}, { httpStatus: 401 });
    expect(err).toBeInstanceOf(OAuthError);
    expect((err as OAuthError).httpStatus).toBe(401);
  });

  it('falls back to generic SeatSellerError with code=UNKNOWN', () => {
    const err = mapSeatSellerError('totally novel failure');
    expect(err).toBeInstanceOf(SeatSellerError);
    expect(err.code).toBe('UNKNOWN');
  });

  it('falls back to UNKNOWN even on empty body', () => {
    const err = mapSeatSellerError('');
    expect(err.code).toBe('UNKNOWN');
    expect(err.message.length).toBeGreaterThan(0); // never empty
  });

  it('preserves upstream + context for debugging', () => {
    const err = mapSeatSellerError('Seat is not available', {
      tin: 'TIN-123',
      blockKey: 'BLK-xyz',
    });
    expect(err.upstream).toBe('Seat is not available');
    expect(err.context?.tin).toBe('TIN-123');
    expect(err.context?.blockKey).toBe('BLK-xyz');
  });
});

describe('SeatSellerError defaults', () => {
  it('retryable defaults to false', () => {
    const err = new SeatSellerError('TEST', 'msg');
    expect(err.retryable).toBe(false);
  });

  it('SeatNoLongerAvailableError is non-retryable', () => {
    expect(new SeatNoLongerAvailableError().retryable).toBe(false);
  });

  it('GenderRestrictionError carries an allowedSeats array', () => {
    const err = new GenderRestrictionError(['L1', 'L2', 'L3']);
    expect(err.allowedSeats).toEqual(['L1', 'L2', 'L3']);
  });
});
