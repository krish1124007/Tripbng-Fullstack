// Employee — the actual TRAVELER on a corporate booking.
//
// TripBNG already has User (platform login: agent / admin / finance / manager)
// and Agency / Distributor (the buying entity). Employee fills the gap that
// the bus spec (CLAUDE.md §5.4) needs: a person who has names + DoB + ID
// numbers + manager + travel policy, but doesn't necessarily log in.
//
// Scope notes:
//   - Lives under the same tenantId as the platform User who creates them.
//   - agencyId is required — every employee belongs to a buying agency.
//   - dob + idNumber are PII. We store them but encrypt at rest in Phase 1
//     hardening (matches the existing PII plugin pattern under models/plugins).
//   - managerId references a platform User (the person who approves bus
//     bookings on this employee's behalf). Soft-required: HR may not have
//     manager mapping for every employee on day 1.
//   - travelPolicyId: deferred to Phase 5; left as optional ObjectId for now
//     so the booking-time policy resolution can find it once the
//     TravelPolicy model lands.
//
// PII handling: we mark sensitive fields with `select: false` to keep them
// out of default queries. Field-level encryption joins in Phase 1 hardening
// alongside the existing `models/plugins/encrypt.ts` work.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const EmployeeSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', required: true, index: true },

    /** Per-tenant unique employee code — usually the HR system's empId. */
    empCode: { type: String, required: true, trim: true },

    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    /** E.164 with country code, e.g. "+919876543210". */
    mobile: { type: String, required: true, trim: true, index: true },

    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'], required: true },
    /** Stored as Date in UTC; the booking flow converts to age via the
     *  IST timezone of the journey. */
    dob: { type: Date, default: null, select: false },

    /** Manager who approves bookings for this employee. Optional —
     *  unmanaged employees route to tenant_admin queue. */
    managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    /** Default travel policy. Bus bookings fall back to tenant default
     *  when null. Resolved by services/policy.service at booking time. */
    travelPolicyId: { type: Schema.Types.ObjectId, ref: 'TravelPolicy', default: null },

    /** Default ID for SeatSeller block requests. Some operators require
     *  ID; storing the default keeps the booking form one click. */
    defaultIdType: {
      type: String,
      enum: [
        'AADHAR',
        'PAN_CARD',
        'PASSPORT',
        'DRIVING_LICENCE',
        'VOTER_CARD',
        'RATION_CARD',
        'NONE',
      ],
      default: 'NONE',
    },
    defaultIdNumber: { type: String, default: null, select: false },

    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
  },
  { timestamps: true },
);

// Per-tenant unique empCode + per-tenant unique email. Both queryable
// without leaking across tenants (tenantId always leads).
EmployeeSchema.index({ tenantId: 1, empCode: 1 }, { unique: true });
EmployeeSchema.index({ tenantId: 1, email: 1 });
EmployeeSchema.index({ tenantId: 1, agencyId: 1, status: 1 });

export type EmployeeDoc = HydratedDocument<InferSchemaType<typeof EmployeeSchema>> & {
  _id: Types.ObjectId;
};
export type EmployeeModel = Model<InferSchemaType<typeof EmployeeSchema>>;
// Guard against double-registration. Vitest's module-isolation per
// test file can re-evaluate this file in the same Node process when
// another test uses vi.mock; without the guard, Mongoose throws
// OverwriteModelError on the second pass.
export const Employee: EmployeeModel =
  (mongoose.models.Employee as EmployeeModel | undefined) ??
  model<InferSchemaType<typeof EmployeeSchema>>('Employee', EmployeeSchema);
