// KafilaSearchSession — persistence layer for Kafila search + pricing
// state.
//
// Why this exists: Kafila does NOT let you re-fetch a specific itinerary
// by ID. The full search response (with all the opaque keys baked into
// every itinerary / segment / fare line) MUST be passed back unchanged
// to AirPricing, and the AirPricing response itinerary MUST in turn be
// passed back unchanged to CreatePnr. So we persist the whole blob
// keyed on our internal `searchId` + the selected itinerary `uId`.
//
// Lifecycle:
//   1. KafilaAdapter.search() → call LowFareSearch → upsert one row
//      keyed on searchId, with the full response.data persisted.
//   2. KafilaAdapter.airPricing(token) → look up by searchId, send the
//      selected journey[].itinerary[] back to AirPricing, persist the
//      pricing response under `pricingByUId[token]`.
//   3. KafilaAdapter.hold/ticket (Phase 4) → look up by searchId again,
//      pull pricingByUId[token].itinerary, send unchanged to CreatePnr.
//
// TTL: 24h. Kafila's traceId / opaque keys go stale fast (the spec
// doesn't pin a number but vendors typically invalidate ~24h). Pruning
// after a day keeps the collection from ballooning without losing
// anything useful.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const KafilaSearchSessionSchema = new Schema(
  {
    /** Our internal searchId — passed in NormalizedSearchRequest.searchId.
     *  Unique enough that one search produces one row; AirPricing /
     *  CreatePnr re-use the same searchId via the supplierFareToken. */
    searchId: { type: String, required: true, unique: true, index: true },

    /** Kafila's own correlationId — included on every wire call so
     *  vendor support can correlate. Same value reused for AirPricing +
     *  CreatePnr (idempotency key on Kafila's side via rmFields). */
    correlationId: { type: String, required: true, index: true },

    /** Kafila's traceId — returned by LowFareSearch in `data.traceId`,
     *  must be re-sent in AirPricing / GetSSRs / GetSeatMap. */
    traceId: { type: String, required: true, index: true },

    /** Original NormalizedSearchRequest.request (the SearchRequest shape
     *  from @tripbng/shared). Persisted for debugging + Phase 2.5
     *  roundtrip re-fetch. */
    request: { type: Schema.Types.Mixed, default: null },

    /** Full Kafila LowFareSearch response.data — pass back unchanged. */
    searchResponseData: { type: Schema.Types.Mixed, required: true },

    /** Map of itinerary uId → full pricing response.data for that
     *  itinerary. Lets a single search session price multiple options
     *  (e.g. user toggles between fares) without re-calling AirPricing.
     *  Key format: `${journeyKey}:${uId}` to avoid collisions when the
     *  same uId appears across journeys (shouldn't happen, but safe). */
    pricingByUId: { type: Schema.Types.Mixed, default: {} },

    /** Map of `${journeyKey}:${uId}` → SSR response.data. Populated by
     *  KafilaAdapter.getSSRs(); replayed in Phase 4 CreatePnr to look up
     *  the opaque `key` for each user-chosen meal / baggage / fast-fwd. */
    ssrByUId: { type: Schema.Types.Mixed, default: {} },

    /** Map of `${journeyKey}:${uId}` → seat-map response.data. Populated
     *  by KafilaAdapter.getSeatMap(); replayed in CreatePnr for the
     *  opaque `key` on each user-chosen seat. */
    seatMapByUId: { type: Schema.Types.Mixed, default: {} },

    /** Map of Kafila BookingId → full CreatePnr / retriveBooking
     *  response. Populated by KafilaAdapter.hold(); ticket() reads it
     *  back to extract ticket numbers without a re-fetch. Key is the
     *  BookingId surfaced as supplierBookingRef. */
    bookingByRef: { type: Schema.Types.Mixed, default: {} },

    /** When the session was last touched — refreshed on every pricing
     *  / book call. Used in conjunction with the TTL index below. */
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

export type KafilaSearchSessionDoc = HydratedDocument<
  InferSchemaType<typeof KafilaSearchSessionSchema>
> & { _id: Types.ObjectId };

export const KafilaSearchSession: Model<KafilaSearchSessionDoc> =
  (mongoose.models.KafilaSearchSession as Model<KafilaSearchSessionDoc> | undefined) ??
  model<KafilaSearchSessionDoc>('KafilaSearchSession', KafilaSearchSessionSchema);
