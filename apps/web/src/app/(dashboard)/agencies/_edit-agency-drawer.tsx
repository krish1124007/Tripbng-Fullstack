'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  AGENCY_STATUS,
  SetCreditLimitRequestSchema,
  UpdateAgencyRequestSchema,
  type PublicAgency,
  type SetCreditLimitRequest,
  type UpdateAgencyRequest,
} from '@tripbng/shared';
import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DrawerContent,
  FormField,
  Input,
  KeyValue,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@/components/ui';
import { Can } from '@/components/can';
import { useApiMutation, useInvalidateOnSuccess } from '@/lib/api-client';
import { rupeesStringToPaise } from '@/lib/money';

function formatINR(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
}

function CreditLimitForm({
  agencyId,
  currentLimit,
}: {
  agencyId: string;
  currentLimit: number;
}) {
  const [editing, setEditing] = useState(false);
  const [rupees, setRupees] = useState((currentLimit / 100).toString());
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SetCreditLimitRequest>({
    resolver: zodResolver(SetCreditLimitRequestSchema),
    defaultValues: { creditLimitPaise: currentLimit, reason: '' },
  });

  const invalidate = useInvalidateOnSuccess([['agencies']]);
  const set = useApiMutation<SetCreditLimitRequest, { agencyId: string; creditLimitPaise: number }>(
    `/api/v1/agencies/${agencyId}/credit-limit`,
    'POST',
    {
      onSuccess: () => {
        toast.success('Credit limit updated');
        invalidate();
        setEditing(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  if (!editing) {
    return (
      <Can permission="wallet:credit-limit:set">
        <div className="mt-4 flex items-center justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Update credit limit
          </Button>
        </div>
      </Can>
    );
  }

  return (
    <Can permission="wallet:credit-limit:set">
      <form
        onSubmit={handleSubmit((v) => set.mutate(v))}
        className="mt-4 grid grid-cols-2 gap-3 border-t pt-4"
      >
        <FormField label="New credit limit (₹)" error={errors.creditLimitPaise?.message}>
          <Input
            inputMode="decimal"
            value={rupees}
            onChange={(e) => {
              const next = e.target.value.replace(/[^\d.]/g, '');
              setRupees(next);
              setValue('creditLimitPaise', rupeesStringToPaise(next), { shouldValidate: true });
            }}
          />
        </FormField>
        <FormField label="Reason" required error={errors.reason?.message}>
          <Input placeholder="audit / new tier / clawback" {...register('reason')} />
        </FormField>
        <div className="col-span-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting || set.isPending}>
            {set.isPending ? 'Saving…' : 'Set limit'}
          </Button>
        </div>
      </form>
    </Can>
  );
}

export function EditAgencyDrawer({
  target,
  onOpenChange,
}: {
  target: PublicAgency | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = !!target;
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UpdateAgencyRequest>({
    resolver: zodResolver(UpdateAgencyRequestSchema),
  });
  const status = watch('status');

  useEffect(() => {
    if (target) {
      reset({
        companyName: target.companyName,
        legalName: target.legalName ?? undefined,
        state: target.state,
        city: target.city,
        pincode: target.pincode,
        address: target.address,
        status: target.status,
        creditLimit: target.creditLimit,
      });
    }
  }, [target, reset]);

  const invalidate = useInvalidateOnSuccess([['agencies']]);
  const update = useApiMutation<UpdateAgencyRequest, PublicAgency>(
    () => `/api/v1/agencies/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Agency updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[600px]">
        <DialogHeader>
          <DialogTitle>{target.companyName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => update.mutate(v))} className="flex flex-1 flex-col">
          <DialogBody className="space-y-6">
            <Card className="p-4">
              <div className="grid grid-cols-3 gap-4">
                <KeyValue label="Wallet" value={formatINR(target.walletBalance)} mono />
                <KeyValue label="Credit limit" value={formatINR(target.creditLimit)} mono />
                <KeyValue label="Outstanding" value={formatINR(target.outstandingAmount)} mono />
              </div>
              <CreditLimitForm agencyId={target.id} currentLimit={target.creditLimit} />
            </Card>

            <Separator />

            <section className="grid grid-cols-2 gap-4">
              <KeyValue label="Code" value={target.agencyCode} mono />
              <KeyValue label="Owner" value={target.ownerUserId} mono />
              <KeyValue
                label="Distributor"
                value={target.distributorId ?? 'Direct'}
                mono={!!target.distributorId}
              />
              <KeyValue label="Created" value={new Date(target.createdAt).toLocaleString()} />
            </section>

            <Separator />

            <FormField id="companyName" label="Company name" error={errors.companyName?.message}>
              <Input id="companyName" {...register('companyName')} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField id="state" label="State" error={errors.state?.message}>
                <Input id="state" {...register('state')} />
              </FormField>
              <FormField id="city" label="City" error={errors.city?.message}>
                <Input id="city" {...register('city')} />
              </FormField>
              <FormField id="pincode" label="Pincode" error={errors.pincode?.message}>
                <Input id="pincode" {...register('pincode')} />
              </FormField>
              <FormField id="status" label="Status" error={errors.status?.message}>
                <Select
                  value={status ?? target.status}
                  onValueChange={(v) => setValue('status', v as UpdateAgencyRequest['status'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGENCY_STATUS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <FormField id="address" label="Address" error={errors.address?.message}>
              <Input id="address" {...register('address')} />
            </FormField>
            <FormField
              id="creditLimit"
              label="Credit limit (paise)"
              hint="Stored as paise — e.g., 100000 = ₹1,000"
              error={errors.creditLimit?.message}
            >
              <Input
                id="creditLimit"
                type="number"
                min="0"
                {...register('creditLimit', { valueAsNumber: true })}
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || update.isPending}>
              {isSubmitting || update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
