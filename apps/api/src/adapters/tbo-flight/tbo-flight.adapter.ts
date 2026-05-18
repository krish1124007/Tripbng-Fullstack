// TboFlightAdapter — implements the SupplierAdapter contract for TBO's
// Air booking-engine API.
//
// Phase 1 status:
//   ✓ search           — wires Air/Search through the existing tboCall
//                        primitive (auth + audit + retry-on-Status-4)
//   ✓ fareRule         — Air/FareRule (extra method, exposed via
//                        /flights/farerule route, mirrors eTrav's pattern)
//   ✓ reprice          — Air/FareQuote (extra method, exposed via
//                        /flights/reprice; mandatory before Book per cert)
//   ✓ getSSR           — Air/SSR (extra method, exposed via /flights/ssr;
//                        meals + baggage + seat-map per segment)
//   ✓ hold             — Air/Book for GDS sources; Redis-cached request
//                        for LCC sources (rehydrated by ticket())
//   ✓ ticket           — Air/Ticket — single-shot for LCC, BookingId-based
//                        for GDS
//   ✓ cancel           — Air/SendChangeRequest (returns ChangeRequestId;
//                        background-poll worker is a follow-up)
//   ✓ retrieveBooking  — Air/GetBookingDetails (timeout-recovery + ops
//                        "refresh from supplier" action)
//
// Auth, session-cache, audit-log, redaction, and Status=4 retry all reuse
// the infrastructure built for the hotel TBO integration. The flight side
// only knows about flight-specific endpoints + transforms.

import { randomUUID } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { redis } from '../../config/redis.js';
import { tboCall } from '../../services/tbo/client.js';
import { BaseAdapter } from '../base.js';
import {
  SupplierAdapterError,
  type Capability,
  type NormalizedBookingDetails,
  type NormalizedCancelRequest,
  type NormalizedCancelResponse,
  type NormalizedFareOption,
  type NormalizedHoldRequest,
  type NormalizedHoldResponse,
  type NormalizedSearchRequest,
  type NormalizedSearchResponse,
  type NormalizedTicketRequest,
  type NormalizedTicketResponse,
} from '../types.js';
import {
  buildTboPassengers,
  buildTboSearchRequest,
  buildTboSsrPayload,
  decimalRupeesToPaise,
  mapChangeRequestStatusEnum,
  mapResultToOption,
  mapTboItineraryToBookingDetails,
  unpackTboFareToken,
} from './transforms.js';
import type {
  TboAirBookRequest,
  TboAirBookResponse,
  TboAirChangeRequestStatusRequest,
  TboAirChangeRequestStatusResponse,
  TboAirFareQuoteRequest,
  TboAirFareQuoteResponse,
  TboAirFareQuoteResult,
  TboAirFareRuleRequest,
  TboAirFareRuleResponse,
  TboAirGetBookingDetailsRequest,
  TboAirGetBookingDetailsResponse,
  TboAirSendChangeRequest,
  TboAirSendChangeRequestResponse,
  TboAirSSREnvelope,
  TboAirSSRRequest,
  TboAirSSRResponse,
  TboAirSearchResponse,
  TboAirTicketRequestGds,
  TboAirTicketRequestLcc,
  TboAirTicketResponse,
  TboAirTicketResult,
  TboFareRule,
} from './types.js';

export class TboFlightAdapter extends BaseAdapter {
  readonly code = 'TBO';
  readonly name = 'TBO Holidays (Air)';
  readonly capabilities: readonly Capability[] = [
    'SEARCH',
    'HOLD',
    'BOOK',
    'CANCEL',
    'RETRIEVE',
  ];

  // TBO sandbox routinely takes 20–25s for AirSearch even on no-result
  // queries; live searches can run longer. The outer (adapter) timeout
  // governs what the user sees; we pass a slightly looser inner HTTP
  // timeout to tboCall so the fetch aborts cleanly before withTimeout
  // wins the race. Override via env in prod.
  protected override readonly timeoutMs: number;

  /** Inner HTTP timeout — must be ≥ outer adapter timeout. We add 2s of
   *  grace so the underlying fetch returns its own AbortError (clean
   *  classification + audit row with transportError) before the outer
   *  withTimeout fires. */
  private readonly httpTimeoutMs: number;

  constructor() {
    super();
    this.timeoutMs = env.TBO_FLIGHT_SEARCH_TIMEOUT_MS;
    this.httpTimeoutMs = this.timeoutMs + 2_000;
  }

  // ────────── Search ──────────

  async search(req: NormalizedSearchRequest): Promise<NormalizedSearchResponse> {
    return this.guarded('search', async () => {
      const body = buildTboSearchRequest(req);

      // tboCall handles: token injection, ClientId/EndUserIp injection,
      // audit log persist, Status=4 force-refresh + retry once. We just
      // hand it the request body + endpoint + host. Pass our search-tuned
      // timeout so the fetch abort beats the outer withTimeout race.
      const res = await tboCall<TboAirSearchResponse>({
        method: 'AirSearch',
        host: 'flight',
        path: '/Search',
        body: body as unknown as Record<string, unknown>,
        ctx: { correlationKey: `flight-search:${req.searchId}` },
        timeoutMs: this.httpTimeoutMs,
      });

      // TBO sometimes hoists the response envelope to the root, sometimes
      // wraps in `Response`. Take whichever has the data.
      const inner = res.Response ?? res;
      const traceId = (inner.TraceId ?? '') as string;
      const resultGroups = inner.Results ?? [];

      // Flatten Results[outbound|inbound][] → one per (group, fare) tuple.
      // The dedup engine in services/search.service.ts groups by flight
      // signature regardless of which leg they came from.
      const options: NormalizedFareOption[] = [];
      for (const group of resultGroups) {
        for (const result of group ?? []) {
          try {
            options.push(
              mapResultToOption(result, {
                searchTraceId: traceId,
                travelClass: req.request.travelClass,
              }),
            );
          } catch (err) {
            // Skip individual malformed results; never tank the whole search.
            logger.warn(
              { err, resultIndex: result.ResultIndex },
              'tbo-flight: result mapping failed; skipping',
            );
          }
        }
      }

      logger.info(
        { searchId: req.searchId, traceId, options: options.length },
        'tbo-flight: search done',
      );
      return { options };
    });
  }

  // ────────── Extra methods (not in SupplierAdapter contract) ──────────

  /**
   * Fetch the HTML fare-rule blob for a previously-returned fare. Exposed
   * via a dedicated route — the UI renders the HTML in a sandboxed iframe
   * (same pattern as the eTrav adapter). The supplierFareToken carries
   * ResultIndex + TraceId, packed by `packTboFareToken` at search time.
   *
   * Returns the FareRules array directly (rules per OD leg). The route
   * layer maps to the canonical `{ segmentId, name, html }[]` shape.
   */
  async fareRule(supplierFareToken: string): Promise<TboFareRule[]> {
    return this.guarded('fareRule', async () => {
      const { resultIndex, traceId } = unpackTboFareToken(supplierFareToken);
      if (!traceId || !resultIndex) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          'TBO fareRule needs ResultIndex + TraceId from search',
          this.code,
        );
      }
      const body: Omit<TboAirFareRuleRequest, 'EndUserIp' | 'TokenId'> = {
        TraceId: traceId,
        ResultIndex: resultIndex,
      };
      const res = await tboCall<TboAirFareRuleResponse>({
        method: 'AirFareRule',
        host: 'flight',
        path: '/FareRule',
        body: body as unknown as Record<string, unknown>,
        ctx: { correlationKey: `flight-farerule:${resultIndex}` },
      });
      // Coalesce nested vs hoisted envelope.
      const inner = res.Response ?? res;
      const rules = inner.FareRules ?? [];
      logger.debug(
        { resultIndex, ruleCount: rules.length },
        'tbo-flight: fareRule done',
      );
      return rules;
    });
  }

  /**
   * Re-validate a previously-returned fare. Required-by-cert before Book —
   * surfaces price drift, supplier rule changes, and the per-result
   * Pan/Passport/GST flags driving the dynamic guest form.
   *
   * Returns the inner Results block raw; the route layer maps to the
   * canonical `{ priceChanged, newTotalPaise, requiredPaxDetails, ... }`
   * shape via `mapTboFareQuoteForRoute`.
   */
  async reprice(supplierFareToken: string): Promise<TboAirFareQuoteResult> {
    return this.guarded('reprice', async () => {
      const { resultIndex, traceId } = unpackTboFareToken(supplierFareToken);
      if (!traceId || !resultIndex) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          'TBO reprice needs ResultIndex + TraceId from search',
          this.code,
        );
      }
      const body: Omit<TboAirFareQuoteRequest, 'EndUserIp' | 'TokenId'> = {
        TraceId: traceId,
        ResultIndex: resultIndex,
      };
      const res = await tboCall<TboAirFareQuoteResponse>({
        method: 'AirFareQuote',
        host: 'flight',
        path: '/FareQuote',
        body: body as unknown as Record<string, unknown>,
        ctx: { correlationKey: `flight-farequote:${resultIndex}` },
      });
      const inner = res.Response ?? res;
      const result = inner.Results;
      if (!result) {
        throw new SupplierAdapterError(
          'UPSTREAM',
          'TBO FareQuote returned no Results block',
          this.code,
        );
      }
      logger.debug(
        { resultIndex, isPriceChanged: result.IsPriceChanged === true },
        'tbo-flight: reprice done',
      );
      return result;
    });
  }

  /**
   * Fetch the SSR (Special Service Requests) catalog for a result —
   * meals, baggage add-ons, and the seat map. Returned envelope is the
   * raw inner block; the route layer maps to the canonical UI shape via
   * `mapTboSSRForRoute`.
   *
   * Called between FareQuote and Book/Ticket. Selected SSRs are sent
   * inside the Ticket request for LCC pathways; inside Book for GDS.
   * The orchestrator (Phase 8) reads `IsLCC` to decide.
   */
  async getSSR(supplierFareToken: string): Promise<TboAirSSREnvelope> {
    return this.guarded('getSSR', async () => {
      const { resultIndex, traceId } = unpackTboFareToken(supplierFareToken);
      if (!traceId || !resultIndex) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          'TBO getSSR needs ResultIndex + TraceId from search',
          this.code,
        );
      }
      const body: Omit<TboAirSSRRequest, 'EndUserIp' | 'TokenId'> = {
        TraceId: traceId,
        ResultIndex: resultIndex,
      };
      const res = await tboCall<TboAirSSRResponse>({
        method: 'AirSSR',
        host: 'flight',
        path: '/SSR',
        body: body as unknown as Record<string, unknown>,
        ctx: { correlationKey: `flight-ssr:${resultIndex}` },
      });
      const inner = res.Response ?? res;
      logger.debug(
        {
          resultIndex,
          meals: inner.Meal?.length ?? 0,
          baggage: inner.Baggage?.length ?? 0,
          seatSegments: inner.SeatDynamic?.length ?? 0,
        },
        'tbo-flight: SSR done',
      );
      return inner;
    });
  }

  // ────────── Book + Ticket (Phase 8) ──────────

  /**
   * Hold a fare. Pathway depends on the offer's source:
   *
   *   • LCC sources (IndiGo, SpiceJet, etc.) — TBO doesn't support a
   *     held state. We cache the request in Redis under a synthetic
   *     supplierBookingRef (`LCC:<uuid>`) and `ticket()` rehydrates +
   *     calls Air/Ticket atomically (single-shot Book + Ticket).
   *
   *   • GDS sources — real Air/Book call. TBO returns a numeric BookingId
   *     and PNR; we use the BookingId stringified as supplierBookingRef.
   *     `ticket()` hits Air/Ticket(BookingId) to issue against the held PNR.
   *
   * Per-pax fare-split (TBO §9.5): we re-call Air/FareQuote to get fresh
   * FareBreakdown — TBO requires Sum(perPaxFare) to equal the FareQuote
   * total exactly. The orchestrator MAY have called FareQuote already, but
   * doing it again here is the only way the adapter can guarantee the math
   * works without trusting a cache layer.
   */
  async hold(req: NormalizedHoldRequest): Promise<NormalizedHoldResponse> {
    return this.guarded('hold', async () => {
      const tokenPayload = unpackTboFareToken(req.supplierFareToken);
      const { resultIndex, traceId, isLcc } = tokenPayload;
      if (!resultIndex || !traceId) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          'TBO hold needs ResultIndex + TraceId from search',
          this.code,
        );
      }

      // Re-quote to get fresh FareBreakdown for the per-pax split.
      const fareQuote = await this.repriceForBook(resultIndex, traceId);

      const passengers = buildTboPassengers(req, fareQuote.FareBreakdown);
      const ssrPayload = buildTboSsrPayload(req.ssrSelections);

      // ── LCC: single-shot at ticket() — cache and return synthetic ref. ──
      if (isLcc) {
        const ref = `LCC:${randomUUID()}`;
        const cached = {
          tokenPayload,
          passengers,
          contact: req.contact,
          ssrPayload, // forwarded to ticket() — see ticketLcc()
          cachedAt: new Date().toISOString(),
        };
        // 30-min TTL — matches typical FareQuote validity. Beyond this the
        // booking re-quotes anyway since the search session has expired.
        await redis.set(`tbo:flight:lcc:${ref}`, JSON.stringify(cached), 'EX', 30 * 60);
        logger.info(
          {
            resultIndex,
            ref,
            paxCount: passengers.length,
            meals: ssrPayload.Meal?.length ?? 0,
            baggage: ssrPayload.Baggage?.length ?? 0,
            seats: ssrPayload.SeatPreference?.length ?? 0,
          },
          'tbo-flight: LCC hold cached, awaiting ticket()',
        );
        return {
          supplierBookingRef: ref,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        };
      }

      // ── GDS: real Air/Book call. SSR goes in Book request (not Ticket). ──
      const body: Omit<TboAirBookRequest, 'EndUserIp' | 'TokenId'> = {
        TraceId: traceId,
        ResultIndex: resultIndex,
        Passengers: passengers,
        ...ssrPayload,
      };
      const res = await tboCall<TboAirBookResponse>({
        method: 'AirBook',
        host: 'flight',
        path: '/Book',
        body: body as unknown as Record<string, unknown>,
        ctx: { correlationKey: `flight-book:${resultIndex}` },
      });
      const inner = (res.Response_ ?? res).Response;
      if (!inner?.BookingId) {
        throw new SupplierAdapterError(
          'UPSTREAM',
          `TBO Air/Book returned no BookingId (${inner?.Status ?? 'no-status'})`,
          this.code,
        );
      }
      logger.info(
        { resultIndex, bookingId: inner.BookingId, pnr: inner.PNR },
        'tbo-flight: GDS hold success',
      );
      return {
        supplierBookingRef: String(inner.BookingId),
        expiresAt: inner.LastTicketDate
          ? new Date(inner.LastTicketDate)
          : new Date(Date.now() + 24 * 60 * 60 * 1000),
        pnr: inner.PNR,
      };
    });
  }

  /**
   * Issue the ticket. Two paths based on the supplierBookingRef format:
   *   • `LCC:<uuid>`   — rehydrate the cached request and call Air/Ticket
   *                       with the full passenger list (single-shot).
   *   • numeric string — GDS BookingId; call Air/Ticket(BookingId, PNR).
   */
  async ticket(req: NormalizedTicketRequest): Promise<NormalizedTicketResponse> {
    return this.guarded('ticket', async () => {
      const ref = req.supplierBookingRef;
      if (!ref) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          'TBO ticket needs supplierBookingRef from hold()',
          this.code,
        );
      }
      return ref.startsWith('LCC:')
        ? await this.ticketLcc(ref)
        : await this.ticketGds(ref);
    });
  }

  /** Rehydrate the LCC cache + issue. The cache row was written by hold(). */
  private async ticketLcc(ref: string): Promise<NormalizedTicketResponse> {
    const raw = await redis.get(`tbo:flight:lcc:${ref}`);
    if (!raw) {
      throw new SupplierAdapterError(
        'NOT_FOUND',
        'LCC ticket session expired or unknown',
        this.code,
      );
    }
    const cached = JSON.parse(raw) as {
      tokenPayload: { resultIndex: string; traceId: string };
      passengers: TboBookRequestPassenger[];
      contact: NormalizedHoldRequest['contact'];
      ssrPayload?: {
        Meal?: TboAirTicketRequestLcc['Meal'];
        Baggage?: TboAirTicketRequestLcc['Baggage'];
        SeatPreference?: TboAirTicketRequestLcc['SeatPreference'];
      };
    };
    const body: Omit<TboAirTicketRequestLcc, 'EndUserIp' | 'TokenId'> = {
      TraceId: cached.tokenPayload.traceId,
      ResultIndex: cached.tokenPayload.resultIndex,
      Passengers: cached.passengers,
      ...(cached.ssrPayload ?? {}),
    };
    const res = await tboCall<TboAirTicketResponse>({
      method: 'AirTicket',
      host: 'flight',
      path: '/Ticket',
      body: body as unknown as Record<string, unknown>,
      ctx: { correlationKey: `flight-ticket-lcc:${cached.tokenPayload.resultIndex}` },
    });
    const result = extractTicketResult(res);
    // Best-effort cache cleanup — session done, no point holding it.
    await redis.del(`tbo:flight:lcc:${ref}`).catch(() => undefined);
    return formatTicketResponse(result);
  }

  /** Issue against an already-held GDS BookingId. */
  private async ticketGds(supplierBookingRef: string): Promise<NormalizedTicketResponse> {
    const bookingId = Number.parseInt(supplierBookingRef, 10);
    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      throw new SupplierAdapterError(
        'BAD_REQUEST',
        `invalid TBO BookingId in supplierBookingRef: ${supplierBookingRef}`,
        this.code,
      );
    }
    // GDS Ticket needs the held PNR + BookingId. The PNR is round-tripped on
    // our Booking row at the caller layer; re-fetching via getBookingDetails
    // would be a Phase 9 feature. For now we accept the orchestrator passing
    // BookingId only and rely on TBO's BookingId-only Ticket variant.
    const body: Omit<TboAirTicketRequestGds, 'EndUserIp' | 'TokenId' | 'PNR'> = {
      TraceId: '', // refreshed via the audit row; orchestrator can provide
      BookingId: bookingId,
    };
    const res = await tboCall<TboAirTicketResponse>({
      method: 'AirTicket',
      host: 'flight',
      path: '/Ticket',
      body: body as unknown as Record<string, unknown>,
      ctx: { correlationKey: `flight-ticket-gds:${bookingId}` },
    });
    const result = extractTicketResult(res);
    return formatTicketResponse(result);
  }

  /** Inline helper — repeats Air/FareQuote to get fresh FareBreakdown for
   *  the per-pax fare-split. Doesn't share with the public reprice() because
   *  this path doesn't need the rule mapping or UI envelope. */
  private async repriceForBook(
    resultIndex: string,
    traceId: string,
  ): Promise<TboAirFareQuoteResult> {
    const body: Omit<TboAirFareQuoteRequest, 'EndUserIp' | 'TokenId'> = {
      TraceId: traceId,
      ResultIndex: resultIndex,
    };
    const res = await tboCall<TboAirFareQuoteResponse>({
      method: 'AirFareQuote',
      host: 'flight',
      path: '/FareQuote',
      body: body as unknown as Record<string, unknown>,
      ctx: { correlationKey: `flight-farequote-prebook:${resultIndex}` },
    });
    const inner = res.Response ?? res;
    const result = inner.Results;
    if (!result) {
      throw new SupplierAdapterError(
        'UPSTREAM',
        'TBO FareQuote (pre-book) returned no Results block',
        this.code,
      );
    }
    return result;
  }

  // ────────── Cancel + GetBookingDetails (Phase 9) ──────────

  /**
   * Cancel an Air booking. Fires Air/SendChangeRequest with RequestType=1
   * (Air cancel — vs hotels' RequestType=4) and returns the supplier's
   * ChangeRequestId stringified as `cancellationReference`.
   *
   * Async note: TBO settles the actual refund out-of-band (Pending →
   * InProgress → Processed). The orchestrator at services/booking commits
   * the wallet refund locally based on our own fare-rule math —
   * SendChangeRequest is a *signal*, not a money-flow trigger. A later
   * background poll (Air/GetChangeRequestStatus) will reconcile state
   * differences for ops, but the customer's wallet is already credited
   * by the time we surface this response.
   *
   * `refundAmountPaise` isn't returned here because TBO doesn't echo it
   * back from SendChangeRequest; it only appears in the Status poll. The
   * orchestrator's local refund calc is the source of truth anyway.
   */
  async cancel(req: NormalizedCancelRequest): Promise<NormalizedCancelResponse> {
    return this.guarded('cancel', async () => {
      const ref = req.supplierBookingRef;
      if (!ref) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          'TBO cancel needs supplierBookingRef',
          this.code,
        );
      }
      // Refuse LCC synthetic refs that never made it to ticket() — there's
      // nothing on the supplier to cancel. The orchestrator should treat
      // these as "no supplier action needed" and skip directly to local
      // refund accounting.
      if (ref.startsWith('LCC:')) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          'TBO cancel: LCC refs must be promoted to a real BookingId via ticket() first',
          this.code,
        );
      }
      const bookingId = Number.parseInt(ref, 10);
      if (!Number.isFinite(bookingId) || bookingId <= 0) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          `invalid TBO BookingId in supplierBookingRef: ${ref}`,
          this.code,
        );
      }

      const body: Omit<TboAirSendChangeRequest, 'EndUserIp' | 'TokenId'> = {
        BookingId: bookingId,
        RequestType: 1, // Air cancel
        // TBO surfaces this in their ops queue — keep it concise but honest.
        CancellationRemarks: (req.reason ?? 'Cancellation requested by agent').slice(0, 250),
        RequestSource: 1, // ONLINE_AGENT_INITIATED
      };
      const res = await tboCall<TboAirSendChangeRequestResponse>({
        method: 'AirSendChangeRequest',
        host: 'flight',
        path: '/SendChangeRequest',
        body: body as unknown as Record<string, unknown>,
        ctx: { correlationKey: `flight-cancel:${bookingId}` },
      });
      const inner = res.Response ?? res;
      const changeRequestId = inner.ChangeRequestId;
      if (!changeRequestId || changeRequestId <= 0) {
        throw new SupplierAdapterError(
          'UPSTREAM',
          `TBO Air/SendChangeRequest returned no ChangeRequestId (status=${inner.ChangeRequestStatus ?? 'none'})`,
          this.code,
        );
      }
      logger.info(
        { bookingId, changeRequestId, status: inner.ChangeRequestStatus },
        'tbo-flight: cancel accepted by supplier',
      );
      return {
        ok: true,
        cancellationReference: String(changeRequestId),
      };
    });
  }

  /**
   * Idempotent fetch of a booking's current supplier state. Used for:
   *   1. Timeout-recovery on Book/Ticket (spec §8.4 — the Book/Ticket call
   *      times out but the supplier may have created the booking; this is
   *      how we find out)
   *   2. Admin "refresh from supplier" action in the ops dashboard
   *   3. Reconciliation jobs comparing TBO state to ours
   *
   * Returns the canonical NormalizedBookingDetails. The richer extra block
   * (ticketNumbers, paxTickets, invoiceNo) is collected by the mapper but
   * dropped here to keep the contract narrow — the caller can re-fetch
   * via `mapTboItineraryToBookingDetails` directly when needed.
   */
  async retrieveBooking(supplierBookingRef: string): Promise<NormalizedBookingDetails> {
    return this.guarded('retrieveBooking', async () => {
      if (!supplierBookingRef) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          'TBO retrieveBooking needs supplierBookingRef',
          this.code,
        );
      }
      // LCC refs that never ticketed have no supplier-side state — surface
      // a typed NOT_FOUND so callers handle it the same as a missing booking.
      if (supplierBookingRef.startsWith('LCC:')) {
        throw new SupplierAdapterError(
          'NOT_FOUND',
          'TBO retrieveBooking: LCC refs are pre-ticket; nothing on supplier to fetch',
          this.code,
        );
      }
      const bookingId = Number.parseInt(supplierBookingRef, 10);
      if (!Number.isFinite(bookingId) || bookingId <= 0) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          `invalid TBO BookingId in supplierBookingRef: ${supplierBookingRef}`,
          this.code,
        );
      }

      const body: Omit<TboAirGetBookingDetailsRequest, 'EndUserIp' | 'TokenId'> = {
        BookingId: bookingId,
      };
      const res = await tboCall<TboAirGetBookingDetailsResponse>({
        method: 'AirGetBookingDetails',
        host: 'flight',
        path: '/GetBookingDetails',
        body: body as unknown as Record<string, unknown>,
        ctx: { correlationKey: `flight-retrieve:${bookingId}` },
      });
      const inner = res.Response ?? res;
      // TBO sandbox sometimes wraps under FlightItinerary, sometimes under
      // Itinerary — accept either.
      const itinerary = inner.FlightItinerary ?? inner.Itinerary;
      const mapped = mapTboItineraryToBookingDetails(itinerary, supplierBookingRef);
      logger.debug(
        {
          bookingId,
          pnr: mapped.pnr,
          status: mapped.status,
          tickets: mapped.extra?.ticketNumbers?.length ?? 0,
        },
        'tbo-flight: getBookingDetails done',
      );
      return {
        supplierBookingRef: mapped.supplierBookingRef,
        pnr: mapped.pnr,
        status: mapped.status,
      };
    });
  }

  /**
   * Poll the supplier-side cancellation status by ChangeRequestId. Used by
   * the cancel-poll worker (queues/tbo-flight-cancel-poll.worker.ts) to
   * reconcile our local state with TBO's async settlement pipeline.
   *
   * Returns the canonical status mapping:
   *   1 → PENDING       (queued at TBO ops)
   *   2 → IN_PROGRESS   (being worked on)
   *   3 → PROCESSED     (terminal — refund credited at TBO)
   *   4 → REJECTED      (terminal — TBO refused; ops needs to unwind)
   *   else / 0 → UNKNOWN
   *
   * `RefundAmount` and `CancellationCharge` are TBO's view of the money
   * movement — only meaningful at status=3. We expose them as paise so the
   * caller can reconcile against our local refund math (we *don't* trust
   * TBO's number; we only flag mismatches for ops review).
   */
  async getChangeRequestStatus(changeRequestId: number): Promise<{
    status: 'PENDING' | 'IN_PROGRESS' | 'PROCESSED' | 'REJECTED' | 'UNKNOWN';
    refundAmountPaise?: number;
    cancellationChargePaise?: number;
    remarks?: string;
    raw: TboAirChangeRequestStatusResponse;
  }> {
    return this.guarded('getChangeRequestStatus', async () => {
      if (!Number.isFinite(changeRequestId) || changeRequestId <= 0) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          `invalid TBO ChangeRequestId: ${changeRequestId}`,
          this.code,
        );
      }
      const body: Omit<TboAirChangeRequestStatusRequest, 'EndUserIp' | 'TokenId'> = {
        ChangeRequestId: changeRequestId,
      };
      const res = await tboCall<TboAirChangeRequestStatusResponse>({
        method: 'AirGetChangeRequestStatus',
        host: 'flight',
        path: '/GetChangeRequestStatus',
        body: body as unknown as Record<string, unknown>,
        ctx: { correlationKey: `flight-cancel-poll:${changeRequestId}` },
      });
      const inner = res.Response ?? res;
      const status = mapChangeRequestStatusEnum(inner.ChangeRequestStatus);

      // TBO returns rupees (decimal, sometimes string). Convert to paise so
      // the worker can compare directly against our paise-only Booking.pricing
      // numbers without a second coercion.
      const refundAmountPaise = decimalRupeesToPaise(inner.RefundAmount);
      const cancellationChargePaise = decimalRupeesToPaise(inner.CancellationCharge);

      logger.debug(
        { changeRequestId, status, refundAmountPaise, cancellationChargePaise },
        'tbo-flight: cancel-status poll done',
      );
      return {
        status,
        refundAmountPaise,
        cancellationChargePaise,
        remarks: inner.Remarks,
        raw: res,
      };
    });
  }
}

// ────────── Module-private helpers ──────────

/** Type-only alias for the cached LCC passenger blob to avoid leaking
 *  TboBookPassenger into the JSON.parse path. */
type TboBookRequestPassenger = import('./types.js').TboBookPassenger;

/** Pull the inner Result block out of either envelope variant. */
function extractTicketResult(res: TboAirTicketResponse): TboAirTicketResult {
  const inner = (res.Response_ ?? res).Response;
  if (!inner) {
    throw new SupplierAdapterError(
      'UPSTREAM',
      'TBO Air/Ticket returned no Response block',
      'TBO',
    );
  }
  if (!inner.PNR && !inner.BookingId && !inner.TicketNumber && !inner.Ticket?.length) {
    // No identifying field at all — treat as failure even when ResponseStatus
    // looks ok; better to surface than to record a phantom "success".
    throw new SupplierAdapterError(
      'UPSTREAM',
      `TBO Air/Ticket returned no PNR or ticket numbers (${inner.ResponseStatus ?? 'no-status'})`,
      'TBO',
    );
  }
  return inner;
}

function formatTicketResponse(result: TboAirTicketResult): NormalizedTicketResponse {
  const ticketNumbers = (result.Ticket ?? [])
    .map((t) => (t.TicketNumber ?? '').trim())
    .filter((n) => n.length > 0);
  if (result.TicketNumber && ticketNumbers.length === 0) {
    ticketNumbers.push(result.TicketNumber);
  }
  return {
    pnr: result.PNR ?? '',
    airlinePnr: result.AirlinePNR ?? undefined,
    ticketNumbers: ticketNumbers.length > 0 ? ticketNumbers : undefined,
  };
}

