// Kafila uses THREE different date formats in one booking flow.
// Don't mix them up — vendor returns vague errors when fields disagree.
//
//   1. Search + booking request bodies (KflSector.departureDate,
//      KflAirportRef.date): DD-MM-YYYY  e.g. `15-08-2026`
//   2. Traveller DOB / passport issue/expiry (KflPassportDetails,
//      KflTravellerDetail.dob): YYYY-MM-DD  e.g. `1990-04-22`
//   3. Ticket issuedDate in CreatePnr / retriveBooking responses:
//      DDMMMYY  e.g. `10FEB26`
//
// Time format is always HH:MM (24h) in KflAirportRef.time — no
// timezone marker, treat as IST for domestic and as the airport's
// local time for international (vendor doesn't disambiguate).

/** Format a Date as DD-MM-YYYY (the search/booking format). */
export function toKafilaSearchDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  return `${dd}-${mm}-${yyyy}`;
}

/** Format a Date as YYYY-MM-DD (the DOB / passport format). */
export function toKafilaDob(date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const MONTH_NAMES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

/** Parse DDMMMYY (ticket issuedDate) into a Date (UTC). Returns null on
 *  bad input — caller decides whether that's fatal. */
export function parseKafilaIssuedDate(s: string): Date | null {
  // `10FEB26` → day=10, mon='FEB', yr='26' (assume 20xx for two-digit).
  const m = /^(\d{2})([A-Z]{3})(\d{2})$/.exec(s.trim().toUpperCase());
  if (!m) return null;
  const day = parseInt(m[1]!, 10);
  const monIdx = MONTH_NAMES.indexOf(m[2] as (typeof MONTH_NAMES)[number]);
  if (monIdx < 0) return null;
  const year = 2000 + parseInt(m[3]!, 10);
  return new Date(Date.UTC(year, monIdx, day));
}

/** Combine Kafila's `date` (DD-MM-YYYY) + `time` (HH:MM) into an ISO-8601
 *  string. We treat the result as a *local* wall-clock time at the
 *  airport — Kafila doesn't send a timezone. Downstream code that needs
 *  true UTC can re-resolve via airport→tz lookup; for now we encode it
 *  with no offset (`...:00`) so consumers know it's wall-clock. */
export function toIsoLocalDateTime(dateDdMmYyyy: string, timeHhMm: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dateDdMmYyyy);
  if (!m) {
    // Unparseable: return the raw concatenation so the caller can decide.
    // This is the conservative move — silently substituting `now` would
    // mask vendor protocol violations.
    return `${dateDdMmYyyy}T${timeHhMm}`;
  }
  const [, dd, mm, yyyy] = m;
  const hhmm = /^\d{2}:\d{2}$/.test(timeHhMm) ? timeHhMm : '00:00';
  return `${yyyy}-${mm}-${dd}T${hhmm}:00`;
}

/** Duration parser for Kafila's `travelTime` / `flyingTime` fields.
 *  Vendor returns strings like `"02:35"` (HH:MM) or `"155"` (minutes,
 *  rare). Returns minutes — caller stores as integer minutes. Returns
 *  0 on unparseable input rather than throwing; surfacing a partial
 *  result beats failing the whole search response. */
export function parseKafilaDurationToMinutes(input: string | undefined | null): number {
  if (!input) return 0;
  const trimmed = input.trim();
  const colon = /^(\d{1,3}):(\d{2})$/.exec(trimmed);
  if (colon) {
    const h = parseInt(colon[1]!, 10);
    const m = parseInt(colon[2]!, 10);
    return h * 60 + m;
  }
  const num = parseInt(trimmed, 10);
  return Number.isFinite(num) ? num : 0;
}
