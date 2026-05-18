// GstProfile API schemas — admin CRUD shapes.
//
// One tenant can have multiple profiles (multi-state). The booking
// flow attaches one profile per booking (gstProfileId on BusBooking).

import { z } from 'zod';
import { GstinSchema, EmailSchema } from './common.js';

export const GstProfileCreateSchema = z.object({
  registrationName: z.string().min(2).max(120),
  gstin: GstinSchema,
  address: z.string().min(5).max(300),
  state: z.string().min(2).max(60),
  email: EmailSchema,
  isDefault: z.boolean().optional(),
});
export type GstProfileCreate = z.infer<typeof GstProfileCreateSchema>;

export const GstProfileUpdateSchema = GstProfileCreateSchema.partial();
export type GstProfileUpdate = z.infer<typeof GstProfileUpdateSchema>;

export const PublicGstProfileSchema = z.object({
  id: z.string(),
  registrationName: z.string(),
  gstin: z.string(),
  address: z.string(),
  state: z.string(),
  email: z.string(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicGstProfile = z.infer<typeof PublicGstProfileSchema>;

export const GstProfileListResponseSchema = z.object({
  items: z.array(PublicGstProfileSchema),
  total: z.number().int().nonnegative(),
});
export type GstProfileListResponse = z.infer<typeof GstProfileListResponseSchema>;

// ────────── Invoice public response ──────────

export const InvoicePartySchema = z.object({
  name: z.string(),
  gstin: z.string(),
  pan: z.string().optional(),
  address: z.string(),
  state: z.string(),
  stateCode: z.string(),
  email: z.string().optional(),
});
export type InvoiceParty = z.infer<typeof InvoicePartySchema>;

export const InvoiceLineSchema = z.object({
  description: z.string(),
  hsnSacCode: z.string(),
  taxableValuePaise: z.number().int().nonnegative(),
  gstRateBp: z.number().int().nonnegative(),
  gstAmountPaise: z.number().int().nonnegative(),
  totalPaise: z.number().int().nonnegative(),
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const PublicBusInvoiceSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  bookingId: z.string(),
  agencyId: z.string(),
  gstProfileId: z.string(),
  issueDate: z.string(),
  billFrom: InvoicePartySchema,
  billTo: InvoicePartySchema,
  lines: z.array(InvoiceLineSchema),
  subtotalPaise: z.number().int().nonnegative(),
  cgstPaise: z.number().int().nonnegative(),
  sgstPaise: z.number().int().nonnegative(),
  igstPaise: z.number().int().nonnegative(),
  totalPaise: z.number().int().nonnegative(),
  gstSplitKind: z.enum(['INTRA_STATE', 'INTER_STATE']),
  status: z.enum(['DRAFT', 'ISSUED', 'CANCELLED']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicBusInvoice = z.infer<typeof PublicBusInvoiceSchema>;
