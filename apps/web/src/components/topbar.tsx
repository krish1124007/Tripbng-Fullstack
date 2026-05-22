'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Eye,
  EyeOff,
  Home,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  TrendingUp,
  User as UserIcon,
  Wallet as WalletIcon,
} from 'lucide-react';
import type { WalletSummary } from '@tripbng/shared';
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  initialsFromName,
} from '@/components/ui';
import { CommandPalette } from '@/components/command-palette';
import { NotificationsBell } from '@/components/notifications-bell';
import { CartButton } from '@/components/cart-drawer';
import { MarkupCalculatorButton } from '@/components/markup-calculator';
import { Logo } from '@/components/logo';
import { useAuthStore } from '@/lib/auth-store';
import { useApiQuery } from '@/lib/api-client';
import { apiFetch } from '@/lib/api';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';

const NAV_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  search: 'Search',
  flights: 'Flights',
  hotels: 'Hotels',
  buses: 'Bus',
  holidays: 'Holiday',
  visa: 'Visa',
  insurance: 'Insurance',
  book: 'Book',
  bookings: 'Bookings',
  amendments: 'Amendments',
  wallet: 'Wallet',
  topups: 'Top-ups',
  reports: 'Reports',
  'audit-logs': 'Audit log',
  inventories: 'Inventory',
  calendar: 'Calendar',
  suppliers: 'Suppliers',
  'markup-rules': 'Markup rules',
  'fare-rules': 'Fare rules',
  policies: 'Policies',
  distributors: 'Distributors',
  agencies: 'Agencies',
  'agency-groups': 'Agency groups',
  users: 'Users',
  banners: 'Banners',
  incentives: 'Incentives',
  settings: 'Settings',
  earnings: 'Earnings',
};

// Routes where we drop breadcrumbs — product pages get a clean canvas.
const CANVAS_PREFIXES = ['/flights', '/hotels', '/bus', '/holidays', '/visa', '/insurance', '/search', '/book'];

function Breadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1 text-sm font-medium text-ink-3"
    >
      <Link
        href="/dashboard"
        aria-label="Dashboard"
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-brand-600"
      >
        <Home className="h-3.5 w-3.5" strokeWidth={2} />
      </Link>
      {parts.map((segment, i) => {
        const href = '/' + parts.slice(0, i + 1).join('/');
        const isLast = i === parts.length - 1;
        const isId = /^[a-f0-9]{16,}$/i.test(segment) || /^\d{6,}$/.test(segment);
        const label = isId ? '#' + segment.slice(0, 6) : (NAV_LABELS[segment] ?? segment);
        return (
          <span key={href} className="flex min-w-0 items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-5" strokeWidth={1.75} />
            {isLast ? (
              <span className="truncate text-ink-1">{label}</span>
            ) : (
              <Link
                href={href}
                className="rounded px-1.5 py-0.5 transition-colors hover:bg-surface-2 hover:text-ink-1"
              >
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** Mask used everywhere when the user has hidden their balance.
 *  Six middots — long enough to read as "masked", short enough to
 *  preserve the pill's width. */
const MASK = '••••••';

const HIDE_BALANCE_STORAGE_KEY = 'tripbng:hide-balance';

/**
 * Persist + restore the "hide balance" preference. localStorage so the
 * agent's choice survives a hard reload; SSR-safe because we read it
 * inside `useEffect`. Mirrors the sidebar-collapsed pattern.
 */
function useHideBalance(): { hidden: boolean; toggle: () => void } {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(HIDE_BALANCE_STORAGE_KEY);
    if (stored === '1') setHidden(true);
  }, []);

  const toggle = useCallback(() => {
    setHidden((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(HIDE_BALANCE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Storage may be unavailable in private-mode Safari. Pref still
        // works for the current session; we just can't persist it.
      }
      return next;
    });
  }, []);

  return { hidden, toggle };
}

/**
 * WalletPill (topbar variant) — always-visible balance for agency /
 * distributor. Tints amber when balance falls below 20% of credit
 * limit. Clicking the amount opens a popover with the full balance
 * breakdown (My Wallet, Available Credit, Credit Limit, Outstanding
 * Due) and a few derived insights (Total spend power, Utilisation bar).
 *
 * The eye icon next to the amount toggles a "hide balance" mask. When
 * hidden, the pill + every value inside the popover render as
 * `••••••` so a shoulder-surfer can't read the numbers by clicking
 * through.
 */
function WalletPillTopbar() {
  const user = useAuthStore((s) => s.user);
  const wallet = useApiQuery<WalletSummary>(['wallet', 'me', 'topbar'], '/api/v1/wallet/me', {
    staleTime: 30_000,
    enabled: user?.role === 'AGENCY' || user?.role === 'SUB_AGENT' || user?.role === 'DISTRIBUTOR',
  });
  const { hidden, toggle: toggleHidden } = useHideBalance();

  if (user?.role !== 'AGENCY' && user?.role !== 'SUB_AGENT' && user?.role !== 'DISTRIBUTOR') {
    return null;
  }

  const sum = wallet.data;
  const balance = sum?.walletBalancePaise ?? 0;
  const limit = sum?.creditLimitPaise ?? 0;
  const outstanding = sum?.outstandingPaise ?? 0;
  // Headroom on the credit line — what they can still draw.
  const availableCredit = Math.max(0, limit - outstanding);
  // Total they can spend right now = cash + available credit.
  const spendPower = balance + availableCredit;
  // Utilisation % — proportion of credit limit consumed.
  const utilisation = limit > 0 ? Math.min(100, (outstanding / limit) * 100) : 0;
  // Low-cash flag — surfaces a warning chip on the pill.
  const isLow = limit > 0 && balance < limit * 0.2;

  /** Format paise unless the user has hidden their balance — in which
   *  case render the mask instead. The loading branch always wins so we
   *  don't flash `••••••` for a moment before real data lands. */
  const fmt = (paise: number): string => {
    if (wallet.isLoading) return '—';
    if (hidden) return MASK;
    return formatPaiseAsINR(paise, { compact: true });
  };

  return (
    <Popover>
      {/*
        The pill is visually one piece, but functionally TWO independent
        interactive regions. Putting an eye-button *inside* the
        PopoverTrigger button would create nested <button>s (invalid
        HTML, accessibility warnings, and the inner click would still
        bubble up to toggle the popover). Instead, the pill is a styled
        wrapper div; the popover trigger holds the amount + chevron,
        and the eye-toggle sits next to it as a sibling.
      */}
      <div
        className={cn(
          // Wrapper styled like the old pill: rounded-full border + flex.
          // The hover ring + open-state tint live on the inner trigger
          // button so they react to the popover state via data-[state].
          // Now visible on mobile too — the calculator + cart get hidden
          // (see topbar layout) so the pill fits in the right rail at 375px.
          'flex h-9 items-center rounded-full border bg-surface-1 pl-3 pr-1 text-xs font-semibold transition-colors duration-fast',
          isLow && 'border-warning/40 bg-warning-soft text-warning',
        )}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Balance info"
            className={cn(
              'group/trigger flex h-7 items-center gap-2 rounded-full pr-1.5 transition-colors hover:text-brand-700',
              'data-[state=open]:text-brand-700 dark:data-[state=open]:text-brand-300',
              isLow && 'hover:text-warning data-[state=open]:text-warning',
            )}
          >
            <WalletIcon className="h-3.5 w-3.5" strokeWidth={2} />
            <span className="font-mono tabular-nums" aria-live="polite">
              {fmt(balance)}
            </span>
            {isLow ? (
              <span className="rounded-full bg-warning/20 px-1.5 text-[9px] font-bold uppercase tracking-wider text-warning">
                Low
              </span>
            ) : null}
            <ChevronDown
              className="h-3 w-3 opacity-60 transition-transform duration-fast group-data-[state=open]/trigger:rotate-180"
              strokeWidth={2}
            />
          </button>
        </PopoverTrigger>

        {/* Visual divider between the popover trigger and the eye toggle. */}
        <span aria-hidden className="mx-1 h-4 w-px bg-strong/60" />

        {/*
          Hide / reveal toggle. Sibling of the PopoverTrigger so a click
          here doesn't propagate up to open the popover. Persisted via
          localStorage in `useHideBalance` above.
        */}
        <button
          type="button"
          onClick={toggleHidden}
          aria-label={hidden ? 'Show wallet balance' : 'Hide wallet balance'}
          aria-pressed={hidden}
          title={hidden ? 'Show balance' : 'Hide balance'}
          className="grid h-7 w-7 place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1"
        >
          {hidden ? (
            <EyeOff className="h-3.5 w-3.5" strokeWidth={2} />
          ) : (
            <Eye className="h-3.5 w-3.5" strokeWidth={2} />
          )}
        </button>
      </div>
      <PopoverContent className="w-80 p-0">
        {/* Header band — brand surface with eyebrow + spend power. */}
        <div className="relative overflow-hidden rounded-t-lg border-b bg-gradient-to-br from-brand-50 to-surface-1 p-4 dark:from-brand-500/10 dark:to-surface-2/40">
          <div
            aria-hidden
            className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand-200/40 blur-2xl dark:bg-brand-500/10"
          />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">
                <TrendingUp className="h-3 w-3" />
                Total spend power
              </p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums leading-none text-ink-1">
                {fmt(spendPower)}
              </p>
              {sum ? (
                <p className="mt-1.5 truncate font-mono text-[10px] text-ink-3">
                  {sum.ownerCode} · {sum.ownerName}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Body — the four canonical balance rows. */}
        <div className="space-y-2 p-4">
          <BalanceRow
            icon={<WalletIcon className="h-3.5 w-3.5" strokeWidth={2} />}
            tone="brand"
            label="My Wallet"
            value={fmt(balance)}
            hint="Cash balance"
            loading={wallet.isLoading}
          />
          <BalanceRow
            icon={<CreditCard className="h-3.5 w-3.5" strokeWidth={2} />}
            tone="success"
            label="Available Credit"
            value={fmt(availableCredit)}
            hint="Headroom you can still draw"
            loading={wallet.isLoading}
          />
          <BalanceRow
            icon={<ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />}
            tone="neutral"
            label="Credit Limit"
            value={fmt(limit)}
            hint="Approved by accounts"
            loading={wallet.isLoading}
          />
          <BalanceRow
            icon={<ArrowRight className="h-3.5 w-3.5 rotate-90" strokeWidth={2} />}
            tone={outstanding > 0 ? 'danger' : 'neutral'}
            label="Outstanding (Due)"
            value={
              // The outstanding row needs a "- " prefix only when there's
              // a real outstanding > 0; when hidden, the mask is the same
              // either way — no leading minus.
              hidden || wallet.isLoading
                ? fmt(outstanding)
                : outstanding > 0
                  ? `- ${formatPaiseAsINR(outstanding, { compact: true })}`
                  : formatPaiseAsINR(0, { compact: true })
            }
            hint={outstanding > 0 ? 'Current invoice exposure' : 'No dues — fully settled'}
            loading={wallet.isLoading}
            valueDanger={outstanding > 0 && !hidden}
          />

          {/* Utilisation bar — only when a credit line is configured. */}
          {limit > 0 ? (
            <div className="mt-3 rounded-md bg-surface-2/60 p-3">
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-ink-3">
                <span>Credit utilised</span>
                <span className="text-ink-1">{Math.round(utilisation)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-1">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-slow',
                    utilisation >= 80
                      ? 'bg-danger'
                      : utilisation >= 50
                        ? 'bg-warning'
                        : 'bg-success',
                  )}
                  style={{ width: `${utilisation}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer — links to top up + full wallet page. */}
        <div className="flex items-center justify-between gap-2 border-t bg-surface-2/40 px-4 py-3">
          <Link
            href="/wallet?action=topup"
            className="font-mono text-[10px] font-bold uppercase tracking-wider text-brand-700 hover:underline dark:text-brand-300"
          >
            + Top up
          </Link>
          <Link
            href="/wallet"
            className="inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3 hover:text-brand-700 dark:hover:text-brand-300"
          >
            View full wallet
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A single row inside the BalanceInfo popover: icon tile, label,
 * value (mono tabular), and a small hint underneath.
 */
function BalanceRow({
  icon,
  tone,
  label,
  value,
  hint,
  loading,
  valueDanger,
}: {
  icon: React.ReactNode;
  tone: 'brand' | 'success' | 'neutral' | 'danger';
  label: string;
  value: string;
  hint: string;
  loading?: boolean;
  valueDanger?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-md',
          tone === 'brand' && 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
          tone === 'success' &&
            'bg-success-soft text-success dark:bg-success/20 dark:text-success',
          tone === 'neutral' && 'bg-surface-2 text-ink-3',
          tone === 'danger' && 'bg-danger-soft text-danger dark:bg-danger/20 dark:text-danger',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-ink-1">{label}</p>
        <p className="text-[10px] text-ink-3">{hint}</p>
      </div>
      <p
        className={cn(
          'font-mono text-sm font-bold tabular-nums',
          valueDanger ? 'text-danger' : 'text-ink-1',
        )}
      >
        {loading ? '—' : value}
      </p>
    </div>
  );
}

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  const isCanvas = CANVAS_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const isOnDashboard = pathname === '/dashboard';

  const onLogout = async () => {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      clear();
      router.replace('/login');
    }
  };

  return (
    <header className="glass sticky top-0 z-30 flex h-16 items-center gap-3 border-b px-4 lg:px-8">
      {/* Left: Logo */}
      <Link
        href="/dashboard"
        aria-label="TripBng — Home"
        className="flex shrink-0 items-center transition-opacity hover:opacity-80"
      >
        <Logo variant="full" className="h-7 w-auto" />
      </Link>

      {/* Center: Breadcrumbs only on operations pages (canvas pages get clean header) */}
      <div className="ml-3 hidden min-w-0 flex-1 lg:block">
        {!isCanvas ? <Breadcrumbs /> : null}
      </div>
      <div className="flex-1 lg:hidden" />

      {/* Right: Dashboard button (when not already on dashboard) + controls */}
      {!isOnDashboard ? (
        <Button
          asChild
          variant="soft"
          size="sm"
          className="hidden md:inline-flex"
        >
          <Link href="/dashboard">
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </Link>
        </Button>
      ) : null}

      {/* Right-rail controls — group with shrink-0 so a wide center
          breadcrumb on narrow tablets can't push the bell / avatar off-screen.
          Internal gap-2 (instead of the header's gap-3) keeps the icons
          packed tight when space is at a premium. */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <WalletPillTopbar />
        <CommandPalette />
        {/* Calculator + cart are secondary — hide on phones so the balance,
            notifications, and user-menu have room at 375px. */}
        <div className="hidden sm:flex sm:items-center sm:gap-3">
          <MarkupCalculatorButton />
          <CartButton />
        </div>
        <NotificationsBell />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="User menu"
            className="rounded-full p-0 hover:bg-transparent"
          >
            <Avatar className="h-9 w-9 ring-2 ring-transparent transition-all hover:ring-brand-200">
              <AvatarFallback className="bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
                {user ? initialsFromName(user.fullName) : '–'}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // Cap to viewport - 1rem so the menu never bleeds off the edge on
          // small phones. The 16rem (w-64) cap kicks in once there's room.
          className="w-[min(16rem,calc(100vw-1rem))]"
        >
          <DropdownMenuLabel>
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
                  {user ? initialsFromName(user.fullName) : '–'}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm font-semibold text-ink-1">
                  {user?.fullName ?? '–'}
                </p>
                <p className="truncate text-xs font-normal normal-case tracking-normal text-ink-3">
                  {user?.email}
                </p>
                <p className="font-mono text-[10px] font-normal normal-case tracking-normal text-ink-4">
                  {user?.userCode} · {user?.role}
                </p>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push('/dashboard')}>
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push('/settings')}>
            <UserIcon className="h-4 w-4" /> Profile & preferences
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push('/settings?tab=security')}>
            <ShieldCheck className="h-4 w-4" /> Security
          </DropdownMenuItem>
          <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={onLogout}>
              <LogOut className="h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
