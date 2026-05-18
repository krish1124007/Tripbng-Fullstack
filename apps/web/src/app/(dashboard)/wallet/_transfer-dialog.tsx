'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  TransferRequestSchema,
  type PublicAgency,
  type TransferRequest,
} from '@tripbng/shared';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { rupeesStringToPaise } from '@/lib/money';

export function TransferDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [amountRupees, setAmountRupees] = useState('');

  const downline = useApiPaginatedQuery<PublicAgency>(
    ['downline-agencies'],
    '/api/v1/agencies',
    { query: { limit: 200 }, enabled: open },
  );

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TransferRequest>({
    resolver: zodResolver(TransferRequestSchema),
    defaultValues: { amountPaise: 0 },
  });
  const toAgencyId = watch('toAgencyId');

  useEffect(() => {
    if (!open) {
      reset({ amountPaise: 0 });
      setAmountRupees('');
    }
  }, [open, reset]);

  useEffect(() => {
    setValue('amountPaise', rupeesStringToPaise(amountRupees), { shouldValidate: !!amountRupees });
  }, [amountRupees, setValue]);

  const invalidate = useInvalidateOnSuccess([
    ['wallet'],
    ['wallet-transactions'],
  ]);

  const transfer = useApiMutation<TransferRequest, { debitTxnId: string; creditTxnId: string }>(
    '/api/v1/wallet/transfer',
    'POST',
    {
      onSuccess: () => {
        toast.success('Transfer posted to ledger');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const submit = handleSubmit((v) => transfer.mutate(v));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer to agency</DialogTitle>
          <DialogDescription>
            Moves funds from your distributor wallet into one of your downline agencies. Posts two
            ledger entries — one debit, one credit — linked together.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="space-y-4">
            <FormField id="toAgencyId" label="Destination agency" required error={errors.toAgencyId?.message}>
              <Select
                value={toAgencyId ?? ''}
                onValueChange={(v) => setValue('toAgencyId', v, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick an agency…" />
                </SelectTrigger>
                <SelectContent>
                  {(downline.data?.data ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.companyName}{' '}
                      <span className="ml-1 font-mono text-xs text-ink-3">{a.agencyCode}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField id="amount" label="Amount (₹)" required error={errors.amountPaise?.message}>
              <Input
                id="amount"
                inputMode="decimal"
                placeholder="10000"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value.replace(/[^\d.]/g, ''))}
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
            <Button type="submit" disabled={isSubmitting || transfer.isPending}>
              {transfer.isPending ? 'Posting…' : 'Transfer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
