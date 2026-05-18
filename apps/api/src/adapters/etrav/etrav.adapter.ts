// EtravAdapter — implements the SupplierAdapter contract for eTrav's Air API.
//
// Phase 1 status:
//   ✓ search       — Air_Search wired live
//   ✓ fareRule     — Air_FareRule (extra method, exposed via /flights/farerule route)
//   ✓ reprice      — Air_Reprice (extra method, called from booking confirm flow)
//   ✗ hold         — needs Air_TempBooking spec (analysis §3 step 6)
//   ✗ ticket       — needs Air_Ticketing spec (analysis §3 step 8)
//   ✗ cancel       — needs Air_Cancellation spec (analysis §3 step 12)
//   ✗ retrieveBooking — needs Air_History spec (analysis §3 step 10)
//
// When eTrav sends the missing 14 specs, swap each NotImplementedError throw
// with the real wire call. The rest of the pipeline (registry, fanoutSearch,
// pricing engine, booking model) doesn't need to change.

import { BaseAdapter } from '../base.js';
import {
  SupplierAdapterError,
  type Capability,
  type HealthStatus,
  type NormalizedBookingDetails,
  type NormalizedCancelRequest,
  type NormalizedCancelResponse,
  type NormalizedFareOption,
  type NormalizedHoldRequest,
  type NormalizedHoldResponse,
  type NormalizedPassenger,
  type NormalizedSearchRequest,
  type NormalizedSearchResponse,
  type NormalizedTicketRequest,
  type NormalizedTicketResponse,
} from '../types.js';
import { EtravFlightClient, type EtravClientConfig } from './client.js';
import {
  buildEtravSearchRequest,
  mapFlightAndFareToOption,
  unpackEtravFareToken,
} from './transforms.js';
import {
  EtravPaxType,
  type EtravAirFareRuleResponse,
  type EtravAirRepriceResponse,
  type EtravAirSearchResponse,
  type EtravBookingPaxDetail,
} from './types.js';

export class EtravAdapter extends BaseAdapter {
  readonly code = 'ETRAV';
  readonly name = 'eTrav Aggregator';
  // SEARCH + HOLD live as of May-2026 (TempBooking + Ticketing(0) discovered
  // by probing staging). BOOK/CANCEL/RETRIEVE wire when AddPayment specs land.
  readonly capabilities: readonly Capability[] = ['SEARCH', 'HOLD'];

  // Override the BaseAdapter 3 s default — international flight searches via
  // an aggregator routinely take 8–15 s as they fan out to multiple suppliers.
  // The fanoutSearch in registry.ts uses Promise.allSettled, so a slow eTrav
  // doesn't block the rest of the supplier set; this just lets it complete.
  protected override readonly timeoutMs = 18_000;

  private readonly client: EtravFlightClient;

  constructor(config: EtravClientConfig) {
    super();
    this.client = new EtravFlightClient(config);
  }

  // ────────── Search (Phase 1) ──────────

  async search(req: NormalizedSearchRequest): Promise<NormalizedSearchResponse> {
    return this.guarded('search', async () => {
      const body = buildEtravSearchRequest(req);
      const res: EtravAirSearchResponse = await this.client.search(body);

      // Flatten TripDetails[].Flights[].Fares[] → one NormalizedFareOption per
      // (flight × fare) tuple. Different fare bundles for the same flight
      // become independent options the user can pick between.
      const options: NormalizedFareOption[] = [];
      for (const trip of res.TripDetails ?? []) {
        for (const flight of trip.Flights ?? []) {
          for (const fare of flight.Fares ?? []) {
            options.push(mapFlightAndFareToOption(flight, fare, { searchKey: res.Search_Key }));
          }
        }
      }
      return { options };
    });
  }

  // ────────── Extra methods (not in SupplierAdapter contract) ──────────

  /**
   * Fetch the HTML fare-rule blob for a previously-returned fare. Exposed via
   * a dedicated route — the UI renders the HTML in a sandboxed iframe (per
   * analysis §4.2). The supplierFareToken carries Search_Key, Flight_Key,
   * and Fare_Id packed by `packEtravFareToken`.
   */
  async fareRule(supplierFareToken: string): Promise<EtravAirFareRuleResponse> {
    return this.guarded('fareRule', async () => {
      const { searchKey, flightKey, fareId } = unpackEtravFareToken(supplierFareToken);
      return this.client.fareRule({
        Search_Key: searchKey,
        Flight_Key: flightKey,
        Fare_Id: fareId,
      });
    });
  }

  /**
   * Revalidate fare + availability before booking. Mandatory before TempBooking
   * once that lands. Returns the (possibly updated) fare + Required_PAX_Details
   * which drives our dynamic passenger form.
   */
  async reprice(input: {
    supplierFareTokens: string[];
    customerMobile: string;
    gstInput?: boolean;
    singlePricing?: boolean;
  }): Promise<EtravAirRepriceResponse> {
    return this.guarded('reprice', async () => {
      // All tokens must share the same Search_Key.
      const unpacked = input.supplierFareTokens.map((t) => unpackEtravFareToken(t));
      const searchKey = unpacked[0]?.searchKey;
      if (!searchKey) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          'Reprice called with no fare tokens',
          this.code,
        );
      }
      if (unpacked.some((u) => u.searchKey !== searchKey)) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          'All fares must come from the same search session',
          this.code,
        );
      }
      return this.client.reprice({
        Search_Key: searchKey,
        AirRepriceRequests: unpacked.map((u) => ({
          Flight_Key: u.flightKey,
          Fare_Id: u.fareId,
        })),
        Customer_Mobile: input.customerMobile,
        GST_Input: input.gstInput ?? false,
        SinglePricing: input.singlePricing ?? true,
      });
    });
  }

  // ────────── Hold (live — discovered May-2026) ──────────
  //
  // The hold flow chains two eTrav calls:
  //   1. Air_TempBooking → returns Booking_RefNo (the eTrav-side handle)
  //   2. Air_Ticketing(Ticketing_Type=0) → registers the "Hold attempt"
  //      that keeps the seats reserved until either AddPayment + Issue
  //      (Ticketing_Type=1) is called or the hold TTL expires (~15-30 min).
  //
  // The booking service caches Booking_RefNo on the Booking row; ticket()
  // will issue against it once AddPayment specs land (Phase next).

  async hold(req: NormalizedHoldRequest): Promise<NormalizedHoldResponse> {
    return this.guarded('hold', async () => {
      const { searchKey, flightKey, fareId } = unpackEtravFareToken(req.supplierFareToken);

      if (!req.passengers || req.passengers.length === 0) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          'eTrav hold requires at least one passenger',
          this.code,
        );
      }
      if (!req.contact?.email || !req.contact?.mobile) {
        throw new SupplierAdapterError(
          'BAD_REQUEST',
          'eTrav hold requires contact email + mobile',
          this.code,
        );
      }

      const tb = await this.client.tempBooking({
        BookingFlightDetails: [{ Search_Key: searchKey, Flight_Key: flightKey, Fare_Id: fareId }],
        Passenger_Email: req.contact.email,
        Passenger_Mobile: stripCountryCode(req.contact.mobile),
        PAX_Details: req.passengers.map(toEtravPaxDetail),
      });

      const bookingRef = tb.Booking_RefNo;
      if (!bookingRef) {
        throw new SupplierAdapterError(
          'UPSTREAM',
          'eTrav TempBooking succeeded but returned no Booking_RefNo',
          this.code,
        );
      }

      // Step 2 — Hold attempt. For LCC carriers (where Block_Ticket_Allowed=true)
      // this registers the seat reservation; for GDS it puts the booking in a
      // hold state until ticketing. Either way the call is cheap + non-financial.
      // We swallow a "Hold Attempt is Already created" error since a duplicate
      // attempt isn't a real failure — the underlying TempBooking is intact.
      try {
        await this.client.ticketing({
          Booking_RefNo: bookingRef,
          Ticketing_Type: 0,
        });
      } catch (err) {
        if (err instanceof SupplierAdapterError && /already created/i.test(err.message)) {
          // Idempotency on retry — fine, hold is intact.
        } else {
          throw err;
        }
      }

      // eTrav doesn't surface an explicit expiry timestamp on TempBooking. The
      // typical TTL is 15-30 min depending on inventory class — we conservatively
      // surface 15 min so the booking row's expiry is never optimistic.
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      return {
        supplierBookingRef: bookingRef,
        expiresAt,
        // PNR is only assigned at ticketing time (Issue mode). Hold-only state
        // returns no PNR; the booking row will be updated when ticket() runs.
        pnr: undefined,
      };
    });
  }

  // ────────── Ticketing (still gated on AddPayment specs) ──────────
  //
  // ticket() requires:
  //   1. AddPayment endpoint specs (URL confirmed at /tradehost/.../AddPayment;
  //      RefNo field confirmed; remaining Amount/Currency_Code shape pending
  //      from eTrav account manager — see EMAIL_DRAFT.md).
  //   2. A funded eTrav agent wallet to debit.
  //
  // Once AddPayment lands, ticket() chains:
  //   AddPayment(refNo, amount) → Air_Ticketing(refNo, Ticketing_Type=1) →
  //   maps PNR + ticket numbers from the success response.

  async ticket(_req: NormalizedTicketRequest): Promise<NormalizedTicketResponse> {
    throw new SupplierAdapterError(
      'BAD_REQUEST',
      'eTrav ticketing not yet wired — AddPayment field shape pending from account manager (see apps/api/src/adapters/etrav/EMAIL_DRAFT.md)',
      this.code,
    );
  }

  async cancel(_req: NormalizedCancelRequest): Promise<NormalizedCancelResponse> {
    throw new SupplierAdapterError(
      'BAD_REQUEST',
      'eTrav cancel (Air_Cancellation) not yet implemented — spec pending from account manager',
      this.code,
    );
  }

  async retrieveBooking(_ref: string): Promise<NormalizedBookingDetails> {
    throw new SupplierAdapterError(
      'BAD_REQUEST',
      'eTrav retrieveBooking (Air_History) not yet implemented — spec pending from account manager',
      this.code,
    );
  }

  // ────────── Health check ──────────

  async healthCheck(): Promise<HealthStatus> {
    // No documented health endpoint on eTrav. As a cheap proxy, we run a
    // tiny search (BLR→DEL one-way, 7 days out) with a short timeout. If it
    // returns with Error_Code "0000" we consider the supplier healthy.
    // Skipping for Phase 1 — too expensive to run periodically without
    // confirmation that probing this way is welcome by their rate-limit policy.
    return { ok: true, message: 'health probe not yet wired (rate-limit policy unconfirmed)' };
  }
}

// ────────── Local helpers ──────────

/** Map our normalised passenger to eTrav's PAX_Details row shape. */
function toEtravPaxDetail(p: NormalizedPassenger): EtravBookingPaxDetail {
  const detail: EtravBookingPaxDetail = {
    Title: normaliseTitle(p.title),
    First_Name: p.firstName,
    Last_Name: p.lastName,
    Pax_type: paxTypeToEnum(p.type),
    DOB: p.dateOfBirth ? toDdMmYyyy(p.dateOfBirth) : '',
  };
  if (p.gender) detail.Gender = p.gender;
  if (p.nationality) detail.Nationality = p.nationality;
  if (p.passport) {
    detail.Passport_Number = p.passport.number;
    detail.Passport_Issuing_Country = p.passport.issuingCountry;
    detail.Passport_Expiry = toDdMmYyyy(p.passport.expiry);
  }
  return detail;
}

function paxTypeToEnum(t: NormalizedPassenger['type']): EtravPaxType {
  if (t === 'CHILD') return EtravPaxType.Child;
  if (t === 'INFANT') return EtravPaxType.Infant;
  return EtravPaxType.Adult;
}

function normaliseTitle(t: string): string {
  // eTrav accepts MR / MRS / MS / MSTR / MISS — uppercase, no punctuation.
  return t
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

function toDdMmYyyy(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = dt.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Strip "+91" / "0091" / leading "+" from incoming mobile so eTrav sees the
 *  bare 10-digit national number it expects. */
function stripCountryCode(mobile: string): string {
  return mobile.replace(/^(\+?91|0091)/, '').replace(/[^\d]/g, '');
}
