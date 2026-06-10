// Human-friendly identifier prefixes per spec §5.2.1.
// Format: <PREFIX><6-digit zero-padded sequence>
// e.g. SA000001, AT000012, D000070, SP000007
export const CODE_PREFIX = {
  SUPER_ADMIN: 'SA',
  AGENCY: 'AT',
  SUB_AGENT: 'SU',
  DISTRIBUTOR: 'D',
  SUPPLIER: 'SP',
  ACCOUNTS_USER: 'AC',
  SUPPORT_AGENT: 'SG',

  INVENTORY: 'INV',
  BOOKING: 'TBNG',
  /** Bus-specific booking ref. Spec format `TBNG-BUS-NNNNNN`. */
  BUS_BOOKING: 'TBNG-BUS-',
  /** Bus invoice number — `TBNG-INV-NNNNNN`. Note: tax-invoice numbers
   *  must be sequential per Indian GST rules; the Counter atomicity
   *  gives us that. Distinct from booking refs because some bookings
   *  never get a GST invoice (no gstProfile attached). */
  BUS_INVOICE: 'TBNG-INV-',
  /** Flight invoice number — `TBNG-FINV-NNNNNN`. Separate sequence
   *  from bus invoices so the two product lines have independent
   *  audit trails for finance reconciliation. */
  FLIGHT_INVOICE: 'TBNG-FINV-',
  WALLET_TXN: 'WTX',
  TOPUP: 'TOP',
  AMENDMENT: 'AMD',
  MARKUP_RULE: 'MR',
  FARE_RULE: 'FR',
  POLICY: 'POL',
  AGENCY_GROUP: 'AG',
  NOTIFICATION: 'NOTIF',
  BANNER: 'BAN',
  INCENTIVE: 'INC',
  /** Distributor → sub-agent balance transfer. Spec §3.8 + §2.6 in
   *  AGENCY_WALLET_SYSTEM — anchors approval-pending rows, completed
   *  transfers, and recalls (a TYPE=RECALL row carries its own ref). */
  DISTRIBUTOR_TRANSFER: 'DT',
} as const;

export type CodePrefix = (typeof CODE_PREFIX)[keyof typeof CODE_PREFIX];

export function formatCode(prefix: CodePrefix, sequence: number, width = 6): string {
  return `${prefix}${String(sequence).padStart(width, '0')}`;
}
