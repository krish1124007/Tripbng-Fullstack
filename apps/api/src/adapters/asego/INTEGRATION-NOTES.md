# ASEGO B2B Travel Insurance — Integration Notes

Source of truth: `asego-b2b-openapi.json` v2.0 (provided May 2026). Types in
`adapters/asego/types.ts` mirror the OpenAPI 1:1 — refresh both together.

## End-to-end status (May 2026 sandbox)

| Endpoint | Status | Notes |
|---|---|---|
| `GET /currency` | ✅ Working | full master |
| `GET /category` | ✅ Working | 7 categories incl. Domestic |
| `GET /plan/masterDetails/{partnerId}` | ✅ Working | 9 plans for our partner |
| `GET /plan/{partnerId}?duration=&age=&category=` | ✅ Working | Live priced quote |
| `GET /reasons/{type}` | ❌ Sandbox 500 | `{code:500,msg:null}` — confirm in production |
| `POST /encryption/encrypt` | ✅ Working | Body `{value, key, initVector}` |
| `POST /encryption/decrypt` | ✅ Working | Same body shape |
| `POST /createPolicy/validate/{partnerId}` | ✅ Working | Encrypted body, `valid=true` against the live sandbox |
| `POST /createPolicy/{partnerId}` | 🟡 Sandbox 500 (`code 159`) | Validate succeeds with same payload — issue throws generic ISE. Needs ASEGO to confirm whether sandbox's `IC Smart Domestic Plan` is issuable, or share a known-good fixture. |
| `POST /endorsePolicy/{partnerId}` | ⏳ Phase 4 | Types defined |
| `POST /cancelPolicy/{partnerId}` | ⏳ Phase 4 | Types defined |
| `GET /download?filePath=` | ⏳ Wired, untested | Streams binary to client; needs a real `policyFilePath` from issue |

## Confirmed wire format (per OpenAPI)

### Encryption helpers — `{value, key, initVector}`

```jsonc
POST /ext/b2b/v1/encryption/encrypt
Content-Type: application/json
{
  "value": "<plaintext or ciphertext>",
  "key": "<32-char UTF-8>",
  "initVector": "<16-char UTF-8>"
}
→ 200 text/plain, body is the cipher- or plaintext directly (no envelope)
```

Earlier discovery probes failed because we sent `{data: ...}` — the OpenAPI spec
clarified the required shape. Both directions of the parity test now pass clean.

### `createPolicy` + `createPolicy/validate` — array of ExternalPolicy, encrypted

Both endpoints want a JSON array of per-traveler `ExternalPolicy` envelopes,
encrypted as AES-256-CBC + Base64 + PKCS7, sent as the raw ciphertext string
in the body with `Content-Type: text/plain`.

```jsonc
[
  {
    "identity":     { /* orderId, sign, reference, partnerId, branchSign?, branchName? */ },
    "selectedPlan": {
      "insurerId":     "...",
      "totalPremium":  500.0,
      "plan": {
        "sellingPlanId": "<from /plan/masterDetails — field is `planId` there>",
        "agePremiums":   { "age": 36, "premium": 500.0 },
        "riders":        [ /* { percent, riderName, rateType, riderAmount } */ ]
      }
    },
    "quotation": {
      "travelCategory": "<UUID from /category>",
      "startDate":      "2026-05-11",
      "duration":       8,
      "endDate":        "2026-05-18",
      "destination":    "Goa"
    },
    "traveler": {
      "name":          "Test Buyer",          // single string, NOT first/last separate
      "passport":      "M1234567",            // ^[A-Z]\d{7}$
      "dob":           "1990-01-15",
      "address":       "1 Test Lane",
      "mobileNo":      "9999999999",
      "email":         "test@tripbng.dev",
      "city":          "New Delhi",
      "district":      "New Delhi",
      "state":         "Delhi",
      "pincode":       "110001",
      "country":       "India",
      "finalPremium":  500.0,
      "age":           36,
      "gender":        "M",
      "nominee":       "Self Buyer",          // STRING (nominee name)
      "relation":      "Self"                 // SEPARATE top-level field
    },
    "otherDetails": { "policyComment": "" }
  }
  // ... one entry per traveler
]
```

### Things easy to get wrong

- **`selectedPlan.plan` is nested**, not top-level. The "plan field is null" error
  means `selectedPlan.plan` is missing, not that there should be a `plan` field
  next to `selectedPlan`.
- **`traveler.name` is one string**, not first/middle/last. The mapper composes
  it from our domain's split fields.
- **`traveler.nominee` is a string** (the nominee's full name).
- **`traveler.relation` is a sibling of `nominee`**, not nested inside it.
- **`title` is not on the wire** — drop it. The OpenAPI lists no `title` field.
- **`quotation.travelCategory`** (not `category`).
- **`otherDetails.policyComment`** (not `remarks`).
- The master endpoint `/plan/masterDetails/{partnerId}` returns `planId` — that
  same value is what `createPolicy.selectedPlan.plan.sellingPlanId` expects.

## Open questions for ASEGO support

1. `createPolicy/{partnerId}` returns `code 159 "Internal Server Error, Please
   verify request details is valid., Error - null"` for the same payload that
   `createPolicy/validate/{partnerId}` accepts (`valid=true`). Is the sandbox's
   `IC Smart Domestic Plan` (planId `09a2766d-2860-422a-99ea-2ea9cc14781b`)
   currently issuable, or is there a known issue? Can you share a known-good
   fixture (plan + traveler) that issues cleanly on staging?
2. `GET /reasons/cancellation` and `GET /reasons/endorsement` return
   `{code:500, msg:null}` on the sandbox. Are these populated in production, or
   should we hit a different endpoint?
3. Production endpoint URL + IP whitelisting process?
4. Per-partner rate limits (req/sec, req/day)?
5. Webhook support for policy status changes, or pull-only?
6. Cancellation charge calculation rules (slabs by days-from-start)?
7. Senior citizen flow (age > 80) — separate plan family?
8. Maximum group size for the `createPolicy` array?
9. Idempotency semantics — does `identity.orderId` honor as a dedup key on
   retries, or do we need to manage retries entirely on our side?
10. PDF availability — is `policyFilePath` immediately downloadable post-issue,
    or eventually consistent (do we need a polling delay)?
