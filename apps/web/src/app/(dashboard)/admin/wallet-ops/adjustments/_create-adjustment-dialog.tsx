'use client';

// Create-adjustment dialog. Above the configured threshold the request
// stages for two-person approval (spec §7); below it executes immediately
// inside the proposeAdjustment service. The dialog doesn't try to predict
// which path the request will take — toast surfaces whatever the API
// returns (executed vs. queued).

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Dialog,
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
import { ApiCallError } from '@/lib/api';
import { useApiMutation, useInvalidateOnSuccess } from '@/lib/api-client';
import { rupeesStringToPaise } from '@/lib/money';

interface ProposeBody {
  direction: 'CREDIT' | 'DEBIT';
  amountPaise: number;
  reason: string;
  agencyId?: string;
  distributorId?: string;
}

interface ProposeResponse {
  id: string;
  status: 'EXECUTED' | 'PENDING_APPROVAL';
  ledgerTxnId?: string | null;
}

export function CreateAdjustmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [target, setTarget] = useState<'AGENCY' | 'DISTRIBUTOR'>('AGENCY');
  const [targetId, setTargetId] = useState('');
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const invalidate = useInvalidateOnSuccess([['admin', 'adjustments']]);
  const propose = useApiMutation<ProposeBody, ProposeResponse>(
    '/api/v1/admin/adjustments',
    'POST',
    {
      onSuccess: (r) => {
        invalidate();
        if (r.status === 'EXECUTED') {
          toast.success('Adjustment executed immediately (under threshold)');
        } else {
          toast.success('Adjustment queued for second-admin approval');
        }
        // Reset form and close.
        setTargetId('');
        setAmount('');
        setReason('');
        onOpenChange(false);
      },
      onError: (err) => {
        toast.error(err instanceof ApiCallError ? err.message : 'Could not propose adjustment');
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountPaise = rupeesStringToPaise(amount);
    if (amountPaise <= 0) {
      toast.error('Amount must be positive');
      return;
    }
    if (!/^[a-fA-F0-9]{24}$/.test(targetId)) {
      toast.error(`${target === 'AGENCY' ? 'Agency' : 'Distributor'} ID must be a 24-char hex ObjectId`);
      return;
    }
    if (reason.trim().length < 3) {
      toast.error('Reason must be at least 3 characters');
      return;
    }
    const body: ProposeBody = {
      direction,
      amountPaise,
      reason,
      ...(target === 'AGENCY' ? { agencyId: targetId } : { distributorId: targetId }),
    };
    propose.mutate(body);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Propose wallet adjustment</DialogTitle>
            <DialogDescription>
              Manual credit or debit against an agency / distributor wallet. Requests above the
              configured threshold queue for a second admin's approval before executing.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Target">
                <Select
                  value={target}
                  onValueChange={(v) => setTarget(v as 'AGENCY' | 'DISTRIBUTOR')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AGENCY">Agency</SelectItem>
                    <SelectItem value="DISTRIBUTOR">Distributor</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Direction">
                <Select
                  value={direction}
                  onValueChange={(v) => setDirection(v as 'CREDIT' | 'DEBIT')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CREDIT">Credit (add funds)</SelectItem>
                    <SelectItem value="DEBIT">Debit (remove funds)</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <FormField
              label={`${target === 'AGENCY' ? 'Agency' : 'Distributor'} ID`}
              hint="24-character ObjectId — copy from the agency/distributor admin page URL"
            >
              <Input
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="65a3f8c1d2e4f5b6a7c8d9e0"
                className="font-mono text-xs"
              />
            </FormField>

            <FormField label="Amount (₹)">
              <Input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </FormField>

            <FormField label="Reason" hint="Stored on the audit trail and the alert notification">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Refund top-up for INV-3401 (PG failure resolved manually)"
                rows={3}
              />
            </FormField>

            <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
              <span className="font-semibold">Approval workflow:</span>{' '}
              Amounts above the per-tenant approval threshold queue for a second admin's
              approval. The proposer cannot approve their own request.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={propose.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={direction === 'DEBIT' ? 'danger' : 'primary'}
              loading={propose.isPending}
            >
              Propose {direction === 'CREDIT' ? 'credit' : 'debit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
