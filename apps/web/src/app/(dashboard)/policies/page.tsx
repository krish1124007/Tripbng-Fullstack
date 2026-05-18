'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  CreatePolicyRequestSchema,
  type CreatePolicyRequest,
  type PublicPolicy,
} from '@tripbng/shared';
import {
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
  Separator,
  Switch,
  Textarea,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { formatPaiseAsINR, formatPercentBasisPoints } from '@/lib/money';

export default function PoliciesPage() {
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicPolicy | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicPolicy | null>(null);

  const list = useApiPaginatedQuery<PublicPolicy>(['policies', { page }], '/api/v1/policies', {
    query: { page, limit: 20 },
  });
  const invalidate = useInvalidateOnSuccess([['policies']]);
  const remove = useApiMutation<{ id: string }, { ok: true }>(
    (i) => `/api/v1/policies/${i.id}`,
    'DELETE',
    {
      onSuccess: () => {
        toast.success('Policy deleted');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const columns = useMemo<ColumnDef<PublicPolicy, unknown>[]>(
    () => [
      {
        header: 'Name',
        accessorKey: 'name',
        cell: ({ getValue }) => <span className="text-sm text-ink-1">{getValue() as string}</span>,
      },
      {
        header: 'Commission',
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums">
            {formatPercentBasisPoints(row.original.commissionPercent)}
          </span>
        ),
      },
      {
        header: 'Mgmt fee',
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums">
            {formatPaiseAsINR(row.original.managementFeePaise, { compact: true })}
          </span>
        ),
      },
      {
        header: 'B2B markup',
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums">
            {formatPaiseAsINR(row.original.b2bMarkupPaise, { compact: true })}
          </span>
        ),
      },
      {
        header: 'GST',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-ink-3">
            {formatPercentBasisPoints(row.original.gstRateBasisPoints)}
            {row.original.gstOnMarkupOnly ? ' (markup)' : ''}
          </span>
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
        eyebrow="Pricing"
        title="Policies"
        description="Default commission, management fee, and GST handling for supplier fares."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New policy
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        loading={list.isLoading}
        empty="No policies yet."
      />
      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <PolicyDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <PolicyDrawer
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        target={editTarget}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="Inventories using this policy will fall back to defaults."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync({ id: deleteTarget.id });
        }}
      />
    </div>
  );
}

function PolicyDrawer({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: PublicPolicy | null;
}) {
  const editing = !!target;
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreatePolicyRequest>({
    resolver: zodResolver(CreatePolicyRequestSchema),
    defaultValues: {
      commissionPercent: 0,
      managementFeePaise: 0,
      b2bMarkupPaise: 0,
      gstOnMarkupOnly: false,
      gstRateBasisPoints: 1800,
    },
  });
  const gstOnMarkupOnly = watch('gstOnMarkupOnly');

  useEffect(() => {
    if (target) {
      reset({
        name: target.name,
        commissionPercent: target.commissionPercent,
        managementFeePaise: target.managementFeePaise,
        b2bMarkupPaise: target.b2bMarkupPaise,
        gstOnMarkupOnly: target.gstOnMarkupOnly,
        gstRateBasisPoints: target.gstRateBasisPoints,
        notes: target.notes ?? undefined,
      });
    } else if (!open) {
      reset();
    }
  }, [target, open, reset]);

  const invalidate = useInvalidateOnSuccess([['policies']]);
  const create = useApiMutation<CreatePolicyRequest, PublicPolicy>('/api/v1/policies', 'POST', {
    onSuccess: () => {
      toast.success('Policy created');
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const update = useApiMutation<CreatePolicyRequest, PublicPolicy>(
    () => `/api/v1/policies/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Policy updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const submit = handleSubmit((v) => (editing ? update.mutate(v) : create.mutate(v)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[560px]">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${target?.name}` : 'New policy'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <DialogBody className="space-y-5">
            <FormField id="name" label="Name" required error={errors.name?.message}>
              <Input id="name" {...register('name')} />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                id="commissionPercent"
                label="Commission %"
                hint="bp×100 — 250 = 2.50%"
                error={errors.commissionPercent?.message}
              >
                <Input
                  id="commissionPercent"
                  type="number"
                  min="0"
                  max="10000"
                  {...register('commissionPercent', { valueAsNumber: true })}
                />
              </FormField>
              <FormField
                id="managementFeePaise"
                label="Management fee (paise)"
                error={errors.managementFeePaise?.message}
              >
                <Input
                  id="managementFeePaise"
                  type="number"
                  min="0"
                  {...register('managementFeePaise', { valueAsNumber: true })}
                />
              </FormField>
              <FormField
                id="b2bMarkupPaise"
                label="B2B markup (paise)"
                error={errors.b2bMarkupPaise?.message}
              >
                <Input
                  id="b2bMarkupPaise"
                  type="number"
                  min="0"
                  {...register('b2bMarkupPaise', { valueAsNumber: true })}
                />
              </FormField>
              <FormField
                id="gstRateBasisPoints"
                label="GST rate"
                hint="bp×100 — 1800 = 18%"
                error={errors.gstRateBasisPoints?.message}
              >
                <Input
                  id="gstRateBasisPoints"
                  type="number"
                  min="0"
                  max="10000"
                  {...register('gstRateBasisPoints', { valueAsNumber: true })}
                />
              </FormField>
            </div>

            <Separator />
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-sm text-ink-1">GST on markup only</span>
                <span className="block text-xs text-ink-3">
                  Tax just the markup portion. Default is to tax the full pre-tax line.
                </span>
              </span>
              <Switch
                checked={gstOnMarkupOnly}
                onCheckedChange={(v) => setValue('gstOnMarkupOnly', v)}
              />
            </label>

            <FormField id="notes" label="Notes">
              <Textarea id="notes" rows={2} {...register('notes')} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || create.isPending || update.isPending}>
              {create.isPending || update.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create policy'}
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
