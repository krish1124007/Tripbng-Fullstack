# SMTP Integration — Handoff

Phases 1–4 of [smtp-integration-prompt.md](smtp-integration-prompt.md)
are complete. Email pipeline is production-ready pending live credentials.

---

## What sends mail in production now

### Via the alert system (26 events)

Pushed through `enqueueAlert(...)` → BullMQ → `alert-dispatch.worker` → SMTP channel. Retries, recipient resolution, per-tenant branding, and partial-failure tolerance are all handled by the framework.

| Event | Channels | Recipient(s) | Where it fires |
|---|---|---|---|
| `BOOKING_CONFIRMED` | email + WA + in-app | booker, agency, booking_contact | [booking.service.ts](../apps/api/src/services/booking.service.ts) |
| `BOOKING_FAILED` | email + WA + in-app | booker, agency | booking.service.ts |
| `BOOKING_CANCELLED` | email + WA + in-app | booker, agency | booking.service.ts |
| `HOLD_EXPIRY_WARNING` | WA + in-app | booker | [hold-expiry.worker.ts](../apps/api/src/queues/hold-expiry.worker.ts) |
| `TOPUP_SUCCEEDED` | email + WA + in-app | user, agency | [payment.service.ts](../apps/api/src/services/payment/payment.service.ts) |
| `TOPUP_FAILED` | email + in-app | user | payment.service.ts |
| `LOW_WALLET_BALANCE` | email + WA + in-app | agency | [wallet-monitor.worker.ts](../apps/api/src/queues/wallet-monitor.worker.ts) |
| `INSURANCE_ISSUED` | email + in-app | booker | [insurance/policy.service.ts](../apps/api/src/services/insurance/policy.service.ts) |
| `MANUAL_TOPUP_APPROVED` | email + in-app | requester | [wallet/topup.ts](../apps/api/src/services/wallet/topup.ts) |
| `MANUAL_TOPUP_REJECTED` | email + in-app | requester | wallet/topup.ts |
| `LOGIN_NEW_DEVICE` | email | user | [auth.service.ts](../apps/api/src/services/auth.service.ts) |
| `HOTEL_BOOKING_AWAITS_APPROVAL` | email + in-app | approver | tbo services |
| `HOTEL_BOOKING_APPROVED` | email + WA + in-app | booker | tbo services |
| `HOTEL_BOOKING_REJECTED` | email + in-app | booker | tbo services |
| `HOTEL_BOOKING_CONFIRMED` | email + WA + in-app | booker, booking_contact | tbo services |
| `HOTEL_BOOKING_FAILED` | email + in-app | booker | tbo services |
| `HOTEL_BOOKING_CANCELLED` | email + WA + in-app | booker | tbo services |
| `CIRCUIT_BREAKER_TRIPPED` | email | ops | [adapters/circuit-breaker.ts](../apps/api/src/adapters/circuit-breaker.ts) |
| `MANUAL_ISSUANCE_PENDING_REMINDER` | email | ops | [booking/manual-issuance-followup.service.ts](../apps/api/src/services/booking/manual-issuance-followup.service.ts) |
| `CREDIT_DUE_T_MINUS_3` / `T_MINUS_1` / `TODAY` / `OVERDUE` | email + (WA on urgent) + in-app | agency | [wallet/credit-due-reminder.service.ts](../apps/api/src/services/wallet/credit-due-reminder.service.ts) |
| `INCENTIVE_CREDITED` | email + in-app | agency | [di-incentive.worker.ts](../apps/api/src/queues/di-incentive.worker.ts) |
| `DISTRIBUTOR_TRANSFER_IN` | email + in-app | recipient | [wallet/distributor-transfer.service.ts](../apps/api/src/services/wallet/distributor-transfer.service.ts) |
| `MODULE_SWITCHED` | email + in-app | agency owner | [wallet/agency-config.service.ts](../apps/api/src/services/wallet/agency-config.service.ts) |
| `ADJUSTMENT_POSTED` | email + in-app | agency owner | [wallet/adjust-approval.service.ts](../apps/api/src/services/wallet/adjust-approval.service.ts) |
| **`PARTNER_INQUIRY_RECEIVED`** (Phase 2) | email | ops | [routes/inquiries.routes.ts](../apps/api/src/routes/inquiries.routes.ts) |
| **`RECON_DISCREPANCY_FOUND`** (Phase 3) | email | ops | [payment/reconciliation.service.ts](../apps/api/src/services/payment/reconciliation.service.ts) |

**PDFs attached automatically:**
- `BOOKING_CONFIRMED` → `eticket-{pnr}.pdf` (via `generateETicketPdf`)
- `HOTEL_BOOKING_CONFIRMED` → `hotel-invoice-{confirmationNo}.pdf` (via `generateHotelInvoicePdf` — voucher PDF doesn't exist yet, invoice is the more useful B2B artifact)

### Direct-SMTP paths (4 sites — kept on purpose)

These bypass the alert system because they need a synchronous response or run before any tenant context exists. All hardened in Phase 2.

| File | Purpose | Why direct |
|---|---|---|
| [services/password-reset.service.ts](../apps/api/src/services/password-reset.service.ts) | Reset link email | API caller needs to know the send happened. Failures `captureException` to Sentry + structured log. |
| [services/registration.service.ts](../apps/api/src/services/registration.service.ts) — `sendOtp` | Signup OTP | Caller needs the delivery result. Failures return `{ delivered: false }` → route surfaces 502 → UI shows "couldn't send the code". |
| [services/registration.service.ts](../apps/api/src/services/registration.service.ts) — approval / rejection emails | Welcome + rejection mail to applicants | Already async; failures write to `AgencyRegistration.reviewNotes` + Sentry. Admin can resend via `POST /api/v1/admin/registrations/:id/resend-welcome`. |
| [routes/admin-health.routes.ts](../apps/api/src/routes/admin-health.routes.ts) | `/health/smtp/test` test-send endpoint | Test send must echo the messageId synchronously. |

---

## Admin endpoints

All gated behind `SUPER_ADMIN`:

| Endpoint | Behaviour |
|---|---|
| `GET /api/v1/health/smtp` | `{ configured, reachable, host, latencyMs }` |
| `POST /api/v1/health/smtp/test` | Body: `{ to }`. Sends a test message. Returns `{ sent, messageId, durationMs }` |
| `GET /api/v1/health/smtp/stats` | Breakdown of `email_sent_total` by event × outcome, plus attachment counts |
| `POST /api/v1/admin/registrations/:id/resend-welcome` | Resends the welcome email for an approved registration. Does NOT re-mint the temp password. |

Public endpoints (unauthenticated, used by load-balancers):
- `GET /healthz` — liveness
- `GET /readyz` — readiness
- `GET /metrics` — Prometheus scrape

---

## New Prometheus metrics

| Name | Labels | Purpose |
|---|---|---|
| `email_sent_total` | `event`, `outcome` (sent/skipped/failed) | Alert on `rate(...{outcome="failed"}[5m]) > 0.1` |
| `email_send_duration_seconds` | `event`, `outcome` | p95 > 5s = provider degraded |
| `email_attachments_total` | `event` | Watch for inflation — every BOOKING_CONFIRMED ships a PDF now |

Existing metrics in [config/metrics.ts](../apps/api/src/config/metrics.ts) — `bookingEvents`, `walletEvents`, `searchLatency`, `httpRequests*` — untouched.

---

## Environment variables

```env
# Required to enable email at all
SMTP_HOST=smtp.gmail.com           # or smtp.resend.com / email-smtp.<region>.amazonaws.com
SMTP_PORT=465                       # 465 for SSL, 587 for STARTTLS
SMTP_SECURE=true                    # true for 465, false for 587
SMTP_USER=...
SMTP_PASS=...                       # provider app password — NOT account password
SMTP_FROM=TripBng <noreply@tripbng.com>
SMTP_REPLY_TO=trade@tripbng.com

# Required for ops-only alerts to actually go anywhere
OPS_ALERT_EMAIL=ops@tripbng.com
```

See [smtp-deployment.md](smtp-deployment.md) for provider-specific notes
(Gmail App Password, SES SMTP creds, Zoho, Resend).

---

## Current state (dev)

- Ethereal demo credentials in `apps/api/.env` (block flagged `# ─── DEMO`).
- Boot log: `smtp verify on boot · reachable: true`.
- Captured emails: log in at https://ethereal.email with `liuw3dftbonk6hgf@ethereal.email` / `dxjPyYhkch9wTJCceg`.

Swap-to-live procedure: see [smtp-deployment.md §6](smtp-deployment.md).

---

## Deferred items (intentional)

1. **Per-agency PDF-attachment toggle**. Currently every `BOOKING_CONFIRMED` email ships a PDF. Some agencies might want plain emails (forwarding adds size). Add `agency.notificationPrefs.attachETicket` (default `true`) if/when complaints land.
2. **Bounce handling**. No webhook ingestion. SES/Resend webhook handler is a v2 task — see [smtp-deployment.md §3](smtp-deployment.md#3-bounce-handling-v2--deferred).
3. **Hotel voucher PDF**. We attach the invoice PDF on `HOTEL_BOOKING_CONFIRMED` because no `generateHotelVoucherPdf` exists. Build one if guest-facing vouchers become a requirement; swap the template's `emailAttachments` hook to use it.
4. **Per-recipient send-time preference (digest mode)**. Some agencies might prefer a daily summary instead of per-event emails. Add `notificationPrefs.deliveryMode: 'immediate' | 'daily-digest'` if/when asked.
5. **`AGENCY_APPROVED` / `AGENCY_REJECTED` alert events**. The registration approval flow still uses direct SMTP. Could migrate to the alert system for consistency, but the current path is hardened — defer until there's a real reason.
6. **`FINANCE_ALERT_EMAIL` env var**. Recon discrepancies currently go to `OPS_ALERT_EMAIL`. Split when finance and ops staff diverge.

---

## Smoke-test checklist (run after credentials change)

```bash
# 1. Boot log shows reachable: true
pnpm -F @tripbng/api dev

# 2. Admin health endpoint
curl -H 'Authorization: Bearer <admin-jwt>' \
  http://localhost:4002/api/v1/health/smtp

# 3. Test send
curl -X POST -H 'Authorization: Bearer <admin-jwt>' -H 'Content-Type: application/json' \
  -d '{"to":"yourself@example.com"}' \
  http://localhost:4002/api/v1/health/smtp/test

# 4. Real flow — forgot password against a known user
curl -X POST -H 'Content-Type: application/json' \
  -d '{"email":"a-real-user@example.com"}' \
  http://localhost:4002/api/v1/auth/forgot-password

# 5. Real flow — partner inquiry
curl -X POST -H 'Content-Type: application/json' \
  -d '{"type":"AGENCY","companyName":"Test","fullName":"X","email":"x@y.com","mobile":"+919999999999"}' \
  http://localhost:4002/api/v1/inquiries

# 6. Real flow — confirm an existing HELD booking → confirms BOOKING_CONFIRMED + PDF attachment

# 7. Stats snapshot
curl -H 'Authorization: Bearer <admin-jwt>' \
  http://localhost:4002/api/v1/health/smtp/stats
```

---

## Sweeps that should pass

```bash
# All "SMTP not configured" hits are intentional dev-only fallbacks
git grep "SMTP not configured" -- 'apps/api/src/**/*.ts'

# No leftover TODOs
git grep -iE "TODO.*email|TODO-FINANCE" -- 'apps/api/src/**/*.ts'
# Expected: (nothing)

# Direct SMTP callsites are exactly the expected set
git grep -l "transport.sendMail\|getSmtpTransport()" -- 'apps/api/src/**/*.ts'
# Expected:
#   apps/api/src/config/smtp.ts
#   apps/api/src/services/alerts/channels/smtp.channel.ts
#   apps/api/src/services/password-reset.service.ts
#   apps/api/src/services/registration.service.ts
#   apps/api/src/routes/admin-health.routes.ts  (if tracked — currently untracked)
```
