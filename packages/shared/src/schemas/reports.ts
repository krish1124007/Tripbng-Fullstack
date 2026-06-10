import { z } from 'zod';
import { BOOKING_STATUS } from '../enums.js';

export const REPORT_TYPE = [
  // Transactional (row-level) reports — the reference report generator.
  'BOOKING',
  'CANCELLATION',
  'COMMISSION',
  'LEDGER',
  // Analytical (aggregated) reports — dashboards.
  'SALES',
  'AGENCY_PERFORMANCE',
  'SUPPLIER_COMPARISON',
  'ROUTE_PROFITABILITY',
  'REFUND_TRACKER',
  'OUTSTANDING',
  'GST',
] as const;
export type ReportType = (typeof REPORT_TYPE)[number];

/** Row-level reports render as a plain transactional grid (no chart/KPIs). */
export const TRANSACTIONAL_REPORTS: readonly ReportType[] = [
  'BOOKING',
  'CANCELLATION',
  'COMMISSION',
  'LEDGER',
];

export const ReportQuerySchema = z.object({
  type: z.enum(REPORT_TYPE),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  // Optional scope filters — not every report uses every filter.
  agencyId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  /** Free-text agency search (matches agency code or company name). */
  agencyName: z.string().trim().optional(),
  bookingStatus: z.enum(BOOKING_STATUS).optional(),
  distributorId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  supplierCode: z.string().optional(),
  airline: z.string().optional(),
  origin: z.string().length(3).optional(),
  destination: z.string().length(3).optional(),
});
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

export const ReportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  format: z.enum(['number', 'paise', 'percent', 'date', 'string']).default('string'),
});
export type ReportColumn = z.infer<typeof ReportColumnSchema>;

export const ReportResponseSchema = z.object({
  type: z.enum(REPORT_TYPE),
  generatedAt: z.string().datetime(),
  from: z.string().datetime().nullable(),
  to: z.string().datetime().nullable(),
  columns: z.array(ReportColumnSchema),
  rows: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
  totals: z.record(z.number()).nullable(),
});
export type ReportResponse = z.infer<typeof ReportResponseSchema>;
