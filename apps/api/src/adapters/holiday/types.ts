// HolidaySupplierAdapter — full-lifecycle contract for holiday suppliers.
//
// Today only `MockHolidayAdapter` exists. The TBO Holidays adapter (real
// supplier) is wired as a skeleton that throws NOT_IMPLEMENTED until the
// upstream API specification arrives — same posture as the eTrav/AirIQ
// flight adapters under apps/api/src/adapters/{etrav,airiq}.
//
// Why optional methods on the contract?
//   The minimum a real supplier needs to implement is `search` — the existing
//   mock + admin-authored package flow can already book a search result via
//   the local quick-book pipeline. Real suppliers progressively add
//   priceCheck / book / cancel / fetchStatus as their integration matures.
//   Marking those optional means a partially-wired adapter can still ship
//   as "search-only" without TypeScript begging for stub throws on every
//   method we haven't built yet.
//
// Why a registry instead of a single module-level slot?
//   Multiple holiday suppliers can coexist (admin packages stay MOCK while
//   TBO syndicated packages route through the TBO adapter). The booking
//   service picks the supplier based on the package's `supplierCode`
//   discriminator — see adapters/holiday/registry.ts.

import type {
  HolidayPackage,
  HolidaySearchRequest,
} from '@tripbng/shared';

/** Closed set — every adapter declares which one it represents. The
 *  default is MOCK_HOLIDAYS for admin-authored packages; real suppliers
 *  must add a literal here AND a registry entry. */
export type HolidaySupplierCode = 'MOCK_HOLIDAYS' | 'TBO_HOLIDAYS' | 'CUSTOM';

/** Per-adapter capability flag — the booking service consults this before
 *  attempting a method that may not be wired. */
export type HolidayCapability =
  | 'SEARCH'
  | 'PRICE_CHECK'
  | 'BOOK'
  | 'CANCEL'
  | 'FETCH_STATUS';

// ─────────────────────────────────────────────────────────────────────────────
// Price check — verify a search result is still bookable + final price
// ─────────────────────────────────────────────────────────────────────────────

export interface HolidayPriceCheckRequest {
  /** Opaque token from the search result. Each adapter encodes whatever
   *  it needs (TBO uses session+package id; mock uses the package id). */
  supplierPackageToken: string;
  travellerCount: number;
  /** ISO yyyy-mm-dd — departure date. */
  travelDate: string;
}

export interface HolidayPriceCheckResponse {
  available: boolean;
  /** Final price in paise (inclusive of taxes). Caller compares to the
   *  search-time price and surfaces a price-drift modal if different. */
  totalPaise: number;
  /** Per-pax breakdown when the supplier discloses it. Optional because
   *  some suppliers only return a flat total at this stage. */
  perPaxPaise?: number;
  /** Quote validity window — caller must `book` before this expires. */
  validUntil: string; // ISO datetime
  /** Updated cancellation policy text — may differ from search-time text. */
  cancellationPolicy?: string;
  /** Supplier-side reference returned for the eventual `book` call. */
  supplierQuoteRef: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Book — commit the reservation with the supplier
// ─────────────────────────────────────────────────────────────────────────────

export interface HolidayTraveller {
  title: 'Mr' | 'Mrs' | 'Miss' | 'Ms';
  firstName: string;
  lastName: string;
  paxType: 'Adult' | 'Child';
  /** ISO yyyy-mm-dd — required when supplier mandates passport. */
  dob?: string;
  passportNumber?: string;
  passportExpiry?: string;
  nationality?: string;
}

export interface HolidayBookRequest {
  /** From the prior priceCheck response. */
  supplierQuoteRef: string;
  travellers: HolidayTraveller[];
  contact: {
    email: string;
    mobile: string;
    countryCode: string;
  };
  /** Internal booking code — passed through so supplier logs cross-reference. */
  bookingCode: string;
  /** ISO yyyy-mm-dd — travel start date. */
  travelDate: string;
  /** Optional GST input (for B2B-corporate billing). */
  gst?: {
    number: string;
    companyName: string;
    address: string;
  };
}

export interface HolidayBookResponse {
  /** Supplier-side reservation id. We persist this as
   *  `HolidayBooking.supplierBookingRef`. */
  supplierBookingRef: string;
  /** Coarse-grained state from the supplier:
   *   - CONFIRMED — booked + paid + locked-in (synchronous suppliers)
   *   - PENDING   — supplier accepted, awaiting back-office confirmation
   *                 (async suppliers — caller must poll fetchStatus)
   *   - FAILED    — supplier rejected the booking (insufficient inventory etc.)
   */
  status: 'CONFIRMED' | 'PENDING' | 'FAILED';
  /** Optional booking voucher URL provided by the supplier. */
  voucherUrl?: string;
  /** Reason — populated when status=FAILED. */
  failureReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancel
// ─────────────────────────────────────────────────────────────────────────────

export interface HolidayCancelRequest {
  supplierBookingRef: string;
  /** Reason category — propagated to the supplier's free-form note field. */
  reason: string;
}

export interface HolidayCancelResponse {
  /** Synchronous suppliers return PROCESSED with the final refund;
   *  async suppliers return PENDING and the caller polls fetchStatus. */
  status: 'PROCESSED' | 'PENDING' | 'FAILED';
  /** Refund issued by the supplier, in paise. */
  refundPaise?: number;
  /** Penalty kept by the supplier, in paise. */
  penaltyPaise?: number;
  /** Supplier-side cancellation reference (for audit + ops traceability). */
  supplierCancellationRef?: string;
  failureReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch status — polled for async suppliers
// ─────────────────────────────────────────────────────────────────────────────

export interface HolidayBookingStatus {
  supplierBookingRef: string;
  state: 'CONFIRMED' | 'PENDING' | 'CANCELLED' | 'FAILED';
  lastUpdated: string; // ISO datetime
  voucherUrl?: string;
  /** Free-form note from the supplier's back office. */
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The contract itself
// ─────────────────────────────────────────────────────────────────────────────

export interface HolidaySupplierAdapter {
  readonly code: HolidaySupplierCode;
  readonly name: string;
  readonly capabilities: readonly HolidayCapability[];

  /** Required — every adapter must search. */
  search(req: HolidaySearchRequest): Promise<HolidayPackage[]>;

  priceCheck?(req: HolidayPriceCheckRequest): Promise<HolidayPriceCheckResponse>;
  book?(req: HolidayBookRequest): Promise<HolidayBookResponse>;
  cancel?(req: HolidayCancelRequest): Promise<HolidayCancelResponse>;
  fetchStatus?(supplierBookingRef: string): Promise<HolidayBookingStatus>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors — shared error class for every holiday adapter
// ─────────────────────────────────────────────────────────────────────────────

export class HolidayAdapterError extends Error {
  constructor(
    public readonly code:
      | 'NOT_CONFIGURED'
      | 'NOT_IMPLEMENTED'
      | 'BAD_REQUEST'
      | 'NOT_FOUND'
      | 'SUPPLIER_FAILURE'
      | 'NETWORK_ERROR'
      | 'TIMEOUT',
    message: string,
    public readonly supplierCode: HolidaySupplierCode,
    public readonly gatewayCode?: string,
  ) {
    super(message);
    this.name = 'HolidayAdapterError';
  }
}
