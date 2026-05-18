'use client';

import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  CreateFareRuleRequestSchema,
  type CreateFareRuleRequest,
  type PublicFareRule,
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

interface BandsArrayProps {
  title: string;
  fields: ReturnType<typeof useFieldArray<CreateFareRuleRequest, 'cancellationBands'>>['fields'];
  append: () => void;
  remove: (index: number) => void;
  pathPrefix: 'cancellationBands' | 'reschedulingBands';
  register: ReturnType<typeof useForm<CreateFareRuleRequest>>['register'];
  setValue: ReturnType<typeof useForm<CreateFareRuleRequest>>['setValue'];
  watch: ReturnType<typeof useForm<CreateFareRuleRequest>>['watch'];
}

function BandsArray({ title, fields, append, remove, pathPrefix, register, setValue, watch }: BandsArrayProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink-2">{title}</h3>
        <Button type="button" size="sm" variant="ghost" onClick={append}>
          <Plus className="h-3.5 w-3.5" /> Add band
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="rounded-md border border-dashed bg-surface-2 px-3 py-4 text-center text-xs text-ink-3">
          No bands yet — add at least one to define this fee schedule.
        </p>
      ) : null}
      {fields.map((f, idx) => {
        const feeType = watch(`${pathPrefix}.${idx}.feeType` as const);
        return (
          <div key={f.id} className="space-y-2 rounded-md border bg-surface-2 p-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] text-ink-3">Band {idx + 1}</p>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => remove(idx)}
                aria-label="Remove band"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <FormField label="From (hours before)">
                <Input
                  type="number"
                  min="0"
                  {...register(`${pathPrefix}.${idx}.hoursBeforeFrom` as const, { valueAsNumber: true })}
                />
              </FormField>
              <FormField label="To (hours before)" hint="empty = ∞">
                <Input
                  type="number"
                  min="0"
                  {...register(`${pathPrefix}.${idx}.hoursBeforeTo` as const, {
                    setValueAs: (v) => (v === '' || v == null ? null : Number(v)),
                  })}
                />
              </FormField>
              <FormField label="Fee type">
                <Select
                  value={feeType}
                  onValueChange={(v) =>
                    setValue(
                      `${pathPrefix}.${idx}.feeType` as const,
                      v as 'FLAT' | 'PERCENT' | 'NON_REFUNDABLE',
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FLAT">FLAT</SelectItem>
                    <SelectItem value="PERCENT">PERCENT</SelectItem>
                    <SelectItem value="NON_REFUNDABLE">NON-REFUNDABLE</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              {feeType !== 'NON_REFUNDABLE' ? (
                <FormField
                  label={feeType === 'FLAT' ? 'Fee (paise)' : 'Fee (bp×100)'}
                  hint={feeType === 'PERCENT' ? '2500 = 25%' : undefined}
                >
                  <Input
                    type="number"
                    min="0"
                    {...register(`${pathPrefix}.${idx}.feeValue` as const, { valueAsNumber: true })}
                  />
                </FormField>
              ) : null}
              <FormField label="Description" className="col-span-3">
                <Input {...register(`${pathPrefix}.${idx}.description` as const)} />
              </FormField>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function FareRuleDrawer({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: PublicFareRule | null;
}) {
  const editing = !!target;

  const form = useForm<CreateFareRuleRequest>({
    resolver: zodResolver(CreateFareRuleRequestSchema),
    defaultValues: { cancellationBands: [], reschedulingBands: [], noShowFeePaise: 0 },
  });
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = form;

  const cancellation = useFieldArray({ control, name: 'cancellationBands' });
  const reschedule = useFieldArray({ control, name: 'reschedulingBands' });

  useEffect(() => {
    if (target) {
      reset({
        name: target.name,
        cancellationBands: target.cancellationBands,
        reschedulingBands: target.reschedulingBands,
        noShowFeePaise: target.noShowFeePaise,
        notes: target.notes ?? undefined,
      });
    } else if (!open) {
      reset({ cancellationBands: [], reschedulingBands: [], noShowFeePaise: 0 });
    }
  }, [target, open, reset]);

  const invalidate = useInvalidateOnSuccess([['fare-rules']]);
  const create = useApiMutation<CreateFareRuleRequest, PublicFareRule>(
    '/api/v1/fare-rules',
    'POST',
    {
      onSuccess: () => {
        toast.success('Fare rule created');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const update = useApiMutation<CreateFareRuleRequest, PublicFareRule>(
    () => `/api/v1/fare-rules/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Fare rule updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const submit = handleSubmit((v) => (editing ? update.mutate(v) : create.mutate(v)));

  const newBand = { hoursBeforeFrom: 0, hoursBeforeTo: null, feeType: 'PERCENT' as const, feeValue: 0 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[640px]">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${target?.name}` : 'New fare rule'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <DialogBody className="space-y-6">
            <FormField id="name" label="Name" required error={errors.name?.message}>
              <Input id="name" {...register('name')} />
            </FormField>

            <BandsArray
              title="Cancellation bands"
              fields={cancellation.fields}
              append={() => cancellation.append(newBand)}
              remove={cancellation.remove}
              pathPrefix="cancellationBands"
              register={register}
              setValue={setValue}
              watch={watch}
            />

            <Separator />

            <BandsArray
              title="Reschedule bands"
              fields={reschedule.fields}
              append={() => reschedule.append(newBand)}
              remove={reschedule.remove}
              pathPrefix="reschedulingBands"
              register={register}
              setValue={setValue}
              watch={watch}
            />

            <Separator />

            <FormField id="noShowFeePaise" label="No-show fee (paise)">
              <Input
                id="noShowFeePaise"
                type="number"
                min="0"
                {...register('noShowFeePaise', { valueAsNumber: true })}
              />
            </FormField>

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
