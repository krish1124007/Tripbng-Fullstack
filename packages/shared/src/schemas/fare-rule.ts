import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Fare Rule — cancellation / reschedule / no-show policy plus the condition
// matrix (trip type, cabin, route, fare basis, schedule window …) that decides
// which fares a rule applies to.
//
// Money is stored in PAISE (integers) to match the rest of the platform; the
// admin form accepts rupees and converts at the boundary.
// ─────────────────────────────────────────────────────────────────────────────

export const FARE_RULE_TRIP_TYPE = ['ALL', 'ONEWAY', 'ROUNDTRIP', 'MULTICITY'] as const;
export type FareRuleTripType = (typeof FARE_RULE_TRIP_TYPE)[number];

export const FARE_RULE_CABIN_TYPE = [
  'ALL',
  'ECONOMY',
  'PREMIUM_ECONOMY',
  'BUSINESS',
  'FIRST',
] as const;
export type FareRuleCabinType = (typeof FARE_RULE_CABIN_TYPE)[number];

export const FARE_RULE_REFUND_TYPE = ['REFUNDABLE', 'NON_REFUNDABLE', 'PARTIAL'] as const;
export type FareRuleRefundType = (typeof FARE_RULE_REFUND_TYPE)[number];

export const FARE_RULE_STATUS = ['ACTIVE', 'INACTIVE'] as const;
export type FareRuleStatus = (typeof FARE_RULE_STATUS)[number];

export const FARE_RULE_CONDITION_ACTION = ['INCLUDE', 'EXCLUDE'] as const;
export type FareRuleConditionAction = (typeof FARE_RULE_CONDITION_ACTION)[number];

// ── Policy band (time-range row for cancellation / reschedule) ──
//
// A band charges, for cancellations/changes made within
// [fromHours, toHours) hours before departure:
//   percentage          — % of the fare
//   penaltyAmountPaise   — flat penalty on top
//   additionalFeePaise   — service fee on top
// toHours = null means "and beyond" (open-ended upper bound).
export const PolicyBandSchema = z
  .object({
    fromHours: z.number().int().min(0).default(0),
    toHours: z.number().int().min(0).nullable().default(null),
    percentage: z.number().min(0).max(100).default(0),
    penaltyAmountPaise: z.number().int().min(0).default(0),
    additionalFeePaise: z.number().int().min(0).default(0),
  })
  .refine((b) => b.toHours == null || b.toHours > b.fromHours, {
    message: 'To must be greater than From',
    path: ['toHours'],
  });
export type PolicyBand = z.infer<typeof PolicyBandSchema>;

/** Find the band whose [fromHours, toHours) window contains `hoursBefore`. */
export function matchPolicyBand<T extends { fromHours: number; toHours?: number | null }>(
  bands: readonly T[],
  hoursBefore: number,
): T | undefined {
  return bands.find(
    (b) => hoursBefore >= b.fromHours && (b.toHours == null || hoursBefore < b.toHours),
  );
}

/**
 * Fee (in paise) a band charges against `basePaise`:
 *   percentage of base + flat penalty + additional service fee,
 * clamped to [0, basePaise] so a cancellation never refunds negative / over-charges.
 */
export function computePolicyBandFeePaise(
  band: { percentage: number; penaltyAmountPaise: number; additionalFeePaise: number },
  basePaise: number,
): number {
  const pct = Math.round((basePaise * band.percentage) / 100);
  const fee = pct + band.penaltyAmountPaise + band.additionalFeePaise;
  return Math.max(0, Math.min(basePaise, fee));
}

// ── Condition row — narrows which fares the rule matches. All optional;
// an empty field means "any". ──
export const FareConditionSchema = z.object({
  origin: z.string().trim().toUpperCase().max(3).optional().or(z.literal('')),
  destination: z.string().trim().toUpperCase().max(3).optional().or(z.literal('')),
  fareType: z.string().trim().max(40).optional().or(z.literal('')),
  bookingClass: z.string().trim().toUpperCase().max(8).optional().or(z.literal('')),
  fareBasis: z.string().trim().toUpperCase().max(40).optional().or(z.literal('')),
  sector: z.string().trim().toUpperCase().max(20).optional().or(z.literal('')),
  travelDate: z.coerce.date().nullable().default(null),
});
export type FareCondition = z.infer<typeof FareConditionSchema>;

const objectIdOrEmpty = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, 'must be a 24-char ObjectId')
  .nullable()
  .optional()
  .or(z.literal(''));

const FareRuleObjectSchema = z
  .object({
    // General info
    name: z.string().min(2).max(120),
    tripType: z.enum(FARE_RULE_TRIP_TYPE).default('ALL'),
    cabinType: z.enum(FARE_RULE_CABIN_TYPE).default('ALL'),
    refundType: z.enum(FARE_RULE_REFUND_TYPE).default('REFUNDABLE'),
    status: z.enum(FARE_RULE_STATUS).default('ACTIVE'),

    // Relations (reference workflow): which airline / source supplier / agency
    // group this rule is scoped to. All optional — empty = applies broadly.
    airline: z.string().trim().toUpperCase().max(3).optional().or(z.literal('')),
    sourceId: objectIdOrEmpty,
    agencyGroupId: objectIdOrEmpty,

    // Condition fields
    conditionAction: z.enum(FARE_RULE_CONDITION_ACTION).default('INCLUDE'),
    scheduleFrom: z.coerce.date().nullable().default(null),
    scheduleTo: z.coerce.date().nullable().default(null),
    conditions: z.array(FareConditionSchema).default([]),

    // Fare rule info — policies
    cancellationBands: z.array(PolicyBandSchema).default([]),
    reschedulingBands: z.array(PolicyBandSchema).default([]),
    noShowPenaltyPaise: z.number().int().min(0).default(0),
    noShowAdditionalFeePaise: z.number().int().min(0).default(0),

    // Additional info
    notes: z.string().max(2000).optional().or(z.literal('')),
  });

const scheduleWindowOk = (d: { scheduleFrom?: Date | null; scheduleTo?: Date | null }) =>
  !d.scheduleFrom || !d.scheduleTo || d.scheduleFrom <= d.scheduleTo;
const scheduleWindowError = {
  message: 'Schedule From must be on or before Schedule To',
  path: ['scheduleTo'],
};

export const CreateFareRuleRequestSchema = FareRuleObjectSchema.refine(
  scheduleWindowOk,
  scheduleWindowError,
);
export type CreateFareRuleRequest = z.infer<typeof CreateFareRuleRequestSchema>;

export const UpdateFareRuleRequestSchema = FareRuleObjectSchema.partial().refine(
  scheduleWindowOk,
  scheduleWindowError,
);
export type UpdateFareRuleRequest = z.infer<typeof UpdateFareRuleRequestSchema>;

// ── Public (serialized) shapes — dates as ISO strings ──
const PublicFareConditionSchema = z.object({
  origin: z.string(),
  destination: z.string(),
  fareType: z.string(),
  bookingClass: z.string(),
  fareBasis: z.string(),
  sector: z.string(),
  travelDate: z.string().datetime().nullable(),
});

export const PublicFareRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  tripType: z.enum(FARE_RULE_TRIP_TYPE),
  cabinType: z.enum(FARE_RULE_CABIN_TYPE),
  refundType: z.enum(FARE_RULE_REFUND_TYPE),
  status: z.enum(FARE_RULE_STATUS),

  // Relations + resolved display names for the table.
  airline: z.string().nullable(),
  sourceId: z.string().nullable(),
  sourceName: z.string().nullable(),
  agencyGroupId: z.string().nullable(),
  agencyGroupName: z.string().nullable(),
  conditionAction: z.enum(FARE_RULE_CONDITION_ACTION),
  scheduleFrom: z.string().datetime().nullable(),
  scheduleTo: z.string().datetime().nullable(),
  conditions: z.array(PublicFareConditionSchema),
  cancellationBands: z.array(PolicyBandSchema),
  reschedulingBands: z.array(PolicyBandSchema),
  noShowPenaltyPaise: z.number(),
  noShowAdditionalFeePaise: z.number(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicFareRule = z.infer<typeof PublicFareRuleSchema>;
