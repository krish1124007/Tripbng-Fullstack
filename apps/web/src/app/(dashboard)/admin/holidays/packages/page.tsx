'use client';

// /admin/holidays/packages — list + search + "+ New package" button.
// Uses the existing PageHeader/Input/Button primitives so it sits visually
// alongside the other admin list pages (suppliers, banners, …).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search as SearchIcon, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminHolidayPackageSummary } from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  PageHeader,
} from '@/components/ui';
import { useApiMutation, useApiQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { ApiCallError } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui';
import { formatPaiseAsINR } from '@/lib/money';

interface ListResponse {
  items: AdminHolidayPackageSummary[];
}

export default function AdminHolidayPackagesPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdminHolidayPackageSummary | null>(null);

  const list = useApiQuery<ListResponse>(
    ['admin-holiday-packages', { q, publishedOnly }],
    '/api/v1/admin/holidays/packages',
    {
      query: {
        q: q.trim() || undefined,
        publishedOnly: publishedOnly ? 'true' : undefined,
        limit: 100,
      },
    },
  );
  const items = list.data?.items ?? [];

  const invalidate = useInvalidateOnSuccess([['admin-holiday-packages']]);
  const del = useApiMutation<{ id: string }, { deleted: boolean }>(
    (i) => `/api/v1/admin/holidays/packages/${i.id}`,
    'DELETE',
    {
      onSuccess: (_data, input) => {
        toast.success(`Deleted ${input.id}`);
        invalidate();
        setPendingDelete(null);
      },
      onError: (err) => toast.error(err instanceof ApiCallError ? err.message : 'Delete failed'),
    },
  );

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
      ),
    [items],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Holiday packages"
        description="Admin-authored series departures and tailor-made packages. Customers see published rows under /holidays."
        actions={
          <Button onClick={() => router.push('/admin/holidays/packages/new')}>
            <Plus className="h-4 w-4" /> New package
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title or destination…"
            leading={<SearchIcon className="h-4 w-4" strokeWidth={1.75} />}
          />
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-surface-1 px-3 py-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={publishedOnly}
            onChange={(e) => setPublishedOnly(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-brand-600"
          />
          Published only
        </label>
        <span className="text-xs text-ink-3">
          {list.isLoading ? 'Loading…' : `${sorted.length} package${sorted.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {list.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="shimmer h-16 w-full overflow-hidden rounded-md border" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={q || publishedOnly ? 'No packages match' : 'No packages yet'}
          description={
            q || publishedOnly
              ? 'Try a different search or untoggle the published-only filter.'
              : 'Create the first holiday package to surface it under /holidays.'
          }
          action={
            <Button onClick={() => router.push('/admin/holidays/packages/new')}>
              <Plus className="h-4 w-4" /> New package
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {sorted.map((p) => (
            <Card key={p.id} className="transition-colors hover:border-brand-300">
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <button
                  type="button"
                  onClick={() => router.push(`/admin/holidays/packages/${p.id}`)}
                  className="flex-1 text-left"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="text-sm font-semibold text-ink-1">{p.title}</p>
                    <Badge variant={p.published ? 'success' : 'warning'} className="text-[9px]">
                      {p.published ? 'Published' : 'Draft'}
                    </Badge>
                    {p.bestSeller ? (
                      <Badge variant="accent" className="text-[9px]">
                        Best seller
                      </Badge>
                    ) : null}
                    {p.themeLabel ? (
                      <Badge variant="outline" className="text-[9px]">
                        {p.themeLabel}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-ink-3">
                    {p.id} · {p.destination} · {p.nights}n · {p.cities.length} cities
                  </p>
                </button>

                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-ink-3">From / pax</p>
                  <p className="font-mono text-sm font-bold tabular-nums text-ink-1">
                    {p.perPaxRupees > 0 ? formatPaiseAsINR(p.perPaxRupees * 100) : '—'}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push(`/admin/holidays/packages/${p.id}`)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDelete(p)}
                    className="text-danger hover:bg-danger-soft"
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => (!o ? setPendingDelete(null) : undefined)}
        title={`Delete ${pendingDelete?.title ?? ''}?`}
        description="The package will be removed permanently. Customers will no longer see it under /holidays."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (pendingDelete) await del.mutateAsync({ id: pendingDelete.id });
        }}
      />
    </div>
  );
}
