'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ImagePlus, MoreHorizontal, Plus, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  BANNER_FREQUENCY,
  BANNER_LOCATION,
  BANNER_TARGET,
  BANNER_TYPE,
  CreateBannerRequestSchema,
  type BannerLocation,
  type CreateBannerRequest,
  type PublicBanner,
} from '@tripbng/shared';

// Human-readable labels for the location enum. Falls back to the raw enum
// value when a new location is added to the shared schema before this map
// is updated.
const LOCATION_LABEL: Record<BannerLocation, string> = {
  AGENCY_DASHBOARD: 'Agency dashboard',
  SEARCH_PAGE: 'Search page',
  BOOKING_REVIEW: 'Booking review',
  TOP_GLOBAL: 'Top of every page',
  TICKET_FOOTER: 'E-ticket footer (printed on every ticket)',
};
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
  Switch,
  Textarea,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';

export default function BannersPage() {
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicBanner | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicBanner | null>(null);

  const list = useApiPaginatedQuery<PublicBanner>(['banners', { page }], '/api/v1/banners', {
    query: { page, limit: 20 },
  });

  const invalidate = useInvalidateOnSuccess([['banners']]);
  const remove = useApiMutation<{ id: string }, { ok: true }>(
    (i) => `/api/v1/banners/${i.id}`,
    'DELETE',
    {
      onSuccess: () => {
        toast.success('Banner deleted');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const columns = useMemo<ColumnDef<PublicBanner, unknown>[]>(
    () => [
      {
        header: 'Title',
        accessorKey: 'title',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm text-ink-1">{row.original.title}</span>
            <span className="text-xs text-ink-3">
              {row.original.body?.slice(0, 80) ?? '—'}
            </span>
          </div>
        ),
      },
      {
        header: 'Where',
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono text-[10px]">
            {row.original.location}
          </Badge>
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
        header: 'Window',
        cell: ({ row }) => (
          <span className="text-xs text-ink-3">
            {row.original.startsAt ? new Date(row.original.startsAt).toLocaleDateString('en-IN') : '—'}
            {' → '}
            {row.original.endsAt ? new Date(row.original.endsAt).toLocaleDateString('en-IN') : '∞'}
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
        title="Banners"
        description="In-app announcements, promo cards, and POPUP messages."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New banner
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        loading={list.isLoading}
        empty="No banners yet."
      />
      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <BannerDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <BannerDrawer
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        target={editTarget}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.title}"?`}
        description="The banner stops showing immediately. This is immediate and irreversible."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync({ id: deleteTarget.id });
        }}
      />
    </div>
  );
}

function BannerDrawer({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: PublicBanner | null;
}) {
  const editing = !!target;
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateBannerRequest>({
    resolver: zodResolver(CreateBannerRequestSchema),
    defaultValues: {
      type: 'FIXED',
      location: 'AGENCY_DASHBOARD',
      target: 'ALL',
      frequency: 'PER_SESSION',
      priority: 100,
      active: true,
    },
  });
  const type = watch('type');
  const location = watch('location');
  const targetField = watch('target');
  const frequency = watch('frequency');
  const active = watch('active');

  useEffect(() => {
    if (target) {
      reset({
        title: target.title,
        body: target.body ?? undefined,
        imageUrl: target.imageUrl ?? undefined,
        href: target.href ?? undefined,
        type: target.type,
        location: target.location,
        target: target.target,
        frequency: target.frequency,
        priority: target.priority,
        active: target.active,
      });
    } else if (!open) {
      reset();
    }
  }, [target, open, reset]);

  const invalidate = useInvalidateOnSuccess([['banners']]);
  const create = useApiMutation<CreateBannerRequest, PublicBanner>('/api/v1/banners', 'POST', {
    onSuccess: () => {
      toast.success('Banner created');
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const update = useApiMutation<CreateBannerRequest, PublicBanner>(
    () => `/api/v1/banners/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Banner updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const submit = handleSubmit((v) => (editing ? update.mutate(v) : create.mutate(v)));

  // Hidden file <input> we trigger from a button below. Lets us style
  // the picker without the default browser chrome and gives us a place
  // to validate file size + mime type before pushing the data URL into
  // the form. Limits: 2 MB raw image, image/* mime types only.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[560px]">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${target?.title}` : 'New banner'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <DialogBody className="space-y-4">
            <FormField id="title" label="Title" required error={errors.title?.message}>
              <Input id="title" {...register('title')} />
            </FormField>
            <FormField id="body" label="Body" error={errors.body?.message}>
              <Textarea id="body" rows={3} {...register('body')} />
            </FormField>
            <BannerImageField
              value={watch('imageUrl') ?? ''}
              onChange={(v) =>
                setValue('imageUrl', v || undefined, { shouldDirty: true, shouldValidate: true })
              }
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField id="href" label="Click-through URL (optional)">
                <Input id="href" placeholder="https://…" {...register('href')} />
              </FormField>
              <FormField label="Type">
                <Select value={type} onValueChange={(v) => setValue('type', v as CreateBannerRequest['type'])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BANNER_TYPE.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Location">
                <Select
                  value={location}
                  onValueChange={(v) => setValue('location', v as CreateBannerRequest['location'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BANNER_LOCATION.map((t) => (
                      <SelectItem key={t} value={t}>{LOCATION_LABEL[t] ?? t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Target audience">
                <Select
                  value={targetField}
                  onValueChange={(v) => setValue('target', v as CreateBannerRequest['target'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BANNER_TARGET.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Frequency">
                <Select
                  value={frequency}
                  onValueChange={(v) => setValue('frequency', v as CreateBannerRequest['frequency'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BANNER_FREQUENCY.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField id="priority" label="Priority" hint="Lower wins ties">
                <Input
                  id="priority"
                  type="number"
                  min="0"
                  max="1000"
                  {...register('priority', { valueAsNumber: true })}
                />
              </FormField>
              <FormField id="startsAt" label="Starts">
                <Input id="startsAt" type="date" {...register('startsAt')} />
              </FormField>
              <FormField id="endsAt" label="Ends">
                <Input id="endsAt" type="date" {...register('endsAt')} />
              </FormField>
            </div>
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
              {create.isPending || update.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create banner'}
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────
// BannerImageField — file picker with inline preview.
//
// The value flowing in is whatever's on the form (`imageUrl`) — could be
// a `data:image/...;base64,…` URL we just generated from a FileReader,
// or an https://… link from an older banner. Either renders the same in
// the <img> preview.
//
// We keep the file <input> hidden + drive it from a styled button so
// the chrome is consistent with the rest of the admin UI; the visible
// surface is a drag-and-drop dropzone.
//
// Raw image cap: 2 MB. Anything larger and we toast.error + reject —
// the JSON body limit on the API is 5 MB which covers the ~33% base64
// inflation comfortably, but cropping at 2 MB raw also keeps Mongo doc
// sizes sensible (banners get fetched on every dashboard load).
// ────────────────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function BannerImageField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  function handleFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('That doesn’t look like an image file.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(
        `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — please upload one under 2 MB.`,
      );
      return;
    }
    setBusy(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setBusy(false);
      toast.error('Could not read that file.');
    };
    reader.onload = () => {
      setBusy(false);
      const dataUrl = String(reader.result ?? '');
      if (!dataUrl.startsWith('data:image/')) {
        toast.error('Unsupported image format.');
        return;
      }
      onChange(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  return (
    <FormField id="bannerImage" label="Banner image">
      {value ? (
        <div className="relative overflow-hidden rounded-lg border bg-surface-2">
          {/* The preview renders both data: URLs (new uploads) and https://
              URLs (older banners) without any additional plumbing. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Banner preview"
            className="block max-h-64 w-full object-contain"
          />
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-ink-1/80 text-white shadow-md transition-colors hover:bg-ink-1"
            aria-label="Remove image"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
          <div className="flex items-center justify-between gap-2 border-t bg-surface-1 px-3 py-2">
            <p className="truncate font-mono text-[11px] text-ink-3">
              {value.startsWith('data:image/')
                ? `Inline upload · ${value.slice(11, value.indexOf(';'))}`
                : value}
            </p>
            <label className="cursor-pointer text-xs font-semibold text-brand-700 hover:underline">
              Replace
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </div>
      ) : (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-strong/60 bg-surface-2/40 px-6 py-10 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40"
        >
          <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-100 text-brand-700">
            {busy ? (
              <Upload className="h-5 w-5 animate-pulse" strokeWidth={1.75} />
            ) : (
              <ImagePlus className="h-5 w-5" strokeWidth={1.75} />
            )}
          </span>
          <span className="text-sm font-semibold text-ink-1">
            {busy ? 'Reading…' : 'Click or drop an image to upload'}
          </span>
          <span className="text-xs text-ink-3">PNG, JPG, WebP · up to 2 MB</span>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
    </FormField>
  );
}
