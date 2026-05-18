// TBO PreBook response → enriched HotelOffer + supplier rules.
//
// Two responsibilities:
//   1. Re-compute the offer's pricing from PreBook's room totals + tax
//      breakup (the source-of-truth post-validation).
//   2. Lift TBO's rule flags (PanMandatory, PassportMandatory, GSTAllowed,
//      …) to our offer.rules block so the frontend can render the dynamic
//      guest form against a single shape.

import type { HotelOffer, TaxLine } from '@tripbng/shared';
import { toNumberOrNull, trimOrNull } from '../parsers.js';
import type {
  TboPreBookHotel,
  TboPreBookHotelRoom,
  TboPreBookResponse,
  TboPreBookRules,
  TboTaxLine,
} from '../types/prebook.js';

export interface MappedPreBookResult {
  offer: HotelOffer;
  /** True when PreBook returned a different total than the search-time offer. */
  priceChanged: boolean;
  /** True when supplier policies shifted between Search and PreBook. */
  cancellationPolicyChanged: boolean;
  lastCancellationDate: string | null;
}

/**
 * Take the search-time HotelOffer and the PreBook response, return a fresh
 * HotelOffer with PreBook's authoritative price + rules merged in.
 *
 * We require the search-time offer because PreBook's response is sparse —
 * it doesn't re-state hotel images / amenities / address. Treat search as
 * the static-data source-of-truth and PreBook as the price/rules overlay.
 */
export function mergePreBookIntoOffer(
  searchOffer: HotelOffer,
  response: TboPreBookResponse,
): MappedPreBookResult {
  const hotel = unwrapPreBookHotel(response);
  const room = hotel?.Rooms?.[0] ?? null;

  // ───── Price ─────
  const newTotalFare = decimalToPaise(room?.TotalFare);
  const newTotalTax = decimalToPaise(room?.TotalTax);
  const newSellingPaise = newTotalFare + newTotalTax;
  const priceChanged =
    newSellingPaise > 0 && Math.abs(newSellingPaise - searchOffer.pricing.totalSellingPaise) > 100;

  // ───── Tax breakup ─────
  const taxes = mapTaxBreakup(room?.TaxBreakup ?? hotel?.TaxBreakup);

  // ───── Cancellation policies ─────
  const cancellation = (room?.CancellationPolicies ?? []).map((p) => ({
    fromDate: trimOrNull(p.FromDate) ?? new Date().toISOString(),
    chargeType: p.ChargeType === 'FixedAmount' ? ('FixedAmount' as const) : ('Percentage' as const),
    charge: toNumberOrNull(p.CancellationCharge) ?? 0,
  }));
  const cancellationPolicyChanged = !!response.IsCancellationPolicyChanged;
  const lastCancellationDate =
    trimOrNull(response.LastCancellationDate) ??
    trimOrNull(response.PreBookResult?.LastCancellationDate) ??
    null;

  // ───── Rules — TBO docs use slightly different keys per version. ─────
  const rules = mergeRules(searchOffer.rules, response);

  // ───── Build the final offer ─────
  const updatedOffer: HotelOffer = {
    ...searchOffer,
    rooms: searchOffer.rooms.map((r, idx) => {
      // Only the first room has its price recomputed below (TBO returns
      // single-room PreBook). Multi-room scenarios: each room PreBooks
      // separately at our service layer.
      if (idx !== 0 || newSellingPaise === 0) return r;
      return {
        ...r,
        totalNetPaise: newTotalFare,
        totalSellingPaise: newSellingPaise,
        isRefundable: room?.IsRefundable === true ? true : r.isRefundable,
        inclusions: trimOrNull(room?.Inclusion) ?? r.inclusions,
      };
    }),
    pricing: {
      ...searchOffer.pricing,
      // If PreBook returned a non-zero total, take it; otherwise keep search.
      totalNetPaise: newSellingPaise > 0 ? newTotalFare : searchOffer.pricing.totalNetPaise,
      totalSellingPaise:
        newSellingPaise > 0 ? newSellingPaise : searchOffer.pricing.totalSellingPaise,
      perNightPaise:
        newSellingPaise > 0 && searchOffer.pricing.perNightPaise > 0
          ? Math.round(
              newSellingPaise *
                (searchOffer.pricing.perNightPaise / searchOffer.pricing.totalSellingPaise),
            )
          : searchOffer.pricing.perNightPaise,
      taxes,
    },
    policies: {
      ...searchOffer.policies,
      cancellation: cancellation.length > 0 ? cancellation : searchOffer.policies.cancellation,
      lastCancellationDate,
      isRefundable:
        cancellation.length > 0
          ? !cancellation.some((c) => c.charge >= 100 && c.chargeType === 'Percentage')
          : searchOffer.policies.isRefundable,
    },
    rules,
  };

  return {
    offer: updatedOffer,
    priceChanged,
    cancellationPolicyChanged,
    lastCancellationDate,
  };
}

/** Pull the hotel block out of any of the known PreBook envelope shapes. */
function unwrapPreBookHotel(response: TboPreBookResponse): TboPreBookHotel | null {
  const candidates: Array<TboPreBookHotel | TboPreBookHotel[] | undefined> = [
    response.PreBookResult?.Hotel,
    response.PreBookResult?.HotelResult,
    response.HotelResult,
    response.Hotel,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (Array.isArray(c)) return c[0] ?? null;
    return c;
  }
  return null;
}

function mapTaxBreakup(raw: TboTaxLine[] | undefined): TaxLine[] {
  if (!Array.isArray(raw)) return [];
  const out: TaxLine[] = [];
  for (const line of raw) {
    const taxAmount = decimalToPaise(line.TaxAmount);
    if (taxAmount <= 0) continue; // skip zero-rated lines for cleaner UI
    out.push({
      taxType: normaliseTaxType(line.TaxType),
      taxableAmountPaise: decimalToPaise(line.TaxableAmount),
      taxPercentage: toNumberOrNull(line.TaxPercentage) ?? 0,
      taxAmountPaise: taxAmount,
    });
  }
  return out;
}

function normaliseTaxType(raw: string | undefined): TaxLine['taxType'] {
  if (!raw) return 'OTHER';
  const normalized = raw.replace(/\s|_/g, '').toUpperCase();
  if (normalized === 'CGST' || normalized === 'SGST' || normalized === 'IGST') return normalized;
  if (normalized === 'TCS') return 'TCS';
  if (normalized === 'TDS') return 'TDS';
  return 'OTHER';
}

/** Merge TBO's rule-flag fields into the offer rules slot. TBO uses
 *  inconsistent keys across docs versions; we accept any of the common
 *  variants. */
function mergeRules(
  searchRules: HotelOffer['rules'],
  response: TboPreBookResponse,
): HotelOffer['rules'] {
  const flags: TboPreBookRules = response;
  const room = unwrapPreBookHotel(response)?.Rooms?.[0] ?? {};
  const all = { ...flags, ...(room as TboPreBookHotelRoom & TboPreBookRules) };

  return {
    panRequired: all.PanMandatory === true || all.PanRequired === true,
    passportRequired: all.PassportMandatory === true || all.PassportRequired === true,
    gstAllowed: all.GSTAllowed === true || all.IsGSTRequired === true,
    sameNameAllowed: all.SameNameAllowed !== false, // default-allow
    specialCharAllowed: all.SpecialCharAllowed === true,
    nameMinLength:
      toNumberOrNull(all.NameMinLength ?? all.NamesMinLength) ?? searchRules.nameMinLength,
    nameMaxLength:
      toNumberOrNull(all.NameMaxLength ?? all.NamesMaxLength) ?? searchRules.nameMaxLength,
    isPackageFare: all.IsPackageFare === true || searchRules.isPackageFare,
    packageDetailsRequired: all.PackageDetailsRequired === true,
  };
}

function decimalToPaise(v: unknown): number {
  const n = toNumberOrNull(v);
  if (n === null) return 0;
  return Math.max(0, Math.round(n * 100));
}
