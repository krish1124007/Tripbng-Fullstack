// BusInvoice — tax invoice for a confirmed bus booking.
//
// One invoice per booking when a GstProfile is attached. Bookings
// without a GstProfile skip invoice generation entirely (the agency
// can't claim ITC anyway).
//
// Invoice numbers are sequential per Indian GST rules — Counter atomic
// $inc gives us that without a separate sequence service.
//
// GST split rule (set at generation time):
//   tenant-state == bill-to-state  →  CGST (½ rate) + SGST (½ rate)
//   tenant-state != bill-to-state  →  IGST (full rate)
//
// All money fields are integer paise. GST rates are stored as
// basis-points (e.g. 1800 = 18.00%) so we can compute fractions
// without float drift.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

export const INVOICE_STATUS = ['DRAFT', 'ISSUED', 'CANCELLED'] as const;
export type BusInvoiceStatus = (typeof INVOICE_STATUS)[number];

const InvoicePartySubSchema = new Schema(
  {
    /** Legal name printed on the invoice. */
    name: { type: String, required: true },
    gstin: { type: String, required: true },
    /** PAN — sometimes printed alongside GSTIN. Optional. */
    pan: { type: String, default: '' },
    address: { type: String, required: true },
    state: { type: String, required: true },
    /** GST state code (2-digit). Used for CGST+SGST vs IGST decision. */
    stateCode: { type: String, required: true },
    email: { type: String, default: '' },
  },
  { _id: false },
);

const InvoiceLineSubSchema = new Schema(
  {
    description: { type: String, required: true },
    /** SAC code per Indian tax law. Bus operator services = 996412;
     *  TripBNG facilitation = 998551. */
    hsnSacCode: { type: String, required: true },
    /** Pre-tax amount for this line in PAISE. */
    taxableValuePaise: { type: Number, required: true, min: 0 },
    /** GST rate in basis points (1800 = 18%). 0 for tax-exempt lines. */
    gstRateBp: { type: Number, required: true, min: 0, max: 10_000 },
    /** Total GST on this line in PAISE. Pre-computed at generation
     *  so the PDF doesn't need to rerun the math. */
    gstAmountPaise: { type: Number, required: true, min: 0 },
    /** taxableValuePaise + gstAmountPaise. */
    totalPaise: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const BusInvoiceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'BusBooking', required: true, index: true },
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', required: true, index: true },
    gstProfileId: { type: Schema.Types.ObjectId, ref: 'GstProfile', required: true },

    /** Sequential invoice number. */
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    /** "DD-MM-YYYY" format on the printed PDF; persisted as Date here. */
    issueDate: { type: Date, required: true, default: () => new Date() },

    billFrom: { type: InvoicePartySubSchema, required: true },
    billTo: { type: InvoicePartySubSchema, required: true },

    lines: { type: [InvoiceLineSubSchema], required: true, validate: (v: unknown[]) => v.length >= 1 },

    /** Pre-computed totals — sum of lines. Stored to keep the PDF/JSON
     *  fast and to satisfy Indian GST rules requiring a clean trail. */
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

    status: { type: String, enum: INVOICE_STATUS, default: 'ISSUED', required: true, index: true },

    /** Reference to the booking's cancellation if the invoice was
     *  voided (status=CANCELLED). */
    cancelledByCancellationId: {
      type: Schema.Types.ObjectId,
      ref: 'BusCancellation',
      default: null,
    },
    cancelledAt: { type: Date, default: null },

    /** Track which alert pipeline run dispatched the email. Set after
     *  the alert worker confirms send. */
    emailedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One invoice per booking (the Phase 8 spec assumes single-invoice;
// re-issue on cancellation creates a new sequential number rather than
// a credit note for v1).
BusInvoiceSchema.index({ tenantId: 1, bookingId: 1 }, { unique: true });
BusInvoiceSchema.index({ tenantId: 1, agencyId: 1, issueDate: -1 });

export type BusInvoiceDoc = HydratedDocument<InferSchemaType<typeof BusInvoiceSchema>> & {
  _id: Types.ObjectId;
};
export type BusInvoiceModel = Model<InferSchemaType<typeof BusInvoiceSchema>>;
export const BusInvoice: BusInvoiceModel =
  (mongoose.models.BusInvoice as BusInvoiceModel | undefined) ??
  model<InferSchemaType<typeof BusInvoiceSchema>>('BusInvoice', BusInvoiceSchema);
