'use client';

import { useState } from 'react';
import {
  Calendar as CalendarIcon,
  FileText,
  Globe,
  Search as SearchIcon,
  StickyNote,
  Users as UsersIcon,
} from 'lucide-react';
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { Field, FieldRow, SearchPanel } from '@/components/search-panel';
import { COUNTRIES, NATIONALITIES, VISA_TYPES, todayPlus, type VisaType } from './utils';

export interface VisaSearchFormValues {
  country: string;
  visaType: VisaType;
  nationality: string;
  travelDate: string;
  applicants: string;
}

interface VisaSearchFormProps {
  variant?: 'hero' | 'compact';
  initial?: Partial<VisaSearchFormValues>;
  loading?: boolean;
  ctaLabel?: string;
  onSubmit: (values: VisaSearchFormValues) => void;
}

export function VisaSearchForm({
  variant = 'hero',
  initial,
  loading = false,
  ctaLabel,
  onSubmit,
}: VisaSearchFormProps) {
  const [country, setCountry] = useState(initial?.country ?? 'AE');
  const [visaType, setVisaType] = useState<VisaType>(initial?.visaType ?? 'tourist');
  const [nationality, setNationality] = useState(initial?.nationality ?? 'IN');
  const [travelDate, setTravelDate] = useState(initial?.travelDate ?? todayPlus(21));
  const [applicants, setApplicants] = useState(initial?.applicants ?? '1');

  const selectedCountry = COUNTRIES.find((c) => c.value === country);

  const submit = () => {
    onSubmit({ country, visaType, nationality, travelDate, applicants });
  };

  const countryField = (
    <Select value={country} onValueChange={setCountry}>
      <SelectTrigger>
        <Globe className="h-4 w-4 text-ink-3" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {COUNTRIES.map((c) => (
          <SelectItem key={c.value} value={c.value}>
            <span className="mr-2">{c.flag}</span>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const visaTypeField = (
    <Select value={visaType} onValueChange={(v) => setVisaType(v as VisaType)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {VISA_TYPES.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const nationalityField = (
    <Select value={nationality} onValueChange={setNationality}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NATIONALITIES.map((n) => (
          <SelectItem key={n.value} value={n.value}>
            <span className="mr-2">{n.flag}</span>
            {n.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const travelDateField = (
    <Input
      id="travelDate"
      type="date"
      value={travelDate}
      min={todayPlus(0)}
      onChange={(e) => setTravelDate(e.target.value)}
      leading={<CalendarIcon className="h-4 w-4" strokeWidth={1.75} />}
    />
  );
  const applicantsField = (
    <Select value={applicants} onValueChange={setApplicants}>
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

  if (variant === 'hero') {
    return (
      <SearchPanel
        eyebrow="Booking · Visa"
        title="Visa applications"
        subtitle="Apply on behalf of your travellers. Real-time TAT, document checklist, and status tracking — built for travel-trade workflows."
        icon={StickyNote}
        footer={
          <>
            {selectedCountry ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="brand" dot>
                  <span>{selectedCountry.flag}</span>
                  {selectedCountry.label}
                </Badge>
                <Badge variant="neutral">
                  <FileText className="h-3 w-3" />
                  {selectedCountry.kind}
                </Badge>
                <Badge variant="accent">
                  <CalendarIcon className="h-3 w-3" />
                  TAT: {selectedCountry.tat}
                </Badge>
              </div>
            ) : (
              <p className="text-xs text-ink-3">
                <span className="font-semibold">e-Visa, sticker visa, visa-on-arrival</span> · processed by VFS / BLS / consulate
              </p>
            )}
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
          <Field label="Destination country">{countryField}</Field>
          <Field label="Visa type">{visaTypeField}</Field>
          <Field label="Nationality">{nationalityField}</Field>
        </FieldRow>
        <FieldRow cols="grid-cols-1 sm:grid-cols-2 sm:gap-3">
          <Field label="Travel on/after" htmlFor="travelDate">
            {travelDateField}
          </Field>
          <Field label="Applicants">{applicantsField}</Field>
        </FieldRow>
      </SearchPanel>
    );
  }

  // Compact
  return (
    <div className="rounded-lg border bg-surface-1 p-3 shadow-sm">
      <div className="grid gap-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr_auto] lg:items-end">
        <Field label="Country">{countryField}</Field>
        <Field label="Visa type">{visaTypeField}</Field>
        <Field label="Nationality">{nationalityField}</Field>
        <Field label="Travel on/after" htmlFor="travelDate">
          {travelDateField}
        </Field>
        <Field label="Applicants">{applicantsField}</Field>
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
