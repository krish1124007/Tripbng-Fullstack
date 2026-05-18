'use client';

// Saved passengers — agency-shared directory.
//
// Contrast with `/pax-book` (local, browser-only):
//   • Saved passengers (this page) — backed by the
//     `/api/v1/saved-passengers` API. Visible to every user in the
//     agency. Used by the booking form's "Search saved passengers"
//     autofill so the team shares one source of truth.
//   • Pax book (`/pax-book`) — localStorage-only, device-bound.
//     Useful for a single agent's quick shortcuts.
//
// This page is a thin admin interface around the existing CRUD:
//   • List + filter (by pax type + free-text)
//   • Inline create (new modal)
//   • Inline delete (confirm dialog)
//
// Edits (PATCH) are intentionally not exposed yet — most agents
// re-save from the booking form to update, which is the simpler
// flow. We can add inline edit later if the volume calls for it.

import { useMemo, useState } from 'react';
import {
  Baby,
  Mail,
  Phone,
  Plus,
  Search,
  Trash2,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  PublicSavedPassenger,
  SavedPassengerCreate,
  SavedPassengerListResponse,
} from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { useApiMutation, useApiQuery } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type FilterType = 'all' | 'ADULT' | 'CHILD' | 'INFANT';

export default function SavedPassengersPage() {
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // List query. The backend filters by tenant + agency; we pass q +
  // type through. 30s staleTime keeps the page snappy when the user
  // toggles filters back and forth.
  const list = useApiQuery<SavedPassengerListResponse>(
    ['saved-passengers', typeFilter, q],
    '/api/v1/saved-passengers',
    {
      query: {
        ...(q.trim() ? { q: q.trim() } : {}),
        ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
      },
      staleTime: 30_000,
    },
  );

  const items = list.data?.items ?? [];

  const createMut = useApiMutation<SavedPassengerCreate, PublicSavedPassenger>(
    '/api/v1/saved-passengers',
    'POST',
    {
      onSuccess: () => {
        toast.success('Passenger saved to directory');
        setCreateOpen(false);
        void list.refetch();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  // <TInput, TOutput>: input is {id}, output is the deleted id echoed
  // back. The path callback uses input to interpolate the URL.
  const deleteMut = useApiMutation<{ id: string }, { id: string }>(
    (input) => `/api/v1/saved-passengers/${input.id}`,
    'DELETE',
    {
      onSuccess: () => {
        toast.success('Passenger removed from directory');
        setDeleteId(null);
        void list.refetch();
      },
      onError: (err) => {
        toast.error(err.message);
        setDeleteId(null);
      },
    },
  );

  // Group passengers by type for quick scanning + counters.
  const grouped = useMemo(() => {
    const byType: Record<string, PublicSavedPassenger[]> = {
      ADULT: [],
      CHILD: [],
      INFANT: [],
    };
    for (const p of items) {
      const bucket = byType[p.type];
      if (bucket) bucket.push(p);
    }
    return byType;
  }, [items]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operate · Directory"
        title="Saved passengers"
        description="Agency-shared passenger directory — appears in the booking form's autofill for every team member."
        actions={
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="h-3.5 w-3.5" /> Add passenger
          </Button>
        }
      />

      {/* Toolbar — search + type filter */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <div className="relative min-w-[240px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
              strokeWidth={2}
            />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, email, phone or passport"
              className="w-full rounded-md border border-stroke-1 bg-surface-1 py-2 pl-8 pr-3 text-sm text-ink-1 placeholder:text-ink-3 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as FilterType)}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types ({items.length})</SelectItem>
              <SelectItem value="ADULT">Adult ({grouped['ADULT']?.length ?? 0})</SelectItem>
              <SelectItem value="CHILD">Child ({grouped['CHILD']?.length ?? 0})</SelectItem>
              <SelectItem value="INFANT">Infant ({grouped['INFANT']?.length ?? 0})</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* List */}
      {list.isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-ink-3">
            Loading passengers…
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={Users}
              title={q || typeFilter !== 'all' ? 'No matching passengers' : 'No saved passengers yet'}
              description={
                q || typeFilter !== 'all'
                  ? 'Try a different search or clear the filters.'
                  : 'Save passengers from the booking form (tick "Save passenger") or add one manually.'
              }
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add passenger
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((p) => (
            <PassengerRow key={p.id} p={p} onDelete={() => setDeleteId(p.id)} />
          ))}
        </div>
      )}

      {/* Create modal */}
      <CreatePassengerDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={(body) => createMut.mutate(body)}
        saving={createMut.isPending}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(v) => !v && setDeleteId(null)}
        title="Remove saved passenger?"
        description="They'll no longer appear in the booking form's autofill. The passenger's existing bookings keep their records — only the directory entry is removed."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deleteId) deleteMut.mutate({ id: deleteId });
        }}
      />
    </div>
  );
}

// ────────── Sub-components ──────────

function PassengerRow({ p, onDelete }: { p: PublicSavedPassenger; onDelete: () => void }) {
  const TypeIcon = p.type === 'INFANT' ? Baby : UserIcon;
  return (
    <Card className="transition-colors hover:border-brand-300">
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md',
              p.type === 'ADULT'
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                : p.type === 'CHILD'
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
            )}
          >
            <TypeIcon className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[14px] font-bold text-ink-1">
                {p.title}. {p.firstName} {p.lastName}
              </p>
              <Badge
                variant={p.type === 'INFANT' ? 'success' : p.type === 'CHILD' ? 'accent' : 'brand'}
                className="text-[9px] uppercase tracking-wider"
              >
                {p.type === 'INFANT' ? 'Infant · Under 2' : p.type === 'CHILD' ? 'Child · 2–11' : 'Adult · 12+'}
              </Badge>
              {p.gender ? (
                <Badge variant="outline" className="text-[9px]">
                  {p.gender === 'M' ? 'Male' : 'Female'}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
              {p.dateOfBirth ? (
                <span className="font-mono">
                  DOB {new Date(p.dateOfBirth + 'T00:00:00').toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              ) : null}
              {p.nationality ? <span className="font-mono">Nat {p.nationality}</span> : null}
              {p.passport?.number ? (
                <span className="font-mono">
                  Passport {p.passport.number}
                  {p.passport.expiry ? (
                    <span className="ml-1 text-ink-4">
                      · exp {new Date(p.passport.expiry).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {p.email ? (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3 w-3" strokeWidth={1.75} />
                  {p.email}
                </span>
              ) : null}
              {p.phone ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" strokeWidth={1.75} />
                  {p.phone}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10"
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </Button>
      </CardContent>
    </Card>
  );
}

interface CreateForm {
  type: 'ADULT' | 'CHILD' | 'INFANT';
  title: 'MR' | 'MRS' | 'MS' | 'MSTR' | 'MISS';
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'M' | 'F' | '';
  nationality: string;
  passportNumber: string;
  passportExpiry: string;
  passportIssuingCountry: string;
  email: string;
  phone: string;
}

const EMPTY_FORM: CreateForm = {
  type: 'ADULT',
  title: 'MR',
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: '',
  nationality: '',
  passportNumber: '',
  passportExpiry: '',
  passportIssuingCountry: '',
  email: '',
  phone: '',
};

function CreatePassengerDialog({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (body: SavedPassengerCreate) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);

  function update<K extends keyof CreateForm>(key: K, value: CreateForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('First name and last name are required');
      return;
    }
    const body: SavedPassengerCreate = {
      type: form.type,
      title: form.title,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      dateOfBirth: form.dateOfBirth || undefined,
      gender: form.gender || undefined,
      nationality: form.nationality || undefined,
      passport:
        form.passportNumber && form.passportExpiry && form.passportIssuingCountry
          ? {
              number: form.passportNumber,
              expiry: form.passportExpiry,
              issuingCountry: form.passportIssuingCountry.toUpperCase(),
            }
          : undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
    };
    onSave(body);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add passenger</DialogTitle>
          <DialogClose />
        </DialogHeader>
        <DialogBody className="space-y-4">
          {/* Type + title */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => update('type', v as CreateForm['type'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADULT">Adult (12+)</SelectItem>
                  <SelectItem value="CHILD">Child (2–11)</SelectItem>
                  <SelectItem value="INFANT">Infant (under 2)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Select value={form.title} onValueChange={(v) => update('title', v as CreateForm['title'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['MR', 'MRS', 'MS', 'MSTR', 'MISS'] as const).map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Names */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First name *</Label>
              <Input
                value={form.firstName}
                onChange={(e) => update('firstName', e.target.value)}
                placeholder="As on ID"
              />
            </div>
            <div>
              <Label>Last name *</Label>
              <Input
                value={form.lastName}
                onChange={(e) => update('lastName', e.target.value)}
                placeholder="As on ID"
              />
            </div>
          </div>

          {/* DOB + gender */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date of birth</Label>
              <Input
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => update('dateOfBirth', e.target.value)}
              />
            </div>
            <div>
              <Label>Gender</Label>
              <Select value={form.gender || 'unset'} onValueChange={(v) => update('gender', v === 'unset' ? '' : (v as 'M' | 'F'))}>
                <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Not specified</SelectItem>
                  <SelectItem value="M">Male</SelectItem>
                  <SelectItem value="F">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Passport — optional, only for international fares */}
          <div className="rounded-md border border-dashed border-stroke-1 bg-surface-2/30 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Passport (optional — required for international fares)
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Number</Label>
                <Input
                  value={form.passportNumber}
                  onChange={(e) => update('passportNumber', e.target.value.toUpperCase())}
                  placeholder="A1234567"
                />
              </div>
              <div>
                <Label>Expiry</Label>
                <Input
                  type="date"
                  value={form.passportExpiry}
                  onChange={(e) => update('passportExpiry', e.target.value)}
                />
              </div>
              <div>
                <Label>Issuing country (ISO-2)</Label>
                <Input
                  value={form.passportIssuingCountry}
                  onChange={(e) => update('passportIssuingCountry', e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="IN"
                  maxLength={2}
                />
              </div>
            </div>
          </div>

          {/* Contact — optional */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="contact@example.com"
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="+91 9XXX-XXXXXX"
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            <Plus className="h-3.5 w-3.5" /> Save passenger
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
