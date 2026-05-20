// MapPolicy — the "Manage Policy → Map Policy" model from the admin panel
// spec (PDF screenshots 4 + 5). A Map Policy is the pricing-rule layer that
// sits on top of one or more Map Sources: it decides what the agent pays
// vs. what platform/agency keeps for a given (supplier × airline × fare
// type × agency group) combination.
//
// One policy carries up to four ENABLED components, any combination of:
//   - commission     — percentage of supplier commission passed to the agent
//   - plb            — Performance-Linked Bonus passout
//   - b2bMarkup      — fixed/percent markup added on top of the agent fare
//   - managementFee  — fee deducted from commission OR added on top
//
// Each component has its own enabled flag so admins can flip components on
// independently (matches the checkbox UI). All four can coexist.
//
// Pricing wiring lives in Phase 8; this file is the data layer only.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { PRODUCT_TYPE } from '@tripbng/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Component sub-schemas
// ─────────────────────────────────────────────────────────────────────────────

/** Common shape for the two share-of-supplier-payout components.
 *  `payoutPercent` is the % of the supplier's payout that the AGENT receives
 *  (the rest stays with the agency). 70 = "70% PASS". */
const PayoutComponentSubSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    name: { type: String, default: null, trim: true },
    /** 0..100. Stored as a number; the form surfaces an integer slider. */
    payoutPercent: { type: Number, default: 0, min: 0, max: 100 },
    /** Companion "More Payout" indicator from the form — the orange/grey
     *  pill in screenshots 4-5. Free-form Boolean for now (the UI uses it
     *  to flag policies that grant uplift beyond the standard payout). */
    morePayout: { type: Boolean, default: false },
  },
  { _id: false },
);

const FEE_VALUE_TYPE = ['ABSOLUTE', 'PERCENT'] as const;

/** Shape for components that carry a flat money or percent value:
 *  b2bMarkup (added on top) and managementFee (deducted / added). */
const FeeComponentSubSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    name: { type: String, default: null, trim: true },
    valueType: {
      type: String,
      enum: FEE_VALUE_TYPE,
      default: 'ABSOLUTE',
    },
    /** ABSOLUTE → paise; PERCENT → integer 0..100. Same field, different
     *  semantics — the pricing engine reads `valueType` to interpret. */
    value: { type: Number, default: 0, min: 0 },
    morePayout: { type: Boolean, default: false },
    /** Management-fee-only: hide the line item from the agent's quote.
     *  Ignored for other components but kept on the shared shape so the
     *  schema stays uniform. */
    hideFromAgent: { type: Boolean, default: false },
    /** "Set Condition" toggle from the form. When true, the component
     *  only applies to bookings matching the policy's criteria block.
     *  When false, it applies to every booking the policy matches at all
     *  (the policy itself still has to match via criteria). v1 keeps this
     *  as a single bit; richer condition-tree authoring can come later. */
    setCondition: { type: Boolean, default: false },
  },
  { _id: false },
);

/** The criteria block — which suppliers / airlines / fare types / agency
 *  groups this policy applies to. Empty / missing fields mean "no
 *  restriction on that axis". `supplierGroup` is the free-text grouping
 *  tag from the Map Source list view; we keep it here as a denormalised
 *  hint so the admin filter card can search policies by group without an
 *  extra join. */
const CriteriaSubSchema = new Schema(
  {
    supplierGroup: { type: String, default: null, trim: true },
    mapSourceIds: [{ type: Schema.Types.ObjectId, ref: 'SupplierSource' }],
    airlineCodes: [{ type: String, uppercase: true }],
    fareTypes: [{ type: String, trim: true }],
    agencyGroupIds: [{ type: Schema.Types.ObjectId, ref: 'AgencyGroup' }],
  },
  { _id: false },
);

// ─────────────────────────────────────────────────────────────────────────────
// Main schema
// ─────────────────────────────────────────────────────────────────────────────

const MapPolicySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    name: { type: String, required: true, trim: true },
    productType: { type: String, enum: PRODUCT_TYPE, required: true, index: true },

    /** Status enum mirrors SupplierSource — single enabled bit kept for the
     *  list-view toggle. */
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
      index: true,
    },

    commission: { type: PayoutComponentSubSchema, default: () => ({}) },
    plb: { type: PayoutComponentSubSchema, default: () => ({}) },
    b2bMarkup: { type: FeeComponentSubSchema, default: () => ({}) },
    managementFee: { type: FeeComponentSubSchema, default: () => ({}) },

    criteria: { type: CriteriaSubSchema, default: () => ({}) },

    /** Higher priority wins on conflicting matches at pricing time. */
    priority: { type: Number, default: 100, index: true },

    /** Convenience flag for the list view's "More Payout" column —
     *  derived in the pre-save hook as `commission.morePayout ||
     *  plb.morePayout || ...`. Cached so the table doesn't recompute per
     *  row. */
    morePayoutAny: { type: Boolean, default: false, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// List-view hot path: tenant + product type + status. Mirrors SupplierSource
// for consistency.
MapPolicySchema.index({ tenantId: 1, productType: 1, status: 1, priority: 1 });
// Pricing-resolution hot path: agency-group + airline + fare type lookup.
MapPolicySchema.index({ tenantId: 1, 'criteria.airlineCodes': 1, status: 1 });
MapPolicySchema.index({ tenantId: 1, 'criteria.agencyGroupIds': 1, status: 1 });

// Keep `morePayoutAny` in sync with the per-component morePayout bits. Saves
// a `$or` query in the list-view filter card and a per-row derivation in the
// table cell.
function recomputeMorePayout(doc: MapPolicyDoc): void {
  const c = doc.commission?.morePayout ?? false;
  const p = doc.plb?.morePayout ?? false;
  const b = doc.b2bMarkup?.morePayout ?? false;
  const m = doc.managementFee?.morePayout ?? false;
  doc.morePayoutAny = c || p || b || m;
}

MapPolicySchema.pre('save', function (next) {
  recomputeMorePayout(this as unknown as MapPolicyDoc);
  next();
});

// findOneAndUpdate flows can mutate the components — refresh the cached
// flag in the same write so callers don't have to remember.
MapPolicySchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() as Record<string, unknown> | null;
  if (!update) return next();
  const set = (update.$set as Record<string, unknown> | undefined) ?? update;
  const components = ['commission', 'plb', 'b2bMarkup', 'managementFee'] as const;
  let any = false;
  for (const k of components) {
    const v = set[k] as { morePayout?: boolean } | undefined;
    if (v?.morePayout) any = true;
  }
  // Only stamp morePayoutAny when at least one component is being
  // touched — preserves the prior value otherwise.
  if (components.some((k) => k in set)) {
    set.morePayoutAny = any;
  }
  next();
});

export type MapPolicyDoc = HydratedDocument<InferSchemaType<typeof MapPolicySchema>> & {
  _id: Types.ObjectId;
};

export const MapPolicy: Model<MapPolicyDoc> =
  (mongoose.models.MapPolicy as Model<MapPolicyDoc> | undefined) ??
  model<MapPolicyDoc>('MapPolicy', MapPolicySchema);
