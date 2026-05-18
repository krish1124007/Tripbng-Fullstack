'use client';

import { useState } from 'react';
import {
  Calendar as CalendarIcon,
  Globe,
  Search as SearchIcon,
  ShieldCheck,
  Users as UsersIcon,
} from 'lucide-react';
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
import {
  AGE_BANDS,
  REGIONS,
  TRIP_TYPES,
  todayPlus,
  type AgeBand,
  type Region,
  type TripType,
} from './utils';

export interface InsuranceSearchFormValues {
  tripType: TripType;
  region: Region;
  from: string;
  to: string;
  travellers: string;
  oldestAge: AgeBand;
}

interface InsuranceSearchFormProps {
  variant?: 'hero' | 'compact';
  initial?: Partial<InsuranceSearchFormValues>;
  loading?: boolean;
  ctaLabel?: string;
  onSubmit: (values: InsuranceSearchFormValues) => void;
}

export function InsuranceSearchForm({
  variant = 'hero',
  initial,
  loading = false,
  ctaLabel,
  onSubmit,
}: InsuranceSearchFormProps) {
  const [tripType, setTripType] = useState<TripType>(initial?.tripType ?? 'single');
  const [region, setRegion] = useState<Region>(initial?.region ?? 'asia');
  const [from, setFrom] = useState(initial?.from ?? todayPlus(7));
  const [to, setTo] = useState(initial?.to ?? todayPlus(14));
  const [travellers, setTravellers] = useState(initial?.travellers ?? '2');
  const [oldestAge, setOldestAge] = useState<AgeBand>(initial?.oldestAge ?? '46–55');

  const submit = () => {
    onSubmit({ tripType, region, from, to, travellers, oldestAge });
  };

  // Shared field controls
  const regionField = (
    <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
      <SelectTrigger>
        <Globe className="h-4 w-4 text-ink-3" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {REGIONS.map((r) => (
          <SelectItem key={r.value} value={r.value}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const fromField = (
    <Input
      id="from"
      type="date"
      value={from}
      min={todayPlus(0)}
      onChange={(e) => setFrom(e.target.value)}
      leading={<CalendarIcon className="h-4 w-4" strokeWidth={1.75} />}
    />
  );
  const toField = (
    <Input
      id="to"
      type="date"
      value={to}
      min={from}
      onChange={(e) => setTo(e.target.value)}
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
            {n}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const oldestAgeField = (
    <Select value={oldestAge} onValueChange={(v) => setOldestAge(v as AgeBand)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AGE_BANDS.map((b) => (
          <SelectItem key={b} value={b}>
            {b}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (variant === 'hero') {
    return (
      <SearchPanel
        eyebrow="Booking · Insurance"
        title="Travel insurance"
        subtitle="Compare plans across global underwriters. Issue policies in your traveller's name with one click — claims handled by the carrier."
        icon={ShieldCheck}
        tabs={
          <TripTypeTabs
            value={tripType}
            onChange={(v) => setTripType(v as TripType)}
            options={TRIP_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
        }
        footer={
          <>
            <p className="text-xs text-ink-3">
              <span className="font-semibold">5 carriers</span> · cashless in 18k+ hospitals · instant policy PDF
            </p>
            <Button
              onClick={submit}
              loading={loading}
              size="xl"
              className="w-full sm:w-auto sm:min-w-[220px] shadow-brand"
            >
              {!loading ? (
                <>
                  <SearchIcon className="h-4 w-4" /> {ctaLabel ?? 'Get quote'}
                </>
              ) : (
                <>Calculating…</>
              )}
            </Button>
          </>
        }
      >
        <FieldRow cols="grid-cols-1 sm:grid-cols-3 sm:gap-3">
          <Field label="Destination region">{regionField}</Field>
          <Field label="Travel from" htmlFor="from">
            {fromField}
          </Field>
          <Field label="Travel until" htmlFor="to">
            {toField}
          </Field>
        </FieldRow>
        <FieldRow cols="grid-cols-1 sm:grid-cols-2 sm:gap-3">
          <Field label="Travellers">{travellersField}</Field>
          <Field label="Oldest age">{oldestAgeField}</Field>
        </FieldRow>
      </SearchPanel>
    );
  }

  // Compact
  return (
    <div className="rounded-lg border bg-surface-1 p-3 shadow-sm">
      <div className="grid gap-2 lg:grid-cols-[1.4fr_1fr_1fr_0.8fr_0.8fr_auto] lg:items-end">
        <Field label="Region">{regionField}</Field>
        <Field label="From" htmlFor="from">
          {fromField}
        </Field>
        <Field label="Until" htmlFor="to">
          {toField}
        </Field>
        <Field label="Travellers">{travellersField}</Field>
        <Field label="Oldest age">{oldestAgeField}</Field>
        <div className="lg:pb-0.5">
          <Button onClick={submit} loading={loading} className="h-10 w-full lg:min-w-[140px]">
            {!loading ? (
              <>
                <SearchIcon className="h-4 w-4" /> {ctaLabel ?? 'Re-quote'}
              </>
            ) : (
              <>Calculating…</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
