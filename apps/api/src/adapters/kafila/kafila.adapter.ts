// KafilaAdapter — implements the SupplierAdapter contract.
//
// Phase 1 (✓): healthCheck + skeleton
// Phase 2 (✓): search (LowFareSearch) + airPricing (FCheck)
// Phase 3 (✓): GetSSRs + GetSeatMap — SSR catalog + seat layout
// Phase 4 (✓): hold (CreatePnr issueTicket=true) + ticket + retrieveBooking
// Phase 5 (✗): cancel + ticket-poll worker + payment-gateway wiring
//
// Search → Pricing → SSR/SeatMap handoff:
//   - search() persists the full Kafila response.data into
//     KafilaSearchSession (keyed on req.searchId), returns
//     NormalizedFareOption[] with `supplierFareToken =
//     kfl:${searchId}:${journeyKey}:${uId}`.
//   - airPricing(token) / getSSRs(token) / getSeatMap(token) share the
//     same request shape (Kafila routes on path, not body). All three go
//     through loadSessionAndBuildRequest() which looks up the session by
//     searchId, locates the chosen journey/itinerary, and builds the
//     AirPricing-shape body. Each response is persisted under its own
//     uId-keyed map (pricingByUId, ssrByUId, seatMapByUId) so Phase 4's
//     CreatePnr can replay the opaque keys without re-fetching.

import { randomUUID } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { KafilaSearchSession, type KafilaSearchSessionDoc } from '../../models/KafilaSearchSession.js';
import { KafilaClient, type KafilaClientConfig } from './client.js';
import {
  fromKafilaBookingResponseToHold,
  fromKafilaBookingResponseToTicket,
  fromKafilaItinerary,
  parseSupplierFareToken,
  toKafilaCreatePnrRequest,
  toKafilaPricingRequest,
  toKafilaSearchRequest,
  type BillingAddress,
  type ParsedKafilaToken,
} from './mappers.js';
import type {
  KflJourneyT,
  KflPricingRequestT,
  KflPricingResponseT,
  KflSSRResponseT,
  KflSeatMapResponseT,
} from './types.js';
import { SupplierAdapterError } from '../types.js';
import type {
  Capability,
  HealthStatus,
  NormalizedBookingDetails,
  NormalizedCancelRequest,
  NormalizedCancelResponse,
  NormalizedFareOption,
  NormalizedHoldRequest,
  NormalizedHoldResponse,
  NormalizedSearchRequest,
  NormalizedSearchResponse,
  NormalizedTicketRequest,
  NormalizedTicketResponse,
  SupplierAdapter,
} from '../types.js';

const NOT_IMPLEMENTED_MSG = 'Kafila adapter — method not implemented in this phase';

interface SessionRequestContext {
  session: KafilaSearchSessionDoc;
  requestBody: KflPricingRequestT;
  parsed: ParsedKafilaToken;
}

export class KafilaAdapter implements SupplierAdapter {
  readonly code = 'KAFILA';
  readonly name = 'Kafila V2';
  /** SEARCH (Phase 2), HOLD/BOOK/RETRIEVE (Phase 4). CANCEL lands in
   *  Phase 5. The registry's fan-out gate reads this list — adding
   *  'SEARCH' is what flips Kafila on for live search traffic. */
  readonly capabilities: readonly Capability[] = ['SEARCH', 'HOLD', 'BOOK', 'RETRIEVE'];

  /** Optional billing-address provider — wired by the booking service
   *  when it has agency address details. Used by hold() to populate
   *  KflContactDetails.address1/city/state/postalCode. */
  private billingAddressProvider: (() => BillingAddress | undefined) | null = null;

  /** Set a billing-address provider — called by the booking service
   *  before invoking hold() when it has agency-level address details
   *  to forward to Kafila. Without this, the adapter falls back to
   *  placeholder values (acceptable for DOM, rejected for some INT). */
  setBillingAddressProvider(fn: () => BillingAddress | undefined): void {
    this.billingAddressProvider = fn;
  }

  /** Inspect a cached CreatePnr / retriveBooking response to decide
   *  whether the booking needs the ticket-poll worker. Returns true
   *  when ticket numbers are missing AND status isn't a terminal
   *  failure — caller (the booking service) enqueues a poll job in
   *  that case via `enqueueKafilaTicketPoll(...)`. */
  static isBookingPending(res: unknown): boolean {
    const data =
      (res as { data?: { BookingInfo?: { CurrentStatus?: string }; PaxInfo?: { Passengers?: Array<{ Optional?: { ticketDetails?: Array<{ ticketNumber?: string }> } }> } } } | undefined)
        ?.data;
    const status = data?.BookingInfo?.CurrentStatus ?? '';
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'ERROR') return false;
    for (const p of data?.PaxInfo?.Passengers ?? []) {
      for (const t of p.Optional?.ticketDetails ?? []) {
        if (t.ticketNumber) return false;
      }
    }
    // No tickets, not failed — must be pending.
    return true;
  }

  readonly client: KafilaClient;
  private readonly cfg: KafilaClientConfig;

  constructor(config: KafilaClientConfig) {
    this.cfg = config;
    this.client = new KafilaClient(config);
  }

  // ────────── Phase 1: health ──────────

  async healthCheck(): Promise<HealthStatus> {
    const startedAt = Date.now();
    try {
      await this.client.login();
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ────────── Phase 2: search ──────────

  async search(req: NormalizedSearchRequest): Promise<NormalizedSearchResponse> {
    const correlationId = randomUUID();
    const body = toKafilaSearchRequest(req.request, {
      credentialType: this.cfg.credentialType,
      salesChannel: this.cfg.salesChannel,
    });

    const res = await this.client.lowFareSearch(body, { correlationId });
    if (!res.data) {
      return { options: [] };
    }
    const { traceId, journey } = res.data;

    // Persist the full search context for AirPricing / SSR / SeatMap /
    // CreatePnr. Upsert so a re-search with the same searchId overwrites
    // cleanly — and clears any prior pricing/SSR/seat-map state since
    // re-search invalidates everything downstream.
    await KafilaSearchSession.findOneAndUpdate(
      { searchId: req.searchId },
      {
        $set: {
          searchId: req.searchId,
          correlationId,
          traceId,
          request: req.request,
          searchResponseData: res.data,
          pricingByUId: {},
          ssrByUId: {},
          seatMapByUId: {},
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      },
      { upsert: true, new: true },
    ).catch((err) => {
      // Persistence failure shouldn't fail the search — we just lose
      // the ability to do AirPricing later for this session. Log loud.
      logger.error(
        { supplier: 'KAFILA', searchId: req.searchId, err },
        'kafila: failed to persist search session',
      );
    });

    const options: NormalizedFareOption[] = [];
    for (const j of journey) {
      for (const itin of j.itinerary) {
        options.push(fromKafilaItinerary(itin, { searchId: req.searchId, journey: j }));
      }
    }
    return { options };
  }

  // ────────── Phase 2: pricing (FCheck) ──────────

  /** Re-validate fare against live inventory before HoldPnr / CreatePnr.
   *
   *  Side effects: persists the pricing response.data under
   *  `pricingByUId[journeyKey:uId]` on the session, so Phase 4's
   *  CreatePnr can grab the unmodified itinerary. Returns the parsed
   *  response so the caller can react to `isPriceChanged`. */
  async airPricing(supplierFareToken: string): Promise<KflPricingResponseT> {
    const { session, requestBody, parsed } = await this.loadSessionAndBuildRequest(
      supplierFareToken,
      'airPricing',
    );
    const res = await this.client.airPricing(requestBody, {
      correlationId: session.correlationId,
    });
    await this.persistByUId(session, 'pricingByUId', parsed, res.data, 'pricing response');
    return res;
  }

  // ────────── Phase 3: SSR + seat map ──────────

  /** Fetch the SSR catalog (meals + baggage + fast-forward) for the
   *  selected fare. Persists the response under
   *  `ssrByUId[journeyKey:uId]` on the session so Phase 4's CreatePnr
   *  can replay the user's chosen opaque keys without re-fetching.
   *
   *  Returns the full Kafila response so the UI can render its native
   *  shape — meals are per-segment, baggage + fast-forward are per-OD.
   *  Empty arrays are normal (not every airline / route surfaces SSRs). */
  async getSSRs(supplierFareToken: string): Promise<KflSSRResponseT> {
    const { session, requestBody, parsed } = await this.loadSessionAndBuildRequest(
      supplierFareToken,
      'getSSRs',
    );
    const res = await this.client.getSSRs(requestBody, {
      correlationId: session.correlationId,
    });
    await this.persistByUId(session, 'ssrByUId', parsed, res.data, 'SSR response');
    return res;
  }

  /** Fetch the seat map for the selected fare. Same persistence /
   *  lookup pattern as getSSRs — stored under
   *  `seatMapByUId[journeyKey:uId]`. For round-trip, the caller must
   *  invoke once per journeyKey (each leg has its own seat map). */
  async getSeatMap(supplierFareToken: string): Promise<KflSeatMapResponseT> {
    const { session, requestBody, parsed } = await this.loadSessionAndBuildRequest(
      supplierFareToken,
      'getSeatMap',
    );
    const res = await this.client.getSeatMap(requestBody, {
      correlationId: session.correlationId,
    });
    await this.persistByUId(session, 'seatMapByUId', parsed, res.data, 'seat-map response');
    return res;
  }

  // ────────── Phase 4: hold (CreatePnr issueTicket=true) ──────────

  /** Book + ticket atomically via CreatePnr. The Kafila convention is
   *  "issue ticket at hold time" — for the B2B-corporate flow that
   *  defers ticketing (issueTicket=false), use HoldPnr separately once
   *  Phase 4.5 lands. LCC fares are forced through this path because
   *  vendor doesn't support the deferred-ticket flow for them.
   *
   *  Persists the full booking response onto the session under
   *  `bookingByRef[BookingId]` so ticket() / retrieveBooking() can
   *  surface ticket numbers without a second wire call. */
  async hold(req: NormalizedHoldRequest): Promise<NormalizedHoldResponse> {
    const { session, parsed, ctx } = await this.loadBookingContext(req.supplierFareToken, 'hold');

    const { body } = toKafilaCreatePnrRequest({
      parsed,
      session: {
        correlationId: session.correlationId,
        request: session.request,
        searchResponseData: session.searchResponseData,
        pricingByUId: session.pricingByUId,
        ssrByUId: session.ssrByUId,
        seatMapByUId: session.seatMapByUId,
      },
      hold: req,
      ctx,
      issueTicket: true,
      billingAddress: this.billingAddressProvider?.(),
    });

    const res = await this.client.createPnr(body, { correlationId: session.correlationId });
    const normalized = fromKafilaBookingResponseToHold(res);

    // Persist the full response under the BookingId so ticket() /
    // retrieveBooking() can re-derive ticket numbers without an extra
    // retriveBooking call.
    const map = ((session.bookingByRef as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      unknown
    >;
    map[normalized.supplierBookingRef] = res;
    session.set('bookingByRef', map);
    session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      await session.save();
    } catch (err) {
      logger.error(
        { supplier: 'KAFILA', searchId: parsed.searchId, err },
        'kafila: failed to persist booking response',
      );
    }

    return normalized;
  }

  // ────────── Phase 4: ticket (CreatePnr already issued; surface numbers) ──────────

  /** Surface ticket numbers for an existing booking. Since CreatePnr
   *  issues tickets atomically (Phase 4 convention), the cached
   *  response usually has everything we need — we only call
   *  retriveBooking when the cache is empty (cold-start, separate
   *  process, etc.). */
  async ticket(req: NormalizedTicketRequest): Promise<NormalizedTicketResponse> {
    // Try the session cache first — every adapter.hold() persists here.
    // We don't know which session to look in, so we query by
    // bookingByRef key. Mongoose can't index inside a Mixed map; this
    // is a full-collection scan in the worst case. Acceptable because:
    //   - sessions auto-expire after 24h (TTL index)
    //   - one ticket() call per booking, not per request
    const cached = await KafilaSearchSession.findOne({
      [`bookingByRef.${req.supplierBookingRef}`]: { $exists: true },
    }).lean();
    if (cached) {
      const map = cached.bookingByRef as Record<string, unknown> | undefined;
      const res = map?.[req.supplierBookingRef] as
        | Awaited<ReturnType<KafilaClient['createPnr']>>
        | undefined;
      if (res) return fromKafilaBookingResponseToTicket(res);
    }

    // Cache miss — fall back to retriveBooking.
    const res = await this.client.retriveBooking(
      { bookingId: req.supplierBookingRef },
      { correlationId: cached?.correlationId ?? randomUUID() },
    );
    return fromKafilaBookingResponseToTicket(res);
  }

  // ────────── Phase 4: retrieveBooking (basic details only) ──────────

  /** Lightweight booking-detail lookup. Returns the supplier ref + PNR
   *  + current status — booking service uses this to populate Phase 5
   *  status dashboards without parsing the full Kafila envelope. */
  async retrieveBooking(supplierBookingRef: string): Promise<NormalizedBookingDetails> {
    const res = await this.client.retriveBooking({ bookingId: supplierBookingRef });
    const info = res.data?.BookingInfo;
    return {
      supplierBookingRef,
      pnr: info?.GPnr || info?.PNR || info?.APnr || undefined,
      status: info?.CurrentStatus ?? 'UNKNOWN',
    };
  }

  // ────────── Phase 5: cancel (TODO) ──────────

  async cancel(_req: NormalizedCancelRequest): Promise<NormalizedCancelResponse> {
    throw new SupplierAdapterError('BAD_REQUEST', NOT_IMPLEMENTED_MSG, this.code);
  }

  // ────────── Helpers ──────────

  /** Same session lookup as loadSessionAndBuildRequest but returns the
   *  *context*, not a fully-built body. Phase 4's hold() uses this so
   *  it can build the CreatePnr request (which is shaped differently
   *  from AirPricing — has issueTicket + travellerDetails). */
  private async loadBookingContext(
    supplierFareToken: string,
    operation: string,
  ): Promise<{
    session: KafilaSearchSessionDoc;
    parsed: ParsedKafilaToken;
    ctx: {
      credentialType: 'TEST' | 'LIVE';
      salesChannel: 'API' | 'B2B' | 'B2C';
      typeOfTrip: 'ONEWAY' | 'ROUNDTRIP' | 'MULTICITY';
      travelType: 'DOM' | 'INT';
      companyId?: string;
    };
  }> {
    const parsed = parseSupplierFareToken(supplierFareToken);
    if (!parsed) {
      throw new SupplierAdapterError(
        'BAD_REQUEST',
        `Kafila ${operation}: invalid supplierFareToken (expected kfl:...)`,
        this.code,
      );
    }
    const session = await KafilaSearchSession.findOne({ searchId: parsed.searchId });
    if (!session) {
      throw new SupplierAdapterError(
        'NOT_FOUND',
        `Kafila ${operation}: search session ${parsed.searchId} not found`,
        this.code,
      );
    }
    const searchData = session.searchResponseData as
      | { traceId: string; journey: KflJourneyT[] }
      | undefined;
    if (!searchData?.traceId || !Array.isArray(searchData.journey)) {
      throw new SupplierAdapterError(
        'NOT_FOUND',
        `Kafila ${operation}: session ${parsed.searchId} missing search data`,
        this.code,
      );
    }
    return {
      session,
      parsed,
      ctx: {
        credentialType: this.cfg.credentialType,
        salesChannel: this.cfg.salesChannel,
        typeOfTrip: ((session.request as { tripType?: string } | null)?.tripType ?? 'ONEWAY') as
          | 'ONEWAY'
          | 'ROUNDTRIP'
          | 'MULTICITY',
        travelType: inferTravelTypeFromTraceContext(searchData.journey),
        companyId: this.cfg.companyId,
      },
    };
  }

  /** Shared session-lookup + request builder used by airPricing /
   *  getSSRs / getSeatMap. All three endpoints take the same request
   *  body — only the URL path differs. */
  private async loadSessionAndBuildRequest(
    supplierFareToken: string,
    operation: string,
  ): Promise<SessionRequestContext> {
    const parsed = parseSupplierFareToken(supplierFareToken);
    if (!parsed) {
      throw new SupplierAdapterError(
        'BAD_REQUEST',
        `Kafila ${operation}: invalid supplierFareToken (expected kfl:...)`,
        this.code,
      );
    }
    const session = await KafilaSearchSession.findOne({ searchId: parsed.searchId });
    if (!session) {
      throw new SupplierAdapterError(
        'NOT_FOUND',
        `Kafila ${operation}: search session ${parsed.searchId} not found (expired or never persisted)`,
        this.code,
      );
    }
    const sessionData = session.searchResponseData as
      | { traceId: string; journey: KflJourneyT[] }
      | undefined;
    if (!sessionData?.traceId || !Array.isArray(sessionData.journey)) {
      throw new SupplierAdapterError(
        'NOT_FOUND',
        `Kafila ${operation}: session ${parsed.searchId} missing search data — re-run search`,
        this.code,
      );
    }
    const requestBody = toKafilaPricingRequest({
      traceId: sessionData.traceId,
      journeys: sessionData.journey,
      selectedUId: parsed.uId,
      selectedJourneyKey: parsed.journeyKey,
      ctx: {
        credentialType: this.cfg.credentialType,
        salesChannel: this.cfg.salesChannel,
        typeOfTrip: ((session.request as { tripType?: string } | null)?.tripType ?? 'ONEWAY') as
          | 'ONEWAY'
          | 'ROUNDTRIP'
          | 'MULTICITY',
        travelType: inferTravelTypeFromTraceContext(sessionData.journey),
        companyId: this.cfg.companyId,
      },
    });
    return { session, requestBody, parsed };
  }

  /** Merge one entry into the session's `${field}ByUId` map and save.
   *  Failures log loud but don't throw — losing one cache row is better
   *  than failing a live API call. */
  private async persistByUId(
    session: KafilaSearchSessionDoc,
    field: 'pricingByUId' | 'ssrByUId' | 'seatMapByUId',
    parsed: ParsedKafilaToken,
    data: unknown,
    label: string,
  ): Promise<void> {
    const existing = ((session[field] as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      unknown
    >;
    existing[`${parsed.journeyKey}:${parsed.uId}`] = data;
    session.set(field, existing);
    session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      await session.save();
    } catch (err) {
      logger.error(
        { supplier: 'KAFILA', searchId: parsed.searchId, field, err },
        `kafila: failed to persist ${label}`,
      );
    }
  }
}

/** Inspect the session's journey list to guess DOM vs INT — every
 *  segment has a `countryCode` on its departure/arrival airport. If any
 *  non-IN airport appears we call it INT. This is more reliable than
 *  inferring from the original SearchRequest (we don't fully trust the
 *  in-memory IATA whitelist used at search time). */
function inferTravelTypeFromTraceContext(journeys: KflJourneyT[]): 'DOM' | 'INT' {
  for (const j of journeys) {
    for (const itin of j.itinerary) {
      for (const seg of itin.airSegments) {
        const depCC = seg.departure.countryCode?.toUpperCase();
        const arrCC = seg.arrival.countryCode?.toUpperCase();
        if (depCC && depCC !== 'IN') return 'INT';
        if (arrCC && arrCC !== 'IN') return 'INT';
      }
    }
  }
  return 'DOM';
}
