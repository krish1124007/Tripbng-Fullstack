'use client';

import { ArrowRight, CheckCircle2, PlaneTakeoff, Sparkles } from 'lucide-react';
import type { HolidayPackage } from '@tripbng/shared';
import { Badge, Button, Card } from '@/components/ui';
import { formatRupees } from '@/lib/mock-search';
import { cn } from '@/lib/utils';

interface PackageCardProps {
  p: HolidayPackage;
  travellers: number;
  onView: () => void;
  onBook: () => void;
}

/**
 * Holiday-package result card. Renders the gradient hero, badges (best seller,
 * flights included), inclusions chips, and a per-pax + total price. The whole
 * hero strip is clickable into the detail page; "Get quote" adds to itinerary.
 */
export function PackageCard({ p, travellers, onView, onBook }: PackageCardProps) {
  const totalRupees = p.perPaxRupees * Math.max(1, travellers);
  return (
    <Card className="group flex h-full flex-col overflow-hidden p-0 transition-all duration-fast hover:border-brand-300 hover:shadow-md">
      <button
        type="button"
        onClick={onView}
        aria-label={`View ${p.title} details`}
        className={cn('relative block h-36 w-full bg-gradient-to-br', p.imageGradient)}
      >
        {p.bestSeller ? (
          <Badge variant="accent" className="absolute left-3 top-3">
            <Sparkles className="h-2.5 w-2.5" /> Best seller
          </Badge>
        ) : null}
        {p.flightIncluded ? (
          <Badge variant="brand" className="absolute right-3 top-3">
            <PlaneTakeoff className="h-2.5 w-2.5" /> Flights inc.
          </Badge>
        ) : null}
      </button>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">
            {p.nights} nights · {p.cities.join(' · ')}
          </p>
          <button
            type="button"
            onClick={onView}
            className="mt-1 block text-left text-base font-bold tracking-tight text-ink-1 transition-colors hover:text-brand-700"
          >
            {p.title}
          </button>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {p.inclusions.slice(0, 5).map((i) => (
            <li
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
            >
              <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={2.5} />
              {i}
            </li>
          ))}
          {p.inclusions.length > 5 ? (
            <li className="text-[10px] text-ink-3">+{p.inclusions.length - 5} more</li>
          ) : null}
        </ul>

        <div className="mt-auto border-t pt-3">
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="eyebrow text-ink-3">Per pax · from</p>
              <p className="font-mono text-2xl font-bold tabular-nums text-ink-1">
                {formatRupees(p.perPaxRupees)}
              </p>
              <p className="font-mono text-[10px] text-ink-3">
                {formatRupees(totalRupees, { compact: true })} total · {travellers} pax
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Button onClick={onView} variant="secondary" size="sm">
                View details
              </Button>
              <Button onClick={onBook} size="sm">
                Quote <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
