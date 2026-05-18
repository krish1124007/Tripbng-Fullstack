'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  PRODUCT_TYPE,
  SUPPLIER_STATUS,
  UpdateSupplierRequestSchema,
  type PublicSupplier,
  type UpdateSupplierRequest,
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
  Textarea,
} from '@/components/ui';
import { useApiMutation, useInvalidateOnSuccess } from '@/lib/api-client';

export function EditSupplierDrawer({
  target,
  onOpenChange,
}: {
  target: PublicSupplier | null;
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
  } = useForm<UpdateSupplierRequest>({
    resolver: zodResolver(UpdateSupplierRequestSchema),
  });
  const status = watch('status');
  const productTypes = watch('productTypes') ?? [];

  useEffect(() => {
    if (target) {
      reset({
        name: target.name,
        productTypes: target.productTypes,
        status: target.status,
        notes: target.notes ?? undefined,
        config: { endpoint: target.configEndpoint } as UpdateSupplierRequest['config'],
      });
    }
  }, [target, reset]);

  const invalidate = useInvalidateOnSuccess([['suppliers']]);
  const update = useApiMutation<UpdateSupplierRequest, PublicSupplier>(
    () => `/api/v1/suppliers/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Supplier updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const toggleProduct = (p: (typeof PRODUCT_TYPE)[number]) => {
    const next = productTypes.includes(p)
      ? productTypes.filter((x) => x !== p)
      : [...productTypes, p];
    setValue('productTypes', next as typeof productTypes, { shouldValidate: true });
  };

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[600px]">
        <DialogHeader>
          <DialogTitle>{target.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => update.mutate(v))} className="flex flex-1 flex-col">
          <DialogBody className="space-y-5">
            <section className="grid grid-cols-2 gap-4">
              <KeyValue label="Code" value={target.code} mono />
              <KeyValue label="Type" value={target.type} />
              <KeyValue
                label="Last health"
                value={
                  target.lastHealthCheckAt
                    ? `${target.lastHealthCheckOk ? 'OK' : 'FAIL'} · ${new Date(
                        target.lastHealthCheckAt,
                      ).toLocaleString()}`
                    : 'never'
                }
              />
              <KeyValue label="Endpoint" value={target.configEndpoint} mono />
            </section>
            <Separator />

            <FormField id="name" label="Display name" error={errors.name?.message}>
              <Input id="name" {...register('name')} />
            </FormField>
            <FormField id="status" label="Status" error={errors.status?.message}>
              <Select
                value={status ?? target.status}
                onValueChange={(v) => setValue('status', v as UpdateSupplierRequest['status'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPLIER_STATUS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Product types">
              <div className="flex flex-wrap gap-2">
                {PRODUCT_TYPE.map((p) => {
                  const active = productTypes.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => toggleProduct(p)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-border bg-surface-2 text-ink-2 hover:bg-surface-1'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </FormField>

            <Separator />
            <h3 className="text-sm font-medium text-ink-2">Update credentials (leave empty to keep)</h3>
            <FormField id="endpoint" label="API endpoint">
              <Input id="endpoint" {...register('config.endpoint')} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField id="username" label="Username">
                <Input id="username" placeholder="•••" {...register('config.username')} />
              </FormField>
              <FormField id="password" label="Password">
                <Input id="password" type="password" placeholder="•••" {...register('config.password')} />
              </FormField>
              <FormField id="apiKey" label="API key">
                <Input id="apiKey" type="password" placeholder="•••" {...register('config.apiKey')} />
              </FormField>
              <FormField id="agentId" label="Agent ID">
                <Input id="agentId" placeholder="•••" {...register('config.agentId')} />
              </FormField>
            </div>

            <FormField id="notes" label="Notes" error={errors.notes?.message}>
              <Textarea id="notes" rows={3} {...register('notes')} />
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
