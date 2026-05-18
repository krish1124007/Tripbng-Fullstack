'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bell,
  Building2,
  ExternalLink,
  IndianRupee,
  Plane,
  Sprout,
  TrendingUp,
  Wallet as WalletIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { DistributorDashboardSummary, DormantAgency, NudgeRequest } from '@tripbng/shared';
import { BannerViewer } from '@/components/banner-viewer';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  KeyValue,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import { KpiCard } from '@/components/kpi-card';
import { useApiMutation, useApiQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { formatPaiseAsINR } from '@/lib/money';
import { BookingsTrendChart, EarningsTrendChart, TopNBarChart } from '@/components/charts';

export function DistributorCockpit({ distributorId }: { distributorId: string }) {
  const summary = useApiQuery<DistributorDashboardSummary>(
    ['distributor', distributorId, 'dashboard'],
    `/api/v1/distributors/${distributorId}/dashboard`,
  );
  const dormant = useApiQuery<DormantAgency[]>(
    ['distributor', distributorId, 'dormant'],
    `/api/v1/distributors/${distributorId}/dormant-agencies`,
  );

  if (summary.isLoading) return <CockpitSkeleton />;
  const s = summary.data;
  if (!s) return null;

  const delta =
    s.lastMonth.earningsPaise > 0
      ? (s.thisMonth.earningsPaise - s.lastMonth.earningsPaise) / s.lastMonth.earningsPaise
      : null;

  const earningsSpark = s.trend.map((t) => t.earningsPaise);
  const bookingsSpark = s.trend.map((t) => t.bookingCount);

  return (
    <div className="space-y-8">
      {/* Marketing banners targeted at this distributor (ALL or
          DISTRIBUTOR_DOWNLINE). Sits at the top so it's the first
          thing seen on log-in. */}
      <BannerViewer location="AGENCY_DASHBOARD" />

      <PageHeader
        eyebrow="Cockpit · Distributor"
        title={`Welcome back, ${s.distributorName}`}
        description={`${s.distributorCode} · override commission ${s.overrideCommissionPercent.toFixed(2)}%`}
        actions={
          <Button asChild>
            <Link href={`/distributors/${distributorId}/earnings`}>
              <ExternalLink className="h-4 w-4" /> Earnings report
            </Link>
          </Button>
        }
      />

      {/* Hero — KPI strip */}
      <section className="grid gap-4 md:grid-cols-4">
        <KpiCard
          tone="brand"
          label="Earnings · this month"
          value={formatPaiseAsINR(s.thisMonth.earningsPaise, { compact: true })}
          icon={IndianRupee}
          delta={delta}
          deltaLabel="vs last month"
          hint={`${s.thisMonth.bookingCount} bookings · ${s.thisMonth.activeAgencies} active agencies`}
          spark={earningsSpark}
        />
        <KpiCard
          label="Bookings · 30d"
          value={s.thisMonth.bookingCount}
          icon={Plane}
          spark={bookingsSpark}
        />
        <KpiCard
          tone="accent"
          label="Wallet"
          value={formatPaiseAsINR(s.walletBalancePaise, { compact: true })}
          icon={WalletIcon}
          hint="Net commission balance"
          href="/wallet"
        />
        <KpiCard
          label="Agencies"
          value={s.agencies.total}
          icon={Building2}
          hint={`${s.agencies.active} active · ${s.agencies.dormant} dormant`}
          href="/agencies"
        />
      </section>

      {/* Earnings trend (hero chart) + Lifetime stats */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Earnings trend</CardTitle>
                <CardDescription>30-day rolling, all agencies</CardDescription>
              </div>
              <Badge variant="brand" dot>
                <TrendingUp className="h-3 w-3" />
                Live
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <EarningsTrendChart data={s.trend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lifetime</CardTitle>
            <CardDescription>Since onboarding</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <KeyValue
              label="Earnings"
              value={formatPaiseAsINR(s.lifetime.earningsPaise, { compact: true })}
              mono
            />
            <KeyValue
              label="Gross GMV"
              value={formatPaiseAsINR(s.lifetime.grossGmvPaise, { compact: true })}
              mono
            />
            <KeyValue
              label="Override"
              value={`${s.overrideCommissionPercent.toFixed(2)}%`}
            />
          </CardContent>
        </Card>
      </section>

      {/* Top agencies + Dormant */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top agencies this month</CardTitle>
            <CardDescription>By distributor earnings.</CardDescription>
          </CardHeader>
          <CardContent>
            {s.topAgencies.length === 0 ? (
              <EmptyState
                icon={Sprout}
                title="No earnings yet this month"
                description="Once your agencies start ticketing, the leaderboard will fill in."
              />
            ) : (
              <TopNBarChart
                valueLabel="Earnings"
                data={s.topAgencies.map((a) => ({
                  label: `${a.companyName.slice(0, 22)} · ${a.bookingCount}`,
                  value: a.earningsPaise,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <Card tone={(dormant.data ?? []).length > 0 ? 'warning' : 'default'}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" /> Dormant agencies
            </CardTitle>
            <CardDescription>
              No bookings in the past 30 days. Send a re-engagement nudge.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dormant.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : (dormant.data ?? []).length === 0 ? (
              <EmptyState
                icon={Sprout}
                title="Everyone's active"
                description="No agencies have gone dormant in the past 30 days."
              />
            ) : (
              <ul className="space-y-2">
                {(dormant.data ?? []).slice(0, 6).map((a) => (
                  <DormantRow key={a.agencyId} agency={a} distributorId={distributorId} />
                ))}
                {(dormant.data ?? []).length > 6 ? (
                  <li className="text-xs text-ink-3">
                    + {(dormant.data ?? []).length - 6} more — see report
                  </li>
                ) : null}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Bookings trend, narrow */}
      <Card>
        <CardHeader>
          <CardTitle>30-day bookings volume</CardTitle>
          <CardDescription>Daily count.</CardDescription>
        </CardHeader>
        <CardContent>
          <BookingsTrendChart data={s.trend} />
        </CardContent>
      </Card>
    </div>
  );
}

function DormantRow({
  agency,
  distributorId,
}: {
  agency: DormantAgency;
  distributorId: string;
}) {
  const [open, setOpen] = useState(false);
  const invalidate = useInvalidateOnSuccess([['distributor', distributorId, 'dormant']]);

  const nudge = useApiMutation<NudgeRequest, { ok: true; deliveryNote: string }>(
    `/api/v1/distributors/${distributorId}/nudge`,
    'POST',
    {
      onSuccess: (data) => {
        toast.success(`Nudge queued for ${agency.companyName}`, { description: data.deliveryNote });
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const last = agency.lastBookingAt
    ? `${agency.daysSinceLastBooking}d ago`
    : 'Never booked';

  return (
    <li className="group flex items-center gap-3 rounded-md border bg-surface-1 p-3 transition-colors hover:bg-surface-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-warning-soft text-warning">
        <Building2 className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink-1">{agency.companyName}</p>
        <p className="font-mono text-[10px] text-ink-3">
          {agency.agencyCode} · {agency.city} · {last} · {formatPaiseAsINR(agency.walletBalancePaise, { compact: true })} wallet
        </p>
      </div>
      <Button size="sm" variant="soft" onClick={() => setOpen(true)}>
        <Bell className="h-3.5 w-3.5" /> Nudge
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Nudge ${agency.companyName}?`}
        description="Records a re-engagement event for this agency. Email/SMS delivery is wired in Phase 6."
        confirmLabel="Send nudge"
        onConfirm={async () => {
          await nudge.mutateAsync({ agencyId: agency.agencyId, channel: 'IN_APP' });
        }}
      />
    </li>
  );
}

function CockpitSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
