# ICICI Eazypay → ICICI Orange PG migration

Status: **code complete and mergeable**. Implementation validated against the ICICI spec file (`Initiate Pay Request & Response.txt`):
- HashText computation matches the spec verbatim (line 47) — sort by param name asc, concat non-empty values, no separators.
- Algorithm follows HMAC-SHA-256 hex-lowercase as documented.
- The spec's printed final secureHash (`205a2c...10b`) does not reproduce via standard HMAC across 30+ tried variants — almost certainly a doc typo. UAT round-trip is the ultimate verification.

## What changed

### Removed
- `apps/api/src/adapters/payment/icici-eazypay.provider.ts` (entire provider)
- `apps/api/src/adapters/payment/razorpay.provider.ts` (adapter — unused)
- `apps/api/src/services/wallet/razorpay.ts` (legacy direct-Razorpay wallet flow)
- `apps/api/tests/razorpay-provider.test.ts`
- `EAZYPAY_*` and `RAZORPAY_*` env vars
- `checkout.razorpay.com` / `api.razorpay.com` from production CSP
- Eazypay/Razorpay UI from `_topup-dialog.tsx` and `payment-method-dialog.tsx`

### Added
- `apps/api/src/adapters/payment/icici-orange-pg/`
  - `crypto.ts` — V1 (`secureHashV1` / `verifySecureHashV1`) and V2 (`secureHashV2`) hash helpers
  - `types.ts` — request/response shapes, `ORANGE_PG_CODES` map, `txnDateIST()`, `paiseToWireAmount()`, `sanitiseMerchantTxnNo()`
  - `api.ts` — `initiateSale`, `statusCheck`, `refund`, `settlementStatus`, `settlementSummary`
  - `webhook.ts` — `parseReturnUrl` + `parseAdvice` (both verify V1 hash)
  - `provider.ts` — `IciciOrangePgProvider` implementing the `PaymentProvider` interface
- New routes:
  - `POST /api/v1/payments/icici-orange/return` — browser POST after gateway flow
  - `POST /api/v1/payments/icici-orange/advice` — S2S notification (always 200)
- Migration script: `apps/api/scripts/migrations/2026-05-20-rename-icici-eazypay-to-orange-pg.ts`

### Renamed
- `ICICI_EAZYPAY` → `ICICI_ORANGE_PG` across:
  - `apps/api/src/adapters/payment/types.ts` (`PaymentProviderCode` union)
  - `apps/api/src/models/PaymentTransaction.ts` (`PAYMENT_PROVIDER` tuple)
  - `packages/shared/src/schemas/payments.ts` (`PAYMENT_PROVIDER` + `TOPUP_METHOD`)
  - Models reuse `PAYMENT_PROVIDER` so `PaymentGatewayConfig` + `WebhookEvent` get the rename for free
- `RAZORPAY` dropped from `packages/shared/src/enums.ts` `PAYMENT_MODE` tuple

## Environment variables

```env
# Required to enable Orange PG (env fallback only; prod uses PaymentGatewayConfig in DB)
ICICI_ORANGE_PG_ENV=UAT                       # or PROD
ICICI_ORANGE_PG_MERCHANT_ID=
ICICI_ORANGE_PG_AGGREGATOR_ID=
ICICI_ORANGE_PG_KEY=                          # HMAC secret — never log, never ship to FE
ICICI_ORANGE_PG_RETURN_URL=https://api.tripbng.com/v1/payments/icici-orange/return
ICICI_ORANGE_PG_ADVICE_URL=https://api.tripbng.com/v1/payments/icici-orange/advice

# UAT endpoints (defaults — switch to prod hosts when issued)
ICICI_ORANGE_PG_INITIATE_SALE_URL=https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale
ICICI_ORANGE_PG_COMMAND_URL=https://pgpayuat.icicibank.com/tsp/pg/api/command
ICICI_ORANGE_PG_SETTLEMENT_DETAILS_URL=https://pgpayuat.icicibank.com/tsp/pg/api/settlementDetails
ICICI_ORANGE_PG_USER_CANCEL_URL=https://pgpayuat.icicibank.com/tsp/pg/api/userCancel
```

UAT test credentials (per the original migration prompt — confirm before use):
- Merchant ID: `100000000007164`
- Aggregator ID: `A100000000007164`
- Key: `db06cca0-838b-4e01-8b20-6ac446ffb6bd`

UAT test instruments:
- Card: `4761 3400 0000 0035`, exp `07/26`, CVV `123`, OTP `0035`
- NetBanking: CC Avenue Test Bank
- UPI VPA: `test@ybl`

## Runtime configuration (production)

Production credentials live in `PaymentGatewayConfig` (Mongo), not env. The registry hydrates per-(tenantId, providerCode, environment); see [registry.ts](../apps/api/src/adapters/payment/registry.ts).

The `credentials` field on `PaymentGatewayConfig` should contain:
```json
{
  "merchantId": "…",
  "aggregatorID": "…",
  "key": "…",
  "adviceURL": "…",                // optional — falls back to env
  "initiateSaleUrl": "…",          // optional
  "commandUrl": "…",                // optional
  "settlementDetailsUrl": "…",     // optional
  "userCancelUrl": "…"             // optional
}
```

Encrypted at rest (AES-256-GCM) via the existing `encryptedCredentials` field — same pattern as PhonePe.

## Migration script

```bash
# Dry run — counts only, no writes
pnpm -F @tripbng/api tsx scripts/migrations/2026-05-20-rename-icici-eazypay-to-orange-pg.ts

# Apply — bulk-update PaymentTransaction, PaymentGatewayConfig, WebhookEvent
pnpm -F @tripbng/api tsx scripts/migrations/2026-05-20-rename-icici-eazypay-to-orange-pg.ts --apply
```

Idempotent — re-running is a no-op. **Snapshot the DB before applying** if there are real Eazypay rows.

## Cron jobs

- **Status reconciliation** — `paymentService.sweepStalePayments` (existing). Iterates PENDING/PROCESSING PTs > 30 min, calls `provider.fetchStatus()`. No change needed — works as-is for Orange PG via the registry.
- **Settlement reconciliation** — `reconciliation.service.ts` (existing). CSV-driven from `SettlementBatch`. The new `settlementStatus` API client is available for a future programmatic-polling cron; not wired yet (intentionally — see "Deferred" below).

## Deprecated alias to remove

None. The enum was renamed cleanly and the migration script handles legacy `ICICI_EAZYPAY` rows in Mongo. The 410 Gone stub for the old return URL was removed at cutover.

## Rollback plan

1. `git revert` the merge commit (or the individual Phase 1/2/C commits).
2. Re-run the migration script in **reverse** — manually, since the script is one-way. The safer move is to run the original script's reverse query: `db.paymenttransactions.updateMany({providerCode:'ICICI_ORANGE_PG'},{$set:{providerCode:'ICICI_EAZYPAY'}})` and same for `paymentgatewayconfigs` and `webhookevents`.
3. Restore env vars (`EAZYPAY_*` block — see git blame on `.env.example`).
4. Restore the gateway config rows in `PaymentGatewayConfig` — they were renamed in place, no data loss.

## Open items (NOT done — intentional deferrals)

1. **UAT end-to-end test** — manual. Initiate ₹100 top-up → confirm redirect → use test card → confirm wallet credit + e-ticket. Repeat with NetBanking + UPI. Status check + refund. Documented but unrunnable from code. If the first call returns a hash-mismatch error, expose the request body via the existing structured log line and compare against ICICI's reference Java/PHP code — the algorithm description is verified, but a byte-encoding nuance could surface.
3. **Production credentials** — issued by ICICI relationship manager.
4. **IP allowlisting** — submit our static egress IPs to ICICI.
5. **Return URL + advice URL whitelisting** — register with ICICI's panel.
6. **Payment Advice content type** — confirm during onboarding whether the bank will post `application/x-www-form-urlencoded` or `application/json` to `/icici-orange/advice` (parser supports both).
7. **Settlement cron** — `settlementStatus` API client is built but no cron polls it yet. The existing CSV-based recon (`reconciliation.service.ts`) covers the same ground; defer the programmatic poller until ops decides which they prefer.
8. **Rate limiting** — concurrent in-flight cap per `merchantId`. Defer until first production traffic justifies it.
9. **`responseCode` enrichment** — `ORANGE_PG_CODES` has the success codes (`000`/`0000`/`R1000`). Add failure codes as they're observed in UAT.
10. **Admin gateway-config UI** — this repo has no admin app; `PaymentGatewayConfig` rows are managed via direct DB writes / API. If/when an admin UI lands, the form should expose: `merchantId`, `aggregatorID`, `key` (write-only/masked), `returnURL` (read-only/derived), `adviceURL` (read-only/derived), `environment` (UAT/PROD).

## Anti-patterns to refuse (verbatim from the migration prompt)

- Do not put the merchant key in any frontend bundle or any log line.
- Do not trust the return URL as the source of truth — Payment Advice + Status Check are authoritative.
- Do not omit `aggregatorID` from any request — we are an aggregator merchant.
- Do not use `payType: "1"` (Direct/Seamless) — that requires card details on our domain and triggers PCI scope. We are redirect-only.
- Do not mix V1 and V2 hashing — V1 for everything except `userCancel`, `getCardBin`, `getServiceCharges`.
- Do not send `amount` as a number — always string `"100.00"`.
- Do not retry a failed `initiateSale` with the same `merchantTxnNo` — generate a new one (the spec says `merchantTxnNo` must be unique).
- Do not call ICICI APIs from the Next.js frontend. All calls go through `apps/api`.

## File map

```
apps/api/src/adapters/payment/icici-orange-pg/
├── crypto.ts                  # V1 + V2 hash + verify (+ buildHashText)
├── types.ts                   # request/response shapes + response codes
├── api.ts                     # initiateSale, statusCheck, refund, settlement*
├── webhook.ts                 # parseReturnUrl + parseAdvice
├── provider.ts                # IciciOrangePgProvider
└── index.ts                   # public exports

apps/api/tests/
└── icici-orange-pg-crypto.test.ts  # 9 passing (HashText validated vs spec)

apps/api/src/routes/payments.routes.ts
├── POST /icici-orange/return   # browser redirect (urlencoded)
└── POST /icici-orange/advice   # S2S (urlencoded or JSON)

apps/api/scripts/migrations/
└── 2026-05-20-rename-icici-eazypay-to-orange-pg.ts
```
