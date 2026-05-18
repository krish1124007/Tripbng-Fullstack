'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  CreateAgencyGroupRequestSchema,
  type CreateAgencyGroupRequest,
  type PublicAgency,
  type PublicAgencyGroup,
} from '@tripbng/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DrawerContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FormField,
  Input,
  PageHeader,
  Pagination,
  Textarea,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export default function AgencyGroupsPage() {
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicAgencyGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicAgencyGroup | null>(null);

  const list = useApiPaginatedQuery<PublicAgencyGroup>(
    ['agency-groups', { page }],
    '/api/v1/agency-groups',
    { query: { page, limit: 20 } },
  );
  const invalidate = useInvalidateOnSuccess([['agency-groups']]);
  const remove = useApiMutation<{ id: string }, { ok: true }>(
    (i) => `/api/v1/agency-groups/${i.id}`,
    'DELETE',
    {
      onSuccess: () => {
        toast.success('Group deleted');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const columns = useMemo<ColumnDef<PublicAgencyGroup, unknown>[]>(
    () => [
      {
        header: 'Name',
        accessorKey: 'name',
        cell: ({ getValue }) => <span className="text-sm text-ink-1">{getValue() as string}</span>,
      },
      {
        header: 'Description',
        accessorKey: 'description',
        cell: ({ getValue }) => (
          <span className="text-xs text-ink-3">{(getValue() as string) ?? '—'}</span>
        ),
      },
      {
        header: 'Members',
        accessorKey: 'agencyCount',
        cell: ({ getValue }) => (
          <Badge variant="outline" className="font-mono">
            {getValue() as number}
          </Badge>
        ),
      },
      {
        header: '',
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Row actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditTarget(row.original)}>Edit</DropdownMenuItem>
                <DropdownMenuItem destructive onClick={() => setDeleteTarget(row.original)}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Channel"
        title="Agency groups"
        description="Group agencies for bulk markup, banner, or policy targeting."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New group
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        loading={list.isLoading}
        empty="No agency groups yet."
      />
      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <AgencyGroupDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <AgencyGroupDrawer
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        target={editTarget}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="Markup rules and banners targeting this group will silently skip it."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync({ id: deleteTarget.id });
        }}
      />
    </div>
  );
}

function AgencyGroupDrawer({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: PublicAgencyGroup | null;
}) {
  const editing = !!target;
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateAgencyGroupRequest>({
    resolver: zodResolver(CreateAgencyGroupRequestSchema),
    defaultValues: { agencyIds: [] },
  });
  const agencyIds = watch('agencyIds') ?? [];

  // Pull agencies once when the drawer opens for picker UI.
  const agencies = useApiPaginatedQuery<PublicAgency>(
    ['agencies-for-group-picker'],
    '/api/v1/agencies',
    { query: { limit: 200 }, enabled: open },
  );

  useEffect(() => {
    if (target) {
      reset({ name: target.name, description: target.description ?? undefined, agencyIds: target.agencyIds });
    } else if (!open) {
      reset({ agencyIds: [] });
    }
  }, [target, open, reset]);

  const invalidate = useInvalidateOnSuccess([['agency-groups']]);
  const create = useApiMutation<CreateAgencyGroupRequest, PublicAgencyGroup>(
    '/api/v1/agency-groups',
    'POST',
    {
      onSuccess: () => {
        toast.success('Group created');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const update = useApiMutation<CreateAgencyGroupRequest, PublicAgencyGroup>(
    () => `/api/v1/agency-groups/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Group updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const toggleAgency = (id: string) => {
    const next = agencyIds.includes(id) ? agencyIds.filter((x) => x !== id) : [...agencyIds, id];
    setValue('agencyIds', next, { shouldValidate: true });
  };

  const submit = handleSubmit((v) => (editing ? update.mutate(v) : create.mutate(v)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[600px]">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${target?.name}` : 'New agency group'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <DialogBody className="space-y-5">
            <FormField id="name" label="Name" required error={errors.name?.message}>
              <Input id="name" {...register('name')} />
            </FormField>
            <FormField id="description" label="Description">
              <Textarea id="description" rows={2} {...register('description')} />
            </FormField>

            <FormField label={`Members (${agencyIds.length})`}>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border bg-surface-2 p-2">
                {(agencies.data?.data ?? []).map((a) => {
                  const active = agencyIds.includes(a.id);
                  return (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => toggleAgency(a.id)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition',
                        active ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-1',
                      )}
                    >
                      <span>
                        <span className="block">{a.companyName}</span>
                        <span className="block font-mono text-[10px] text-ink-3">{a.agencyCode}</span>
                      </span>
                      <span className={cn('font-mono text-xs', active ? 'text-accent' : 'text-ink-4')}>
                        {active ? '✓' : '+'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || create.isPending || update.isPending}>
              {create.isPending || update.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create group'}
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
