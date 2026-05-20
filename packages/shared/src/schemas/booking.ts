import { z } from 'zod';
import { BOOKING_STATUS, PAX_TYPE, TRAVEL_CLASS } from '../enums.js';
import { GstinSchema, MobileSchema, EmailSchema } from './common.js';
import {
  PassengerInputSchema,
  ResultSegmentSchema,
  FareBreakdownSchema,
  SsrSelectionsSchema,
} from './search.js';

export const HoldRequestSchema = z.object({
  searchId: z.string().min(1),
  fareToken: z.string().min(1),
  passengers: z.array(PassengerInputSchema).min(1).max(9),
  contact: z.object({
    email: EmailSchema,
    mobile: MobileSchema,
    countryCode: z.string().default('+91'),
  }),
  gst: z
    .object({
      number: GstinSchema,
      companyName: z.string().min(2),
      address: z.string().min(2),
    })
    .optional(),
  /** Optional SSR add-ons (meals/baggage/seats) selected by the agent on
   *  the booking form. Forwarded to the supplier adapter — TBO/Air sends
   *  them in Book (GDS) or Ticket (LCC). Suppliers that don't support SSR
   *  ignore the field. */
  ssrSelections: SsrSelectionsSchema.optional(),
  internalNotes: z.string().max(500).optional(),
});
export type HoldRequest = z.infer<typeof HoldRequestSchema>;

export const ConfirmBookingRequestSchema = z.object({
  bookingId: z.string().regex(/^[a-fA-F0-9]{24}$/),
  paymentMode: z.enum(['WALLET', 'CREDIT']).default('WALLET'),
  acceptTerms: z.boolean().default(true),
});

/**
 * Manual refund — admin / accounts override that credits the agency
 * wallet outside the auto-refund path (which runs only on cancel /
 * ticket-failure). Used for goodwill credits, support escalations,
 * post-hoc compensation, etc.
 *
 * Amount caps at the booking's `agencyPayablePaise` so a SUPER_ADMIN
 * can't accidentally over-refund. Reason is mandatory (audit trail).
 */
export const ManualRefundRequestSchema = z.object({
  amountPaise: z.number().int().positive(),
  reason: z.string().trim().min(10, 'Provide at least a one-sentence reason').max(500),
});
export type ManualRefundRequest = z.infer<typeof ManualRefundRequestSchema>;
export type ConfirmBookingRequest = z.infer<typeof ConfirmBookingRequestSchema>;

export const CancelBookingRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type CancelBookingRequest = z.infer<typeof CancelBookingRequestSchema>;

/**
 * Issue a manually-routed booking — Phase 5. After ops issues the ticket
 * out-of-band (another GDS, phone call, e-mail), this endpoint stamps the
 * PNR + supplier reference + ticket numbers onto the booking row and
 * transitions PENDING_MANUAL → TICKETED. The wallet has already been
 * debited at confirm-time so no money moves here.
 *
 * `supplierBookingRef` is the supplier-side reference (e.g. PCC/file
 * number on a GDS) used to look the booking up if cancellation goes
 * through the supplier API later. Optional but strongly recommended.
 */
export const IssueManuallyRequestSchema = z.object({
  pnr: z.string().trim().min(1).max(20),
  ticketNumbers: z.array(z.string().trim().min(1).max(40)).min(1).max(50),
  supplierBookingRef: z.string().trim().min(1).max(80).optional(),
  note: z.string().trim().max(500).optional(),
});
export type IssueManuallyRequest = z.infer<typeof IssueManuallyRequestSchema>;

export const PublicBookingPassengerSchema = z.object({
  type: z.enum(PAX_TYPE),
  title: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  ticketNumber: z.string().nullable(),
  fareCategory: z.string(),
});
export type PublicBookingPassenger = z.infer<typeof PublicBookingPassengerSchema>;

export const PublicBookingSchema = z.object({
  id: z.string(),
  bookingCode: z.string(),
  status: z.enum(BOOKING_STATUS),
  channel: z.enum(['ONLINE', 'OFFLINE', 'API']),
  // Product discriminator. Flight bookings default to 'FLIGHT' for
  // back-compat — older serializers that don't set it explicitly still
  // parse cleanly. Hotel/Holiday rows (served from /api/v1/bookings via
  // their respective merge adapters) carry 'HOTEL' / 'HOLIDAY' so the
  // web UI can swap itinerary cards for product-specific layouts and
  // re-label PNR → Confirmation.
  productType: z.enum(['FLIGHT', 'HOTEL', 'HOLIDAY', 'VISA', 'BUS']).default('FLIGHT'),
  // Flight-side flow tag (LCC / FSC / etc) — for non-flight rows we
  // surface the product name as a backup discriminator before
  // productType was added.
  flowSubType: z.enum([
    'SERIES',
    'LCC',
    'FSC',
    'HOLD',
    'TICKET',
    'HOTEL',
    'HOLIDAY',
    'VISA',
    'BUS',
  ]),

  pnr: z.string().nullable(),
  airlinePnr: z.string().nullable(),
  ticketNumbers: z.array(z.string()),

  agencyId: z.string(),
  agencyCode: z.string(),
  agencyName: z.string(),
  distributorId: z.string().nullable(),
  bookedByUserId: z.string(),

  sector: z.string(),
  travelDate: z.string().datetime(),
  returnDate: z.string().datetime().nullable(),
  tripType: z.enum(['ONEWAY', 'ROUNDTRIP', 'MULTICITY']),
  travelClass: z.enum(TRAVEL_CLASS),

  segments: z.array(ResultSegmentSchema),
  passengers: z.array(PublicBookingPassengerSchema),
  contact: z.object({
    email: z.string(),
    mobile: z.string(),
    countryCode: z.string(),
  }),
  gst: z
    .object({
      number: z.string(),
      companyName: z.string(),
      address: z.string(),
    })
    .nullable(),

  pricing: FareBreakdownSchema,
  pricingTrace: z
    .array(
      z.object({
        step: z.string(),
        ruleId: z.string().optional(),
        ruleName: z.string().optional(),
        beforePaise: z.number(),
        afterPaise: z.number(),
        deltaPaise: z.number(),
        notes: z.string().optional(),
      }),
    )
    .optional(),

  paymentMode: z.string().nullable(),
  paymentStatus: z.enum(['PENDING', 'PAID', 'PARTIAL', 'REFUNDED', 'FAILED']),

  initiatedAt: z.string().datetime().nullable(),
  heldAt: z.string().datetime().nullable(),
  ticketedAt: z.string().datetime().nullable(),
  /** ISO timestamp until which a TICKETED booking can be cancelled
   *  at zero fee (the airline-industry "void window"). The booking
   *  page and the bookings list UI show a "Free void · Xh Ym left"
   *  chip while this timestamp is in the future. Null when the
   *  booking isn't TICKETED or the platform's window is disabled. */
  voidWindowEndsAt: z.string().datetime().nullable().optional(),
  cancelledAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  refundedAt: z.string().datetime().nullable(),

  internalNotes: z.string().nullable(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicBooking = z.infer<typeof PublicBookingSchema>;

export const BookingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(BOOKING_STATUS).optional(),
  q: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type BookingListQuery = z.infer<typeof BookingListQuerySchema>;
