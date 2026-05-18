'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  CreateAgencyRequestSchema,
  type CreateAgencyRequest,
  type PublicAgency,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Textarea,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';

const STEPS = ['Company', 'KYC (optional)', 'Owner'] as const;

export function CreateAgencyDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useAuthStore((s) => s.user);
  const [step, setStep] = useState(0);

  const distributors = useApiPaginatedQuery<PublicDistributor>(
    ['distributors-for-create'],
    '/api/v1/distributors',
    { query: { limit: 200 }, enabled: open && me?.role === 'SUPER_ADMIN' },
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<CreateAgencyRequest>({
    resolver: zodResolver(CreateAgencyRequestSchema),
    defaultValues: { country: 'IN' },
  });
  const distributorId = watch('distributorId');

  useEffect(() => {
    if (!open) {
      reset({ country: 'IN' });
      setStep(0);
    }
  }, [open, reset]);

  const invalidate = useInvalidateOnSuccess([['agencies']]);
  const create = useApiMutation<CreateAgencyRequest, PublicAgency>('/api/v1/agencies', 'POST', {
    onSuccess: () => {
      toast.success('Agency created');
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const goNext = async () => {
    const fieldsByStep: (keyof CreateAgencyRequest)[][] = [
      ['companyName', 'state', 'city', 'pincode', 'address'],
      [],
      ['owner'],
    ];
    const ok = await trigger(fieldsByStep[step] as never);
    if (!ok) return;
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[600px]">
        <DialogHeader>
          <DialogTitle>New agency</DialogTitle>
          <ol className="mt-3 flex items-center gap-2 text-xs">
            {STEPS.map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px]',
                    i === step
                      ? 'border-accent bg-accent text-white'
                      : i < step
                        ? 'border-success bg-success/10 text-success'
                        : 'border-border bg-surface-2 text-ink-3',
                  )}
                >
                  {i + 1}
                </span>
                <span className={cn(i === step ? 'text-ink-1' : 'text-ink-3')}>{label}</span>
                {i < STEPS.length - 1 ? <span className="text-ink-3">·</span> : null}
              </li>
            ))}
          </ol>
        </DialogHeader>

        <form onSubmit={handleSubmit((v) => create.mutate(v))} className="flex flex-1 flex-col">
          <DialogBody className="space-y-4">
            {step === 0 ? (
              <>
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
                {me?.role === 'SUPER_ADMIN' ? (
                  <FormField id="distributorId" label="Assign distributor (optional)">
                    <Select
                      value={distributorId ?? '__none__'}
                      onValueChange={(v) => setValue('distributorId', v === '__none__' ? undefined : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Direct under platform" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Direct under platform</SelectItem>
                        {distributors.data?.data.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.companyName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                ) : null}
              </>
            ) : null}

            {step === 1 ? (
              <>
                <p className="text-sm text-ink-3">
                  KYC details — optional at creation, can be added later for credit limits or higher tiers.
                </p>
                <Separator />
                <h3 className="text-sm font-medium text-ink-2">PAN</h3>
                <FormField id="panNumber" label="PAN number" error={errors.pan?.number?.message}>
                  <Input id="panNumber" placeholder="AAAPL1234C" {...register('pan.number')} />
                </FormField>
                <FormField id="panName" label="Name on PAN" error={errors.pan?.name?.message}>
                  <Input id="panName" {...register('pan.name')} />
                </FormField>
                <Separator />
                <h3 className="text-sm font-medium text-ink-2">GST</h3>
                <FormField id="gstNumber" label="GSTIN" error={errors.gst?.number?.message}>
                  <Input id="gstNumber" placeholder="22AAAAA0000A1Z5" {...register('gst.number')} />
                </FormField>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <p className="text-sm text-ink-3">
                  Owner account — receives admin permissions for this agency.
                </p>
                <FormField id="ownerFullName" label="Full name" required error={errors.owner?.fullName?.message}>
                  <Input id="ownerFullName" {...register('owner.fullName')} />
                </FormField>
                <FormField id="ownerEmail" label="Email" required error={errors.owner?.email?.message}>
                  <Input id="ownerEmail" type="email" {...register('owner.email')} />
                </FormField>
                <FormField id="ownerMobile" label="Mobile" required error={errors.owner?.mobile?.message}>
                  <Input id="ownerMobile" placeholder="+91…" {...register('owner.mobile')} />
                </FormField>
                <FormField
                  id="ownerPassword"
                  label="Initial password"
                  required
                  error={errors.owner?.password?.message}
                >
                  <Input id="ownerPassword" type="password" {...register('owner.password')} />
                </FormField>
              </>
            ) : null}
          </DialogBody>
          <DialogFooter>
            {step > 0 ? (
              <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={goNext}>
                Continue
              </Button>
            ) : (
              <Button type="submit" disabled={isSubmitting || create.isPending}>
                {isSubmitting || create.isPending ? 'Creating…' : 'Create agency'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
