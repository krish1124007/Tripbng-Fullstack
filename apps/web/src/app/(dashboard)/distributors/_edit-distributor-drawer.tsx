'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  AGENCY_STATUS,
  UpdateDistributorRequestSchema,
  type PublicDistributor,
  type UpdateDistributorRequest,
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
  KeyValue,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@/components/ui';
import { useApiMutation, useInvalidateOnSuccess } from '@/lib/api-client';

export function EditDistributorDrawer({
  target,
  onOpenChange,
}: {
  target: PublicDistributor | null;
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
  } = useForm<UpdateDistributorRequest>({
    resolver: zodResolver(UpdateDistributorRequestSchema),
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
        overrideCommissionPercent: target.overrideCommissionPercent,
      });
    }
  }, [target, reset]);

  const invalidate = useInvalidateOnSuccess([['distributors']]);
  const update = useApiMutation<UpdateDistributorRequest, PublicDistributor>(
    () => `/api/v1/distributors/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Distributor updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[560px]">
        <DialogHeader>
          <DialogTitle>{target.companyName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => update.mutate(v))} className="flex flex-1 flex-col">
          <DialogBody className="space-y-6">
            <section className="grid grid-cols-2 gap-4">
              <KeyValue label="Code" value={target.distributorCode} mono />
              <KeyValue label="Agencies under" value={target.agencyCount} mono />
              <KeyValue label="Owner ID" value={target.ownerUserId} mono />
              <KeyValue label="Created" value={new Date(target.createdAt).toLocaleString()} />
            </section>
            <Separator />

            <section className="space-y-3">
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
                    onValueChange={(v) =>
                      setValue('status', v as UpdateDistributorRequest['status'])
                    }
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
                id="overrideCommissionPercent"
                label="Override commission %"
                error={errors.overrideCommissionPercent?.message}
              >
                <Input
                  id="overrideCommissionPercent"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  {...register('overrideCommissionPercent', { valueAsNumber: true })}
                />
              </FormField>
            </section>
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
