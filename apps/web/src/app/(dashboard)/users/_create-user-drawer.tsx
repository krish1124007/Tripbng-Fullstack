'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  CreateUserRequestSchema,
  type CreateUserRequest,
  type PublicUser,
  ROLES,
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
} from '@/components/ui';
import { useApiMutation, useInvalidateOnSuccess } from '@/lib/api-client';

const ASSIGNABLE_ROLES = ROLES.filter((r) => r !== 'SUPER_ADMIN' && r !== 'SUPPLIER');

export function CreateUserDrawer({
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
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserRequest>({
    resolver: zodResolver(CreateUserRequestSchema),
    defaultValues: { role: 'AGENCY' },
  });
  const role = watch('role');

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const invalidate = useInvalidateOnSuccess([['users']]);
  const create = useApiMutation<CreateUserRequest, PublicUser>('/api/v1/users', 'POST', {
    onSuccess: () => {
      toast.success('User created');
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((values) => create.mutate(values))}
          className="flex flex-1 flex-col"
        >
          <DialogBody className="space-y-4">
            <FormField id="fullName" label="Full name" required error={errors.fullName?.message}>
              <Input id="fullName" {...register('fullName')} />
            </FormField>
            <FormField id="email" label="Email" required error={errors.email?.message}>
              <Input id="email" type="email" {...register('email')} />
            </FormField>
            <FormField id="mobile" label="Mobile" required error={errors.mobile?.message}>
              <Input id="mobile" placeholder="+91…" {...register('mobile')} />
            </FormField>
            <FormField id="role" label="Role" required error={errors.role?.message}>
              <Select value={role} onValueChange={(v) => setValue('role', v as CreateUserRequest['role'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="password" label="Initial password" required error={errors.password?.message}>
              <Input id="password" type="password" {...register('password')} />
              <input type="hidden" />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || create.isPending}>
              {isSubmitting || create.isPending ? 'Creating…' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
