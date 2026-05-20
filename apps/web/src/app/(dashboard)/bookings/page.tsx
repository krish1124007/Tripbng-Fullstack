'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ArrowRight,
  ChevronsUpDown,
  Download,
  Filter as FilterIcon,
  Bus as BusIcon,
  Hotel as HotelIcon,
  Plane,
  PlaneTakeoff,
  Rows3,
  Search,
  ShieldCheck as InsuranceIcon,
  StickyNote as VisaIcon,
  Table as TableIcon,
} from 'lucide-react';
import type { PublicBooking } from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  Input,
  PageHeader,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
} from '@/components/ui';
import { useApiPaginatedQuery } from '@/lib/api-client';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'HOLD', label: 'On hold' },
  { value: 'TICKETED', label: 'Ticketed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'FAILED', label: 'Failed' },
] as const;

type Density = 'compact' | 'default';

export default function BookingsPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'amount-desc' | 'travel-asc'>('recent');
  const [density, setDensity] = useState<Density>('default');

  const list = useApiPaginatedQuery<PublicBooking>(
    ['bookings', { page, q, status, sortBy }],
    '/api/v1/bookings',
    {
      query: {
        page,
        limit: 20,
        q: q || undefined,
        status: status === 'all' ? undefined : status,
      },
    },
  );

  const columns = useMemo<ColumnDef<PublicBooking, unknown>[]>(
    () => [
      {
        header: 'Booking',
        cell: ({ row }) => {
          const b = row.original;
          const productType =
            (b as unknown as { productType?: string }).productType ?? 'FLIGHT';
          const isHotel = productType === 'HOTEL' || b.flowSubType === ('HOTEL' as never);
          const isHoliday =
            productType === 'HOLIDAY' || b.flowSubType === ('HOLIDAY' as never);
          const isVisa = productType === 'VISA' || b.flowSubType === ('VISA' as never);
          const isBus = productType === 'BUS' || b.flowSubType === ('BUS' as never);
          const isInsurance =
            productType === 'INSURANCE' || b.flowSubType === ('INSURANCE' as never);
          const Icon = isInsurance
            ? InsuranceIcon
            : isBus
              ? BusIcon
              : isVisa
                ? VisaIcon
                : isHotel || isHoliday
                  ? HotelIcon
                  : Plane;
          // All product types now open /bookings/[id] — the detail page
          // discriminates on productType and renders flight / hotel /
          // holiday / visa / bus / insurance layouts accordingly.
          const href = `/bookings/${b.id}`;
          const isNonFlight = isHotel || isHoliday || isVisa || isBus || isInsurance;
          const refLabel = isInsurance
            ? 'Policy'
            : isVisa
              ? 'App'
              : isBus
                ? 'TIN'
                : isNonFlight
                  ? 'Conf'
                  : 'PNR';
          return (
            <Link
              href={href}
              className="group flex items-center gap-3 transition-colors hover:text-brand-700 dark:hover:text-brand-300"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300">
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-xs font-bold text-ink-1">{b.bookingCode}</p>
                <p className="font-mono text-[10px] text-ink-3">
                  {refLabel} {b.pnr ?? '—'}
                </p>
              </div>
            </Link>
          );
        },
      },
      {
        header: 'Sector',
        cell: ({ row }) => {
          const [from, to] = row.original.sector.split(/[-→]/).map((s) => s.trim());
          return (
            <span className="flex items-center gap-1.5 font-mono text-sm text-ink-1">
              <span>{from}</span>
              <ArrowRight className="h-3 w-3 text-ink-4" strokeWidth={1.75} />
              <span>{to ?? ''}</span>
            </span>
          );
        },
      },
      {
        header: 'Travel',
        cell: ({ row }) => {
          const d = new Date(row.original.travelDate);
          return (
            <div>
              <p className="font-mono text-xs font-semibold text-ink-1 tabular-nums">
                {d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
              <p className="text-[10px] text-ink-3">
                {d.toLocaleDateString('en-IN', { weekday: 'short' })}
              </p>
            </div>
          );
        },
      },
      {
        header: 'Pax',
        cell: ({ row }) => (
          <Badge variant="neutral" className="font-mono text-[10px]">
            {row.original.passengers.length}
          </Badge>
        ),
      },
      {
        header: 'Total',
        cell: ({ row }) => (
          <span className="font-mono text-sm font-semibold tabular-nums text-ink-1">
            {formatPaiseAsINR(row.original.pricing.agencyPayablePaise, { compact: true })}
          </span>
        ),
      },
      {
        header: 'Source',
        cell: ({ row }) => (
          <Badge
            variant={row.original.flowSubType === 'SERIES' ? 'accent' : 'outline'}
            className="text-[10px]"
          >
            {row.original.flowSubType}
          </Badge>
        ),
      },
      {
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        header: '',
        id: 'actions',
        cell: ({ row }) => (
          <Link
            href={`/bookings/${row.original.id}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-4 transition-all hover:bg-surface-2 hover:text-brand-700 dark:hover:text-brand-300"
            aria-label="Open booking"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ),
      },
    ],
    [],
  );

  // Quick stats — derived from the current page (or could fetch separately).
  const totalBookings = list.data?.meta.total ?? 0;
  const onHold = (list.data?.data ?? []).filter((b) => b.status === 'HOLD').length;
  const ticketed = (list.data?.data ?? []).filter((b) => b.status === 'TICKETED').length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operate · Bookings"
        title="All bookings"
        description="Every PNR your team has issued. Click a row for the full timeline + e-ticket."
        actions={
          <>
            <Button variant="secondary">
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button asChild>
              <Link href="/search">
                <PlaneTakeoff className="h-4 w-4" /> New booking
              </Link>
            </Button>
          </>
        }
      />

      {/* Quick stats strip */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="eyebrow text-ink-3">Total</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{totalBookings}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="eyebrow text-ink-3">Active holds</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-warning">{onHold}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="eyebrow text-ink-3">Ticketed (page)</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-success">{ticketed}</p>
          </CardContent>
        </Card>
      </section>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface-1 p-2">
        <Input
          placeholder="Search code, PNR, sector…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          leading={<Search className="h-4 w-4" strokeWidth={1.75} />}
          className="h-8 w-full max-w-xs"
          fullWidth={false}
        />

        <div className="mx-1 h-5 w-px bg-border" />

        {STATUS_OPTIONS.map((s) => (
          <FilterChip
            key={s.value}
            active={status === s.value}
            onClick={() => {
              setStatus(s.value);
              setPage(1);
            }}
            label={s.label}
          />
        ))}

        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            <FilterIcon className="h-3 w-3" /> {totalBookings}
          </Badge>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="h-8 w-[160px]">
              <ChevronsUpDown className="h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Most recent</SelectItem>
              <SelectItem value="amount-desc">Highest amount</SelectItem>
              <SelectItem value="travel-asc">Travel date</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setDensity('compact')}
              aria-label="Compact density"
              className={cn(
                'grid h-7 w-7 place-items-center rounded transition-colors',
                density === 'compact'
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'text-ink-3 hover:bg-surface-2',
              )}
            >
              <Rows3 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setDensity('default')}
              aria-label="Default density"
              className={cn(
                'grid h-7 w-7 place-items-center rounded transition-colors',
                density === 'default'
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'text-ink-3 hover:bg-surface-2',
              )}
            >
              <TableIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <DataTable
          columns={columns}
          data={list.data?.data ?? []}
          loading={list.isLoading}
          density={density}
          empty="No bookings yet — search for flights and ticket your first one."
        />
      </Card>

      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
          : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2',
      )}
    >
      {label}
    </button>
  );
}
