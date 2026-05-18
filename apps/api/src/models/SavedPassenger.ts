// SavedPassenger — per-agency passenger directory.
//
// Agents save customers they book regularly so the booking form's
// "Search saved passengers" can auto-fill title / name / DOB / passport
// with one click. The directory is scoped to the AGENCY (not the
// individual user) — every team member sees the same address book.
//
// Audit trail: `createdBy` records the user who first added the entry.
// We don't track edits beyond the timestamps — it's a low-stakes
// directory; if data drifts the agent just re-saves the latest version.
//
// Uniqueness: `(agencyId, firstName, lastName, dateOfBirth)` is the
// natural key. Same name + DOB = same person; duplicating the row
// would split history and confuse search. Note: dateOfBirth is
// optional, so the unique index uses a sparse partial filter — when
// DOB is missing we allow duplicates (the agent might be saving
// children whose DOBs they don't have yet).

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const PassportSchema = new Schema(
  {
    number: { type: String, required: true, trim: true },
    expiry: { type: String, required: true }, // ISO date string
    issuingCountry: { type: String, required: true, length: 2, uppercase: true },
  },
  { _id: false },
);

const SavedPassengerSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', required: true, index: true },
    /** User who first saved this entry (audit). */
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    type: { type: String, enum: ['ADULT', 'CHILD', 'INFANT'], required: true },
    title: { type: String, enum: ['MR', 'MRS', 'MS', 'MSTR', 'MISS'], required: true },

    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },

    /** YYYY-MM-DD string. Optional — children may not have DOB recorded. */
    dateOfBirth: { type: String, default: null },
    gender: { type: String, enum: ['M', 'F', null], default: null },

    /** ISO-3166 alpha-2. Optional. */
    nationality: { type: String, length: 2, uppercase: true, default: null },

    passport: { type: PassportSchema, default: null },

    /** Contact fields — useful for the booking-contact section autofill. */
    email: { type: String, lowercase: true, trim: true, default: null },
    phone: { type: String, trim: true, default: null },
  },
  { timestamps: true },
);

// Search-friendly compound index — most queries filter agencyId and
// fuzzy-match on firstName / lastName.
SavedPassengerSchema.index({ agencyId: 1, firstName: 1, lastName: 1 });

// Per-agency uniqueness on (firstName, lastName, dateOfBirth). Sparse
// when DOB is null so we don't accidentally block all-DOB-less rows.
SavedPassengerSchema.index(
  { agencyId: 1, firstName: 1, lastName: 1, dateOfBirth: 1 },
  {
    unique: true,
    partialFilterExpression: { dateOfBirth: { $type: 'string' } },
  },
);

export type SavedPassengerDoc = HydratedDocument<InferSchemaType<typeof SavedPassengerSchema>> & {
  _id: Types.ObjectId;
};
export type SavedPassengerModel = Model<InferSchemaType<typeof SavedPassengerSchema>>;
// Guard against double-registration (vitest module-isolation under vi.mock).
export const SavedPassenger: SavedPassengerModel =
  (mongoose.models.SavedPassenger as SavedPassengerModel | undefined) ??
  model<InferSchemaType<typeof SavedPassengerSchema>>('SavedPassenger', SavedPassengerSchema);
