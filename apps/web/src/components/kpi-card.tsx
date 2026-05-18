'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Sparkline } from '@/components/charts';
import { cn } from '@/lib/utils';

export interface KpiCardProps {
  /** Small ALL-CAPS label above the number. */
  label: string;
  /** The hero value. Pre-format money with formatPaiseAsINR yourself. */
  value: React.ReactNode;
  /** Tiny icon inside a soft disc, top-right. */
  icon?: LucideIcon;
  /** Trend delta (e.g. 0.082 for +8.2%). Null = "no prior data". */
  delta?: number | null;
  /** Optional explainer ("vs last month", "this week"). */
  deltaLabel?: string;
  /** Sub-line under the value (e.g. "12 bookings · 4 active agencies"). */
  hint?: React.ReactNode;
  /** Optional sparkline data (tiny trend line at the bottom). */
  spark?: number[];
  /** Render as a link. */
  href?: string;
  /** "brand" applies the gradient hero treatment (use for the most-important KPI). */
  tone?: 'default' | 'brand' | 'accent';
  className?: string;
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  delta,
  deltaLabel = 'vs prev',
  hint,
  spark,
  href,
  tone = 'default',
  className,
}: KpiCardProps) {
  const interactive = !!href;
  const inner = (
    <Card
      tone={tone === 'brand' ? 'brand' : 'default'}
      interactive={interactive}
      className={cn('group overflow-hidden p-0', className)}
    >
      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <p
            className={cn(
              'eyebrow flex items-center gap-1.5',
              tone === 'brand' ? 'text-brand-700 dark:text-brand-300' : 'text-ink-3',
            )}
          >
            {label}
          </p>
          {Icon ? (
            <span
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-md',
                tone === 'accent'
                  ? 'bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-400'
                  : tone === 'brand'
                    ? 'bg-brand-100/60 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'bg-surface-2 text-ink-3',
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
          ) : null}
        </div>

        <p className="mt-3 text-[28px] font-bold tabular-nums tracking-tight text-ink-1 leading-none">
          {value}
        </p>

        <div className="mt-2 flex min-h-[20px] items-center gap-2 text-xs">
          {delta != null ? <DeltaPill delta={delta} label={deltaLabel} /> : null}
          {hint ? <span className="truncate text-ink-3">{hint}</span> : null}
        </div>

        {interactive ? (
          <ArrowRight
            aria-hidden
            className="absolute right-5 bottom-5 h-3.5 w-3.5 text-ink-4 opacity-0 transition-all duration-fast group-hover:opacity-100 group-hover:translate-x-0.5"
          />
        ) : null}
      </div>

      {spark && spark.length > 1 ? (
        <div className="-mt-1 h-10 w-full">
          <Sparkline data={spark} color={tone === 'accent' ? 'var(--accent-500)' : 'var(--brand-500)'} />
        </div>
      ) : null}
    </Card>
  );

  return interactive ? (
    <Link href={href!} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function DeltaPill({ delta, label }: { delta: number; label: string }) {
  const pct = Math.abs(delta * 100);
  const flat = pct < 0.5;
  const positive = delta >= 0;
  const Icon = flat ? Minus : positive ? ArrowUpRight : ArrowDownRight;
  const cls = flat
    ? 'bg-surface-2 text-ink-3'
    : positive
      ? 'bg-success-soft text-success'
      : 'bg-danger-soft text-danger';
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono font-semibold', cls)}>
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {flat ? '0.0' : pct.toFixed(1)}%
      <span className="ml-1 font-sans font-normal text-[10px] opacity-80">{label}</span>
    </span>
  );
}
