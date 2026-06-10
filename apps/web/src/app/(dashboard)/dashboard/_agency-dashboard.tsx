'use client';

import Link from 'next/link';
import {
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileText,
  Plane,
  PlaneTakeoff,
  Receipt,
  ShieldCheck,
  Sparkles,
  Sprout,
  TrendingUp,
  Users,
  Wallet as WalletIcon,
} from 'lucide-react';
import type { PublicBooking, PublicUpdate, WalletSummary } from '@tripbng/shared';
import { UPDATE_ICON_MAP, relativeTime } from '@/lib/update-icons';
import { BannerViewer } from '@/components/banner-viewer';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '@/components/ui';
import { KpiCard } from '@/components/kpi-card';
import { WelcomeBanner } from '@/components/welcome-banner';
import { useApiPaginatedQuery, useApiQuery } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';

export function AgencyDashboard() {
  const user = useAuthStore((s) => s.user)!;
  const wallet = useApiQuery<WalletSummary>(['wallet', 'me', 'dashboard'], '/api/v1/wallet/me');
  const recent = useApiPaginatedQuery<PublicBooking>(
    ['bookings', 'recent'],
    '/api/v1/bookings',
    { query: { limit: 6 } },
  );

  const firstName = user.fullName.split(' ')[0] ?? user.fullName;
  const utilisationPct =
    wallet.data && wallet.data.creditLimitPaise > 0
      ? Math.min(100, (wallet.data.outstandingPaise / wallet.data.creditLimitPaise) * 100)
      : null;

  return (
    <div className="space-y-8">
      {/* Marketing banners — image-first promo cards uploaded from the
          admin /banners page. Filtered server-side to whatever this
          agency is targeted by (ALL or AGENCY_GROUP), dismissable per
          the configured frequency. Shows nothing when no banners
          match, so the layout stays clean by default. */}
      <BannerViewer location="AGENCY_DASHBOARD" />

      <WelcomeBanner
        walletBalancePaise={wallet.data?.walletBalancePaise ?? 0}
        bookingsCount={recent.data?.meta.total ?? 0}
        firstName={firstName}
      />

      <PageHeader
        eyebrow={`${user.role} · ${user.userCode}`}
        title={`Hello, ${firstName} 👋`}
        description="Search flights, hotels, buses, holidays — all in one place. Manage your wallet, holds, and tickets without switching screens."
        actions={
          <>
            <Button variant="secondary" size="md" asChild>
              <Link href="/topups">
                <ArrowDownToLine className="h-4 w-4" /> Top up
              </Link>
            </Button>
            <Button size="md" asChild>
              <Link href="/flights">
                <PlaneTakeoff className="h-4 w-4" /> Search flights
              </Link>
            </Button>
          </>
        }
      />

      {/* Hero row: promo banner (2/3) + recent updates feed (1/3) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <PromoBanner />
        <UpdatesFeed />
      </section>

      {/* KPI hero strip */}
      <section className="grid gap-4 md:grid-cols-3">
        <KpiCard
          tone="brand"
          label="Wallet balance"
          value={wallet.isLoading ? '—' : formatPaiseAsINR(wallet.data?.walletBalancePaise ?? 0)}
          icon={WalletIcon}
          hint={
            wallet.data?.creditLimitPaise && wallet.data.creditLimitPaise > 0 ? (
              <>
                Credit limit:{' '}
                <span className="font-mono">
                  {formatPaiseAsINR(wallet.data.creditLimitPaise, { compact: true })}
                </span>
              </>
            ) : (
              'No credit line set'
            )
          }
          href="/wallet"
        />

        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-start justify-between">
              <p className="eyebrow flex items-center gap-1.5 text-ink-3">
                <CreditCard className="h-3 w-3" /> Outstanding credit
              </p>
              <span className="grid h-8 w-8 place-items-center rounded-md bg-warning-soft text-warning">
                <CreditCard className="h-4 w-4" strokeWidth={1.75} />
              </span>
            </div>
            <p className="text-xl font-bold leading-none tabular-nums text-ink-1 sm:text-[28px]">
              {wallet.isLoading ? '—' : formatPaiseAsINR(wallet.data?.outstandingPaise ?? 0)}
            </p>
            {utilisationPct != null ? (
              <div className="space-y-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={
                      utilisationPct > 80
                        ? 'h-full rounded-full bg-danger transition-all duration-slow'
                        : utilisationPct > 60
                          ? 'h-full rounded-full bg-warning transition-all duration-slow'
                          : 'h-full rounded-full bg-brand-500 transition-all duration-slow'
                    }
                    style={{ width: `${utilisationPct}%` }}
                  />
                </div>
                <p className="font-mono text-[10px] text-ink-3">
                  {utilisationPct.toFixed(0)}% utilised ·{' '}
                  {formatPaiseAsINR(
                    wallet.data!.creditLimitPaise - wallet.data!.outstandingPaise,
                    { compact: true },
                  )}{' '}
                  available
                </p>
              </div>
            ) : (
              <p className="text-xs text-ink-4">No credit line configured.</p>
            )}
          </CardContent>
        </Card>

        <KpiCard
          label="Recent bookings"
          value={recent.data?.meta.total ?? 0}
          icon={Receipt}
          hint="Across all statuses"
          href="/bookings"
        />
      </section>

      {/* Operational shortcuts grid — 6 quick links to common admin tasks */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="eyebrow text-brand-600">Shortcuts</p>
            <h2 className="mt-1 text-h3 text-ink-1">Quick links your team uses every day</h2>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Shortcut href="/bookings" icon={ClipboardList} label="My bookings" />
          <Shortcut href="/wallet" icon={WalletIcon} label="Ledger" />
          <Shortcut href="/bookings" icon={FileText} label="Invoices" />
          <Shortcut href="/reports" icon={TrendingUp} label="Reports" />
          <Shortcut href="/inventories/calendar" icon={CalendarDays} label="Pax calendar" />
          <Shortcut href="/users" icon={Users} label="Sub-agents" />
        </div>
      </section>

      {/* Quick-action panels — 3 prominent CTAs with brand-loud primary */}
      <section className="rounded-xl border bg-gradient-to-br from-surface-1 to-surface-2 p-1">
        <div className="grid gap-px overflow-hidden rounded-[10px] sm:grid-cols-3">
          <QuickAction
            href="/flights"
            icon={PlaneTakeoff}
            title="Search & book flights"
            desc="Compare fares across airlines and suppliers, all on a single screen."
            primary
          />
          <QuickAction
            href="/topups"
            icon={ArrowDownToLine}
            title="Add money"
            desc="Bank transfer or NEFT — upload your payment proof, we'll credit in minutes."
          />
          <QuickAction
            href="/amendments"
            icon={Sparkles}
            title="Amendments"
            desc="Refunds, name corrections, date changes. Track status."
          />
        </div>
      </section>

      {/* Recent bookings */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle>Recent bookings</CardTitle>
            <CardDescription>Last 6 across all statuses.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/bookings">
              View all <TrendingUp className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recent.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (recent.data?.data ?? []).length === 0 ? (
            <EmptyState
              icon={Plane}
              title="No bookings yet"
              description="Pick a route on the flights page to issue your first ticket. Holds expire after 30 minutes — confirm fast to lock the fare."
              action={
                <Button asChild>
                  <Link href="/flights">
                    <PlaneTakeoff className="h-4 w-4" /> Search flights
                  </Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              {(recent.data?.data ?? []).map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/bookings/${b.id}`}
                    className="group -mx-2 flex items-center gap-4 rounded-md px-2 py-3 transition-colors hover:bg-surface-2"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100">
                      <Plane className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-ink-1">
                          {b.bookingCode}
                        </span>
                        <span className="text-sm font-semibold text-ink-1">{b.sector}</span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-ink-3">
                        {new Date(b.travelDate).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                    <span className="font-mono text-sm font-semibold tabular-nums text-ink-1">
                      {formatPaiseAsINR(b.pricing.agencyPayablePaise, { compact: true })}
                    </span>
                    <StatusBadge status={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ────────── Sub-components ──────────

function PromoBanner() {
  // Curated Unsplash hero — Vietnam, Halong Bay limestone karsts at golden
  // hour. Hotlinkable per Unsplash's licence; ?w + ?q params keep the
  // payload tight (~120 KB) so the banner doesn't blow the dashboard
  // first-paint budget.
  const HERO_IMAGE =
    'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=1600&q=80';

  return (
    <Link
      href="/holidays"
      className="group relative col-span-1 flex h-full min-h-[280px] overflow-hidden rounded-xl border border-ink-1/10 shadow-sm transition-all duration-fast hover:-translate-y-0.5 hover:shadow-lg lg:col-span-2"
    >
      {/* Hero image — `<img>` with object-cover so it scales to the
          banner's responsive height. Decorative, marked aria-hidden. */}
      <img
        aria-hidden
        src={HERO_IMAGE}
        alt=""
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-slow group-hover:scale-105"
        loading="lazy"
      />

      {/* Editorial overlay — deep brand-deep wash on the left fading to
          a soft veil on the right so the hero stays visible. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-[#0B1220]/95 via-[#0B1220]/75 to-[#0B1220]/20"
      />
      {/* Subtle top-right accent kiss for warmth. */}
      <div
        aria-hidden
        className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-accent-500/30 blur-3xl"
      />
      {/* Faint accent hairline at the bottom edge — print/poster cue. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-accent-500/60" />

      {/* Content sits above the overlay. */}
      <div className="relative z-10 flex flex-1 flex-col justify-between p-6 lg:p-8">
        {/* Top row: featured badge + Q3 calendar marker on the right. */}
        <div className="flex items-start justify-between gap-4">
          <Badge
            variant="accent"
            dot
            pulse
            className="border-accent-300/40 bg-accent-500/20 text-white backdrop-blur"
          >
            <Sparkles className="h-3 w-3" /> Featured series
          </Badge>
          <div className="hidden flex-col items-end gap-0.5 md:flex">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/80">
              7 nights available
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
              Q3 · 2026
            </span>
          </div>
        </div>

        {/* Headline block, anchored to the bottom of the card. */}
        <div className="mt-6 space-y-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-accent-300">
            Danang · Ho Chi Minh
          </p>
          <h3 className="text-2xl font-bold leading-tight tracking-tight text-white drop-shadow-sm lg:text-4xl">
            Vietnam · Cultural & scenic escape
          </h3>
          <p className="max-w-md text-xs text-white/80 lg:text-sm">
            5 nights · Hotels · Daily breakfast · Sightseeing · Private transfers · English guide
          </p>

          {/* Glass cards row — price + group chip + CTA. */}
          <div className="flex flex-wrap items-end gap-3 pt-3">
            <div className="rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 backdrop-blur-md">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/70">
                Starting from
              </p>
              <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums leading-none text-white">
                ₹24,999
                <span className="ml-1 text-[10px] font-normal text-white/70">/pax</span>
              </p>
            </div>
            <div className="flex h-10 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-xs text-white backdrop-blur-md">
              <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
              Group of 6+ travelling together
            </div>

            {/* Solid CTA pill — the only opaque element below the headline,
                guiding the eye to the click target. */}
            <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-accent-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-all duration-fast group-hover:translate-x-0.5 group-hover:bg-accent-600 group-hover:shadow-xl">
              View itinerary
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function UpdatesFeed() {
  const list = useApiPaginatedQuery<PublicUpdate>(
    ['updates', 'dashboard'],
    '/api/v1/updates',
    { query: { page: 1, limit: 6 } },
  );
  const updates = list.data?.data ?? [];

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>What's new</CardTitle>
          <CardDescription>Operational updates from the trade desk.</CardDescription>
        </div>
        <Badge variant="brand" dot pulse>
          <Sprout className="h-3 w-3" /> Live
        </Badge>
      </CardHeader>
      <CardContent className="flex-1">
        {list.isLoading ? (
          <ul className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="rounded-md border bg-surface-1 p-3">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="mt-2 h-3 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </li>
            ))}
          </ul>
        ) : updates.length === 0 ? (
          <p className="rounded-md border border-dashed bg-surface-1 p-6 text-center text-xs text-ink-3">
            No updates yet — the trade desk hasn't posted anything.
          </p>
        ) : (
          <ul className="space-y-3">
            {updates.map((u) => {
              const Icon = UPDATE_ICON_MAP[u.icon] ?? Sparkles;
              const row = (
                <li
                  key={u.id}
                  className="flex items-start gap-3 rounded-md border bg-surface-1 p-3 transition-colors hover:bg-surface-2"
                >
                  <span
                    className={cn(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-md',
                      u.tone === 'accent'
                        ? 'bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-400'
                        : u.tone === 'brand'
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                          : 'bg-surface-2 text-ink-3',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={u.tone} className="text-[9px]">
                        {u.tag}
                      </Badge>
                      <p className="text-sm font-semibold text-ink-1">{u.title}</p>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-ink-3">{u.body}</p>
                    <p className="mt-1.5 font-mono text-[10px] text-ink-4">
                      {relativeTime(u.publishedAt)}
                    </p>
                  </div>
                </li>
              );
              return u.href ? (
                <Link
                  key={u.id}
                  href={u.href}
                  target={u.href.startsWith('http') ? '_blank' : undefined}
                  rel={u.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="block"
                >
                  {row}
                </Link>
              ) : (
                row
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Shortcut({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof Plane;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col items-center gap-2 rounded-xl border bg-surface-1 p-4 text-center transition-all duration-fast hover:-translate-y-px hover:border-brand-300 hover:shadow-md"
    >
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <span className="text-xs font-semibold text-ink-1">{label}</span>
    </Link>
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  desc,
  primary,
}: {
  href: string;
  icon: typeof PlaneTakeoff;
  title: string;
  desc: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? 'group relative bg-gradient-to-br from-brand-600 to-brand-700 p-6 transition-shadow hover:shadow-lg'
          : 'group relative bg-surface-1 p-6 transition-colors hover:bg-surface-2'
      }
    >
      <span
        className={
          primary
            ? 'grid h-10 w-10 place-items-center rounded-lg bg-white/15 text-accent-300 ring-1 ring-white/15 backdrop-blur'
            : 'grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600'
        }
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <h3
        className={
          primary ? 'mt-4 text-lg font-bold text-white' : 'mt-4 text-lg font-bold text-ink-1'
        }
      >
        {title}
      </h3>
      <p className={primary ? 'mt-1 text-sm text-white/70' : 'mt-1 text-sm text-ink-3'}>{desc}</p>
      {primary ? (
        <ShieldCheck
          aria-hidden
          className="absolute right-6 top-6 h-4 w-4 text-white/30"
          strokeWidth={1.5}
        />
      ) : null}
    </Link>
  );
}
