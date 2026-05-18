// Booking-lifecycle types — Book / GenerateVoucher / GetBookingDetail /
// SendChangeRequest / GetChangeRequestStatus.
//
// Loose typing — TBO's docs vary across versions, fields move between root
// and nested envelopes. The Book response in particular is a discriminated
// union over (Status, VoucherStatus, HotelBookingStatus); the mapper in
// `mappers/book.mapper.ts` narrows.

import type { TboErrorBlock, TboStatus } from './auth.js';

// ────────── Book ──────────

export interface TboBookGuest {
  Title: 'Mr' | 'Mrs' | 'Miss' | 'Ms';
  FirstName: string;
  MiddleName?: string;
  LastName: string;
  /** TBO's PaxType — 1 = Adult, 2 = Child. */
  PaxType: 1 | 2;
  Age?: number;
  LeadGuest: boolean;
  PhoneNumber?: string;
  Email?: string;
  /** Encrypted at app-layer; sent plaintext to TBO over TLS. */
  PAN?: string;
  PassportNo?: string;
  PassportIssueDate?: string;
  PassportExpDate?: string;
}

export interface TboBookRequest {
  ClientId: string;
  TokenId: string;
  EndUserIp: string;
  /** Round-tripped from Search → PreBook → Book unchanged. */
  BookingCode: string;
  /** TBO accepts a Group of guests indexed per-room via PaxType. */
  HotelRoomsDetails: Array<{
    HotelPassenger: TboBookGuest[];
  }>;
  CustomerDetails?: {
    CustomerNames?: TboBookGuest[];
  };
  /** When true → confirmed in one shot (Voucher booking). When false → held;
   *  voucher must be generated separately before lastCancellationDate. */
  IsVoucherBooking: boolean;
  /** Encryption-Key for amount in some flows; defaulting to a no-op string.
   *  Required-by-name in TBO docs even when not used. */
  EndUserIpEncryptionKey?: string;
  /** GST block. Only sent when PreBook indicated GSTAllowed=true. */
  GSTCompanyAddress?: string;
  GSTCompanyContactNumber?: string;
  GSTCompanyName?: string;
  GSTCompanyEmail?: string;
  GSTNumber?: string;
  /** Optional package-fare details (transport on arrival/departure). Only
   *  required when PreBook flagged IsPackageFare + PackageDetailsRequired. */
  PackageDetails?: {
    Arrival?: TboPackageTransport;
    Departure?: TboPackageTransport;
  };
}

export interface TboPackageTransport {
  Mode?: 'Flight' | 'Train' | 'Bus' | 'Other';
  Number?: string;
  ArrivalDate?: string;
  DepartureDate?: string;
  Time?: string;
  PNR?: string;
}

export interface TboBookResultBlock {
  /** TBO's BookingId — numeric, distinct from BookingCode. */
  BookingId?: number;
  BookingRefNo?: string;
  ConfirmationNo?: string;
  /** True when the booking is fully confirmed (voucher generated). */
  VoucherStatus?: boolean;
  /** "Confirmed" | "Pending" | "Failed" | "Hold" — string per TBO docs. */
  HotelBookingStatus?: string;
  /** Sometimes returned; sometimes only via GetBookingDetail. */
  InvoiceNumber?: string;
  /** When TBO needs the user to re-confirm (price or policy changed since
   *  PreBook). Status=3 in the envelope. */
  IsPriceChanged?: boolean;
  IsCancellationPolicyChanged?: boolean;
}

export interface TboBookResponse {
  Status: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  /** TBO's docs sometimes hoist these to root, sometimes nest. */
  BookResult?: TboBookResultBlock;
  /** Other envelope: { Hotel: { ... } } */
  Hotel?: TboBookResultBlock;
  BookingId?: number;
  BookingRefNo?: string;
  ConfirmationNo?: string;
  VoucherStatus?: boolean;
  HotelBookingStatus?: string;
  InvoiceNumber?: string;
  IsPriceChanged?: boolean;
  IsCancellationPolicyChanged?: boolean;
}

// ────────── GenerateVoucher ──────────

export interface TboVoucherRequest {
  ClientId: string;
  TokenId: string;
  EndUserIp: string;
  /** Numeric BookingId from the Book response. */
  BookingId: number;
}

export interface TboVoucherResponse {
  Status: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  VoucherStatus?: boolean;
  /** Some sandboxes return the ConfirmationNo here. */
  ConfirmationNo?: string;
  InvoiceNumber?: string;
}

// ────────── GetBookingDetail ──────────

export interface TboBookingDetailRequest {
  ClientId: string;
  TokenId: string;
  EndUserIp: string;
  /** TBO accepts BookingId XOR ConfirmationNo. We always send BookingId
   *  (saved from the Book response). */
  BookingId?: number;
  ConfirmationNo?: string;
}

export interface TboBookingDetailResponse {
  Status: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  /** Mirror of Book result + lifecycle bits. */
  BookingDetail?: TboBookResultBlock & {
    InvoiceCreatedOn?: string;
    BookingDate?: string;
    LastCancellationDate?: string;
    /** When non-empty, lists supplier-side amendments (rate change,
     *  room reassignment, …). Surface to ops. */
    Amendments?: Array<{ Status: string; Note: string; CreatedOn: string }>;
  };
  /** Hoisted variants. */
  HotelBookingStatus?: string;
  InvoiceNumber?: string;
}

// ────────── SendChangeRequest (Cancel) ──────────

export interface TboChangeRequestPayload {
  ClientId: string;
  TokenId: string;
  EndUserIp: string;
  BookingId: number;
  /** RequestType=4 = HotelCancel. Other types (date change etc.) aren't in
   *  scope for v1. */
  RequestType: 4;
  /** Free-text reason from the user / agent. Surfaced in TBO's ops queue. */
  CancellationRemarks: string;
}

export interface TboChangeRequestResponse {
  Status: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  ChangeRequestId?: number;
  ChangeRequestStatus?: number;
}

// ────────── GetChangeRequestStatus ──────────

/** TBO's status enum for change requests. We mirror it on our side as the
 *  HotelCancellationJob.changeRequestStatus string for readability. */
export const TBO_CHANGE_REQUEST_STATUS = {
  NOT_SET: 0,
  PENDING: 1,
  IN_PROGRESS: 2,
  PROCESSED: 3,
  REJECTED: 4,
} as const;
export type TboChangeRequestStatus =
  (typeof TBO_CHANGE_REQUEST_STATUS)[keyof typeof TBO_CHANGE_REQUEST_STATUS];

export interface TboChangeRequestStatusRequest {
  ClientId: string;
  TokenId: string;
  EndUserIp: string;
  ChangeRequestId: number;
}

export interface TboChangeRequestStatusResponse {
  Status: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  ChangeRequestId?: number;
  ChangeRequestStatus?: TboChangeRequestStatus;
  /** Refund amount TBO will credit. Decimal rupees. */
  RefundAmount?: number | string;
  CancellationCharge?: number | string;
  Remarks?: string;
}
