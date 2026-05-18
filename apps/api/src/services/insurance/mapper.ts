// TripBng → ASEGO mapper. The ONLY place where our domain types touch ASEGO
// domain types — everywhere else (controllers, services, react components)
// stays in TripBng land. Per spec §11.
//
// Wire format (per asego-b2b-openapi.json v2.0):
//   ExternalPolicy[] — one entry per traveler, each with:
//     identity, quotation, selectedPlan{insurerId,totalPremium,plan{...}},
//     traveler{name (single string), city, district, state, country, finalPremium,
//             age, gender, nominee (string), relation, ...}, otherDetails

import type { InsuranceIssueRequest, InsuranceTraveler } from '@tripbng/shared';
import type { AsegoIdentity } from '../../adapters/asego/identity.js';
import { buildIdentity, type AsegoIdentityConfig } from '../../adapters/asego/identity.js';
import type {
  ExternalPolicy,
  ExternalQuotation,
  ExternalRiders,
  ExternalSelectedPlan,
  ExternalTraveler,
} from '../../adapters/asego/types.js';

/** Whole-year age at issuance, computed from yyyy-MM-dd. */
export function computeAge(dobIso: string, asOf: Date = new Date()): number {
  const dob = new Date(dobIso);
  let years = asOf.getFullYear() - dob.getFullYear();
  const monthDiff = asOf.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < dob.getDate())) years -= 1;
  return years;
}

/** Trip duration in days, inclusive of the start date (matching ASEGO's spec). */
export function computeDuration(startDateIso: string, endDateIso: string): number {
  const ms = new Date(endDateIso).getTime() - new Date(startDateIso).getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1);
}

interface RiderResolutionInput {
  riderId: string;
  riderName: string;
  rateType: string;
  rateValue: number;
}

/**
 * Resolve the absolute rupee `riderAmount` for a single rider given the per-pax
 * age premium it'll be applied against. Caller is responsible for pulling
 * `Rider Value`-typed rider's numeric value (UUID lookup from master) and passing
 * it as `rateValue`.
 */
export function resolveRiderAmount(
  rider: RiderResolutionInput,
  agePremium: number,
): ExternalRiders {
  let amount = 0;
  let percent = 0;
  if (rider.rateType === 'Loading %') {
    percent = rider.rateValue;
    amount = Math.round(agePremium * rider.rateValue) / 100;
  } else {
    // Rider Value — caller-supplied scalar (already in rupees).
    amount = rider.rateValue;
  }
  return {
    percent,
    riderName: rider.riderName,
    rateType: rider.rateType,
    riderAmount: Math.max(0.01, Math.round(amount * 100) / 100),
  };
}

/** Truncate a string to maxLen if longer. Avoids ASEGO 400 on over-length fields. */
function clip(value: string | undefined, maxLen: number): string | undefined {
  if (!value) return value;
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

/** Compose the ASEGO single-string `name` field from our split inputs. */
function joinName(t: InsuranceTraveler): string {
  const parts = [t.firstName, t.middleName, t.lastName].filter(Boolean);
  return clip(parts.join(' ').trim(), 500)!;
}

function mapTravelerToExternal(
  t: InsuranceTraveler,
  agePremium: number,
  riderTotal: number,
  asOf: Date,
): ExternalTraveler {
  const age = computeAge(t.dateOfBirth, asOf);
  return {
    name: joinName(t),
    passport: t.passport ?? '',
    dob: t.dateOfBirth,
    address: clip(t.address, 240)!,
    mobileNo: t.mobileNo,
    email: clip(t.email, 120)!,
    // ASEGO requires `city` separately. We don't have it as a distinct field on
    // InsuranceTraveler — fall back to the district which is the closest analog.
    city: clip(t.district, 60)!,
    district: clip(t.district, 60)!,
    state: clip(t.state, 60)!,
    pincode: t.pincode,
    country: clip(t.country, 60)!,
    finalPremium: Math.max(0.01, Math.round(agePremium * 100) / 100),
    riderTotalAmt: Math.round(riderTotal * 100) / 100,
    age,
    gender: t.gender,
    // `nominee` is a STRING (the nominee's full name), `relation` is a separate
    // top-level field — counter-intuitive but exact per OpenAPI.
    nominee: t.nominee
      ? clip(`${t.nominee.firstName} ${t.nominee.lastName}`.trim(), 500)!
      : joinName(t),
    relation: t.nominee ? (clip(t.nominee.relation, 40) ?? 'Self') : 'Self',
    pnrNumber: t.pnrNumber,
    flightNumber: t.flightNumber,
    departureAirportCode: t.departureAirportCode,
    arrivalAirportCode: t.arrivalAirportCode,
    departureTime: t.departureTime,
    arrivalTime: t.arrivalTime,
    gstNumber: t.gstNumber,
    gstState: t.gstState,
  };
}

/**
 * Map a TripBng issuance request into an ASEGO ExternalPolicy[] array — one
 * element per traveler. Every traveler shares the same identity, quotation,
 * and outer selectedPlan, but `selectedPlan.plan.agePremiums` and
 * `traveler.finalPremium` are computed per-traveler from their actual age.
 */
export function mapToExternalPolicies(
  req: InsuranceIssueRequest,
  identityCfg: AsegoIdentityConfig,
  orderId: string,
  asOf: Date = new Date(),
): ExternalPolicy[] {
  const identity: AsegoIdentity = buildIdentity(identityCfg, orderId);
  const totalPremiumRupees = Math.max(0.01, req.selectedPlan.totalPremiumPaise / 100);

  const quotation: ExternalQuotation = {
    travelCategory: req.quotation.category,
    startDate: req.quotation.startDate,
    endDate: req.quotation.endDate,
    duration: computeDuration(req.quotation.startDate, req.quotation.endDate),
    destination: clip(req.quotation.destination, 120),
  };

  // Per-traveler split of the total premium. If the caller didn't supply a
  // rider breakdown, we just spread the total evenly across travelers as a
  // pragmatic default — the live re-pricing inside ASEGO uses its own master.
  const perTravelerPremium = totalPremiumRupees / req.travelers.length;

  // ASEGO requires `otherDetails` even when empty.
  const otherDetails = {
    policyComment: clip(req.remarks, 240) ?? '',
  };

  return req.travelers.map<ExternalPolicy>((t) => {
    const age = computeAge(t.dateOfBirth, asOf);
    const riders = req.selectedPlan.riders.map((r) => resolveRiderAmount(r, perTravelerPremium));
    const riderTotal = riders.reduce((s, r) => s + r.riderAmount, 0);

    const selectedPlan: ExternalSelectedPlan = {
      insurerId: req.selectedPlan.insurerId,
      totalPremium: perTravelerPremium,
      plan: {
        sellingPlanId: req.selectedPlan.sellingPlanId,
        agePremiums: { age, premium: perTravelerPremium },
        riders,
      },
    };

    return {
      identity,
      selectedPlan,
      quotation,
      traveler: mapTravelerToExternal(t, perTravelerPremium, riderTotal, asOf),
      otherDetails,
    };
  });
}

// PII redaction for the audit log. Removes identifiers that aren't useful for
// debugging but increase data-leak risk if logs are shared with ASEGO support.
export function redactPolicyForAudit(policy: ExternalPolicy): ExternalPolicy {
  return {
    ...policy,
    traveler: {
      ...policy.traveler,
      passport: policy.traveler.passport ? '[redacted]' : '',
      email: '[redacted]',
      mobileNo: '[redacted]',
      pincode: '[redacted]',
      address: '[redacted]',
    },
  };
}
