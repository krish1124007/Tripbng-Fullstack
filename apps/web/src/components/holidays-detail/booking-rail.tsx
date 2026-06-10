'use client';

// Sticky right rail on /holidays/packages/[id]. Holds the customer's selection
// (departure date / city, sharing type, pax counts), runs the live quote off
// the package's priceMatrix via lib/holiday-quote.ts, and surfaces the live
// breakdown + smart CTA. The CTA adds the package to the topbar cart on click.

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  Info,
  MapPin,
  Minus,
  Plus,
  Sparkles,
  Users as UsersIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AdminHolidayPackage } from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { quoteHolidayPackage, type SharingType } from '@/lib/holiday-quote';
import { useCart } from '@/lib/cart';
import { BookAndPayDialog } from '@/app/(dashboard)/holidays/packages/[id]/_book-and-pay-dialog';

interface Selection {
  departureDate: string;
  departureCity: string;
  sharingType: SharingType;
  adults: number;
  childrenWithBed: number;
  childrenWithoutBed: number;
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function BookingRail({ pkg }: { pkg: AdminHolidayPackage }) {
  const addToCart = useCart((s) => s.addItem);
  const [bookOpen, setBookOpen] = useState(false);

  const [sel, setSel] = useState<Selection>({
    departureDate: todayPlus(14),
    departureCity: pkg.departureCities[0] ?? 'Any',
    sharingType: 'double',
    adults: 2,
    childrenWithBed: 0,
    childrenWithoutBed: 0,
  });

  const breakdown = useMemo(
    () =>
      quoteHolidayPackage(pkg, {
        departureDate: sel.departureDate,
        sharingType: sel.sharingType,
        adults: sel.adults,
        childrenWithBed: sel.childrenWithBed,
        childrenWithoutBed: sel.childrenWithoutBed,
      }),
    [pkg, sel],
  );

  const totalPax = sel.adults + sel.childrenWithBed + sel.childrenWithoutBed;

  const onAdd = () => {
    if (sel.adults < 1) {
      toast.error('At least one adult is required');
      return;
    }
    addToCart({
      id: `holiday:${pkg.id ?? pkg.title}`,
      kind: 'holiday',
      title: pkg.title,
      subtitle: `${pkg.nights} nights · ${pkg.cities.map((c) => c.city).join(' · ') || pkg.destination} · ${sel.sharingType} sharing`,
      datePrimary: sel.departureDate,
      priceRupees: breakdown.totalInr,
      qty: totalPax || 1,
      meta: {
        sharingType: sel.sharingType,
        adults: sel.adults,
        childrenWithBed: sel.childrenWithBed,
        childrenWithoutBed: sel.childrenWithoutBed,
        departureCity: sel.departureCity,
        breakdown,
      },
    });
    toast.success(`${pkg.title} added to your itinerary`, {
      description: 'Open the cart in the topbar to review or generate a quote.',
    });
  };

  return (
    <Card className="md:sticky md:top-4">
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="eyebrow text-ink-3">Live quote</p>
          <p className="font-mono text-3xl font-bold tabular-nums text-ink-1">
            ₹{breakdown.totalInr.toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-ink-3">
            {totalPax} {totalPax === 1 ? 'traveller' : 'travellers'} · all-in
          </p>
          {breakdown.matchedLabel ? (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <Sparkles className="h-2.5 w-2.5" /> {breakdown.matchedLabel}
            </p>
          ) : null}
        </div>

        {/* Tier picker (sharing) */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Sharing</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['single', 'Single'],
                ['double', 'Double'],
                ['triple', 'Triple'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSel({ ...sel, sharingType: key })}
                className={`rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                  sel.sharingType === key
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Departure date */}
        <Field label="Departure">
          <Input
            type="date"
            value={sel.departureDate}
            min={todayPlus(0)}
            onChange={(e) => setSel({ ...sel, departureDate: e.target.value })}
            leading={<CalendarIcon className="h-4 w-4" strokeWidth={1.75} />}
          />
        </Field>

        {/* Departure city */}
        {pkg.departureCities.length > 0 ? (
          <Field label="Departure city">
            <Select
              value={sel.departureCity}
              onValueChange={(v) => setSel({ ...sel, departureCity: v })}
            >
              <SelectTrigger>
                <MapPin className="h-4 w-4 text-ink-3" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pkg.departureCities.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        {/* Pax counters */}
        <Field label="Adults">
          <Counter
            value={sel.adults}
            onChange={(n) => setSel({ ...sel, adults: n })}
            min={1}
            max={20}
          />
        </Field>
        <Field label="Children with bed">
          <Counter
            value={sel.childrenWithBed}
            onChange={(n) => setSel({ ...sel, childrenWithBed: n })}
            min={0}
            max={10}
          />
        </Field>
        <Field label="Children without bed">
          <Counter
            value={sel.childrenWithoutBed}
            onChange={(n) => setSel({ ...sel, childrenWithoutBed: n })}
            min={0}
            max={10}
          />
        </Field>

        {/* Live breakdown */}
        <div className="rounded-md border bg-surface-2/40 p-3 text-xs">
          <Row label={`Per adult × ${sel.adults}`}>
            ₹{(breakdown.perAdultInr * sel.adults).toLocaleString('en-IN')}
          </Row>
          {sel.childrenWithBed > 0 ? (
            <Row label={`Child w/ bed × ${sel.childrenWithBed}`}>
              ₹{(breakdown.perChildWithBedInr * sel.childrenWithBed).toLocaleString('en-IN')}
            </Row>
          ) : null}
          {sel.childrenWithoutBed > 0 ? (
            <Row label={`Child w/o bed × ${sel.childrenWithoutBed}`}>
              ₹{(breakdown.perChildWithoutBedInr * sel.childrenWithoutBed).toLocaleString('en-IN')}
            </Row>
          ) : null}
          <Row label="Subtotal">₹{breakdown.subtotalInr.toLocaleString('en-IN')}</Row>
          <Row label="Markup (5%)">₹{breakdown.markupInr.toLocaleString('en-IN')}</Row>
          <Row label="GST (5%)">₹{breakdown.gstInr.toLocaleString('en-IN')}</Row>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
            <span className="font-semibold text-ink-1">Total</span>
            <span className="font-mono font-bold tabular-nums text-ink-1">
              ₹{breakdown.totalInr.toLocaleString('en-IN')}
            </span>
          </div>
        </div>

        {!breakdown.matrixHit ? (
          <p className="flex items-start gap-1.5 text-[10px] text-ink-3">
            <Info className="mt-0.5 h-3 w-3 shrink-0" /> Indicative price — no matrix row matched
            this date / pax combination. Switch to a covered date for a confirmed rate.
          </p>
        ) : null}

        <Button
          onClick={() => {
            if (sel.adults < 1) {
              toast.error('At least one adult is required');
              return;
            }
            setBookOpen(true);
          }}
          size="lg"
          className="w-full"
        >
          Book &amp; pay ₹{breakdown.totalInr.toLocaleString('en-IN')}{' '}
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button onClick={onAdd} variant="secondary" size="md" className="w-full">
          Add to itinerary
        </Button>
        <p className="flex items-center justify-center gap-1 text-[10px] text-ink-3">
          <CheckCircle2 className="h-3 w-3 text-success" /> Wallet debit on confirm.
        </p>

        {pkg.fixDeparture ? (
          <Badge variant="accent" className="w-full justify-center text-[9px]">
            Fixed departure — pick a published date
          </Badge>
        ) : null}
      </CardContent>

      <BookAndPayDialog
        open={bookOpen}
        onOpenChange={setBookOpen}
        pkg={pkg}
        selection={{
          departureDate: sel.departureDate,
          departureCity: sel.departureCity,
          sharingType: sel.sharingType,
          adults: sel.adults,
          childrenWithBed: sel.childrenWithBed,
          childrenWithoutBed: sel.childrenWithoutBed,
          totalInr: breakdown.totalInr,
        }}
      />
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{label}</p>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-ink-3">{label}</span>
      <span className="font-mono tabular-nums text-ink-1">{children}</span>
    </div>
  );
}

function Counter({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="grid h-9 w-9 place-items-center rounded-md border text-ink-3 transition-colors hover:border-ink-5 hover:text-ink-1 disabled:opacity-40"
        aria-label="Decrement"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="flex-1 text-center font-mono text-sm font-semibold tabular-nums">
        <UsersIcon className="mr-1 inline h-3 w-3 text-ink-3" />
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="grid h-9 w-9 place-items-center rounded-md border text-ink-3 transition-colors hover:border-ink-5 hover:text-ink-1 disabled:opacity-40"
        aria-label="Increment"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
