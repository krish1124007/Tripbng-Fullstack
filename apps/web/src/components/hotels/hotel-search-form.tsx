'use client';

import { useState } from 'react';
import {
  ArrowRight,
  Calendar as CalendarIcon,
  Globe,
  Hotel,
  MapPin,
  Search as SearchIcon,
  Sparkles,
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
import { Field, FieldRow, SearchPanel } from '@/components/search-panel';
import { cn } from '@/lib/utils';
import { Counter } from './counter';
import { NATIONALITIES, todayPlus } from './utils';

export interface HotelSearchFormValues {
  destination: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  guests: number;
  nationality: string;
}

interface HotelSearchFormProps {
  variant?: 'hero' | 'compact';
  initial?: Partial<HotelSearchFormValues>;
  loading?: boolean;
  ctaLabel?: string;
  onSubmit: (values: HotelSearchFormValues) => void;
}

/**
 * Hotel-search form with hero (landing) and compact (results-page sticky)
 * variants. Both emit the same `HotelSearchFormValues` shape via onSubmit.
 */
export function HotelSearchForm({
  variant = 'hero',
  initial,
  loading = false,
  ctaLabel,
  onSubmit,
}: HotelSearchFormProps) {
  const [destination, setDestination] = useState(initial?.destination ?? '');
  const [checkIn, setCheckIn] = useState(initial?.checkIn ?? todayPlus(7));
  const [checkOut, setCheckOut] = useState(initial?.checkOut ?? todayPlus(9));
  const [nationality, setNationality] = useState(initial?.nationality ?? 'IN');
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [rooms, setRooms] = useState(initial?.rooms ?? 1);
  const [guests, setGuests] = useState(initial?.guests ?? 2);

  const submit = () => {
    if (!destination.trim()) {
      toast.error('Pick a destination to search hotels');
      return;
    }
    if (new Date(checkOut).getTime() <= new Date(checkIn).getTime()) {
      toast.error('Check-out must be after check-in');
      return;
    }
    onSubmit({
      destination: destination.trim(),
      checkIn,
      checkOut,
      rooms,
      guests,
      nationality,
    });
  };

  // ────────── Field controls (shared between variants) ──────────

  const destinationField = (
    <Input
      id="destination"
      value={destination}
      onChange={(e) => setDestination(e.target.value)}
      placeholder="e.g. Bangkok, Bali, Burj Khalifa"
      leading={<MapPin className="h-4 w-4" strokeWidth={1.75} />}
    />
  );
  const checkInField = (
    <Input
      id="checkin"
      type="date"
      value={checkIn}
      min={todayPlus(0)}
      onChange={(e) => setCheckIn(e.target.value)}
      leading={<CalendarIcon className="h-4 w-4" strokeWidth={1.75} />}
    />
  );
  const checkOutField = (
    <Input
      id="checkout"
      type="date"
      value={checkOut}
      min={checkIn}
      onChange={(e) => setCheckOut(e.target.value)}
      leading={<CalendarIcon className="h-4 w-4" strokeWidth={1.75} />}
    />
  );
  const roomsField = (
    <div className="relative">
      <button
        type="button"
        onClick={() => setRoomsOpen((v) => !v)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-surface-1 px-3 text-sm transition-colors hover:border-ink-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2 text-ink-1">
          <UsersIcon className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
          <span className="font-mono tabular-nums">
            {rooms} {rooms === 1 ? 'rm' : 'rms'} · {guests} {guests === 1 ? 'gst' : 'gsts'}
          </span>
        </span>
        <ArrowRight
          className={cn('h-4 w-4 text-ink-4 transition-transform', roomsOpen && 'rotate-90')}
        />
      </button>
      {roomsOpen ? (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-72 animate-slide-down rounded-lg border bg-surface-1 p-4 shadow-lg">
          <Counter label="Rooms" value={rooms} onChange={setRooms} min={1} max={9} />
          <Counter label="Guests" value={guests} onChange={setGuests} min={1} max={20} />
          <Button size="sm" variant="soft" className="mt-2 w-full" onClick={() => setRoomsOpen(false)}>
            Done
          </Button>
        </div>
      ) : null}
    </div>
  );
  const nationalityField = (
    <Select value={nationality} onValueChange={setNationality}>
      <SelectTrigger>
        <Globe className="h-4 w-4 text-ink-3" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NATIONALITIES.map((n) => (
          <SelectItem key={n.value} value={n.value}>
            {n.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  // ────────── Hero variant ──────────

  if (variant === 'hero') {
    return (
      <SearchPanel
        eyebrow="Booking · Hotels"
        title="Search & book hotels worldwide"
        subtitle="Contracted rates on direct hotels and live availability via global suppliers — currency-aware, nationality-aware."
        icon={Hotel}
        footer={
          <>
            <p className="flex items-center gap-1.5 text-xs text-ink-3">
              <Sparkles className="h-3 w-3 text-brand-500" />
              <span className="font-semibold">5,400+</span> direct hotels · contracted rates · 24×7 trade desk
            </p>
            <Button
              onClick={submit}
              loading={loading}
              size="xl"
              className="w-full sm:w-auto sm:min-w-[220px] shadow-brand"
            >
              {!loading ? (
                <>
                  <SearchIcon className="h-4 w-4" /> {ctaLabel ?? 'Search hotels'}
                </>
              ) : (
                <>Searching…</>
              )}
            </Button>
          </>
        }
      >
        <Field label="Where to?" htmlFor="destination" hint="City, hotel name, or landmark">
          {destinationField}
        </Field>
        <FieldRow cols="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 sm:gap-3">
          <Field label="Check-in" htmlFor="checkin">
            {checkInField}
          </Field>
          <Field label="Check-out" htmlFor="checkout">
            {checkOutField}
          </Field>
          <Field label="Rooms & guests">{roomsField}</Field>
          <Field label="Nationality">{nationalityField}</Field>
        </FieldRow>
      </SearchPanel>
    );
  }

  // ────────── Compact variant ──────────

  return (
    <div className="rounded-lg border bg-surface-1 p-3 shadow-sm">
      <div className="grid gap-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
        <Field label="Destination" htmlFor="destination">
          {destinationField}
        </Field>
        <Field label="Check-in" htmlFor="checkin">
          {checkInField}
        </Field>
        <Field label="Check-out" htmlFor="checkout">
          {checkOutField}
        </Field>
        <Field label="Rooms & guests">{roomsField}</Field>
        <Field label="Nationality">{nationalityField}</Field>
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
