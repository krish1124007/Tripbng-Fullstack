'use client';

// Holiday book-and-pay dialog. Posts to /api/v1/holidays/quick-book — the
// mock supplier shortcut that creates a CONFIRMED HolidayBooking + debits
// the agency wallet in one round-trip. Multi-traveller capable; first row
// is the lead, subsequent rows can be added/removed.

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminHolidayPackage } from '@tripbng/shared';
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

type GuestTitle = 'Mr' | 'Mrs' | 'Miss' | 'Ms';
type PaxType = 'Adult' | 'Child';
type SharingType = 'single' | 'double' | 'triple';

interface TravellerRow {
  title: GuestTitle;
  firstName: string;
  lastName: string;
  paxType: PaxType;
  isLeadPassenger: boolean;
  email?: string;
  phone?: string;
}

interface QuickBookBody {
  packageId: string;
  departureDate: string;
  departureCity?: string;
  sharingType: SharingType;
  adults: number;
  childrenWithBed: number;
  childrenWithoutBed: number;
  agreedTotalInr: number;
  travellers: TravellerRow[];
}

interface QuickBookResponse {
  id: string;
  bookingCode: string;
  status: string;
  supplierRefs: { confirmationNo: string | null };
  packageTitle: string;
  destination: string | null;
  nights: number;
  pricing: { totalPaise: number };
}

const blank = (isLead: boolean): TravellerRow => ({
  title: 'Mr',
  firstName: '',
  lastName: '',
  paxType: 'Adult',
  isLeadPassenger: isLead,
  ...(isLead ? { email: '', phone: '' } : {}),
});

export function BookAndPayDialog({
  open,
  onOpenChange,
  pkg,
  selection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pkg: AdminHolidayPackage;
  selection: {
    departureDate: string;
    departureCity: string;
    sharingType: SharingType;
    adults: number;
    childrenWithBed: number;
    childrenWithoutBed: number;
    totalInr: number;
  };
}) {
  const [travellers, setTravellers] = useState<TravellerRow[]>([blank(true)]);
  const [confirmation, setConfirmation] = useState<QuickBookResponse | null>(null);

  const totalPax =
    selection.adults + selection.childrenWithBed + selection.childrenWithoutBed;

  const book = useApiMutation<QuickBookBody, QuickBookResponse>(
    '/api/v1/holidays/quick-book',
    'POST',
    {
      onSuccess: (data) => {
        setConfirmation(data);
        toast.success(
          `Booked ${data.bookingCode} · ${formatPaiseAsINR(data.pricing.totalPaise)} debited`,
        );
      },
      onError: (err) => toast.error(formatApiError(err)),
    },
  );

  const update = (idx: number, patch: Partial<TravellerRow>) =>
    setTravellers((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  const add = () => {
    if (travellers.length >= 20) {
      toast.error('Up to 20 travellers per booking');
      return;
    }
    setTravellers((prev) => [...prev, blank(false)]);
  };
  const remove = (idx: number) =>
    setTravellers((prev) => prev.filter((_, i) => i !== idx));

  const reset = () => {
    setConfirmation(null);
    setTravellers([blank(true)]);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    for (let i = 0; i < travellers.length; i++) {
      const t = travellers[i]!;
      if (t.firstName.trim().length < 1 || t.lastName.trim().length < 1) {
        toast.error(`Traveller ${i + 1}: name required`);
        return;
      }
    }
    const lead = travellers[0]!;
    if (!/^[0-9]{10,15}$/.test(lead.phone ?? '')) {
      toast.error('Lead traveller mobile number required (10 digits)');
      return;
    }
    book.mutate({
      packageId: pkg.id ?? '',
      departureDate: selection.departureDate,
      departureCity: selection.departureCity,
      sharingType: selection.sharingType,
      adults: selection.adults,
      childrenWithBed: selection.childrenWithBed,
      childrenWithoutBed: selection.childrenWithoutBed,
      agreedTotalInr: selection.totalInr,
      travellers: travellers.map((t, idx) => ({
        title: t.title,
        firstName: t.firstName.trim(),
        lastName: t.lastName.trim(),
        paxType: t.paxType,
        isLeadPassenger: idx === 0,
        ...(idx === 0
          ? { email: t.email?.trim() ?? '', phone: t.phone?.trim() ?? '' }
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
              <DialogTitle>Holiday confirmed</DialogTitle>
              <DialogDescription>
                {confirmation.packageTitle}
                {confirmation.destination ? ` · ${confirmation.destination}` : ''} ·{' '}
                {confirmation.nights} nights
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-success/30 bg-success/5 p-4">
              <p className="eyebrow text-success">Confirmation</p>
              <p className="mt-1 font-mono text-lg font-bold text-ink-1">
                {confirmation.bookingCode}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                Supplier ref: {confirmation.supplierRefs.confirmationNo}
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
              <DialogTitle>Book {pkg.title}</DialogTitle>
              <DialogDescription>
                {pkg.nights} nights · {totalPax} traveller{totalPax === 1 ? '' : 's'} ·{' '}
                {selection.sharingType} sharing · ₹{selection.totalInr.toLocaleString('en-IN')}{' '}
                debited from wallet on confirm
              </DialogDescription>
            </DialogHeader>

            <div className="grid max-h-[60vh] gap-4 overflow-y-auto py-4">
              {travellers.map((t, idx) => {
                const isLead = idx === 0;
                return (
                  <div key={idx} className="rounded-md border bg-surface-2 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="eyebrow text-ink-3">
                        Traveller {idx + 1}
                        {isLead ? ' · lead' : ''}
                      </p>
                      {!isLead ? (
                        <button
                          type="button"
                          onClick={() => remove(idx)}
                          className="inline-flex items-center gap-1 rounded text-xs text-danger hover:underline"
                          aria-label={`Remove traveller ${idx + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-[80px_1fr_1fr_120px] gap-2">
                      <FormField label="Title">
                        <Select
                          value={t.title}
                          onValueChange={(v) => update(idx, { title: v as GuestTitle })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Mr">Mr</SelectItem>
                            <SelectItem value="Mrs">Mrs</SelectItem>
                            <SelectItem value="Miss">Miss</SelectItem>
                            <SelectItem value="Ms">Ms</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormField>
                      <FormField label="First name">
                        <Input
                          value={t.firstName}
                          onChange={(e) => update(idx, { firstName: e.target.value })}
                          placeholder="First"
                        />
                      </FormField>
                      <FormField label="Last name">
                        <Input
                          value={t.lastName}
                          onChange={(e) => update(idx, { lastName: e.target.value })}
                          placeholder="Last"
                        />
                      </FormField>
                      <FormField label="Type">
                        <Select
                          value={t.paxType}
                          onValueChange={(v) => update(idx, { paxType: v as PaxType })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Adult">Adult</SelectItem>
                            <SelectItem value="Child">Child</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormField>
                    </div>

                    {isLead ? (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <FormField label="Lead email">
                          <Input
                            type="email"
                            value={t.email ?? ''}
                            onChange={(e) => update(idx, { email: e.target.value })}
                            placeholder="lead@example.com"
                          />
                        </FormField>
                        <FormField label="Lead mobile">
                          <Input
                            type="tel"
                            inputMode="numeric"
                            value={t.phone ?? ''}
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
                <Plus className="h-3.5 w-3.5" /> Add traveller
              </Button>

              <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
                Mock supplier path — confirms instantly and debits the agency wallet. Real
                consolidator wiring (TBO/Custom) replaces the inline confirmation once
                provisioned.
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
