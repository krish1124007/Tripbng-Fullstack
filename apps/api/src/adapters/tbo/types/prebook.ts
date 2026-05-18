// TBO PreBook request + response shapes.
//
// PreBook re-validates a search result and returns:
//   - the (possibly updated) total
//   - the supplier rules driving our dynamic guest form (PanRequired,
//     PassportRequired, GSTAllowed, NameMin/Max length, SameNameAllowed,
//     SpecialCharAllowed, IsPackageFare, PackageDetailsRequired)
//   - tax breakup for the GST invoice
//   - cancellation policies that may have shifted since search
//
// PreBook is mandatory before Book per TBO certification.

import type { TboErrorBlock, TboStatus } from './auth.js';
import type { TboCancellationPolicy } from './search.js';

export interface TboPreBookRequest {
  ClientId: string;
  TokenId: string;
  EndUserIp: string;
  /** BookingCode from the Search response. Round-trips to Book. */
  BookingCode: string;
  /** When true, requests a more detailed price breakup. */
  PaymentMode?: 'Limit' | 'NewCard' | 'SavedCard';
}

export interface TboTaxLine {
  /** TBO returns labels like 'CGST', 'SGST', 'IGST', 'TCS', 'TDS', or
   *  generic strings. The mapper coerces to our TaxLine.taxType. */
  TaxType?: string;
  TaxableAmount?: number | string;
  TaxPercentage?: number | string;
  TaxAmount?: number | string;
}

/** Top-level rule flags surfaced by PreBook — drive the guest form
 *  presentation on the frontend. We default them conservatively in the
 *  mapper when TBO omits a field. */
export interface TboPreBookRules {
  PanMandatory?: boolean;
  PanRequired?: boolean;
  PassportMandatory?: boolean;
  PassportRequired?: boolean;
  GSTAllowed?: boolean;
  IsGSTRequired?: boolean;
  SameNameAllowed?: boolean;
  SpecialCharAllowed?: boolean;
  NameMinLength?: number;
  NameMaxLength?: number;
  NamesMinLength?: number;
  NamesMaxLength?: number;
  IsPackageFare?: boolean;
  PackageDetailsRequired?: boolean;
}

export interface TboPreBookHotelRoom {
  BookingCode: string;
  Name?: string | string[];
  Inclusion?: string;
  IsRefundable?: boolean;
  MealType?: string;
  TotalFare?: number | string;
  TotalTax?: number | string;
  RecommendedSellingRate?: number | string;
  CancellationPolicies?: TboCancellationPolicy[];
  TaxBreakup?: TboTaxLine[];
}

export interface TboPreBookHotel {
  HotelCode?: string;
  HotelName?: string;
  StarRating?: number | string;
  HotelAddress?: string;
  Currency?: string;
  Rooms?: TboPreBookHotelRoom[];
  /** Some docs versions hoist taxes to the hotel level. */
  TaxBreakup?: TboTaxLine[];
}

export interface TboPreBookResult {
  HotelResult?: TboPreBookHotel | TboPreBookHotel[];
  Hotel?: TboPreBookHotel;
  /** When TBO repeats the BookingCode at the result level. */
  BookingCode?: string;
  /** Last day cancellation can be requested without forfeit. */
  LastCancellationDate?: string;
  IsPriceChanged?: boolean;
  IsCancellationPolicyChanged?: boolean;
}

export interface TboPreBookResponse extends TboPreBookRules {
  Status: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  PreBookResult?: TboPreBookResult;
  HotelResult?: TboPreBookHotel | TboPreBookHotel[];
  /** Top-level fallback when TBO inlines the hotel. */
  Hotel?: TboPreBookHotel;
  IsPriceChanged?: boolean;
  IsCancellationPolicyChanged?: boolean;
  LastCancellationDate?: string;
}
