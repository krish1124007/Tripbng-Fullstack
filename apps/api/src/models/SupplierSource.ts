// SupplierSource — the "Map Source" model from the admin panel spec
// (Manage Supplier → Map Source). Pre-existing minimal shape extended in
// place to carry the full whitelist + transformation + restriction +
// manual-issuance configuration that drives the search filter and the
// booking flow.
//
// One row = one named "source" for one supplier × productType × travelType
// (e.g. "Kafila International" = supplier Kafila × FLIGHT × INTERNATIONAL).
// The admin curates these per tenant; the search service consults the
// active rows to decide which airlines + fare types reach the agent, what
// to mask on the way out, and whether to short-circuit booking into a
// PENDING_MANUAL state for back-office issuance.

import mongoose, { Schema, model, type InferSchemaType, type Model } from 'mongoose';
import { PRODUCT_TYPE } from '@tripbng/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Sub-schemas — kept inline (not separate files) because they're tightly
// coupled to this aggregate and never read independently.
// ─────────────────────────────────────────────────────────────────────────────

/** Original supplier code → masked code the agent sees. Used for booking
 *  classes (e.g. supplier returns "YA", agent sees "Y") and fare types
 *  (e.g. supplier returns "INSTANT_OFFER", agent sees "Promo"). */
const CodeMaskSubSchema = new Schema(
  {
    original: { type: String, required: true, trim: true },
    masked: { type: String, required: true, trim: true },
  },
  { _id: false },
);

/** Window in which the source is active — both the calendar window (only
 *  show fares whose `departureDate` falls in [dateFrom, dateTo]) and the
 *  intra-day window (only show fares whose departure-of-day is in
 *  [timeStartMinutes, timeEndMinutes]). All four fields are independently
 *  optional; null means "no restriction on this axis". */
const RestrictTravelSubSchema = new Schema(
  {
    dateFrom: { type: Date, default: null },
    dateTo: { type: Date, default: null },
    timeStartMinutes: { type: Number, default: null, min: 0, max: 1439 },
    timeEndMinutes: { type: Number, default: null, min: 0, max: 1439 },
  },
  { _id: false },
);

/** Manual issuance — when matched, the booking is accepted, the wallet is
 *  debited as usual, but the supplier API is NOT called. The booking lands
 *  in PENDING_MANUAL status; ops issues a PNR/reference manually and
 *  updates the booking via the admin endpoint. The sub-fields are an
 *  AND-criteria: empty/null fields ignore that axis. Booking is manually
 *  issued only when every populated field matches. The `pendingBooking`
 *  flag is the top-level enable — without it, the criteria block is
 *  inactive. */
const ManualIssuanceSubSchema = new Schema(
  {
    /** Master switch for the manual-issuance branch. */
    pendingBooking: { type: Boolean, default: false },
    /** ANY of the fields below null/empty = "ignore this axis". */
    maximumPax: { type: Number, default: null, min: 1 },
    minAmountPaisePerPax: { type: Number, default: null, min: 0 },
    maxAmountPaisePerPax: { type: Number, default: null, min: 0 },
    tripType: {
      type: String,
      enum: ['ONEWAY', 'ROUND_TRIP', 'MULTI_CITY', null],
      default: null,
    },
    /** Comma-separated supplier booking-class codes (e.g. "K,T,YJ,R,N,S,V"). */
    bookingClass: { type: String, default: null },
    /** Comma-separated supplier fare-basis codes (e.g. "1R,USAVLMIF"). */
    fareBasis: { type: String, default: null },
    /** Travel date window. */
    fromDate: { type: Date, default: null },
    toDate: { type: Date, default: null },
    /** Booking-creation date window — distinct from travel window. */
    bookingDateFrom: { type: Date, default: null },
    bookingDateTo: { type: Date, default: null },
    applyForNonStopFlight: { type: Boolean, default: false },
    applyForStopFlight: { type: Boolean, default: false },
    /** Comma-separated sectors (e.g. "DEL-BOM,DEL-DXB"). */
    sector: { type: String, default: null },
  },
  { _id: false },
);

/** Travel-criteria sub-section from the form. Schema-on-write would
 *  over-constrain a UI section whose exact field set is still being
 *  shaped; we keep the structure permissive and revisit when the spec
 *  pins down. Documented as Mixed so admins/devs aren't surprised. */
const TravelCriteriaSubSchema = new Schema(
  {
    raw: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

// ─────────────────────────────────────────────────────────────────────────────
// Main schema
// ─────────────────────────────────────────────────────────────────────────────

const SupplierSourceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },

    /** Display name — e.g. "Kafila International". Defaults to null on legacy
     *  rows; the admin UI surfaces a derived "{supplier.name} {travelType}"
     *  label when null so the list view always has something to render. */
    name: { type: String, default: null, trim: true },

    /** Admin grouping tag — e.g. "tripbng group1". Free-form. Surfaces in the
     *  list view's `Supplier Group` column. Tenant-scoped; we don't promote
     *  it to its own collection because it's purely a display label. */
    supplierGroup: { type: String, default: null, trim: true, index: true },

    productType: { type: String, enum: PRODUCT_TYPE, required: true, index: true },
    travelType: {
      type: String,
      enum: ['DOMESTIC', 'INTERNATIONAL', 'BOTH'],
      default: 'BOTH',
      index: true,
    },

    /** Whitelist of airline IATA codes. Empty array = "no airlines pass
     *  through" (kill-switch effect); null/missing on legacy rows is
     *  defensively read as "no whitelist applied". The search-filter
     *  service treats those two states differently. */
    airlineCodes: [{ type: String, uppercase: true }],

    /** Which agency groups this map source applies to. Empty array = ALL
     *  agency groups (the "All" checkbox in the screenshot). The search
     *  filter resolves the agent's groups and matches against this list. */
    agencyGroupIds: [{ type: Schema.Types.ObjectId, ref: 'AgencyGroup', index: true }],

    /** Supplier-code → agent-facing code rewrites. Applied AFTER airline
     *  whitelist, BEFORE hide filter. Same fare-type can be masked once
     *  here AND hidden via `hideFareTypes` — the mask runs first, then
     *  the hide checks the masked value. */
    maskBookingClassCodes: { type: [CodeMaskSubSchema], default: [] },
    maskFareTypes: { type: [CodeMaskSubSchema], default: [] },

    /** Fare types to drop from results entirely. Matched case-insensitive
     *  against the post-mask fare type. Examples: "SME", "Instant Offer". */
    hideFareTypes: [{ type: String, trim: true }],

    restrictTravel: { type: RestrictTravelSubSchema, default: () => ({}) },
    manualIssuance: { type: ManualIssuanceSubSchema, default: () => ({}) },
    travelCriteria: { type: TravelCriteriaSubSchema, default: () => ({}) },

    priority: { type: Number, default: 100, index: true },

    /** Legacy bool kept for back-compat with existing reads. Mirrors `status`
     *  via a pre-save hook below so both stay in sync. New code should
     *  prefer `status`. */
    enabled: { type: Boolean, default: true, index: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
      index: true,
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

SupplierSourceSchema.index({ tenantId: 1, productType: 1, enabled: 1, priority: 1 });
// The search filter scans by (tenant, productType, status) and joins onto
// agencyGroupIds — this index keeps the hot path fast.
SupplierSourceSchema.index({ tenantId: 1, productType: 1, status: 1 });

// Keep `enabled` and `status` in lock-step. Whichever the admin sets, the
// other follows. Lets old code that reads `enabled` and new code that reads
// `status` both work without the admin having to set both.
SupplierSourceSchema.pre('save', function (next) {
  const doc = this as unknown as SupplierSourceDoc;
  // Detect which field was modified and propagate.
  if (this.isModified('status') && !this.isModified('enabled')) {
    doc.enabled = doc.status === 'ACTIVE';
  } else if (this.isModified('enabled') && !this.isModified('status')) {
    doc.status = doc.enabled ? 'ACTIVE' : 'INACTIVE';
  }
  next();
});

// findOneAndUpdate goes through a different path; mirror there too.
SupplierSourceSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() as Record<string, unknown> | null;
  if (!update) return next();
  // Mongoose hands us either `{ $set: {...}, ...}` or `{ field: ... }`. Cover both.
  const set = (update.$set as Record<string, unknown> | undefined) ?? update;
  if ('status' in set && !('enabled' in set)) {
    set.enabled = set.status === 'ACTIVE';
  } else if ('enabled' in set && !('status' in set)) {
    set.status = set.enabled ? 'ACTIVE' : 'INACTIVE';
  }
  next();
});

export type SupplierSourceDoc = InferSchemaType<typeof SupplierSourceSchema>;
export const SupplierSource: Model<SupplierSourceDoc> =
  (mongoose.models.SupplierSource as Model<SupplierSourceDoc> | undefined) ??
  model('SupplierSource', SupplierSourceSchema);
