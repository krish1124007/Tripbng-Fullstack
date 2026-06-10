'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownToLine,
  CheckCircle2,
  Circle,
  PlaneTakeoff,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step {
  key: string;
  title: string;
  desc: string;
  href: string;
  icon: typeof PlaneTakeoff;
  done: boolean;
}

interface Props {
  /** Wallet balance in paise — controls whether "top up" is marked done. */
  walletBalancePaise: number;
  /** Total bookings across all statuses — controls whether "first booking" is marked done. */
  bookingsCount: number;
  /** First name for the greeting. */
  firstName: string;
}

const STORAGE_KEY = 'tripbng:welcome-dismissed';

/**
 * WelcomeBanner — for first-time agencies. Shows a 3-step quick-start with progress.
 * Auto-dismisses when all steps are complete; user can also dismiss explicitly (persisted).
 */
export function WelcomeBanner({ walletBalancePaise, bookingsCount, firstName }: Props) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  if (dismissed === null) return null; // SSR guard

  const steps: Step[] = [
    {
      key: 'topup',
      title: 'Top up your wallet',
      desc: "Bank transfer or NEFT — upload your payment proof, we'll credit in minutes.",
      href: '/topups',
      icon: ArrowDownToLine,
      done: walletBalancePaise > 0,
    },
    {
      key: 'search',
      title: 'Run your first search',
      desc: 'Compare fares across airlines and suppliers, all on a single screen.',
      href: '/flights',
      icon: PlaneTakeoff,
      done: bookingsCount > 0,
    },
    {
      key: 'book',
      title: 'Issue your first ticket',
      desc: 'Book, confirm, and get your e-ticket — wallet debits automatically.',
      href: '/flights',
      icon: Sparkles,
      done: bookingsCount > 0,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const totalCount = steps.length;
  const allDone = completedCount === totalCount;

  // Hide if explicitly dismissed OR all steps done.
  if (dismissed || allDone) return null;

  const onDismiss = () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
  };

  return (
    <section className="relative overflow-hidden rounded-xl border border-brand-300/50 bg-gradient-to-br from-brand-50 via-surface-1 to-accent-50/40 dark:from-brand-500/15 dark:via-surface-1 dark:to-accent-500/8 dark:border-brand-500/30">
      {/* Decorative blob */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-200/30 blur-3xl dark:bg-brand-500/15"
      />
      <div className="relative grid gap-5 p-6 lg:grid-cols-[1fr_auto] lg:p-7">
        <div className="space-y-1">
          <p className="eyebrow flex items-center gap-1.5 text-brand-700 dark:text-brand-300">
            <Sparkles className="h-3 w-3" /> Welcome to TripBng
          </p>
          <h2 className="text-h2 text-balance text-ink-1">
            Hey {firstName}, three quick steps and you're booking tickets.
          </h2>
          <p className="text-sm text-ink-3">
            {completedCount} of {totalCount} done · about 5 minutes total.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex h-2 w-32 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-brand-500 transition-all duration-slow"
              style={{ width: `${(completedCount / totalCount) * 100}%` }}
            />
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss welcome banner"
            className="grid h-8 w-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative grid gap-px border-t bg-border sm:grid-cols-3">
        {steps.map((s, i) => (
          <Link
            key={s.key}
            href={s.href}
            className={cn(
              'group relative flex flex-col gap-2 bg-surface-1 p-5 transition-colors hover:bg-surface-2',
              s.done && 'opacity-60',
            )}
          >
            <div className="flex items-center gap-2">
              {s.done ? (
                <CheckCircle2 className="h-5 w-5 text-success" strokeWidth={2} />
              ) : (
                <Circle className="h-5 w-5 text-ink-4" strokeWidth={1.75} />
              )}
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-4">
                Step {i + 1}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <s.icon
                className={cn(
                  'h-4 w-4',
                  s.done ? 'text-ink-4' : 'text-brand-600 dark:text-brand-400',
                )}
                strokeWidth={1.75}
              />
              <h3
                className={cn(
                  'text-sm font-semibold',
                  s.done ? 'text-ink-3 line-through' : 'text-ink-1',
                )}
              >
                {s.title}
              </h3>
            </div>
            <p className="text-xs text-ink-3">{s.desc}</p>
            {!s.done ? (
              <span className="mt-1 text-xs font-semibold text-brand-700 transition-all group-hover:translate-x-0.5 dark:text-brand-300">
                Start →
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Helper button to invoke dismissal externally (used by the dashboard's "Dismiss tour" link). */
export function dismissWelcome() {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, '1');
  }
}
