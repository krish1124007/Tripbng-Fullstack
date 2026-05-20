'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  ChevronRight,
  Home,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
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

/**
 * WalletPill (topbar variant) — always-visible balance for agency/distributor.
 * Tints amber when balance falls below 20% of credit limit.
 */
function WalletPillTopbar() {
  const user = useAuthStore((s) => s.user);
  const wallet = useApiQuery<WalletSummary>(['wallet', 'me', 'topbar'], '/api/v1/wallet/me', {
    staleTime: 30_000,
    enabled: user?.role === 'AGENCY' || user?.role === 'SUB_AGENT' || user?.role === 'DISTRIBUTOR',
  });

  if (user?.role !== 'AGENCY' && user?.role !== 'SUB_AGENT' && user?.role !== 'DISTRIBUTOR') {
    return null;
  }

  const balance = wallet.data?.walletBalancePaise ?? 0;
  const limit = wallet.data?.creditLimitPaise ?? 0;
  const isLow = limit > 0 && balance < limit * 0.2;

  return (
    <Link
      href="/wallet"
      aria-label="Wallet"
      className={cn(
        'group hidden h-9 items-center gap-2 rounded-full border bg-surface-1 px-3 text-xs font-semibold transition-all duration-fast hover:border-brand-300 hover:text-brand-700 sm:flex',
        isLow && 'border-warning/40 bg-warning-soft text-warning',
      )}
    >
      <WalletIcon className="h-3.5 w-3.5" strokeWidth={2} />
      <span className="font-mono tabular-nums">
        {wallet.isLoading ? '—' : formatPaiseAsINR(balance, { compact: true })}
      </span>
      {isLow ? (
        <span className="rounded-full bg-warning/20 px-1.5 text-[9px] font-bold uppercase tracking-wider text-warning">
          Low
        </span>
      ) : null}
    </Link>
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

      <WalletPillTopbar />
      <CommandPalette />
      <MarkupCalculatorButton />
      <CartButton />
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
        <DropdownMenuContent align="end" className="w-64">
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
    </header>
  );
}
