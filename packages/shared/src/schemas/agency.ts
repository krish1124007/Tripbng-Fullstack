import { z } from 'zod';
import { AGENCY_STATUS } from '../enums.js';
import {
  EmailSchema,
  GstinSchema,
  MobileSchema,
  ObjectIdSchema,
  PanSchema,
  PasswordSchema,
} from './common.js';

export const CreateAgencyRequestSchema = z.object({
  companyName: z.string().min(2).max(200),
  legalName: z.string().min(2).max(200).optional(),
  country: z.string().default('IN'),
  state: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  pincode: z.string().min(3).max(10),
  address: z.string().min(3).max(500),
  distributorId: ObjectIdSchema.optional(),
  pan: z
    .object({
      number: PanSchema,
      name: z.string().min(2),
    })
    .optional(),
  gst: z
    .object({
      number: GstinSchema,
    })
    .optional(),
  // Owner user — created together with the agency
  owner: z.object({
    email: EmailSchema,
    mobile: MobileSchema,
    fullName: z.string().min(2),
    password: PasswordSchema,
  }),
});
export type CreateAgencyRequest = z.infer<typeof CreateAgencyRequestSchema>;

export const UpdateAgencyRequestSchema = z.object({
  companyName: z.string().min(2).max(200).optional(),
  legalName: z.string().min(2).max(200).optional(),
  state: z.string().min(1).max(100).optional(),
  city: z.string().min(1).max(100).optional(),
  pincode: z.string().min(3).max(10).optional(),
  address: z.string().min(3).max(500).optional(),
  status: z.enum(AGENCY_STATUS).optional(),
  blockedReason: z.string().max(500).optional(),
  creditLimit: z.number().int().min(0).optional(),
  managementFee: z.number().min(0).optional(),
  manageMarkup: z.number().min(0).optional(),
});
export type UpdateAgencyRequest = z.infer<typeof UpdateAgencyRequestSchema>;

export const PublicAgencySchema = z.object({
  id: z.string(),
  agencyCode: z.string(),
  companyName: z.string(),
  legalName: z.string().nullable(),
  country: z.string(),
  state: z.string(),
  city: z.string(),
  pincode: z.string(),
  address: z.string(),
  distributorId: z.string().nullable(),
  walletBalance: z.number(),
  creditLimit: z.number(),
  outstandingAmount: z.number(),
  status: z.enum(AGENCY_STATUS),
  ownerUserId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicAgency = z.infer<typeof PublicAgencySchema>;
