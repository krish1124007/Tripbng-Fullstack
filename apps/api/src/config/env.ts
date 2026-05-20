import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  /** Canonical agency-dashboard URL — used to build deep-links in alerts
   *  (booking detail, approval queue, voucher download). Singular by design;
   *  CORS_ORIGINS handles the multi-origin allowlist separately. */
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),

  MONGO_URI: z.string().min(1),
  MONGO_POOL_SIZE: z.coerce.number().int().default(10),

  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TOTP_ISSUER: z.string().default('TripBng'),

  // ICICI Orange PG / Pay Gateway (env fallback only — prod should use PaymentGatewayConfig in DB).
  // The merchant key is the HMAC secret — NEVER log it. Aggregator ID is mandatory for us.
  ICICI_ORANGE_PG_ENV: z.enum(['UAT', 'PROD']).default('UAT'),
  ICICI_ORANGE_PG_MERCHANT_ID: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  ICICI_ORANGE_PG_AGGREGATOR_ID: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  ICICI_ORANGE_PG_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  ICICI_ORANGE_PG_RETURN_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined)),
  ICICI_ORANGE_PG_ADVICE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined)),
  ICICI_ORANGE_PG_INITIATE_SALE_URL: z
    .string()
    .url()
    .default('https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale'),
  ICICI_ORANGE_PG_COMMAND_URL: z
    .string()
    .url()
    .default('https://pgpayuat.icicibank.com/tsp/pg/api/command'),
  ICICI_ORANGE_PG_SETTLEMENT_DETAILS_URL: z
    .string()
    .url()
    .default('https://pgpayuat.icicibank.com/tsp/pg/api/settlementDetails'),
  ICICI_ORANGE_PG_USER_CANCEL_URL: z
    .string()
    .url()
    .default('https://pgpayuat.icicibank.com/tsp/pg/api/userCancel'),

  // ASEGO travel insurance. Empty toggles the insurance module off (the routes still
  // mount but will return SERVICE_UNAVAILABLE). Once credentials land, set ASEGO_ENABLED=true
  // alongside the rest. Secret key + IV must be exactly 32 / 16 chars per AES-256-CBC.
  ASEGO_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  ASEGO_BASE_URL: z.string().url().default('https://dolphin.asego.in:8080'),
  ASEGO_API_PREFIX: z.string().default('/ext/b2b/v1'),
  ASEGO_USER_AGENT: z.string().default('TripBNG-API/1.0'),
  ASEGO_PARTNER_ID: z.string().optional(),
  ASEGO_SIGN: z.string().optional(),
  ASEGO_REFERENCE: z.string().optional(),
  ASEGO_SECRET_KEY: z
    .string()
    .optional()
    .refine((v) => !v || v.length === 32, {
      message: 'ASEGO_SECRET_KEY must be exactly 32 characters (AES-256)',
    }),
  ASEGO_INIT_VECTOR: z
    .string()
    .optional()
    .refine((v) => !v || v.length === 16, {
      message: 'ASEGO_INIT_VECTOR must be exactly 16 characters (CBC IV)',
    }),
  ASEGO_BRANCH_SIGN: z.string().optional(),
  ASEGO_BRANCH_NAME: z.string().optional(),
  ASEGO_REQUEST_TIMEOUT_MS: z.coerce.number().int().default(30_000),
  ASEGO_RETRY_COUNT: z.coerce.number().int().default(2),
  ASEGO_CACHE_TTL_MASTER: z.coerce.number().int().default(86_400),
  ASEGO_CACHE_TTL_REASONS: z.coerce.number().int().default(2_592_000),

  // PostHog — backend product analytics. Empty key disables the integration
  // (track() becomes a no-op). Project key is the same value the frontend uses;
  // backend events get tagged with `$lib: 'tripbng-api'` so PostHog can split.
  POSTHOG_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  POSTHOG_HOST: z.string().url().default('https://app.posthog.com'),

  // WhatsApp Business Cloud API — used to push e-tickets to the booker after
  // confirmation. Empty disables the channel; ticket emails still go out.
  // Phone number ID is the WABA-attached sender; access token is a long-lived
  // system-user token (rotate quarterly via Meta business settings).
  WHATSAPP_ACCESS_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  WHATSAPP_PHONE_NUMBER_ID: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  WHATSAPP_GRAPH_VERSION: z.string().default('v20.0'),
  WHATSAPP_TEMPLATE_NAME: z.string().default('ticket_confirmation'),
  WHATSAPP_TEMPLATE_LANG: z.string().default('en'),

  // SMTP — generic provider-agnostic email transport via nodemailer. Empty
  // SMTP_HOST disables the email channel (alerts no-op, retries don't enqueue).
  // Common providers:
  //   - Zoho:        smtp.zoho.in:465  (secure=true)
  //   - Gmail:       smtp.gmail.com:587 (secure=false, app password)
  //   - AWS SES:     email-smtp.<region>.amazonaws.com:587
  //   - Postfix:     internal:25 (secure=false, no auth)
  SMTP_HOST: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  SMTP_PASS: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  SMTP_FROM: z.string().default('TripBng <noreply@tripbng.com>'),
  SMTP_REPLY_TO: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Ops alert inbox — receives system-level alerts (breaker trips, recon mismatches). */
  OPS_ALERT_EMAIL: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),

  /** Low-wallet warning threshold (paise). When a debit drops the agency
   *  wallet from above to below this threshold, a single LOW_WALLET_BALANCE
   *  alert fires. Default ₹1,000 (= 100,000 paise). Per-agency overrides
   *  can land later via Agency.lowBalanceThresholdPaise. */
  LOW_WALLET_THRESHOLD_PAISE: z.coerce.number().int().nonnegative().default(100_000),
  /** Critical-balance threshold (paise). Below this, the wallet-monitor
   *  worker fires the LOW_WALLET_BALANCE alert at "critical" severity
   *  every monitor tick (no 24h dedupe). Default ₹200 (= 20,000 paise).
   *  Must be ≤ LOW_WALLET_THRESHOLD_PAISE; the worker enforces. */
  CRITICAL_WALLET_THRESHOLD_PAISE: z.coerce.number().int().nonnegative().default(20_000),
  /** How often the wallet-monitor worker scans. Default every 15 min
   *  per CLAUDE.md §2 architecture diagram. */
  WALLET_MONITOR_INTERVAL_MS: z.coerce.number().int().min(60_000).default(15 * 60_000),
  /** Dedupe window for the "low" tier alert. Critical tier ignores this. */
  WALLET_LOW_ALERT_DEDUPE_HOURS: z.coerce.number().int().min(1).default(24),

  /** Shadow-mode flag for the wallet waterfall (Phase 9, AGENCY_WALLET_SYSTEM
   *  spec §18). When true, every successful payment also computes what the
   *  new waterfall WOULD have produced for the split (credit settlement +
   *  wallet portion + DI incentive + TDS) and emits a structured log line.
   *  No DB writes from the simulation. Stays on for ~2 weeks of observation;
   *  flipping false ahead of cutover, then to "active" once the legacy
   *  walletService.credit call is swapped for waterfall.applyPayment. */
  SHADOW_WALLET: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(false)
    .transform((v) => v === true || v === 'true'),

  /** Distributor → sub-agent transfers above this threshold require admin
   *  approval before they hit the ledger. Set high enough to allow normal
   *  daily working-capital movement to flow unattended (default ₹50,000
   *  = 5,000,000 paise per AGENCY_WALLET_SYSTEM spec §3.8). */
  DISTRIBUTOR_TRANSFER_APPROVAL_THRESHOLD_PAISE: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(5_000_000),

  /** Manual wallet adjustments (admin-posted CREDIT / DEBIT) above this
   *  threshold require two-person approval per spec §7. Default ₹10,000
   *  = 1,000,000 paise. The approver MUST be a different SUPER_ADMIN than
   *  the proposer — the service rejects same-user approvals. */
  WALLET_ADJUSTMENT_APPROVAL_THRESHOLD_PAISE: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(1_000_000),

  /** Shared-secret authorisation for /internal/* endpoints (booking engine
   *  → wallet, etc.). When set, calls MUST include the same value in the
   *  `X-Internal-Key` header. Unset = endpoints reject every request (safe
   *  default — internal endpoints don't reveal themselves to the web). */
  INTERNAL_API_KEY: z
    .string()
    .min(32)
    .optional()
    .transform((v) => (v ? v : undefined)),

  // ────────── TripBNG company info (for tax invoices) ──────────
  /** Bill-from legal name on tax invoices. */
  TRIPBNG_LEGAL_NAME: z.string().default('Tankar Solutions Private Limited'),
  /** Bill-from GSTIN. Default is a placeholder so dev/test envs can
   *  generate invoices for QA; production MUST override. The value
   *  shows up in logs as obviously-fake. */
  TRIPBNG_GSTIN: z.string().default('27UNCONFIGRD01ZX'),
  /** State (matches GSTIN's first two digits). Determines CGST+SGST vs
   *  IGST split on every invoice. */
  TRIPBNG_STATE: z.string().default('Maharashtra'),
  /** State code (2-digit GST state code). */
  TRIPBNG_STATE_CODE: z.string().default('27'),
  /** Bill-from address shown on the invoice. Production MUST override. */
  TRIPBNG_ADDRESS: z
    .string()
    .default('TripBNG / Tankar Solutions Pvt Ltd — set TRIPBNG_ADDRESS'),
  /** Bill-from PAN (printed alongside GSTIN). */
  TRIPBNG_PAN: z.string().default(''),
  /** Effective GST rate on TripBNG service charges (basis points,
   *  default 1800 = 18%). */
  TRIPBNG_SERVICE_GST_BP: z.coerce.number().int().min(0).max(10_000).default(1800),
  /** GST rate on the bus operator's pass-through fare line. AC bus is
   *  5% (500 bp); non-AC is 0. We default to 500 since bus search
   *  filters AC-by-default for corporate flows. The line is computed
   *  per-booking based on `trip.isAc`. */
  TRIPBNG_BUS_OPERATOR_GST_BP: z.coerce.number().int().min(0).max(10_000).default(500),
  /** GST rate on the flight ticket's pass-through fare line (economy
   *  domestic). 500 bp = 5% is the canonical Indian rate. Business /
   *  first-class lifts to 12% (1200 bp) — the invoice service flips
   *  to that when `booking.pricing` / `result.travelClass` ≠ ECONOMY. */
  TRIPBNG_FLIGHT_ECONOMY_GST_BP: z.coerce.number().int().min(0).max(10_000).default(500),
  TRIPBNG_FLIGHT_BUSINESS_GST_BP: z.coerce.number().int().min(0).max(10_000).default(1200),
  /** Hours after ticketing during which the booking can be voided
   *  at zero cancellation fee. Mirrors the airline industry's "void
   *  window" — typically 4h on Indian carriers, 24h on US.
   *  Set to 0 to disable the free-void path entirely. */
  TRIPBNG_FLIGHT_VOID_WINDOW_HOURS: z.coerce.number().int().min(0).max(48).default(4),

  // ────────── TBO Holidays — Universal Hotel API ──────────
  // Sandbox at https://Sharedapi.tektravels.com (per TBO API docs).
  // TBO_ENABLED gates the entire integration: services/auth/cron all no-op
  // when false, so dev environments without sandbox creds boot cleanly.
  TBO_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TBO_CLIENT_ID: z.string().default('ApiIntegrationNew'),
  TBO_USERNAME: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  TBO_PASSWORD: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** TBO Holidays Hotel API uses HTTP Basic Auth with a per-account credential
   *  pair distinct from the SharedData (Authenticate) one. If TBO has issued
   *  separate API creds for the hotel side, set them here; otherwise we fall
   *  back to TBO_USERNAME/TBO_PASSWORD (which works for some accounts where
   *  the same pair is provisioned for both services). */
  TBO_HOTEL_USERNAME: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  TBO_HOTEL_PASSWORD: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Static prod/sandbox public IP — TBO whitelists this. Required in prod;
   *  optional in dev (auth will fail at TBO if not whitelisted, which is
   *  fine — surfaces the misconfiguration with a clear error). */
  TBO_END_USER_IP: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),

  // Three different base hosts — see CLAUDE.md §6.1 for the routing table.
  TBO_SHARED_BASE: z
    .string()
    .url()
    .default('https://Sharedapi.tektravels.com/SharedData.svc/rest'),
  TBO_HOTEL_BASE: z.string().url().default('https://affiliate.tektravels.com/HotelAPI'),
  TBO_HOTEL_BE_BASE: z
    .string()
    .url()
    .default('https://HotelBE.tektravels.com/hotelservice.svc/rest'),
  /** TBO flight booking-engine — Air-side endpoints (Search, FareRule,
   *  FareQuote, SSR, Book, Ticket, GetBookingDetails, SendChangeRequest).
   *  Distinct host from the hotel side per TBO docs. */
  TBO_FLIGHT_BASE: z
    .string()
    .url()
    .default('http://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest'),
  /** Per-supplier search timeout. TBO sandbox routinely takes 20–25s even
   *  when returning "No result found" — and live searches can run longer
   *  with full result sets. 30s default keeps the success rate high without
   *  burning the user's patience. Override via env in prod after watching
   *  the p99 in metrics. */
  TBO_FLIGHT_SEARCH_TIMEOUT_MS: z.coerce.number().int().default(30_000),
  /** Tie-breaker priority when two suppliers return the same fare (spec §7.4). */
  TBO_FLIGHT_PRIORITY: z.coerce.number().int().min(0).max(100).default(10),

  // Operational tunables.
  TBO_REQUEST_TIMEOUT_MS: z.coerce.number().int().default(30_000),
  TBO_TOKEN_CACHE_KEY: z.string().default('tbo:token:current'),
  /** Safety buffer subtracted from "seconds until midnight IST" when caching
   *  the token — guarantees the token is rotated before TBO invalidates it. */
  TBO_TOKEN_TTL_BUFFER_SEC: z.coerce.number().int().default(300),
  /** Comma-separated TBO countryCode list — countries whose cities the
   *  nightly sweep refreshes. Defaults to India only; expand as needed. */
  TBO_REFERENCE_COUNTRIES: z.string().default('IN'),
  /** Comma-separated cityIds — cities whose hotel-code list the nightly
   *  sweep refreshes. Empty = skip the heavy hotel sweep nightly (admin
   *  triggers handle it on demand). Populate with TBO cityIds for the 14
   *  phase-1 metros once they're discovered via syncCitiesForCountry. */
  TBO_REFERENCE_HOTEL_CITIES: z.string().default(''),

  /** Max hotel codes per Search call. TBO mandates ≤100. */
  TBO_SEARCH_CHUNK_SIZE: z.coerce.number().int().min(1).max(100).default(100),
  /** Concurrent Search fan-out workers. Higher = faster, but TBO rate-limits.
   *  10 is the spec recommendation. */
  TBO_SEARCH_PARALLEL_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
  /** Cache TTL for normalized search responses (seconds). 60s matches TBO
   *  rate volatility — anything longer risks stale-pricing complaints. */
  TBO_SEARCH_CACHE_TTL_SEC: z.coerce.number().int().min(0).default(60),
  /** Default markup % over TBO net price. Per-corporate overrides will land
   *  in Phase 5 via Agency.policies.hotel.markupPercent. */
  TBO_DEFAULT_MARKUP_PCT: z.coerce.number().min(0).max(50).default(4),

  // ── Pending booking poller (HotelBookingStatus=Pending) ──
  /** Wait this long before the FIRST GetBookingDetail poll. Spec mandates
   *  ≥120s — TBO needs time to settle the booking on their side. */
  TBO_PENDING_POLL_INITIAL_DELAY_MS: z.coerce.number().int().default(120_000),
  /** Interval between subsequent polls. */
  TBO_PENDING_POLL_INTERVAL_MS: z.coerce.number().int().default(60_000),
  /** Give up after this many polls and mark the booking as permanently
   *  PENDING_SUPPLIER (alerts ops for manual intervention). */
  TBO_PENDING_POLL_MAX_ATTEMPTS: z.coerce.number().int().default(20),

  // ── Voucher (auto-voucher held bookings) ──
  /** Hours BEFORE lastCancellationDate to fire the voucher job. Default 24h
   *  trades off cash-flow (later voucher = more time to cancel for free)
   *  against supplier-cancellation risk. */
  TBO_VOUCHER_LEAD_HOURS: z.coerce.number().int().min(1).max(168).default(24),

  // ── Cancel poller (GetChangeRequestStatus) ──
  TBO_CANCEL_POLL_INTERVAL_MS: z.coerce.number().int().default(60_000),
  /** 24h × 60s = 1440 attempts. Most cancels resolve in minutes; this is the
   *  fail-safe upper bound. */
  TBO_CANCEL_POLL_MAX_ATTEMPTS: z.coerce.number().int().default(1440),

  // ────────── Kafila V2 (Flight aggregator — Phase 1 scaffolding) ──────────
  // Login payload uses `{ userId, apiKey, apiSecret }` (NOT `{ userId, password }`
  // — the PDF docs are stale; Postman is authoritative per the spec). Token is
  // an 8h JWT; we treat it as 7h 30min (27_000s) so it always refreshes before
  // expiry. Default disabled — `KAFILA_ENABLED=false` skips the adapter entirely.
  KAFILA_ENABLED: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .default(false)
    .transform((v) => v === true || v === 'true' || v === '1'),
  KAFILA_BASE_URL: z.string().url().default('http://staging.kafilaholidays.in'),
  KAFILA_USER_ID: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  KAFILA_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  KAFILA_API_SECRET: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Vendor-provided company ID. Optional — most accounts leave it empty. */
  KAFILA_COMPANY_ID: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** TEST against staging.kafilaholidays.in; LIVE against the prod base URL.
   *  Mirrors the `credentialType` field every Kafila request body carries. */
  KAFILA_CREDENTIAL_TYPE: z.enum(['TEST', 'LIVE']).default('TEST'),
  /** Sales channel sent on every request — API | B2B | B2C. Confirm with vendor. */
  KAFILA_SALES_CHANNEL: z.enum(['API', 'B2B', 'B2C']).default('API'),
  KAFILA_HTTP_TIMEOUT_MS: z.coerce.number().int().default(30_000),
  KAFILA_HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /** Rate limit (req/sec). Conservative starting point — confirm with vendor. */
  KAFILA_RATE_LIMIT_RPS: z.coerce.number().int().min(1).max(100).default(5),
  KAFILA_JWT_CACHE_KEY: z.string().default('kafila:jwt'),
  /** Effective JWT TTL in seconds. Spec mandates 27_000 (7h 30min) since the
   *  actual token is 8h — proactive refresh before expiry. */
  KAFILA_JWT_TTL_SECONDS: z.coerce.number().int().min(300).default(27_000),
  /** Tie-breaker priority when two suppliers return the same fare. Kafila
   *  defaults to 6 (between AirIQ and TBO) per the spec. */
  KAFILA_PRIORITY: z.coerce.number().int().min(0).max(100).default(6),

  // ────────── SeatSeller (RedBus partner — Bus Booking) ──────────
  // NOTE: `z.coerce.boolean()` is a footgun for env vars — `Boolean("false")`
  // is `true` in JS, so a literal `SEATSELLER_USE_MOCK=false` in .env
  // would be parsed as `true`. We use a string-aware transform instead.
  /** Master switch — when false, the adapter factory returns a no-op
   *  shim so the search/book pipeline doesn't even attempt to call
   *  SeatSeller. Mirrors TBO_ENABLED. */
  SEATSELLER_ENABLED: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .default(false)
    .transform((v) => v === true || v === 'true' || v === '1'),
  /** Mock client switch — MUST be true in development per CLAUDE.md §0
   *  Law 3 (test bookings against the real API are real money). The
   *  factory hard-fails on boot if this is false in NODE_ENV=development. */
  SEATSELLER_USE_MOCK: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .default(true)
    .transform((v) => v === true || v === 'true' || v === '1'),
  SEATSELLER_BASE_URL: z.string().url().default('http://api.seatseller.travel'),
  SEATSELLER_OAUTH_KEY: z.string().default(''),
  SEATSELLER_OAUTH_SECRET: z.string().default(''),
  SEATSELLER_TOKEN_URL: z.string().default(''),
  /** Per-call wall-clock timeout. SeatSeller worst case is 180s — leave
   *  5s of headroom over that for the audit log persist + abort cleanup. */
  SEATSELLER_REQUEST_TIMEOUT_MS: z.coerce.number().int().default(185_000),
  /** Tighter cap for blockTicket (the 8-min hold window means a slow
   *  block burns the whole window before book gets a chance). */
  SEATSELLER_BLOCK_TIMEOUT_MS: z.coerce.number().int().default(60_000),
  /** Redis key for the cached OAuth token. Kept short + namespaced. */
  SEATSELLER_OAUTH_CACHE_KEY: z.string().default('ss:oauth:token'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
