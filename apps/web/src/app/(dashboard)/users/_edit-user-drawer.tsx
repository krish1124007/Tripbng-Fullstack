'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  UpdateUserRequestSchema,
  USER_STATUS,
  type PublicUser,
  type UpdateUserRequest,
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

export function EditUserDrawer({
  target,
  onOpenChange,
}: {
  target: PublicUser | null;
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
  } = useForm<UpdateUserRequest>({
    resolver: zodResolver(UpdateUserRequestSchema),
    defaultValues: {},
  });
  const status = watch('status');

  useEffect(() => {
    if (target) {
      reset({
        fullName: target.fullName,
        mobile: target.mobile,
        status: target.status,
      });
    }
  }, [target, reset]);

  const invalidate = useInvalidateOnSuccess([['users']]);
  const update = useApiMutation<UpdateUserRequest, PublicUser>(
    () => `/api/v1/users/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('User updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DialogHeader>
          <DialogTitle>Edit {target.fullName}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((values) => update.mutate(values))}
          className="flex flex-1 flex-col"
        >
          <DialogBody className="space-y-4">
            <FormField id="fullName" label="Full name" error={errors.fullName?.message}>
              <Input id="fullName" {...register('fullName')} />
            </FormField>
            <FormField id="mobile" label="Mobile" error={errors.mobile?.message}>
              <Input id="mobile" {...register('mobile')} />
            </FormField>
            <FormField id="status" label="Status" error={errors.status?.message}>
              <Select
                value={status ?? target.status}
                onValueChange={(v) => setValue('status', v as UpdateUserRequest['status'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_STATUS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || update.isPending}>
              {isSubmitting || update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
