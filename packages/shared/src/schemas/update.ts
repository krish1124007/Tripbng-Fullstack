// "What's new" updates — admin-authored operational announcements that
// surface on the agency dashboard's UpdatesFeed. Examples: "Series Q3
// calendar is live", "Hotel module connected", "Pax calendar in beta".
//
// Per-tenant. Admins (SUPER_ADMIN) CRUD; everyone else reads active +
// in-window rows on the dashboard.

import { z } from 'zod';

/**
 * Visual tone — drives the badge colour and the icon tile background.
 *  - 'accent'  : warm orange (new product / launch announcements)
 *  - 'brand'   : brand blue (operational / system updates)
 *  - 'neutral' : muted grey (notices / informational)
 */
export const UPDATE_TONE = ['accent', 'brand', 'neutral'] as const;
export type UpdateTone = (typeof UPDATE_TONE)[number];

/**
 * Tag — the small pill rendered above the title. We allow any short
 * string instead of an enum so admins can mint their own labels
 * (e.g. "Beta", "Launch", "Heads-up").
 */
const TagSchema = z.string().min(1).max(24);

/**
 * Lucide icon name — must match an exported component on the web side.
 * Centralised here so the API validates against the same allow-list
 * the UI knows how to render. New icons require a coordinated bump
 * here + in the web's icon-map.
 */
export const UPDATE_ICON = [
  'PlaneTakeoff',
  'ArrowDownToLine',
  'Hotel',
  'CalendarDays',
  'Sparkles',
  'Megaphone',
  'ShieldCheck',
  'Wallet',
  'Bus',
  'Plane',
  'FileText',
  'Receipt',
  'Sprout',
  'TrendingUp',
  'CreditCard',
  'Users',
  'Bell',
  'Zap',
] as const;
export type UpdateIcon = (typeof UPDATE_ICON)[number];

export const CreateUpdateRequestSchema = z.object({
  title: z.string().min(2).max(120),
  body: z.string().min(2).max(500),
  tag: TagSchema.default('New'),
  tone: z.enum(UPDATE_TONE).default('accent'),
  icon: z.enum(UPDATE_ICON).default('Sparkles'),
  /** Optional CTA — opens this URL when the row is clicked. */
  href: z.string().url().optional(),
  /** Sort key — lower priority numbers float to the top. */
  priority: z.number().int().min(0).max(1000).default(100),
  /** ISO timestamp — when the row becomes visible. Defaults to now. */
  publishedAt: z.coerce.date().optional(),
  /** ISO timestamp — when the row should auto-hide. Null = never. */
  expiresAt: z.coerce.date().optional(),
  /** Soft visibility toggle — admins can hide without deleting. */
  active: z.boolean().default(true),
});
export type CreateUpdateRequest = z.infer<typeof CreateUpdateRequestSchema>;

export const UpdateUpdateRequestSchema = CreateUpdateRequestSchema.partial();
export type UpdateUpdateRequest = z.infer<typeof UpdateUpdateRequestSchema>;

export const PublicUpdateSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  tag: z.string(),
  tone: z.enum(UPDATE_TONE),
  icon: z.enum(UPDATE_ICON),
  href: z.string().nullable(),
  priority: z.number(),
  publishedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PublicUpdate = z.infer<typeof PublicUpdateSchema>;
