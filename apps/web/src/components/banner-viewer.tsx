'use client';

// BannerViewer — renders the banners an agency / distributor / sub-agent
// is allowed to see at a given location. Mounted at the top of the agency
// dashboard, the distributor cockpit, and the admin dashboard.
//
// The API does the heavy lifting:
//   - GET /api/v1/banners returns only banners targeted at the caller
//     (ALL or DISTRIBUTOR_DOWNLINE for distributors), already filtered
//     by active + start/end window.
//   - We then filter client-side by `location` so each mount picks up
//     only its slot's banners.
//
// Type:
//   - FIXED: stacked cards (multiple banners visible at once)
//   - CAROUSEL: one banner visible at a time, auto-advance every 6s
//   - POPUP: dialog overlay on first session view (frequency-aware)
//     — POPUP isn't rendered by this component; that lives elsewhere
//
// Frequency-aware dismiss:
//   - ONCE      → localStorage flag, banner stays dismissed forever
//   - PER_SESSION → sessionStorage flag, returns next tab
//   - PER_DAY   → localStorage with day-stamp, resets at midnight
//   - ALWAYS    → no dismiss persistence

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { BannerLocation, PublicBanner } from '@tripbng/shared';
import { useApiQuery } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface BannerViewerProps {
  /** Which slot to render. Mount one BannerViewer per slot — e.g. the
   *  agency dashboard mounts AGENCY_DASHBOARD; the global topbar
   *  mounts TOP_GLOBAL. */
  location: BannerLocation;
  /** Optional cap on how many banners to render in FIXED mode. */
  maxItems?: number;
  className?: string;
}

export function BannerViewer({ location, maxItems = 3, className }: BannerViewerProps) {
  const q = useApiQuery<PublicBanner[]>(['banners', { location }], '/api/v1/banners', {
    // The list returns paginated; we ask for the largest practical page
    // because agency/distributor visitors rarely have more than a
    // handful of active banners targeted at them at any time.
    query: { page: 1, limit: 50 },
    staleTime: 60_000,
  });

  const all = q.data ?? [];

  // Pull the dismissed-banner set from storage. We re-read on each
  // render because storage may change in another tab; React state
  // sync is overkill for this volume.
  const dismissed = useDismissedBannerIds();

  const visible = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return all
      .filter((b) => b.location === location)
      .filter((b) => !isDismissed(b, today, dismissed))
      .filter((b) => b.type !== 'POPUP') // POPUP handled by a separate component
      .sort((a, b) => a.priority - b.priority)
      .slice(0, maxItems);
  }, [all, location, dismissed, maxItems]);

  if (q.isLoading || visible.length === 0) return null;

  const carousel = visible.some((b) => b.type === 'CAROUSEL');

  return (
    <div className={cn('space-y-3', className)}>
      {carousel ? (
        <BannerCarousel banners={visible} />
      ) : (
        visible.map((b) => <BannerCard key={b.id} banner={b} />)
      )}
    </div>
  );
}

// ────────── Card (single FIXED banner) ──────────

function BannerCard({ banner }: { banner: PublicBanner }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  const inner = (
    <article className="group relative flex items-stretch overflow-hidden rounded-xl border bg-gradient-to-br from-brand-50 via-white to-accent-50/40 shadow-sm transition-shadow hover:shadow-md">
      {/* Image rail — left side, fixed aspect. data: URLs and https://
          URLs render identically; the preview during admin upload uses
          the same <img> renderer. */}
      {banner.imageUrl ? (
        <div className="relative aspect-[3/2] w-44 shrink-0 overflow-hidden bg-surface-2 sm:w-56">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={banner.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-normal group-hover:scale-[1.03]"
          />
        </div>
      ) : null}

      {/* Copy + CTA */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-5">
        <h3 className="truncate text-base font-bold tracking-tight text-ink-1">
          {banner.title}
        </h3>
        {banner.body ? (
          <p className="line-clamp-2 text-sm leading-relaxed text-ink-3">{banner.body}</p>
        ) : null}
        {banner.href ? (
          <span className="mt-2 inline-flex w-fit items-center gap-1 text-sm font-semibold text-brand-700">
            Learn more
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        ) : null}
      </div>

      {/* Dismiss — frequency-respecting */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          dismissBanner(banner);
          setOpen(false);
        }}
        aria-label="Dismiss banner"
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/85 text-ink-3 opacity-0 backdrop-blur transition-opacity hover:text-ink-1 group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </article>
  );

  return banner.href ? (
    <Link href={banner.href} target={banner.href.startsWith('http') ? '_blank' : undefined}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ────────── Carousel ──────────

function BannerCarousel({ banners }: { banners: PublicBanner[] }) {
  const [idx, setIdx] = useState(0);
  // Auto-advance every 6s. Reset the timer whenever the user manually
  // navigates, otherwise their click is undone by an immediate auto-tick.
  useEffect(() => {
    if (banners.length < 2) return;
    const t = setTimeout(() => setIdx((i) => (i + 1) % banners.length), 6_000);
    return () => clearTimeout(t);
  }, [idx, banners.length]);

  const cur = banners[idx];
  if (!cur) return null;

  return (
    <div className="relative">
      <BannerCard banner={cur} />
      {banners.length > 1 ? (
        <>
          <button
            type="button"
            onClick={() => setIdx((i) => (i - 1 + banners.length) % banners.length)}
            aria-label="Previous"
            className="absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-ink-2 shadow backdrop-blur hover:text-ink-1"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setIdx((i) => (i + 1) % banners.length)}
            aria-label="Next"
            className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-ink-2 shadow backdrop-blur hover:text-ink-1"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1">
            {banners.map((b, i) => (
              <span
                key={b.id}
                className={cn(
                  'h-1.5 rounded-full bg-white/70 backdrop-blur transition-all',
                  i === idx ? 'w-5 bg-brand-600' : 'w-1.5',
                )}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ────────── Dismiss persistence ──────────

const DISMISS_KEY = 'tripbng:dismissed-banners';

function useDismissedBannerIds(): Record<string, string> {
  const [_, force] = useState(0);
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === DISMISS_KEY) force((n) => n + 1);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  try {
    return JSON.parse(window.localStorage.getItem(DISMISS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function isDismissed(
  banner: PublicBanner,
  today: string,
  dismissed: Record<string, string>,
): boolean {
  const stamp = dismissed[banner.id];
  switch (banner.frequency) {
    case 'ALWAYS':
      return false;
    case 'ONCE':
      return Boolean(stamp);
    case 'PER_DAY':
      return stamp === today;
    case 'PER_SESSION':
      // Session-scoped — separate sessionStorage flag so it doesn't
      // pollute the long-lived localStorage map.
      try {
        return Boolean(window.sessionStorage.getItem(`${DISMISS_KEY}:${banner.id}`));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function dismissBanner(banner: PublicBanner): void {
  const today = new Date().toISOString().slice(0, 10);
  if (banner.frequency === 'PER_SESSION') {
    try {
      window.sessionStorage.setItem(`${DISMISS_KEY}:${banner.id}`, today);
    } catch {
      /* ignore */
    }
    return;
  }
  if (banner.frequency === 'ALWAYS') return;
  try {
    const cur = JSON.parse(window.localStorage.getItem(DISMISS_KEY) ?? '{}') as Record<
      string,
      string
    >;
    cur[banner.id] = today;
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(cur));
  } catch {
    /* ignore */
  }
}
