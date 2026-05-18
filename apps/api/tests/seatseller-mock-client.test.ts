// MockSeatSellerClient tests.
//
// The mock is what powers all dev/test booking flows (CLAUDE.md §0 Law 3).
// These tests pin its behaviour:
//   - Deterministic output keyed on (source, destination, doj)
//   - Block → book → ticket → cancel state machine
//   - Failure-injection hook for booking-service tests
//   - BOOK_TIMEOUT_THEN_RECONCILE special path

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GenderRestrictionError,
  ItineraryExpiredError,
  SeatNoLongerAvailableError,
  SeatSellerError,
  TentativeBookingFailedError,
} from '../src/adapters/seatseller/errors.js';
import { MockSeatSellerClient } from '../src/adapters/seatseller/mock-client.js';
import type { SeatSellerBlockRequest } from '../src/adapters/seatseller/types.js';

const blockReqFor = (tripId: string, inventoryId: string): SeatSellerBlockRequest => ({
  tripId,
  inventoryId,
  boardingPointId: 1001,
  droppingPointId: 2001,
  passengers: [
    {
      seatName: 'L1',
      title: 'Mr',
      name: 'Alice Test',
      age: 30,
      gender: 'FEMALE',
      mobile: '+919876543210',
      email: 'alice@example.com',
      primary: true,
      ladiesSeat: false,
      fareINR: 1200,
    },
  ],
});

describe('MockSeatSellerClient — reference data', () => {
  it('returns deterministic city list', async () => {
    const client = new MockSeatSellerClient();
    const cities = await client.getCities();
    expect(cities.length).toBeGreaterThan(0);
    expect(cities.find((c) => c.name === 'Bangalore')).toBeTruthy();
  });
});

describe('MockSeatSellerClient — search + tripDetails', () => {
  it('returns one trip per (source, destination, doj)', async () => {
    const client = new MockSeatSellerClient();
    const trips = await client.getAvailableTrips({
      source: 122,
      destination: 124,
      doj: '2026-06-15',
    });
    expect(trips).toHaveLength(1);
    expect(trips[0]!.tripId).toBe('MOCK-TRIP-122-124-2026-06-15');
  });

  it('tripDetails resolves by tripId', async () => {
    const client = new MockSeatSellerClient();
    const details = await client.getTripDetails('MOCK-TRIP-122-124-2026-06-15');
    expect(details.seats.length).toBeGreaterThan(0);
    expect(details.cancellationPolicy).toMatch(/^\d/); // SeatSeller-shaped
    expect(details.forcedSeats).toContain('@');
  });

  it('tripDetails throws NOT_FOUND for unknown tripId', async () => {
    const client = new MockSeatSellerClient();
    await expect(client.getTripDetails('UNKNOWN-TRIP')).rejects.toThrow(SeatSellerError);
  });
});

describe('MockSeatSellerClient — block → book → ticket lifecycle', () => {
  let client: MockSeatSellerClient;
  beforeEach(() => {
    client = new MockSeatSellerClient();
  });

  it('block → book → getTicket round-trips', async () => {
    const trip = (await client.getAvailableTrips({ source: 122, destination: 124, doj: '2026-06-15' }))[0]!;
    const block = await client.blockTicket(blockReqFor(trip.tripId, trip.inventoryId));
    expect(block.blockKey).toMatch(/^BLK-/);

    const book = await client.bookTicket(block.blockKey);
    expect(book.tin).toMatch(/^TIN-/);
    expect(book.pnr).toBeTruthy();

    const ticket = await client.getTicket(book.tin);
    expect(ticket.tin).toBe(book.tin);
    expect(ticket.status).toBe('BOOKED');
    expect(ticket.fareBreakup.totalINR).toBeCloseTo(1200, 2);
  });

  it('bookTicket is idempotent — same blockKey returns same tin', async () => {
    const trip = (await client.getAvailableTrips({ source: 142, destination: 156, doj: '2026-07-01' }))[0]!;
    const block = await client.blockTicket(blockReqFor(trip.tripId, trip.inventoryId));
    const first = await client.bookTicket(block.blockKey);
    const second = await client.bookTicket(block.blockKey);
    expect(first.tin).toBe(second.tin);
  });

  it('throws ItineraryExpiredError when block is older than blockTtlMs', async () => {
    vi.useFakeTimers();
    try {
      const c = new MockSeatSellerClient({ blockTtlMs: 1000 });
      const trip = (await c.getAvailableTrips({ source: 122, destination: 175, doj: '2026-08-01' }))[0]!;
      const block = await c.blockTicket(blockReqFor(trip.tripId, trip.inventoryId));
      vi.advanceTimersByTime(2000);
      await expect(c.bookTicket(block.blockKey)).rejects.toThrow(ItineraryExpiredError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('checkBookedTicket returns null when block is still open', async () => {
    const trip = (await client.getAvailableTrips({ source: 199, destination: 122, doj: '2026-06-20' }))[0]!;
    const block = await client.blockTicket(blockReqFor(trip.tripId, trip.inventoryId));
    expect(await client.checkBookedTicket(block.blockKey)).toBeNull();
  });

  it('checkBookedTicket returns the ticket once booked', async () => {
    const trip = (await client.getAvailableTrips({ source: 199, destination: 122, doj: '2026-06-20' }))[0]!;
    const block = await client.blockTicket(blockReqFor(trip.tripId, trip.inventoryId));
    await client.bookTicket(block.blockKey);
    const ticket = await client.checkBookedTicket(block.blockKey);
    expect(ticket?.status).toBe('BOOKED');
  });
});

describe('MockSeatSellerClient — failure injection', () => {
  it('throws the queued error on the next call, then heals', async () => {
    const client = new MockSeatSellerClient();
    client.failNext('SEAT_NO_LONGER_AVAILABLE');
    await expect(client.getCities()).rejects.toThrow(SeatNoLongerAvailableError);
    // Subsequent calls succeed — the queue is one-shot.
    const cities = await client.getCities();
    expect(cities.length).toBeGreaterThan(0);
  });

  it('GenderRestrictionError carries an allowedSeats list', async () => {
    const client = new MockSeatSellerClient();
    client.failNext('GENDER_RESTRICTION');
    try {
      await client.getCities();
      expect.fail('expected GenderRestrictionError');
    } catch (err) {
      expect(err).toBeInstanceOf(GenderRestrictionError);
      expect((err as GenderRestrictionError).allowedSeats.length).toBeGreaterThan(0);
    }
  });

  it('TentativeBookingFailedError fires on blockTicket', async () => {
    const client = new MockSeatSellerClient();
    const trip = (await client.getAvailableTrips({ source: 122, destination: 124, doj: '2026-06-15' }))[0]!;
    client.failNext('TENTATIVE_BOOKING_FAILED');
    await expect(client.blockTicket(blockReqFor(trip.tripId, trip.inventoryId))).rejects.toThrow(
      TentativeBookingFailedError,
    );
  });

  it('BOOK_TIMEOUT_THEN_RECONCILE: throws but checkBookedTicket recovers', async () => {
    const client = new MockSeatSellerClient();
    const trip = (await client.getAvailableTrips({ source: 122, destination: 124, doj: '2026-06-15' }))[0]!;
    const block = await client.blockTicket(blockReqFor(trip.tripId, trip.inventoryId));
    client.failNext('BOOK_TIMEOUT_THEN_RECONCILE');
    // The simulated failure is a TransportError; the booking-service
    // reconciler recognises it via `instanceof TransportError`.
    // .message reads "SeatSeller transport failure"; the timeout
    // detail is in `.upstream`.
    await expect(client.bookTicket(block.blockKey)).rejects.toThrow(/transport/i);
    // The booking-service flow does this 5s later — we verify the
    // ticket is recoverable, which is the whole point.
    const ticket = await client.checkBookedTicket(block.blockKey);
    expect(ticket).not.toBeNull();
    expect(ticket!.status).toBe('BOOKED');
  });

  it('reset() clears state + queued failures', async () => {
    const client = new MockSeatSellerClient();
    const trip = (await client.getAvailableTrips({ source: 122, destination: 124, doj: '2026-06-15' }))[0]!;
    const block = await client.blockTicket(blockReqFor(trip.tripId, trip.inventoryId));
    client.failNext('VENDOR_FAILURE');
    client.reset();
    // Queued failure cleared:
    await expect(client.getCities()).resolves.toBeTruthy();
    // In-memory state cleared:
    await expect(client.checkBookedTicket(block.blockKey)).resolves.toBeNull();
  });
});

describe('MockSeatSellerClient — cancellation', () => {
  it('full cancel returns refund close to fare * 0.9', async () => {
    const client = new MockSeatSellerClient();
    const trip = (await client.getAvailableTrips({ source: 122, destination: 124, doj: '2026-06-15' }))[0]!;
    const block = await client.blockTicket(blockReqFor(trip.tripId, trip.inventoryId));
    const book = await client.bookTicket(block.blockKey);
    const cancellation = await client.cancelTicket({ tin: book.tin });
    expect(cancellation.cancelledSeats).toEqual(['L1']);
    expect(cancellation.refundAmountINR).toBeCloseTo(1200 * 0.9, 2);
  });

  it('preview matches the actual cancel result for full cancellation', async () => {
    const client = new MockSeatSellerClient();
    const trip = (await client.getAvailableTrips({ source: 122, destination: 124, doj: '2026-06-15' }))[0]!;
    const block = await client.blockTicket(blockReqFor(trip.tripId, trip.inventoryId));
    const book = await client.bookTicket(block.blockKey);
    const preview = await client.getCancellationData(book.tin);
    const result = await client.cancelTicket({ tin: book.tin });
    expect(preview.totalRefundINR).toBeCloseTo(result.refundAmountINR, 2);
  });
});
