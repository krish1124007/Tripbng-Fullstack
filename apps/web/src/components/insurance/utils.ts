import type { InsurancePlan } from '@tripbng/shared';

export type TripType = 'single' | 'multi' | 'student' | 'senior' | 'group';
export type Region = 'asia' | 'asia-jp' | 'schengen' | 'world-ex-us' | 'world';
export type AgeBand = '1–17' | '18–35' | '36–45' | '46–55' | '56–65' | '66–70' | '71–80';

export const TRIP_TYPES: { value: TripType; label: string; sub?: string }[] = [
  { value: 'single', label: 'Single trip', sub: 'One round-trip itinerary' },
  { value: 'multi', label: 'Multi-trip (12 months)', sub: 'Annual cover, unlimited trips' },
  { value: 'student', label: 'Student', sub: 'Long-stay academic visa' },
  { value: 'senior', label: 'Senior citizen', sub: 'Designed for 60+ travellers' },
  { value: 'group', label: 'Group / Corporate', sub: '5+ travellers, single policy' },
];

export const REGIONS: { value: Region; label: string }[] = [
  { value: 'asia', label: 'Asia (excl. Japan)' },
  { value: 'asia-jp', label: 'Asia (incl. Japan)' },
  { value: 'schengen', label: 'Schengen' },
  { value: 'world-ex-us', label: 'Worldwide (excl. US/Canada)' },
  { value: 'world', label: 'Worldwide' },
];

export const AGE_BANDS: AgeBand[] = ['1–17', '18–35', '36–45', '46–55', '56–65', '66–70', '71–80'];

export function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return `$${n}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.max(
    1,
    Math.round((new Date(to).getTime() - new Date(from).getTime()) / (24 * 3600 * 1000)),
  );
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function tripTypeLabel(t: string): string {
  return TRIP_TYPES.find((x) => x.value === t)?.label ?? t;
}

export function regionLabel(r: string): string {
  return REGIONS.find((x) => x.value === r)?.label ?? r;
}

/** Generic exclusions list — typical across most travel-insurance carriers,
 *  surfaced on the detail page. Specific exclusions arrive with the policy
 *  wording PDF when carrier integration ships. */
export const COMMON_EXCLUSIONS = [
  'War, civil unrest, and acts of terrorism (where carrier-excluded)',
  'Self-inflicted injury, suicide, or attempts thereof',
  'Drug or alcohol-related incidents (unless prescribed)',
  'Travel against medical advice or to a country under travel advisory',
  'Pre-existing conditions undisclosed at the time of issue',
  'Hazardous activities not covered as adventure sports',
  'Routine medical check-ups and elective procedures',
  'Loss not reported to police / carrier within stipulated time',
];

export type InsuranceDetail = InsurancePlan;
