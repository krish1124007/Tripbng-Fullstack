// AirIQAdapter — implements the SupplierAdapter contract for AirIQ AAS v1.0.
//
// Phase 1 status (search-only):
//   ✓ search       — Login + Availability wired live
//   ✗ hold         — needs /Pricing + /Book + idempotency + audit-log story
//   ✗ ticket       — needs /IssueTicket + ResultCode=2 polling
//   ✗ cancel       — endpoint not in v1.0 doc; awaiting spec from gagansareen@airiq.in
//   ✗ retrieveBooking — needs /RetrieveBooking spec confirmation
//
// Token lifecycle: AirIQTokenManager owns it; this class injects on every search
// request and force-refreshes once on the documented "token timed out" reply.

import { BaseAdapter } from '../base.js';
import {
  SupplierAdapterError,
  type Capability,
  type HealthStatus,
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
import { AirIQClient, type AirIQClientConfig } from './client.js';
import { AirIQTokenManager } from './auth.js';
import { buildAirIQAvailabilityRequest, mapItineraryAndFareToOption } from './transforms.js';
import { TOKEN_TIMEOUT_MARKER } from './errors.js';

export class AirIQAdapter extends BaseAdapter {
  readonly code = 'AIRIQ';
  readonly name = 'AirIQ FIT';
  readonly capabilities: readonly Capability[] = ['SEARCH'];

  // AirIQ Pricing/Book are documented as slow; their search is on the same backend
  // and shares the latency profile. 18 s mirrors eTrav — long enough to complete,
  // short enough that fanoutSearch's overall budget isn't blown.
  protected override readonly timeoutMs = 18_000;

  private readonly client: AirIQClient;
  private readonly tokens: AirIQTokenManager;

  constructor(config: AirIQClientConfig) {
    super();
    this.client = new AirIQClient(config);
    this.tokens = new AirIQTokenManager(this.client);
  }

  // ────────── Search (Phase 1) ──────────

  async search(req: NormalizedSearchRequest): Promise<NormalizedSearchResponse> {
    return this.guarded('search', async () => {
      const body = buildAirIQAvailabilityRequest(req, this.client.appType, this.client.apiVersion);

      const callOnce = async (token: string) => this.client.availability({ ...body, Token: token });

      // First attempt with cached token; on documented "token timed out", force
      // refresh and retry exactly once.
      let token = await this.tokens.getToken();
      let res;
      try {
        res = await callOnce(token);
      } catch (err) {
        if (
          err instanceof SupplierAdapterError &&
          err.message.toLowerCase().includes(TOKEN_TIMEOUT_MARKER)
        ) {
          token = await this.tokens.forceRefresh();
          res = await callOnce(token);
        } else {
          throw err;
        }
      }

      // Flatten Itineraries[].Fares[] → one NormalizedFareOption per (itinerary × fare).
      const options: NormalizedFareOption[] = [];
      for (const itin of res.Itineraries ?? []) {
        for (const fare of itin.Fares ?? []) {
          options.push(mapItineraryAndFareToOption(itin, fare, { trackId: res.TrackId }));
        }
      }
      return { options };
    });
  }

  // ────────── Not yet implemented (specs / phase pending) ──────────

  async hold(_req: NormalizedHoldRequest): Promise<NormalizedHoldResponse> {
    throw new SupplierAdapterError(
      'BAD_REQUEST',
      'AirIQ hold (/Pricing + /Book) not yet implemented in this phase',
      this.code,
    );
  }

  async ticket(_req: NormalizedTicketRequest): Promise<NormalizedTicketResponse> {
    throw new SupplierAdapterError(
      'BAD_REQUEST',
      'AirIQ ticketing (/IssueTicket) not yet implemented in this phase',
      this.code,
    );
  }

  async cancel(_req: NormalizedCancelRequest): Promise<NormalizedCancelResponse> {
    throw new SupplierAdapterError(
      'BAD_REQUEST',
      'AirIQ cancellation endpoint not present in v1.0 doc — awaiting confirmation from AirIQ support',
      this.code,
    );
  }

  async retrieveBooking(_ref: string): Promise<NormalizedBookingDetails> {
    throw new SupplierAdapterError(
      'BAD_REQUEST',
      'AirIQ retrieveBooking (/RetrieveBooking) not yet implemented in this phase',
      this.code,
    );
  }

  // ────────── Health ──────────

  async healthCheck(): Promise<HealthStatus> {
    // /Login is the cheapest endpoint that exercises auth end-to-end. We use the
    // token manager so back-to-back probes don't hammer /Login — only a real
    // expiry triggers the network call.
    try {
      await this.tokens.getToken();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      return { ok: false, message };
    }
  }
}
