// ISeatSellerClient — contract both real and mock implementations satisfy.
//
// The booking service depends ONLY on this interface. Tests import
// MockSeatSellerClient via factory.ts; production wires the real one.
// Production code MUST NOT import the real client outside factory.ts —
// the spec mandates the mock is mandatory in dev, and the indirection
// here is what enforces it.

import type {
  SeatSellerAvailableTrip,
  SeatSellerAvailableTripsRequest,
  SeatSellerBlockRequest,
  SeatSellerBlockResponse,
  SeatSellerBpDpDetails,
  SeatSellerBpDpDetailsRequest,
  SeatSellerBookResponse,
  SeatSellerBusCancellationInfoRequest,
  SeatSellerCancelRequest,
  SeatSellerCancelResponse,
  SeatSellerCancellationData,
  SeatSellerCancelledTinRef,
  SeatSellerCity,
  SeatSellerCityAlias,
  SeatSellerTicket,
  SeatSellerTripDetails,
  SeatSellerTripDetailsV2Request,
  SeatSellerUpdatedFare,
} from './types.js';

export interface ISeatSellerClient {
  // ────────── Reference data (cacheable) ──────────
  getCities(): Promise<SeatSellerCity[]>;
  getAliases(): Promise<SeatSellerCityAlias[]>;

  // ────────── Search (cacheable per spec §7) ──────────
  getAvailableTrips(req: SeatSellerAvailableTripsRequest): Promise<SeatSellerAvailableTrip[]>;

  // ────────── Trip detail (NEVER cached — Law 1) ──────────
  getTripDetails(tripId: string): Promise<SeatSellerTripDetails>;
  getTripDetailsV2(req: SeatSellerTripDetailsV2Request): Promise<SeatSellerTripDetails>;
  getBpDpDetails(req: SeatSellerBpDpDetailsRequest): Promise<SeatSellerBpDpDetails>;

  // ────────── Booking lifecycle (NEVER retry blockTicket / bookTicket / cancelTicket) ──────────
  blockTicket(req: SeatSellerBlockRequest): Promise<SeatSellerBlockResponse>;
  /** Called for RTC operators where callFareBreakupApi=true. Spec §8.2 step 9. */
  getUpdatedFare(blockKey: string): Promise<SeatSellerUpdatedFare>;
  bookTicket(blockKey: string): Promise<SeatSellerBookResponse>;

  /** Reconciliation read: when bookTicket times out / disconnects, call
   *  this 5s later to discover whether SeatSeller booked it anyway.
   *  Returns null when the block is still open (not yet booked). Spec §8.2 step 11. */
  checkBookedTicket(blockKey: string): Promise<SeatSellerTicket | null>;

  /** Idempotent fetch of a confirmed ticket by tin — used post-book to
   *  pull pnr / cancellationReason / refundAmount, and by the operator-
   *  cancellation poller (spec §8.4). */
  getTicket(tin: string): Promise<SeatSellerTicket>;

  // ────────── Cancellation ──────────
  getCancellationData(tin: string): Promise<SeatSellerCancellationData>;
  cancelTicket(req: SeatSellerCancelRequest): Promise<SeatSellerCancelResponse>;

  // ────────── Background reconcilers ──────────
  busCancellationInfo(req: SeatSellerBusCancellationInfoRequest): Promise<SeatSellerCancelledTinRef[]>;
}
