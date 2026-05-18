'use client';

// /admin/visa/products — list + search + "+ New visa product" button.
// Mirrors /admin/holidays/packages.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search as SearchIcon, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminVisaProductSummary } from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  Input,
  PageHeader,
} from '@/components/ui';
import { useApiMutation, useApiQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { ApiCallError } from '@/lib/api';

interface ListResponse {
  items: AdminVisaProductSummary[];
}

export default function AdminVisaProductsPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdminVisaProductSummary | null>(null);

  const list = useApiQuery<ListResponse>(
    ['admin-visa-products', { q, publishedOnly }],
    '/api/v1/admin/visa/products',
    {
      query: {
        q: q.trim() || undefined,
        publishedOnly: publishedOnly ? 'true' : undefined,
        limit: 100,
      },
    },
  );
  const items = list.data?.items ?? [];

  const invalidate = useInvalidateOnSuccess([['admin-visa-products']]);
  const del = useApiMutation<{ id: string }, { deleted: boolean }>(
    (i) => `/api/v1/admin/visa/products/${i.id}`,
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
        title="Visa products"
        description="Admin-authored visa products grouped by country. Customers see published rows under /visa."
        actions={
          <Button onClick={() => router.push('/admin/visa/products/new')}>
            <Plus className="h-4 w-4" /> New visa product
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, country, or region…"
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
          {list.isLoading ? 'Loading…' : `${sorted.length} product${sorted.length === 1 ? '' : 's'}`}
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
          icon={StickyNote}
          title={q || publishedOnly ? 'No visa products match' : 'No visa products yet'}
          description={
            q || publishedOnly
              ? 'Try a different search or untoggle the published-only filter.'
              : 'Create the first visa product to surface it under /visa.'
          }
          action={
            <Button onClick={() => router.push('/admin/visa/products/new')}>
              <Plus className="h-4 w-4" /> New visa product
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
                  onClick={() => router.push(`/admin/visa/products/${p.id}`)}
                  className="flex-1 text-left"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="text-sm font-semibold text-ink-1">
                      {p.name}
                    </p>
                    <Badge variant={p.published ? 'success' : 'warning'} className="text-[9px]">
                      {p.published ? 'Published' : 'Draft'}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] capitalize">
                      {p.purpose}
                    </Badge>
                    <Badge variant="outline" className="text-[9px]">
                      {p.processingMode}
                    </Badge>
                    {p.urgentAvailable ? (
                      <Badge variant="accent" className="text-[9px]">
                        Urgent
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-ink-3">
                    {p.id} · {p.countryName} ({p.countryIso2}) · {p.region} · {p.processingDays}d processing
                  </p>
                </button>

                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-ink-3">Base fee / pax</p>
                  <p className="font-mono text-sm font-bold tabular-nums text-ink-1">
                    ₹{(p.consulateFeeInr + p.serviceFeeInr).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push(`/admin/visa/products/${p.id}`)}
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
        title={`Delete ${pendingDelete?.name ?? ''}?`}
        description="The visa product will be removed permanently. Customers will no longer see it under /visa."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (pendingDelete) await del.mutateAsync({ id: pendingDelete.id });
        }}
      />
    </div>
  );
}
