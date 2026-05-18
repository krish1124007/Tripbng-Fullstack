// FlightInvoice — tax invoice for a confirmed flight booking.
//
// One invoice per booking when the agent supplies GST details on the
// booking form. Bookings without GST details skip invoice generation
// (the agency can't claim ITC anyway, and we don't want to over-print
// invoices the customer didn't ask for).
//
// Shape mirrors BusInvoice — same per-line schema, same CGST/SGST/IGST
// math, same audit semantics — so finance can reconcile flight + bus
// invoices through one report later.
//
// Invoice numbers are sequential (`TBNG-FINV-NNNNNN`) per Indian GST
// rules — `nextCode(CODE_PREFIX.FLIGHT_INVOICE)` gives us the atomic
// `$inc` we need.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

export const FLIGHT_INVOICE_STATUS = ['DRAFT', 'ISSUED', 'CANCELLED'] as const;
export type FlightInvoiceStatus = (typeof FLIGHT_INVOICE_STATUS)[number];

const InvoicePartySubSchema = new Schema(
  {
    /** Legal name printed on the invoice. */
    name: { type: String, required: true },
    gstin: { type: String, required: true },
    /** PAN — sometimes printed alongside GSTIN. Optional. */
    pan: { type: String, default: '' },
    address: { type: String, required: true },
    state: { type: String, required: true },
    /** GST state code (2-digit) — first 2 chars of the GSTIN. */
    stateCode: { type: String, required: true },
    email: { type: String, default: '' },
  },
  { _id: false },
);

const InvoiceLineSubSchema = new Schema(
  {
    description: { type: String, required: true },
    /** SAC code per Indian tax law.
     *  - 996425 = Passenger transport by air (domestic)
     *  - 998551 = Travel arrangement / tour operator services (TripBng facilitation fee) */
    hsnSacCode: { type: String, required: true },
    /** Pre-tax amount for this line in PAISE. */
    taxableValuePaise: { type: Number, required: true, min: 0 },
    /** GST rate in basis points (1800 = 18%). Air-passenger transport
     *  is 5% (500 bp) for economy, 12% (1200 bp) for business / first.
     *  Tour-operator facilitation is 18% (1800 bp). */
    gstRateBp: { type: Number, required: true, min: 0, max: 10_000 },
    /** Total GST on this line in PAISE. Pre-computed at generation
     *  so the PDF doesn't need to rerun the math. */
    gstAmountPaise: { type: Number, required: true, min: 0 },
    /** taxableValuePaise + gstAmountPaise. */
    totalPaise: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const FlightInvoiceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', required: true, index: true },

    /** Sequential invoice number. */
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    issueDate: { type: Date, required: true, default: () => new Date() },

    billFrom: { type: InvoicePartySubSchema, required: true },
    billTo: { type: InvoicePartySubSchema, required: true },

    lines: {
      type: [InvoiceLineSubSchema],
      required: true,
      validate: (v: unknown[]) => v.length >= 1,
    },

    /** Pre-computed totals — sum of lines. */
    subtotalPaise: { type: Number, required: true, min: 0 },
    cgstPaise: { type: Number, default: 0, min: 0 },
    sgstPaise: { type: Number, default: 0, min: 0 },
    igstPaise: { type: Number, default: 0, min: 0 },
    /** subtotalPaise + cgst + sgst + igst. */
    totalPaise: { type: Number, required: true, min: 0 },

    /** "INTRA_STATE" → CGST+SGST, "INTER_STATE" → IGST. */
    gstSplitKind: {
      type: String,
      enum: ['INTRA_STATE', 'INTER_STATE'],
      required: true,
    },

    status: {
      type: String,
      enum: FLIGHT_INVOICE_STATUS,
      default: 'ISSUED',
      required: true,
      index: true,
    },

    /** Set when the booking is cancelled and the invoice was voided. */
    cancelledAt: { type: Date, default: null },

    /** Set after the alert worker confirms email delivery. */
    emailedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One invoice per booking — re-issue on cancellation creates a new
// sequential number rather than a credit note for v1.
FlightInvoiceSchema.index({ tenantId: 1, bookingId: 1 }, { unique: true });
FlightInvoiceSchema.index({ tenantId: 1, agencyId: 1, issueDate: -1 });

export type FlightInvoiceDoc = HydratedDocument<
  InferSchemaType<typeof FlightInvoiceSchema>
> & {
  _id: Types.ObjectId;
};
export type FlightInvoiceModel = Model<InferSchemaType<typeof FlightInvoiceSchema>>;
// Guard against double-registration (vitest module-isolation under vi.mock).
export const FlightInvoice: FlightInvoiceModel =
  (mongoose.models.FlightInvoice as FlightInvoiceModel | undefined) ??
  model<InferSchemaType<typeof FlightInvoiceSchema>>('FlightInvoice', FlightInvoiceSchema);
