'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  CreateDistributorRequestSchema,
  type CreateDistributorRequest,
  type PublicDistributor,
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
  Textarea,
} from '@/components/ui';
import { useApiMutation, useInvalidateOnSuccess } from '@/lib/api-client';

export function CreateDistributorDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateDistributorRequest>({
    resolver: zodResolver(CreateDistributorRequestSchema),
    defaultValues: { country: 'IN', overrideCommissionPercent: 0 },
  });

  useEffect(() => {
    if (!open) reset({ country: 'IN', overrideCommissionPercent: 0 });
  }, [open, reset]);

  const invalidate = useInvalidateOnSuccess([['distributors']]);
  const create = useApiMutation<CreateDistributorRequest, PublicDistributor>(
    '/api/v1/distributors',
    'POST',
    {
      onSuccess: () => {
        toast.success('Distributor created');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[560px]">
        <DialogHeader>
          <DialogTitle>New distributor</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((v) => create.mutate(v))}
          className="flex flex-1 flex-col"
        >
          <DialogBody className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-ink-2">Company</h3>
              <FormField id="companyName" label="Company name" required error={errors.companyName?.message}>
                <Input id="companyName" {...register('companyName')} />
              </FormField>
              <FormField id="legalName" label="Legal name" error={errors.legalName?.message}>
                <Input id="legalName" {...register('legalName')} />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField id="state" label="State" required error={errors.state?.message}>
                  <Input id="state" {...register('state')} />
                </FormField>
                <FormField id="city" label="City" required error={errors.city?.message}>
                  <Input id="city" {...register('city')} />
                </FormField>
                <FormField id="pincode" label="Pincode" required error={errors.pincode?.message}>
                  <Input id="pincode" {...register('pincode')} />
                </FormField>
                <FormField id="country" label="Country" required error={errors.country?.message}>
                  <Input id="country" {...register('country')} />
                </FormField>
              </div>
              <FormField id="address" label="Address" required error={errors.address?.message}>
                <Textarea id="address" rows={2} {...register('address')} />
              </FormField>
              <FormField
                id="overrideCommissionPercent"
                label="Override commission %"
                hint="Distributor's earnings on agency volume"
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

            <section className="space-y-3">
              <h3 className="text-sm font-medium text-ink-2">Owner account</h3>
              <FormField id="ownerFullName" label="Full name" required error={errors.owner?.fullName?.message}>
                <Input id="ownerFullName" {...register('owner.fullName')} />
              </FormField>
              <FormField id="ownerEmail" label="Email" required error={errors.owner?.email?.message}>
                <Input id="ownerEmail" type="email" {...register('owner.email')} />
              </FormField>
              <FormField id="ownerMobile" label="Mobile" required error={errors.owner?.mobile?.message}>
                <Input id="ownerMobile" {...register('owner.mobile')} />
              </FormField>
              <FormField
                id="ownerPassword"
                label="Initial password"
                required
                error={errors.owner?.password?.message}
              >
                <Input id="ownerPassword" type="password" {...register('owner.password')} />
              </FormField>
            </section>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || create.isPending}>
              {isSubmitting || create.isPending ? 'Creating…' : 'Create distributor'}
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
