'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useFieldArray,
  useForm,
  type UseFormReturn,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  CreatePolicyRequestSchema,
  POLICY_COMPONENTS,
  POLICY_COMPONENT_LABEL,
  POLICY_PRODUCT_TYPE,
  type CreatePolicyRequest,
  type PolicyComponentKey,
  type PublicPolicy,
} from '@tripbng/shared';
import {
  Button,
  Card,
  CardContent,
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
  Switch,
} from '@/components/ui';
import { useApiMutation, useInvalidateOnSuccess } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type FormValues = CreatePolicyRequest;

const PRODUCT_LABEL: Record<string, string> = {
  AIR: 'Air',
  HOTEL: 'Hotel',
  BUS: 'Bus',
  HOLIDAY: 'Holiday',
  INSURANCE: 'Insurance',
};

// Per-component copy for the editor card.
const COMPONENT_COPY: Record<
  PolicyComponentKey,
  { nameLabel: string; valueLabel: string; defaultUnit: 'PERCENT' | 'FLAT' }
> = {
  commission: { nameLabel: 'Commission Name', valueLabel: 'Commission Payout', defaultUnit: 'PERCENT' },
  plb: { nameLabel: 'PLB Name', valueLabel: 'PLB Payout', defaultUnit: 'PERCENT' },
  b2bMarkup: { nameLabel: 'Markup Name', valueLabel: 'Markup Value', defaultUnit: 'FLAT' },
  managementFee: { nameLabel: 'Fee Name', valueLabel: 'Fee Amount', defaultUnit: 'FLAT' },
};

const emptyComponent = (unit: 'PERCENT' | 'FLAT' = 'PERCENT') => ({
  enabled: false,
  name: '',
  valueType: unit,
  value: 0,
  morePayout: false,
  extraPayouts: [],
});

const EMPTY_POLICY: FormValues = {
  productType: 'AIR',
  name: '',
  status: 'ACTIVE',
  commission: emptyComponent('PERCENT'),
  plb: emptyComponent('PERCENT'),
  b2bMarkup: emptyComponent('FLAT'),
  managementFee: { ...emptyComponent('FLAT'), hideManagementFee: false },
  notes: '',
  gstOnMarkupOnly: false,
  gstRateBasisPoints: 1800,
};

function toFormValues(p: PublicPolicy): FormValues {
  return {
    productType: p.productType,
    name: p.name,
    status: p.status,
    commission: p.commission,
    plb: p.plb,
    b2bMarkup: p.b2bMarkup,
    managementFee: p.managementFee,
    notes: p.notes ?? '',
    gstOnMarkupOnly: p.gstOnMarkupOnly,
    gstRateBasisPoints: p.gstRateBasisPoints,
  };
}

// Unit selector (% / ₹) bound to a component's valueType.
function UnitSelect({
  value,
  onChange,
}: {
  value: 'PERCENT' | 'FLAT';
  onChange: (v: 'PERCENT' | 'FLAT') => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as 'PERCENT' | 'FLAT')}>
      <SelectTrigger className="w-20">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="PERCENT">%</SelectItem>
        <SelectItem value="FLAT">₹</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ComponentEditor({
  form,
  componentKey,
}: {
  form: UseFormReturn<FormValues>;
  componentKey: PolicyComponentKey;
}) {
  const { register, watch, setValue, control } = form;
  const copy = COMPONENT_COPY[componentKey];
  const enabled = watch(`${componentKey}.enabled`);
  const valueType = watch(`${componentKey}.valueType`);
  const morePayout = watch(`${componentKey}.morePayout`);
  const extra = useFieldArray({ control, name: `${componentKey}.extraPayouts` });

  return (
    <div className={cn('space-y-4', !enabled && 'opacity-60')}>
      {!enabled ? (
        <div className="flex items-center justify-between rounded-lg border border-dashed bg-surface-2 px-4 py-3 text-sm text-ink-3">
          <span>
            {POLICY_COMPONENT_LABEL[componentKey]} is turned off. Enable its checkbox above to configure it.
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setValue(`${componentKey}.enabled`, true)}
          >
            Enable
          </Button>
        </div>
      ) : null}

      <div className="grid items-end gap-4 md:grid-cols-[1fr_1fr_auto]">
        <FormField label={`${copy.nameLabel}`} required>
          <Input placeholder={copy.nameLabel} {...register(`${componentKey}.name`)} />
        </FormField>

        <FormField label={copy.valueLabel} required>
          <div className="flex gap-2">
            <Input
              type="number"
              min="0"
              step="0.01"
              className="flex-1"
              {...register(`${componentKey}.value`, { valueAsNumber: true })}
            />
            <UnitSelect
              value={(valueType as 'PERCENT' | 'FLAT') ?? copy.defaultUnit}
              onChange={(v) => setValue(`${componentKey}.valueType`, v)}
            />
          </div>
        </FormField>

        <div className="flex items-center gap-2 pb-2">
          <span className="text-sm font-medium text-ink-2">More Payout</span>
          <Switch
            checked={!!morePayout}
            onCheckedChange={(c) => setValue(`${componentKey}.morePayout`, c)}
          />
        </div>
      </div>

      {componentKey === 'managementFee' ? (
        <label className="flex w-fit items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-ink-4 accent-accent"
            {...register('managementFee.hideManagementFee')}
          />
          Hide Management Fee (don&apos;t show to agent)
        </label>
      ) : null}

      {morePayout ? (
        <div className="space-y-2 rounded-lg border bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Additional payouts
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => extra.append({ label: '', valueType: copy.defaultUnit, value: 0 })}
            >
              <Plus className="h-3.5 w-3.5" /> Add payout
            </Button>
          </div>
          {extra.fields.length === 0 ? (
            <p className="px-1 py-2 text-center text-xs text-ink-3">No additional payouts added.</p>
          ) : (
            extra.fields.map((f, i) => (
              <div key={f.id} className="grid items-center gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
                <Input placeholder="Label (e.g. Distributor)" {...register(`${componentKey}.extraPayouts.${i}.label`)} />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Value"
                  {...register(`${componentKey}.extraPayouts.${i}.value`, { valueAsNumber: true })}
                />
                <UnitSelect
                  value={(watch(`${componentKey}.extraPayouts.${i}.valueType`) as 'PERCENT' | 'FLAT') ?? 'PERCENT'}
                  onChange={(v) => setValue(`${componentKey}.extraPayouts.${i}.valueType`, v)}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Remove payout"
                  className="text-ink-3 hover:text-danger"
                  onClick={() => extra.remove(i)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function PolicyForm({
  mode,
  initial,
  policyId,
}: {
  mode: 'new' | 'edit';
  initial?: PublicPolicy;
  policyId?: string;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<PolicyComponentKey>('commission');

  const form = useForm<FormValues>({
    resolver: zodResolver(CreatePolicyRequestSchema),
    defaultValues: initial ? toFormValues(initial) : EMPTY_POLICY,
  });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = form;

  const invalidate = useInvalidateOnSuccess([['policies']]);
  const create = useApiMutation<FormValues, PublicPolicy>('/api/v1/policies', 'POST', {
    onSuccess: () => {
      toast.success('Policy created');
      invalidate();
      router.push('/policies');
    },
    onError: (err) => toast.error(err.message),
  });
  const update = useApiMutation<FormValues, PublicPolicy>(
    () => `/api/v1/policies/${policyId}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Policy updated');
        invalidate();
        router.push('/policies');
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const submit = handleSubmit(
    (v) => (mode === 'edit' ? update.mutate(v) : create.mutate(v)),
    () => toast.error('Please fix the highlighted fields'),
  );

  const saving = isSubmitting || create.isPending || update.isPending;

  return (
    <form onSubmit={submit} className="space-y-6 pb-24">
      <PageHeader
        eyebrow="Manage Policy"
        title={mode === 'edit' ? 'Edit policy' : 'Create policy'}
        description="Bundle commission, PLB, B2B markup, and management-fee payouts into a policy."
        actions={
          <Link href="/policies">
            <Button type="button" variant="ghost">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
        }
      />

      {/* General Info */}
      <Card>
        <CardHeader>
          <CardTitle>General info</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <FormField label="Product type" required>
            <Select value={watch('productType')} onValueChange={(v) => setValue('productType', v as FormValues['productType'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLICY_PRODUCT_TYPE.map((t) => (
                  <SelectItem key={t} value={t}>
                    {PRODUCT_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Policy name" required error={errors.name?.message}>
            <Input placeholder="e.g. TRIPJACK INT" {...register('name')} />
          </FormField>
        </CardContent>
      </Card>

      {/* Components */}
      <Card>
        <CardHeader>
          <CardTitle>Payout components</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Enable checkboxes */}
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {POLICY_COMPONENTS.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm font-medium text-ink-1">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-ink-4 accent-accent"
                  checked={!!watch(`${key}.enabled`)}
                  onChange={(e) => {
                    setValue(`${key}.enabled`, e.target.checked);
                    if (e.target.checked) setActiveTab(key);
                  }}
                />
                {POLICY_COMPONENT_LABEL[key]}
              </label>
            ))}
          </div>

          {/* Tab pills */}
          <div className="flex flex-wrap gap-2">
            {POLICY_COMPONENTS.map((key) => {
              const active = activeTab === key;
              const on = !!watch(`${key}.enabled`);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-semibold transition-colors',
                    active
                      ? 'border-accent bg-accent text-white'
                      : 'border-border bg-surface-1 text-ink-2 hover:border-accent/60',
                  )}
                >
                  {POLICY_COMPONENT_LABEL[key]}
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      on ? 'bg-success' : active ? 'bg-white/50' : 'bg-ink-4/40',
                    )}
                  />
                </button>
              );
            })}
          </div>

          {/* Active editor */}
          <div className="rounded-lg border bg-surface-1 p-4">
            <ComponentEditor form={form} componentKey={activeTab} />
          </div>
        </CardContent>
      </Card>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-surface-1/95 backdrop-blur md:left-[var(--sidebar-w,16rem)]">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3 px-6 py-3">
          <Link href="/policies">
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Submit'}
          </Button>
        </div>
      </div>
    </form>
  );
}
