// SavedPassenger schemas — per-agency passenger directory.
//
// Agents save customers they book regularly so the booking form can
// auto-fill title / name / DOB / passport with one click instead of
// re-typing every trip. Scope is per-agency (the whole team shares
// the directory) with a `createdBy` audit trail.

import { z } from 'zod';
import { PAX_TYPE } from '../enums.js';

const TitleSchema = z.enum(['MR', 'MRS', 'MS', 'MSTR', 'MISS']);

const PassportSchema = z.object({
  number: z.string().min(4).max(20),
  expiry: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  issuingCountry: z.string().length(2),
});

export const SavedPassengerCreateSchema = z.object({
  type: z.enum(PAX_TYPE),
  title: TitleSchema,
  firstName: z.string().min(1).max(60).trim(),
  lastName: z.string().min(1).max(60).trim(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
  gender: z.enum(['M', 'F']).optional(),
  nationality: z.string().length(2).optional(),
  passport: PassportSchema.optional(),
  email: z.string().email().max(120).optional().or(z.literal('').transform(() => undefined)),
  phone: z.string().max(20).optional(),
});
export type SavedPassengerCreate = z.infer<typeof SavedPassengerCreateSchema>;

export const SavedPassengerUpdateSchema = SavedPassengerCreateSchema.partial();
export type SavedPassengerUpdate = z.infer<typeof SavedPassengerUpdateSchema>;

export const PublicSavedPassengerSchema = z.object({
  id: z.string(),
  type: z.enum(PAX_TYPE),
  title: TitleSchema,
  firstName: z.string(),
  lastName: z.string(),
  /** YYYY-MM-DD string, omitted when unset. */
  dateOfBirth: z.string().nullable(),
  gender: z.enum(['M', 'F']).nullable(),
  nationality: z.string().nullable(),
  passport: PassportSchema.nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicSavedPassenger = z.infer<typeof PublicSavedPassengerSchema>;

export const SavedPassengerListResponseSchema = z.object({
  items: z.array(PublicSavedPassengerSchema),
  total: z.number().int().nonnegative(),
});
export type SavedPassengerListResponse = z.infer<typeof SavedPassengerListResponseSchema>;
