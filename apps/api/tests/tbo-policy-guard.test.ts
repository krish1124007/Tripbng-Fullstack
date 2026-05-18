// Pure-function tests for the corporate-policy gate.
//
// Two surfaces exercised:
//   1. filterOffersByPolicy — drives the search-time hotel filter
//   2. evaluateBookingGate  — drives the /book-time approval/block decision
//
// All inputs are plain objects; no Mongo, no I/O.

import { describe, expect, it } from 'vitest';
import type { HotelOffer, HotelPolicies } from '@tripbng/shared';
import { DEFAULT_HOTEL_POLICIES } from '@tripbng/shared';
import {
  evaluateBookingGate,
  filterOffersByPolicy,
  normalizePolicies,
} from '../src/services/tbo/policy-guard.service.js';

const baseOffer = (overrides: Partial<HotelOffer> = {}): HotelOffer => ({
  offerId: 'TBO:BC-1',
  supplier: 'TBO',
  hotel: {
    code: 'HTL-1',
    name: 'Marriott Mumbai',
    starRating: 5,
    address: '1 Test St',
    cityId: null,
    countryCode: null,
    geo: { lat: null, lng: null },
    images: [],
    amenities: [],
  },
  rooms: [
    {
      bookingCode: 'BC-1',
      name: 'Deluxe',
      inclusions: 'Breakfast',
      mealPlan: 'Breakfast',
      isRefundable: true,
      isPackageFare: false,
      totalNetPaise: 500_000,
      totalSellingPaise: 560_000,
    },
  ],
  pricing: {
    currency: 'INR',
    perNightPaise: 280_000,
    totalNetPaise: 500_000,
    totalSellingPaise: 560_000,
    taxes: [],
  },
  policies: { isRefundable: true, cancellation: [], lastCancellationDate: null, mealPlan: 'Breakfast' },
  rules: {
    panRequired: false,
    passportRequired: false,
    gstAllowed: false,
    sameNameAllowed: true,
    specialCharAllowed: false,
    nameMinLength: 1,
    nameMaxLength: 40,
    isPackageFare: false,
    packageDetailsRequired: false,
  },
  ...overrides,
});

describe('filterOffersByPolicy', () => {
  it('lets every offer through when policies are all permissive defaults', () => {
    const offers = [baseOffer(), baseOffer({ offerId: 'TBO:BC-2' })];
    const result = filterOffersByPolicy(offers, DEFAULT_HOTEL_POLICIES, 2);
    expect(result.allowed).toHaveLength(2);
    expect(result.blocked).toHaveLength(0);
  });

  it('filters out offers above the per-night cap', () => {
    const policies: HotelPolicies = {
      ...DEFAULT_HOTEL_POLICIES,
      maxPerNightPaise: 250_000, // Rs 2,500 per night
    };
    // 560k / 2 nights = 280k per night → over cap
    const result = filterOffersByPolicy([baseOffer()], policies, 2);
    expect(result.allowed).toHaveLength(0);
    expect(result.blocked[0]!.reasons).toContain('PER_NIGHT_CAP_EXCEEDED');
  });

  it('per-night cap is computed against selling price, not net', () => {
    // 200k / 2 = 100k per night — below cap.
    const cheap = baseOffer({
      offerId: 'TBO:CHEAP',
      pricing: {
        currency: 'INR',
        perNightPaise: 100_000,
        totalNetPaise: 180_000,
        totalSellingPaise: 200_000,
        taxes: [],
      },
    });
    const policies: HotelPolicies = {
      ...DEFAULT_HOTEL_POLICIES,
      maxPerNightPaise: 150_000,
    };
    expect(filterOffersByPolicy([cheap], policies, 2).allowed).toHaveLength(1);
  });

  it('drops non-refundable offers when refundableOnly=true', () => {
    const offers = [
      baseOffer({ offerId: 'TBO:RF' }),
      baseOffer({
        offerId: 'TBO:NRF',
        policies: { isRefundable: false, cancellation: [], lastCancellationDate: null, mealPlan: null },
      }),
    ];
    const result = filterOffersByPolicy(offers, { ...DEFAULT_HOTEL_POLICIES, refundableOnly: true }, 2);
    expect(result.allowed).toHaveLength(1);
    expect(result.allowed[0]!.offerId).toBe('TBO:RF');
    expect(result.blocked[0]!.reasons).toContain('REFUNDABLE_ONLY');
  });

  it('blocks chains by case-insensitive substring on hotel name', () => {
    const offers = [
      baseOffer({ offerId: 'TBO:OK', hotel: { ...baseOffer().hotel, name: 'Marriott Mumbai' } }),
      baseOffer({ offerId: 'TBO:BLOCK', hotel: { ...baseOffer().hotel, name: 'OYO Townhouse 042' } }),
    ];
    const result = filterOffersByPolicy(
      offers,
      { ...DEFAULT_HOTEL_POLICIES, blockedChains: ['OYO'] },
      2,
    );
    expect(result.allowed.map((o) => o.offerId)).toEqual(['TBO:OK']);
    expect(result.blocked[0]!.reasons).toContain('BLOCKED_CHAIN');
  });

  it('blocks star ratings outside the allowed list', () => {
    const offers = [
      baseOffer({ offerId: 'TBO:5', hotel: { ...baseOffer().hotel, starRating: 5 } }),
      baseOffer({ offerId: 'TBO:3', hotel: { ...baseOffer().hotel, starRating: 3 } }),
      baseOffer({ offerId: 'TBO:2', hotel: { ...baseOffer().hotel, starRating: 2 } }),
    ];
    const result = filterOffersByPolicy(
      offers,
      { ...DEFAULT_HOTEL_POLICIES, allowedStarRatings: [3, 4, 5] },
      2,
    );
    expect(result.allowed.map((o) => o.offerId)).toEqual(['TBO:5', 'TBO:3']);
    expect(result.blocked[0]!.offer.offerId).toBe('TBO:2');
  });

  it('attaches multiple reasons when an offer violates several rules', () => {
    const offer = baseOffer({
      offerId: 'TBO:BAD',
      hotel: { ...baseOffer().hotel, name: 'OYO Cheapy', starRating: 2 },
      policies: { isRefundable: false, cancellation: [], lastCancellationDate: null, mealPlan: null },
    });
    const result = filterOffersByPolicy(
      [offer],
      {
        ...DEFAULT_HOTEL_POLICIES,
        refundableOnly: true,
        blockedChains: ['OYO'],
        allowedStarRatings: [4, 5],
      },
      2,
    );
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]!.reasons).toEqual(
      expect.arrayContaining(['REFUNDABLE_ONLY', 'BLOCKED_CHAIN', 'STAR_RATING_NOT_ALLOWED']),
    );
  });
});

describe('evaluateBookingGate', () => {
  it('allow: under threshold, all rules permissive', () => {
    const result = evaluateBookingGate(
      {
        totalSellingPaise: 100_000,
        isRefundable: true,
        hotelName: 'X',
        hotelChain: null,
        starRating: 4,
        nights: 2,
      },
      DEFAULT_HOTEL_POLICIES,
    );
    expect(result.gate).toBe('allow');
    expect(result.reasons).toEqual([]);
  });

  it('require_approval: total over threshold but no hard violations', () => {
    const result = evaluateBookingGate(
      {
        totalSellingPaise: 200_000,
        isRefundable: true,
        hotelName: 'X',
        hotelChain: null,
        starRating: 4,
        nights: 2,
      },
      { ...DEFAULT_HOTEL_POLICIES, requireApprovalAbovePaise: 150_000 },
    );
    expect(result.gate).toBe('require_approval');
    expect(result.reasons).toEqual(['TOTAL_OVER_APPROVAL_THRESHOLD']);
  });

  it('block beats require_approval — hard violations short-circuit', () => {
    const result = evaluateBookingGate(
      {
        totalSellingPaise: 1_000_000,
        isRefundable: false,
        hotelName: 'X',
        hotelChain: null,
        starRating: 4,
        nights: 2,
      },
      {
        ...DEFAULT_HOTEL_POLICIES,
        refundableOnly: true,
        requireApprovalAbovePaise: 100_000,
      },
    );
    expect(result.gate).toBe('block');
    expect(result.reasons).toEqual(['REFUNDABLE_ONLY']);
  });

  it('per-night cap: blocks when total/nights exceeds cap', () => {
    const result = evaluateBookingGate(
      {
        totalSellingPaise: 600_000, // Rs 6,000 / 2 = 3,000 per night
        isRefundable: true,
        hotelName: 'X',
        hotelChain: null,
        starRating: 4,
        nights: 2,
      },
      { ...DEFAULT_HOTEL_POLICIES, maxPerNightPaise: 250_000 },
    );
    expect(result.gate).toBe('block');
    expect(result.reasons).toContain('PER_NIGHT_CAP_EXCEEDED');
  });

  it('blocks when hotelChain matches blockedChains list', () => {
    const result = evaluateBookingGate(
      {
        totalSellingPaise: 100_000,
        isRefundable: true,
        hotelName: 'OYO',
        hotelChain: 'OYO',
        starRating: 4,
        nights: 2,
      },
      { ...DEFAULT_HOTEL_POLICIES, blockedChains: ['OYO'] },
    );
    expect(result.gate).toBe('block');
    expect(result.reasons).toContain('BLOCKED_CHAIN');
  });
});

describe('normalizePolicies', () => {
  it('returns the all-permissive default for null/undefined input', () => {
    expect(normalizePolicies(null)).toEqual(DEFAULT_HOTEL_POLICIES);
    expect(normalizePolicies(undefined)).toEqual(DEFAULT_HOTEL_POLICIES);
  });

  it('coerces a Mongoose ObjectId-like defaultApproverUserId to string', () => {
    const fakeOid = {
      toString: () => '507f1f77bcf86cd799439011',
    };
    const result = normalizePolicies({ defaultApproverUserId: fakeOid });
    expect(result.defaultApproverUserId).toBe('507f1f77bcf86cd799439011');
  });

  it('preserves explicitly set fields', () => {
    const result = normalizePolicies({
      maxPerNightPaise: 100_000,
      refundableOnly: true,
      preferredChains: ['Marriott'],
      blockedChains: ['OYO'],
      allowedStarRatings: [4, 5],
      requireApprovalAbovePaise: 500_000,
      markupPercent: 5,
    });
    expect(result.maxPerNightPaise).toBe(100_000);
    expect(result.refundableOnly).toBe(true);
    expect(result.preferredChains).toEqual(['Marriott']);
    expect(result.blockedChains).toEqual(['OYO']);
    expect(result.allowedStarRatings).toEqual([4, 5]);
    expect(result.requireApprovalAbovePaise).toBe(500_000);
    expect(result.markupPercent).toBe(5);
  });
});
