// Pure utilities — auth header builder + the three AirIQ date formats.
// No I/O — unit-testable in isolation.

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

// ────────── Custom Basic Auth ──────────

/**
 * Build the AirIQ Authorization header value.
 *
 * AirIQ does NOT use RFC 7617 — the format is `Base64(<AgentID>*<Username>:<Password>)`.
 * Note the asterisk between AgentID and Username, colon before Password.
 * Doc-confirmed example: `AGENTID*MOBILENO:PASSWORD` → `QUdFTlRJRCpNT0JJTEVOTzpQQVNTV09SRA==`.
 */
export function buildAirIQAuthHeader(agentId: string, username: string, password: string): string {
  const raw = `${agentId}*${username}:${password}`;
  return Buffer.from(raw, 'utf-8').toString('base64');
}

// ────────── Dates ──────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Date in IST as plain components (no Date arithmetic at the use site). */
function inIST(d: Date): { y: number; m: number; day: number; h: number; mi: number } {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(), // 0–11
    day: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
  };
}

/**
 * Three date formats live in one API — keep them strictly typed (§2.5):
 *   FlightDate         → "yyyymmdd"
 *   DepartureDateTime  → "DD MMM YYYY HH:MM"
 *   DOB / Passport     → "DD/MM/YYYY"
 *
 * `fromDateTime` is used to bring AirIQ's "DD MMM YYYY HH:MM" payload back to
 * an ISO 8601 string (we tag it `+05:30` since the API is India-hosted).
 */
export const DateAdapter = {
  toFlightDate(d: Date | string): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    const { y, m, day } = inIST(dt);
    return `${y}${String(m + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  },

  toDateTime(d: Date | string): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    const { y, m, day, h, mi } = inIST(dt);
    return `${String(day).padStart(2, '0')} ${MONTH_ABBR[m]} ${y} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  },

  toPassportDate(d: Date | string): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    const { y, m, day } = inIST(dt);
    return `${String(day).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${y}`;
  },

  /** "15 Jun 2026 09:30" → ISO 8601 with IST offset. Falls back to current ISO on parse failure. */
  fromDateTime(s: string): string {
    const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (!m) {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
    const [, dd, monAbbr, yyyy, hh, mi] = m;
    const monIdx = MONTH_ABBR.findIndex((x) => x.toLowerCase() === monAbbr!.toLowerCase());
    if (monIdx < 0) return new Date().toISOString();
    return `${yyyy}-${String(monIdx + 1).padStart(2, '0')}-${dd!.padStart(2, '0')}T${hh!.padStart(2, '0')}:${mi}:00+05:30`;
  },

  fromFlightDate(s: string): Date {
    const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return new Date(NaN);
    return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+05:30`);
  },
};

// ────────── Token TTL ──────────

/**
 * Compute seconds remaining until 23:59:59 IST today.
 * AirIQ tokens are documented as valid "until end of day (IST)" — we cache to
 * exactly that boundary minus a 60s safety margin so we refresh proactively.
 */
export function secondsUntilEndOfDayIST(now: Date = new Date()): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const eod = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 23, 59, 59, 0),
  );
  // Convert eod-as-IST back to a UTC instant.
  const eodUtcMs = eod.getTime() - IST_OFFSET_MS;
  const remainingMs = eodUtcMs - now.getTime();
  if (remainingMs <= 0) return 0;
  return Math.max(0, Math.floor(remainingMs / 1000) - 60);
}

// ────────── Pax count validation ──────────

export interface AirIQPaxCounts {
  adults: number;
  children: number;
  infants: number;
}

/** AirIQ's documented pax rules (§2.6). Throws if violated. */
export function assertAirIQPax(p: AirIQPaxCounts): void {
  if (p.adults < 1 || p.adults > 9) {
    throw new Error(`AirIQ: adults must be 1–9 (got ${p.adults})`);
  }
  if (p.children < 0 || p.children > 9) {
    throw new Error(`AirIQ: children must be 0–9 (got ${p.children})`);
  }
  if (p.adults + p.children > 9) {
    throw new Error(`AirIQ: adult + child total must be ≤ 9 (got ${p.adults + p.children})`);
  }
  if (p.infants < 0 || p.infants > 4) {
    throw new Error(`AirIQ: infants must be 0–4 (got ${p.infants})`);
  }
  if (p.infants > p.adults) {
    throw new Error(`AirIQ: infants cannot exceed adults (each infant needs an InfantRef)`);
  }
}
