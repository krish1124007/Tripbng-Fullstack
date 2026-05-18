// ApprovalRequest — manager-gated approval for travel bookings.
//
// Designed generic from day 1: `type: 'bus' | 'flight' | 'hotel'` and the
// `payload` is per-type (Phase 5 wires only `'bus'`). Flights and hotels
// reuse the same state machine + expiry rules in their respective phases.
//
// State machine (CLAUDE.md §9):
//
//   draft  ─submit─►  pending  ─approve─►  approved  ─book─►  booked
//                       │                     │
//                       ├─reject──►  rejected
//                       └─expire (auto)──►  expired
//
// `draft` doesn't persist (we never accept partial requests); `submit`
// creates the row directly in `pending` or `approved` (auto). This file
// lists `draft` only for completeness with the spec diagram.
//
// Money convention: integer paise. Spec says Decimal128 — overridden to
// match the rest of TripBNG.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

export const APPROVAL_STATUS = ['pending', 'approved', 'rejected', 'expired', 'booked'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUS)[number];

/** Allowed transitions. `state.service.ts` cross-checks before writing. */
export const APPROVAL_TRANSITIONS: Readonly<Record<ApprovalStatus, readonly ApprovalStatus[]>> = {
  pending: ['approved', 'rejected', 'expired'],
  approved: ['booked'],
  rejected: [],
  expired: [],
  booked: [],
} as const;

export function isValidApprovalTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to);
}

// ────────── Bus payload sub-schema ──────────
// Flight + hotel sub-schemas land in their phases. We keep `payload`
// loosely typed at the Mongoose level (Mixed) and discriminate at the
// service-layer Zod schemas.

const BusApprovalPayloadSubSchema = new Schema(
  {
    /** SeatSeller numeric IDs. */
    sourceCityId: { type: Number, required: true },
    destinationCityId: { type: Number, required: true },
    /** "yyyy-MM-dd" IST. */
    doj: { type: String, required: true },
    tripId: { type: String, required: true },
    inventoryId: { type: String, required: true },

    /** Selected seat names (e.g. "L4", "U2"). Length ≥ 1. */
    seatNumbers: { type: [String], required: true, validate: (v: string[]) => v.length >= 1 },
    boardingPointId: { type: Number, required: true },
    droppingPointId: { type: Number, required: true },

    /** Snapshot of the searched-fare per pax (paise). The booking flow
     *  re-validates against live tripDetails — see Law 2. */
    estimatedFarePaise: { type: Number, required: true, min: 0 },
    /** Total = estimatedFarePaise × seatNumbers.length, snapshotted at
     *  submit time so the manager UI doesn't need to recompute. */
    estimatedTotalPaise: { type: Number, required: true, min: 0 },

    operatorName: { type: String, default: '' },
    busType: { type: String, default: '' },
    /** Class hints — surfaced from search-time decoration. Used by the
     *  booking-flow trip snapshot + invoice GST routing. */
    isAc: { type: Boolean, default: false },
    isSleeper: { type: Boolean, default: false },

    /** ISO timestamps for the manager's review UI. */
    departureAt: { type: String, required: true },
    arrivalAt: { type: String, required: true },
  },
  { _id: false },
);

const ApprovalRequestSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    /** Inventory type — `bus` only in Phase 5. */
    type: { type: String, enum: ['bus', 'flight', 'hotel'], required: true, index: true },

    /** The traveller. Employee model lives under apps/api/src/models/Employee.ts. */
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    /** Manager who can approve/reject. Resolution priority:
     *  1. Employee.managerId
     *  2. tenant_admin role users (fallback for unmanaged employees) */
    managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    /** Submitter — usually the employee themselves via the SPA, but
     *  travel-desk admins can submit on someone's behalf. */
    submittedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    /** Type-specific payload. Bus shape only for now. */
    payload: { type: BusApprovalPayloadSubSchema, required: true },

    /** Reference TravelPolicy snapshot — set at submit time so policy
     *  changes after submission don't retroactively change the request. */
    travelPolicyId: { type: Schema.Types.ObjectId, ref: 'TravelPolicy', default: null },

    status: { type: String, enum: APPROVAL_STATUS, required: true, default: 'pending', index: true },

    /** Rule-by-rule violations from policy-eval, snapshotted at submit.
     *  Empty for clean submissions; populated for "out-of-policy but
     *  manager can override" cases. */
    policyViolations: { type: [String], default: [] },

    /** Manager's decision note. Required for rejection (≥10 chars,
     *  enforced at service layer). Optional on approve. */
    approverNote: { type: String, default: null },

    expiresAt: { type: Date, required: true, index: true },
    decidedAt: { type: Date, default: null },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    /** Set when the booking flow consumes an approved request. Phase 6
     *  wires this. */
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
  },
  { timestamps: true },
);

// Manager queue lookup — pending requests, oldest first.
ApprovalRequestSchema.index({ tenantId: 1, managerId: 1, status: 1, createdAt: 1 });
// Employee inbox.
ApprovalRequestSchema.index({ tenantId: 1, employeeId: 1, createdAt: -1 });
// Expiry sweeper — find pending requests past their expiresAt.
ApprovalRequestSchema.index({ status: 1, expiresAt: 1 });

export type ApprovalRequestDoc = HydratedDocument<InferSchemaType<typeof ApprovalRequestSchema>> & {
  _id: Types.ObjectId;
};
export type ApprovalRequestModel = Model<InferSchemaType<typeof ApprovalRequestSchema>>;
// Guard against double-registration. See Employee.ts for the rationale.
export const ApprovalRequest: ApprovalRequestModel =
  (mongoose.models.ApprovalRequest as ApprovalRequestModel | undefined) ??
  model<InferSchemaType<typeof ApprovalRequestSchema>>(
    'ApprovalRequest',
    ApprovalRequestSchema,
  );
