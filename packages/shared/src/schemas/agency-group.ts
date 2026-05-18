import { z } from 'zod';

export const CreateAgencyGroupRequestSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  agencyIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).default([]),
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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicAgencyGroup = z.infer<typeof PublicAgencyGroupSchema>;
