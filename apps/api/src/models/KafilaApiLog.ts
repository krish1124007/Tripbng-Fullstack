// Persisted audit trail for every Kafila V2 API call.
//
// Mirrors TboAuditLog but for Kafila. We log every wire-level call (login,
// LowFareSearch, AirPricing, GetSSRs, GetSeatMap, HoldPnr, CreatePnr,
// RetrievePnr, retriveBooking) so the vendor support flow can attach
// full request/response payloads keyed on correlationId.
//
// What goes in:
//   - operation (e.g. 'login', 'LowFareSearch', 'CreatePnr')
//   - request URL + request body (PII redacted — DOB / passport / mobile)
//   - response body, response headers, durationMs, httpStatus
//   - kafilaStatus (status field on every Kafila response — 1=success)
//   - errorCode + errorMessage on failure
//   - bookingId / correlationId / recLoc for cross-system lookup
//
// What does NOT go in: API key, API secret, JWT in cleartext. Mask before
// insert (see adapters/kafila/client.ts — redactSecrets()).

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const KafilaApiLogSchema = new Schema(
  {
    operation: { type: String, required: true, index: true },
    url: { type: String, required: true },

    /** Internal Booking._id when the call was made in the context of a
     *  booking flow. Null for login / health-check / search. */
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
    /** TripBng-generated correlation ID per request. Reused as Kafila's
     *  CreatePnr idempotency key (via rmFields BOOKING_REFERENCE_NUMBER). */
    correlationId: { type: String, default: null, index: true },
    /** Kafila's PNR record locator — surface for vendor support tickets. */
    recLoc: { type: String, default: null, index: true },

    request: { type: Schema.Types.Mixed, default: null },
    response: { type: Schema.Types.Mixed, default: null },
    responseHeaders: { type: Schema.Types.Mixed, default: null },
    durationMs: { type: Number, default: null },

    httpStatus: { type: Number, default: null },
    /** Kafila's `status` field in the response body. 1 = success, others = failure. */
    kafilaStatus: { type: Number, default: null },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true },
);

// Recent-calls-by-operation dashboard query.
KafilaApiLogSchema.index({ operation: 1, createdAt: -1 });
// TTL: prune logs older than 90 days. Vendor support windows close well
// inside that; longer retention bloats the collection without benefit.
KafilaApiLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export type KafilaApiLogDoc = HydratedDocument<InferSchemaType<typeof KafilaApiLogSchema>> & {
  _id: Types.ObjectId;
};
export const KafilaApiLog: Model<KafilaApiLogDoc> =
  (mongoose.models.KafilaApiLog as Model<KafilaApiLogDoc> | undefined) ??
  model<KafilaApiLogDoc>('KafilaApiLog', KafilaApiLogSchema);
