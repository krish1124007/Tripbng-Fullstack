import { z } from 'zod';

export const AirportSchema = z.object({
  iata: z.string().length(3),
  icao: z.string().optional(),
  name: z.string(),
  city: z.string(),
  state: z.string().optional(),
  country: z.string(),
  countryCode: z.string().length(2),
  timezone: z.string().optional(),
});
export type Airport = z.infer<typeof AirportSchema>;

export const AirportSearchQuerySchema = z.object({
  q: z.string().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
