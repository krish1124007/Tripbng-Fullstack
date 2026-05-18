// TBO Book / GetBookingDetail response → discriminated lifecycle outcome.
//
// The Book endpoint returns one of four states crammed into a flat envelope.
// Rather than make every caller match on the (Status, VoucherStatus,
// HotelBookingStatus) triple, we narrow once at the adapter boundary and
// expose a tagged union.
//
// Same machinery powers GetBookingDetail's polling response — they share
// the result block shape.

import type {
  TboBookResponse,
  TboBookResultBlock,
  TboBookingDetailResponse,
} from '../types/lifecycle.js';

export type BookOutcome =
  | { kind: 'confirmed'; refs: BookingRefs }
  | { kind: 'held'; refs: BookingRefs }
  | { kind: 'pending'; refs: BookingRefs }
  | {
      kind: 'verify_price';
      refs: BookingRefs;
      isPriceChanged: boolean;
      isCancellationPolicyChanged: boolean;
    }
  | { kind: 'failed'; error: { code: string; message: string } };

export interface BookingRefs {
  bookingId: number | null;
  bookingRefNo: string | null;
  confirmationNo: string | null;
  invoiceNumber: string | null;
  hotelBookingStatus: string | null;
}

/** Translate a Book response into the four-way outcome the service uses
 *  to drive state transitions. */
export function mapBookResponse(res: TboBookResponse): BookOutcome {
  // Status=2/5 outright failure — surface the message and stop.
  if (res.Status !== 1) {
    return {
      kind: 'failed',
      error: {
        code: `STATUS_${res.Status}`,
        message: res.Error?.ErrorMessage ?? 'TBO Book returned non-success status',
      },
    };
  }

  const block = unwrapResult(res);
  const refs = extractRefs(block, res);
  const status = (block?.HotelBookingStatus ?? res.HotelBookingStatus ?? '').toLowerCase();

  // VerifyPrice — TBO docs use Status=3 in some responses, but newer ones
  // signal it via IsPriceChanged on a Status=1 reply. Honor both.
  if (block?.IsPriceChanged === true || res.IsPriceChanged === true) {
    return {
      kind: 'verify_price',
      refs,
      isPriceChanged: true,
      isCancellationPolicyChanged:
        block?.IsCancellationPolicyChanged === true || res.IsCancellationPolicyChanged === true,
    };
  }

  if (status === 'pending') {
    return { kind: 'pending', refs };
  }

  // Confirmed paths — TBO's terminology: VoucherStatus=true means the
  // booking is fully confirmed in one shot. VoucherStatus=false means the
  // supplier accepted the hold but voucher must be generated separately.
  const voucherStatus = block?.VoucherStatus ?? res.VoucherStatus;
  if (voucherStatus === true) return { kind: 'confirmed', refs };
  if (voucherStatus === false) return { kind: 'held', refs };

  // Confirmed-without-voucher-flag — treat as confirmed if status string says so.
  if (status === 'confirmed' || status === 'booked') return { kind: 'confirmed', refs };

  // Anything else: surface as failure for safety.
  return {
    kind: 'failed',
    error: {
      code: 'UNRECOGNIZED_STATE',
      message: `unrecognised TBO Book state (Status=${res.Status}, HotelBookingStatus=${status}, VoucherStatus=${voucherStatus})`,
    },
  };
}

/** Same shape for GetBookingDetail polling. The booking-poller worker
 *  consumes this directly. */
export function mapBookingDetailResponse(res: TboBookingDetailResponse): BookOutcome {
  if (res.Status !== 1) {
    return {
      kind: 'failed',
      error: {
        code: `STATUS_${res.Status}`,
        message: res.Error?.ErrorMessage ?? 'GetBookingDetail returned non-success status',
      },
    };
  }
  const block = res.BookingDetail;
  const refs: BookingRefs = {
    bookingId: block?.BookingId ?? null,
    bookingRefNo: block?.BookingRefNo ?? null,
    confirmationNo: block?.ConfirmationNo ?? null,
    invoiceNumber: block?.InvoiceNumber ?? res.InvoiceNumber ?? null,
    hotelBookingStatus: block?.HotelBookingStatus ?? res.HotelBookingStatus ?? null,
  };
  const status = (block?.HotelBookingStatus ?? res.HotelBookingStatus ?? '').toLowerCase();
  if (status === 'pending') return { kind: 'pending', refs };
  if (block?.VoucherStatus === true) return { kind: 'confirmed', refs };
  if (block?.VoucherStatus === false) return { kind: 'held', refs };
  if (status === 'confirmed' || status === 'booked') return { kind: 'confirmed', refs };
  if (status === 'cancelled') {
    return { kind: 'failed', error: { code: 'SUPPLIER_CANCELLED', message: 'booking cancelled at supplier' } };
  }
  if (status === 'failed') {
    return { kind: 'failed', error: { code: 'SUPPLIER_FAILED', message: 'booking failed at supplier' } };
  }
  return { kind: 'pending', refs };
}

function unwrapResult(res: TboBookResponse): TboBookResultBlock | null {
  return res.BookResult ?? res.Hotel ?? null;
}

function extractRefs(block: TboBookResultBlock | null, res: TboBookResponse): BookingRefs {
  return {
    bookingId: block?.BookingId ?? res.BookingId ?? null,
    bookingRefNo: block?.BookingRefNo ?? res.BookingRefNo ?? null,
    confirmationNo: block?.ConfirmationNo ?? res.ConfirmationNo ?? null,
    invoiceNumber: block?.InvoiceNumber ?? res.InvoiceNumber ?? null,
    hotelBookingStatus: block?.HotelBookingStatus ?? res.HotelBookingStatus ?? null,
  };
}
