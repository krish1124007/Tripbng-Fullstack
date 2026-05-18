'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
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
import { useAuthStore } from '@/lib/auth-store';
import { rupeesStringToPaise } from '@/lib/money';

declare global {
  interface Window {
    // Razorpay checkout JS attaches a constructor to window.
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export function TopupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useAuthStore((s) => s.user);
  const [amountRupees, setAmountRupees] = useState<string>('');
  const [scriptReady, setScriptReady] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InitiateTopupRequest>({
    resolver: zodResolver(InitiateTopupRequestSchema),
    defaultValues: { paymentMode: 'RAZORPAY', amountPaise: 0 },
  });
  const paymentMode = watch('paymentMode');

  useEffect(() => {
    if (!open) {
      reset({ paymentMode: 'RAZORPAY', amountPaise: 0 });
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
      onSuccess: async (data) => {
        if (data.mode === 'MANUAL') {
          toast.success('Top-up submitted — awaiting admin approval', {
            description: `Reference saved. Amount: ${amountRupees}`,
          });
          invalidate();
          onOpenChange(false);
          return;
        }
        if (data.mode === 'RAZORPAY') {
          if (!window.Razorpay) {
            toast.error('Razorpay checkout failed to load');
            return;
          }
          const rz = new window.Razorpay({
            key: data.razorpayKeyId,
            order_id: data.razorpayOrderId,
            amount: data.amountPaise,
            currency: data.currency,
            name: 'TripBng',
            description: 'Wallet top-up',
            prefill: { email: me?.email, contact: undefined },
            handler: (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) =>
              verify.mutate({
                topupId: data.topupId,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpayOrderId: resp.razorpay_order_id,
                razorpaySignature: resp.razorpay_signature,
              }),
            modal: { ondismiss: () => toast('Top-up cancelled') },
          });
          rz.open();
        }
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const verify = useApiMutation<
    {
      topupId: string;
      razorpayPaymentId: string;
      razorpayOrderId: string;
      razorpaySignature: string;
    },
    { id: string; status: string }
  >('/api/v1/wallet/topup/verify-razorpay', 'POST', {
    onSuccess: () => {
      toast.success('Top-up successful');
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = handleSubmit((v) => initiate.mutate(v));

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        onLoad={() => setScriptReady(true)}
        strategy="lazyOnload"
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Top up wallet</DialogTitle>
            <DialogDescription>Choose Razorpay for instant credit, or submit a bank/UPI/cash receipt for manual approval.</DialogDescription>
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
                    <SelectItem value="RAZORPAY">Razorpay (instant)</SelectItem>
                    <SelectItem value="BANK">Bank transfer (NEFT/RTGS)</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="CASH">Cash deposit</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              {paymentMode !== 'RAZORPAY' ? (
                <>
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
                </>
              ) : null}

              <FormField id="notes" label="Notes">
                <Textarea id="notes" rows={2} {...register('notes')} />
              </FormField>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || initiate.isPending || verify.isPending || (paymentMode === 'RAZORPAY' && !scriptReady)}
              >
                {initiate.isPending || verify.isPending
                  ? 'Processing…'
                  : paymentMode === 'RAZORPAY'
                    ? 'Pay with Razorpay'
                    : 'Submit for approval'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
