// MockSeatSellerClient — deterministic in-memory implementation of
// ISeatSellerClient.
//
// Mandatory in development per CLAUDE.md §0 Law 3 ("there is no SeatSeller
// sandbox — test bookings against the real API are real money"). Used in
// tests via the factory.
//
// Design choices:
//   - Deterministic seed data keyed by (source, destination, doj). One
//     fixture trip per route returned by getAvailableTrips so the booking
//     flow has a predictable target.
//   - Failure injection via a per-instance "fail next call" hook. Tests
//     prime it via mock.failNext('TENTATIVE_BOOKING_FAILED') before
//     calling the action under test. (We don't need the HTTP-header-based
//     hook from the spec because there's no HTTP layer here.)
//   - Real-feeling latency disabled by default — tests would slow down.
//     Toggle via constructor opt `simulateLatency: true` for manual demos.
//   - In-memory block / book state — block creates a row, bookTicket
//     promotes it to a ticket, cancel marks it cancelled. No persistence;
//     each fresh MockSeatSellerClient is a clean slate.

import { randomUUID } from 'node:crypto';
import {
  GenderRestrictionError,
  InsufficientBalanceError,
  InvalidBoardingPointError,
  ItineraryExpiredError,
  SeatNoLongerAvailableError,
  SeatSellerError,
  TentativeBookingFailedError,
  TransportError,
  VendorFailureError,
} from './errors.js';
import type { ISeatSellerClient } from './client.interface.js';
import type {
  SeatSellerAvailableTrip,
  SeatSellerAvailableTripsRequest,
  SeatSellerBlockPassenger,
  SeatSellerBlockRequest,
  SeatSellerBlockResponse,
  SeatSellerBookResponse,
  SeatSellerBpDpDetails,
  SeatSellerBpDpDetailsRequest,
  SeatSellerBusCancellationInfoRequest,
  SeatSellerCancelRequest,
  SeatSellerCancelResponse,
  SeatSellerCancellationData,
  SeatSellerCancelledTinRef,
  SeatSellerCity,
  SeatSellerCityAlias,
  SeatSellerSeat,
  SeatSellerStop,
  SeatSellerTicket,
  SeatSellerTripDetails,
  SeatSellerTripDetailsV2Request,
  SeatSellerUpdatedFare,
} from './types.js';

/** Names of failures the mock can be primed to inject on the next call. */
export type MockFailureCode =
  | 'SEAT_NO_LONGER_AVAILABLE'
  | 'TENTATIVE_BOOKING_FAILED'
  | 'INSUFFICIENT_BALANCE'
  | 'ITINERARY_EXPIRED'
  | 'INVALID_BOARDING_POINT'
  | 'GENDER_RESTRICTION'
  | 'VENDOR_FAILURE'
  | 'TIMEOUT'
  | 'BOOK_TIMEOUT_THEN_RECONCILE';

interface MockBlockState {
  blockKey: string;
  trip: SeatSellerAvailableTrip;
  passengers: SeatSellerBlockPassenger[];
  blockedAt: Date;
  /** Promoted to a ticket once bookTicket fires successfully. */
  tin?: string;
  pnr?: string;
  status: 'BLOCKED' | 'BOOKED' | 'CANCELLED' | 'PARTIALLY_CANCELLED';
  cancelledSeats?: string[];
}

export interface MockSeatSellerClientOptions {
  /** Add 200–1500ms random latency to every call. Off by default for tests. */
  simulateLatency?: boolean;
  /** Block window in ms — when bookTicket fires after this, throws ItineraryExpiredError.
   *  Defaults to 8 minutes per SeatSeller spec. Override in tests for fast expiry. */
  blockTtlMs?: number;
}

export class MockSeatSellerClient implements ISeatSellerClient {
  private readonly opts: Required<MockSeatSellerClientOptions>;
  private readonly blocks = new Map<string, MockBlockState>();
  private readonly tinIndex = new Map<string, string>(); // tin → blockKey
  /** Queue of failure codes to throw, FIFO. Populated by failNext(). */
  private readonly failureQueue: MockFailureCode[] = [];

  constructor(opts: MockSeatSellerClientOptions = {}) {
    this.opts = {
      simulateLatency: opts.simulateLatency ?? false,
      blockTtlMs: opts.blockTtlMs ?? 8 * 60_000,
    };
  }

  /** Test hook: schedule the next call to throw the named failure. */
  failNext(code: MockFailureCode): void {
    this.failureQueue.push(code);
  }

  /** Test hook: drop all primed failures + clear in-memory state. Use in
   *  beforeEach() so tests don't bleed state across each other. */
  reset(): void {
    this.failureQueue.length = 0;
    this.blocks.clear();
    this.tinIndex.clear();
  }

  // ────────── Reference data ──────────

  async getCities(): Promise<SeatSellerCity[]> {
    await this.maybeLatency();
    this.maybeFail();
    return MOCK_CITIES;
  }

  async getAliases(): Promise<SeatSellerCityAlias[]> {
    await this.maybeLatency();
    this.maybeFail();
    return MOCK_ALIASES;
  }

  // ────────── Search ──────────

  async getAvailableTrips(req: SeatSellerAvailableTripsRequest): Promise<SeatSellerAvailableTrip[]> {
    await this.maybeLatency();
    this.maybeFail();
    return mockTripsFor(req);
  }

  // ────────── Trip detail (LIVE) ──────────

  async getTripDetails(tripId: string): Promise<SeatSellerTripDetails> {
    await this.maybeLatency();
    this.maybeFail();
    const trip = findMockTripById(tripId);
    if (!trip) {
      throw new SeatSellerError('NOT_FOUND', `Mock: tripId ${tripId} not found`);
    }
    return mockTripDetails(trip);
  }

  async getTripDetailsV2(req: SeatSellerTripDetailsV2Request): Promise<SeatSellerTripDetails> {
    await this.maybeLatency();
    this.maybeFail();
    const trip = findMockTripByInventoryId(req.inventoryId);
    if (!trip) {
      throw new SeatSellerError('NOT_FOUND', `Mock: inventoryId ${req.inventoryId} not found`);
    }
    return mockTripDetails(trip);
  }

  async getBpDpDetails(req: SeatSellerBpDpDetailsRequest): Promise<SeatSellerBpDpDetails> {
    await this.maybeLatency();
    this.maybeFail();
    const trip = findMockTripById(req.tripId);
    if (!trip) {
      throw new SeatSellerError('NOT_FOUND', `Mock: tripId ${req.tripId} not found`);
    }
    return {
      tripId: req.tripId,
      boardingPoints: MOCK_BOARDING_POINTS,
      droppingPoints: MOCK_DROPPING_POINTS,
    };
  }

  // ────────── Booking lifecycle ──────────

  async blockTicket(req: SeatSellerBlockRequest): Promise<SeatSellerBlockResponse> {
    await this.maybeLatency();
    this.maybeFail();

    const trip = findMockTripById(req.tripId);
    if (!trip) {
      throw new SeatSellerError('NOT_FOUND', `Mock: tripId ${req.tripId} not found`);
    }

    if (req.boardingPointId !== MOCK_BOARDING_POINTS[0]!.id) {
      throw new InvalidBoardingPointError({
        upstream: 'Invalid boarding point',
        context: { tripId: req.tripId, boardingPointId: req.boardingPointId },
      });
    }

    const blockKey = `BLK-${randomUUID()}`;
    this.blocks.set(blockKey, {
      blockKey,
      trip,
      passengers: req.passengers,
      blockedAt: new Date(),
      status: 'BLOCKED',
    });
    return { blockKey };
  }

  async getUpdatedFare(blockKey: string): Promise<SeatSellerUpdatedFare> {
    await this.maybeLatency();
    this.maybeFail();
    const blk = this.blocks.get(blockKey);
    if (!blk) {
      throw new SeatSellerError('NOT_FOUND', `Mock: blockKey ${blockKey} not found`);
    }
    const total = blk.passengers.reduce((s, p) => s + p.fareINR, 0);
    return {
      blockKey,
      customerPriceBreakUp: [
        { field: 'BASE_FARE', label: 'Base fare', amountINR: total * 0.9 },
        { field: 'OPERATOR_SERVICE_CHARGE', label: 'Operator charge', amountINR: total * 0.07 },
        { field: 'GST', label: 'GST', amountINR: total * 0.03 },
        { field: 'TOTAL_FARE', label: 'Total', amountINR: total },
      ],
      totalFareINR: total,
    };
  }

  async bookTicket(blockKey: string): Promise<SeatSellerBookResponse> {
    await this.maybeLatency();
    // Special failure: simulate the timeout-then-reconcile path. We mark
    // the block as booked internally (so checkBookedTicket finds it) but
    // still throw a transport-style error to the caller. The booking
    // service is supposed to catch, sleep 5s, then call checkBookedTicket.
    if (this.failureQueue[0] === 'BOOK_TIMEOUT_THEN_RECONCILE') {
      this.failureQueue.shift();
      const blk = this.blocks.get(blockKey);
      if (blk) {
        blk.tin = `TIN-${randomUUID().slice(0, 8).toUpperCase()}`;
        blk.pnr = `PNR${blk.tin.slice(4)}`;
        blk.status = 'BOOKED';
        this.tinIndex.set(blk.tin, blockKey);
      }
      // Throw as a TransportError so the booking-service reconciler
      // recognises it as recoverable (instanceof check). Spec §8.2
      // step 11 — the only failure class the reconciler retries.
      throw new TransportError({
        upstream: 'Mock: simulated bookTicket timeout',
        retryable: true,
      });
    }

    this.maybeFail();

    const blk = this.blocks.get(blockKey);
    if (!blk) {
      throw new SeatSellerError('NOT_FOUND', `Mock: blockKey ${blockKey} not found`);
    }
    if (blk.status === 'BOOKED' && blk.tin) {
      // Idempotent: same blockKey gets the same tin.
      return { tin: blk.tin, pnr: blk.pnr };
    }
    const ageMs = Date.now() - blk.blockedAt.getTime();
    if (ageMs > this.opts.blockTtlMs) {
      throw new ItineraryExpiredError({ context: { blockKey, ageMs } });
    }
    const tin = `TIN-${randomUUID().slice(0, 8).toUpperCase()}`;
    blk.tin = tin;
    blk.pnr = `PNR${tin.slice(4)}`;
    blk.status = 'BOOKED';
    this.tinIndex.set(tin, blockKey);
    return { tin, pnr: blk.pnr };
  }

  async checkBookedTicket(blockKey: string): Promise<SeatSellerTicket | null> {
    await this.maybeLatency();
    this.maybeFail();
    const blk = this.blocks.get(blockKey);
    if (!blk || blk.status !== 'BOOKED' || !blk.tin) return null;
    return mockTicketFromBlock(blk);
  }

  async getTicket(tin: string): Promise<SeatSellerTicket> {
    await this.maybeLatency();
    this.maybeFail();
    const blockKey = this.tinIndex.get(tin);
    const blk = blockKey ? this.blocks.get(blockKey) : null;
    if (!blk || !blk.tin) {
      throw new SeatSellerError('NOT_FOUND', `Mock: tin ${tin} not found`);
    }
    return mockTicketFromBlock(blk);
  }

  // ────────── Cancellation ──────────

  async getCancellationData(tin: string): Promise<SeatSellerCancellationData> {
    await this.maybeLatency();
    this.maybeFail();
    const blockKey = this.tinIndex.get(tin);
    const blk = blockKey ? this.blocks.get(blockKey) : null;
    if (!blk) throw new SeatSellerError('NOT_FOUND', `Mock: tin ${tin} not found`);
    const seats = blk.passengers.map((p) => {
      const charge = Math.min(p.fareINR, p.fareINR * 0.1); // 10% mock charge
      return {
        seatName: p.seatName,
        baseFareINR: p.fareINR,
        cancellationChargeINR: charge,
        refundINR: p.fareINR - charge,
      };
    });
    return {
      tin,
      seats,
      totalChargeINR: seats.reduce((s, x) => s + x.cancellationChargeINR, 0),
      totalRefundINR: seats.reduce((s, x) => s + x.refundINR, 0),
    };
  }

  async cancelTicket(req: SeatSellerCancelRequest): Promise<SeatSellerCancelResponse> {
    await this.maybeLatency();
    this.maybeFail();
    const blockKey = this.tinIndex.get(req.tin);
    const blk = blockKey ? this.blocks.get(blockKey) : null;
    if (!blk) throw new SeatSellerError('NOT_FOUND', `Mock: tin ${req.tin} not found`);
    const seatsToCancel =
      req.seatsToCancel && req.seatsToCancel.length > 0
        ? req.seatsToCancel
        : blk.passengers.map((p) => p.seatName);

    const cancelled = blk.passengers.filter((p) => seatsToCancel.includes(p.seatName));
    const refundTotal = cancelled.reduce((s, p) => s + p.fareINR * 0.9, 0);
    const chargeTotal = cancelled.reduce((s, p) => s + p.fareINR * 0.1, 0);

    blk.cancelledSeats = [...(blk.cancelledSeats ?? []), ...seatsToCancel];
    blk.status = blk.cancelledSeats.length === blk.passengers.length ? 'CANCELLED' : 'PARTIALLY_CANCELLED';

    return {
      tin: req.tin,
      cancelledSeats: seatsToCancel,
      cancellationChargeINR: chargeTotal,
      refundAmountINR: refundTotal,
      cancellationReference: `CRF-${randomUUID().slice(0, 8).toUpperCase()}`,
    };
  }

  async busCancellationInfo(
    _req: SeatSellerBusCancellationInfoRequest,
  ): Promise<SeatSellerCancelledTinRef[]> {
    await this.maybeLatency();
    this.maybeFail();
    // Return any tins that were operator-cancelled in the mock state.
    const out: SeatSellerCancelledTinRef[] = [];
    for (const blk of this.blocks.values()) {
      if (blk.status === 'CANCELLED' && blk.tin) {
        out.push({ tin: blk.tin, reasonCode: 'BUS_CANCELLATION' });
      }
    }
    return out;
  }

  // ────────── Internal ──────────

  private async maybeLatency(): Promise<void> {
    if (!this.opts.simulateLatency) return;
    const ms = 200 + Math.random() * 1300;
    await new Promise((r) => setTimeout(r, ms));
  }

  private maybeFail(): void {
    // Peek first — BOOK_TIMEOUT_THEN_RECONCILE is bookTicket-only, but
    // realistic test flows call failNext() before the search/block
    // chain runs. Skip past it here so it lands at bookTicket where
    // the inline handler consumes it. Other codes pop normally.
    if (this.failureQueue[0] === 'BOOK_TIMEOUT_THEN_RECONCILE') return;
    const code = this.failureQueue.shift();
    if (!code) return;
    switch (code) {
      case 'SEAT_NO_LONGER_AVAILABLE':
        throw new SeatNoLongerAvailableError();
      case 'TENTATIVE_BOOKING_FAILED':
        throw new TentativeBookingFailedError();
      case 'INSUFFICIENT_BALANCE':
        throw new InsufficientBalanceError();
      case 'ITINERARY_EXPIRED':
        throw new ItineraryExpiredError();
      case 'INVALID_BOARDING_POINT':
        throw new InvalidBoardingPointError();
      case 'GENDER_RESTRICTION':
        throw new GenderRestrictionError(['L4', 'L3']);
      case 'VENDOR_FAILURE':
        throw new VendorFailureError();
      case 'TIMEOUT':
        throw new SeatSellerError('TIMEOUT', 'Mock: simulated timeout', { retryable: false });
      case 'BOOK_TIMEOUT_THEN_RECONCILE':
        // Unreachable due to the peek-skip above. Kept for exhaustiveness.
        throw new SeatSellerError('UNEXPECTED', 'BOOK_TIMEOUT_THEN_RECONCILE only valid in bookTicket');
    }
  }
}

// ────────── Fixture data ──────────
// Minimal-but-realistic fixtures. Real captured fixtures land in
// tests/fixtures/seatseller/ during Phase 2 hardening — this seed
// covers the happy paths.

const MOCK_CITIES: SeatSellerCity[] = [
  { id: 122, name: 'Bangalore', state: 'Karnataka' },
  { id: 124, name: 'Chennai', state: 'Tamil Nadu' },
  { id: 142, name: 'Mumbai', state: 'Maharashtra' },
  { id: 156, name: 'Delhi', state: 'Delhi' },
  { id: 175, name: 'Hyderabad', state: 'Telangana' },
  { id: 199, name: 'Pune', state: 'Maharashtra' },
];

const MOCK_ALIASES: SeatSellerCityAlias[] = [
  { cityId: 122, alias: 'Bengaluru' },
  { cityId: 142, alias: 'Bombay' },
];

const MOCK_BOARDING_POINTS: SeatSellerStop[] = [
  {
    id: 1001,
    name: 'Majestic',
    address: 'Bus stand near KSR station',
    landmark: 'KSR Station',
    time: 1290, // 21:30 IST
    contact: '+91 9000000001',
  },
  {
    id: 1002,
    name: 'Madiwala',
    address: 'Madiwala check-post',
    landmark: 'Silk Board',
    time: 1320, // 22:00 IST
    contact: '+91 9000000002',
  },
];

const MOCK_DROPPING_POINTS: SeatSellerStop[] = [
  {
    id: 2001,
    name: 'CMBT',
    address: 'Chennai Mofussil Bus Terminus',
    landmark: 'CMBT',
    time: 360, // 06:00 IST next day (encoded ssMinutes; mock keeps it simple)
    contact: '+91 9000000010',
  },
];

const MOCK_SEATS: SeatSellerSeat[] = [
  { seatName: 'L1', seatType: 'Sleeper', fareINR: 1200, available: true, ladiesSeat: false, malesSeat: false, row: 1, col: 1, zIndex: 0 },
  { seatName: 'L2', seatType: 'Sleeper', fareINR: 1200, available: true, ladiesSeat: false, malesSeat: false, row: 1, col: 2, zIndex: 0 },
  { seatName: 'L3', seatType: 'Sleeper', fareINR: 1200, available: true, ladiesSeat: true, malesSeat: false, row: 2, col: 1, zIndex: 0 },
  { seatName: 'L4', seatType: 'Sleeper', fareINR: 1200, available: true, ladiesSeat: true, malesSeat: false, row: 2, col: 2, zIndex: 0 },
  { seatName: 'U1', seatType: 'Sleeper', fareINR: 1100, available: true, ladiesSeat: false, malesSeat: false, row: 1, col: 1, zIndex: 1 },
  { seatName: 'U2', seatType: 'Sleeper', fareINR: 1100, available: false, ladiesSeat: false, malesSeat: false, row: 1, col: 2, zIndex: 1 },
];

function mockTripsFor(req: SeatSellerAvailableTripsRequest): SeatSellerAvailableTrip[] {
  // Single deterministic trip per (source, destination) pair. Tests rely
  // on this being stable.
  return [
    {
      tripId: `MOCK-TRIP-${req.source}-${req.destination}-${req.doj}`,
      inventoryId: `MOCK-INV-${req.source}-${req.destination}-${req.doj}`,
      operatorId: 9001,
      operatorName: 'TripBNG Mock Travels',
      busType: 'Bharat Benz Multi-Axle A/C Sleeper (2+1)',
      busTypeId: 17,
      source: { id: req.source, name: cityName(req.source) },
      destination: { id: req.destination, name: cityName(req.destination) },
      departureTime: 1290, // 21:30 IST
      arrivalTime: 1800, // 06:00 next day (1440 + 360)
      availableSeats: 5,
      fareMinINR: 1100,
      fareMaxINR: 1200,
      nextDay: true,
      isAc: true,
      isSleeper: true,
      bpDpSeatLayout: false,
      callFareBreakupApi: false,
      mTicketEnabled: true,
    },
  ];
}

function findMockTripById(tripId: string): SeatSellerAvailableTrip | null {
  // tripId format: MOCK-TRIP-<src>-<dst>-<doj>
  const m = tripId.match(/^MOCK-TRIP-(\d+)-(\d+)-(\d{4}-\d{2}-\d{2})$/);
  if (!m) return null;
  const [, src, dst, doj] = m;
  return mockTripsFor({ source: Number(src), destination: Number(dst), doj: doj! })[0] ?? null;
}

function findMockTripByInventoryId(invId: string): SeatSellerAvailableTrip | null {
  const m = invId.match(/^MOCK-INV-(\d+)-(\d+)-(\d{4}-\d{2}-\d{2})$/);
  if (!m) return null;
  const [, src, dst, doj] = m;
  return mockTripsFor({ source: Number(src), destination: Number(dst), doj: doj! })[0] ?? null;
}

function mockTripDetails(trip: SeatSellerAvailableTrip): SeatSellerTripDetails {
  return {
    tripId: trip.tripId,
    inventoryId: trip.inventoryId,
    forcedSeats: 'L3,L4@U1',
    cancellationPolicy: '0:2:100:0|2:24:50:0|24:-1:10:0',
    cancellationCalculationTimestamp: new Date().toISOString(),
    partialCancellationAllowed: true,
    seats: MOCK_SEATS,
    boardingPoints: MOCK_BOARDING_POINTS,
    droppingPoints: MOCK_DROPPING_POINTS,
    bpDpSeatLayout: false,
    callFareBreakupApi: false,
    mTicketEnabled: true,
  };
}

function mockTicketFromBlock(blk: MockBlockState): SeatSellerTicket {
  return {
    tin: blk.tin!,
    pnr: blk.pnr,
    blockKey: blk.blockKey,
    status: blk.status,
    trip: blk.trip,
    passengers: blk.passengers,
    fareBreakup: {
      baseFareINR: blk.passengers.reduce((s, p) => s + p.fareINR * 0.9, 0),
      operatorServiceChargeINR: blk.passengers.reduce((s, p) => s + p.fareINR * 0.07, 0),
      serviceTaxINR: blk.passengers.reduce((s, p) => s + p.fareINR * 0.03, 0),
      bookingFeeINR: 0,
      totalINR: blk.passengers.reduce((s, p) => s + p.fareINR, 0),
      rtcCustomerPriceBreakUp: null,
    },
    bookedAt: blk.blockedAt.toISOString(),
  };
}

function cityName(id: number): string {
  return MOCK_CITIES.find((c) => c.id === id)?.name ?? `City-${id}`;
}
