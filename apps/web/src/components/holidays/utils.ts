import type { HolidayPackage } from '@tripbng/shared';

export type SortKey = 'price' | 'nights' | 'recommended';
export type Tab = 'series' | 'tailor';
export type Budget = 'economy' | 'mid' | 'premium' | 'luxury';

export const THEMES = [
  { value: 'cultural', label: 'Cultural & scenic' },
  { value: 'beach', label: 'Beach & islands' },
  { value: 'honeymoon', label: 'Honeymoon' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'family', label: 'Family' },
  { value: 'pilgrimage', label: 'Pilgrimage' },
];

export const FEATURED_PACKAGES = [
  {
    title: 'Vietnam · Cultural & Scenic',
    destination: 'Vietnam',
    nights: '5 nights',
    duration: '5',
    theme: 'cultural',
    budget: 'mid' as Budget,
    inclusions: 'Hotels · Breakfast · Sightseeing · Transfers',
    fromFare: 'USD 305',
    accent: 'from-rose-200 to-amber-200 dark:from-rose-300/40 dark:to-amber-300/40',
  },
  {
    title: 'Bali · Island Hopper',
    destination: 'Bali',
    nights: '6 nights',
    duration: '6',
    theme: 'beach',
    budget: 'premium' as Budget,
    inclusions: 'Resorts · Half-board · Speedboat · Guide',
    fromFare: 'USD 410',
    accent: 'from-emerald-200 to-cyan-200 dark:from-emerald-300/40 dark:to-cyan-300/40',
  },
  {
    title: 'Dubai · City + Desert',
    destination: 'Dubai',
    nights: '4 nights',
    duration: '4',
    theme: 'family',
    budget: 'mid' as Budget,
    inclusions: 'Hotel · Desert safari · Burj Khalifa · Transfers',
    fromFare: 'USD 360',
    accent: 'from-orange-200 to-yellow-200 dark:from-orange-300/40 dark:to-yellow-300/40',
  },
  {
    title: 'Maldives · Overwater Escape',
    destination: 'Maldives',
    nights: '5 nights',
    duration: '5',
    theme: 'honeymoon',
    budget: 'luxury' as Budget,
    inclusions: 'Resort · All-meals · Snorkel · Speed transfer',
    fromFare: 'USD 980',
    accent: 'from-sky-200 to-blue-300 dark:from-sky-300/40 dark:to-blue-400/40',
  },
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

export const BUDGET_LABELS: Record<Budget, string> = {
  economy: 'Economy',
  mid: 'Mid-range',
  premium: 'Premium',
  luxury: 'Luxury',
};

export type HolidayDetail = HolidayPackage;
