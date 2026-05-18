// Pure-function tests for the TBO flight Search transforms.
//
// Two surfaces:
//   - buildTboSearchRequest — our normalized request → TBO Air payload
//   - mapResultToOption     — one TBO result → NormalizedFareOption
//   - packTboFareToken / unpackTboFareToken — round-trip safety
//   - decimalToPaise — money coercion edge cases

import { describe, expect, it } from 'vitest';
import {
  buildTboPassengers,
  buildTboSearchRequest,
  buildTboSsrPayload,
  decimalRupeesToPaise,
  decimalToPaise,
  mapChangeRequestStatusEnum,
  mapResultToOption,
  mapTboFareQuoteForRoute,
  mapTboFareRulesForRoute,
  mapTboItineraryToBookingDetails,
  mapTboSSRForRoute,
  packTboFareToken,
  perPaxFareSplit,
  unpackTboFareToken,
} from '../src/adapters/tbo-flight/transforms.js';
import type {
  NormalizedHoldRequest,
  NormalizedPassenger,
  NormalizedSsrSelections,
} from '../src/adapters/types.js';
import type {
  TboAirFareQuoteResult,
  TboAirSSREnvelope,
  TboAirSearchResult,
  TboBookingItinerary,
  TboFareBreakdownPerPax,
  TboFareRule,
} from '../src/adapters/tbo-flight/types.js';

const baseSearchReq = (): NormalizedSearchRequest => ({
  searchId: 'srch-1',
  request: {
    tripType: 'ONEWAY',
    travelClass: 'ECONOMY',
    pax: { adults: 1, children: 0, infants: 0 },
    segments: [{ origin: 'BLR', destination: 'DEL', date: '2026-08-15' }],
  },
});

describe('buildTboSearchRequest', () => {
  it('maps ONEWAY → JourneyType=1', () => {
    const body = buildTboSearchRequest(baseSearchReq());
    expect(body.JourneyType).toBe(1);
  });

  it('maps ROUNDTRIP → JourneyType=2', () => {
    const req = baseSearchReq();
    req.request.tripType = 'ROUNDTRIP';
    expect(buildTboSearchRequest(req).JourneyType).toBe(2);
  });

  it('maps MULTICITY → JourneyType=3', () => {
    const req = baseSearchReq();
    req.request.tripType = 'MULTICITY';
    expect(buildTboSearchRequest(req).JourneyType).toBe(3);
  });

  it('maps cabin class to TBO enum', () => {
    const req = baseSearchReq();
    req.request.travelClass = 'BUSINESS';
    const body = buildTboSearchRequest(req);
    expect(body.Segments[0]!.FlightCabinClass).toBe(4);
  });

  it('stringifies pax counts (TBO expects strings)', () => {
    const req = baseSearchReq();
    req.request.pax = { adults: 2, children: 1, infants: 1 };
    const body = buildTboSearchRequest(req);
    expect(body.AdultCount).toBe('2');
    expect(body.ChildCount).toBe('1');
    expect(body.InfantCount).toBe('1');
  });

  it('formats date as YYYY-MM-DDT00:00:00 from a string input', () => {
    const body = buildTboSearchRequest(baseSearchReq());
    expect(body.Segments[0]!.PreferredDepartureTime).toBe('2026-08-15T00:00:00');
  });

  it('formats date as YYYY-MM-DDT00:00:00 from a Date object input', () => {
    // Reflects real runtime behaviour: SearchRequestSchema's z.coerce.date()
    // turns the wire string "2026-08-15" into a Date object before the
    // adapter sees it. Naive template-stringing a Date would emit
    // "Tue Aug 15 2026 00:00:00 GMT+0530..." which TBO rejects with
    // "Invalid Date Format" — the regression this guards against.
    const req = baseSearchReq();
    req.request.segments = [
      {
        origin: 'BLR',
        destination: 'DEL',
        date: new Date(Date.UTC(2026, 7, 15)) as unknown as string,
      },
    ];
    const body = buildTboSearchRequest(req);
    expect(body.Segments[0]!.PreferredDepartureTime).toBe('2026-08-15T00:00:00');
  });

  it('emits one Segment per request segment', () => {
    const req = baseSearchReq();
    req.request.segments = [
      { origin: 'BLR', destination: 'DEL', date: '2026-08-15' },
      { origin: 'DEL', destination: 'BOM', date: '2026-08-20' },
    ];
    const body = buildTboSearchRequest(req);
    expect(body.Segments).toHaveLength(2);
    expect(body.Segments[1]!.Origin).toBe('DEL');
  });
});

describe('decimalToPaise', () => {
  it('converts whole rupees to paise', () => {
    expect(decimalToPaise(5000)).toBe(500_000);
    expect(decimalToPaise(0)).toBe(0);
  });

  it('handles fractional rupees with rounding', () => {
    expect(decimalToPaise(123.45)).toBe(12_345);
    expect(decimalToPaise(0.01)).toBe(1);
    expect(decimalToPaise(0.005)).toBe(1); // banker's rounding edge
  });

  it('coerces numeric strings (TBO sometimes stringifies fares)', () => {
    expect(decimalToPaise('5000')).toBe(500_000);
    expect(decimalToPaise('123.45')).toBe(12_345);
  });

  it('returns 0 for null / undefined / NaN / negative', () => {
    expect(decimalToPaise(null)).toBe(0);
    expect(decimalToPaise(undefined)).toBe(0);
    expect(decimalToPaise('')).toBe(0);
    expect(decimalToPaise('not-a-number')).toBe(0);
    expect(decimalToPaise(-100)).toBe(0); // never negative
  });
});

describe('packTboFareToken / unpackTboFareToken', () => {
  it('round-trips the four identifying fields', () => {
    const payload = {
      resultIndex: 'OB1-X-Y-Z',
      traceId: 'trace-uuid-1234',
      source: 'GDS',
      isLcc: false,
    };
    const token = packTboFareToken(payload);
    expect(unpackTboFareToken(token)).toEqual(payload);
  });

  it('produces a URL-safe token (base64url, no padding chars in the alphabet)', () => {
    const token = packTboFareToken({
      resultIndex: 'a/b+c=',
      traceId: 't',
      source: '6E',
      isLcc: true,
    });
    // base64url uses [-_A-Za-z0-9] and may end with padding-free output
    expect(token).toMatch(/^[A-Za-z0-9_-]+={0,2}$/);
  });

  it('throws on invalid token', () => {
    expect(() => unpackTboFareToken('not-a-real-token')).toThrow(/invalid TBO fareToken/);
  });
});

describe('mapResultToOption', () => {
  const baseResult = (): TboAirSearchResult => ({
    ResultIndex: 'OB1-RES-001',
    Source: 'GDS',
    IsLCC: false,
    IsRefundable: true,
    Fare: { BaseFare: 5000, Tax: 750, Currency: 'INR' },
    FareBreakdown: [
      { PassengerType: 1, PassengerCount: 1, BaseFare: 5000, Tax: 600, YQTax: 150 },
    ],
    Segments: [
      [
        {
          Airline: { AirlineCode: '6E', AirlineName: 'IndiGo', FlightNumber: '203', FareClass: 'V' },
          Origin: {
            Airport: { AirportCode: 'BLR', CityName: 'Bengaluru', Terminal: '2' },
            DepTime: '2026-08-15T08:30:00',
          },
          Destination: {
            Airport: { AirportCode: 'DEL', CityName: 'New Delhi', Terminal: '3' },
            ArrTime: '2026-08-15T11:15:00',
          },
          Duration: 165,
          Baggage: '15 KG',
          CabinBaggage: '7 KG',
          StopOver: false,
        },
      ],
    ],
    FareRules: [{ FareRuleDetail: 'Cancellation: INR 3500 + fare diff' }],
  });

  it('flattens segment groups + maps airline + airports', () => {
    const opt = mapResultToOption(baseResult(), {
      searchTraceId: 't-1',
      travelClass: 'ECONOMY',
    });
    expect(opt.segments).toHaveLength(1);
    const seg = opt.segments[0]!;
    expect(seg.flightNumber).toBe('6E203');
    expect(seg.airline.code).toBe('6E');
    expect(seg.origin.code).toBe('BLR');
    expect(seg.origin.terminal).toBe('2');
    expect(seg.destination.code).toBe('DEL');
    expect(seg.duration).toBe(165);
    expect(seg.stopOver).toBe(0);
  });

  it('parses TBO datetime strings to ISO-Z', () => {
    const opt = mapResultToOption(baseResult(), {
      searchTraceId: 't-1',
      travelClass: 'ECONOMY',
    });
    expect(opt.segments[0]!.departure).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('splits per-pax base + tax in paise', () => {
    const result = baseResult();
    result.FareBreakdown = [
      { PassengerType: 1, PassengerCount: 2, BaseFare: 10000, Tax: 1200, YQTax: 300 },
    ];
    const opt = mapResultToOption(result, { searchTraceId: 't-1', travelClass: 'ECONOMY' });
    // 10000/2 = 5000 rupees = 500_000 paise per adult
    expect(opt.perPax.adult.baseFarePaise).toBe(500_000);
    // (1200 + 300)/2 = 750 rupees = 75_000 paise per adult
    expect(opt.perPax.adult.taxesPaise).toBe(75_000);
  });

  it('returns 0/0 for absent pax types (no children/infants)', () => {
    const opt = mapResultToOption(baseResult(), {
      searchTraceId: 't-1',
      travelClass: 'ECONOMY',
    });
    expect(opt.perPax.child).toEqual({ baseFarePaise: 0, taxesPaise: 0 });
    expect(opt.perPax.infant).toEqual({ baseFarePaise: 0, taxesPaise: 0 });
  });

  it('marks LCC results with source=LCC, GDS with source=API', () => {
    const lcc = { ...baseResult(), IsLCC: true };
    expect(mapResultToOption(lcc, { searchTraceId: 't', travelClass: 'ECONOMY' }).source).toBe(
      'LCC',
    );
    const gds = { ...baseResult(), IsLCC: false };
    expect(mapResultToOption(gds, { searchTraceId: 't', travelClass: 'ECONOMY' }).source).toBe(
      'API',
    );
  });

  it('packs ResultIndex + TraceId into the supplierFareToken (round-trips)', () => {
    const opt = mapResultToOption(baseResult(), {
      searchTraceId: 'trace-abc',
      travelClass: 'ECONOMY',
    });
    const unpacked = unpackTboFareToken(opt.supplierFareToken);
    expect(unpacked.resultIndex).toBe('OB1-RES-001');
    expect(unpacked.traceId).toBe('trace-abc');
    expect(unpacked.source).toBe('GDS');
    expect(unpacked.isLcc).toBe(false);
  });

  it('flattens outbound + inbound segment groups for return trips', () => {
    const result = baseResult();
    // Append an inbound segment group — TBO models domestic non-combined
    // returns as Segments[0]=OB, Segments[1]=IB.
    result.Segments = [
      result.Segments![0]!,
      [
        {
          Airline: { AirlineCode: '6E', AirlineName: 'IndiGo', FlightNumber: '204' },
          Origin: { Airport: { AirportCode: 'DEL' }, DepTime: '2026-08-20T14:00:00' },
          Destination: { Airport: { AirportCode: 'BLR' }, ArrTime: '2026-08-20T16:50:00' },
          Duration: 170,
        },
      ],
    ];
    const opt = mapResultToOption(result, {
      searchTraceId: 't-1',
      travelClass: 'ECONOMY',
    });
    expect(opt.segments).toHaveLength(2);
    expect(opt.segments[0]!.origin.code).toBe('BLR');
    expect(opt.segments[1]!.origin.code).toBe('DEL');
  });

  it('forwards refundable + baggage + fareRule fields', () => {
    const opt = mapResultToOption(baseResult(), {
      searchTraceId: 't-1',
      travelClass: 'ECONOMY',
    });
    expect(opt.refundable).toBe(true);
    expect(opt.baggageCheckin).toBe('15 KG');
    expect(opt.baggageCabin).toBe('7 KG');
    expect(opt.fareRuleDescription).toBe('Cancellation: INR 3500 + fare diff');
  });
});

describe('mapTboFareRulesForRoute', () => {
  it('maps origin/destination → segmentId', () => {
    const rules: TboFareRule[] = [
      {
        Origin: 'BLR',
        Destination: 'DEL',
        Airline: '6E',
        FareBasisCode: 'VOWAH',
        FareRuleDetail: '<p>cancellation rules…</p>',
      },
    ];
    const out = mapTboFareRulesForRoute(rules);
    expect(out).toHaveLength(1);
    expect(out[0]!.segmentId).toBe('BLR-DEL');
    expect(out[0]!.name).toBe('6E VOWAH');
    expect(out[0]!.html).toBe('<p>cancellation rules…</p>');
  });

  it('falls back to FareRuleIndex when origin/destination are missing', () => {
    const rules: TboFareRule[] = [
      { FareRuleIndex: 'rule-7', FareRuleDetail: 'x' },
    ];
    expect(mapTboFareRulesForRoute(rules)[0]!.segmentId).toBe('rule-7');
  });

  it('falls back to FareFamilyCode when airline + fare basis are absent', () => {
    const rules: TboFareRule[] = [
      { Origin: 'BLR', Destination: 'DEL', FareFamilyCode: 'SUPER_LITE' },
    ];
    expect(mapTboFareRulesForRoute(rules)[0]!.name).toBe('SUPER_LITE');
  });

  it('falls back to "Fare rule" generic label when nothing is named', () => {
    const rules: TboFareRule[] = [{ Origin: 'BLR', Destination: 'DEL' }];
    expect(mapTboFareRulesForRoute(rules)[0]!.name).toBe('Fare rule');
  });

  it('falls back to FareRestriction when FareRuleDetail is missing', () => {
    const rules: TboFareRule[] = [
      { Origin: 'BLR', Destination: 'DEL', FareRestriction: 'NON-REF' },
    ];
    expect(mapTboFareRulesForRoute(rules)[0]!.html).toBe('NON-REF');
  });

  it('returns empty html when both FareRuleDetail + FareRestriction are absent', () => {
    const rules: TboFareRule[] = [{ Origin: 'BLR', Destination: 'DEL' }];
    expect(mapTboFareRulesForRoute(rules)[0]!.html).toBe('');
  });

  it('preserves order + handles multi-leg responses (return / multi-city)', () => {
    const rules: TboFareRule[] = [
      { Origin: 'BLR', Destination: 'DEL', Airline: '6E', FareRuleDetail: 'OB rules' },
      { Origin: 'DEL', Destination: 'BLR', Airline: '6E', FareRuleDetail: 'IB rules' },
    ];
    const out = mapTboFareRulesForRoute(rules);
    expect(out.map((r) => r.segmentId)).toEqual(['BLR-DEL', 'DEL-BLR']);
    expect(out.map((r) => r.html)).toEqual(['OB rules', 'IB rules']);
  });

  it('returns [] for an empty input', () => {
    expect(mapTboFareRulesForRoute([])).toEqual([]);
  });
});

describe('mapTboFareQuoteForRoute', () => {
  const baseQuote = (): TboAirFareQuoteResult => ({
    ResultIndex: 'OB1-RES-001',
    Source: 'GDS',
    IsLCC: false,
    IsRefundable: true,
    IsPriceChanged: false,
    IsCancellationPolicyChanged: false,
    Fare: { BaseFare: 5000, Tax: 750, Currency: 'INR' },
    FareBreakdown: [
      { PassengerType: 1, PassengerCount: 2, BaseFare: 10000, Tax: 1200, YQTax: 300 },
    ],
    LastTicketDate: '2026-08-14T23:59:00',
  });

  it('sums newTotalPaise across all FareBreakdown rows', () => {
    const result = baseQuote();
    result.FareBreakdown = [
      { PassengerType: 1, PassengerCount: 2, BaseFare: 10000, Tax: 1200, YQTax: 300 },
      { PassengerType: 2, PassengerCount: 1, BaseFare: 4000, Tax: 600 },
      { PassengerType: 3, PassengerCount: 1, BaseFare: 1000, Tax: 100 },
    ];
    // (10000+1200+300) + (4000+600) + (1000+100) = 17200 rupees = 1_720_000 paise
    expect(mapTboFareQuoteForRoute(result).newTotalPaise).toBe(1_720_000);
  });

  it('falls back to flat Fare when FareBreakdown is empty', () => {
    const result: TboAirFareQuoteResult = {
      Fare: { BaseFare: 5000, Tax: 750, YQTax: 0 },
      FareBreakdown: [],
    };
    // 5750 rupees = 575_000 paise
    expect(mapTboFareQuoteForRoute(result).newTotalPaise).toBe(575_000);
  });

  it('treats IsPriceChanged=true as authoritative drift signal', () => {
    const result = baseQuote();
    result.IsPriceChanged = true;
    expect(mapTboFareQuoteForRoute(result, 1_150_000).priceChanged).toBe(true);
  });

  it('detects drift via originalTotalPaise comparison when IsPriceChanged is unset', () => {
    const result = baseQuote();
    result.IsPriceChanged = undefined;
    // FareBreakdown sums to 11500 rupees = 1_150_000 paise
    // Original was 1_000_000 → ₹1500 drift, well above the ₹1 threshold
    expect(mapTboFareQuoteForRoute(result, 1_000_000).priceChanged).toBe(true);
  });

  it('ignores sub-rupee drift (treats as same price)', () => {
    const result = baseQuote();
    result.IsPriceChanged = false;
    // Original was 1_150_050 → 50 paise drift, under the ₹1 threshold
    expect(mapTboFareQuoteForRoute(result, 1_150_050).priceChanged).toBe(false);
  });

  it('returns priceChanged=false when both flag and drift are clean', () => {
    const result = baseQuote();
    result.IsPriceChanged = false;
    expect(mapTboFareQuoteForRoute(result, 1_150_000).priceChanged).toBe(false);
  });

  it('forwards cancellationPolicyChanged from IsCancellationPolicyChanged', () => {
    const result = baseQuote();
    result.IsCancellationPolicyChanged = true;
    expect(mapTboFareQuoteForRoute(result).cancellationPolicyChanged).toBe(true);
  });

  it('forwards lastTicketDate + isLcc verbatim', () => {
    const result = baseQuote();
    result.IsLCC = true;
    const out = mapTboFareQuoteForRoute(result);
    expect(out.isLcc).toBe(true);
    expect(out.lastTicketDate).toBe('2026-08-14T23:59:00');
  });

  it('always emits 3 pax-type rows (ADULT, CHILD, INFANT)', () => {
    const out = mapTboFareQuoteForRoute(baseQuote());
    expect(out.requiredPaxDetails.map((p) => p.paxType)).toEqual([
      'ADULT',
      'CHILD',
      'INFANT',
    ]);
  });

  it('puts dob in REQUIRED for child + infant, OPTIONAL for adult', () => {
    const out = mapTboFareQuoteForRoute(baseQuote());
    const adult = out.requiredPaxDetails.find((p) => p.paxType === 'ADULT')!;
    const child = out.requiredPaxDetails.find((p) => p.paxType === 'CHILD')!;
    const infant = out.requiredPaxDetails.find((p) => p.paxType === 'INFANT')!;
    expect(adult.optional).toContain('dob');
    expect(adult.required).not.toContain('dob');
    expect(child.required).toContain('dob');
    expect(infant.required).toContain('dob');
  });

  it('moves passport fields to REQUIRED when IsPassportRequiredAtBook=true', () => {
    const result = baseQuote();
    result.IsPassportRequiredAtBook = true;
    const out = mapTboFareQuoteForRoute(result);
    for (const p of out.requiredPaxDetails) {
      expect(p.required).toEqual(
        expect.arrayContaining(['passportNumber', 'passportExpiry', 'passportIssuingCountry']),
      );
    }
  });

  it('moves passport fields to REQUIRED when IsPassportRequiredAtTicket=true', () => {
    const result = baseQuote();
    result.IsPassportRequiredAtTicket = true;
    const out = mapTboFareQuoteForRoute(result);
    expect(
      out.requiredPaxDetails[0]!.required.includes('passportNumber'),
    ).toBe(true);
  });

  it('keeps passport in OPTIONAL when neither IsPassportRequired flag is set (domestic)', () => {
    const out = mapTboFareQuoteForRoute(baseQuote());
    for (const p of out.requiredPaxDetails) {
      expect(p.optional).toEqual(
        expect.arrayContaining(['passportNumber', 'passportExpiry', 'passportIssuingCountry']),
      );
      expect(p.required).not.toContain('passportNumber');
    }
  });

  it('always sets mandatorySsrs=null + frequentFlyerAccepted=false (TBO does not surface these)', () => {
    const out = mapTboFareQuoteForRoute(baseQuote());
    expect(out.frequentFlyerAccepted).toBe(false);
    for (const p of out.requiredPaxDetails) expect(p.mandatorySsrs).toBeNull();
  });
});

describe('mapTboSSRForRoute', () => {
  it('groups meals + baggage + seats by origin-destination', () => {
    const envelope: TboAirSSREnvelope = {
      Meal: [
        { Origin: 'BLR', Destination: 'DEL', Code: 'VEG', Description: 'Vegetarian', Price: 250, Currency: 'INR' },
        { Origin: 'BLR', Destination: 'DEL', Code: 'NVG', Description: 'Non-veg', Price: 350 },
        { Origin: 'DEL', Destination: 'BLR', Code: 'VEG', Description: 'Vegetarian', Price: 250 },
      ],
      Baggage: [
        { Origin: 'BLR', Destination: 'DEL', Code: 'BG5', Description: '5 KG extra', Weight: '5 KG', Price: 400 },
      ],
      SeatDynamic: [
        {
          Origin: 'BLR',
          Destination: 'DEL',
          SegmentSeat: [
            {
              RowSeats: [
                {
                  Seats: [
                    { Code: '1A', RowNo: 1, SeatNo: 'A', SeatType: 1, AvailablityType: 1, Price: 500 },
                    { Code: '1B', RowNo: 1, SeatNo: 'B', SeatType: 3, AvailablityType: 2, Price: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = mapTboSSRForRoute(envelope);
    expect(out.segments).toHaveLength(2);
    const blrDel = out.segments.find((s) => s.segmentId === 'BLR-DEL')!;
    expect(blrDel.meals).toHaveLength(2);
    expect(blrDel.baggage).toHaveLength(1);
    expect(blrDel.seatRows).toHaveLength(1);
    expect(blrDel.seatRows[0]!.seats).toHaveLength(2);

    const delBlr = out.segments.find((s) => s.segmentId === 'DEL-BLR')!;
    expect(delBlr.meals).toHaveLength(1);
    expect(delBlr.baggage).toHaveLength(0);
    expect(delBlr.seatRows).toHaveLength(0);
  });

  it('converts prices from rupees-decimal to paise', () => {
    const envelope: TboAirSSREnvelope = {
      Meal: [{ Origin: 'BLR', Destination: 'DEL', Code: 'VEG', Description: 'V', Price: 250.50 }],
    };
    const out = mapTboSSRForRoute(envelope);
    expect(out.segments[0]!.meals[0]!.pricePaise).toBe(25_050);
  });

  it('parses baggage weight from "5 KG" string format', () => {
    const envelope: TboAirSSREnvelope = {
      Baggage: [
        { Origin: 'BLR', Destination: 'DEL', Code: 'B5', Description: 'Extra 5kg', Weight: '5 KG', Price: 400 },
        { Origin: 'BLR', Destination: 'DEL', Code: 'B10', Description: 'Extra 10kg', Weight: 10, Price: 700 },
      ],
    };
    const out = mapTboSSRForRoute(envelope);
    expect(out.segments[0]!.baggage[0]!.weightKg).toBe(5);
    expect(out.segments[0]!.baggage[1]!.weightKg).toBe(10);
  });

  it('maps seat type code to label (1=Window, 2=Aisle, 3=Middle)', () => {
    const envelope: TboAirSSREnvelope = {
      SeatDynamic: [
        {
          Origin: 'BLR',
          Destination: 'DEL',
          SegmentSeat: [
            {
              RowSeats: [
                {
                  Seats: [
                    { Code: '1A', RowNo: 1, SeatNo: 'A', SeatType: 1, AvailablityType: 1 },
                    { Code: '1C', RowNo: 1, SeatNo: 'C', SeatType: 2, AvailablityType: 1 },
                    { Code: '1B', RowNo: 1, SeatNo: 'B', SeatType: 3, AvailablityType: 1 },
                    { Code: '1D', RowNo: 1, SeatNo: 'D', SeatType: 99, AvailablityType: 1 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = mapTboSSRForRoute(envelope);
    const seats = out.segments[0]!.seatRows[0]!.seats;
    expect(seats.find((s) => s.seatNo === 'A')!.seatType).toBe('Window');
    expect(seats.find((s) => s.seatNo === 'C')!.seatType).toBe('Aisle');
    expect(seats.find((s) => s.seatNo === 'B')!.seatType).toBe('Middle');
    expect(seats.find((s) => s.seatNo === 'D')!.seatType).toBe('Unknown');
  });

  it('marks only AvailablityType=1 as bookable', () => {
    const envelope: TboAirSSREnvelope = {
      SeatDynamic: [
        {
          Origin: 'BLR',
          Destination: 'DEL',
          SegmentSeat: [
            {
              RowSeats: [
                {
                  Seats: [
                    { Code: '1A', RowNo: 1, SeatNo: 'A', SeatType: 1, AvailablityType: 1 },
                    { Code: '1B', RowNo: 1, SeatNo: 'B', SeatType: 3, AvailablityType: 2 }, // Reserved
                    { Code: '1C', RowNo: 1, SeatNo: 'C', SeatType: 2, AvailablityType: 5 }, // NotAvailable
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = mapTboSSRForRoute(envelope);
    const seats = out.segments[0]!.seatRows[0]!.seats;
    expect(seats.find((s) => s.seatNo === 'A')!.available).toBe(true);
    expect(seats.find((s) => s.seatNo === 'B')!.available).toBe(false);
    expect(seats.find((s) => s.seatNo === 'C')!.available).toBe(false);
  });

  it('sorts rows ascending and dedupes seats by code (per-pax-type duplicates)', () => {
    const envelope: TboAirSSREnvelope = {
      SeatDynamic: [
        {
          Origin: 'BLR',
          Destination: 'DEL',
          SegmentSeat: [
            {
              RowSeats: [
                {
                  Seats: [
                    { Code: '3A', RowNo: 3, SeatNo: 'A', SeatType: 1, AvailablityType: 1 },
                    { Code: '1A', RowNo: 1, SeatNo: 'A', SeatType: 1, AvailablityType: 1 },
                    { Code: '2A', RowNo: 2, SeatNo: 'A', SeatType: 1, AvailablityType: 1 },
                  ],
                },
              ],
            },
            {
              // Per-pax-type duplicate of row 1 — should be deduped on Code
              RowSeats: [
                {
                  Seats: [{ Code: '1A', RowNo: 1, SeatNo: 'A', SeatType: 1, AvailablityType: 1 }],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = mapTboSSRForRoute(envelope);
    const rows = out.segments[0]!.seatRows;
    expect(rows.map((r) => r.rowNo)).toEqual([1, 2, 3]);
    expect(rows[0]!.seats).toHaveLength(1); // 1A not duplicated
  });

  it('includes segments that have only meals (no seat map)', () => {
    const envelope: TboAirSSREnvelope = {
      Meal: [{ Origin: 'BLR', Destination: 'DEL', Code: 'VEG', Description: 'V', Price: 250 }],
    };
    const out = mapTboSSRForRoute(envelope);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.meals).toHaveLength(1);
    expect(out.segments[0]!.seatRows).toHaveLength(0);
  });

  it('handles MealDynamic / BaggageDynamic sandbox variant by flattening', () => {
    const envelope: TboAirSSREnvelope = {
      MealDynamic: [
        [
          { Origin: 'BLR', Destination: 'DEL', Code: 'VEG', Description: 'V', Price: 250 },
        ],
      ],
      BaggageDynamic: [
        [
          { Origin: 'BLR', Destination: 'DEL', Code: 'B5', Description: '5kg', Weight: '5 KG', Price: 400 },
        ],
      ],
    };
    const out = mapTboSSRForRoute(envelope);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.meals).toHaveLength(1);
    expect(out.segments[0]!.baggage).toHaveLength(1);
  });

  it('drops malformed seats (rowNo=0 / no SeatNo)', () => {
    const envelope: TboAirSSREnvelope = {
      SeatDynamic: [
        {
          Origin: 'BLR',
          Destination: 'DEL',
          SegmentSeat: [
            {
              RowSeats: [
                {
                  Seats: [
                    { Code: '1A', RowNo: 1, SeatNo: 'A', SeatType: 1, AvailablityType: 1 },
                    // header row — drop
                    { Code: '0', RowNo: 0, SeatNo: '', SeatType: 0, AvailablityType: 1 },
                    // missing seatNo — drop
                    { Code: '2', RowNo: 2, SeatType: 1, AvailablityType: 1 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = mapTboSSRForRoute(envelope);
    expect(out.segments[0]!.seatRows).toHaveLength(1);
    expect(out.segments[0]!.seatRows[0]!.rowNo).toBe(1);
  });

  it('returns empty segments[] for empty envelope', () => {
    expect(mapTboSSRForRoute({}).segments).toEqual([]);
  });

  it('buckets origin-less items under "unknown" segment', () => {
    const envelope: TboAirSSREnvelope = {
      Meal: [
        { Code: 'VEG', Description: 'Veg', Price: 250 }, // no origin/destination
      ],
    };
    const out = mapTboSSRForRoute(envelope);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.segmentId).toBe('unknown');
    expect(out.segments[0]!.meals).toHaveLength(1);
  });
});

describe('perPaxFareSplit', () => {
  it('divides totals evenly when divisible', () => {
    const breakdown: TboFareBreakdownPerPax[] = [
      { PassengerType: 1, PassengerCount: 2, BaseFare: 10000, Tax: 1200, YQTax: 800 },
    ];
    const passengers: NormalizedPassenger[] = [
      { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'X' },
      { type: 'ADULT', title: 'MRS', firstName: 'B', lastName: 'X' },
    ];
    const out = perPaxFareSplit(breakdown, passengers);
    expect(out).toHaveLength(2);
    expect(out[0]!.BaseFare).toBe(5000);
    expect(out[1]!.BaseFare).toBe(5000);
    expect(out[0]!.Tax).toBe(600);
    expect(out[0]!.YQTax).toBe(400);
  });

  it('absorbs the rounding remainder into the lead pax (sum equals total)', () => {
    const breakdown: TboFareBreakdownPerPax[] = [
      { PassengerType: 1, PassengerCount: 3, BaseFare: 1000.0, Tax: 100.0 },
    ];
    const passengers: NormalizedPassenger[] = Array.from({ length: 3 }, (_, i) => ({
      type: 'ADULT' as const,
      title: 'MR',
      firstName: `P${i}`,
      lastName: 'X',
    }));
    const out = perPaxFareSplit(breakdown, passengers);
    // 1000 / 3 = 333.33 (rounded down to 2dp = 333.33). Remainder = 0.01.
    // Lead absorbs the 0.01 → 333.34. Sum = 333.34 + 333.33 + 333.33 = 1000.00.
    const sum = out.reduce((s, p) => s + p.BaseFare, 0);
    expect(Math.round(sum * 100)).toBe(Math.round(1000 * 100));
    expect(out[0]!.BaseFare).toBeGreaterThanOrEqual(out[1]!.BaseFare);
  });

  it('sums totals across multiple FareBreakdown rows (Adult + Child + Infant)', () => {
    const breakdown: TboFareBreakdownPerPax[] = [
      { PassengerType: 1, PassengerCount: 1, BaseFare: 5000, Tax: 600 },
      { PassengerType: 2, PassengerCount: 1, BaseFare: 4000, Tax: 600 },
      { PassengerType: 3, PassengerCount: 1, BaseFare: 1000, Tax: 100 },
    ];
    const passengers: NormalizedPassenger[] = [
      { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'X' },
      { type: 'CHILD', title: 'MSTR', firstName: 'C', lastName: 'X' },
      { type: 'INFANT', title: 'MISS', firstName: 'I', lastName: 'X' },
    ];
    const out = perPaxFareSplit(breakdown, passengers);
    // Sum BaseFare across pax = 10000; per-pax = 3333.33 + remainder 0.01 → 3333.34
    const sumBase = out.reduce((s, p) => s + p.BaseFare, 0);
    expect(Math.round(sumBase * 100)).toBe(1_000_000); // = 10000.00 INR
  });

  it('returns zero-fare allocations when breakdown is empty', () => {
    const passengers: NormalizedPassenger[] = [
      { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'X' },
    ];
    const out = perPaxFareSplit(undefined, passengers);
    expect(out[0]!.BaseFare).toBe(0);
    expect(out[0]!.Tax).toBe(0);
    expect(out[0]!.Currency).toBe('INR');
  });

  it('returns [] when passengers list is empty', () => {
    expect(perPaxFareSplit([{ PassengerType: 1, PassengerCount: 1 }], [])).toEqual([]);
  });

  it('forwards the FareBreakdown currency', () => {
    const breakdown: TboFareBreakdownPerPax[] = [
      {
        PassengerType: 1,
        PassengerCount: 1,
        BaseFare: 100,
        Tax: 10,
        Currency: 'USD',
      },
    ];
    const passengers: NormalizedPassenger[] = [
      { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'X' },
    ];
    expect(perPaxFareSplit(breakdown, passengers)[0]!.Currency).toBe('USD');
  });
});

describe('buildTboPassengers', () => {
  const baseHoldReq = (
    passengers: NormalizedPassenger[],
  ): NormalizedHoldRequest => ({
    supplierFareToken: 'irrelevant-here',
    passengerCount: {
      adults: passengers.filter((p) => p.type === 'ADULT').length,
      children: passengers.filter((p) => p.type === 'CHILD').length,
      infants: passengers.filter((p) => p.type === 'INFANT').length,
    },
    passengers,
    contact: { email: 'lead@example.com', mobile: '919876543210', countryCode: '+91' },
  });

  const breakdown: TboFareBreakdownPerPax[] = [
    { PassengerType: 1, PassengerCount: 1, BaseFare: 5000, Tax: 750 },
  ];

  it('maps title constants to TBO Title strings', () => {
    const passengers: NormalizedPassenger[] = [
      { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'X' },
      { type: 'ADULT', title: 'MRS', firstName: 'B', lastName: 'X' },
      { type: 'ADULT', title: 'MS', firstName: 'C', lastName: 'X' },
      { type: 'CHILD', title: 'MSTR', firstName: 'D', lastName: 'X' },
      { type: 'CHILD', title: 'MISS', firstName: 'E', lastName: 'X' },
    ];
    const out = buildTboPassengers(baseHoldReq(passengers), breakdown);
    expect(out.map((p) => p.Title)).toEqual(['Mr', 'Mrs', 'Ms', 'Mstr', 'Miss']);
  });

  it('falls back to "Mr" for an unknown title', () => {
    const passengers: NormalizedPassenger[] = [
      { type: 'ADULT', title: 'WeirdTitle', firstName: 'A', lastName: 'X' },
    ];
    expect(buildTboPassengers(baseHoldReq(passengers), breakdown)[0]!.Title).toBe('Mr');
  });

  it('maps PaxType: ADULT=1, CHILD=2, INFANT=3', () => {
    const passengers: NormalizedPassenger[] = [
      { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'X' },
      { type: 'CHILD', title: 'MSTR', firstName: 'B', lastName: 'X' },
      { type: 'INFANT', title: 'MISS', firstName: 'C', lastName: 'X' },
    ];
    const out = buildTboPassengers(baseHoldReq(passengers), breakdown);
    expect(out.map((p) => p.PaxType)).toEqual([1, 2, 3]);
  });

  it('marks the first ADULT as lead and writes contact details to lead only', () => {
    const passengers: NormalizedPassenger[] = [
      { type: 'INFANT', title: 'MISS', firstName: 'I', lastName: 'X' },
      { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'X' },
      { type: 'ADULT', title: 'MRS', firstName: 'B', lastName: 'X' },
    ];
    const out = buildTboPassengers(baseHoldReq(passengers), breakdown);
    expect(out.map((p) => p.IsLeadPax)).toEqual([false, true, false]);
    expect(out[1]!.Email).toBe('lead@example.com');
    expect(out[1]!.ContactNo).toBe('919876543210');
    expect(out[0]!.Email).toBeUndefined();
    expect(out[2]!.Email).toBeUndefined();
  });

  it('formats DateOfBirth + PassportExpiry as YYYY-MM-DD', () => {
    const passengers: NormalizedPassenger[] = [
      {
        type: 'ADULT',
        title: 'MR',
        firstName: 'A',
        lastName: 'X',
        dateOfBirth: new Date('1990-05-12T00:00:00Z'),
        passport: {
          number: 'P1234567',
          issuingCountry: 'IN',
          expiry: new Date('2030-12-31T00:00:00Z'),
        },
      },
    ];
    const out = buildTboPassengers(baseHoldReq(passengers), breakdown);
    expect(out[0]!.DateOfBirth).toBe('1990-05-12');
    expect(out[0]!.PassportExpiry).toBe('2030-12-31');
    expect(out[0]!.PassportNo).toBe('P1234567');
    expect(out[0]!.PassportIssuingCountry).toBe('IN');
  });

  it('drops DateOfBirth when undefined or invalid', () => {
    const passengers: NormalizedPassenger[] = [
      {
        type: 'ADULT',
        title: 'MR',
        firstName: 'A',
        lastName: 'X',
        dateOfBirth: new Date('not-a-date'),
      },
    ];
    expect(buildTboPassengers(baseHoldReq(passengers), breakdown)[0]!.DateOfBirth).toBeUndefined();
  });

  it('maps gender: M=1, F=2; absent stays undefined', () => {
    const passengers: NormalizedPassenger[] = [
      { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'X', gender: 'M' },
      { type: 'ADULT', title: 'MRS', firstName: 'B', lastName: 'X', gender: 'F' },
      { type: 'ADULT', title: 'MS', firstName: 'C', lastName: 'X' },
    ];
    const out = buildTboPassengers(baseHoldReq(passengers), breakdown);
    expect(out[0]!.Gender).toBe(1);
    expect(out[1]!.Gender).toBe(2);
    expect(out[2]!.Gender).toBeUndefined();
  });

  it('attaches per-pax Fare allocations from perPaxFareSplit', () => {
    const passengers: NormalizedPassenger[] = [
      { type: 'ADULT', title: 'MR', firstName: 'A', lastName: 'X' },
      { type: 'ADULT', title: 'MRS', firstName: 'B', lastName: 'X' },
    ];
    const out = buildTboPassengers(baseHoldReq(passengers), [
      { PassengerType: 1, PassengerCount: 2, BaseFare: 10000, Tax: 1200 },
    ]);
    expect(out[0]!.Fare.BaseFare).toBeGreaterThan(0);
    expect(out[1]!.Fare.BaseFare).toBeGreaterThan(0);
    // Sum-across-pax must equal the total (TBO §9.5 invariant).
    const sumBase = out.reduce((s, p) => s + p.Fare.BaseFare, 0);
    expect(Math.round(sumBase * 100)).toBe(1_000_000); // 10000.00 INR
  });

  it('still picks a lead pax when no ADULT is present (falls through to nothing)', () => {
    // Edge case: an INFANT-only request (would never pass upstream
    // validation but the helper should not throw).
    const passengers: NormalizedPassenger[] = [
      { type: 'INFANT', title: 'MISS', firstName: 'I', lastName: 'X' },
    ];
    const out = buildTboPassengers(baseHoldReq(passengers), breakdown);
    // No ADULT → no lead. Email/ContactNo dropped.
    expect(out[0]!.IsLeadPax).toBe(false);
    expect(out[0]!.Email).toBeUndefined();
  });
});

describe('buildTboSsrPayload', () => {
  it('returns empty object when input is undefined', () => {
    expect(buildTboSsrPayload(undefined)).toEqual({});
  });

  it('returns empty object when all selection arrays are empty', () => {
    expect(buildTboSsrPayload({ meals: [], baggage: [], seats: [] })).toEqual({});
  });

  it('omits keys with empty arrays (not [] = TBO ambiguous semantics)', () => {
    const out = buildTboSsrPayload({
      meals: [
        {
          segmentId: 'BLR-DEL',
          code: 'VEG',
          description: 'Vegetarian',
          pricePaise: 25_000,
          currency: 'INR',
          airlineCode: '6E',
          flightNumber: '203',
          wayType: 1,
          origin: 'BLR',
          destination: 'DEL',
        },
      ],
      baggage: [],
      seats: [],
    });
    expect(out.Meal).toHaveLength(1);
    expect(out).not.toHaveProperty('Baggage');
    expect(out).not.toHaveProperty('SeatPreference');
  });

  it('maps meal selections with full routing context', () => {
    const selections: NormalizedSsrSelections = {
      meals: [
        {
          segmentId: 'BLR-DEL',
          code: 'VEG',
          description: 'Vegetarian',
          pricePaise: 25_000,
          currency: 'INR',
          airlineCode: '6E',
          flightNumber: '203',
          wayType: 1,
          origin: 'BLR',
          destination: 'DEL',
        },
      ],
    };
    const out = buildTboSsrPayload(selections);
    expect(out.Meal).toEqual([
      {
        AirlineCode: '6E',
        FlightNumber: '203',
        WayType: 1,
        Code: 'VEG',
        Description: 'Vegetarian',
        Price: 250,
        Origin: 'BLR',
        Destination: 'DEL',
        Currency: 'INR',
      },
    ]);
  });

  it('converts pricePaise back to decimal rupees in TBO Price field', () => {
    const out = buildTboSsrPayload({
      meals: [
        {
          segmentId: 'X',
          code: 'A',
          description: 'A',
          pricePaise: 50_050,
          currency: 'INR',
        },
      ],
    });
    expect(out.Meal![0]!.Price).toBe(500.5);
  });

  it('maps baggage selections with weightKg + price round-trip', () => {
    const out = buildTboSsrPayload({
      baggage: [
        {
          segmentId: 'BLR-DEL',
          code: 'B5',
          description: '5 KG extra',
          weightKg: 5,
          pricePaise: 40_000,
          currency: 'INR',
          airlineCode: '6E',
          flightNumber: '203',
          wayType: 1,
          origin: 'BLR',
          destination: 'DEL',
        },
      ],
    });
    expect(out.Baggage).toEqual([
      {
        AirlineCode: '6E',
        FlightNumber: '203',
        WayType: 1,
        Code: 'B5',
        Description: '5 KG extra',
        Weight: 5,
        Price: 400,
        Origin: 'BLR',
        Destination: 'DEL',
        Currency: 'INR',
      },
    ]);
  });

  it('maps seat selections with rowNo + seatNo + paxIndex', () => {
    const out = buildTboSsrPayload({
      seats: [
        {
          segmentId: 'BLR-DEL',
          code: '1A',
          rowNo: 1,
          seatNo: 'A',
          seatType: 'Window',
          pricePaise: 50_000,
          currency: 'INR',
          paxIndex: 0,
          airlineCode: '6E',
          flightNumber: '203',
          wayType: 1,
          origin: 'BLR',
          destination: 'DEL',
        },
      ],
    });
    expect(out.SeatPreference).toEqual([
      {
        AirlineCode: '6E',
        FlightNumber: '203',
        WayType: 1,
        Code: '1A',
        RowNo: 1,
        SeatNo: 'A',
        Description: 'Window',
        Price: 500,
        Origin: 'BLR',
        Destination: 'DEL',
        Currency: 'INR',
      },
    ]);
  });

  it('falls back to empty strings when routing fields are missing', () => {
    // Some non-TBO suppliers might emit selections without airline/flight
    // routing (eTrav signature). The TBO payload accepts empty strings
    // for known-but-unused fields rather than dropping the SSR entirely.
    const out = buildTboSsrPayload({
      meals: [
        { segmentId: 'BLR-DEL', code: 'VEG', description: 'Veg', pricePaise: 25_000, currency: 'INR' },
      ],
    });
    const meal = out.Meal![0]!;
    expect(meal.AirlineCode).toBe('');
    expect(meal.FlightNumber).toBe('');
    expect(meal.WayType).toBe(1);
    expect(meal.Origin).toBe('');
    expect(meal.Destination).toBe('');
  });

  it('forwards multiple picks per category', () => {
    const out = buildTboSsrPayload({
      meals: [
        { segmentId: 'BLR-DEL', code: 'V1', description: 'V1', pricePaise: 100, currency: 'INR' },
        { segmentId: 'BLR-DEL', code: 'V2', description: 'V2', pricePaise: 200, currency: 'INR' },
      ],
      seats: [
        {
          segmentId: 'BLR-DEL',
          code: '1A',
          rowNo: 1,
          seatNo: 'A',
          pricePaise: 100,
          currency: 'INR',
          paxIndex: 0,
        },
        {
          segmentId: 'BLR-DEL',
          code: '1B',
          rowNo: 1,
          seatNo: 'B',
          pricePaise: 100,
          currency: 'INR',
          paxIndex: 1,
        },
      ],
    });
    expect(out.Meal).toHaveLength(2);
    expect(out.SeatPreference).toHaveLength(2);
  });
});

describe('mapTboItineraryToBookingDetails', () => {
  it('returns UNKNOWN status with fallback ref when itinerary missing', () => {
    const out = mapTboItineraryToBookingDetails(undefined, '12345');
    expect(out.supplierBookingRef).toBe('12345');
    expect(out.status).toBe('UNKNOWN');
    expect(out.pnr).toBeUndefined();
  });

  it('maps BookingStatus enum correctly', () => {
    const cases: Array<[number, string]> = [
      [0, 'PENDING'],
      [1, 'CONFIRMED'],
      [2, 'TICKETED'],
      [3, 'CANCELLED'],
      [4, 'FAILED'],
    ];
    for (const [code, expected] of cases) {
      const out = mapTboItineraryToBookingDetails(
        { BookingId: 1, BookingStatus: code },
        '1',
      );
      expect(out.status).toBe(expected);
    }
  });

  it('falls back to free-text Status (uppercased) when BookingStatus missing', () => {
    const out = mapTboItineraryToBookingDetails(
      { BookingId: 1, Status: 'Confirmed' },
      '1',
    );
    expect(out.status).toBe('CONFIRMED');
  });

  it('returns UNKNOWN when both enum and text are missing', () => {
    const out = mapTboItineraryToBookingDetails({ BookingId: 1 }, '1');
    expect(out.status).toBe('UNKNOWN');
  });

  it('prefers itinerary BookingId over fallback ref', () => {
    const out = mapTboItineraryToBookingDetails(
      { BookingId: 999, Status: 'Confirmed' },
      '1',
    );
    expect(out.supplierBookingRef).toBe('999');
  });

  it('uses fallback ref when itinerary BookingId missing', () => {
    const out = mapTboItineraryToBookingDetails(
      { Status: 'Confirmed' },
      'fallback-ref',
    );
    expect(out.supplierBookingRef).toBe('fallback-ref');
  });

  it('trims and exposes PNR; drops blank PNRs', () => {
    expect(
      mapTboItineraryToBookingDetails(
        { BookingId: 1, PNR: '  ABC123  ', Status: 'Confirmed' },
        '1',
      ).pnr,
    ).toBe('ABC123');
    expect(
      mapTboItineraryToBookingDetails(
        { BookingId: 1, PNR: '   ', Status: 'Confirmed' },
        '1',
      ).pnr,
    ).toBeUndefined();
  });

  it('collects per-pax tickets and dedupes ticket numbers', () => {
    const itinerary: TboBookingItinerary = {
      BookingId: 1,
      PNR: 'ABC',
      BookingStatus: 2,
      Passenger: [
        {
          Title: 'MR',
          FirstName: 'A',
          LastName: 'X',
          PaxType: 1,
          Ticket: { TicketNumber: 'T-1', TicketStatus: 'Issued' },
        },
        {
          Title: 'MRS',
          FirstName: 'B',
          LastName: 'X',
          PaxType: 1,
          Ticket: { TicketNumber: 'T-2', TicketStatus: 'Issued' },
        },
        // Duplicate (e.g. group rebookings) — expect dedupe.
        {
          Title: 'MR',
          FirstName: 'A',
          LastName: 'X',
          PaxType: 1,
          Ticket: { TicketNumber: 'T-1', TicketStatus: 'Issued' },
        },
      ],
      InvoiceNo: 'INV-1',
      LastTicketDate: '2026-01-01T00:00:00',
    };
    const out = mapTboItineraryToBookingDetails(itinerary, '1');
    expect(out.status).toBe('TICKETED');
    expect(out.extra?.ticketNumbers).toEqual(['T-1', 'T-2']);
    expect(out.extra?.paxTickets).toHaveLength(3);
    expect(out.extra?.invoiceNo).toBe('INV-1');
    expect(out.extra?.lastTicketDate).toBe('2026-01-01T00:00:00');
  });

  it('drops blank/whitespace-only ticket numbers', () => {
    const out = mapTboItineraryToBookingDetails(
      {
        BookingId: 1,
        BookingStatus: 1,
        Passenger: [
          { FirstName: 'A', LastName: 'X', Ticket: { TicketNumber: '   ' } },
          { FirstName: 'B', LastName: 'X', Ticket: { TicketNumber: '' } },
          { FirstName: 'C', LastName: 'X' },
        ],
      },
      '1',
    );
    expect(out.extra?.ticketNumbers).toBeUndefined();
  });

  it('omits paxTickets/ticketNumbers from extra when no passengers', () => {
    const out = mapTboItineraryToBookingDetails(
      { BookingId: 1, BookingStatus: 1, Passenger: [] },
      '1',
    );
    expect(out.extra?.paxTickets).toBeUndefined();
    expect(out.extra?.ticketNumbers).toBeUndefined();
  });

  it('handles unknown numeric BookingStatus by falling back to free-text', () => {
    const out = mapTboItineraryToBookingDetails(
      { BookingId: 1, BookingStatus: 99, Status: 'Pending' },
      '1',
    );
    // BookingStatus=99 is unknown → mapper falls through to text Status.
    expect(out.status).toBe('PENDING');
  });
});

describe('mapChangeRequestStatusEnum', () => {
  it('maps all 5 known values', () => {
    expect(mapChangeRequestStatusEnum(0)).toBe('UNKNOWN'); // NotSet
    expect(mapChangeRequestStatusEnum(1)).toBe('PENDING');
    expect(mapChangeRequestStatusEnum(2)).toBe('IN_PROGRESS');
    expect(mapChangeRequestStatusEnum(3)).toBe('PROCESSED');
    expect(mapChangeRequestStatusEnum(4)).toBe('REJECTED');
  });

  it('returns UNKNOWN for undefined', () => {
    expect(mapChangeRequestStatusEnum(undefined)).toBe('UNKNOWN');
  });
});

describe('decimalRupeesToPaise', () => {
  it('converts decimal numbers to integer paise', () => {
    expect(decimalRupeesToPaise(100)).toBe(10_000);
    expect(decimalRupeesToPaise(1234.56)).toBe(123_456);
    expect(decimalRupeesToPaise(0)).toBe(0);
  });

  it('parses decimal strings', () => {
    expect(decimalRupeesToPaise('250.00')).toBe(25_000);
    expect(decimalRupeesToPaise('99.99')).toBe(9_999);
  });

  it('returns undefined for missing/blank/non-numeric inputs', () => {
    expect(decimalRupeesToPaise(undefined)).toBeUndefined();
    expect(decimalRupeesToPaise('')).toBeUndefined();
    expect(decimalRupeesToPaise('not-a-number')).toBeUndefined();
  });

  it('handles paise rounding without floating-point drift', () => {
    // 199.99 * 100 = 19998.999... — Math.round keeps us at 19999.
    expect(decimalRupeesToPaise(199.99)).toBe(19_999);
  });
});
