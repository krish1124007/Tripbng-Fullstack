import { z } from 'zod';
import { AGENCY_STATUS } from '../enums.js';
import { EmailSchema, MobileSchema, PanSchema, PasswordSchema } from './common.js';

export const CreateDistributorRequestSchema = z.object({
  companyName: z.string().min(2).max(200),
  legalName: z.string().min(2).max(200).optional(),
  country: z.string().default('IN'),
  state: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  pincode: z.string().min(3).max(10),
  address: z.string().min(3).max(500),
  pan: z
    .object({
      number: PanSchema,
      name: z.string().min(2),
    })
    .optional(),
  overrideCommissionPercent: z.number().min(0).max(100).default(0),
  owner: z.object({
    email: EmailSchema,
    mobile: MobileSchema,
    fullName: z.string().min(2),
    password: PasswordSchema,
  }),
});
export type CreateDistributorRequest = z.infer<typeof CreateDistributorRequestSchema>;

export const UpdateDistributorRequestSchema = z.object({
  companyName: z.string().min(2).max(200).optional(),
  legalName: z.string().min(2).max(200).optional(),
  state: z.string().min(1).max(100).optional(),
  city: z.string().min(1).max(100).optional(),
  pincode: z.string().min(3).max(10).optional(),
  address: z.string().min(3).max(500).optional(),
  status: z.enum(AGENCY_STATUS).optional(),
  overrideCommissionPercent: z.number().min(0).max(100).optional(),
});
export type UpdateDistributorRequest = z.infer<typeof UpdateDistributorRequestSchema>;

export const PublicDistributorSchema = z.object({
  id: z.string(),
  distributorCode: z.string(),
  companyName: z.string(),
  legalName: z.string().nullable(),
  country: z.string(),
  state: z.string(),
  city: z.string(),
  pincode: z.string(),
  address: z.string(),
  overrideCommissionPercent: z.number(),
  status: z.enum(AGENCY_STATUS),
  ownerUserId: z.string(),
  agencyCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicDistributor = z.infer<typeof PublicDistributorSchema>;
