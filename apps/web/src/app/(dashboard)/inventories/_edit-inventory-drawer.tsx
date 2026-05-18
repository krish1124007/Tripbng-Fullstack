'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  INVENTORY_STATUS,
  UpdateInventoryRequestSchema,
  type PublicInventory,
  type UpdateInventoryRequest,
} from '@tripbng/shared';
import {
  Button,
  Card,
  CardContent,
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
  StatusBadge,
} from '@/components/ui';
import { useApiMutation, useInvalidateOnSuccess } from '@/lib/api-client';
import { formatPaiseAsINR } from '@/lib/money';

export function EditInventoryDrawer({
  target,
  onOpenChange,
}: {
  target: PublicInventory | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = !!target;
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<UpdateInventoryRequest>({
    resolver: zodResolver(UpdateInventoryRequestSchema),
  });
  const status = watch('status');

  useEffect(() => {
    if (target) {
      reset({
        inventoryName: target.inventoryName,
        status: target.status,
        closeBeforeDays: target.closeBeforeDays,
        totalSeats: target.totalSeats,
        seatsPerDay: target.seatsPerDay,
        fare: target.fare,
      });
    }
  }, [target, reset]);

  const invalidate = useInvalidateOnSuccess([['inventories']]);
  const update = useApiMutation<UpdateInventoryRequest, PublicInventory>(
    () => `/api/v1/inventories/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Inventory updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[640px]">
        <DialogHeader>
          <DialogTitle>{target.inventoryName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => update.mutate(v))} className="flex flex-1 flex-col">
          <DialogBody className="space-y-5">
            <Card>
              <CardContent className="grid grid-cols-3 gap-4 p-4">
                <KeyValue label="Code" value={target.inventoryCode} mono />
                <KeyValue
                  label="Sector"
                  value={`${target.origin.code} → ${target.destination.code}`}
                  mono
                />
                <KeyValue
                  label="Adult fare"
                  value={formatPaiseAsINR(target.fare.adultFare, { compact: true })}
                  mono
                />
                <KeyValue label="Status" value={<StatusBadge status={target.status} />} />
                <KeyValue
                  label="Seats"
                  value={`${target.seatsRemaining}/${target.totalSeats}`}
                  mono
                />
                <KeyValue
                  label="Operating days"
                  value={target.daysOfOperation
                    .map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d])
                    .join(', ')}
                />
              </CardContent>
            </Card>
            <Separator />

            <FormField id="inventoryName" label="Inventory name" error={errors.inventoryName?.message}>
              <Input id="inventoryName" {...register('inventoryName')} />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField id="status" label="Status">
                <Select
                  value={status ?? target.status}
                  onValueChange={(v) => setValue('status', v as UpdateInventoryRequest['status'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVENTORY_STATUS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField id="closeBeforeDays" label="Close before (days)">
                <Input
                  id="closeBeforeDays"
                  type="number"
                  min="0"
                  {...register('closeBeforeDays', { valueAsNumber: true })}
                />
              </FormField>
              <FormField id="totalSeats" label="Total seats">
                <Input
                  id="totalSeats"
                  type="number"
                  min={target.totalSeats - target.seatsRemaining}
                  {...register('totalSeats', { valueAsNumber: true })}
                />
              </FormField>
              <FormField id="seatsPerDay" label="Seats per day">
                <Input
                  id="seatsPerDay"
                  type="number"
                  min="1"
                  {...register('seatsPerDay', { valueAsNumber: true })}
                />
              </FormField>
            </div>

            <Separator />
            <h3 className="text-sm font-medium text-ink-2">Fare overrides (paise)</h3>
            <div className="grid grid-cols-2 gap-3">
              <FormField id="adultFare" label="Adult fare">
                <Input
                  id="adultFare"
                  type="number"
                  min="0"
                  {...register('fare.adultFare', { valueAsNumber: true })}
                />
              </FormField>
              <FormField id="childFare" label="Child fare">
                <Input
                  id="childFare"
                  type="number"
                  min="0"
                  {...register('fare.childFare', { valueAsNumber: true })}
                />
              </FormField>
              <FormField id="infantFare" label="Infant fare">
                <Input
                  id="infantFare"
                  type="number"
                  min="0"
                  {...register('fare.infantFare', { valueAsNumber: true })}
                />
              </FormField>
              <FormField id="discount" label="Discount">
                <Input
                  id="discount"
                  type="number"
                  min="0"
                  {...register('fare.discount', { valueAsNumber: true })}
                />
              </FormField>
            </div>

            <Separator />
            <h3 className="text-sm font-medium text-ink-2">Fare branding</h3>
            <div className="grid grid-cols-2 gap-3">
              <FormField id="fareName" label="Fare name">
                <Input
                  id="fareName"
                  list="fareNamePresetsEdit"
                  placeholder="SkySaver"
                  maxLength={30}
                  {...register('fare.fareName')}
                />
                <datalist id="fareNamePresetsEdit">
                  <option value="SkySaver" />
                  <option value="SkyFlex" />
                  <option value="SkyPrime" />
                  <option value="GroupSpecial" />
                  <option value="Promo" />
                </datalist>
              </FormField>
              <FormField id="fareNameDescription" label="Description">
                <Input
                  id="fareNameDescription"
                  placeholder="Refundable up to 24h before departure"
                  maxLength={80}
                  {...register('fare.fareNameDescription')}
                />
              </FormField>
            </div>
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
