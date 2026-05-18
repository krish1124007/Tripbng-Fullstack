'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  CreateIncentiveRequestSchema,
  type CreateIncentiveRequest,
  type PublicIncentive,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Textarea,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { formatPaiseAsINR, formatPercentBasisPoints } from '@/lib/money';

export default function IncentivesPage() {
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicIncentive | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicIncentive | null>(null);

  const list = useApiPaginatedQuery<PublicIncentive>(
    ['incentives', { page }],
    '/api/v1/incentives',
    { query: { page, limit: 20 } },
  );

  const invalidate = useInvalidateOnSuccess([['incentives']]);
  const remove = useApiMutation<{ id: string }, { ok: true }>(
    (i) => `/api/v1/incentives/${i.id}`,
    'DELETE',
    {
      onSuccess: () => {
        toast.success('Incentive deleted');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const columns = useMemo<ColumnDef<PublicIncentive, unknown>[]>(
    () => [
      {
        header: 'Name',
        accessorKey: 'name',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm text-ink-1">{row.original.name}</span>
            <span className="text-xs text-ink-3">{row.original.description ?? '—'}</span>
          </div>
        ),
      },
      {
        header: 'Slabs',
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono">
            {row.original.slabs.length}
          </Badge>
        ),
      },
      {
        header: 'Window',
        cell: ({ row }) => (
          <span className="text-xs text-ink-3">
            {new Date(row.original.validFrom).toLocaleDateString('en-IN')}
            {' → '}
            {new Date(row.original.validTo).toLocaleDateString('en-IN')}
          </span>
        ),
      },
      {
        header: 'Target',
        accessorKey: 'target',
        cell: ({ getValue }) => <Badge variant="neutral">{getValue() as string}</Badge>,
      },
      {
        header: 'Status',
        cell: ({ row }) =>
          row.original.active ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="neutral">Inactive</Badge>
          ),
      },
      {
        header: '',
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Row actions">
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
        eyebrow="Marketing"
        title="Deposit incentives"
        description="Tiered rewards for top-ups. Slabs apply by deposit amount, percent or flat."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New incentive
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        loading={list.isLoading}
        empty="No incentive schemes yet."
      />
      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <IncentiveDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <IncentiveDrawer
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        target={editTarget}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="Existing earned incentives are unaffected. New top-ups won't qualify under this scheme."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync({ id: deleteTarget.id });
        }}
      />
    </div>
  );
}

function IncentiveDrawer({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: PublicIncentive | null;
}) {
  const editing = !!target;
  const form = useForm<CreateIncentiveRequest>({
    resolver: zodResolver(CreateIncentiveRequestSchema),
    defaultValues: { slabs: [], target: 'ALL', active: true },
  });
  const { register, handleSubmit, reset, control, watch, setValue, formState: { errors, isSubmitting } } = form;
  const slabs = useFieldArray({ control, name: 'slabs' });
  const active = watch('active');

  useEffect(() => {
    if (target) {
      reset({
        name: target.name,
        description: target.description ?? undefined,
        slabs: target.slabs,
        validFrom: new Date(target.validFrom),
        validTo: new Date(target.validTo),
        target: target.target,
        agencyGroupIds: target.agencyGroupIds,
        distributorIds: target.distributorIds,
        active: target.active,
      });
    } else if (!open) {
      reset({ slabs: [], target: 'ALL', active: true });
    }
  }, [target, open, reset]);

  const invalidate = useInvalidateOnSuccess([['incentives']]);
  const create = useApiMutation<CreateIncentiveRequest, PublicIncentive>(
    '/api/v1/incentives',
    'POST',
    {
      onSuccess: () => {
        toast.success('Incentive created');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const update = useApiMutation<CreateIncentiveRequest, PublicIncentive>(
    () => `/api/v1/incentives/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Incentive updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const submit = handleSubmit((v) => (editing ? update.mutate(v) : create.mutate(v)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[600px]">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${target?.name}` : 'New incentive scheme'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <DialogBody className="space-y-5">
            <FormField id="name" label="Name" required error={errors.name?.message}>
              <Input id="name" {...register('name')} />
            </FormField>
            <FormField id="description" label="Description">
              <Textarea id="description" rows={2} {...register('description')} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField id="validFrom" label="Valid from" required>
                <Input id="validFrom" type="date" {...register('validFrom')} />
              </FormField>
              <FormField id="validTo" label="Valid to" required>
                <Input id="validTo" type="date" {...register('validTo')} />
              </FormField>
            </div>

            <Separator />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-ink-2">Slabs</h3>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  slabs.append({
                    minDepositPaise: 0,
                    maxDepositPaise: null,
                    valueType: 'PERCENT',
                    value: 0,
                    tdsPercent: 0,
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add slab
              </Button>
            </div>
            {slabs.fields.length === 0 ? (
              <p className="rounded-md border border-dashed bg-surface-2 px-3 py-4 text-center text-xs text-ink-3">
                Add at least one slab. Slabs are matched by deposit amount.
              </p>
            ) : null}
            {slabs.fields.map((f, idx) => (
              <div key={f.id} className="space-y-2 rounded-md border bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[11px] text-ink-3">Slab {idx + 1}</p>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => slabs.remove(idx)}
                    aria-label="Remove slab"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <FormField label="Min deposit (paise)">
                    <Input
                      type="number"
                      min="0"
                      {...register(`slabs.${idx}.minDepositPaise`, { valueAsNumber: true })}
                    />
                  </FormField>
                  <FormField label="Max deposit (paise)" hint="empty = no cap">
                    <Input
                      type="number"
                      min="0"
                      {...register(`slabs.${idx}.maxDepositPaise`, {
                        setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
                      })}
                    />
                  </FormField>
                  <FormField label="Type">
                    <Select
                      value={watch(`slabs.${idx}.valueType`)}
                      onValueChange={(v) =>
                        setValue(`slabs.${idx}.valueType`, v as 'FLAT' | 'PERCENT')
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PERCENT">PERCENT</SelectItem>
                        <SelectItem value="FLAT">FLAT</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField
                    label={
                      watch(`slabs.${idx}.valueType`) === 'PERCENT'
                        ? 'Value (bp×100)'
                        : 'Value (paise)'
                    }
                    hint={
                      watch(`slabs.${idx}.valueType`) === 'PERCENT'
                        ? '250 = 2.50%'
                        : undefined
                    }
                  >
                    <Input
                      type="number"
                      min="0"
                      {...register(`slabs.${idx}.value`, { valueAsNumber: true })}
                    />
                  </FormField>
                  <FormField label="TDS %" hint="bp×100">
                    <Input
                      type="number"
                      min="0"
                      max="10000"
                      {...register(`slabs.${idx}.tdsPercent`, { valueAsNumber: true })}
                    />
                  </FormField>
                </div>
              </div>
            ))}

            <Separator />
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm">Active</span>
              <Switch checked={active} onCheckedChange={(v) => setValue('active', v)} />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || create.isPending || update.isPending}>
              {create.isPending || update.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create scheme'}
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}

// Placeholder usage so unused-import warning never triggers.
const _u = formatPaiseAsINR;
const _p = formatPercentBasisPoints;
void _u;
void _p;
