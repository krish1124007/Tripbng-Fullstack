'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { PublicAuditLog } from '@tripbng/shared';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  KeyValue,
  PageHeader,
  Pagination,
  Separator,
} from '@/components/ui';
import { useApiPaginatedQuery } from '@/lib/api-client';

const ACTION_VARIANT = (action: string) => {
  if (action.startsWith('auth.impersonate')) return 'danger';
  if (action.endsWith('.create')) return 'success';
  if (action.endsWith('.update')) return 'info';
  if (action.includes('suspend') || action.includes('disable')) return 'warning';
  if (action.includes('reset_password')) return 'warning';
  return 'neutral';
};

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<{ action?: string; resource?: string; actorId?: string }>(
    {},
  );
  const [detail, setDetail] = useState<PublicAuditLog | null>(null);

  const list = useApiPaginatedQuery<PublicAuditLog>(
    ['audit-logs', { page, ...filters }],
    '/api/v1/audit-logs',
    { query: { page, limit: 50, ...filters } },
  );

  const columns = useMemo<ColumnDef<PublicAuditLog, unknown>[]>(
    () => [
      {
        header: 'Time',
        accessorKey: 'createdAt',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-ink-2 tabular-nums">
            {new Date(getValue() as string).toLocaleString()}
          </span>
        ),
      },
      {
        header: 'Action',
        accessorKey: 'action',
        cell: ({ getValue }) => {
          const v = getValue() as string;
          return (
            <Badge variant={ACTION_VARIANT(v) as never} className="font-mono">
              {v}
            </Badge>
          );
        },
      },
      {
        header: 'Resource',
        accessorKey: 'resource',
        cell: ({ row }) => (
          <span className="text-sm text-ink-2">
            {row.original.resource}
            {row.original.resourceId ? (
              <span className="ml-1 font-mono text-xs text-ink-3">
                #{row.original.resourceId.slice(-6)}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        header: 'Actor',
        accessorKey: 'actorRole',
        cell: ({ row }) => (
          <span className="text-xs text-ink-3">
            {row.original.actorRole ?? 'system'}
            {row.original.actorId ? (
              <span className="ml-1 font-mono">
                {row.original.actorId.slice(-6)}
              </span>
            ) : null}
            {row.original.impersonatorId ? (
              <Badge variant="danger" className="ml-1">
                impersonating
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        header: 'IP',
        accessorKey: 'ip',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-ink-3">{(getValue() as string) ?? '—'}</span>
        ),
      },
      {
        header: 'Result',
        accessorKey: 'success',
        cell: ({ getValue }) => (
          <Badge variant={(getValue() as boolean) ? 'success' : 'danger'}>
            {(getValue() as boolean) ? 'OK' : 'ERR'}
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Compliance"
        title="Audit log"
        description="Append-only record of every privileged action. Cannot be deleted."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          placeholder="Filter by action prefix (e.g. auth.)"
          value={filters.action ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value || undefined }))}
        />
        <Input
          placeholder="Filter by resource (e.g. user)"
          value={filters.resource ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, resource: e.target.value || undefined }))}
        />
        <Input
          placeholder="Filter by actor ID"
          value={filters.actorId ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, actorId: e.target.value || undefined }))}
        />
      </div>

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        loading={list.isLoading}
        density="compact"
        onRowClick={(row) => setDetail(row)}
        empty="No audit events match these filters."
      />

      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.action ?? ''}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {detail ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <KeyValue label="Time" value={new Date(detail.createdAt).toLocaleString()} mono />
                  <KeyValue label="Result" value={detail.success ? 'OK' : 'ERROR'} />
                  <KeyValue label="Actor" value={detail.actorId ?? 'system'} mono />
                  <KeyValue label="Actor role" value={detail.actorRole ?? '—'} />
                  <KeyValue label="Resource" value={detail.resource} />
                  <KeyValue label="Resource ID" value={detail.resourceId ?? '—'} mono />
                  <KeyValue label="IP" value={detail.ip ?? '—'} mono />
                  <KeyValue
                    label="Impersonator"
                    value={detail.impersonatorId ?? '—'}
                    mono={!!detail.impersonatorId}
                  />
                </div>
                {(detail.before != null || detail.after != null) && <Separator />}
                {detail.before != null ? (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-ink-3">Before</p>
                    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-xs">
                      {JSON.stringify(detail.before, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {detail.after != null ? (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-ink-3">After</p>
                    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-xs">
                      {JSON.stringify(detail.after, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {detail.userAgent ? (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-ink-3">User agent</p>
                    <p className="mt-1 break-all font-mono text-xs text-ink-2">{detail.userAgent}</p>
                  </div>
                ) : null}
              </>
            ) : null}
          </DialogBody>
          <div className="flex justify-end gap-2 border-t p-4">
            <Button variant="ghost" onClick={() => setDetail(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
