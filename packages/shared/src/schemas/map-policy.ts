// Map Policy — pricing-rule layer that sits on top of Map Source. Phase 6
// of the admin panel spec; schemas only — Mongoose model lives in
// apps/api/src/models/MapPolicy.ts and the admin REST endpoints in
// apps/api/src/routes/map-policy.routes.ts.
//
// One policy carries up to four ENABLED components, any combination of:
//   - commission     payout-share of supplier commission to agent
//   - plb            Performance-Linked Bonus payout
//   - b2bMarkup      fixed/percent markup added on top of agent fare
//   - managementFee  fee deducted from commission OR added on top
//
// Each component has its own `enabled` flag — admins flip them
// independently in the UI's checkbox grid. All four can coexist.

import { z } from 'zod';

import { PRODUCT_TYPE } from './supplier.js';

export const MAP_POLICY_STATUS = ['ACTIVE', 'INACTIVE'] as const;
export type MapPolicyStatus = (typeof MAP_POLICY_STATUS)[number];

export const MAP_POLICY_FEE_VALUE_TYPE = ['ABSOLUTE', 'PERCENT'] as const;
export type MapPolicyFeeValueType = (typeof MAP_POLICY_FEE_VALUE_TYPE)[number];

/** Component that shares a percentage of a supplier-side payout with the
 *  agent. Used for both commission + PLB. payoutPercent = 0..100. */
export const PayoutComponentSchema = z.object({
  enabled: z.boolean().default(false),
  name: z.string().trim().max(80).nullable().optional(),
  payoutPercent: z.number().min(0).max(100).default(0),
  morePayout: z.boolean().default(false),
});
export type PayoutComponent = z.infer<typeof PayoutComponentSchema>;

/** Component that carries a flat money or percent value (b2bMarkup,
 *  managementFee). For ABSOLUTE the `value` is in paise; for PERCENT it's
 *  an integer 0..100. */
export const FeeComponentSchema = z.object({
  enabled: z.boolean().default(false),
  name: z.string().trim().max(80).nullable().optional(),
  valueType: z.enum(MAP_POLICY_FEE_VALUE_TYPE).default('ABSOLUTE'),
  value: z.number().min(0).default(0),
  morePayout: z.boolean().default(false),
  /** managementFee-only — hide the line item from the agent's quote.
   *  Ignored by other components but accepted on the shared shape. */
  hideFromAgent: z.boolean().default(false),
  setCondition: z.boolean().default(false),
});
export type FeeComponent = z.infer<typeof FeeComponentSchema>;

/** Which (supplier × airline × fare type × agency group) tuples this policy
 *  applies to. Empty arrays / null fields mean "no restriction on that axis";
 *  a policy with empty criteria everywhere matches every booking. */
export const MapPolicyCriteriaSchema = z.object({
  /** Free-form supplier-group label (e.g. "tripbng group1"). Denormalised
   *  copy of the SupplierSource.supplierGroup string. */
  supplierGroup: z.string().trim().max(60).nullable().optional(),
  mapSourceIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).default([]),
  airlineCodes: z.array(z.string().min(1).max(8)).default([]),
  fareTypes: z.array(z.string().min(1).max(80)).default([]),
  agencyGroupIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).default([]),
});
export type MapPolicyCriteria = z.infer<typeof MapPolicyCriteriaSchema>;

export const CreateMapPolicySchema = z.object({
  name: z.string().trim().min(1).max(120),
  productType: z.enum(PRODUCT_TYPE),
  status: z.enum(MAP_POLICY_STATUS).default('ACTIVE'),
  commission: PayoutComponentSchema.optional(),
  plb: PayoutComponentSchema.optional(),
  b2bMarkup: FeeComponentSchema.optional(),
  managementFee: FeeComponentSchema.optional(),
  criteria: MapPolicyCriteriaSchema.optional(),
  priority: z.number().int().min(0).default(100),
});
export type CreateMapPolicy = z.infer<typeof CreateMapPolicySchema>;

export const UpdateMapPolicySchema = CreateMapPolicySchema.partial();
export type UpdateMapPolicy = z.infer<typeof UpdateMapPolicySchema>;

/** Response shape used by the list / get endpoints. Server hydrates the
 *  display fields (agency-group names) so the table doesn't round-trip per
 *  row. */
export const PublicMapPolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  productType: z.enum(PRODUCT_TYPE),
  status: z.enum(MAP_POLICY_STATUS),
  commission: PayoutComponentSchema,
  plb: PayoutComponentSchema,
  b2bMarkup: FeeComponentSchema,
  managementFee: FeeComponentSchema,
  criteria: MapPolicyCriteriaSchema,
  priority: z.number(),
  /** True when ANY enabled component has morePayout=true. Cached on the
   *  doc; the list table renders the "Y / N" column from this field. */
  morePayoutAny: z.boolean(),
  /** Hydrated label list — agency-group names matching criteria.agencyGroupIds.
   *  Omitted when no groups are set or none could be resolved. */
  agencyGroupNames: z.array(z.string()).optional(),
  /** Hydrated label list — Map Source names matching criteria.mapSourceIds. */
  mapSourceNames: z.array(z.string()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicMapPolicy = z.infer<typeof PublicMapPolicySchema>;
