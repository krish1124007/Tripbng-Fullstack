// Schema tests for the shared SsrSelections types — locks the contract
// the booking-form UI is sending into /bookings/hold.

import { describe, expect, it } from 'vitest';
import {
  HoldRequestSchema,
  SsrBaggagePickSchema,
  SsrMealPickSchema,
  SsrSeatPickSchema,
  SsrSelectionsSchema,
} from '@tripbng/shared';

describe('SsrMealPickSchema', () => {
  it('accepts a fully-populated pick', () => {
    const parsed = SsrMealPickSchema.parse({
      segmentId: 'BLR-DEL',
      airlineCode: '6E',
      flightNumber: '203',
      wayType: 1,
      origin: 'BLR',
      destination: 'DEL',
      code: 'VEG',
      description: 'Vegetarian',
      pricePaise: 25_000,
      currency: 'INR',
    });
    expect(parsed.code).toBe('VEG');
    expect(parsed.pricePaise).toBe(25_000);
  });

  it('defaults currency to INR', () => {
    const parsed = SsrMealPickSchema.parse({
      segmentId: 'X',
      code: 'VEG',
      description: 'V',
      pricePaise: 100,
    });
    expect(parsed.currency).toBe('INR');
  });

  it('accepts picks without routing fields (non-TBO suppliers)', () => {
    expect(() =>
      SsrMealPickSchema.parse({
        segmentId: 'X',
        code: 'V',
        description: 'V',
        pricePaise: 100,
      }),
    ).not.toThrow();
  });

  it('rejects negative prices', () => {
    expect(() =>
      SsrMealPickSchema.parse({
        segmentId: 'X',
        code: 'V',
        description: 'V',
        pricePaise: -1,
      }),
    ).toThrow();
  });

  it('rejects empty code', () => {
    expect(() =>
      SsrMealPickSchema.parse({
        segmentId: 'X',
        code: '',
        description: 'V',
        pricePaise: 100,
      }),
    ).toThrow();
  });

  it('rejects wayType outside {1, 2}', () => {
    expect(() =>
      SsrMealPickSchema.parse({
        segmentId: 'X',
        code: 'V',
        description: 'V',
        pricePaise: 100,
        wayType: 3,
      }),
    ).toThrow();
  });
});

describe('SsrBaggagePickSchema', () => {
  it('requires weightKg as a non-negative integer', () => {
    expect(() =>
      SsrBaggagePickSchema.parse({
        segmentId: 'X',
        code: 'B5',
        description: '5 KG',
        weightKg: -1,
        pricePaise: 100,
      }),
    ).toThrow();
    expect(() =>
      SsrBaggagePickSchema.parse({
        segmentId: 'X',
        code: 'B5',
        description: '5 KG',
        weightKg: 5,
        pricePaise: 100,
      }),
    ).not.toThrow();
  });

  it('caps weightKg at 100', () => {
    expect(() =>
      SsrBaggagePickSchema.parse({
        segmentId: 'X',
        code: 'B500',
        description: '500 KG',
        weightKg: 500,
        pricePaise: 100,
      }),
    ).toThrow();
  });
});

describe('SsrSeatPickSchema', () => {
  it('requires paxIndex (which seat goes to which passenger)', () => {
    expect(() =>
      SsrSeatPickSchema.parse({
        segmentId: 'X',
        code: '1A',
        rowNo: 1,
        seatNo: 'A',
        pricePaise: 100,
      }),
    ).toThrow();
  });

  it('accepts optional seatType (UI hint)', () => {
    const parsed = SsrSeatPickSchema.parse({
      segmentId: 'X',
      code: '1A',
      rowNo: 1,
      seatNo: 'A',
      seatType: 'Window',
      pricePaise: 100,
      paxIndex: 0,
    });
    expect(parsed.seatType).toBe('Window');
  });

  it('rejects invalid rowNo (0 or > 99)', () => {
    expect(() =>
      SsrSeatPickSchema.parse({
        segmentId: 'X',
        code: '0A',
        rowNo: 0,
        seatNo: 'A',
        pricePaise: 100,
        paxIndex: 0,
      }),
    ).toThrow();
    expect(() =>
      SsrSeatPickSchema.parse({
        segmentId: 'X',
        code: '100A',
        rowNo: 100,
        seatNo: 'A',
        pricePaise: 100,
        paxIndex: 0,
      }),
    ).toThrow();
  });
});

describe('SsrSelectionsSchema', () => {
  it('all fields are optional (empty selection = no add-ons)', () => {
    expect(() => SsrSelectionsSchema.parse({})).not.toThrow();
  });

  it('accepts a multi-category selection', () => {
    const parsed = SsrSelectionsSchema.parse({
      meals: [
        { segmentId: 'X', code: 'V', description: 'V', pricePaise: 100 },
      ],
      baggage: [
        { segmentId: 'X', code: 'B', description: 'B', weightKg: 5, pricePaise: 200 },
      ],
      seats: [
        {
          segmentId: 'X',
          code: '1A',
          rowNo: 1,
          seatNo: 'A',
          pricePaise: 50,
          paxIndex: 0,
        },
      ],
    });
    expect(parsed.meals).toHaveLength(1);
    expect(parsed.baggage).toHaveLength(1);
    expect(parsed.seats).toHaveLength(1);
  });
});

describe('HoldRequestSchema with ssrSelections', () => {
  const baseHoldBody = () => ({
    searchId: 'srch-1',
    fareToken: 'token-1',
    passengers: [
      {
        type: 'ADULT' as const,
        title: 'MR' as const,
        firstName: 'A',
        lastName: 'X',
      },
    ],
    contact: {
      email: 'a@b.com',
      mobile: '9876543210',
    },
  });

  it('accepts a hold body without ssrSelections (back-compat)', () => {
    expect(() => HoldRequestSchema.parse(baseHoldBody())).not.toThrow();
  });

  it('accepts a hold body with empty ssrSelections object', () => {
    const parsed = HoldRequestSchema.parse({ ...baseHoldBody(), ssrSelections: {} });
    expect(parsed.ssrSelections).toEqual({});
  });

  it('accepts a hold body with full ssrSelections', () => {
    const parsed = HoldRequestSchema.parse({
      ...baseHoldBody(),
      ssrSelections: {
        meals: [
          {
            segmentId: 'BLR-DEL',
            airlineCode: '6E',
            flightNumber: '203',
            wayType: 1,
            origin: 'BLR',
            destination: 'DEL',
            code: 'VEG',
            description: 'Vegetarian',
            pricePaise: 25_000,
          },
        ],
        seats: [
          {
            segmentId: 'BLR-DEL',
            code: '12A',
            rowNo: 12,
            seatNo: 'A',
            seatType: 'Window',
            pricePaise: 50_000,
            paxIndex: 0,
          },
        ],
      },
    });
    expect(parsed.ssrSelections?.meals).toHaveLength(1);
    expect(parsed.ssrSelections?.seats).toHaveLength(1);
  });

  it('rejects invalid pricePaise inside ssrSelections (deep validation)', () => {
    expect(() =>
      HoldRequestSchema.parse({
        ...baseHoldBody(),
        ssrSelections: {
          meals: [
            { segmentId: 'X', code: 'V', description: 'V', pricePaise: -100 },
          ],
        },
      }),
    ).toThrow();
  });
});
