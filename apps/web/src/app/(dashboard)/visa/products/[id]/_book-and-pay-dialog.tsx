'use client';

// Visa book-and-pay dialog. Posts to /api/v1/visa/quick-book — mock-aware
// shortcut that creates a CONFIRMED VisaBooking + debits the agency wallet
// in one round-trip. Multi-applicant, lead carries email + phone +
// passport for downstream document-upload UX.

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminVisaProduct } from '@tripbng/shared';
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
} from '@/components/ui';
import { formatApiError } from '@/lib/api';
import { useApiMutation } from '@/lib/api-client';
import { formatPaiseAsINR } from '@/lib/money';

type ApplicantTitle = 'Mr' | 'Mrs' | 'Miss' | 'Ms' | 'Mstr';
type PaxType = 'ADT' | 'CHD' | 'INF';

interface ApplicantRow {
  title: ApplicantTitle;
  firstName: string;
  lastName: string;
  paxType: PaxType;
  isLeadPassenger: boolean;
  email?: string;
  phone?: string;
  nationality: string;
  passportNumber?: string;
  passportExpiry?: string;
}

interface QuickBookBody {
  productId: string;
  urgent: boolean;
  expectedTravelDate?: string;
  agreedTotalInr: number;
  applicants: ApplicantRow[];
}

interface QuickBookResponse {
  id: string;
  bookingCode: string;
  status: string;
  supplierRefs: { applicationNo: string | null; portalRef: string | null };
  productName: string;
  countryName: string | null;
  applicants: number;
  pricing: { totalPaise: number };
}

const blank = (isLead: boolean): ApplicantRow => ({
  title: 'Mr',
  firstName: '',
  lastName: '',
  paxType: 'ADT',
  isLeadPassenger: isLead,
  nationality: 'IN',
  ...(isLead ? { email: '', phone: '' } : {}),
});

export function BookAndPayDialog({
  open,
  onOpenChange,
  product,
  selection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: AdminVisaProduct;
  selection: { urgent: boolean; totalInr: number; expectedTravelDate?: string };
}) {
  const [applicants, setApplicants] = useState<ApplicantRow[]>([blank(true)]);
  const [confirmation, setConfirmation] = useState<QuickBookResponse | null>(null);

  const book = useApiMutation<QuickBookBody, QuickBookResponse>(
    '/api/v1/visa/quick-book',
    'POST',
    {
      onSuccess: (data) => {
        setConfirmation(data);
        toast.success(
          `Filed ${data.bookingCode} · ${formatPaiseAsINR(data.pricing.totalPaise)} debited`,
        );
      },
      onError: (err) => toast.error(formatApiError(err)),
    },
  );

  const update = (idx: number, patch: Partial<ApplicantRow>) =>
    setApplicants((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  const add = () => {
    if (applicants.length >= 20) {
      toast.error('Up to 20 applicants per application');
      return;
    }
    setApplicants((prev) => [...prev, blank(false)]);
  };
  const remove = (idx: number) =>
    setApplicants((prev) => prev.filter((_, i) => i !== idx));

  const reset = () => {
    setConfirmation(null);
    setApplicants([blank(true)]);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    for (let i = 0; i < applicants.length; i++) {
      const a = applicants[i]!;
      if (a.firstName.trim().length < 1 || a.lastName.trim().length < 1) {
        toast.error(`Applicant ${i + 1}: name required`);
        return;
      }
    }
    const lead = applicants[0]!;
    if (!/^[0-9]{10,15}$/.test(lead.phone ?? '')) {
      toast.error('Lead applicant mobile number required (10 digits)');
      return;
    }
    book.mutate({
      productId: product.id ?? '',
      urgent: selection.urgent,
      ...(selection.expectedTravelDate ? { expectedTravelDate: selection.expectedTravelDate } : {}),
      agreedTotalInr: selection.totalInr,
      applicants: applicants.map((a, idx) => ({
        title: a.title,
        firstName: a.firstName.trim(),
        lastName: a.lastName.trim(),
        paxType: a.paxType,
        isLeadPassenger: idx === 0,
        nationality: a.nationality,
        ...(a.passportNumber?.trim() ? { passportNumber: a.passportNumber.trim() } : {}),
        ...(a.passportExpiry ? { passportExpiry: a.passportExpiry } : {}),
        ...(idx === 0
          ? { email: a.email?.trim() ?? '', phone: a.phone?.trim() ?? '' }
          : {}),
      })),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        {confirmation ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Application filed</DialogTitle>
              <DialogDescription>
                {confirmation.productName}
                {confirmation.countryName ? ` · ${confirmation.countryName}` : ''} ·{' '}
                {confirmation.applicants} applicant
                {confirmation.applicants === 1 ? '' : 's'}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-success/30 bg-success/5 p-4">
              <p className="eyebrow text-success">Application</p>
              <p className="mt-1 font-mono text-lg font-bold text-ink-1">
                {confirmation.bookingCode}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                App no: {confirmation.supplierRefs.applicationNo}
              </p>
              <p className="mt-2 text-sm">
                <span className="font-semibold">
                  {formatPaiseAsINR(confirmation.pricing.totalPaise)}
                </span>{' '}
                debited from wallet · status {confirmation.status}
              </p>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  onOpenChange(false);
                  reset();
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Apply for {product.name}</DialogTitle>
              <DialogDescription>
                {product.countryName} · {product.purpose} · {applicants.length} applicant
                {applicants.length === 1 ? '' : 's'} · ₹
                {selection.totalInr.toLocaleString('en-IN')} debited from wallet on confirm
              </DialogDescription>
            </DialogHeader>

            <div className="grid max-h-[60vh] gap-4 overflow-y-auto py-4">
              {applicants.map((a, idx) => {
                const isLead = idx === 0;
                return (
                  <div key={idx} className="rounded-md border bg-surface-2 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="eyebrow text-ink-3">
                        Applicant {idx + 1}
                        {isLead ? ' · lead' : ''}
                      </p>
                      {!isLead ? (
                        <button
                          type="button"
                          onClick={() => remove(idx)}
                          className="inline-flex items-center gap-1 rounded text-xs text-danger hover:underline"
                          aria-label={`Remove applicant ${idx + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-[80px_1fr_1fr_100px] gap-2">
                      <FormField label="Title">
                        <Select
                          value={a.title}
                          onValueChange={(v) => update(idx, { title: v as ApplicantTitle })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Mr">Mr</SelectItem>
                            <SelectItem value="Mrs">Mrs</SelectItem>
                            <SelectItem value="Miss">Miss</SelectItem>
                            <SelectItem value="Ms">Ms</SelectItem>
                            <SelectItem value="Mstr">Mstr</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormField>
                      <FormField label="First name">
                        <Input
                          value={a.firstName}
                          onChange={(e) => update(idx, { firstName: e.target.value })}
                          placeholder="First"
                        />
                      </FormField>
                      <FormField label="Last name">
                        <Input
                          value={a.lastName}
                          onChange={(e) => update(idx, { lastName: e.target.value })}
                          placeholder="Last"
                        />
                      </FormField>
                      <FormField label="Type">
                        <Select
                          value={a.paxType}
                          onValueChange={(v) => update(idx, { paxType: v as PaxType })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ADT">Adult</SelectItem>
                            <SelectItem value="CHD">Child</SelectItem>
                            <SelectItem value="INF">Infant</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormField>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <FormField label="Passport no">
                        <Input
                          value={a.passportNumber ?? ''}
                          onChange={(e) =>
                            update(idx, { passportNumber: e.target.value.toUpperCase() })
                          }
                          placeholder="A1234567"
                          maxLength={20}
                        />
                      </FormField>
                      <FormField label="Passport expiry">
                        <Input
                          type="date"
                          value={a.passportExpiry ?? ''}
                          onChange={(e) => update(idx, { passportExpiry: e.target.value })}
                        />
                      </FormField>
                    </div>

                    {isLead ? (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <FormField label="Lead email">
                          <Input
                            type="email"
                            value={a.email ?? ''}
                            onChange={(e) => update(idx, { email: e.target.value })}
                            placeholder="lead@example.com"
                          />
                        </FormField>
                        <FormField label="Lead mobile">
                          <Input
                            type="tel"
                            inputMode="numeric"
                            value={a.phone ?? ''}
                            onChange={(e) =>
                              update(idx, { phone: e.target.value.replace(/\D/g, '') })
                            }
                            placeholder="9876543210"
                            maxLength={15}
                          />
                        </FormField>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              <Button type="button" variant="ghost" size="sm" onClick={add} className="w-fit">
                <Plus className="h-3.5 w-3.5" /> Add applicant
              </Button>

              <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
                Mock supplier path — files the application instantly and debits the agency
                wallet. Real embassy / VFS portal wiring lands once provisioned, including
                the document-upload portal for each applicant.
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={book.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" loading={book.isPending}>
                Book &amp; pay ₹{selection.totalInr.toLocaleString('en-IN')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
