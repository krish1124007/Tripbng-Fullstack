// Persisted audit trail for every TBO API call.
//
// TBO's certification team requires that, when raising a support ticket, we
// can attach the full request/response (as JSON) along with TraceId +
// SessionId. The wire log is too noisy to grep — we persist a normalized
// record per call, keyed on TraceId + bookingCode for fast lookup.
//
// What goes in:
//   - method (Authenticate, Search, PreBook, Book, ...)
//   - host (shared/hotel/hotelBe)
//   - request body (with Password masked — see services/tbo/audit.ts)
//   - response body
//   - response headers (SessionId lives there for Search/PreBook)
//   - durationMs, httpStatus
//   - errorCode + errorMessage when the call failed
//
// What does NOT go in: PII (PAN, passport). Mask before insert. The audit
// log itself is admin-only, but defence in depth: never persist what you
// don't have to.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const TboAuditLogSchema = new Schema(
  {
    method: { type: String, required: true, index: true },
    host: { type: String, required: true },
    url: { type: String, required: true },

    /** Internal Booking._id when the call was made in the context of a
     *  booking flow. Null for calls that don't have a booking yet
     *  (Authenticate, Logout, reference-data sync). */
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
    /** TBO's BookingCode — the identifier glueing Search → PreBook → Book
     *  together. Indexed for support-ticket lookup. */
    bookingCode: { type: String, default: null, index: true },
    /** TBO's TraceId (returned in most responses). Surface on the support
     *  ticket. */
    traceId: { type: String, default: null, index: true },
    /** TBO's SessionId (lives in response headers for Search/PreBook). */
    sessionId: { type: String, default: null },

    request: { type: Schema.Types.Mixed, default: null },
    response: { type: Schema.Types.Mixed, default: null },
    responseHeaders: { type: Schema.Types.Mixed, default: null },
    durationMs: { type: Number, default: null },

    httpStatus: { type: Number, default: null },
    /** TBO's ResponseStatus / Status field (1=ok, 2=fail, 3/4/5 = error).
     *  Null for transport-layer failures that never produced a body. */
    tboStatus: { type: Number, default: null },
    /** TBO's Error.ErrorCode if populated. */
    errorCode: { type: Number, default: null },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true },
);

// Recent-calls-by-method dashboard query.
TboAuditLogSchema.index({ method: 1, createdAt: -1 });

export type TboAuditLogDoc = HydratedDocument<InferSchemaType<typeof TboAuditLogSchema>> & {
  _id: Types.ObjectId;
};
export const TboAuditLog: Model<TboAuditLogDoc> =
  (mongoose.models.TboAuditLog as Model<TboAuditLogDoc> | undefined) ??
  model<TboAuditLogDoc>('TboAuditLog', TboAuditLogSchema);
