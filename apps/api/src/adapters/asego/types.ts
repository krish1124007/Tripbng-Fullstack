// ASEGO B2B v1 wire DTOs — mirror the OpenAPI 3.0.1 schema 1:1.
// Source: asego-b2b-openapi.json v2.0
//
// Naming: `External*` prefix matches ASEGO's own DTO names so cross-referencing
// the spec during debugging is friction-free. Anything non-`External` is our
// internal request/response shape (non-mirrored).

import type { AsegoIdentity } from './identity.js';

// ────────── Identity ──────────

export type ExternalIdentity = AsegoIdentity;

// ────────── Master data ──────────

export interface ExternalCPCurrencyDto {
  id?: string;
  currency: string;
  code: string;
  symbol?: string;
}

export interface ExternalCPCategoryDto {
  id: string;
  name: string;
  description?: string;
}

export interface ExternalMasterTypeSelectDto {
  id: string;
  name: string;
}

export interface ExternalSellingPlanDto {
  planId: string;
  insurerId: string;
  planName: string;
  planShortName?: string;
  productCatId?: string;
  geographicalArea?: string;
  planType?: string;
  planCatId?: string;
  planDisplayName?: string;
}

// ────────── Premium structures ──────────

/** Per-traveler age premium pair. Used inside selectedPlan.plan.agePremiums. */
export interface AgePremiums {
  age: number; // 1–80
  premium: number;
}

/** Per-rider line item. `percent` is the load percent for `Loading %` rateType
 *  (0 otherwise); `riderAmount` is the absolute rupee amount applied to the
 *  policy total. */
export interface ExternalRiders {
  percent: number;
  riderName: string;
  rateType: string; // 'Loading %' | rider-value UUID
  riderAmount: number;
}

// ────────── Policy issuance — nested envelope ──────────

/** Inner plan block — sits inside selectedPlan. Contains the per-traveler
 *  selling-plan id, this traveler's age-premium tuple, and any riders. */
export interface ExternalPlan {
  sellingPlanId: string;
  agePremiums: AgePremiums;
  riders?: ExternalRiders[];
}

/** Plan envelope. The "plan field is null" error refers to THIS nested
 *  field — i.e. `selectedPlan.plan`, NOT the top level. */
export interface ExternalSelectedPlan {
  insurerId: string;
  totalPremium: number;
  plan: ExternalPlan;
}

export interface ExternalQuotation {
  travelCategory: string; // UUID — NOT `category`
  startDate: string; // yyyy-MM-dd
  duration: number;
  endDate: string;
  destination?: string;
}

/** Optional metadata. ASEGO uses `policyComment` (not `remarks`). */
export interface ExternalOtherDetails {
  policyComment?: string;
  universityName?: string;
  universityAddress?: string;
}

/**
 * Per-traveler entry. Note the schema oddities:
 *   - `name` is a single string, not first/middle/last separately
 *   - `nominee` is a STRING (the nominee's name)
 *   - `relation` is a separate top-level field on the traveler
 *   - `title` is NOT in the spec — don't send it
 *   - `city`, `finalPremium`, `age`, `gender` are all required
 */
export interface ExternalTraveler {
  name: string;
  passport: string;
  dob: string; // yyyy-MM-dd
  address: string;
  mobileNo: string;
  email: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  country: string;
  preExistingMedicalCondition?: string;
  finalPremium: number;
  riderTotalAmt?: number;
  age: number;
  gender: string;
  nominee: string;
  relation: string;
  pastillness?: string;
  remarks?: string;
  crReferenceNumber?: string;
  emergencyContactPerson?: string;
  emergencyContactNumber?: string;
  emergencyEmailId?: string;
  gstNumber?: string;
  pnrNumber?: string;
  gstState?: string;
  flightNumber?: string;
  departureTime?: string;
  arrivalTime?: string;
  departureAirportCode?: string;
  arrivalAirportCode?: string;
  univercityName?: string; // ASEGO's typo, kept verbatim
  univercityAddress?: string;
}

/**
 * Per-traveler policy entry. The wire format for both /createPolicy and
 * /createPolicy/validate is an ARRAY of these — one element per traveler.
 * Group bookings issue all linked policies in a single call.
 */
export interface ExternalPolicy {
  identity: ExternalIdentity;
  selectedPlan: ExternalSelectedPlan;
  quotation: ExternalQuotation;
  traveler: ExternalTraveler;
  otherDetails: ExternalOtherDetails;
}

// ────────── Endorsement ──────────

export interface ExternalEndorsePlan {
  sellingPlanId: string;
  agePremiums: AgePremiums;
  riders: ExternalRiders[];
}

export interface ExternalEndorseSelectedPlan {
  insurerId: string;
  totalPremium?: number;
  plan: ExternalEndorsePlan;
}

export interface ExternalEndorseQuotation {
  tripType: string;
  travelCategory: string;
  startDate: string;
  duration?: number;
  endDate: string;
  destination?: string;
}

export interface ExternalEndorseTraveler {
  name: string;
  passport: string;
  dob: string;
  address: string;
  mobileNo: string;
  email: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  country: string;
  age: number;
  gender: string;
  nominee: string;
  relation: string;
  emergencyContactPerson: string;
  emergencyContactNumber: string;
  emergencyEmailId: string;
  finalPremium?: number;
  riderTotalAmt?: number;
}

export interface ExternalEndorsePolicy {
  identity: ExternalIdentity;
  selectedPlan: ExternalEndorseSelectedPlan;
  quotation: ExternalEndorseQuotation;
  traveler: ExternalEndorseTraveler;
  otherDetails: ExternalOtherDetails;
  endorsementReason: string[];
  remark?: string;
  endorsePolicyNumber: string;
  extendAmount?: number;
}

// ────────── Cancellation ──────────

export interface ExternalCancelPolicy {
  identity: ExternalIdentity;
  policyNumber: string;
  remark?: string;
  cancellationCharges?: number;
  cancellationReason: string[];
}

// ────────── Encryption helpers ──────────

/** Body shape for /encryption/encrypt and /encryption/decrypt — `{ value, key, initVector }`,
 *  NOT `{ data }`. Server returns text/plain (the cipher- or plaintext) directly. */
export interface ExternalEncryptionRequest {
  value: string;
  key: string;
  initVector: string;
}

// ────────── Generic envelopes ──────────

export interface ExternalCreatePolicyResponse {
  policyNumber?: string;
  policyFilePath?: string;
}

export interface SuccessResponseDto {
  code?: number;
  msg?: string;
}

export interface ErrorResponseDto {
  code: number;
  msg: string;
}
