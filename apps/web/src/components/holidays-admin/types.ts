import type { AdminHolidayPackage } from '@tripbng/shared';

export type TabId =
  | 'basic'
  | 'cities'
  | 'hotels'
  | 'sightseeing'
  | 'inclusions'
  | 'exclusions'
  | 'itinerary'
  | 'flights'
  | 'special-notes'
  | 'cancellation'
  | 'pricing';

export interface TabDef {
  id: TabId;
  label: string;
  /** Short hint shown beneath the label in the rail. */
  hint?: string;
}

export const TABS: readonly TabDef[] = [
  { id: 'basic', label: 'Basic details', hint: 'Title, themes, hero' },
  { id: 'cities', label: 'Cities', hint: 'Stops + nights' },
  { id: 'hotels', label: 'Hotels', hint: 'Per-city stays' },
  { id: 'sightseeing', label: 'Sightseeing', hint: 'Per-city activities' },
  { id: 'inclusions', label: 'Inclusions', hint: 'What’s in the price' },
  { id: 'exclusions', label: 'Exclusions', hint: 'What’s not' },
  { id: 'itinerary', label: 'Day-by-day', hint: 'Plan per day' },
  { id: 'flights', label: 'Flights', hint: 'Sectors + notes' },
  { id: 'special-notes', label: 'Special notes', hint: 'Caveats / context' },
  { id: 'cancellation', label: 'Cancellation', hint: 'Slabs + free text' },
  { id: 'pricing', label: 'Pricing', hint: 'Date \xd7 pax matrix' },
];

/** Used for both `new` and `edit` — `edit` overlays loaded values on top. */
export function emptyPackage(): AdminHolidayPackage {
  return {
    title: '',
    destination: '',
    visaCountriesHinted: [],
    departureCities: [],
    themes: [],
    themeLabel: '',
    heroImages: [],
    nights: 1,
    cities: [],
    hotelsPerCity: {},
    sightseeingPerCity: {},
    inclusions: [],
    exclusions: [],
    dayWise: [],
    flights: [],
    specialNotes: [],
    cancellationPolicyText: [],
    cancellationSchedule: [],
    priceMatrix: [],
    fixDeparture: false,
    insuranceBundled: false,
    flightIncluded: false,
    bestSeller: false,
    published: false,
    fromPerAdultPaise: '0',
  };
}

/** Generic update helper signature used by every tab component. */
export type UpdateFn = <K extends keyof AdminHolidayPackage>(
  key: K,
  value: AdminHolidayPackage[K],
) => void;

/** Common props every tab receives. */
export interface TabProps {
  pkg: AdminHolidayPackage;
  update: UpdateFn;
}

/** Build a stable id for a freshly-added nested row. The service layer will
 *  assign final ids on save; this is just so the UI has a unique React key
 *  before save. */
export function tempId(prefix: string): string {
  return `${prefix}-tmp-${Math.random().toString(36).slice(2, 8)}`;
}
