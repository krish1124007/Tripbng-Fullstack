'use client';

import Link from 'next/link';
import {
  Activity,
  Building2,
  ClipboardList,
  IndianRupee,
  Network,
  Plane,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import type { PublicAgency, PublicBooking, PublicDistributor } from '@tripbng/shared';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatusBadge,
} from '@/components/ui';
import { KpiCard } from '@/components/kpi-card';
import { useApiPaginatedQuery } from '@/lib/api-client';
import { formatPaiseAsINR } from '@/lib/money';

export function AdminDashboard() {
  const agencies = useApiPaginatedQuery<PublicAgency>(
    ['admin-dashboard', 'agencies'],
    '/api/v1/agencies',
    { query: { limit: 1 } },
  );
  const distributors = useApiPaginatedQuery<PublicDistributor>(
    ['admin-dashboard', 'distributors'],
    '/api/v1/distributors',
    { query: { limit: 1 } },
  );
  const bookings = useApiPaginatedQuery<PublicBooking>(
    ['admin-dashboard', 'bookings'],
    '/api/v1/bookings',
    { query: { limit: 8 } },
  );

  const totalGmv = (bookings.data?.data ?? []).reduce(
    (s, b) => s + (b.pricing?.grossAmountPaise ?? 0),
    0,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Platform · Super-admin"
        title="Operations overview"
        description="Channel health and recent activity at a glance."
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/audit-logs">
                <ShieldCheck className="h-4 w-4" /> Audit log
              </Link>
            </Button>
            <Button asChild>
              <Link href="/reports">
                <TrendingUp className="h-4 w-4" /> Run reports
              </Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-4">
        <KpiCard
          tone="brand"
          label="Distributors"
          value={distributors.data?.meta.total ?? 0}
          icon={Network}
          hint="Active channel partners"
          href="/distributors"
        />
        <KpiCard
          label="Agencies"
          value={agencies.data?.meta.total ?? 0}
          icon={Building2}
          hint="Onboarded · all states"
          href="/agencies"
        />
        <KpiCard
          label="Recent bookings"
          value={bookings.data?.meta.total ?? 0}
          icon={Plane}
          hint="All-time count"
          href="/bookings"
        />
        <KpiCard
          tone="accent"
          label="Recent GMV (sample)"
          value={formatPaiseAsINR(totalGmv, { compact: true })}
          icon={IndianRupee}
          hint="Sum of last 8 bookings"
          href="/reports"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>Latest bookings</CardTitle>
              <CardDescription>Most recent across the platform.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/bookings">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {(bookings.data?.data ?? []).length === 0 ? (
              <EmptyState
                icon={Plane}
                title="No bookings yet"
                description="Once agencies start ticketing, you'll see them here in real-time."
              />
            ) : (
              <ul className="divide-y">
                {(bookings.data?.data ?? []).map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/bookings/${b.id}`}
                      className="group flex items-center gap-4 rounded-md px-2 py-3 -mx-2 transition-colors hover:bg-surface-2"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-3 transition-colors group-hover:bg-brand-50 group-hover:text-brand-600">
                        <Plane className="h-4 w-4" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-ink-1">
                            {b.bookingCode}
                          </span>
                          <span className="text-sm font-semibold text-ink-1">{b.sector}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-ink-3">
                          {b.agencyName} ·{' '}
                          {new Date(b.travelDate).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
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

        {/* System health card — placeholder for now, will wire to /metrics in Phase 3 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-success" />
              Platform health
            </CardTitle>
            <CardDescription>All systems operational.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <HealthRow label="API" status="green" detail="p95 < 200ms" />
            <HealthRow label="Database" status="green" detail="Mongo Atlas" />
            <HealthRow label="Redis" status="green" detail="Workers active" />
            <HealthRow label="Suppliers" status="amber" detail="1 of 3 degraded" />
            <Button variant="soft" size="sm" className="mt-2 w-full" asChild>
              <Link href="/audit-logs">
                <ClipboardList className="h-3.5 w-3.5" /> Open audit log
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HealthRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: 'green' | 'amber' | 'red';
  detail: string;
}) {
  const dotColor =
    status === 'green' ? 'bg-success' : status === 'amber' ? 'bg-warning' : 'bg-danger';
  return (
    <div className="flex items-center gap-3 rounded-md border bg-surface-1 px-3 py-2 text-sm">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
      <span className="flex-1 font-semibold text-ink-1">{label}</span>
      <span className="font-mono text-[11px] text-ink-3">{detail}</span>
    </div>
  );
}
