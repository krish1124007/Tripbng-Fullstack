'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useController,
  useFieldArray,
  useForm,
  type Control,
  type FieldPath,
  type UseFormReturn,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Plus, Trash2, Ban, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AIRLINES,
  CreateFareRuleRequestSchema,
  FARE_RULE_CABIN_TYPE,
  FARE_RULE_REFUND_TYPE,
  FARE_RULE_TRIP_TYPE,
  type CreateFareRuleRequest,
  type PublicFareRule,
} from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  PageHeader,
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
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';

type FormValues = CreateFareRuleRequest;
type Path = FieldPath<FormValues>;

// Radix Select can't hold an empty-string value, so "none" uses a sentinel.
const NONE = '__NONE__';

interface NamedRow {
  id: string;
  name: string;
  code?: string;
}

const EMPTY_RULE: FormValues = {
  name: '',
  tripType: 'ALL',
  cabinType: 'ALL',
  refundType: 'REFUNDABLE',
  status: 'ACTIVE',
  airline: '',
  sourceId: '',
  agencyGroupId: '',
  conditionAction: 'INCLUDE',
  scheduleFrom: null,
  scheduleTo: null,
  conditions: [],
  cancellationBands: [],
  reschedulingBands: [],
  noShowPenaltyPaise: 0,
  noShowAdditionalFeePaise: 0,
  notes: '',
};

const EMPTY_BAND = {
  fromHours: 0,
  toHours: null,
  percentage: 0,
  penaltyAmountPaise: 0,
  additionalFeePaise: 0,
};

const EMPTY_CONDITION = {
  origin: '',
  destination: '',
  fareType: '',
  bookingClass: '',
  fareBasis: '',
  sector: '',
  travelDate: null,
};

const TITLE_CASE: Record<string, string> = {
  ALL: 'All',
  ONEWAY: 'One-way',
  ROUNDTRIP: 'Round-trip',
  MULTICITY: 'Multi-city',
  ECONOMY: 'Economy',
  PREMIUM_ECONOMY: 'Premium Economy',
  BUSINESS: 'Business',
  FIRST: 'First',
  REFUNDABLE: 'Refundable',
  NON_REFUNDABLE: 'Non-refundable',
  PARTIAL: 'Partial',
};
const label = (v: string) => TITLE_CASE[v] ?? v;

// Convert a PublicFareRule (ISO date strings) into form values (Date | null).
function toFormValues(r: PublicFareRule): FormValues {
  return {
    name: r.name,
    tripType: r.tripType,
    cabinType: r.cabinType,
    refundType: r.refundType,
    status: r.status,
    airline: r.airline ?? '',
    sourceId: r.sourceId ?? '',
    agencyGroupId: r.agencyGroupId ?? '',
    conditionAction: r.conditionAction,
    scheduleFrom: r.scheduleFrom ? new Date(r.scheduleFrom) : null,
    scheduleTo: r.scheduleTo ? new Date(r.scheduleTo) : null,
    conditions: r.conditions.map((c) => ({
      ...c,
      travelDate: c.travelDate ? new Date(c.travelDate) : null,
    })),
    cancellationBands: r.cancellationBands,
    reschedulingBands: r.reschedulingBands,
    noShowPenaltyPaise: r.noShowPenaltyPaise,
    noShowAdditionalFeePaise: r.noShowAdditionalFeePaise,
    notes: r.notes ?? '',
  };
}

// ── Money input: stores paise, displays ₹ ──
function MoneyInput({ control, name }: { control: Control<FormValues>; name: Path }) {
  const { field } = useController({ control, name });
  const paise = typeof field.value === 'number' ? field.value : 0;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">
        ₹
      </span>
      <Input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        className="pl-7"
        value={paise ? String(paise / 100) : ''}
        onBlur={field.onBlur}
        onChange={(e) => {
          const v = e.target.value;
          field.onChange(v === '' ? 0 : Math.round(parseFloat(v) * 100));
        }}
      />
    </div>
  );
}

// ── datetime-local input bound to a Date | null field ──
function pad(n: number) {
  return String(n).padStart(2, '0');
}
function toLocalDateTime(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toLocalDate(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function DateTimeInput({ control, name }: { control: Control<FormValues>; name: Path }) {
  const { field } = useController({ control, name });
  return (
    <Input
      type="datetime-local"
      value={toLocalDateTime(field.value)}
      onBlur={field.onBlur}
      onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : null)}
    />
  );
}

function DateInput({ control, name }: { control: Control<FormValues>; name: Path }) {
  const { field } = useController({ control, name });
  return (
    <Input
      type="date"
      value={toLocalDate(field.value)}
      onBlur={field.onBlur}
      onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : null)}
    />
  );
}

// ── Policy band editor (cancellation / reschedule) ──
function PolicyBands({
  form,
  name,
  title,
  description,
}: {
  form: UseFormReturn<FormValues>;
  name: 'cancellationBands' | 'reschedulingBands';
  title: string;
  description: string;
}) {
  const { control, register } = form;
  const arr = useFieldArray({ control, name });
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-ink-1">{title}</h4>
          <p className="text-xs text-ink-3">{description}</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => arr.append({ ...EMPTY_BAND })}>
          <Plus className="h-3.5 w-3.5" /> Add band
        </Button>
      </div>

      {arr.fields.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-surface-2 px-3 py-5 text-center text-xs text-ink-3">
          No time bands yet. Add one to charge a fee based on hours before departure.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="hidden grid-cols-[1fr_1fr_1fr_1.2fr_1.2fr_auto] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-ink-3 md:grid">
            <span>From (hrs)</span>
            <span>To (hrs)</span>
            <span>Percentage</span>
            <span>Penalty</span>
            <span>Additional fee</span>
            <span />
          </div>
          {arr.fields.map((f, i) => (
            <div
              key={f.id}
              className="grid grid-cols-2 items-end gap-2 rounded-lg border bg-surface-1 p-2 md:grid-cols-[1fr_1fr_1fr_1.2fr_1.2fr_auto]"
            >
              <FormField label="From (hrs)" className="md:hidden">
                <Input type="number" min="0" {...register(`${name}.${i}.fromHours`, { valueAsNumber: true })} />
              </FormField>
              <Input
                type="number"
                min="0"
                className="hidden md:block"
                {...register(`${name}.${i}.fromHours`, { valueAsNumber: true })}
              />

              <FormField label="To (hrs)" hint="∞" className="md:hidden">
                <Input
                  type="number"
                  min="0"
                  placeholder="∞"
                  {...register(`${name}.${i}.toHours`, {
                    setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
                  })}
                />
              </FormField>
              <Input
                type="number"
                min="0"
                placeholder="∞"
                className="hidden md:block"
                {...register(`${name}.${i}.toHours`, {
                  setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
                })}
              />

              <FormField label="Percentage %" className="md:hidden">
                <Input type="number" min="0" max="100" {...register(`${name}.${i}.percentage`, { valueAsNumber: true })} />
              </FormField>
              <div className="relative hidden md:block">
                <Input type="number" min="0" max="100" className="pr-7" {...register(`${name}.${i}.percentage`, { valueAsNumber: true })} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">%</span>
              </div>

              <FormField label="Penalty (₹)" className="md:hidden">
                <MoneyInput control={control} name={`${name}.${i}.penaltyAmountPaise`} />
              </FormField>
              <div className="hidden md:block">
                <MoneyInput control={control} name={`${name}.${i}.penaltyAmountPaise`} />
              </div>

              <FormField label="Additional fee (₹)" className="md:hidden">
                <MoneyInput control={control} name={`${name}.${i}.additionalFeePaise`} />
              </FormField>
              <div className="hidden md:block">
                <MoneyInput control={control} name={`${name}.${i}.additionalFeePaise`} />
              </div>

              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Remove band"
                className="text-ink-3 hover:text-danger"
                onClick={() => arr.remove(i)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FareRuleForm({
  mode,
  initial,
  ruleId,
}: {
  mode: 'new' | 'edit';
  initial?: PublicFareRule;
  ruleId?: string;
}) {
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(CreateFareRuleRequestSchema),
    defaultValues: initial ? toFormValues(initial) : EMPTY_RULE,
  });
  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = form;

  const conditions = useFieldArray({ control, name: 'conditions' });
  const invalidate = useInvalidateOnSuccess([['fare-rules']]);

  // Dropdown data for the relation fields. Gated on permission so a non-admin
  // viewer doesn't fire 403s.
  const perms = useAuthStore((s) => s.user?.permissions ?? []);
  const suppliers = useApiPaginatedQuery<NamedRow>(['suppliers-lite'], '/api/v1/suppliers', {
    query: { limit: 200 },
    enabled: perms.includes('supplier:read'),
  });
  const agencyGroups = useApiPaginatedQuery<NamedRow>(['agency-groups-lite'], '/api/v1/agency-groups', {
    query: { limit: 200 },
    enabled: perms.includes('agency-group:read'),
  });
  const supplierRows = suppliers.data?.data ?? [];
  const agencyGroupRows = agencyGroups.data?.data ?? [];

  const create = useApiMutation<FormValues, PublicFareRule>('/api/v1/fare-rules', 'POST', {
    onSuccess: () => {
      toast.success('Fare rule created');
      invalidate();
      router.push('/fare-rules');
    },
    onError: (err) => toast.error(err.message),
  });
  const update = useApiMutation<FormValues, PublicFareRule>(
    () => `/api/v1/fare-rules/${ruleId}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Fare rule updated');
        invalidate();
        router.push('/fare-rules');
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const submit = handleSubmit(
    (v) => (mode === 'edit' ? update.mutate(v) : create.mutate(v)),
    () => toast.error('Please fix the highlighted fields'),
  );

  const status = watch('status');
  const conditionAction = watch('conditionAction');
  const saving = isSubmitting || create.isPending || update.isPending;

  return (
    <form onSubmit={submit} className="space-y-6 pb-24">
      <PageHeader
        eyebrow="Pricing"
        title={mode === 'edit' ? 'Edit fare rule' : 'Add fare rule'}
        description="Define cancellation, reschedule, and no-show charges and the fares they apply to."
        actions={
          <Link href="/fare-rules">
            <Button type="button" variant="ghost">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
        }
      />

      {/* ── General Info ── */}
      <Card>
        <CardHeader>
          <CardTitle>General info</CardTitle>
          <CardDescription>Name and scope of this fare rule.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <FormField id="name" label="Fare rule name" required error={errors.name?.message} className="md:col-span-2">
            <Input id="name" placeholder="e.g. 6E Domestic Saver — Cancellation" {...register('name')} />
          </FormField>

          <FormField label="Trip type" required>
            <Select value={watch('tripType')} onValueChange={(v) => setValue('tripType', v as FormValues['tripType'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FARE_RULE_TRIP_TYPE.map((t) => (
                  <SelectItem key={t} value={t}>
                    {label(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Cabin type" required>
            <Select value={watch('cabinType')} onValueChange={(v) => setValue('cabinType', v as FormValues['cabinType'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FARE_RULE_CABIN_TYPE.map((t) => (
                  <SelectItem key={t} value={t}>
                    {label(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Refund type" required>
            <Select value={watch('refundType')} onValueChange={(v) => setValue('refundType', v as FormValues['refundType'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FARE_RULE_REFUND_TYPE.map((t) => (
                  <SelectItem key={t} value={t}>
                    {label(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Status">
            <div className="flex h-10 items-center gap-3 rounded-md border bg-surface-1 px-3">
              <Switch
                checked={status === 'ACTIVE'}
                onCheckedChange={(c) => setValue('status', c ? 'ACTIVE' : 'INACTIVE')}
              />
              <span className={cn('text-sm font-medium', status === 'ACTIVE' ? 'text-success' : 'text-ink-3')}>
                {status === 'ACTIVE' ? 'Active' : 'Inactive'}
              </span>
            </div>
          </FormField>

          <FormField label="Airline">
            <Select
              value={watch('airline') ? String(watch('airline')) : NONE}
              onValueChange={(v) => setValue('airline', v === NONE ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any airline" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Any airline</SelectItem>
                {AIRLINES.map((a) => (
                  <SelectItem key={a.code} value={a.code}>
                    {a.name} ({a.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Source (supplier)">
            <Select
              value={watch('sourceId') ? String(watch('sourceId')) : NONE}
              onValueChange={(v) => setValue('sourceId', v === NONE ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={suppliers.isLoading ? 'Loading…' : 'Any source'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Any source</SelectItem>
                {supplierRows.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {s.code ? ` (${s.code})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Agency group">
            <Select
              value={watch('agencyGroupId') ? String(watch('agencyGroupId')) : NONE}
              onValueChange={(v) => setValue('agencyGroupId', v === NONE ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={agencyGroups.isLoading ? 'Loading…' : 'All agency groups'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All agency groups</SelectItem>
                {agencyGroupRows.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </CardContent>
      </Card>

      {/* ── Condition Fields ── */}
      <Card>
        <CardHeader>
          <CardTitle>Condition fields</CardTitle>
          <CardDescription>
            Which fares this rule matches. Leave a field blank to match any value.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <FormField label="Action">
              <div className="grid grid-cols-2 gap-1 rounded-md border bg-surface-2 p-1">
                {(['INCLUDE', 'EXCLUDE'] as const).map((a) => {
                  const active = conditionAction === a;
                  const Icon = a === 'INCLUDE' ? CheckCircle2 : Ban;
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setValue('conditionAction', a)}
                      className={cn(
                        'inline-flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-semibold transition-colors',
                        active
                          ? a === 'INCLUDE'
                            ? 'bg-success/15 text-success'
                            : 'bg-danger/15 text-danger'
                          : 'text-ink-3 hover:text-ink-1',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {a === 'INCLUDE' ? 'Include' : 'Exclude'}
                    </button>
                  );
                })}
              </div>
            </FormField>

            <FormField label="Schedule from" error={errors.scheduleFrom?.message as string | undefined}>
              <DateTimeInput control={control} name="scheduleFrom" />
            </FormField>
            <FormField label="Schedule to" error={errors.scheduleTo?.message as string | undefined}>
              <DateTimeInput control={control} name="scheduleTo" />
            </FormField>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-ink-1">Sectors &amp; fares</h4>
              <p className="text-xs text-ink-3">Add one or more matching conditions.</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => conditions.append({ ...EMPTY_CONDITION })}
            >
              <Plus className="h-3.5 w-3.5" /> Add condition
            </Button>
          </div>

          {conditions.fields.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-surface-2 px-3 py-5 text-center text-xs text-ink-3">
              No conditions — this rule applies to all sectors and fares within the scope above.
            </p>
          ) : (
            <div className="space-y-3">
              {conditions.fields.map((f, i) => (
                <div key={f.id} className="rounded-lg border bg-surface-1 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <Badge variant="outline">Condition {i + 1}</Badge>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Remove condition"
                      className="text-ink-3 hover:text-danger"
                      onClick={() => conditions.remove(i)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                    <FormField label="Origin">
                      <Input maxLength={3} placeholder="DEL" {...register(`conditions.${i}.origin`)} />
                    </FormField>
                    <FormField label="Destination">
                      <Input maxLength={3} placeholder="BOM" {...register(`conditions.${i}.destination`)} />
                    </FormField>
                    <FormField label="Sector">
                      <Input placeholder="DEL-BOM" {...register(`conditions.${i}.sector`)} />
                    </FormField>
                    <FormField label="Travel date">
                      <DateInput control={control} name={`conditions.${i}.travelDate`} />
                    </FormField>
                    <FormField label="Fare type">
                      <Input placeholder="Published / SME" {...register(`conditions.${i}.fareType`)} />
                    </FormField>
                    <FormField label="Booking class">
                      <Input maxLength={8} placeholder="Y / M / Q" {...register(`conditions.${i}.bookingClass`)} />
                    </FormField>
                    <FormField label="Fare basis">
                      <Input placeholder="QOWIP" {...register(`conditions.${i}.fareBasis`)} />
                    </FormField>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Fare Rule Info ── */}
      <Card>
        <CardHeader>
          <CardTitle>Fare rule info</CardTitle>
          <CardDescription>Penalties applied for cancellation, reschedule, and no-show.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <PolicyBands
            form={form}
            name="cancellationBands"
            title="Cancellation policy"
            description="Penalties applied when a passenger cancels their booking."
          />
          <Separator />
          <PolicyBands
            form={form}
            name="reschedulingBands"
            title="Reschedule policy"
            description="Fees for modifying existing bookings before departure."
          />
          <Separator />
          <div>
            <h4 className="text-sm font-semibold text-ink-1">No show</h4>
            <p className="mb-3 text-xs text-ink-3">
              Fees applied when a passenger fails to show up for the flight.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 md:max-w-md">
              <FormField label="Penalty amount (₹)">
                <MoneyInput control={control} name="noShowPenaltyPaise" />
              </FormField>
              <FormField label="Additional fee (₹)">
                <MoneyInput control={control} name="noShowAdditionalFeePaise" />
              </FormField>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Additional Info ── */}
      <Card>
        <CardHeader>
          <CardTitle>Additional info</CardTitle>
          <CardDescription>General conditions and additional descriptions.</CardDescription>
        </CardHeader>
        <CardContent>
          <FormField label="Notes" error={errors.notes?.message as string | undefined}>
            <Textarea rows={4} placeholder="Free-text terms shown to agents…" {...register('notes')} />
          </FormField>
        </CardContent>
      </Card>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-surface-1/95 backdrop-blur md:left-[var(--sidebar-w,16rem)]">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3 px-6 py-3">
          <Link href="/fare-rules">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create fare rule'}
          </Button>
        </div>
      </div>
    </form>
  );
}
