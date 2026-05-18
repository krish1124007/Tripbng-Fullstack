'use client';

// Compact card for one trip in the search-results list.

import { ArrowRight, Bed, Bus, Snowflake, Sunrise } from 'lucide-react';
import type { BusTrip } from '@tripbng/shared';
import { Badge, Button, Card, CardContent } from '@/components/ui';
import { cn } from '@/lib/utils';

interface BusTripCardProps {
  trip: BusTrip;
  /** Click → navigate to seat-picker page. */
  onPick: (trip: BusTrip) => void;
}

export function BusTripCard({ trip, onPick }: BusTripCardProps) {
  const dep = new Date(trip.departureAt);
  const arr = new Date(trip.arrivalAt);
  const durationMin = Math.max(0, Math.round((arr.getTime() - dep.getTime()) / 60_000));
  const hours = Math.floor(durationMin / 60);
  const mins = durationMin % 60;

  return (
    <Card className="transition-shadow hover:shadow-elevated">
      <CardContent className="grid grid-cols-1 items-center gap-4 p-4 sm:grid-cols-[1fr_auto_1fr_auto]">
        {/* Operator + bus type + tags */}
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <Bus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
            <p className="text-sm font-semibold text-ink-1">{trip.operatorName || 'Operator'}</p>
          </div>
          <p className="mt-1 text-xs text-ink-3">{trip.busType}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {trip.isAc ? (
              <Badge variant="brand" className="text-[10px]">
                <Snowflake className="h-2.5 w-2.5" /> AC
              </Badge>
            ) : null}
            {trip.isSleeper ? (
              <Badge variant="neutral" className="text-[10px]">
                <Bed className="h-2.5 w-2.5" /> Sleeper
              </Badge>
            ) : null}
            {trip.nextDay ? (
              <Badge variant="warning" className="text-[10px]">
                <Sunrise className="h-2.5 w-2.5" /> Next day
              </Badge>
            ) : null}
          </div>
        </div>

        {/* Times */}
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="text-center">
            <p className="font-mono text-base font-semibold text-ink-1">
              {dep.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </p>
            <p className="text-[10px] uppercase text-ink-3">{trip.source.name ?? '—'}</p>
          </div>
          <div className="flex flex-col items-center text-ink-4">
            <ArrowRight className="h-3.5 w-3.5" />
            <p className="mt-1 text-[10px]">
              {hours}h {mins}m
            </p>
          </div>
          <div className="text-center">
            <p className="font-mono text-base font-semibold text-ink-1">
              {arr.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </p>
            <p className="text-[10px] uppercase text-ink-3">{trip.destination.name ?? '—'}</p>
          </div>
        </div>

        {/* Fare + seats remaining */}
        <div className="text-right">
          <p
            className={cn(
              'font-mono text-base font-semibold',
              trip.availableSeats === 0 ? 'text-ink-3 line-through' : 'text-ink-1',
            )}
          >
            ₹{trip.fareMinINR.toFixed(0)}
            {trip.fareMaxINR > trip.fareMinINR ? ` – ₹${trip.fareMaxINR.toFixed(0)}` : ''}
          </p>
          <p className="text-[10px] text-ink-3">
            {trip.availableSeats > 0 ? `${trip.availableSeats} seats left` : 'Sold out'}
          </p>
        </div>

        {/* CTA */}
        <Button
          size="sm"
          variant="primary"
          disabled={trip.availableSeats === 0}
          onClick={() => onPick(trip)}
        >
          Select <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
