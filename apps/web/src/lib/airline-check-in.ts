// Airline web-check-in deep-link directory.
//
// Each airline has its own check-in URL pattern + a window during which
// check-in is open (varies by carrier — domestic Indian carriers
// typically allow 48h before departure, internationals 24h).
//
// We hand the agent a button that opens the airline's check-in page in
// a new tab. Some carriers pre-fill PNR + last name via query params;
// some don't. When we can't pre-fill, we still open the landing page
// — the agent types the PNR manually. That's still strictly better
// than the agent guessing the URL.
//
// Maintenance
// -----------
// URL templates here are FROZEN strings — airlines change them rarely
// (cite: Indigo's check-in URL has been stable since 2017). When a
// carrier changes their URL, update the entry here. We never call into
// the airline API; this is purely a click-through directory.
//
// Sources verified at time of authoring:
//   • IndiGo:   https://www.goindigo.in/web-check-in.html
//   • Air India: https://www.airindia.com/in/en/manage/web-check-in.html
//   • Vistara:  (merged into Air India — same flow)
//   • SpiceJet: https://www.spicejet.com/Pages/CheckIn.aspx
//   • Akasa Air: https://www.akasaair.com/manage-booking
//   • Air India Express: https://www.airindiaexpress.com/en/manage/web-check-in
//   • Vistara: (now AI)
//   • Go First: (defunct — removed)
//   • Emirates: https://www.emirates.com/in/english/manage-booking/online-check-in.aspx
//   • Etihad:   https://www.etihad.com/en-in/manage/check-in
//   • Singapore Airlines: https://www.singaporeair.com/en_UK/in/plan-travel/check-in/
//   • Lufthansa: https://www.lufthansa.com/in/en/online-check-in
//   • Qatar:    https://www.qatarairways.com/en-in/checkin.html

export interface AirlineCheckInEntry {
  /** IATA code — index key. */
  code: string;
  /** Display name. */
  name: string;
  /** URL template. `{pnr}` and `{lastName}` placeholders are
   *  URL-encoded at substitution time. When the carrier doesn't accept
   *  query params, omit the placeholders — the agent types into the
   *  landing-page form manually. */
  urlTemplate: string;
  /** Hours before departure the check-in window opens. Domestic
   *  Indian carriers: 48h. International: 24-48h. */
  opensHoursBefore: number;
  /** Hours before departure the check-in window CLOSES. Most carriers
   *  cut off 45-60 min before departure. */
  closesHoursBefore: number;
  /** True when the URL template uses query-param substitution
   *  (pre-fills PNR / last name). Drives the UI hint. */
  prefillsForm: boolean;
}

/** Maps IATA carrier code → check-in directory entry. Lookups are
 *  uppercase-normalised. */
const DIRECTORY: Record<string, AirlineCheckInEntry> = {
  '6E': {
    code: '6E',
    name: 'IndiGo',
    urlTemplate: 'https://www.goindigo.in/web-check-in.html?pnr={pnr}&lastName={lastName}',
    opensHoursBefore: 48,
    closesHoursBefore: 1,
    prefillsForm: true,
  },
  AI: {
    code: 'AI',
    name: 'Air India',
    urlTemplate: 'https://www.airindia.com/in/en/manage/web-check-in.html',
    opensHoursBefore: 48,
    closesHoursBefore: 2,
    prefillsForm: false,
  },
  IX: {
    code: 'IX',
    name: 'Air India Express',
    urlTemplate: 'https://www.airindiaexpress.com/en/manage/web-check-in',
    opensHoursBefore: 48,
    closesHoursBefore: 2,
    prefillsForm: false,
  },
  SG: {
    code: 'SG',
    name: 'SpiceJet',
    urlTemplate: 'https://book.spicejet.com/Manage.aspx?PNR={pnr}',
    opensHoursBefore: 48,
    closesHoursBefore: 1,
    prefillsForm: true,
  },
  QP: {
    code: 'QP',
    name: 'Akasa Air',
    urlTemplate: 'https://www.akasaair.com/manage-booking',
    opensHoursBefore: 48,
    closesHoursBefore: 1,
    prefillsForm: false,
  },
  EK: {
    code: 'EK',
    name: 'Emirates',
    urlTemplate: 'https://www.emirates.com/in/english/manage-booking/online-check-in.aspx',
    opensHoursBefore: 48,
    closesHoursBefore: 1.5,
    prefillsForm: false,
  },
  EY: {
    code: 'EY',
    name: 'Etihad Airways',
    urlTemplate: 'https://www.etihad.com/en-in/manage/check-in',
    opensHoursBefore: 30,
    closesHoursBefore: 1.5,
    prefillsForm: false,
  },
  SQ: {
    code: 'SQ',
    name: 'Singapore Airlines',
    urlTemplate: 'https://www.singaporeair.com/en_UK/in/plan-travel/check-in/',
    opensHoursBefore: 48,
    closesHoursBefore: 1.5,
    prefillsForm: false,
  },
  LH: {
    code: 'LH',
    name: 'Lufthansa',
    urlTemplate: 'https://www.lufthansa.com/in/en/online-check-in',
    opensHoursBefore: 23,
    closesHoursBefore: 1,
    prefillsForm: false,
  },
  QR: {
    code: 'QR',
    name: 'Qatar Airways',
    urlTemplate: 'https://www.qatarairways.com/en-in/checkin.html',
    opensHoursBefore: 48,
    closesHoursBefore: 1.5,
    prefillsForm: false,
  },
};

export function lookupAirlineCheckIn(code: string | null | undefined): AirlineCheckInEntry | null {
  if (!code) return null;
  return DIRECTORY[code.toUpperCase()] ?? null;
}

export interface CheckInWindowStatus {
  /** True when departure is within the carrier's check-in window. */
  open: boolean;
  /** Reason — surfaced in the UI tooltip when closed. */
  reason: 'OPEN' | 'TOO_EARLY' | 'CLOSED' | 'DEPARTED';
  /** Convenient strings for the UI. */
  opensAt: Date | null;
  closesAt: Date | null;
}

/**
 * Decide whether the check-in window is currently open. We branch on
 * three states explicitly so the UI tooltip can be specific ("opens in
 * 6h" vs "closed — departed").
 */
export function checkInWindow(
  entry: AirlineCheckInEntry,
  departure: Date,
  now: Date = new Date(),
): CheckInWindowStatus {
  const opensAt = new Date(departure.getTime() - entry.opensHoursBefore * 60 * 60 * 1000);
  const closesAt = new Date(departure.getTime() - entry.closesHoursBefore * 60 * 60 * 1000);
  if (now < opensAt) return { open: false, reason: 'TOO_EARLY', opensAt, closesAt };
  if (now > departure) return { open: false, reason: 'DEPARTED', opensAt, closesAt };
  if (now > closesAt) return { open: false, reason: 'CLOSED', opensAt, closesAt };
  return { open: true, reason: 'OPEN', opensAt, closesAt };
}

/**
 * Build the deep-link URL with PNR + last-name placeholders substituted.
 * URL-encodes both values; falls back to the bare template when the
 * carrier doesn't accept query params (entry.prefillsForm=false).
 */
export function buildCheckInUrl(
  entry: AirlineCheckInEntry,
  pnr: string,
  lastName: string,
): string {
  if (!entry.prefillsForm) return entry.urlTemplate;
  return entry.urlTemplate
    .replace('{pnr}', encodeURIComponent(pnr))
    .replace('{lastName}', encodeURIComponent(lastName));
}
