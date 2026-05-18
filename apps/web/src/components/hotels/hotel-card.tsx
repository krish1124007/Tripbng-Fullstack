'use client';

import { ArrowRight, Sparkles, Star } from 'lucide-react';
import type { HotelOption } from '@tripbng/shared';
import { Badge, Button, Card } from '@/components/ui';
import { formatRupees } from '@/lib/mock-search';
import { cn } from '@/lib/utils';

interface HotelCardProps {
  h: HotelOption;
  bestPrice: boolean;
  onView: () => void;
  onBook: () => void;
}

/**
 * Single hotel result row — image, name + stars, review badge, room/inclusion,
 * amenity chips, per-night price, and a "View details" CTA. The whole card is
 * also clickable into the detail page for fast keyboard/mouse use.
 */
export function HotelCard({ h, bestPrice, onView, onBook }: HotelCardProps) {
  return (
    <Card className="group overflow-hidden p-0 transition-all duration-fast hover:border-brand-300 hover:shadow-md">
      {bestPrice ? (
        <div className="flex items-center gap-2 border-b bg-gradient-to-r from-brand-50/40 to-transparent px-4 py-1.5 dark:from-brand-500/10">
          <Badge variant="brand" className="text-[10px]">
            <Sparkles className="h-2.5 w-2.5" /> Best price
          </Badge>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-[200px_1fr_auto] md:items-stretch">
        <button
          type="button"
          onClick={onView}
          aria-label={`View ${h.name} details`}
          className={cn('h-32 w-full bg-gradient-to-br md:h-full', h.imageGradient)}
        />
        <div className="px-5 py-4 md:p-5">
          <div className="flex items-center gap-1">
            {Array.from({ length: h.stars }).map((_, i) => (
              <Star
                key={i}
                className="h-3.5 w-3.5 fill-accent-500 text-accent-500"
                strokeWidth={1.5}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onView}
            className="mt-1 block text-left text-lg font-bold tracking-tight text-ink-1 transition-colors hover:text-brand-700"
          >
            {h.name}
          </button>
          <p className="text-xs text-ink-3">
            {h.area}, {h.city}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="success" className="text-[10px]">
              <span className="font-mono tabular-nums">{h.reviewScore.toFixed(1)}</span>
              <span className="text-[9px] opacity-70">/10</span>
            </Badge>
            <span className="text-[11px] text-ink-3">{h.reviewCount.toLocaleString('en-IN')} reviews</span>
            <Badge variant={h.refundable ? 'success' : 'neutral'} className="text-[10px]">
              {h.refundable ? 'Refundable' : 'Non-refundable'}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-ink-2">
            <span className="font-semibold">{h.roomType}</span>{' '}
            <span className="text-ink-3">· {h.inclusion}</span>
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {h.amenities.slice(0, 5).map((a) => (
              <li
                key={a}
                className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-3"
              >
                {a}
              </li>
            ))}
            {h.amenities.length > 5 ? (
              <li className="text-[10px] text-ink-3">+{h.amenities.length - 5} more</li>
            ) : null}
          </ul>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-5 py-4 md:flex-col md:items-end md:border-l md:border-t-0 md:px-6 md:py-5">
          <div className="md:text-right">
            <p className="eyebrow text-ink-3">Per night</p>
            <p className="font-mono text-2xl font-bold tabular-nums text-ink-1">
              {formatRupees(h.perNightPaise / 100)}
            </p>
            <p className="font-mono text-[10px] text-ink-3">
              {formatRupees(h.totalPaise / 100, { compact: true })} total · {h.nights}{' '}
              {h.nights === 1 ? 'night' : 'nights'}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 md:w-auto">
            <Button onClick={onView} variant="secondary" className="shrink-0 md:w-full">
              View details
            </Button>
            <Button onClick={onBook} className="shrink-0 md:w-full">
              Book <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
