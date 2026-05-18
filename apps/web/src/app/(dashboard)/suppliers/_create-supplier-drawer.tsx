'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  CreateSupplierRequestSchema,
  PRODUCT_TYPE,
  SUPPLIER_TYPE,
  type CreateSupplierRequest,
  type PublicSupplier,
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

export function CreateSupplierDrawer({
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
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateSupplierRequest>({
    resolver: zodResolver(CreateSupplierRequestSchema),
    defaultValues: { type: 'CONSOLIDATOR', productTypes: ['FLIGHT'], status: 'ACTIVE' },
  });
  const productTypes = watch('productTypes') ?? [];
  const supplierType = watch('type');

  useEffect(() => {
    if (!open) reset({ type: 'CONSOLIDATOR', productTypes: ['FLIGHT'], status: 'ACTIVE' });
  }, [open, reset]);

  const invalidate = useInvalidateOnSuccess([['suppliers']]);
  const create = useApiMutation<CreateSupplierRequest, PublicSupplier>(
    '/api/v1/suppliers',
    'POST',
    {
      onSuccess: () => {
        toast.success('Supplier created');
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[600px]">
        <DialogHeader>
          <DialogTitle>New supplier</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => create.mutate(v))} className="flex flex-1 flex-col">
          <DialogBody className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <FormField id="code" label="Code" required error={errors.code?.message}>
                <Input id="code" placeholder="TRIPJACK" {...register('code')} />
              </FormField>
              <FormField id="type" label="Type" required error={errors.type?.message}>
                <Select
                  value={supplierType}
                  onValueChange={(v) => setValue('type', v as CreateSupplierRequest['type'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPLIER_TYPE.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <FormField id="name" label="Display name" required error={errors.name?.message}>
              <Input id="name" {...register('name')} />
            </FormField>

            <FormField label="Product types" required error={errors.productTypes?.message}>
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
            <h3 className="text-sm font-medium text-ink-2">Connection</h3>
            <FormField
              id="endpoint"
              label="API endpoint"
              required
              error={errors.config?.endpoint?.message}
            >
              <Input
                id="endpoint"
                placeholder="https://api.supplier.com/v1"
                {...register('config.endpoint')}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField id="username" label="Username" error={errors.config?.username?.message}>
                <Input id="username" {...register('config.username')} />
              </FormField>
              <FormField id="password" label="Password" error={errors.config?.password?.message}>
                <Input id="password" type="password" {...register('config.password')} />
              </FormField>
              <FormField id="apiKey" label="API key" error={errors.config?.apiKey?.message}>
                <Input id="apiKey" type="password" {...register('config.apiKey')} />
              </FormField>
              <FormField id="agentId" label="Agent ID" error={errors.config?.agentId?.message}>
                <Input id="agentId" {...register('config.agentId')} />
              </FormField>
            </div>
            <p className="text-xs text-ink-3">
              Credentials are encrypted at rest and never returned by the API after creation.
            </p>

            <FormField id="notes" label="Notes" error={errors.notes?.message}>
              <Textarea id="notes" rows={3} {...register('notes')} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || create.isPending}>
              {isSubmitting || create.isPending ? 'Creating…' : 'Create supplier'}
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
