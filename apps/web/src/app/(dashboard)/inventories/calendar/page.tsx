'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import type { InventoryCalendarDay } from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  Input,
  PageHeader,
} from '@/components/ui';
import { useApiQuery } from '@/lib/api-client';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function buildGrid(month: Date): Date[] {
  // Pad start to Sunday and end to Saturday so the grid is rectangular.
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const startPad = first.getDay();
  const endPad = 6 - last.getDay();
  const days: Date[] = [];
  for (let i = startPad; i > 0; i--) {
    const d = new Date(first);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  for (let i = 0; i < last.getDate(); i++) {
    days.push(new Date(first.getFullYear(), first.getMonth(), i + 1));
  }
  for (let i = 1; i <= endPad; i++) {
    const d = new Date(last);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

export default function InventoryCalendarPage() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');

  const grid = useMemo(() => buildGrid(month), [month]);
  const from = grid[0]!.toISOString().slice(0, 10);
  const to = grid[grid.length - 1]!.toISOString().slice(0, 10);

  const calendar = useApiQuery<InventoryCalendarDay[]>(
    ['inventory-calendar', { from, to, origin, destination }],
    '/api/v1/inventories/calendar',
    {
      query: {
        from,
        to,
        origin: origin.toUpperCase() || undefined,
        destination: destination.toUpperCase() || undefined,
      },
    },
  );

  const byDate = useMemo(() => {
    const map = new Map<string, InventoryCalendarDay['inventories']>();
    for (const day of calendar.data ?? []) map.set(day.date, day.inventories);
    return map;
  }, [calendar.data]);

  const goPrev = () => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
  const goNext = () => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1));
  const goToday = () => setMonth(startOfMonth(new Date()));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Series"
        title="Inventory calendar"
        description="Hover a day to see active inventories and remaining seats."
        actions={
          <Button variant="secondary" asChild>
            <Link href="/inventories">
              <ArrowLeft className="h-4 w-4" /> Back to list
            </Link>
          </Button>
        }
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={goPrev} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="font-display text-h2">
              {month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </h2>
            <Button variant="ghost" size="icon" onClick={goNext} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={goToday}>
              Today
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Origin"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              className="w-24 font-mono uppercase"
              maxLength={3}
            />
            <span className="text-ink-3">→</span>
            <Input
              placeholder="Destination"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="w-24 font-mono uppercase"
              maxLength={3}
            />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-7 border-t">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="border-b border-r bg-surface-2 px-3 py-2 text-xs uppercase tracking-wider text-ink-3 last:border-r-0"
            >
              {d}
            </div>
          ))}
          {grid.map((day) => {
            const key = day.toISOString().slice(0, 10);
            const inventories = byDate.get(key) ?? [];
            const inMonth = day.getMonth() === month.getMonth();
            const isToday = new Date().toDateString() === day.toDateString();
            const seats = inventories.reduce((s, i) => s + i.seatsRemaining, 0);
            return (
              <div
                key={key}
                className={cn(
                  'group relative min-h-[110px] border-b border-r p-2 text-xs last:border-r-0',
                  inMonth ? 'bg-surface-1' : 'bg-surface-0/50',
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      'font-mono text-[11px] tabular-nums',
                      isToday ? 'text-accent' : inMonth ? 'text-ink-2' : 'text-ink-4',
                    )}
                  >
                    {day.getDate()}
                  </span>
                  {inventories.length > 0 ? (
                    <Badge
                      variant={seats > 50 ? 'success' : seats > 0 ? 'warning' : 'danger'}
                      className="font-mono text-[10px]"
                    >
                      {seats} seat{seats === 1 ? '' : 's'}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 space-y-1">
                  {inventories.slice(0, 3).map((i) => (
                    <Link
                      href={`/inventories?q=${i.inventoryCode}`}
                      key={i.id}
                      className="block truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-2 hover:bg-accent-soft hover:text-accent"
                      title={`${i.inventoryName} · ${formatPaiseAsINR(i.adultFarePaise, { compact: true })}`}
                    >
                      {i.origin}-{i.destination}
                    </Link>
                  ))}
                  {inventories.length > 3 ? (
                    <p className="text-[10px] text-ink-3">+ {inventories.length - 3} more</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
