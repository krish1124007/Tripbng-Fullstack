// Pure-function tests for TBO Search + PreBook → HotelOffer mappers.
//
// We exercise:
//   - search-result.mapper: shape variants, money rounding, dedupe of
//     missing-data hotels into the errors[] bucket
//   - prebook.mapper: price merge, tax breakup, rule flags, and the cases
//     where TBO returns sparse responses

import { describe, expect, it } from 'vitest';
import { mapSearchResponse } from '../src/adapters/tbo/mappers/search-result.mapper.js';
import { mergePreBookIntoOffer } from '../src/adapters/tbo/mappers/prebook.mapper.js';
import type { TboSearchResponse } from '../src/adapters/tbo/types/search.js';
import type { TboPreBookResponse } from '../src/adapters/tbo/types/prebook.js';
import type { HotelOffer } from '@tripbng/shared';

describe('mapSearchResponse', () => {
  it('extracts hotels from the standard envelope and converts rupees to paise', () => {
    const tbo: TboSearchResponse = {
      Status: 1,
      HotelSearchResult: {
        HotelResults: [
          {
            HotelCode: 'HTL-1',
            HotelName: 'The Test Inn',
            StarRating: 4,
            HotelAddress: '1 Test St',
            Currency: 'INR',
            Latitude: '19.0760',
            Longitude: '72.8777',
            Rooms: [
              {
                BookingCode: 'BC-1',
                Name: 'Deluxe King',
                Inclusion: 'Breakfast',
                IsRefundable: true,
                MealType: 'Breakfast',
                TotalFare: 5000,
                TotalTax: 600,
                CancellationPolicies: [
                  { FromDate: '2026-06-01T00:00:00', ChargeType: 'Percentage', CancellationCharge: 50 },
                ],
              },
            ],
          },
        ],
      },
    };
    const result = mapSearchResponse(tbo, { nights: 2 });
    expect(result.errors).toEqual([]);
    expect(result.offers).toHaveLength(1);
    const offer = result.offers[0]!;
    expect(offer.offerId).toBe('TBO:BC-1');
    expect(offer.supplier).toBe('TBO');
    expect(offer.hotel.name).toBe('The Test Inn');
    expect(offer.hotel.starRating).toBe(4);
    expect(offer.hotel.geo).toEqual({ lat: 19.076, lng: 72.8777 });
    expect(offer.rooms[0]!.totalNetPaise).toBe(500_000); // 5000 INR = 5,00,000 paise
    expect(offer.rooms[0]!.totalSellingPaise).toBe(560_000); // (5000 + 600) * 100
    expect(offer.pricing.perNightPaise).toBe(280_000); // 560k / 2 nights
    expect(offer.policies.isRefundable).toBe(true);
    expect(offer.policies.cancellation).toHaveLength(1);
    expect(offer.policies.cancellation[0]!.charge).toBe(50);
    expect(offer.policies.mealPlan).toBe('Breakfast');
  });

  it('falls back to the Hotels[] hoisted shape', () => {
    const tbo: TboSearchResponse = {
      Status: 1,
      Hotels: [
        {
          HotelCode: 'HTL-2',
          HotelName: 'Hoisted Hotel',
          Rooms: [{ BookingCode: 'BC-2', TotalFare: 1234, TotalTax: 0 }],
        },
      ],
    };
    const result = mapSearchResponse(tbo, { nights: 1 });
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]!.hotel.code).toBe('HTL-2');
  });

  it('drops hotels without a HotelCode into the errors bucket', () => {
    const tbo: TboSearchResponse = {
      Status: 1,
      Hotels: [
        // @ts-expect-error — testing missing HotelCode
        { HotelName: 'No code', Rooms: [{ BookingCode: 'X', TotalFare: 100 }] },
        { HotelCode: 'HTL-3', Rooms: [{ BookingCode: 'BC-3', TotalFare: 100 }] },
      ],
    };
    const result = mapSearchResponse(tbo, { nights: 1 });
    expect(result.offers).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe('MISSING_HOTEL_CODE');
  });

  it('drops hotels with no rooms into errors', () => {
    const tbo: TboSearchResponse = {
      Status: 1,
      Hotels: [{ HotelCode: 'HTL-4', HotelName: 'No rooms', Rooms: [] }],
    };
    const result = mapSearchResponse(tbo, { nights: 1 });
    expect(result.offers).toHaveLength(0);
    expect(result.errors[0]!.code).toBe('NO_AVAILABLE_ROOMS');
  });

  it('handles string-typed lat/lng/totals (TBO sometimes stringifies)', () => {
    const tbo: TboSearchResponse = {
      Status: 1,
      Hotels: [
        {
          HotelCode: 'HTL-5',
          Latitude: '12.34',
          Longitude: '56.78',
          Rooms: [{ BookingCode: 'BC-5', TotalFare: '2500.50', TotalTax: '300.00' }],
        },
      ],
    };
    const result = mapSearchResponse(tbo, { nights: 1 });
    const offer = result.offers[0]!;
    expect(offer.hotel.geo.lat).toBe(12.34);
    expect(offer.rooms[0]!.totalNetPaise).toBe(250_050);
    expect(offer.rooms[0]!.totalSellingPaise).toBe(280_050);
  });

  it('sums DayRates when TotalFare is absent', () => {
    const tbo: TboSearchResponse = {
      Status: 1,
      Hotels: [
        {
          HotelCode: 'HTL-6',
          Rooms: [
            {
              BookingCode: 'BC-6',
              DayRates: [{ Amount: 1000 }, { Amount: 1200 }, { Amount: 800 }],
            },
          ],
        },
      ],
    };
    const result = mapSearchResponse(tbo, { nights: 3 });
    expect(result.offers[0]!.rooms[0]!.totalNetPaise).toBe(300_000); // 3000 INR sum
  });

  it('marks isRefundable=false when ANY room is non-refundable', () => {
    const tbo: TboSearchResponse = {
      Status: 1,
      Hotels: [
        {
          HotelCode: 'HTL-7',
          Rooms: [
            { BookingCode: 'BC-7A', TotalFare: 100, IsRefundable: true },
            { BookingCode: 'BC-7B', TotalFare: 200, IsRefundable: false },
          ],
        },
      ],
    };
    const result = mapSearchResponse(tbo, { nights: 1 });
    expect(result.offers[0]!.policies.isRefundable).toBe(false);
  });
});

describe('mergePreBookIntoOffer', () => {
  const baseOffer: HotelOffer = {
    offerId: 'TBO:BC-1',
    supplier: 'TBO',
    hotel: {
      code: 'HTL-1',
      name: 'The Test Inn',
      starRating: 4,
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
  };

  it('detects price change when PreBook total differs by > Rs 1', () => {
    const tbo: TboPreBookResponse = {
      Status: 1,
      IsPriceChanged: true,
      HotelResult: {
        Rooms: [{ BookingCode: 'BC-1', TotalFare: 5500, TotalTax: 660 }],
      },
    };
    const result = mergePreBookIntoOffer(baseOffer, tbo);
    expect(result.priceChanged).toBe(true);
    expect(result.offer.pricing.totalSellingPaise).toBe(616_000);
    expect(result.offer.pricing.totalNetPaise).toBe(550_000);
  });

  it('keeps search-time price when PreBook returns zero (sparse response)', () => {
    const tbo: TboPreBookResponse = { Status: 1, HotelResult: { Rooms: [] } };
    const result = mergePreBookIntoOffer(baseOffer, tbo);
    expect(result.priceChanged).toBe(false);
    expect(result.offer.pricing.totalSellingPaise).toBe(560_000);
  });

  it('lifts rule flags from the top level (PanMandatory / PassportMandatory / GSTAllowed)', () => {
    const tbo: TboPreBookResponse = {
      Status: 1,
      PanMandatory: true,
      PassportMandatory: true,
      GSTAllowed: true,
      NameMinLength: 2,
      NameMaxLength: 60,
    } as TboPreBookResponse;
    const result = mergePreBookIntoOffer(baseOffer, tbo);
    expect(result.offer.rules.panRequired).toBe(true);
    expect(result.offer.rules.passportRequired).toBe(true);
    expect(result.offer.rules.gstAllowed).toBe(true);
    expect(result.offer.rules.nameMinLength).toBe(2);
    expect(result.offer.rules.nameMaxLength).toBe(60);
  });

  it('maps tax breakup into normalized TaxLine[] and skips zero-amount lines', () => {
    const tbo: TboPreBookResponse = {
      Status: 1,
      HotelResult: {
        Rooms: [
          {
            BookingCode: 'BC-1',
            TotalFare: 5000,
            TotalTax: 600,
            TaxBreakup: [
              { TaxType: 'CGST', TaxableAmount: 5000, TaxPercentage: 6, TaxAmount: 300 },
              { TaxType: 'SGST', TaxableAmount: 5000, TaxPercentage: 6, TaxAmount: 300 },
              { TaxType: 'IGST', TaxableAmount: 0, TaxPercentage: 0, TaxAmount: 0 }, // skipped
              { TaxType: 'unknown', TaxableAmount: 100, TaxPercentage: 1, TaxAmount: 1 },
            ],
          },
        ],
      },
    };
    const result = mergePreBookIntoOffer(baseOffer, tbo);
    expect(result.offer.pricing.taxes).toHaveLength(3);
    expect(result.offer.pricing.taxes[0]).toEqual({
      taxType: 'CGST',
      taxableAmountPaise: 500_000,
      taxPercentage: 6,
      taxAmountPaise: 30_000,
    });
    // Unknown tax type bucket → OTHER.
    expect(result.offer.pricing.taxes[2]!.taxType).toBe('OTHER');
  });

  it('flags cancellationPolicyChanged and lifts lastCancellationDate', () => {
    const tbo: TboPreBookResponse = {
      Status: 1,
      IsCancellationPolicyChanged: true,
      LastCancellationDate: '2026-06-30T23:59:59',
      HotelResult: {
        Rooms: [
          {
            BookingCode: 'BC-1',
            TotalFare: 5000,
            TotalTax: 0,
            CancellationPolicies: [
              { FromDate: '2026-06-01T00:00:00', ChargeType: 'FixedAmount', CancellationCharge: 1000 },
            ],
          },
        ],
      },
    };
    const result = mergePreBookIntoOffer(baseOffer, tbo);
    expect(result.cancellationPolicyChanged).toBe(true);
    expect(result.lastCancellationDate).toBe('2026-06-30T23:59:59');
    expect(result.offer.policies.cancellation).toHaveLength(1);
    expect(result.offer.policies.cancellation[0]!.chargeType).toBe('FixedAmount');
  });
});
