import type { VisaQuote } from '@tripbng/shared';

export type VisaKind = 'eVisa' | 'Visa-on-arrival' | 'Sticker visa';
export type VisaType = 'tourist' | 'business' | 'transit' | 'student' | 'medical';

export interface VisaCountry {
  value: string; // ISO-2 code
  label: string;
  flag: string;
  kind: VisaKind;
  tat: string;
  fromFare?: string;
  /** Visa types we can typically file for from India. */
  typesAvailable?: VisaType[];
  /** Short overview shown on the country detail page. */
  blurb?: string;
}

export const COUNTRIES: VisaCountry[] = [
  {
    value: 'AE',
    label: 'United Arab Emirates',
    flag: '🇦🇪',
    kind: 'eVisa',
    tat: '3–4 working days',
    fromFare: '₹6,200',
    typesAvailable: ['tourist', 'business', 'transit'],
    blurb:
      'eVisa for Indian passport holders, processed centrally by ICA. 30-day single-entry tourist visa is the most-issued type for our agencies.',
  },
  {
    value: 'TH',
    label: 'Thailand',
    flag: '🇹🇭',
    kind: 'Visa-on-arrival',
    tat: '7 working days',
    fromFare: '₹4,600',
    typesAvailable: ['tourist', 'business', 'transit'],
    blurb:
      'Visa-on-arrival for stays up to 15 days; eVisa or sticker visa for longer stays. Multi-entry tourist visas issued for repeat travellers.',
  },
  {
    value: 'SG',
    label: 'Singapore',
    flag: '🇸🇬',
    kind: 'eVisa',
    tat: '5–7 working days',
    fromFare: '₹3,400',
    typesAvailable: ['tourist', 'business', 'transit', 'medical'],
    blurb:
      'ICA-issued eVisa, valid for entries within the visa validity. Multi-entry common for business travellers; tourist visas typically 35-day stay.',
  },
  {
    value: 'JP',
    label: 'Japan',
    flag: '🇯🇵',
    kind: 'Sticker visa',
    tat: '10–14 working days',
    fromFare: '₹2,400',
    typesAvailable: ['tourist', 'business', 'transit', 'student', 'medical'],
    blurb:
      'Sticker visa via the Embassy / VFS. Single-entry tourist most common; multi-entry possible with travel history. Itinerary and bank proofs required.',
  },
  {
    value: 'GB',
    label: 'United Kingdom',
    flag: '🇬🇧',
    kind: 'Sticker visa',
    tat: '15+ working days',
    fromFare: '₹14,800',
    typesAvailable: ['tourist', 'business', 'student', 'medical'],
    blurb:
      'Standard Visitor Visa via VFS Global. 6-month / 2-year / 5-year / 10-year multi-entry options. Detailed financials and intent documentation required.',
  },
  {
    value: 'US',
    label: 'United States',
    flag: '🇺🇸',
    kind: 'Sticker visa',
    tat: '30+ working days',
    fromFare: '₹17,500',
    typesAvailable: ['tourist', 'business', 'transit', 'student', 'medical'],
    blurb:
      'B1/B2 Visitor Visa via the US Consulate. DS-160 + interview + visa fee. Wait-times and slot availability change frequently — check with the trade desk.',
  },
  {
    value: 'AU',
    label: 'Australia',
    flag: '🇦🇺',
    kind: 'eVisa',
    tat: '8–10 working days',
    fromFare: '₹11,200',
    typesAvailable: ['tourist', 'business', 'student', 'medical'],
    blurb:
      'Subclass 600 eVisitor / Visitor visa, processed online via ImmiAccount. Decisions are case-officer-driven; document quality matters.',
  },
  {
    value: 'TR',
    label: 'Türkiye',
    flag: '🇹🇷',
    kind: 'eVisa',
    tat: '2–3 working days',
    fromFare: '₹3,800',
    typesAvailable: ['tourist', 'business', 'transit'],
    blurb:
      'eVisa, single-entry up to 30 days. Issuance is fast for Indian passport holders with a valid Schengen / US / UK visa.',
  },
];

export const VISA_TYPES: { value: VisaType; label: string }[] = [
  { value: 'tourist', label: 'Tourist' },
  { value: 'business', label: 'Business' },
  { value: 'transit', label: 'Transit' },
  { value: 'student', label: 'Student' },
  { value: 'medical', label: 'Medical' },
];

export const NATIONALITIES = [
  { value: 'IN', label: 'India', flag: '🇮🇳' },
  { value: 'NP', label: 'Nepal', flag: '🇳🇵' },
  { value: 'LK', label: 'Sri Lanka', flag: '🇱🇰' },
  { value: 'BD', label: 'Bangladesh', flag: '🇧🇩' },
];

/** Common documents typically required for a tourist visa from India.
 *  Always cross-check on /visa/quote — that's where the supplier's per-country
 *  document list comes from. This is the generic browse-time hint. */
export const COMMON_TOURIST_DOCS = [
  'Passport (valid 6+ months, 2 blank pages)',
  'Recent passport-size photographs',
  'Confirmed return air tickets',
  'Hotel booking / itinerary',
  'Bank statements (last 3 months)',
  'Income tax returns / Form 16',
  'Cover letter from applicant',
  'Travel insurance (where mandated)',
];

export function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDateLong(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function visaKindBadgeTone(kind: VisaKind): 'brand' | 'success' | 'accent' {
  if (kind === 'eVisa') return 'brand';
  if (kind === 'Visa-on-arrival') return 'success';
  return 'accent';
}

export type VisaQuoteData = VisaQuote;
