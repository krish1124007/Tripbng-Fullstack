'use client';

// Admin manager for "What's new" updates that surface on the agency
// dashboard's UpdatesFeed. Lists every row in the tenant (admins see
// inactive / expired too), with a side drawer for create + edit and a
// confirm dialog for delete.

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MoreHorizontal, Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  CreateUpdateRequestSchema,
  UPDATE_ICON,
  UPDATE_TONE,
  type CreateUpdateRequest,
  type PublicUpdate,
  type UpdateIcon,
  type UpdateTone,
} from '@tripbng/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogBody,
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
  Switch,
  Textarea,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { UPDATE_ICON_MAP, relativeTime } from '@/lib/update-icons';
import { cn } from '@/lib/utils';

const TONE_LABEL: Record<UpdateTone, string> = {
  accent: 'Accent (warm — new launches)',
  brand: 'Brand (blue — system updates)',
  neutral: 'Neutral (grey — notices)',
};

export default function UpdatesAdminPage() {
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicUpdate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicUpdate | null>(null);

  const list = useApiPaginatedQuery<PublicUpdate>(
    ['updates', { page, admin: true }],
    '/api/v1/updates',
    { query: { page, limit: 20 } },
  );

  const invalidate = useInvalidateOnSuccess([['updates']]);
  const remove = useApiMutation<{ id: string }, { ok: true }>(
    (i) => `/api/v1/updates/${i.id}`,
    'DELETE',
    {
      onSuccess: () => {
        toast.success('Update deleted');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const columns = useMemo<ColumnDef<PublicUpdate, unknown>[]>(
    () => [
      {
        header: 'Update',
        cell: ({ row }) => {
          const u = row.original;
          const Icon = UPDATE_ICON_MAP[u.icon] ?? Sparkles;
          return (
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-md',
                  u.tone === 'accent'
                    ? 'bg-accent-50 text-accent-700'
                    : u.tone === 'brand'
                      ? 'bg-brand-50 text-brand-700'
                      : 'bg-surface-2 text-ink-3',
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant={u.tone} className="text-[9px]">
                    {u.tag}
                  </Badge>
                  <span className="text-sm font-semibold text-ink-1">{u.title}</span>
                </div>
                <span className="line-clamp-1 text-xs text-ink-3">{u.body}</span>
              </div>
            </div>
          );
        },
      },
      {
        header: 'Priority',
        accessorKey: 'priority',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs tabular-nums text-ink-2">
            {String(getValue() as number).padStart(3, '0')}
          </span>
        ),
      },
      {
        header: 'Status',
        cell: ({ row }) =>
          row.original.active ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="neutral">Hidden</Badge>
          ),
      },
      {
        header: 'Window',
        cell: ({ row }) => (
          <span className="text-xs text-ink-3">
            {new Date(row.original.publishedAt).toLocaleDateString('en-IN')}
            {' → '}
            {row.original.expiresAt
              ? new Date(row.original.expiresAt).toLocaleDateString('en-IN')
              : '∞'}
          </span>
        ),
      },
      {
        header: 'Posted',
        cell: ({ row }) => (
          <span className="font-mono text-[10px] text-ink-4">
            {relativeTime(row.original.publishedAt)}
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
                <Button variant="ghost" size="icon" aria-label="Row actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditTarget(row.original)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onClick={() => setDeleteTarget(row.original)}
                >
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
        eyebrow="Marketing · Dashboard"
        title="What's new updates"
        description="Operational announcements posted to the agency dashboard UpdatesFeed."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New update
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        loading={list.isLoading}
        empty="No updates yet. Click 'New update' to post the first one."
      />
      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <UpdateDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <UpdateDrawer
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        target={editTarget}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.title}"?`}
        description="The row stops showing on every agency dashboard immediately. This is irreversible."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync({ id: deleteTarget.id });
        }}
      />
    </div>
  );
}

function UpdateDrawer({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: PublicUpdate | null;
}) {
  const editing = !!target;
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateUpdateRequest>({
    resolver: zodResolver(CreateUpdateRequestSchema),
    defaultValues: {
      tag: 'New',
      tone: 'accent',
      icon: 'Sparkles',
      priority: 100,
      active: true,
    },
  });
  const tone = watch('tone');
  const icon = watch('icon');
  const active = watch('active');

  useEffect(() => {
    if (target) {
      reset({
        title: target.title,
        body: target.body,
        tag: target.tag,
        tone: target.tone,
        icon: target.icon,
        href: target.href ?? undefined,
        priority: target.priority,
        active: target.active,
        publishedAt: target.publishedAt
          ? (new Date(target.publishedAt) as unknown as Date)
          : undefined,
        expiresAt: target.expiresAt
          ? (new Date(target.expiresAt) as unknown as Date)
          : undefined,
      });
    } else if (!open) {
      reset({
        tag: 'New',
        tone: 'accent',
        icon: 'Sparkles',
        priority: 100,
        active: true,
      });
    }
  }, [target, open, reset]);

  const invalidate = useInvalidateOnSuccess([['updates']]);
  const create = useApiMutation<CreateUpdateRequest, PublicUpdate>(
    '/api/v1/updates',
    'POST',
    {
      onSuccess: () => {
        toast.success('Update posted');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const update = useApiMutation<CreateUpdateRequest, PublicUpdate>(
    () => `/api/v1/updates/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Update saved');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const submit = handleSubmit((v) => (editing ? update.mutate(v) : create.mutate(v)));

  const PreviewIcon = UPDATE_ICON_MAP[icon] ?? Sparkles;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[560px]">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit "${target?.title}"` : 'New update'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <DialogBody className="space-y-4">
            {/* Live preview at the top — agents will see this card on
                the dashboard's UpdatesFeed. Helps content-writers
                check copy length + tone before publishing. */}
            <div className="rounded-md border bg-surface-1 p-3">
              <p className="mb-2 font-mono text-[9px] uppercase tracking-wider text-ink-3">
                Dashboard preview
              </p>
              <div className="flex items-start gap-3 rounded-md border bg-surface-0 p-3">
                <span
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-md',
                    tone === 'accent'
                      ? 'bg-accent-50 text-accent-700'
                      : tone === 'brand'
                        ? 'bg-brand-50 text-brand-700'
                        : 'bg-surface-2 text-ink-3',
                  )}
                >
                  <PreviewIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={tone} className="text-[9px]">
                      {watch('tag') || 'Tag'}
                    </Badge>
                    <p className="text-sm font-semibold text-ink-1">
                      {watch('title') || 'Update title appears here'}
                    </p>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-3">
                    {watch('body') || 'Body copy appears here…'}
                  </p>
                  <p className="mt-1.5 font-mono text-[10px] text-ink-4">just now</p>
                </div>
              </div>
            </div>

            <FormField id="title" label="Title" required error={errors.title?.message}>
              <Input id="title" placeholder="Series Q3 calendar is live" {...register('title')} />
            </FormField>
            <FormField id="body" label="Body" required error={errors.body?.message}>
              <Textarea
                id="body"
                rows={3}
                placeholder="July–September departures now bookable. Search Flights → toggle Series."
                {...register('body')}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField id="tag" label="Tag" required error={errors.tag?.message}>
                <Input id="tag" placeholder="New" {...register('tag')} />
              </FormField>
              <FormField label="Tone">
                <Select
                  value={tone}
                  onValueChange={(v) =>
                    setValue('tone', v as UpdateTone, { shouldDirty: true })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UPDATE_TONE.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TONE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Icon">
                <Select
                  value={icon}
                  onValueChange={(v) =>
                    setValue('icon', v as UpdateIcon, { shouldDirty: true })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UPDATE_ICON.map((i) => (
                      <SelectItem key={i} value={i}>
                        {i}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField id="priority" label="Priority (lower = higher in feed)">
                <Input
                  id="priority"
                  type="number"
                  min={0}
                  max={1000}
                  {...register('priority', { valueAsNumber: true })}
                />
              </FormField>
            </div>
            <FormField id="href" label="Click-through URL (optional)" error={errors.href?.message}>
              <Input id="href" placeholder="https://…" {...register('href')} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField id="publishedAt" label="Publish at">
                <Input id="publishedAt" type="datetime-local" {...register('publishedAt')} />
              </FormField>
              <FormField id="expiresAt" label="Expire at (optional)">
                <Input id="expiresAt" type="datetime-local" {...register('expiresAt')} />
              </FormField>
            </div>
            <div className="flex items-center justify-between rounded-md border bg-surface-1 p-3">
              <div>
                <p className="text-sm font-semibold text-ink-1">Active</p>
                <p className="text-xs text-ink-3">
                  Inactive updates stay in the admin list but don't show on the dashboard.
                </p>
              </div>
              <Switch
                checked={!!active}
                onCheckedChange={(v) => setValue('active', v, { shouldDirty: true })}
              />
            </div>
          </DialogBody>
          <div className="flex items-center justify-end gap-2 border-t bg-surface-1 px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? 'Save changes' : 'Post update'}
            </Button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
