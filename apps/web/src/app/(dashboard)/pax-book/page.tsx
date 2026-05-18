'use client';

import { useMemo, useState } from 'react';
import {
  Baby,
  Calendar as CalendarIcon,
  Download,
  Mail,
  Phone,
  Plus,
  Search,
  Tag,
  Trash2,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogClose,
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
import {
  usePaxBook,
  type PaxRecord,
  type PaxTitle,
  type PaxType,
  type PaxGender,
} from '@/lib/pax-book';
import { cn } from '@/lib/utils';

type FilterType = 'all' | PaxType;

const TITLES: PaxTitle[] = ['MR', 'MRS', 'MS', 'MSTR', 'MISS'];
const TYPES: { value: PaxType; label: string }[] = [
  { value: 'ADULT', label: 'Adult (12+)' },
  { value: 'CHILD', label: 'Child (2–11)' },
  { value: 'INFANT', label: 'Infant (<2)' },
];
const GENDERS: { value: PaxGender; label: string }[] = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Prefer not to say' },
];
const NATIONALITIES = [
  { value: 'IN', label: '🇮🇳 India' },
  { value: 'NP', label: '🇳🇵 Nepal' },
  { value: 'LK', label: '🇱🇰 Sri Lanka' },
  { value: 'BD', label: '🇧🇩 Bangladesh' },
  { value: 'AE', label: '🇦🇪 UAE' },
  { value: 'GB', label: '🇬🇧 United Kingdom' },
  { value: 'US', label: '🇺🇸 United States' },
];
const COMMON_TAGS = ['Family', 'VIP', 'Frequent flier', 'Corporate', 'Group A', 'Group B'];

export default function PaxBookPage() {
  const { records, upsert, remove } = usePaxBook();
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [editing, setEditing] = useState<PaxRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Derive available tags from existing records.
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => r.tags?.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [records]);

  const filtered = useMemo(() => {
    let list = [...records];
    if (q.trim()) {
      const lower = q.toLowerCase();
      list = list.filter(
        (r) =>
          `${r.firstName} ${r.lastName}`.toLowerCase().includes(lower) ||
          r.email?.toLowerCase().includes(lower) ||
          r.phone?.toLowerCase().includes(lower) ||
          r.passportNumber?.toLowerCase().includes(lower),
      );
    }
    if (typeFilter !== 'all') list = list.filter((r) => r.type === typeFilter);
    if (tagFilter !== 'all') list = list.filter((r) => r.tags?.includes(tagFilter));
    return list;
  }, [records, q, typeFilter, tagFilter]);

  const stats = useMemo(
    () => ({
      total: records.length,
      adults: records.filter((r) => r.type === 'ADULT').length,
      children: records.filter((r) => r.type === 'CHILD').length,
      infants: records.filter((r) => r.type === 'INFANT').length,
    }),
    [records],
  );

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.error('Nothing to export');
      return;
    }
    const cols = [
      'title',
      'firstName',
      'lastName',
      'type',
      'gender',
      'dob',
      'nationality',
      'passportNumber',
      'passportExpiry',
      'email',
      'phone',
      'tags',
      'createdAt',
    ] as const;
    const head = cols.join(',');
    const body = filtered
      .map((r) =>
        cols
          .map((c) => {
            const v = c === 'tags' ? (r.tags ?? []).join('|') : (r[c] ?? '');
            return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
          })
          .join(','),
      )
      .join('\n');
    const csv = `${head}\n${body}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pax-book-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} record${filtered.length === 1 ? '' : 's'}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operate · Pax book"
        title="Saved passengers"
        description="Auto-fill names, passports, and contact details on every booking. Tag passengers by family, VIP, or group for one-click multi-pax bookings."
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Add passenger
            </Button>
          </>
        }
      />

      {/* Quick stats */}
      <section className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Total" value={stats.total} icon={Users} tone="brand" />
        <StatTile label="Adults" value={stats.adults} icon={UserIcon} />
        <StatTile label="Children" value={stats.children} icon={UserIcon} />
        <StatTile label="Infants" value={stats.infants} icon={Baby} />
      </section>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface-1 p-2">
        <Input
          placeholder="Search name, email, phone, passport"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          leading={<Search className="h-4 w-4" strokeWidth={1.75} />}
          className="h-8 w-full max-w-sm"
          fullWidth={false}
        />
        <div className="mx-1 h-5 w-px bg-border" />
        <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} label="All types" />
        <FilterChip active={typeFilter === 'ADULT'} onClick={() => setTypeFilter('ADULT')} label="Adults" />
        <FilterChip active={typeFilter === 'CHILD'} onClick={() => setTypeFilter('CHILD')} label="Children" />
        <FilterChip active={typeFilter === 'INFANT'} onClick={() => setTypeFilter('INFANT')} label="Infants" />
        {availableTags.length > 0 ? (
          <>
            <div className="mx-1 h-5 w-px bg-border" />
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger className="h-8 w-[160px]">
                <Tag className="h-3.5 w-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tags</SelectItem>
                {availableTags.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : null}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        records.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No saved passengers yet"
            description="Add your most-frequent travellers and they'll auto-fill on every booking. Tag by family or group for 2-click multi-pax bookings."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Add your first passenger
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Search}
            title="No passengers match your filters"
            description="Try a different search term or clear filters."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQ('');
                  setTypeFilter('all');
                  setTagFilter('all');
                }}
              >
                Clear filters
              </Button>
            }
          />
        )
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y">
            {filtered.map((r) => (
              <PaxRow
                key={r.id}
                r={r}
                onEdit={() => setEditing(r)}
                onDelete={() => {
                  remove(r.id);
                  toast.success(`Removed ${r.firstName} ${r.lastName}`);
                }}
              />
            ))}
          </ul>
        </Card>
      )}

      {/* Create / Edit dialog */}
      {createOpen ? (
        <PaxDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSave={(rec) => {
            upsert(rec);
            setCreateOpen(false);
            toast.success(`${rec.firstName} ${rec.lastName} saved`);
          }}
        />
      ) : null}
      {editing ? (
        <PaxDialog
          open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)}
          existing={editing}
          onSave={(rec) => {
            upsert({ ...rec, id: editing.id });
            setEditing(null);
            toast.success(`${rec.firstName} ${rec.lastName} updated`);
          }}
        />
      ) : null}
    </div>
  );
}

// ────────── Sub-components ──────────

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tone?: 'brand';
}) {
  return (
    <Card tone={tone === 'brand' ? 'brand' : 'default'}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <p className={cn('eyebrow', tone === 'brand' ? 'text-brand-700 dark:text-brand-300' : 'text-ink-3')}>
            {label}
          </p>
          <span
            className={cn(
              'grid h-8 w-8 place-items-center rounded-md',
              tone === 'brand'
                ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300'
                : 'bg-surface-2 text-ink-3',
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
        </div>
        <p className="mt-2 text-2xl font-bold tabular-nums text-ink-1">{value}</p>
      </CardContent>
    </Card>
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

function PaxRow({
  r,
  onEdit,
  onDelete,
}: {
  r: PaxRecord;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const initials = `${r.firstName[0] ?? ''}${r.lastName[0] ?? ''}`.toUpperCase();
  const passportExpired =
    r.passportExpiry && new Date(r.passportExpiry).getTime() < Date.now();
  const passportSoon =
    r.passportExpiry &&
    new Date(r.passportExpiry).getTime() - Date.now() < 180 * 24 * 3600 * 1000;
  return (
    <li className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white">
        {initials || '–'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-ink-1">
            {r.title} {r.firstName} {r.lastName}
          </p>
          <Badge
            variant={r.type === 'ADULT' ? 'brand' : r.type === 'CHILD' ? 'accent' : 'neutral'}
            className="text-[10px]"
          >
            {r.type}
          </Badge>
          {r.tags?.map((t) => (
            <Badge key={t} variant="outline" className="text-[10px]">
              {t}
            </Badge>
          ))}
          {passportExpired ? (
            <Badge variant="danger" dot pulse className="text-[10px]">
              Passport expired
            </Badge>
          ) : passportSoon ? (
            <Badge variant="warning" className="text-[10px]">
              Passport expiring &lt;6 mo
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-3">
          {r.passportNumber ? (
            <span className="font-mono">PP {r.passportNumber}</span>
          ) : null}
          {r.dob ? (
            <span className="inline-flex items-center gap-1 font-mono">
              <CalendarIcon className="h-3 w-3" /> {r.dob}
            </span>
          ) : null}
          {r.email ? (
            <span className="inline-flex items-center gap-1 truncate">
              <Mail className="h-3 w-3" /> {r.email}
            </span>
          ) : null}
          {r.phone ? (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" /> {r.phone}
            </span>
          ) : null}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit}>
        Edit
      </Button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${r.firstName} ${r.lastName}`}
        className="grid h-8 w-8 place-items-center rounded-md text-ink-3 opacity-0 transition-all group-hover:opacity-100 hover:bg-danger-soft hover:text-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function PaxDialog({
  open,
  onOpenChange,
  existing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing?: PaxRecord;
  onSave: (rec: Omit<PaxRecord, 'id' | 'createdAt'>) => void;
}) {
  const [title, setTitle] = useState<PaxTitle>(existing?.title ?? 'MR');
  const [firstName, setFirstName] = useState(existing?.firstName ?? '');
  const [lastName, setLastName] = useState(existing?.lastName ?? '');
  const [type, setType] = useState<PaxType>(existing?.type ?? 'ADULT');
  const [gender, setGender] = useState<PaxGender>(existing?.gender ?? 'MALE');
  const [dob, setDob] = useState(existing?.dob ?? '');
  const [nationality, setNationality] = useState(existing?.nationality ?? 'IN');
  const [passportNumber, setPassportNumber] = useState(existing?.passportNumber ?? '');
  const [passportExpiry, setPassportExpiry] = useState(existing?.passportExpiry ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [tagInput, setTagInput] = useState('');

  const addTag = (t: string) => {
    const trimmed = t.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    setTags([...tags, trimmed]);
    setTagInput('');
  };

  const onSubmit = () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error('First and last name are required');
      return;
    }
    onSave({
      title,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      type,
      gender,
      dob: dob || undefined,
      nationality: nationality || undefined,
      passportNumber: passportNumber.trim() || undefined,
      passportExpiry: passportExpiry || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      tags,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{existing ? 'Edit passenger' : 'Add passenger'}</DialogTitle>
        <DialogClose />
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[100px_1fr_1fr]">
          <div className="space-y-1.5">
            <Label className="eyebrow text-ink-3">Title</Label>
            <Select value={title} onValueChange={(v) => setTitle(v as PaxTitle)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TITLES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="firstName" className="eyebrow text-ink-3">First name *</Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="As on passport"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName" className="eyebrow text-ink-3">Last name *</Label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="As on passport"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="eyebrow text-ink-3">Pax type</Label>
            <Select value={type} onValueChange={(v) => setType(v as PaxType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="eyebrow text-ink-3">Gender</Label>
            <Select value={gender} onValueChange={(v) => setGender(v as PaxGender)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENDERS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dob" className="eyebrow text-ink-3">Date of birth</Label>
            <Input
              id="dob"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              leading={<CalendarIcon className="h-4 w-4" strokeWidth={1.75} />}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="eyebrow text-ink-3">Nationality</Label>
            <Select value={nationality} onValueChange={setNationality}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NATIONALITIES.map((n) => (
                  <SelectItem key={n.value} value={n.value}>
                    {n.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="passportNumber" className="eyebrow text-ink-3">Passport number</Label>
            <Input
              id="passportNumber"
              value={passportNumber}
              onChange={(e) => setPassportNumber(e.target.value)}
              placeholder="Z1234567"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="passportExpiry" className="eyebrow text-ink-3">Passport expiry</Label>
            <Input
              id="passportExpiry"
              type="date"
              value={passportExpiry}
              onChange={(e) => setPassportExpiry(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="eyebrow text-ink-3">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="traveller@email.com"
              leading={<Mail className="h-4 w-4" strokeWidth={1.75} />}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="eyebrow text-ink-3">Phone</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 9876 543210"
              leading={<Phone className="h-4 w-4" strokeWidth={1.75} />}
            />
          </div>
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <Label className="eyebrow text-ink-3">Tags</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full border bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
              >
                {t}
                <button
                  type="button"
                  onClick={() => setTags(tags.filter((x) => x !== t))}
                  className="text-brand-700 hover:text-brand-900"
                  aria-label={`Remove ${t}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              placeholder="Add tag…"
              className="h-7 w-32 text-xs"
              fullWidth={false}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {COMMON_TAGS.filter((t) => !tags.includes(t)).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => addTag(t)}
                className="rounded-full border bg-surface-1 px-2 py-0.5 text-[10px] text-ink-3 hover:border-brand-300 hover:text-brand-700"
              >
                + {t}
              </button>
            ))}
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={onSubmit}>{existing ? 'Save changes' : 'Add passenger'}</Button>
      </DialogFooter>
    </Dialog>
  );
}
