'use client';

// Bus search form — source / destination cities + journey date.
//
// Distinct from the older `/buses` placeholder form (which uses the
// stub `BusOption` shape from products.ts). This one wires the new
// SeatSeller-backed `/api/v1/bus/*` surface.

import { useState } from 'react';
import { ArrowRightLeft, Calendar as CalendarIcon, Search as SearchIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { BusCity } from '@tripbng/shared';
import { Button, Input } from '@/components/ui';
import { Field, FieldRow, SearchPanel } from '@/components/search-panel';
import { BusCityInput } from './bus-city-input';

export interface BusSearchFormValues {
  source: BusCity;
  destination: BusCity;
  /** "yyyy-MM-dd" */
  doj: string;
}

interface BusSearchFormProps {
  variant?: 'hero' | 'compact';
  initial?: { source?: BusCity; destination?: BusCity; doj?: string };
  loading?: boolean;
  onSubmit: (values: BusSearchFormValues) => void;
}

function todayPlus(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  // ISO YYYY-MM-DD in IST (offset +05:30).
  const ist = new Date(d.getTime() + 5.5 * 60 * 60_000);
  return ist.toISOString().slice(0, 10);
}

export function BusSearchForm({
  variant = 'hero',
  initial,
  loading = false,
  onSubmit,
}: BusSearchFormProps) {
  const [source, setSource] = useState<BusCity | null>(initial?.source ?? null);
  const [destination, setDestination] = useState<BusCity | null>(initial?.destination ?? null);
  const [doj, setDoj] = useState(initial?.doj ?? todayPlus(1));

  const swap = () => {
    setSource(destination);
    setDestination(source);
  };

  const submit = () => {
    if (!source) {
      toast.error('Pick a source city');
      return;
    }
    if (!destination) {
      toast.error('Pick a destination city');
      return;
    }
    if (source.id === destination.id) {
      toast.error('Source and destination must differ');
      return;
    }
    if (!doj) {
      toast.error('Pick a journey date');
      return;
    }
    onSubmit({ source, destination, doj });
  };

  const fields = (
    <FieldRow>
      <Field label="From" htmlFor="bus-from">
        <BusCityInput id="bus-from" value={source} onChange={setSource} placeholder="From city" autoFocus />
      </Field>
      <button
        type="button"
        onClick={swap}
        className="hidden h-9 w-9 shrink-0 items-center justify-center self-end rounded-full border bg-surface-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1 sm:flex"
        aria-label="Swap cities"
      >
        <ArrowRightLeft className="h-3.5 w-3.5" />
      </button>
      <Field label="To" htmlFor="bus-to">
        <BusCityInput value={destination} onChange={setDestination} placeholder="To city" />
      </Field>
      <Field label="Date" htmlFor="bus-doj">
        <Input
          id="doj"
          type="date"
          value={doj}
          min={todayPlus(0)}
          max={todayPlus(89)}
          onChange={(e) => setDoj(e.target.value)}
          leading={<CalendarIcon className="h-4 w-4" strokeWidth={1.75} />}
        />
      </Field>
    </FieldRow>
  );

  const cta = (
    <Button onClick={submit} loading={loading} className="w-full sm:w-auto">
      <SearchIcon className="h-4 w-4" /> Search buses
    </Button>
  );

  if (variant === 'compact') {
    return (
      <div className="grid grid-cols-1 gap-3 rounded-lg border bg-surface-1 p-3 sm:grid-cols-[1fr_auto_1fr_180px_auto] sm:items-end">
        <Field label="From" htmlFor="bus-from">
          <BusCityInput value={source} onChange={setSource} placeholder="From city" />
        </Field>
        <button
          type="button"
          onClick={swap}
          className="mb-2 hidden h-9 w-9 self-end rounded-full border bg-surface-1 text-ink-3 hover:bg-surface-2 sm:grid sm:place-items-center"
          aria-label="Swap"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
        </button>
        <Field label="To" htmlFor="bus-to">
          <BusCityInput value={destination} onChange={setDestination} placeholder="To city" />
        </Field>
        <Field label="Date" htmlFor="bus-doj">
          <Input
            id="doj"
            type="date"
            value={doj}
            min={todayPlus(0)}
            max={todayPlus(89)}
            onChange={(e) => setDoj(e.target.value)}
          />
        </Field>
        <Button onClick={submit} loading={loading}>
          <SearchIcon className="h-4 w-4" />
          Search
        </Button>
      </div>
    );
  }

  return (
    <SearchPanel
      eyebrow="Booking · Buses"
      title="Find a bus"
      subtitle="Series, RTC and private operators on one screen — re-priced live before booking."
      footer={cta}
    >
      {fields}
    </SearchPanel>
  );
}

// Public helper — exported so the landing page can seed today+1 without
// duplicating the IST-aware logic.
export { todayPlus };
