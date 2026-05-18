// TravelPolicy — corporate travel rules.
//
// Distinct from the existing `Policy` model (which captures commission /
// markup math). TravelPolicy lives one rung higher: it's the gate the
// employee/manager workflow checks before a booking can proceed.
//
// Schema is structured around `rules.<inventoryType>` so flights and
// hotels can plug in their rule blocks without re-shaping the document.
// Phase 5 wires up `rules.bus`; flights/hotels are placeholders we'll
// fill in their respective phases.
//
// Money convention — integer paise. The spec writes "maxFareINR" / etc;
// we name everything `*Paise` to match the rest of the codebase. The UI
// converts to/from rupees at the form boundary.
//
// Per-employee resolution priority (services/approval/*.ts will use):
//   1. Employee.travelPolicyId (explicit override)
//   2. Tenant.settings.defaultTravelPolicyId (fallback) — added in this phase
//   3. None → permissive (no checks fire)

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const BusRulesSubSchema = new Schema(
  {
    /** Cap on per-pax fare. Trips above this are filtered from the
     *  employee's search results AND blocked from approval submission. */
    maxFarePaise: { type: Number, default: null, min: 0 },

    /** Restrict to AC trips. */
    acOnly: { type: Boolean, default: false },
    /** Whether sleeper buses are allowed. */
    sleeperAllowed: { type: Boolean, default: true },

    /** Earliest travel can start: now + minAdvanceHours. Stops same-day
     *  emergency bookings unless tenant explicitly allows them. */
    minAdvanceHours: { type: Number, default: 0, min: 0, max: 720 },
    /** Furthest travel can be booked: now + maxAdvanceDays. */
    maxAdvanceDays: { type: Number, default: 90, min: 1, max: 365 },

    /** Whitelist of bus type IDs (SeatSeller numeric). null = all allowed. */
    allowedBusTypeIds: { type: [Number], default: null },
    /** Blacklist of operator IDs (SeatSeller numeric). null = no blocks. */
    blockedOperatorIds: { type: [Number], default: null },

    /** Auto-route to manager approval when fare exceeds this threshold,
     *  even if all other rules pass. null = no approval required by fare. */
    requireApprovalAbovePaise: { type: Number, default: null, min: 0 },
  },
  { _id: false },
);

const TravelPolicySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },

    /** When set, fares at or below this auto-approve at submit time —
     *  i.e. the ApprovalRequest is created with status='approved'
     *  immediately. null = every request requires manager action. */
    autoApproveBelowPaise: { type: Number, default: null, min: 0 },

    /** Default expiry for ApprovalRequests under this policy. Tenant-level
     *  override on Tenant.settings would shadow this when missing. Spec
     *  default is 24h. */
    approvalExpiryHours: { type: Number, default: 24, min: 1, max: 168 },

    rules: {
      bus: { type: BusRulesSubSchema, default: () => ({}) },
      // flight + hotel rule blocks land in their own phases; we leave
      // the parent `rules` open so Mongoose doesn't reject extra keys.
    },

    /** Soft-delete style flag. Service layer filters non-active out of
     *  resolution; admins can still see them in the policy admin UI. */
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Per-tenant unique policy name — managers reference policies by name in
// the admin UI, ambiguity wastes their time.
TravelPolicySchema.index({ tenantId: 1, name: 1 }, { unique: true });

export type TravelPolicyDoc = HydratedDocument<InferSchemaType<typeof TravelPolicySchema>> & {
  _id: Types.ObjectId;
};
export type TravelPolicyModel = Model<InferSchemaType<typeof TravelPolicySchema>>;
// Guard against double-registration. See Employee.ts for the rationale.
export const TravelPolicy: TravelPolicyModel =
  (mongoose.models.TravelPolicy as TravelPolicyModel | undefined) ??
  model<InferSchemaType<typeof TravelPolicySchema>>('TravelPolicy', TravelPolicySchema);
