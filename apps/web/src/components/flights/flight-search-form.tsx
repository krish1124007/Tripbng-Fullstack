'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  Calendar as CalendarIcon,
  Minus,
  PlaneTakeoff,
  Plus,
  Search as SearchIcon,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { TRAVEL_CLASS, type Airport, type SearchRequest } from '@tripbng/shared';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { AirportInput } from '@/components/airport-input';
import { Field, FieldRow, SearchPanel, TripTypeTabs } from '@/components/search-panel';
import { useApiQuery } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { todayPlus } from './utils';

type TravelClass = (typeof TRAVEL_CLASS)[number];
export type TripType = 'ONEWAY' | 'ROUNDTRIP' | 'MULTICITY';

export interface MultiSegment {
  origin: Airport | null;
  destination: Airport | null;
  date: string; // yyyy-mm-dd
}

export interface FlightSearchFormValues {
  tripType: TripType;
  origin: Airport | null;
  destination: Airport | null;
  date: string; // yyyy-mm-dd (departure for one-way / round-trip outbound)
  returnDate: string; // yyyy-mm-dd (round-trip return)
  segments: MultiSegment[]; // multi-city legs (>=2 when tripType=MULTICITY)
  travelClass: TravelClass;
  pax: { adults: number; children: number; infants: number };
}

interface FlightSearchFormProps {
  variant?: 'hero' | 'compact';
  initial?: Partial<FlightSearchFormValues>;
  loading?: boolean;
  /** Optional submit-button label override. */
  ctaLabel?: string;
  onSubmit: (req: SearchRequest, raw: FlightSearchFormValues) => void;
}

const MAX_MULTI_SEGMENTS = 6;

function emptyMultiSegment(date: string): MultiSegment {
  return { origin: null, destination: null, date };
}

/**
 * Reusable flight-search form supporting one-way, round-trip, and multi-city.
 *   • `hero` variant — full SearchPanel with eyebrow/title/footer (landing page)
 *   • `compact` variant — inline grid (sticky results-page header)
 *
 * Both variants share fields and emit the same SearchRequest shape. Multi-city
 * uses a stacked layout in either variant.
 */
export function FlightSearchForm({
  variant = 'hero',
  initial,
  loading = false,
  ctaLabel,
  onSubmit,
}: FlightSearchFormProps) {
  const defaultDate = initial?.date ?? todayPlus(7);
  const defaultReturn = initial?.returnDate ?? todayPlus(14);

  const [tripType, setTripType] = useState<TripType>(initial?.tripType ?? 'ONEWAY');
  const [origin, setOrigin] = useState<Airport | null>(initial?.origin ?? null);
  const [destination, setDestination] = useState<Airport | null>(initial?.destination ?? null);
  const [date, setDate] = useState(defaultDate);
  const [returnDate, setReturnDate] = useState(defaultReturn);
  const [segments, setSegments] = useState<MultiSegment[]>(
    initial?.segments && initial.segments.length >= 2
      ? initial.segments
      : [emptyMultiSegment(defaultDate), emptyMultiSegment(todayPlus(10))],
  );
  const [travelClass, setTravelClass] = useState<TravelClass>(
    (initial?.travelClass as TravelClass) ?? 'ECONOMY',
  );
  const [pax, setPax] = useState(initial?.pax ?? { adults: 1, children: 0, infants: 0 });
  const [paxOpen, setPaxOpen] = useState(false);

  // Seed initial airports for first-paint UX on the landing page (BOM/DEL).
  // ONE-SHOT: once we've seeded (or the user has typed/selected), never seed
  // again. Without the ref-guard this effect re-fires when the user clears
  // the field to type their own city — instantly putting BOM/DEL back and
  // making the input feel frozen.
  const skipSeed = !!initial?.origin || !!initial?.destination;
  const seededRef = useRef(skipSeed);
  const seedOrigin = useApiQuery<Airport[]>(
    ['airports-seed-bom'],
    '/api/v1/airports',
    { query: { q: 'BOM' }, staleTime: 24 * 60 * 60 * 1000, enabled: !skipSeed },
  );
  const seedDest = useApiQuery<Airport[]>(
    ['airports-seed-del'],
    '/api/v1/airports',
    { query: { q: 'DEL' }, staleTime: 24 * 60 * 60 * 1000, enabled: !skipSeed },
  );
  useEffect(() => {
    if (seededRef.current) return;
    const o = seedOrigin.data?.[0];
    const d = seedDest.data?.[0];
    if (!o || !d) return; // wait until both seeds resolve before applying
    setOrigin(o);
    setDestination(d);
    seededRef.current = true;
  }, [seedOrigin.data, seedDest.data]);

  const onPasteSector = (originCode: string, destinationCode: string) => {
    setOrigin({ iata: originCode, city: originCode, name: originCode, country: '', countryCode: 'IN' });
    setDestination({
      iata: destinationCode,
      city: destinationCode,
      name: destinationCode,
      country: '',
      countryCode: 'IN',
    });
  };

  const swap = () => {
    setOrigin(destination);
    setDestination(origin);
  };

  const addSegment = () => {
    setSegments((prev) => {
      if (prev.length >= MAX_MULTI_SEGMENTS) return prev;
      const last = prev[prev.length - 1];
      return [
        ...prev,
        {
          origin: last?.destination ?? null,
          destination: null,
          date: todayPlus(prev.length * 3 + 7),
        },
      ];
    });
  };
  const removeSegment = (i: number) => {
    setSegments((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));
  };
  const updateSegment = (i: number, patch: Partial<MultiSegment>) => {
    setSegments((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const submit = () => {
    if (tripType === 'MULTICITY') {
      // Validate every leg
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i]!;
        if (!s.origin || !s.destination) {
          toast.error(`Leg ${i + 1}: pick both origin and destination`);
          return;
        }
        if (s.origin.iata === s.destination.iata) {
          toast.error(`Leg ${i + 1}: origin and destination must differ`);
          return;
        }
        if (!s.date) {
          toast.error(`Leg ${i + 1}: pick a date`);
          return;
        }
      }
      const req: SearchRequest = {
        tripType: 'MULTICITY',
        segments: segments.map((s) => ({
          origin: s.origin!.iata,
          destination: s.destination!.iata,
          date: new Date(s.date),
        })),
        travelClass,
        pax,
      };
      onSubmit(req, {
        tripType,
        origin,
        destination,
        date,
        returnDate,
        segments,
        travelClass,
        pax,
      });
      return;
    }

    if (!origin || !destination) {
      toast.error('Pick both origin and destination');
      return;
    }
    if (origin.iata === destination.iata) {
      toast.error('Origin and destination must differ');
      return;
    }
    if (tripType === 'ROUNDTRIP' && returnDate < date) {
      toast.error('Return date must be on or after departure');
      return;
    }

    const baseReq: SearchRequest = {
      tripType,
      segments:
        tripType === 'ROUNDTRIP'
          ? [
              { origin: origin.iata, destination: destination.iata, date: new Date(date) },
              { origin: destination.iata, destination: origin.iata, date: new Date(returnDate) },
            ]
          : [{ origin: origin.iata, destination: destination.iata, date: new Date(date) }],
      travelClass,
      pax,
    };
    onSubmit(baseReq, {
      tripType,
      origin,
      destination,
      date,
      returnDate,
      segments,
      travelClass,
      pax,
    });
  };

  const totalPax = pax.adults + pax.children + pax.infants;

  // ────────── Field controls (shared between variants) ──────────

  const fromField = (
    <AirportInput
      id="origin"
      value={origin}
      onChange={setOrigin}
      placeholder="BOM · Mumbai"
      onPasteSector={onPasteSector}
    />
  );
  const toField = (
    <AirportInput
      id="dest"
      value={destination}
      onChange={setDestination}
      placeholder="DEL · New Delhi"
      onPasteSector={onPasteSector}
    />
  );
  const swapButton = (
    <button
      type="button"
      onClick={swap}
      aria-label="Swap origin and destination"
      className="grid h-10 w-10 place-items-center rounded-full border bg-surface-1 text-ink-3 shadow-sm transition-all duration-fast hover:rotate-180 hover:border-brand-300 hover:text-brand-600"
    >
      <ArrowRightLeft className="h-3.5 w-3.5" />
    </button>
  );
  const dateField = (
    <Input
      id="date"
      type="date"
      value={date}
      onChange={(e) => setDate(e.target.value)}
      min={todayPlus(0)}
      leading={<CalendarIcon className="h-4 w-4" strokeWidth={1.75} />}
    />
  );
  const returnDateField = (
    <Input
      id="returnDate"
      type="date"
      value={returnDate}
      onChange={(e) => setReturnDate(e.target.value)}
      min={date || todayPlus(0)}
      leading={<CalendarIcon className="h-4 w-4" strokeWidth={1.75} />}
    />
  );
  const classField = (
    <Select value={travelClass} onValueChange={(v) => setTravelClass(v as TravelClass)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TRAVEL_CLASS.map((c) => (
          <SelectItem key={c} value={c}>
            {c.charAt(0) + c.slice(1).toLowerCase().replace('_', ' ')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const paxField = (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPaxOpen((v) => !v)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-surface-1 px-3 text-sm transition-colors hover:border-ink-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2 text-ink-1">
          <UsersIcon className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
          <span className="font-mono tabular-nums">{totalPax}</span>{' '}
          <span className="text-ink-3">{totalPax === 1 ? 'passenger' : 'passengers'}</span>
        </span>
        <ArrowRight className={cn('h-4 w-4 text-ink-4 transition-transform', paxOpen && 'rotate-90')} />
      </button>
      {paxOpen ? (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-80 animate-slide-down rounded-lg border bg-surface-1 p-4 shadow-lg">
          {[
            { key: 'adults', label: 'Adults', sub: '12+ years', min: 1 },
            { key: 'children', label: 'Children', sub: '2–11 years', min: 0 },
            { key: 'infants', label: 'Infants', sub: 'Under 2', min: 0 },
          ].map((row) => (
            <div key={row.key} className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-semibold">{row.label}</p>
                <p className="text-xs text-ink-3">{row.sub}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Decrement ${row.label}`}
                  onClick={() =>
                    setPax((p) => ({
                      ...p,
                      [row.key]: Math.max(row.min, p[row.key as keyof typeof p] - 1),
                    }))
                  }
                  className="grid h-8 w-8 place-items-center rounded-md border text-ink-3 transition-colors hover:border-ink-5 hover:text-ink-1 disabled:opacity-40"
                  disabled={pax[row.key as keyof typeof pax] <= row.min}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-6 text-center font-mono text-sm font-semibold tabular-nums">
                  {pax[row.key as keyof typeof pax]}
                </span>
                <button
                  type="button"
                  aria-label={`Increment ${row.label}`}
                  onClick={() =>
                    setPax((p) => ({ ...p, [row.key]: Math.min(9, p[row.key as keyof typeof p] + 1) }))
                  }
                  className="grid h-8 w-8 place-items-center rounded-md border text-ink-3 transition-colors hover:border-ink-5 hover:text-ink-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          <Button size="sm" variant="soft" className="mt-2 w-full" onClick={() => setPaxOpen(false)}>
            Done
          </Button>
        </div>
      ) : null}
    </div>
  );

  // ────────── Multi-city segment list (shared between variants) ──────────

  const multiCityRows = (
    <div className="space-y-2.5">
      {segments.map((s, i) => (
        <div
          key={i}
          className="rounded-lg border border-dashed bg-surface-2/40 p-2.5"
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Leg {i + 1}
            </span>
            {segments.length > 2 ? (
              <button
                type="button"
                onClick={() => removeSegment(i)}
                aria-label={`Remove leg ${i + 1}`}
                className="grid h-7 w-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-error-soft hover:text-error"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="grid gap-2 lg:grid-cols-[1.4fr_1.4fr_1fr] lg:items-end">
            <Field label="From" htmlFor={`m-from-${i}`}>
              <AirportInput
                id={`m-from-${i}`}
                value={s.origin}
                onChange={(v) => updateSegment(i, { origin: v })}
                placeholder="From"
              />
            </Field>
            <Field label="To" htmlFor={`m-to-${i}`}>
              <AirportInput
                id={`m-to-${i}`}
                value={s.destination}
                onChange={(v) => updateSegment(i, { destination: v })}
                placeholder="To"
              />
            </Field>
            <Field label="Date" htmlFor={`m-date-${i}`}>
              <Input
                id={`m-date-${i}`}
                type="date"
                value={s.date}
                onChange={(e) => updateSegment(i, { date: e.target.value })}
                min={i === 0 ? todayPlus(0) : segments[i - 1]?.date || todayPlus(0)}
                leading={<CalendarIcon className="h-4 w-4" strokeWidth={1.75} />}
              />
            </Field>
          </div>
        </div>
      ))}
      {segments.length < MAX_MULTI_SEGMENTS ? (
        <Button
          variant="soft"
          size="sm"
          onClick={addSegment}
          className="w-full sm:w-auto"
        >
          <Plus className="h-3.5 w-3.5" /> Add another leg
        </Button>
      ) : (
        <p className="text-[11px] text-ink-3">Max {MAX_MULTI_SEGMENTS} legs.</p>
      )}
    </div>
  );

  // ────────── Hero variant ──────────

  if (variant === 'hero') {
    return (
      <SearchPanel
        eyebrow="Booking · Flights"
        title="Find a flight"
        subtitle="Series, LCC, and FSC fares on one screen — re-priced live through your policy and markup chain."
        icon={PlaneTakeoff}
        tabs={
          <TripTypeTabs
            value={tripType}
            onChange={(v) => setTripType(v as TripType)}
            options={[
              { value: 'ONEWAY', label: 'One way' },
              { value: 'ROUNDTRIP', label: 'Round trip' },
              { value: 'MULTICITY', label: 'Multi-city' },
            ]}
          />
        }
        footer={
          <>
            <p className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <span className="font-semibold">Special fares:</span>
              {['Senior citizen', 'Student', 'Armed forces', 'Doctor'].map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded-full border bg-surface-1/80 px-2 py-0.5 text-[10px] font-medium text-ink-2"
                >
                  {label}
                </span>
              ))}
            </p>
            <Button
              onClick={submit}
              loading={loading}
              size="xl"
              className="w-full sm:w-auto sm:min-w-[220px] shadow-brand"
            >
              {!loading ? (
                <>
                  <SearchIcon className="h-4 w-4" /> {ctaLabel ?? 'Search flights'}
                </>
              ) : (
                <>Searching live fares…</>
              )}
            </Button>
          </>
        }
      >
        {tripType === 'MULTICITY' ? (
          <>
            {multiCityRows}
            <FieldRow cols="grid-cols-1 sm:grid-cols-2 sm:gap-3">
              <Field label="Class">{classField}</Field>
              <Field label="Passengers">{paxField}</Field>
            </FieldRow>
          </>
        ) : (
          <>
            <FieldRow cols="grid-cols-1 lg:grid-cols-[1fr_auto_1fr] lg:gap-2">
              <Field label="From" htmlFor="origin">
                {fromField}
              </Field>
              <div className="flex items-end justify-center pb-1">{swapButton}</div>
              <Field label="To" htmlFor="dest">
                {toField}
              </Field>
            </FieldRow>
            <FieldRow
              cols={cn(
                'grid-cols-1',
                tripType === 'ROUNDTRIP'
                  ? 'sm:grid-cols-4 sm:gap-3'
                  : 'sm:grid-cols-3 sm:gap-3',
              )}
            >
              <Field label="Departure" htmlFor="date">
                {dateField}
              </Field>
              {tripType === 'ROUNDTRIP' ? (
                <Field label="Return" htmlFor="returnDate">
                  {returnDateField}
                </Field>
              ) : null}
              <Field label="Class">{classField}</Field>
              <Field label="Passengers">{paxField}</Field>
            </FieldRow>
          </>
        )}
      </SearchPanel>
    );
  }

  // ────────── Compact variant ──────────

  return (
    <div className="rounded-lg border bg-surface-1 p-3 shadow-sm space-y-3">
      <TripTypeTabs
        value={tripType}
        onChange={(v) => setTripType(v as TripType)}
        options={[
          { value: 'ONEWAY', label: 'One way' },
          { value: 'ROUNDTRIP', label: 'Round trip' },
          { value: 'MULTICITY', label: 'Multi-city' },
        ]}
      />
      {tripType === 'MULTICITY' ? (
        <>
          {multiCityRows}
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Class">{classField}</Field>
            <Field label="Passengers">{paxField}</Field>
            <Button
              onClick={submit}
              loading={loading}
              className="h-10 w-full sm:min-w-[140px]"
            >
              {!loading ? (
                <>
                  <SearchIcon className="h-4 w-4" /> {ctaLabel ?? 'Modify'}
                </>
              ) : (
                <>Searching…</>
              )}
            </Button>
          </div>
        </>
      ) : (
        <div
          className={cn(
            'grid gap-2 lg:items-end',
            tripType === 'ROUNDTRIP'
              ? 'lg:grid-cols-[1.4fr_auto_1.4fr_1fr_1fr_1fr_1fr_auto]'
              : 'lg:grid-cols-[1.4fr_auto_1.4fr_1fr_1fr_1fr_auto]',
          )}
        >
          <Field label="From" htmlFor="origin">
            {fromField}
          </Field>
          <div className="hidden items-end justify-center pb-1 lg:flex">{swapButton}</div>
          <Field label="To" htmlFor="dest">
            {toField}
          </Field>
          <Field label="Departure" htmlFor="date">
            {dateField}
          </Field>
          {tripType === 'ROUNDTRIP' ? (
            <Field label="Return" htmlFor="returnDate">
              {returnDateField}
            </Field>
          ) : null}
          <Field label="Class">{classField}</Field>
          <Field label="Passengers">{paxField}</Field>
          <div className="lg:pb-0.5">
            <Button
              onClick={submit}
              loading={loading}
              className="h-10 w-full lg:min-w-[140px]"
            >
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
      )}
    </div>
  );
}
