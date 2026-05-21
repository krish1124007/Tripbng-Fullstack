// Settlement CSV parser — maps gateway-shaped CSVs into the GatewayRow
// shape that reconciliation.service.ts consumes.
//
// Each gateway ships a different column schema. Rather than try to be
// clever about auto-detection, we take an explicit `providerCode` from
// the caller and pick the matching column map. Unknown column names are
// preserved on `rawRow` so the admin UI can still surface them on
// discrepancies.
//
// Robustness:
//   • Header detection is case-insensitive (gateways routinely flip case
//     between exports).
//   • Per-row parse errors don't abort the whole batch — they're collected
//     in `errors` and the row is skipped. Ops sees the count + line
//     numbers in the admin UI.
//   • Amount fields accept both "1234.56" (rupees) and "123456" (paise);
//     the heuristic is "if the field contains a decimal point, treat as
//     rupees". This matches reality — ICICI ships rupees with dot, PhonePe
//     ships paise as integers.

import type { PaymentProviderCode } from '../../adapters/payment/types.js';
import type { GatewayRow } from './reconciliation.service.js';

export interface ParseResult {
  rows: GatewayRow[];
  /** Per-line problems — line number is 1-based and counts the header. */
  errors: Array<{ line: number; reason: string }>;
  /** Header row as-shipped (for debugging in the admin UI). */
  detectedHeaders: string[];
}

/** Per-provider column map. Keys are our GatewayRow fields; values are
 *  the candidate header names we'll accept (lowercased). The first match
 *  wins, so list specific names first. */
const COLUMN_MAPS: Record<PaymentProviderCode, Record<keyof GatewayRow, string[]>> = {
  ICICI_ORANGE_PG: {
    // ICICI's settlement file (`ICICI_Orange_PG_Settlement_YYYYMMDD.csv`):
    //   Date | MerchantTxnNo | RRN | TxnAmount | TxnStatus | MDR | GST | UTR
    gatewayTxnId: ['merchanttxnno', 'merchant_txn_no', 'order_id', 'txn_no'],
    amount: ['txnamount', 'amount', 'gross_amount'],
    status: ['txnstatus', 'status', 'txn_status'],
    mdrAmount: ['mdr', 'mdr_amount'],
    gstOnMdr: ['gst', 'gst_amount', 'gst_on_mdr'],
    settlementUtr: ['utr', 'settlement_utr', 'rrn'],
    rawRow: [], // synthesised, never read from CSV
  },
  PHONEPE: {
    // PhonePe settlement file (`pg_settlement_<merchant>_YYYY-MM-DD.csv`):
    //   merchantOrderId | amount | state | mdr | gst | utr
    gatewayTxnId: ['merchantorderid', 'merchant_order_id', 'order_id'],
    amount: ['amount', 'gross_amount'],
    status: ['state', 'status'],
    mdrAmount: ['mdr', 'mdr_amount'],
    gstOnMdr: ['gst', 'gst_amount'],
    settlementUtr: ['utr', 'settlement_utr'],
    rawRow: [],
  },
  MANUAL: {
    // Manual top-up reconciliation — our own CSV shape, controlled.
    gatewayTxnId: ['txn_code', 'gateway_txn_id'],
    amount: ['amount', 'amount_paise'],
    status: ['status'],
    mdrAmount: ['mdr'],
    gstOnMdr: ['gst'],
    settlementUtr: ['utr'],
    rawRow: [],
  },
};

/** Map a provider-specific status string to our canonical `GatewayRow.status`. */
function normaliseStatus(
  providerCode: PaymentProviderCode,
  raw: string,
): GatewayRow['status'] | null {
  const s = (raw ?? '').toUpperCase().trim();
  // PhonePe uses COMPLETED for success; ICICI uses SUC. Both treat
  // FAILED + CANCELLED + EXPIRED as failure terminals. REFUNDED is the
  // shared canonical name.
  if (s === 'SUCCESS' || s === 'SUC' || s === 'COMPLETED' || s === 'CAPTURED') {
    return 'SUCCESS';
  }
  if (s === 'FAILED' || s === 'FAIL' || s === 'CANCELLED' || s === 'EXPIRED') {
    return 'FAILED';
  }
  if (s === 'REFUNDED' || s === 'REFUND') return 'REFUNDED';
  // PhonePe + ICICI both leave PENDING in their settlement files for
  // transactions still in flight at cut-off. We don't reconcile those
  // — the reconciler treats absence-from-CSV as "still pending".
  if (s === 'PENDING' || s === 'PROCESSING') return null;
  // Provider code lets us add provider-specific fallbacks later without
  // touching the canonical mapping above.
  void providerCode;
  return null;
}

/**
 * Parse paise from a CSV cell. Accepts:
 *   - "1234.56"  → 123456 paise (decimal point present → treat as rupees)
 *   - "123456"   → 123456 paise (no decimal → already paise)
 *   - "₹1,234.56" → 123456 paise (strip symbols + commas)
 * Returns null when the value isn't parseable.
 */
export function parseAmountCell(raw: string): number | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[₹,\s]/g, '').trim();
  if (!cleaned) return null;
  if (/^\d+\.\d+$/.test(cleaned)) {
    // Decimal → rupees. Math.round handles ₹0.005 edge cases without
    // floating-point drift.
    return Math.round(parseFloat(cleaned) * 100);
  }
  if (/^\d+$/.test(cleaned)) {
    return parseInt(cleaned, 10);
  }
  return null;
}

/**
 * Parse a settlement CSV string. The format is "RFC 4180 with Excel
 * quirks": quoted fields, double-quoted internal quotes, optional CRLF.
 * We don't pull in a csv lib because the format is tightly constrained
 * and a 50-line parser is auditable.
 */
export function parseSettlementCsv(
  csvText: string,
  providerCode: PaymentProviderCode,
): ParseResult {
  const result: ParseResult = { rows: [], errors: [], detectedHeaders: [] };
  const lines = splitCsvLines(csvText);
  if (lines.length === 0) {
    result.errors.push({ line: 1, reason: 'empty CSV' });
    return result;
  }

  const headerCells = parseCsvLine(lines[0]!).map((c) => c.trim());
  const lowerHeaders = headerCells.map((c) => c.toLowerCase());
  result.detectedHeaders = headerCells;

  const map = COLUMN_MAPS[providerCode];
  // Resolve each field's column index, or null if it's missing.
  const idx: Partial<Record<keyof GatewayRow, number>> = {};
  for (const field of Object.keys(map) as Array<keyof GatewayRow>) {
    const candidates = map[field];
    for (const candidate of candidates) {
      const i = lowerHeaders.indexOf(candidate);
      if (i !== -1) {
        idx[field] = i;
        break;
      }
    }
  }
  // Required fields: gatewayTxnId, amount, status. Without those there's
  // nothing to reconcile against.
  for (const required of ['gatewayTxnId', 'amount', 'status'] as const) {
    if (idx[required] === undefined) {
      result.errors.push({
        line: 1,
        reason: `missing required column for ${required} (looked for: ${map[required].join(', ')})`,
      });
    }
  }
  if (result.errors.length > 0) return result;

  for (let li = 1; li < lines.length; li++) {
    const lineText = lines[li]!.trim();
    if (!lineText) continue;
    const cells = parseCsvLine(lines[li]!);
    const gatewayTxnId = (cells[idx.gatewayTxnId!] ?? '').trim();
    if (!gatewayTxnId) {
      result.errors.push({ line: li + 1, reason: 'gateway txn id is empty' });
      continue;
    }
    const amountRaw = (cells[idx.amount!] ?? '').trim();
    const amount = parseAmountCell(amountRaw);
    if (amount === null) {
      result.errors.push({
        line: li + 1,
        reason: `amount could not be parsed (${amountRaw})`,
      });
      continue;
    }
    const status = normaliseStatus(providerCode, cells[idx.status!] ?? '');
    if (status === null) {
      // Pending / processing rows aren't reconcileable — skip without
      // counting as an error. They'll be picked up on the next batch.
      continue;
    }

    const rawRow: Record<string, unknown> = {};
    headerCells.forEach((h, i) => {
      rawRow[h] = cells[i] ?? '';
    });

    const row: GatewayRow = {
      gatewayTxnId,
      amount,
      status,
      rawRow,
    };
    if (idx.mdrAmount !== undefined) {
      const mdr = parseAmountCell(cells[idx.mdrAmount] ?? '');
      if (mdr !== null) row.mdrAmount = mdr;
    }
    if (idx.gstOnMdr !== undefined) {
      const gst = parseAmountCell(cells[idx.gstOnMdr] ?? '');
      if (gst !== null) row.gstOnMdr = gst;
    }
    if (idx.settlementUtr !== undefined) {
      const utr = (cells[idx.settlementUtr] ?? '').trim();
      if (utr) row.settlementUtr = utr;
    }

    result.rows.push(row);
  }

  return result;
}

/** Split a CSV string into logical lines, respecting quoted newlines. */
function splitCsvLines(csv: string): string[] {
  const lines: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (inQuotes && csv[i + 1] === '"') {
        cur += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        cur += '"';
      }
    } else if ((ch === '\r' || ch === '\n') && !inQuotes) {
      // Skip the second char of CRLF.
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      lines.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

/** Parse a single CSV line into cells (handles RFC 4180 quoting). */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}
