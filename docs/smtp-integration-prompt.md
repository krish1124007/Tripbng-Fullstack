# Claude Code Prompt — Wire SMTP Everywhere Email Is Needed

> **Paste this entire file into Claude Code at the root of the TripBng monorepo.**
> Work in phases. Pause between each phase for review.

---

## 0. Context — read before doing anything

You are working inside the **TripBng** B2B travel platform — Turborepo monorepo (`@tripbng/*`) with:
- `apps/api` — Express + TypeScript + Mongoose + BullMQ
- `apps/web` — Next.js 14 (App Router)
- `packages/shared` — zod schemas + shared enums

**SMTP infrastructure already exists** and is in good shape — the goal of this prompt is NOT to build it. The goal is to:
1. Activate it (drop creds into env, verify connectivity)
2. Plug every gap where email *should* be sent but currently silently no-ops
3. Replace the bespoke "roll your own email" sites with the shared alert system where it fits
4. Add operational health-checks + a manual test endpoint
5. Verify deliverability end-to-end

The user will provide SMTP credentials separately. Once they're in `.env`, the alert system + every direct-SMTP path light up automatically.

---

## 1. SMTP infrastructure that already exists

**Don't rebuild any of this.** It's already wired and used; you'll just be extending and stress-testing it.

| Layer | File | What it does |
|---|---|---|
| Env validation | [`apps/api/src/config/env.ts:177-203`](apps/api/src/config/env.ts:177) | Validates `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_REPLY_TO`, `OPS_ALERT_EMAIL` |
| Transport singleton | [`apps/api/src/config/smtp.ts`](apps/api/src/config/smtp.ts) | `getSmtpTransport()` — pooled nodemailer, lazy init, returns `null` when SMTP_HOST is unset. `verifySmtp()` + `closeSmtp()` exposed. |
| Alert channel | [`apps/api/src/services/alerts/channels/smtp.channel.ts`](apps/api/src/services/alerts/channels/smtp.channel.ts) | `sendEmail(recipient, rendered, opts)` — throws on transport failure so BullMQ retries. |
| Dispatcher | [`apps/api/src/queues/alert-dispatch.worker.ts`](apps/api/src/queues/alert-dispatch.worker.ts) | Fans an alert across `email`/`whatsapp`/`inapp` channels in parallel. Partial success = job done. |
| Public entry | [`apps/api/src/services/alerts/index.ts`](apps/api/src/services/alerts/index.ts) | `enqueueAlert(payload, recipients, opts)` + `sendAlertSync(...)`. |
| Router (channel matrix) | [`apps/api/src/services/alerts/router.ts`](apps/api/src/services/alerts/router.ts) | Maps each `AlertEvent` → default channel set. Recipient prefs filter on top. |
| Recipient resolver | [`apps/api/src/services/alerts/recipient-resolver.ts`](apps/api/src/services/alerts/recipient-resolver.ts) | Turns `{ kind: 'agency'\|'user'\|'booking_contact'\|'ops'\|'raw', id }` into `{ email, mobile, name }`. |
| 24 email templates | [`apps/api/src/services/alerts/templates/`](apps/api/src/services/alerts/templates/) | One per `AlertEvent`. Subject + text + HTML, branded via `_layout.ts`. |

**24 alert events already wired and rendered:**

```
BOOKING_CONFIRMED · BOOKING_FAILED · BOOKING_CANCELLED · HOLD_EXPIRY_WARNING
TOPUP_SUCCEEDED · TOPUP_FAILED · MANUAL_TOPUP_APPROVED · MANUAL_TOPUP_REJECTED
LOW_WALLET_BALANCE · INSURANCE_ISSUED
PASSWORD_RESET_OTP · LOGIN_NEW_DEVICE
HOTEL_BOOKING_AWAITS_APPROVAL · HOTEL_BOOKING_APPROVED · HOTEL_BOOKING_REJECTED
HOTEL_BOOKING_CONFIRMED · HOTEL_BOOKING_FAILED · HOTEL_BOOKING_CANCELLED
CIRCUIT_BREAKER_TRIPPED · MANUAL_ISSUANCE_PENDING_REMINDER
CREDIT_DUE_T_MINUS_3 · CREDIT_DUE_T_MINUS_1 · CREDIT_DUE_TODAY · CREDIT_OVERDUE
INCENTIVE_CREDITED · DISTRIBUTOR_TRANSFER_IN
MODULE_SWITCHED · ADJUSTMENT_POSTED
```

Triggered from (incomplete list — `git grep -l enqueueAlert apps/api/src` is the source of truth):
- `services/booking.service.ts` — flight bookings
- `services/payment/payment.service.ts` — top-ups
- `services/auth.service.ts` — new-device login
- `services/wallet/topup.ts` — manual approval
- `services/wallet/credit-due-reminder.service.ts` — credit reminders
- `services/wallet/distributor-transfer.service.ts` — transfers
- `services/wallet/agency-config.service.ts` — module switches
- `services/wallet/adjust-approval.service.ts` — wallet adjustments
- `services/insurance/policy.service.ts` — insurance issued
- `services/tbo/*.ts` — hotel bookings
- `services/booking/manual-issuance-followup.service.ts`
- `queues/wallet-monitor.worker.ts` — low balance
- `queues/di-incentive.worker.ts` — incentive credit
- `queues/tbo-pending-booking-poll.worker.ts` — recovery
- `adapters/circuit-breaker.ts` — breaker trip

---

## 2. Direct-SMTP sites that bypass the alert system

These three call `getSmtpTransport()` and `transport.sendMail(...)` directly, *not* via `enqueueAlert`. They predate the alert system and were intentionally kept separate — DO NOT migrate them blindly without checking each rationale. Pick the right option per file.

| File | What it sends | Should migrate to alert system? |
|---|---|---|
| [`services/password-reset.service.ts:133-172`](apps/api/src/services/password-reset.service.ts:133) | Password-reset link | **No.** This is the canonical example: the function must return a `messageId` synchronously for the API response. The alert system is queue-first. Keep direct, but harden (see Phase 3.2). |
| [`services/registration.service.ts:130-175, 417-509`](apps/api/src/services/registration.service.ts:130) | (a) signup OTPs, (b) agency-approved welcome email, (c) registration-rejected email | **Mixed.** OTP send must remain synchronous (Phase 3.3). Approval/rejection emails are async and could migrate to two new `AGENCY_APPROVED` / `AGENCY_REJECTED` events — that's optional polish, not required. |
| [`routes/inquiries.routes.ts:197-249`](apps/api/src/routes/inquiries.routes.ts:197) | Partner inquiry → `OPS_ALERT_EMAIL` | **Yes.** Should become `enqueueAlert({ event: 'PARTNER_INQUIRY_RECEIVED', ... }, [{ kind: 'ops' }], ...)`. New event needed. |

---

## 3. Known gaps where email should fire but currently doesn't

`git grep "TODO.*email\|TODO.*notify\|SMTP not configured" apps/api/src` finds these silent paths:

| Gap | File | Fix |
|---|---|---|
| **Reconciliation discrepancies** never reach finance — only logged. | [`services/payment/reconciliation.service.ts:255-266`](apps/api/src/services/payment/reconciliation.service.ts:255) | Replace `emailFinanceTeam()` stub with `enqueueAlert({ event: 'RECON_DISCREPANCY_FOUND', vars: {...} }, [{ kind: 'ops' }], ...)`. New event needed. |
| **Partner inquiries** silently drop emails when `OPS_ALERT_EMAIL` is unset. | [`routes/inquiries.routes.ts:202-210`](apps/api/src/routes/inquiries.routes.ts:202) | Move to alert system (see §2 above). Ops recipient resolver already handles the env lookup. |
| **Registration approval-email failures** — no retry, no alert. | [`services/registration.service.ts:417-455`](apps/api/src/services/registration.service.ts:417) | Wrap in try/catch with a 5xx-doesn't-block-flow guarantee, log to Sentry on failure, and consider an admin-notification when send fails. |
| **OTP send failures during signup** are best-effort with no user feedback. | [`services/registration.service.ts:130-175`](apps/api/src/services/registration.service.ts:130) | When `transport.sendMail` throws, return `{ delivered: false }` instead of `{ delivered: true }`. Surface "couldn't email you a code, try again" to the UI. |

**Potential additions** (ask the user before implementing):
- Attach the e-ticket PDF (via [`services/booking-pdf.ts:105`](apps/api/src/services/booking-pdf.ts:105)) to `BOOKING_CONFIRMED` emails. Currently the email only links to the dashboard.
- Attach the booking-confirmation PDF to `HOTEL_BOOKING_CONFIRMED`.
- A `PAYMENT_GATEWAY_FAILURE` ops-only alert when the recon cron promotes a `PENDING` → `SUCCESS` via fallback path (signals real bank-side issue).

---

## 4. SMTP credentials placement

The user will hand you a credential block in this shape (Zoho/Gmail/SES/Postfix all fit the same env keys):

```env
# apps/api/.env  (do NOT commit)
SMTP_HOST=smtp.zoho.in              # example — actual value from user
SMTP_PORT=465                        # 465 for SSL, 587 for STARTTLS
SMTP_SECURE=true                     # true for 465, false for 587
SMTP_USER=noreply@tripbng.com
SMTP_PASS=<app-password-from-provider>
SMTP_FROM=TripBng <noreply@tripbng.com>
SMTP_REPLY_TO=trade@tripbng.com
OPS_ALERT_EMAIL=ops@tripbng.com     # required for {kind: 'ops'} recipients
```

**Do NOT** put real credentials in `.env.example` — only documentation defaults like `smtp.zoho.in:465`.

Also update **`apps/api/.env.example`** with the same keys (empty values + comments).

---

## PHASE 1 — Bootstrap + connectivity check

Goal: SMTP transport is configured and reachable from the running API.

### 1.1 Add the credential block to `apps/api/.env`
Take the user's SMTP details and write them under the existing `# SMTP — generic provider-agnostic email transport` block in `.env`. Do not commit.

### 1.2 Update `.env.example`
Mirror the shape (empty values) so onboarding teammates know which keys to populate. Document the common providers as comments (already done — verify it's complete).

### 1.3 Add a startup verification hook
In [`apps/api/src/app.ts`](apps/api/src/app.ts) — find the bootstrap path and call `verifySmtp()` once at startup (best-effort, log warn on fail, do not block boot). This catches credential typos in CI/staging early.

### 1.4 Add an admin health-check endpoint
Mount `GET /api/v1/health/smtp` (admin-only, behind `requireRole('SUPER_ADMIN')`):
- Returns `{ configured: boolean, reachable: boolean, host: string | null, latencyMs: number | null }`
- Uses `verifySmtp()` and times the round-trip
- Does NOT log the password

### 1.5 Add an admin "send test email" endpoint
Mount `POST /api/v1/health/smtp/test` (admin-only):
- Body: `{ to: string }`
- Sends a small "TripBng SMTP test · ${new Date().toISOString()}" message
- Returns the nodemailer `messageId` for the admin to grep their inbox

### 1.6 Stop and show the diff
Run `pnpm -F @tripbng/api typecheck` — must be clean. Manually hit:
- `GET /health/smtp` → expect `reachable: true`
- `POST /health/smtp/test` with your own email → expect a message in your inbox

**STOP. Report results before Phase 2.**

---

## PHASE 2 — Harden the existing direct-SMTP sites

Goal: the three direct-SMTP call sites become robust under load + observable.

### 2.1 `password-reset.service.ts`
- Keep the direct send (synchronous response requirement is real).
- Currently swallows SMTP errors → user is told "we sent a link" even on failure. **Wrong tradeoff** — better to fail loudly to ops while still keeping the response opaque to the user. Add a `captureException` (Sentry) on SMTP failure.
- Add a structured log line on every send: `{ to, messageId, durationMs }`.
- Test path: trigger `/auth/forgot-password` with a known user → confirm email arrives + `messageId` is logged.

### 2.2 `registration.service.ts` — OTP path (`sendOtp`)
- When SMTP throws, return `{ delivered: false, error: 'email-send-failed' }` so the route handler can surface it. Currently always returns `delivered: true` even on failure → user sees no error and never gets the OTP.
- Update the calling route in [`auth.routes.ts`](apps/api/src/routes/auth.routes.ts) / `registration.routes.ts` (find with `git grep sendOtp`) to surface the failure as a 502 Bad Gateway.
- Tighten the SMTP timeout for the OTP path specifically — 5s connection + 10s socket — so a flaky SMTP server doesn't hold the signup flow.

### 2.3 `registration.service.ts` — Approval + rejection emails
- Already async (`void sendApprovalEmail(...).catch(...)`). Make the catch capture to Sentry and write a row to `AgencyRegistration.adminNotes` with `"⚠️ welcome-email send failed at <ts>: <reason>"`.
- Add a re-send mechanism: `POST /api/v1/admin/registrations/:id/resend-welcome` (admin-only).

### 2.4 `inquiries.routes.ts` — Migrate to alert system
- Add a new event `PARTNER_INQUIRY_RECEIVED` in `services/alerts/types.ts` + a template in `services/alerts/templates/partner-inquiry-received.ts` (email only).
- Replace `notifyOps()` body with `await enqueueAlert({ event: 'PARTNER_INQUIRY_RECEIVED', vars: {...} }, [{ kind: 'ops' }], { tenantId: 'system' })`.
- Drop the now-unused direct SMTP import.

**STOP. Confirm typecheck + manual test (submit a partner inquiry, see it land in OPS_ALERT_EMAIL).**

---

## PHASE 3 — Fill the documented gaps

### 3.1 Reconciliation discrepancy alerts
- Add event `RECON_DISCREPANCY_FOUND` with `vars: { batchId, discrepancyCount, sampleDiscrepancies }`.
- Template surfaces the top 5 discrepancies + a deep-link to `/admin/reconciliation/:batchId`.
- Replace [`reconciliation.service.ts:254-266`](apps/api/src/services/payment/reconciliation.service.ts:254) `emailFinanceTeam()` with `enqueueAlert(...)` + `{ kind: 'ops' }` recipient (or add `FINANCE_ALERT_EMAIL` env if finance ≠ ops).

### 3.2 Attach e-ticket PDF to `BOOKING_CONFIRMED`
- Extend `smtp.channel.ts` to accept optional `attachments` from the rendered template.
- Update `RenderedEmail` type to allow `attachments?: Array<{ filename, content, contentType }>`.
- In `templates/booking-confirmed.ts`, conditionally include the e-ticket PDF by calling `generateETicketPdf(booking, ...)`.
- Stream-to-Buffer the PDF (it's currently a `Readable` stream — nodemailer accepts both, but Buffer is simpler for retry-safe queues).
- Add a unit test: render the template with a sample booking, assert `attachments[0].filename === \`eticket-\${pnr}.pdf\``.

### 3.3 Attach hotel-voucher PDF to `HOTEL_BOOKING_CONFIRMED`
Same pattern as 3.2 but for the hotel template.

**STOP. Show typecheck clean + a sample booked PDF arrives in your inbox.**

---

## PHASE 4 — Observability + final sweep

### 4.1 Per-event delivery metrics
- Wire counters/histograms (whatever existing observability stack the repo uses — pino structured logs are fine if there's no metrics layer):
  - `email_sent_total{event,outcome}`
  - `email_send_duration_ms{event}`
  - `email_bounce_total{reason}` (post-bounce-webhook, later)
- Surface via `/api/v1/health/smtp/stats` for admin dashboards.

### 4.2 Final SMTP sweep
- `git grep "SMTP not configured" apps/api/src` — every match should fall into ONE of:
  - Dev-only `logger.info` "OTP/reset link logged" path (acceptable)
  - Production-disabled feature gated behind a config flag
- `git grep "TODO.*email" apps/api/src` — zero hits.
- `git grep -l "transport.sendMail" apps/api/src` — should only return:
  - `config/smtp.ts` (the transport itself)
  - `services/alerts/channels/smtp.channel.ts`
  - `services/password-reset.service.ts`
  - `services/registration.service.ts`
  - `routes/health.routes.ts` (test endpoint)
  - **No other files.** If `inquiries.routes.ts` still appears here, Phase 2.4 isn't done.

### 4.3 Production checklist
Add a section to [`docs/icici-orange-pg-migration.md`](docs/icici-orange-pg-migration.md) (or a new `docs/smtp-deployment.md`) covering:
- SPF / DKIM / DMARC records for the sending domain
- Provider-specific app-password generation (Zoho, Gmail with 2FA, AWS SES)
- Rate limits per provider (Zoho: 200/day on free, Gmail: 500/day, SES: production access request)
- Bounce-handling strategy (suppression list collection)
- Daily ops checklist: tail `email_sent_total{outcome="failed"}` for 7 days post-cutover

### 4.4 Stop
Produce a one-pager covering:
- Every email-worthy event that now sends in production
- Every direct-SMTP path that survives, with the rationale
- The admin endpoints (`/health/smtp`, `/health/smtp/test`, `/admin/registrations/:id/resend-welcome`)
- The new events added (`PARTNER_INQUIRY_RECEIVED`, `RECON_DISCREPANCY_FOUND`, optionally `AGENCY_APPROVED`/`REJECTED`)

---

## Anti-patterns to refuse

- **Do not** log `SMTP_PASS`, full `SMTP_USER` (mask everything but the localpart), or rendered email bodies (PII).
- **Do not** synchronously block API routes on `transport.sendMail` except in the password-reset and OTP paths — everything else goes through `enqueueAlert`.
- **Do not** swallow SMTP errors silently. Either retry (via BullMQ in the alert path), surface to the user (OTP), or log to Sentry (password-reset / signup approval).
- **Do not** put real credentials in `.env.example`, fixtures, or test files. Use `nodemailer-mock` or skip with `if (!process.env.SMTP_HOST) it.skip(...)`.
- **Do not** wire a new alert channel ("SMS via Twilio", etc.) into this prompt — that's a separate prompt. Stay focused on SMTP.
- **Do not** modify the `_layout.ts` template visual design without showing the user a before/after — branding is touched by every email.

---

## Open questions to confirm with the user before Phase 3

1. **Finance vs ops inbox.** Is `FINANCE_ALERT_EMAIL` a separate env var, or does `OPS_ALERT_EMAIL` cover finance discrepancies too?
2. **E-ticket PDF attachment**. Some agencies forward the email to end customers — attaching the PDF is convenient but doubles average email size. Confirm before shipping (could be a per-agency `notificationPrefs.attachETicket` toggle).
3. **Welcome email re-send**. Should the admin `/resend-welcome` endpoint also reset the temp password, or just re-deliver the existing one?
4. **Bounce handling**. Do they have a provider-side webhook plan (SES SNS, Postmark, etc.) or is suppression-on-bounce a v2 concern?

---

## File map (read these first if you're new to the codebase)

```
apps/api/src/
├── config/
│   ├── env.ts                         # SMTP_HOST..SMTP_FROM..OPS_ALERT_EMAIL
│   └── smtp.ts                        # getSmtpTransport() / verifySmtp() / closeSmtp()
├── services/
│   ├── alerts/
│   │   ├── index.ts                   # enqueueAlert(), sendAlertSync()
│   │   ├── types.ts                   # AlertEvent | AlertChannel | RecipientRef
│   │   ├── router.ts                  # DEFAULT_CHANNELS per event
│   │   ├── recipient-resolver.ts      # ref → { email, mobile, name }
│   │   ├── channels/
│   │   │   ├── smtp.channel.ts        # sendEmail()
│   │   │   ├── whatsapp.channel.ts
│   │   │   └── inapp.channel.ts
│   │   └── templates/                 # 24 *.ts — subject + text + html
│   ├── password-reset.service.ts      # direct SMTP (keep — synchronous)
│   ├── registration.service.ts        # direct SMTP (mixed)
│   └── payment/reconciliation.service.ts  # TODO-FINANCE-EMAIL stub
├── routes/
│   ├── inquiries.routes.ts            # direct SMTP — migrate to alerts
│   ├── auth.routes.ts                 # forgot-password trigger
│   └── (add) health.routes.ts         # /health/smtp + /health/smtp/test
└── queues/
    └── alert-dispatch.worker.ts       # fans out across email/wa/inapp
```

```
.env / .env.example
├── SMTP_HOST=
├── SMTP_PORT=587
├── SMTP_SECURE=false
├── SMTP_USER=
├── SMTP_PASS=
├── SMTP_FROM=TripBng <noreply@tripbng.com>
├── SMTP_REPLY_TO=
└── OPS_ALERT_EMAIL=
```

---

## Smoke-test script (run after each phase)

```bash
# 1. Boot the API — should log "smtp transport initialized" on first email
pnpm -F @tripbng/api dev

# 2. Health check
curl -H 'Authorization: Bearer <admin-jwt>' http://localhost:4002/api/v1/health/smtp
# Expect: {"configured": true, "reachable": true, "host": "smtp.zoho.in", "latencyMs": 120}

# 3. Test email
curl -X POST -H 'Authorization: Bearer <admin-jwt>' -H 'Content-Type: application/json' \
  -d '{"to":"your-email@example.com"}' \
  http://localhost:4002/api/v1/health/smtp/test
# Expect a message in your inbox + a messageId in the response

# 4. Forgot-password
curl -X POST -H 'Content-Type: application/json' \
  -d '{"email":"your-registered-account@example.com"}' \
  http://localhost:4002/api/v1/auth/forgot-password
# Expect: 200 OK + a reset link email arrives

# 5. Submit a partner inquiry (Phase 2.4 onwards)
curl -X POST -H 'Content-Type: application/json' \
  -d '{"type":"AGENCY","companyName":"Test","fullName":"Foo","email":"foo@bar.com","mobile":"+919999999999"}' \
  http://localhost:4002/api/v1/inquiries
# Expect: inquiry appears in DB + email to OPS_ALERT_EMAIL

# 6. Trigger a fake topup-success alert
# (best done by completing a UAT ICICI Orange PG transaction OR by inserting a mock job)
# Expect: TOPUP_SUCCEEDED email arrives at the topup initiator's email
```

---

**Begin with Phase 1. Stop after Phase 1.6 for review.**
