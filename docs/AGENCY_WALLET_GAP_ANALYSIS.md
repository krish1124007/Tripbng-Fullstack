# Agency Wallet System — Gap Analysis vs Existing Code

**Source spec:** `AGENCY_WALLET_SYSTEM.md` (delivered 2026-05-20, 13 sections, 10 implementation prompts).
**Existing repo at time of analysis:** `tripbng/main` HEAD.
**Purpose:** Single reference for what's already built vs. what the spec demands, plus open architectural decisions that will steer Phase-1+ implementation.

---

## 1. Repo layout reality check

The spec assumes a 3-app split — `apps/web-b2b`, `apps/web-admin`, `apps/api`. The actual repo has **one combined SPA at `apps/web`** (role-gated route tree) and **one API at `apps/api`**. Shared code lives in `packages/shared` (zod schemas + enums + permissions) and `packages/config` (eslint/tsconfig/tailwind presets).

There is **no `packages/shared-utils`** and no `@tripbng/agency-wallet` workspace — we use the existing `@tripbng/shared` package as the home for shared primitives.

**Decision implied for the implementation:** ignore the spec's `apps/web-b2b` / `apps/web-admin` split — keep one Next.js app, gate UI by role.

---

## 2. Money handling

| Item | Status |
|---|---|
| All amounts stored as integer paise | ✅ already in place (`walletBalance`, `creditLimit`, etc. are `Number`-paise) |
| Shared `Money` utility | ✅ built in Phase-1 step 1 at `packages/shared/src/money/` |
| `Paise = bigint` strict typing | ✅ in new module; legacy `number`-paise crosses through `fromNumberPaise`/`toNumberPaise` |
| `bignumber.js` dependency | ❌ not needed — `bigint` arithmetic + explicit rounding modes cover all cases |
| Existing `apps/web/src/lib/money.ts` helpers | Unchanged. The new `Money` module lives alongside; UI migration happens later |

---

## 3. Domain models — coverage

| Spec collection | Existing model | Coverage | Notes |
|---|---|---|---|
| `agencies` | `apps/api/src/models/Agency.ts` | **Partial** | Has tenantId, agencyCode, distributorId, creditLimit, outstandingAmount, creditBalance, paymentMethods{wallet,credit,deposit}, paymentTerms, status. Missing: `module` enum (CREDIT/DI/CASH/DISTRIBUTOR/SUB_AGENT), `parentAgencyId`, `isDistributor`, `bookingBlocked`, `blockReason` enum, `creditExpiryDate`, `creditDueDate`, `blockOnDueDateCross` |
| `wallets` | `apps/api/src/models/Wallet.ts` | **Partial / structural conflict** | Wallet exists with `balance`/`blockedBalance`/`creditLimit`/`creditUsed`/`version`. **But `Agency.walletBalance` is also maintained as a parallel projection** by `services/wallet/ledger.ts`. Two parallel balance stores — see Conflict 1. |
| `wallet_ledger` | `apps/api/src/models/WalletTransaction.ts` | **Partial** | Immutable, has `txnId`, `direction`, `amount`, `balanceAfter`, `relatedTxnId`. Missing: `bucket` (wallet vs credit), `balanceBefore`, `pgReferenceId`, `parentLedgerId` (currently `relatedTxnId`). Field naming: spec's `narration` is repo's `description`; spec's `performedByType` doesn't exist. |
| `credit_settlements` | none | **Missing** |
| `deposit_incentives` | `apps/api/src/models/Incentive.ts` | **Partial / semantics differ** | Existing is a tenant-wide campaign with slabs (PERCENT/FLAT, TDS, validFrom/To, target ALL/AGENCY_GROUP/DISTRIBUTOR_DOWNLINE). Spec wants per-agency config doc. |
| `distributor_transfers` | none (logic only) | **Missing model** | `services/wallet/transfer.ts` posts ledger entries directly — no transfer doc, no PENDING_APPROVAL state, no recall. |
| `rate_configurations` | `MarkupRule.ts`, `FareRule.ts` | **Partial / different shape** | Repo's markup + fare rules don't have spec's `module + scope + service + appliesTo` axis. |
| `audit_logs` | `apps/api/src/models/AuditLog.ts` | **✅ Fully covers** |
| `notifications_outbox` | `Notification.ts` + `alert-dispatch.worker.ts` | **Partial** | Outbox pattern approximated. No dedicated outbox table — alerts flow Notification doc → BullMQ worker → channel. |

Extra existing models worth knowing: `Distributor`, `AgencyGroup`, `ApprovalRequest`, `WebhookEvent`, `PaymentTransaction`, `PaymentGatewayConfig`, `TopupRequest`, `SettlementBatch`.

---

## 4. Services / business logic

| Area | Status |
|---|---|
| Payment waterfall (settle credit then top wallet) | ❌ not implemented |
| Booking debit | ✅ wallet-first + credit-overflow shape exists at `services/payment/wallet.service.ts` |
| DI incentive calc + TDS | ❌ Incentive model has slabs + tdsPercent but no service applies them on deposit |
| Refund handling | Partial — `services/amendment.service.ts` posts ledger entries; pro-rata credit/wallet reverse is missing |
| Module switching with pre-conditions | ❌ no `Agency.module` field exists |
| Auto-block (creditLimit/expiry/dueDate) | ❌ only `Agency.status === 'BLOCKED'` exists |
| Rate selection at booking time | Partial — `MarkupRule` + `FareRule` have their own selection, not aligned with spec |
| Distributor transfer with deterministic dual-lock | Partial — exists but no Redis lock, no PENDING_APPROVAL |
| Wallet integrity check job | ❌ Wallet has `lastReconciledAt`/`lastReconciledBalance` fields but no nightly job posts them |

---

## 5. API endpoints

| Spec namespace | Existing routes | Status |
|---|---|---|
| Agent `/me/wallet`, `/me/ledger`, `/me/statement`, `/me/credit/summary` | `/wallet/me`, `/wallet/transactions`, `/wallet/statement.pdf`, `/payments/wallet/me` | Partial — no `/me/credit/summary` |
| Distributor `/distributor/*` | `/distributors/me/*`, `/distributors/:id/downline`, `/wallet/transfers` | Partial — no `recall`, no sub-agent concept |
| Admin `/admin/*` config + reports + audit | `/admin/holidays`, `/admin/visa`, `/admin/tbo`, `/admin/registrations` | Most spec admin namespaces missing (module/credit-config/di-config/adjustments/transfers/rates/reports) |
| Internal `/internal/resolve-rate|reserve|commit|release|refund` | none — booking flow calls services in-process | ❌ |
| Payment webhooks | PhonePe `POST /payments/phonepe/webhook` ✅; ICICI Eazypay return-URL ✅ (no webhook by design) |

---

## 6. Workers / cron jobs

15 BullMQ workers active. Spec-relevant status:

| Spec cron | Existing equivalent | Status |
|---|---|---|
| Hourly recompute block status (CREDIT) | none | ❌ |
| Hourly credit-due reminder (T-3/-1/0/+3) | none | ❌ |
| 15-min PG reconciliation | `services/payment/reconciliation.service.ts` exists; no scheduler wired | Partial |
| Daily integrity check (ledger sum vs wallet) | `wallet-monitor.worker.ts` only watches low-balance | ❌ |
| Orphan reservation cleaner | `hold-expiry.worker.ts` per-minute (booking holds) | Partial |
| Async incentive credit | none | ❌ |
| Notification outbox drainer | `alert-dispatch.worker.ts` | ✅ wire-up only |

---

## 7. Admin UI (apps/web)

| Spec screen | Existing page | Status |
|---|---|---|
| Agency list (with module filter) | `(dashboard)/agencies/page.tsx` | Partial |
| Agency detail tabs (Overview/Wallet/Credit/DI/Ledger/Audit) | edit drawer only | ❌ no dedicated detail page |
| Credit dashboard with aging buckets | none | ❌ |
| DI dashboard (MTD/YTD/TDS) | `(dashboard)/incentives/page.tsx` (CRUD) | Partial — no dashboard view |
| Distributor tree | `(dashboard)/distributors/[id]`, `_downline-drawer.tsx` | Partial |
| Pending transfers queue | none | ❌ |
| Rate management CRUD | `(dashboard)/markup-rules/`, `(dashboard)/fare-rules/` | Partial — different model |
| Module switch wizard | none | ❌ |
| Audit trail with filters | `(dashboard)/audit-logs/page.tsx` | Partial — no export |
| Wallet (agent view) | `(dashboard)/wallet/page.tsx` + dialogs | ✅ |
| Top-ups | `(dashboard)/topups/page.tsx` | ✅ |

---

## 8. Payment integrations

| Gateway | Adapter | Webhook | Status |
|---|---|---|---|
| ICICI Eazypay | `apps/api/src/adapters/payment/icici-eazypay.provider.ts` + `crypto.ts` | Return URL only (Eazypay has no async webhook) | ✅ |
| PhonePe Standard Checkout V2 | `apps/api/src/adapters/payment/phonepe.provider.ts` | `POST /payments/phonepe/webhook` with X-VERIFY + raw-body parsing | ✅ |
| Razorpay | present | — | (out of spec) |
| Manual provider | present | — | (out of spec) |

Webhook idempotency via `WebhookEvent` dedupe collection. Reconciliation service exists at `services/payment/reconciliation.service.ts` but not wired into a BullMQ repeat job.

---

## 9. Notifications

| Template | Status |
|---|---|
| `LOW_WALLET_BALANCE` (≈ spec WALLET_LOW_BALANCE) | ✅ exists |
| `MANUAL_TOPUP_APPROVED` (partial overlap with ADJUSTMENT_POSTED) | ✅ exists |
| `BOOKING_CONFIRMED` / `BOOKING_FAILED` / `BOOKING_CANCELLED` | ✅ exists |
| `TOPUP_SUCCEEDED` / `TOPUP_FAILED` | ✅ exists |
| `HOLD_EXPIRY_WARNING`, `INSURANCE_ISSUED`, `LOGIN_NEW_DEVICE`, `CIRCUIT_BREAKER_TRIPPED` | ✅ exists |
| `CREDIT_DUE_T_MINUS_3`, `CREDIT_DUE_TODAY`, `CREDIT_OVERDUE`, `CREDIT_LIMIT_WARN` | ❌ missing |
| `INCENTIVE_CREDITED`, `DISTRIBUTOR_TRANSFER_IN`, `BOOKING_BLOCKED`, `MODULE_SWITCHED` | ❌ missing |

---

## 10. Conflicts & gotchas

### Conflict 1 — Two parallel balance stores
`services/wallet/ledger.ts` writes `Agency.walletBalance` (and `Distributor.walletBalance`) via `$inc`. The dedicated `Wallet` collection has `balance` + `version` but is **only read** by `services/payment/wallet.service.ts`. Two sources of truth. Spec demands ONE.

**Resolution options:**
- (A) Make `Wallet` the only source. Migrate `ledger.ts` to write Wallet, remove `Agency.walletBalance`. Requires backfill script + booking-flow regression test.
- (B) Keep `Agency.walletBalance` as source, deprecate `Wallet.balance`, remove `Wallet` model.
- (C) Defer; point new code at `Wallet` and live with both temporarily.

**Open — needs decision before Phase-1 step 6 (ledger migration).**

### Conflict 2 — Distributor vs Sub-agent
Repo treats `Distributor` as a separate collection from `Agency`. Spec wants `Agency.module=DISTRIBUTOR` with `parentAgencyId` linking sub-agents to parents (both rows in `Agency`).

**Resolution options:**
- (A) Keep `Distributor` collection, add a thin `module` field on `Agency`, treat distributor-as-agency lookup as a join.
- (B) Migrate `Distributor` into `Agency` with the module enum. Bigger change.

**Open — needs decision before any UI/reporting that treats distributor + sub-agent uniformly.**

### Conflict 3 — Role naming
`ROLES` in `packages/shared/src/enums.ts` is `SUPER_ADMIN`/`DISTRIBUTOR`/`AGENCY`/`SUB_AGENT`/`SUPPLIER`/`ACCOUNTS_USER`/`SUPPORT_AGENT`. Spec uses `ADMIN`. **Recommend keeping `SUPER_ADMIN`** — used everywhere in auth/RBAC/seed. Update future spec docs to match.

### Other gotchas
- `Tenancy guard plugin` (`models/plugins/tenancy-guard.ts`) auto-scopes every query by `tenantId` — every new wallet collection MUST include `tenantId` and respect the plugin.
- `Agency.paymentMethods` is a tri-flag (`wallet/credit/deposit`) — overlaps with spec's mutually-exclusive `module` enum. Needs consolidation.
- `WALLET_TXN_TYPE` enum in `packages/shared/src/enums.ts` lacks spec-required types: `CREDIT_SETTLEMENT`, `DEPOSIT_INCENTIVE`, `TDS_DEDUCT`, `DUE_BLOCK_REVERSAL`.
- Codes (`apps/api/src/utils/codes.ts`) issue IDs via `Counter` model — new wallet code generation should reuse this.

---

## 11. Phase-1 implementation plan (adapted)

Decided plan, in order. Items marked **[needs decision]** are blocked on the conflicts above.

| # | Task | Status | Risk |
|---|---|---|---|
| 1 | `packages/shared/src/money` — `Money` utility (bigint, percent, formatINR, rounding modes) | ✅ done | low |
| 2 | `apps/api/src/utils/wallet-lock.ts` — `withWalletLock` (SET NX PX + Lua release) | ✅ done | low |
| 3 | `apps/api/src/utils/mongo-txn.ts` — `withMongoTxn` + `updateWalletWithVersion` | ✅ done | low |
| 4 | Extend `Agency` schema — `module`, `parentAgencyId`, `bookingBlocked`, `blockReason`, `creditExpiryDate`, `creditDueDate`, `blockOnDueDateCross` (purely additive) | pending | low (additive only) |
| 5 | Extend `WALLET_TXN_TYPE` enum + `WalletTransaction` schema — `bucket`, `balanceBefore`, `pgReferenceId`, new types (`CREDIT_SETTLEMENT`, `DEPOSIT_INCENTIVE`, `TDS_DEDUCT`) | pending | low (additive only) |
| 6 | **Migrate `ledger.ts` to write Wallet, not Agency.walletBalance** | **[needs decision — Conflict 1]** | high |
| 7 | `WaterfallService.applyPayment` — wired into PhonePe webhook + ICICI return-URL handler | pending | medium (depends on #6) |
| 8 | Daily integrity cron — recompute Wallet balances from ledger, alert on drift | pending | low |

After Phase-1, downstream phases:
- Phase-2: DI incentive worker + TDS ledger entries
- Phase-3: Distributor transfer doc + approval gating + recall **[needs decision — Conflict 2]**
- Phase-4: `RateConfiguration` + `/internal/resolve-rate`
- Phase-5: Admin UI for module/credit-config/dashboards
- Phase-6: Missing notification templates + Reports

---

## 12. Definition of Phase-1 done

- ✅ Money utility (52/52 tests across this + lock + txn)
- ✅ Redis lock helper
- ✅ Mongo txn helper + optimistic version check
- Agency schema extended (steps 4-5 pending architecture decisions)
- Ledger migrated to single source of truth (step 6 pending Conflict 1 decision)
- Waterfall service live (step 7)
- Daily integrity cron live with zero drift (step 8)
