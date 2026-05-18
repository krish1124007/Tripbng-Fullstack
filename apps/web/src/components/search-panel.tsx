'use client';

import { type ReactNode } from 'react';
import { Sparkles, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * SearchPanel — visual wrapper for the hero search form on each product page.
 * Provides a decorative gradient background, generous padding, optional eyebrow
 * + title, and slots for the search form rows + a primary action footer.
 *
 * Usage:
 *   <SearchPanel
 *     eyebrow="Booking · Flights"
 *     title="Find a flight"
 *     subtitle="Series, LCC, FSC — one ranked list."
 *     tabs={<TripTypeTabs ... />}
 *     footer={<Button size="xl">Search flights</Button>}
 *   >
 *     // form rows go here
 *   </SearchPanel>
 */
export function SearchPanel({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  tabs,
  footer,
  children,
  className,
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  tabs?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-surface-1 shadow-sm',
        className,
      )}
    >
      {/* Decorative brand-tinted gradient — keeps the panel visually distinct
          from the rest of the page without screaming. Three soft radials in
          the corners give it depth on both light and dark themes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55] dark:opacity-30"
        style={{
          backgroundImage: `
            radial-gradient(800px 300px at 0% 0%, var(--brand-50) 0%, transparent 60%),
            radial-gradient(600px 250px at 100% 0%, var(--accent-50) 0%, transparent 55%),
            radial-gradient(700px 300px at 50% 110%, var(--brand-100) 0%, transparent 65%)
          `,
        }}
      />
      {/* Subtle decorative sparkle in the top-right corner — only on lg+. */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-8 top-8 hidden lg:block"
      >
        <Sparkles className="h-5 w-5 text-brand-300/40 dark:text-brand-500/30" strokeWidth={1.5} />
      </div>

      <div className="relative p-6 lg:p-8">
        {/* Header — eyebrow + title + subtitle, optional icon disc */}
        {(eyebrow || title || subtitle) ? (
          <header className="mb-6 flex items-start gap-4">
            {Icon ? (
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700 ring-4 ring-white/60 dark:bg-brand-500/20 dark:text-brand-300 dark:ring-surface-1/40">
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              {eyebrow ? <p className="eyebrow text-brand-600 dark:text-brand-300">{eyebrow}</p> : null}
              {title ? (
                <h1 className="mt-1 text-h2 leading-tight tracking-tight text-ink-1 lg:text-h1">
                  {title}
                </h1>
              ) : null}
              {subtitle ? (
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-3">{subtitle}</p>
              ) : null}
            </div>
          </header>
        ) : null}

        {/* Optional tabs — trip-type / category switcher above the form */}
        {tabs ? <div className="mb-5 flex items-center gap-2">{tabs}</div> : null}

        {/* The form rows */}
        <div className="space-y-4">{children}</div>

        {/* Footer — primary search button + secondary action area */}
        {footer ? <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">{footer}</div> : null}
      </div>
    </section>
  );
}

/**
 * TripTypeTabs — pill-style tab strip used inside SearchPanel for trip type
 * (One way / Round trip / Multi-city) or category (Series / Tailor-made).
 *
 * Pure presentational — caller wires `value` + `onChange`.
 */
export function TripTypeTabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex items-center gap-1 rounded-full border bg-surface-2 p-1', className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-all duration-fast',
              active
                ? 'bg-surface-1 text-brand-700 shadow-sm dark:bg-surface-1 dark:text-brand-300'
                : 'text-ink-3 hover:text-ink-1',
            )}
          >
            {opt.icon ? <opt.icon className="h-3.5 w-3.5" strokeWidth={2} /> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * FieldRow — labelled responsive grid row for the form fields. Pass
 * `cols` as a Tailwind grid template string (e.g., "1fr_auto_1fr_1fr").
 *
 * The row uses `auto-rows-min` so vertical alignment stays clean when fields
 * have different heights (e.g., one has a popover that may briefly expand).
 */
export function FieldRow({
  cols,
  children,
  className,
}: {
  /** Tailwind grid-template — defaults to a sensible auto-1fr layout. */
  cols?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid auto-rows-min gap-3 lg:gap-3',
        cols ?? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Field — labelled column inside a FieldRow. Eyebrow label + control slot.
 * Keeps every field in the form visually consistent (same label treatment,
 * same spacing) regardless of which input component is inside.
 */
export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="eyebrow flex items-center justify-between gap-2 text-ink-3"
      >
        <span>{label}</span>
        {hint ? <span className="text-[10px] font-medium normal-case tracking-normal text-ink-4">{hint}</span> : null}
      </label>
      {children}
    </div>
  );
}
