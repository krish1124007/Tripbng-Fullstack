# Draft email to VFS Global B2B Partnerships

**Subject:** TripBng × VFS Global B2B API — integration kickoff + spec request

---

Hello [Account Manager Name],

We're [TripBng / Tankar Solutions Pvt Ltd], an Indian B2B travel
distribution platform serving ~[N] agencies. We'd like to integrate VFS
Global's visa-application API as the primary visa supplier for our
travel-agent portal.

To scope the integration we need a handful of specs.

---

## P0 — booking flow (blocking production cutover)

### 1. API base URL + authentication

- **Production + sandbox base URLs**.
- **Authentication scheme** — API key + secret (HMAC?), OAuth client
  credentials, or basic auth? Token TTL?
- **B2B account provisioning** — what do you need from us to issue
  credentials? IP whitelist requirements?

### 2. Pricing / quote endpoint

- Per-(country × purpose × applicant-count) quote: government fee +
  service fee + courier + biometrics surcharge + any urgent / fast-track
  surcharges.
- Currency — INR throughout, or do we convert from supplier-side rates?

### 3. Application submission

- **CreateApplication** endpoint — request body shape, required fields
  per applicant (passport details, contact, expected travel date,
  purpose).
- **Response** — application ID + applicant portal URL (does VFS host
  the document-upload flow, or do we?).
- **Idempotency** — if our network hiccups, is retry with the same
  client reference safe?

### 4. Document handling

- **Per-(country × purpose) document checklist** — is this exposed via
  the API, or do we maintain our own copy?
- **Document upload** — multipart REST endpoint, signed URL upload,
  or are documents collected entirely through the VFS portal? Max
  file size, accepted MIME types, photo specifications (resolution,
  background, headpos).
- **Document validation** — does VFS do a sync validation pass at
  upload time (reject blurry / wrong-MIME) or only at processing?

### 5. Status polling / webhooks

- **GetApplicationStatus** endpoint — request + response shape, polling
  cadence guidance.
- **Status enum** — full list of states VFS exposes (SUBMITTED,
  BIOMETRICS_DUE, IN_REVIEW, GRANTED, REJECTED, EXPIRED, WITHDRAWN, …).
- **Webhooks** — does VFS push state changes to a callback URL? If so,
  the signature scheme + retry policy.

### 6. Cancellation / withdrawal

- **WithdrawApplication** endpoint — at what states is withdrawal
  allowed?
- **Refund computation** — does VFS refund the service fee on
  withdrawal? What % depending on processing stage?

---

## P1 — needed within 4 weeks of go-live

7. **Biometrics-appointment scheduling** — if the visa requires an
   in-person VFS visit, do we book the slot via the API or does the
   applicant follow the portal flow self-service?
8. **Multi-applicant family applications** — can we submit a family
   group as a single VFS case, or is it N independent applications?
9. **Country / purpose / supplier-fee matrix** — a downloadable
   reference we can sync nightly (we currently maintain this manually).
10. **Error-code dictionary** — every code value, human description,
    retryability hint.
11. **Rate limits** — calls/sec, daily quotas, separate caps for
    create/upload/status endpoints.

---

## P2 — operational + compliance

12. **GST handling** — VFS service fee invoice format. Are tax invoices
    issued per application or monthly aggregate? CGST/SGST/IGST split?
13. **TDS** — is our agency required to deduct TDS on VFS service
    fees (s.194H commission or 194C contractor)?
14. **PCI / data-protection** — VFS's data residency, retention,
    deletion policy for applicant passport scans + photographs (we're
    DPDP Act compliant on our side).
15. **Sample applicant-facing screens** — so we can design the agency
    portal handoff UX coherently.

---

## What we have ready on our side

Our adapter is scaffolded at `apps/api/src/adapters/visa/vfs-visa.adapter.ts`
with the full lifecycle method signatures in place:

- `quote(req)` — pricing
- `getDocumentRequirements(req)` — per-country checklist
- `submitApplication(req)` — create case + return portal URL
- `uploadDocument(req)` — multipart upload pass-through
- `fetchStatus(supplierBookingRef)` — status polling
- `cancel(req)` — withdrawal

Currently every method throws `NOT_IMPLEMENTED` against the
`VFS_VISA_ENABLED=false` env gate. Once specs land we wire each method
behind the gate and gradually flip capabilities on per country / purpose.

Visa-supplier infrastructure on our side:
- VisaBooking model with `supplier: 'VFS' | 'MOCK_VISA' | 'EMBASSY' | 'CUSTOM'`
  discriminator — we'll start by routing only a pilot country (UAE / Thailand)
  through VFS and keep the rest on `MOCK_VISA` for ops handling
- DPDP-compliant PII handling — passport numbers encrypted at rest, never
  logged, never exposed to the frontend
- Audit log of every booking state transition (created → submitted →
  granted/rejected/cancelled)

---

## Timeline

We'd like a pilot agency live on a single country (e.g. UAE eVisa) within
**6 weeks**:

- Week 1–2 — receive P0 specs, wire quote + create + portal URL
- Week 3 — wire document upload + status polling
- Week 4 — pilot agency UAT against a single country
- Week 5 — production cutover for UAE
- Week 6+ — onboard additional countries (Thailand, Singapore, Schengen)

Happy to jump on a 30-min walkthrough if it'd be faster than email.

Thanks for the support.

Best,
[Your Name]
[Title]
TripBng
[Phone] · [Email]
