// RateConfiguration — Phase-4 implementation of spec §2.7 + §3.7. Drives the
// module-aware booking-time markup resolution.
//
// Coexistence with the existing MarkupRule / FareRule collections
//   The repo already has `MarkupRule` (used by services/pricing/) and
//   `FareRule`. Those keep working unchanged — RateConfiguration is the new
//   home for the SPEC-aligned axis (`module × scope × service × appliesTo`).
//   Migration of existing consumers is deferred until Phase-5 (admin UI).
//   New callers (and the internal /resolve-rate endpoint) read this model.
//
// Resolution priority (per spec §3.7)
//   Within the same (module, service) bucket:
//     1. scope=AGENCY rows for the caller's agency
//     2. scope=GLOBAL rows
//   Ties within a scope break on `priority` DESC (higher wins).
//
// Module mapping for non-eligible modules
//   * SUB_AGENT inherits its parent distributor's effective rate module.
//   * DISTRIBUTOR-mode agencies price like CASH by default. (Spec §3.7.)
//   These rules live in the RateService, NOT in the schema — the schema
//   only stores CREDIT/DI/CASH (the three real rate cards).

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

/** Rate-card modules — the three "real" cards. DISTRIBUTOR + SUB_AGENT
 *  resolve to one of these via the service-layer mapping. */
export const RATE_MODULE = ['CREDIT', 'DI', 'CASH'] as const;
export type RateModule = (typeof RATE_MODULE)[number];

/** Service line that the rate applies to. */
export const RATE_SERVICE = ['FLIGHT', 'HOTEL', 'INSURANCE'] as const;
export type RateService = (typeof RATE_SERVICE)[number];

/** Scope — AGENCY-specific override OR a tenant-wide GLOBAL row. */
export const RATE_SCOPE = ['GLOBAL', 'AGENCY'] as const;
export type RateScope = (typeof RATE_SCOPE)[number];

/** How the markup is expressed. */
export const RATE_MARKUP_TYPE = ['PERCENT', 'ABSOLUTE', 'TIERED'] as const;
export type RateMarkupType = (typeof RATE_MARKUP_TYPE)[number];

const MarkupTierSubSchema = new Schema(
  {
    /** Apply this tier when the base amount is <= `upToAmountPaise`. The last
     *  tier should set this to a large sentinel so it always matches. */
    upToAmountPaise: { type: Number, required: true, min: 0 },
    markupBasisPoints: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const RateConfigurationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    module: { type: String, enum: RATE_MODULE, required: true, index: true },
    service: { type: String, enum: RATE_SERVICE, required: true, index: true },

    scope: { type: String, enum: RATE_SCOPE, required: true, index: true },
    /** Present iff scope === 'AGENCY'. */
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },

    /** Filters that narrow when a candidate row applies. All filters AND
     *  together; an empty array on a filter means "match anything". */
    appliesTo: {
      /** IATA airline codes (e.g. ['AI', '6E']). Flight rows only. */
      airlines: { type: [String], default: [] },
      /** Origin → destination sectors (e.g. [{from:'BOM', to:'DEL'}]). Flight + bus. */
      sectors: {
        type: [
          new Schema(
            {
              from: { type: String, required: true },
              to: { type: String, required: true },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      /** Supplier codes from the upstream adapter (e.g. ['TBO', 'AIRIQ']). */
      supplierIds: { type: [String], default: [] },
    },

    markupType: { type: String, enum: RATE_MARKUP_TYPE, required: true },
    /** Used when markupType=PERCENT. Basis points (100 = 1%). */
    markupBasisPoints: { type: Number, default: null, min: 0 },
    /** Used when markupType=ABSOLUTE. Flat paise added per booking. */
    markupAbsolutePaise: { type: Number, default: null, min: 0 },
    /** Used when markupType=TIERED. Sorted ascending by upToAmountPaise. */
    markupTiers: { type: [MarkupTierSubSchema], default: [] },

    /** Higher priority wins ties within the same scope. */
    priority: { type: Number, default: 0, index: true },

    validFrom: { type: Date, default: () => new Date(), required: true },
    /** Open-ended when null. */
    validTo: { type: Date, default: null },

    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Resolution scan — the hot path. One query per booking-time rate lookup.
// Combined index covers the most selective filter chain: tenant + module +
// service + isActive, then sort by scope/priority handled in-memory.
RateConfigurationSchema.index({
  tenantId: 1,
  module: 1,
  service: 1,
  isActive: 1,
  validFrom: 1,
  validTo: 1,
});
// Admin "config for agency X" listing.
RateConfigurationSchema.index({ tenantId: 1, agencyId: 1, isActive: 1 });

export type RateConfigurationDoc = HydratedDocument<
  InferSchemaType<typeof RateConfigurationSchema>
> & { _id: Types.ObjectId };

export const RateConfiguration: Model<RateConfigurationDoc> =
  (mongoose.models.RateConfiguration as Model<RateConfigurationDoc> | undefined) ??
  model<RateConfigurationDoc>('RateConfiguration', RateConfigurationSchema);
