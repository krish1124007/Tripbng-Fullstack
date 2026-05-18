import type {
  MarkupConditions,
  MarkupScope,
  MarkupValueType,
  PaxType,
  TravelClass,
  TravelType,
} from '@tripbng/shared';

// Every monetary value in this engine is integer paise.
// Percentages use basis points × 100 — i.e. 250 = 2.50%, 1800 = 18.00%.
// This matches the on-disk schemas exactly so no conversion is needed at the boundary.

export interface PricingPolicy {
  commissionPercent: number;
  managementFeePaise: number;
  b2bMarkupPaise: number;
  gstOnMarkupOnly: boolean;
  gstRateBasisPoints: number;
}

export interface PricingMarkupRule {
  id: string;
  name: string;
  scope: MarkupScope;
  distributorId?: string | null;
  agencyId?: string | null;
  valueType: MarkupValueType;
  value: number;
  maxValuePaise?: number | null;
  priority: number;
  status: 'ACTIVE' | 'PAUSED';
  conditions: MarkupConditions;
}

export interface PricingInput {
  baseFarePaise: number;
  taxesPaise: number;

  paxType: PaxType;
  travelType: TravelType;
  travelClass: TravelClass;
  airline: string;
  origin: string;
  destination: string;
  fareClass?: string;

  agencyId: string;
  agencyGroupIds?: string[];
  distributorId?: string | null;

  bookingDate?: Date;

  policy?: PricingPolicy;
  markupRules?: PricingMarkupRule[];
  discountPaise?: number;
}

export interface PricingTraceStep {
  step: string;
  ruleId?: string;
  ruleName?: string;
  beforePaise: number;
  afterPaise: number;
  deltaPaise: number;
  notes?: string;
}

export interface PricingResult {
  baseFarePaise: number;
  taxesPaise: number;
  policyAdjustmentPaise: number;
  platformMarkupPaise: number;
  distributorMarkupPaise: number;
  agencyMarkupPaise: number;
  discountPaise: number;
  gstPaise: number;

  grossAmountPaise: number;
  netToSupplierPaise: number;
  agencyPayablePaise: number;
  distributorEarningsPaise: number;
  platformEarningsPaise: number;

  trace: PricingTraceStep[];
}
