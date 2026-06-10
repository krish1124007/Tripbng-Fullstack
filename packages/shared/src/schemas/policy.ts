import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Manage Policy — a payout policy attached to a product type. A policy bundles
// up to four components: Commission, PLB (Productivity-Linked Bonus), B2B Markup
// and Management Fee. Each component the admin enables carries a name, a payout
// value, and optionally a list of extra "More Payout" rows.
//
// The legacy pricing fields (commissionPercent, managementFeePaise,
// b2bMarkupPaise, gst*) are DERIVED from these components on save so the
// existing pricing engine keeps working unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export const POLICY_PRODUCT_TYPE = ['AIR', 'HOTEL', 'BUS', 'HOLIDAY', 'INSURANCE'] as const;
export type PolicyProductType = (typeof POLICY_PRODUCT_TYPE)[number];

export const POLICY_STATUS = ['ACTIVE', 'INACTIVE'] as const;
export type PolicyStatus = (typeof POLICY_STATUS)[number];

export const POLICY_VALUE_TYPE = ['PERCENT', 'FLAT'] as const;
export type PolicyValueType = (typeof POLICY_VALUE_TYPE)[number];

export const POLICY_COMPONENTS = ['commission', 'plb', 'b2bMarkup', 'managementFee'] as const;
export type PolicyComponentKey = (typeof POLICY_COMPONENTS)[number];

// Extra payout row revealed by the "More Payout" toggle.
export const PolicyPayoutRowSchema = z.object({
  label: z.string().max(120).optional().or(z.literal('')),
  valueType: z.enum(POLICY_VALUE_TYPE).default('PERCENT'),
  value: z.number().min(0).default(0),
});
export type PolicyPayoutRow = z.infer<typeof PolicyPayoutRowSchema>;

// One policy component (Commission / PLB / B2B Markup).
export const PolicyComponentSchema = z.object({
  enabled: z.boolean().default(false),
  name: z.string().max(120).optional().or(z.literal('')),
  valueType: z.enum(POLICY_VALUE_TYPE).default('PERCENT'),
  /** Primary payout. PERCENT → %, FLAT → rupees. */
  value: z.number().min(0).default(0),
  morePayout: z.boolean().default(false),
  extraPayouts: z.array(PolicyPayoutRowSchema).default([]),
});
export type PolicyComponent = z.infer<typeof PolicyComponentSchema>;

// Management Fee adds a "hide from agent" flag.
export const ManagementFeeComponentSchema = PolicyComponentSchema.extend({
  valueType: z.enum(POLICY_VALUE_TYPE).default('FLAT'),
  hideManagementFee: z.boolean().default(false),
});
export type ManagementFeeComponent = z.infer<typeof ManagementFeeComponentSchema>;

const emptyComponent = (): PolicyComponent => ({
  enabled: false,
  name: '',
  valueType: 'PERCENT',
  value: 0,
  morePayout: false,
  extraPayouts: [],
});

export const CreatePolicyRequestSchema = z.object({
  // General info
  productType: z.enum(POLICY_PRODUCT_TYPE).default('AIR'),
  name: z.string().min(2).max(120),
  status: z.enum(POLICY_STATUS).default('ACTIVE'),

  // Components
  commission: PolicyComponentSchema.default(emptyComponent()),
  plb: PolicyComponentSchema.default(emptyComponent()),
  b2bMarkup: PolicyComponentSchema.default({ ...emptyComponent(), valueType: 'FLAT' }),
  managementFee: ManagementFeeComponentSchema.default({
    ...emptyComponent(),
    valueType: 'FLAT',
    hideManagementFee: false,
  }),

  notes: z.string().max(1000).optional().or(z.literal('')),

  // Legacy GST handling — not surfaced in the new UI, kept for the pricing engine.
  gstOnMarkupOnly: z.boolean().default(false),
  gstRateBasisPoints: z.number().int().min(0).max(10000).default(1800),
});
export type CreatePolicyRequest = z.infer<typeof CreatePolicyRequestSchema>;

export const UpdatePolicyRequestSchema = CreatePolicyRequestSchema.partial();
export type UpdatePolicyRequest = z.infer<typeof UpdatePolicyRequestSchema>;

export const PublicPolicySchema = z.object({
  id: z.string(),
  productType: z.enum(POLICY_PRODUCT_TYPE),
  name: z.string(),
  status: z.enum(POLICY_STATUS),

  commission: PolicyComponentSchema,
  plb: PolicyComponentSchema,
  b2bMarkup: PolicyComponentSchema,
  managementFee: ManagementFeeComponentSchema,

  /** Comma-joinable list of enabled component labels, e.g. "Commission, B2B Markup". */
  policyType: z.string(),
  /** Whether any enabled component has More Payout on. */
  morePayout: z.boolean(),

  notes: z.string().nullable(),

  // Derived legacy pricing fields (read-only mirror for the engine).
  commissionPercent: z.number(),
  managementFeePaise: z.number(),
  b2bMarkupPaise: z.number(),
  gstOnMarkupOnly: z.boolean(),
  gstRateBasisPoints: z.number(),

  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicPolicy = z.infer<typeof PublicPolicySchema>;

// Human label for each component key — shared by API (policyType string) and UI.
export const POLICY_COMPONENT_LABEL: Record<PolicyComponentKey, string> = {
  commission: 'Commission',
  plb: 'PLB',
  b2bMarkup: 'B2B Markup',
  managementFee: 'Management Fee',
};

/**
 * Derive the legacy pricing fields the engine reads from the component config.
 * Commission → basis-points×100; B2B markup & management fee FLAT rupees → paise.
 * (Percentage management fee / markup can't be expressed as flat paise, so they
 * contribute 0 to the legacy flat fields — the component value is still stored.)
 */
export function deriveLegacyPricing(p: {
  commission?: PolicyComponent;
  b2bMarkup?: PolicyComponent;
  managementFee?: ManagementFeeComponent;
}): { commissionPercent: number; b2bMarkupPaise: number; managementFeePaise: number } {
  const commissionPercent =
    p.commission?.enabled && p.commission.valueType === 'PERCENT'
      ? Math.round(p.commission.value * 100)
      : 0;
  const b2bMarkupPaise =
    p.b2bMarkup?.enabled && p.b2bMarkup.valueType === 'FLAT'
      ? Math.round(p.b2bMarkup.value * 100)
      : 0;
  const managementFeePaise =
    p.managementFee?.enabled && p.managementFee.valueType === 'FLAT'
      ? Math.round(p.managementFee.value * 100)
      : 0;
  return { commissionPercent, b2bMarkupPaise, managementFeePaise };
}
