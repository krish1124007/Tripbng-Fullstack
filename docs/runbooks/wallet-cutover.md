# Wallet waterfall cutover runbook

Owner: Wallet platform team
Target: switching `paymentService.markSuccess` from `walletService.credit`
(legacy CASH-only) to `waterfall.applyPayment` (full module-aware split).
Status: **shadow phase** — `SHADOW_WALLET=true` runs in observation mode;
this runbook is the path to flipping the live path.

References:
- Spec: `CLAUDE.md` §4 (settlement waterfall) and §18 (migration plan)
- Gap analysis: `docs/AGENCY_WALLET_GAP_ANALYSIS.md`
- Code: `apps/api/src/services/wallet/waterfall.service.ts`
- Backfill: `apps/api/scripts/migrations/2026-05-20-backfill-agency-module.ts`

---

## 0. What this changes

| | Today (legacy) | After cutover (waterfall) |
|---|---|---|
| CASH agency receives ₹X | Wallet += ₹X | Wallet += ₹X (no behaviour change) |
| CREDIT agency, no outstanding | Wallet += ₹X | Wallet += ₹X (no behaviour change) |
| CREDIT agency, ₹Y outstanding | Wallet += ₹X | Outstanding −= min(X,Y); Wallet += (X − min(X,Y)) |
| DI agency receives ₹X | Wallet += ₹X | Wallet += ₹X; async job adds incentive + TDS rows |
| SUB_AGENT receives ₹X | Wallet += ₹X | Wallet += ₹X (no behaviour change) |

The only customer-visible behaviour change is for **CREDIT agencies with
outstanding credit**, and **DI agencies** (incentive starts crediting
automatically). CASH and SUB_AGENT settlement is unchanged.

---

## 1. Pre-cutover checklist

Run sequentially. Don't skip — each item gates the next.

### 1.1 Backfill agency module values

```bash
# Dry-run first — read counts, no writes.
pnpm -F @tripbng/api tsx scripts/migrations/2026-05-20-backfill-agency-module.ts

# Inspect the log output. Confirm:
#   - byTargetModule.CREDIT  matches the count of credit-line agencies you expect
#   - byTargetModule.DI       matches the active DI-config rows you expect
#   - byTargetModule.SUB_AGENT matches sub-agent count
#   - skippedNonCash is anything that already has an admin override

# Apply.
pnpm -F @tripbng/api tsx scripts/migrations/2026-05-20-backfill-agency-module.ts --apply
```

**Stop condition:** if the dry-run plan doesn't match your DB count
expectations, do NOT apply. Walk it back to finance + the gap analysis
doc first.

### 1.2 Backfill wallet collection

```bash
# Creates a Wallet doc for every agency/distributor that doesn't have one.
# Idempotent. Required because the waterfall reads Wallet, not Agency.walletBalance.
pnpm -F @tripbng/api exec tsx src/scripts/backfill-wallet-collection.ts --dry-run
pnpm -F @tripbng/api exec tsx src/scripts/backfill-wallet-collection.ts
```

### 1.3 Reconciliation must be clean

Run the integrity check and confirm zero drift between cached
`Agency.walletBalance` and the authoritative `Wallet.balance` + ledger
sum:

```bash
pnpm -F @tripbng/api tsx -e \
  "import('./src/services/wallet/integrity-check.service.js').then(m => m.runIntegrityCheck()).then(r => console.log(JSON.stringify(r, null, 2)))"
```

**Stop condition:** any non-zero `mismatchCount` blocks the cutover.
Investigate per-agency mismatches before continuing — they indicate
a legacy write path that skipped the ledger.

### 1.4 Enable shadow mode and observe for 2 weeks

```env
SHADOW_WALLET=true
```

This is set in `.env` (dev/staging) and via the deploy config in prod.

Observe `shadow.waterfall: simulation completed` log lines daily.
Pivot on:
- `module`: distribution across CREDIT / DI / CASH / SUB_AGENT
- `wouldHaveDiverged: true` — count and inspect a sample. These are
  the payments where the waterfall would have produced a different
  split. For CREDIT-module agencies with outstanding credit, divergence
  is expected and correct; for any other module, investigate.
- `shadow.waterfall: simulation failed` — should be 0. If non-zero,
  the waterfall has a defect that must be fixed before cutover.

**Stop condition:** any unexpected divergence, or any simulation
failure, blocks the cutover.

---

## 2. Cutover window

Schedule a 30-minute maintenance window. Communicate to agents 24h ahead.

### 2.1 T-5 min — freeze new bookings + new top-ups

Redis-backed kill-switch — no redeploy, instant effect:

```bash
# Set the cutover kill-switch. The booking + topup + transfer routes
# consult this at request-entry; with it set, all three return 503 with
# a `Retry-After` header and a `{ code: 'CUTOVER_FREEZE', reason: ... }`
# JSON envelope until cleared. TTL is the maintenance window length in
# seconds (1800 = 30 min).
redis-cli SET wallet:cutover:freeze "in-progress" EX 1800
```

Wiring lives in `apps/api/src/middleware/cutover-freeze.ts`; it's
mounted on every wallet-mutating POST in `booking.routes.ts`,
`bus-bookings.routes.ts`, `wallet.routes.ts`, and `payments.routes.ts`.
Webhook + payment-advice routes deliberately do NOT consult the
kill-switch so in-flight payments can drain during the window.

Sanity check the freeze is engaged after setting the key:

```bash
curl -i -X POST https://api.tripbng.com/api/v1/wallet/topup \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amountPaise": 100, "paymentMode": "BANK"}'
# Expect 503 + Retry-After header + body.error.code = "CUTOVER_FREEZE"
```

### 2.2 T-0 — verify in-flight payments are drained

```bash
# Any PENDING / PROCESSING PaymentTransactions older than 30s must
# settle (SUCCESS or FAILED) before the swap.
pnpm -F @tripbng/api tsx -e "
import('./src/models/PaymentTransaction.js').then(async ({ PaymentTransaction }) => {
  const stale = await PaymentTransaction.find({
    status: { \$in: ['PENDING', 'PROCESSING'] },
    initiatedAt: { \$lt: new Date(Date.now() - 30_000) },
  }).countDocuments();
  console.log({ stalePayments: stale });
  process.exit(stale > 0 ? 1 : 0);
});
"
```

If non-zero, run `paymentService.sweepStalePayments` and re-check.

### 2.3 T+0 — flip the live-path flag

The waterfall and legacy paths both live in `markSuccess`; selection
is env-flag driven. No code deploy at cutover — just flip the flag.

```env
WATERFALL_LIVE=true
```

How to apply: update the deploy config (Doppler / Infisical / AWS
Parameter Store / etc.) and roll restart the API. The flag is read
once at boot via `apps/api/src/config/env.ts`. Workers that touch
`markSuccess` (the payment-webhook worker + the reconciliation
sweep) need the same restart to pick the new value.

Sanity check after restart — every successful payment should now log
`creditPath: "waterfall"` for agency-attributed PTs:

```bash
# Tail the API log for the next ₹1 top-up
kubectl logs deploy/tripbng-api -f | grep "payment success" | head -3
# Expect: ..."creditPath":"waterfall","waterfallApplied":true...
```

Distributor-attributed PTs (no agencyId on the PT) keep going through
the legacy `walletService.credit` path under the flag — the waterfall
service only knows about agencies. That's by design; expect to see a
mix of `creditPath: "waterfall"` and `creditPath: "legacy"` in the
log stream.

If anything looks off, instant rollback is `WATERFALL_LIVE=false` +
roll restart. No data migration, no code revert.

### 2.4 T+5 — disable shadow mode

```env
SHADOW_WALLET=false
```

The shadow-mode log path is auto-suppressed when `WATERFALL_LIVE=true`
(it would be diffing against a baseline that no longer exists), so
forgetting this step is benign — just leaves a dead config value.

### 2.5 T+10 — release the freeze

```bash
redis-cli DEL wallet:cutover:freeze
```

### 2.6 T+15 — smoke test

- Initiate a ₹100 top-up from a known CASH agency. Verify wallet +₹100.
- Initiate a ₹100 top-up from a known CREDIT agency with ₹50
  outstanding. Verify outstanding → 0 (₹50 settled), wallet +₹50.
- Initiate a ₹1,000 top-up from a known DI agency. Verify wallet
  +₹1,000 immediately, then ~30s later verify the incentive +TDS
  ledger rows posted by the async worker.

---

## 3. Post-cutover monitoring (first 48h)

| Signal | Where | Threshold |
|---|---|---|
| Failed `applyPayment` calls | API logs `waterfall: payment applied` (look for absence) + error rate | < 0.1% of payment volume |
| DI-incentive worker backlog | BullMQ `di-incentive` queue depth | < 100 |
| Integrity-check drift | Daily cron output | 0 mismatches |
| Customer support tickets mentioning "credit not settled" or "incentive missing" | Helpdesk | 0 |

Have on-call ready for the first 24h. Pager rotation must know:
- The runbook is here
- Rollback is **§4 below** (revert + replay)
- `SHADOW_WALLET=true` can be re-enabled instantly if behaviour looks off
  (it doesn't roll back the swap; it just turns the comparison logging
  back on)

---

## 4. Rollback

Rollback is a code revert + a small DB cleanup. The waterfall writes are
genuine ledger entries — they don't get "undone" by reverting code.
Instead we replay the difference back into the wallet to restore the
legacy semantics, then revert.

### 4.1 Freeze again

```bash
redis-cli SET wallet:cutover:freeze "rolling-back" EX 1800
```

### 4.2 Flip the flag back

```env
WATERFALL_LIVE=false
```

Roll restart API + workers. The legacy `walletService.credit` branch
remains in the file as the rollback safety net — no code revert
needed, no deploy.

### 4.3 Replay any waterfall-only side effects

For every CREDIT-module agency that saw an `applyPayment` call during
the cutover window, the outstanding got reduced. Legacy code never
touches outstanding, so the agency now has a "free" wallet credit.
This is **acceptable for short cutover windows** (< 2 hours) — finance
absorbs the gap; ops just needs an audit list:

```bash
pnpm -F @tripbng/api tsx -e "
import('./src/models/CreditSettlement.js').then(async ({ CreditSettlement }) => {
  const since = new Date(Date.now() - 7200_000); // 2h
  const rows = await CreditSettlement.find({
    createdAt: { \$gte: since },
    amountAppliedToCredit: { \$gt: 0 },
  }).lean();
  console.log(JSON.stringify(rows, null, 2));
});
"
```

Hand the JSON to finance for manual reconciliation. Do **not** try to
auto-revert ledger entries — `WalletTransaction` is append-only by
design.

### 4.4 Release the freeze

```bash
redis-cli DEL wallet:cutover:freeze
```

---

## 5. Known unknowns (close before next attempt)

- `SHADOW_WALLET=true` logs are at `info` level. Consider routing
  them to a dedicated index/topic in your log aggregator so the
  daily review query is one filter, not a regex over all info logs.
- Distributor-attributed PTs stay on the legacy `walletService.credit`
  path even with `WATERFALL_LIVE=true`. If you ever need credit-
  settlement / DI semantics for distributors, the waterfall service
  needs a `walletKind: 'DISTRIBUTOR'` mode — currently it's
  agency-only by design.
