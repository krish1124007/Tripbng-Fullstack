'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  CreateMarkupRuleRequestSchema,
  MARKUP_SCOPE,
  MARKUP_STATUS,
  MARKUP_VALUE_TYPE,
  PAX_TYPE,
  TRAVEL_CLASS,
  TRAVEL_TYPE,
  type CreateMarkupRuleRequest,
  type PublicMarkupRule,
} from '@tripbng/shared';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DrawerContent,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Textarea,
} from '@/components/ui';
import { useApiMutation, useInvalidateOnSuccess } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';

function CSVInput({
  value,
  onChange,
  placeholder,
  uppercase = true,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  uppercase?: boolean;
}) {
  return (
    <Input
      value={value.join(', ')}
      placeholder={placeholder}
      onChange={(e) => {
        const parsed = e.target.value
          .split(/[\s,]+/)
          .map((s) => (uppercase ? s.trim().toUpperCase() : s.trim()))
          .filter(Boolean);
        onChange(parsed);
      }}
      className={uppercase ? 'font-mono uppercase' : undefined}
    />
  );
}

function PillToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <button
            type="button"
            key={opt}
            onClick={() =>
              onChange(active ? value.filter((v) => v !== opt) : [...value, opt])
            }
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium font-mono transition',
              active
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border bg-surface-2 text-ink-2 hover:bg-surface-1',
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function MarkupRuleDrawer({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: PublicMarkupRule | null;
}) {
  const editing = !!target;
  const me = useAuthStore((s) => s.user);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateMarkupRuleRequest>({
    resolver: zodResolver(CreateMarkupRuleRequestSchema),
    defaultValues: {
      scope: me?.role === 'AGENCY' ? 'AGENCY' : me?.role === 'DISTRIBUTOR' ? 'DISTRIBUTOR' : 'PLATFORM',
      valueType: 'FLAT',
      priority: 100,
      status: 'ACTIVE',
      conditions: {},
    },
  });

  const scope = watch('scope');
  const valueType = watch('valueType');
  const status = watch('status');
  const conditions = watch('conditions') ?? {};

  useEffect(() => {
    if (target) {
      reset({
        name: target.name,
        scope: target.scope,
        distributorId: target.distributorId ?? undefined,
        agencyId: target.agencyId ?? undefined,
        valueType: target.valueType,
        value: target.value,
        maxValuePaise: target.maxValuePaise ?? undefined,
        priority: target.priority,
        status: target.status,
        conditions: target.conditions,
        notes: target.notes ?? undefined,
      });
    } else if (!open) {
      reset();
    }
  }, [target, open, reset]);

  const invalidate = useInvalidateOnSuccess([['markup-rules']]);
  const create = useApiMutation<CreateMarkupRuleRequest, PublicMarkupRule>(
    '/api/v1/markup-rules',
    'POST',
    {
      onSuccess: () => {
        toast.success('Rule created');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const update = useApiMutation<CreateMarkupRuleRequest, PublicMarkupRule>(
    () => `/api/v1/markup-rules/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Rule updated');
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
          <DialogTitle>{editing ? `Edit ${target?.name}` : 'New markup rule'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <DialogBody className="space-y-5">
            <FormField id="name" label="Rule name" required error={errors.name?.message}>
              <Input id="name" {...register('name')} />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField id="scope" label="Scope" required>
                <Select
                  value={scope}
                  onValueChange={(v) => setValue('scope', v as CreateMarkupRuleRequest['scope'])}
                  disabled={!!editing || me?.role !== 'SUPER_ADMIN'}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKUP_SCOPE.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField id="status" label="Status">
                <Select
                  value={status}
                  onValueChange={(v) => setValue('status', v as CreateMarkupRuleRequest['status'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKUP_STATUS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <FormField id="valueType" label="Value type" required>
                <Select
                  value={valueType}
                  onValueChange={(v) => setValue('valueType', v as CreateMarkupRuleRequest['valueType'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKUP_VALUE_TYPE.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField
                id="value"
                label={valueType === 'FLAT' ? 'Value (paise)' : 'Value (bp×100)'}
                hint={valueType === 'PERCENT' ? '250 = 2.50%' : '100000 = ₹1000'}
                required
                error={errors.value?.message}
              >
                <Input id="value" type="number" min="0" {...register('value', { valueAsNumber: true })} />
              </FormField>
              <FormField id="priority" label="Priority" hint="Lower wins">
                <Input
                  id="priority"
                  type="number"
                  min="0"
                  {...register('priority', { valueAsNumber: true })}
                />
              </FormField>
              {valueType === 'PERCENT' ? (
                <FormField id="maxValuePaise" label="Cap (paise)" className="col-span-3">
                  <Input
                    id="maxValuePaise"
                    type="number"
                    min="0"
                    {...register('maxValuePaise', {
                      setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                    })}
                  />
                </FormField>
              ) : null}
            </div>

            <Separator />
            <h3 className="text-sm font-medium text-ink-2">Conditions</h3>
            <p className="text-xs text-ink-3">
              All populated fields must match. Empty = no constraint.
            </p>

            <FormField label="Airlines (IATA, comma-separated)">
              <CSVInput
                value={conditions.airlines ?? []}
                onChange={(v) => setValue('conditions.airlines', v)}
                placeholder="6E, AI, SG"
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Travel type">
                <Select
                  value={conditions.travelType ?? '__any__'}
                  onValueChange={(v) =>
                    setValue('conditions.travelType', v === '__any__' ? undefined : (v as 'DOMESTIC' | 'INTERNATIONAL'))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any</SelectItem>
                    {TRAVEL_TYPE.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Class">
                <Select
                  value={conditions.travelClass ?? '__any__'}
                  onValueChange={(v) =>
                    setValue(
                      'conditions.travelClass',
                      v === '__any__' ? undefined : (v as (typeof TRAVEL_CLASS)[number]),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Any</SelectItem>
                    {TRAVEL_CLASS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <FormField label="Pax types">
              <PillToggle
                options={PAX_TYPE}
                value={conditions.paxTypes ?? []}
                onChange={(v) => setValue('conditions.paxTypes', v)}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Origins">
                <CSVInput
                  value={conditions.origins ?? []}
                  onChange={(v) => setValue('conditions.origins', v)}
                  placeholder="BOM, DEL"
                />
              </FormField>
              <FormField label="Destinations">
                <CSVInput
                  value={conditions.destinations ?? []}
                  onChange={(v) => setValue('conditions.destinations', v)}
                  placeholder="GOI, BLR"
                />
              </FormField>
              <FormField label="Effective from">
                <Input
                  type="date"
                  value={
                    conditions.effectiveFrom
                      ? new Date(conditions.effectiveFrom).toISOString().slice(0, 10)
                      : ''
                  }
                  onChange={(e) =>
                    setValue(
                      'conditions.effectiveFrom',
                      e.target.value ? new Date(e.target.value) : undefined,
                    )
                  }
                />
              </FormField>
              <FormField label="Effective to">
                <Input
                  type="date"
                  value={
                    conditions.effectiveTo
                      ? new Date(conditions.effectiveTo).toISOString().slice(0, 10)
                      : ''
                  }
                  onChange={(e) =>
                    setValue(
                      'conditions.effectiveTo',
                      e.target.value ? new Date(e.target.value) : undefined,
                    )
                  }
                />
              </FormField>
            </div>

            <Separator />
            <FormField id="notes" label="Notes">
              <Textarea id="notes" rows={2} {...register('notes')} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || create.isPending || update.isPending}>
              {create.isPending || update.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create rule'}
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
