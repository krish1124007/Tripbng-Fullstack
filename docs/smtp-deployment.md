# SMTP Deployment Notes

This is the operational playbook for the SMTP / email pipeline. The
implementation itself is documented in [smtp-integration-handoff.md](smtp-integration-handoff.md) —
this file covers what to do BEFORE and AFTER you flip the live credentials.

---

## 1. Domain DNS — set before pointing live traffic at the sender

These records prevent the platform's email from being filed straight into
Spam. Set them on **the sending domain** (the part after `@` in `SMTP_FROM`).

| Record | Type | Value | Purpose |
|---|---|---|---|
| `tripbng.com` | TXT (SPF) | `v=spf1 include:_spf.google.com include:amazonses.com ~all` | Lists who's allowed to send as `@tripbng.com`. The `include:` clauses come from the provider's docs — Google Workspace, Zoho, SES, etc. all publish theirs. |
| `default._domainkey.tripbng.com` | TXT (DKIM) | provider-specific public key | Cryptographic signing. Workspace publishes the key in Admin Console → Apps → Gmail → Authenticate email; SES publishes via the SES console; Zoho via Mail Admin → Domain → DKIM. |
| `_dmarc.tripbng.com` | TXT (DMARC) | `v=DMARC1; p=none; rua=mailto:dmarc@tripbng.com; pct=100` | Lets you observe what's hitting your domain before tightening the policy. Start at `p=none`, watch the aggregate reports for two weeks, then tighten to `p=quarantine` → `p=reject`. |

Verify with:
```bash
dig +short TXT tripbng.com           # SPF
dig +short TXT default._domainkey.tripbng.com   # DKIM
dig +short TXT _dmarc.tripbng.com    # DMARC
```

---

## 2. Provider-specific setup

### Gmail / Google Workspace (`smtp.gmail.com:465`)

1. Enable 2-factor authentication on the sender account
   (`techsupport@tripbng.com`).
2. Generate an **App Password** at https://myaccount.google.com/apppasswords
   — pick "Mail" → "Other" → name it "TripBng API".
3. Google returns a 16-char code formatted as `abcd efgh ijkl mnop`. Either
   strip the spaces or keep them — both are accepted.
4. Drop into `SMTP_PASS`.

**Rate limits**:
- Personal Gmail: 500 messages/day
- Google Workspace: 2 000 messages/day (Business Starter), 10 000 on higher SKUs
- Per-recipient rate-limit: 500/day to any single external address

If you cross the daily cap, the SMTP server returns `421 4.7.0 Try again later` and we keep retrying via BullMQ — but every retry burns the next day's allowance. Switch to a transactional provider before you hit this.

### AWS SES (`email-smtp.<region>.amazonaws.com:587`)

1. Verify the sending domain in the SES console.
2. Publish the DKIM CNAMEs SES gives you.
3. **Request production access** — new SES accounts are sandboxed (can only send to verified recipients). The unlock review takes ~24h and asks for a description of the use case ("Transactional emails to TripBng B2B agents — booking confirmations, top-up receipts, OTPs, ops alerts").
4. Create an IAM user with `AmazonSESFullAccess`, generate **SMTP credentials** (NOT regular IAM keys — SMTP creds are derived via SES's hashing tool).
5. Drop those into `SMTP_USER` / `SMTP_PASS`.

**Rate limits**:
- Sandbox: 200/24h, 1/sec
- Production: 50 000/day default, scales on request, sustained 14/sec

### Zoho Mail (`smtp.zoho.in:465`)

1. Generate an **App Password** in Zoho Mail → Settings → Mail Accounts → Security.
2. Personal: 200/day. ZohoMail Lite: 2 000/day. Higher tiers scale.
3. **Caution**: Zoho is the cheapest provider with usable deliverability, but their support is unresponsive — don't pick this if you can't tolerate a 48h+ resolution time on bounces.

### Resend (`smtp.resend.com:465` — recommended for transactional)

1. Sign up at https://resend.com — verify domain ownership via the dashboard.
2. Generate an API key — use as `SMTP_PASS` with `SMTP_USER=resend`.
3. Free tier: 3 000/month, 100/day. Paid tiers from $20/mo for 50k/mo.
4. Built specifically for transactional sends; deliverability is excellent.

---

## 3. Bounce handling (v2 — deferred)

Currently bounces are visible only in the provider's dashboard. The pipeline
treats every `sendMail` that didn't throw as a successful send — we don't
ingest the asynchronous bounce notification.

When this becomes a real problem (signs: agencies reporting they didn't
receive emails the dashboard says were sent), wire one of:

| Provider | Bounce notification path |
|---|---|
| SES | SNS topic → API webhook → store in `BounceSuppression` collection |
| Resend | Webhook on `email.bounced` → same |
| Gmail / Workspace / Zoho | No webhook — would need IMAP polling of the bounce folder (don't) |

For now, the rule is: **don't deploy a provider without a bounce path
unless you're OK eating the silence on bounces**. The existing pipeline
will continue to send to permanently-bouncing addresses forever.

---

## 4. Daily ops checklist (first 7 days post-cutover)

```bash
# 1. Read the SMTP stats endpoint
curl -H 'Authorization: Bearer <admin-jwt>' \
  http://api.tripbng.com/api/v1/health/smtp/stats

# 2. Scrape Prometheus for failed-send counts
curl http://api.tripbng.com/metrics | grep -E 'email_sent_total{.+outcome="failed"'

# 3. Check the alert dispatch worker for backlog
redis-cli -h <prod-redis> XLEN bull:alert-dispatch:wait
redis-cli -h <prod-redis> XLEN bull:alert-dispatch:failed
```

**Red flags to act on:**
- `email_sent_total{outcome="failed"}` increases by > 5 in any 5-minute window → page on-call
- `alert-dispatch:failed` queue > 50 → SMTP provider has a sustained outage
- `email_send_duration_seconds` p95 > 5s → either the provider is degraded or DNS is flapping
- Any `forgot-password: SMTP send failed` in logs → captured to Sentry already, but a sudden spike means someone deployed bad creds

---

## 5. Rotating credentials

1. Generate the new App Password / API key from the provider dashboard.
2. Update `SMTP_PASS` in the prod environment (Doppler / Vault / wherever).
3. Restart the API pods one at a time. Each one logs
   `smtp verify on boot · reachable: true` (or `false` — that's your signal to revert).
4. After all pods are on the new key, delete the old App Password in the provider.

Never overlap two valid passwords in production for more than a few hours — leaked credentials are the single most common cause of email-provider compromise.

---

## 6. Going from Ethereal demo → live

The current setup uses Ethereal Email — fake SMTP that captures messages
at https://ethereal.email. To swap to live:

1. Pick a provider (Gmail / Resend / SES — see §2).
2. Replace the `SMTP_*` block in `apps/api/.env`. The Ethereal block is
   commented as `# ─── DEMO: Ethereal Email — fake SMTP ...` so it's
   obvious which lines to swap.
3. Restart the API. Boot log should show `smtp verify on boot · reachable: true`
   against your new host.
4. Hit `/api/v1/health/smtp/test` (admin-only) with your own email → confirm
   delivery + check your inbox.
5. Trigger a real flow (forgot-password against your account) → confirm
   delivery again.
6. Set the DNS records from §1.
