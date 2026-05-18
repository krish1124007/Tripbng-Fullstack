'use client';

import { useState } from 'react';
import {
  Calendar as CalendarIcon,
  Compass,
  IndianRupee,
  MapPin,
  Search as SearchIcon,
  TreePalm,
  Users as UsersIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { Field, FieldRow, SearchPanel, TripTypeTabs } from '@/components/search-panel';
import { THEMES, todayPlus, type Budget, type Tab } from './utils';

export interface HolidaySearchFormValues {
  destination: string;
  duration: string;
  travellers: string;
  budget: Budget;
  theme: string;
  departure: string;
  tab: Tab;
}

interface HolidaySearchFormProps {
  variant?: 'hero' | 'compact';
  initial?: Partial<HolidaySearchFormValues>;
  loading?: boolean;
  ctaLabel?: string;
  onSubmit: (values: HolidaySearchFormValues) => void;
}

export function HolidaySearchForm({
  variant = 'hero',
  initial,
  loading = false,
  ctaLabel,
  onSubmit,
}: HolidaySearchFormProps) {
  const [tab, setTab] = useState<Tab>(initial?.tab ?? 'series');
  const [destination, setDestination] = useState(initial?.destination ?? '');
  const [duration, setDuration] = useState(initial?.duration ?? '5');
  const [departure, setDeparture] = useState(initial?.departure ?? todayPlus(14));
  const [travellers, setTravellers] = useState(initial?.travellers ?? '2');
  const [budget, setBudget] = useState<Budget>(initial?.budget ?? 'mid');
  const [theme, setTheme] = useState(initial?.theme ?? 'cultural');

  const submit = () => {
    if (!destination.trim()) {
      toast.error('Pick a destination to browse holidays');
      return;
    }
    onSubmit({
      tab,
      destination: destination.trim(),
      duration,
      travellers,
      budget,
      theme,
      departure,
    });
  };

  // Shared field controls
  const destField = (
    <Input
      id="destination"
      value={destination}
      onChange={(e) => setDestination(e.target.value)}
      placeholder="e.g. Vietnam, Bali, Maldives"
      leading={<MapPin className="h-4 w-4" strokeWidth={1.75} />}
    />
  );
  const nightsField = (
    <Select value={duration} onValueChange={setDuration}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[3, 4, 5, 6, 7, 8, 10, 14].map((n) => (
          <SelectItem key={n} value={String(n)}>
            {n} {n === 1 ? 'night' : 'nights'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const departureField = (
    <Input
      id="departure"
      type="date"
      value={departure}
      min={todayPlus(0)}
      onChange={(e) => setDeparture(e.target.value)}
      leading={<CalendarIcon className="h-4 w-4" strokeWidth={1.75} />}
    />
  );
  const travellersField = (
    <Select value={travellers} onValueChange={setTravellers}>
      <SelectTrigger>
        <UsersIcon className="h-4 w-4 text-ink-3" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
          <SelectItem key={n} value={String(n)}>
            {n} pax
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const budgetField = (
    <Select value={budget} onValueChange={(v) => setBudget(v as Budget)}>
      <SelectTrigger>
        <IndianRupee className="h-4 w-4 text-ink-3" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="economy">Economy</SelectItem>
        <SelectItem value="mid">Mid-range</SelectItem>
        <SelectItem value="premium">Premium</SelectItem>
        <SelectItem value="luxury">Luxury</SelectItem>
      </SelectContent>
    </Select>
  );
  const themeField = (
    <Select value={theme} onValueChange={setTheme}>
      <SelectTrigger>
        <Compass className="h-4 w-4 text-ink-3" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {THEMES.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (variant === 'hero') {
    return (
      <SearchPanel
        eyebrow="Booking · Holiday"
        title="Holiday packages"
        subtitle="Pre-built series departures with locked-in pricing, plus tailor-made packages for your high-touch customers."
        icon={TreePalm}
        tabs={
          <TripTypeTabs
            value={tab}
            onChange={(v) => setTab(v as Tab)}
            options={[
              { value: 'series', label: 'Series departures' },
              { value: 'tailor', label: 'Tailor-made' },
            ]}
          />
        }
        footer={
          <>
            <p className="text-xs text-ink-3">
              <span className="font-semibold">{tab === 'series' ? 'Series fares' : 'Custom built'}</span>{' '}
              · DMC-direct rates · door-to-door inclusions
            </p>
            <Button
              onClick={submit}
              loading={loading}
              size="xl"
              className="w-full sm:w-auto sm:min-w-[220px] shadow-brand"
            >
              {!loading ? (
                <>
                  <SearchIcon className="h-4 w-4" /> {ctaLabel ?? 'Search packages'}
                </>
              ) : (
                <>Searching…</>
              )}
            </Button>
          </>
        }
      >
        <FieldRow cols="grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.6fr_0.8fr_1.2fr] sm:gap-3">
          <Field label="Destination" htmlFor="destination" hint="Country, region, or city">
            {destField}
          </Field>
          <Field label="Nights">{nightsField}</Field>
          <Field label="Departing on/after" htmlFor="departure">
            {departureField}
          </Field>
        </FieldRow>
        <FieldRow cols="grid-cols-1 sm:grid-cols-3 sm:gap-3">
          <Field label="Travellers">{travellersField}</Field>
          <Field label="Budget tier">{budgetField}</Field>
          <Field label="Theme">{themeField}</Field>
        </FieldRow>
      </SearchPanel>
    );
  }

  // Compact
  return (
    <div className="rounded-lg border bg-surface-1 p-3 shadow-sm">
      <div className="grid gap-2 lg:grid-cols-[1.4fr_0.8fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
        <Field label="Destination" htmlFor="destination">
          {destField}
        </Field>
        <Field label="Nights">{nightsField}</Field>
        <Field label="Departure" htmlFor="departure">
          {departureField}
        </Field>
        <Field label="Travellers">{travellersField}</Field>
        <Field label="Budget">{budgetField}</Field>
        <Field label="Theme">{themeField}</Field>
        <div className="lg:pb-0.5">
          <Button onClick={submit} loading={loading} className="h-10 w-full lg:min-w-[140px]">
            {!loading ? (
              <>
                <SearchIcon className="h-4 w-4" /> {ctaLabel ?? 'Modify'}
              </>
            ) : (
              <>Searching…</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
