'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  InitiateTopupRequestSchema,
  type InitiateTopupRequest,
  type InitiateTopupResponse,
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
  Separator,
  Textarea,
} from '@/components/ui';
import { useApiMutation, useInvalidateOnSuccess } from '@/lib/api-client';
import { rupeesStringToPaise } from '@/lib/money';

export function TopupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [amountRupees, setAmountRupees] = useState<string>('');

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InitiateTopupRequest>({
    resolver: zodResolver(InitiateTopupRequestSchema),
    defaultValues: { paymentMode: 'BANK', amountPaise: 0 },
  });
  const paymentMode = watch('paymentMode');

  useEffect(() => {
    if (!open) {
      reset({ paymentMode: 'BANK', amountPaise: 0 });
      setAmountRupees('');
    }
  }, [open, reset]);

  useEffect(() => {
    setValue('amountPaise', rupeesStringToPaise(amountRupees), { shouldValidate: !!amountRupees });
  }, [amountRupees, setValue]);

  const invalidate = useInvalidateOnSuccess([
    ['wallet'],
    ['wallet-transactions'],
    ['topups'],
  ]);

  const initiate = useApiMutation<InitiateTopupRequest, InitiateTopupResponse>(
    '/api/v1/wallet/topup',
    'POST',
    {
      onSuccess: () => {
        toast.success('Top-up submitted — awaiting admin approval', {
          description: `Reference saved. Amount: ${amountRupees}`,
        });
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const submit = handleSubmit((v) => initiate.mutate(v));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Top up wallet</DialogTitle>
          <DialogDescription>
            Submit a bank/UPI/cash receipt for manual approval. Gateway top-ups (PhonePe, ICICI) go through the Pay-Now flow.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="space-y-4">
            <FormField id="amount" label="Amount (₹)" required error={errors.amountPaise?.message}>
              <Input
                id="amount"
                inputMode="decimal"
                placeholder="5000"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </FormField>

            <FormField id="paymentMode" label="Payment mode" required>
              <Select
                value={paymentMode}
                onValueChange={(v) => setValue('paymentMode', v as InitiateTopupRequest['paymentMode'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BANK">Bank transfer (NEFT/RTGS)</SelectItem>
                  <SelectItem value="UPI">UPI</SelectItem>
                  <SelectItem value="CASH">Cash deposit</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <Separator />
            <FormField
              id="referenceNumber"
              label={paymentMode === 'BANK' ? 'Bank reference / UTR' : paymentMode === 'UPI' ? 'UPI transaction id' : 'Receipt number'}
              required={paymentMode === 'BANK'}
              error={errors.referenceNumber?.message}
            >
              <Input id="referenceNumber" {...register('referenceNumber')} />
            </FormField>
            <FormField id="proofUrl" label="Proof URL (optional)">
              <Input
                id="proofUrl"
                placeholder="https://drive.google.com/..."
                {...register('proofUrl')}
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
            <Button type="submit" disabled={isSubmitting || initiate.isPending}>
              {initiate.isPending ? 'Processing…' : 'Submit for approval'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
