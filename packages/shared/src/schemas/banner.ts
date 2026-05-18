import { z } from 'zod';

export const BANNER_TYPE = ['POPUP', 'FIXED', 'CAROUSEL'] as const;
export type BannerType = (typeof BANNER_TYPE)[number];

export const BANNER_LOCATION = [
  'AGENCY_DASHBOARD',
  'SEARCH_PAGE',
  'BOOKING_REVIEW',
  'TOP_GLOBAL',
  /** Footer slot on the e-ticket PDF (premium ticket spec §3.2). One banner
   *  is selected at ticket-generation time and snapshotted onto the booking
   *  so re-downloads stay consistent. */
  'TICKET_FOOTER',
] as const;
export type BannerLocation = (typeof BANNER_LOCATION)[number];

export const BANNER_TARGET = ['ALL', 'AGENCY_GROUP', 'DISTRIBUTOR_DOWNLINE'] as const;
export type BannerTarget = (typeof BANNER_TARGET)[number];

export const BANNER_FREQUENCY = ['ONCE', 'PER_SESSION', 'PER_DAY', 'ALWAYS'] as const;
export type BannerFrequency = (typeof BANNER_FREQUENCY)[number];

// Accepted shapes for imageUrl:
//   - https://… or http://… (hosted image)
//   - data:image/...;base64,… (inline upload from the admin form)
// We don't host the file separately — the admin file picker reads the
// selected image with FileReader and writes the data URL into this
// field. Mongo stores the doc; the browser renders the data URL
// natively. Trade-off: doc size grows with image bytes (×1.33 base64
// overhead). Keep banner images under ~2 MB.
const ImageUrlSchema = z
  .string()
  .max(5_500_000)
  .refine(
    (s) => /^https?:\/\//i.test(s) || s.startsWith('data:image/'),
    {
      message:
        'Image must be a URL (http/https) or an uploaded data:image/...;base64 value',
    },
  );

export const CreateBannerRequestSchema = z.object({
  title: z.string().min(2).max(160),
  imageUrl: ImageUrlSchema.optional(),
  href: z.string().url().optional(),
  body: z.string().max(500).optional(),
  type: z.enum(BANNER_TYPE).default('FIXED'),
  location: z.enum(BANNER_LOCATION).default('AGENCY_DASHBOARD'),
  target: z.enum(BANNER_TARGET).default('ALL'),
  agencyGroupIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).default([]),
  distributorIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).default([]),
  frequency: z.enum(BANNER_FREQUENCY).default('PER_SESSION'),
  priority: z.number().int().min(0).max(1000).default(100),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  active: z.boolean().default(true),
});
export type CreateBannerRequest = z.infer<typeof CreateBannerRequestSchema>;

export const UpdateBannerRequestSchema = CreateBannerRequestSchema.partial();
export type UpdateBannerRequest = z.infer<typeof UpdateBannerRequestSchema>;

export const PublicBannerSchema = z.object({
  id: z.string(),
  title: z.string(),
  imageUrl: z.string().nullable(),
  href: z.string().nullable(),
  body: z.string().nullable(),
  type: z.enum(BANNER_TYPE),
  location: z.enum(BANNER_LOCATION),
  target: z.enum(BANNER_TARGET),
  agencyGroupIds: z.array(z.string()),
  distributorIds: z.array(z.string()),
  frequency: z.enum(BANNER_FREQUENCY),
  priority: z.number(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicBanner = z.infer<typeof PublicBannerSchema>;
