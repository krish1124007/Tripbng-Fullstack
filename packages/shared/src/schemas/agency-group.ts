import { z } from 'zod';

export const AGENCY_GROUP_STATUS = ['ACTIVE', 'INACTIVE'] as const;
export type AgencyGroupStatus = (typeof AGENCY_GROUP_STATUS)[number];

const airlineCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(2)
  .max(3)
  .regex(/^[A-Z0-9]+$/, 'IATA airline code');

export const CreateAgencyGroupRequestSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  agencyIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).default([]),
  /** Airlines mapped/restricted to this group (drives "Mapped airline count"). */
  airlineCodes: z.array(airlineCode).default([]),
  status: z.enum(AGENCY_GROUP_STATUS).default('ACTIVE'),
});
export type CreateAgencyGroupRequest = z.infer<typeof CreateAgencyGroupRequestSchema>;

export const UpdateAgencyGroupRequestSchema = CreateAgencyGroupRequestSchema.partial();
export type UpdateAgencyGroupRequest = z.infer<typeof UpdateAgencyGroupRequestSchema>;

export const PublicAgencyGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  agencyIds: z.array(z.string()),
  agencyCount: z.number(),
  airlineCodes: z.array(z.string()),
  airlineCount: z.number(),
  status: z.enum(AGENCY_GROUP_STATUS),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicAgencyGroup = z.infer<typeof PublicAgencyGroupSchema>;
