'use client';

// Hotel book-and-pay dialog. Posts to /api/v1/hotels/quick-book — the mock
// shortcut that bypasses the TBO PreBook/Book pipeline (which needs real
// supplier data the local env doesn't have) and creates a VOUCHERED
// HotelBooking + debits the agency wallet in one round-trip.
//
// Multi-guest: the dialog starts with one lead-guest row pre-filled with
// the title selector + name + contact fields. The agent can add more
// guest rows (up to 20 — the API enforces this) and remove any non-lead
// row. The first row is always the lead passenger and can't be removed
// (the API needs at least one guest, and the lead carries the contact
// for downstream notifications).

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
} from '@/components/ui';
import { formatApiError } from '@/lib/api';
import { useApiMutation } from '@/lib/api-client';
import { formatPaiseAsINR } from '@/lib/money';

interface Hotel {
  id: string;
  name: string;
  city: string;
  stars: number;
  perNightPaise: number;
  refundable: boolean;
  roomType: string;
}

type GuestTitle = 'Mr' | 'Mrs' | 'Miss' | 'Ms';
type PaxType = 'Adult' | 'Child';

interface GuestRow {
  title: GuestTitle;
  firstName: string;
  lastName: string;
  paxType: PaxType;
  isLeadPassenger: boolean;
  // Contact fields only collected on the lead row.
  email?: string;
  phone?: string;
}

interface QuickBookBody {
  hotel: Hotel;
  checkIn: string;
  checkOut: string;
  rooms: number;
  guests: Array<{
    title: GuestTitle;
    firstName: string;
    lastName: string;
    paxType: PaxType;
    isLeadPassenger: boolean;
    email?: string;
    phone?: string;
  }>;
}

interface QuickBookResponse {
  id: string;
  bookingCode: string;
  status: string;
  supplierRefs: { confirmationNo: string | null };
  hotel: { name: string };
  nights: number;
  pricing: { totalSellingPaise: number };
}

const blankGuest = (isLead: boolean): GuestRow => ({
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
  hotel,
  checkIn,
  checkOut,
  rooms,
  nights,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hotel: Hotel;
  checkIn: string;
  checkOut: string;
  rooms: number;
  nights: number;
}) {
  const [guests, setGuests] = useState<GuestRow[]>([blankGuest(true)]);
  const [confirmation, setConfirmation] = useState<QuickBookResponse | null>(null);

  const totalPaise = hotel.perNightPaise * nights * rooms;

  const book = useApiMutation<QuickBookBody, QuickBookResponse>(
    '/api/v1/hotels/quick-book',
    'POST',
    {
      onSuccess: (data) => {
        setConfirmation(data);
        toast.success(
          `Booked ${data.bookingCode} · ${formatPaiseAsINR(data.pricing.totalSellingPaise)} debited`,
        );
      },
      onError: (err) => toast.error(formatApiError(err)),
    },
  );

  const updateGuest = (idx: number, patch: Partial<GuestRow>) => {
    setGuests((prev) => prev.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  };
  const addGuest = () => {
    if (guests.length >= 20) {
      toast.error('Up to 20 guests per booking');
      return;
    }
    setGuests((prev) => [...prev, blankGuest(false)]);
  };
  const removeGuest = (idx: number) => {
    setGuests((prev) => prev.filter((_, i) => i !== idx));
  };

  const reset = () => {
    setConfirmation(null);
    setGuests([blankGuest(true)]);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Validate every guest row.
    for (let i = 0; i < guests.length; i++) {
      const g = guests[i]!;
      if (g.firstName.trim().length < 1 || g.lastName.trim().length < 1) {
        toast.error(`Guest ${i + 1}: name required`);
        return;
      }
    }
    const lead = guests[0]!;
    if (!/^[0-9]{10,15}$/.test(lead.phone ?? '')) {
      toast.error('Lead guest mobile number required (10 digits)');
      return;
    }
    book.mutate({
      hotel,
      checkIn,
      checkOut,
      rooms,
      guests: guests.map((g, idx) => ({
        title: g.title,
        firstName: g.firstName.trim(),
        lastName: g.lastName.trim(),
        paxType: g.paxType,
        isLeadPassenger: idx === 0,
        ...(idx === 0
          ? { email: g.email?.trim() ?? '', phone: g.phone?.trim() ?? '' }
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
              <DialogTitle>Booking confirmed</DialogTitle>
              <DialogDescription>
                {confirmation.hotel.name} · {confirmation.nights} night
                {confirmation.nights === 1 ? '' : 's'}
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
                  {formatPaiseAsINR(confirmation.pricing.totalSellingPaise)}
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
              <DialogTitle>Book {hotel.name}</DialogTitle>
              <DialogDescription>
                {nights} night{nights === 1 ? '' : 's'} · {rooms} room
                {rooms === 1 ? '' : 's'} · {formatPaiseAsINR(totalPaise)} debited from wallet
                on confirm
              </DialogDescription>
            </DialogHeader>

            <div className="grid max-h-[60vh] gap-4 overflow-y-auto py-4">
              {guests.map((g, idx) => {
                const isLead = idx === 0;
                return (
                  <div
                    key={idx}
                    className="rounded-md border bg-surface-2 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="eyebrow text-ink-3">
                        Guest {idx + 1}
                        {isLead ? ' · lead' : ''}
                      </p>
                      {!isLead ? (
                        <button
                          type="button"
                          onClick={() => removeGuest(idx)}
                          className="inline-flex items-center gap-1 rounded text-xs text-danger hover:underline"
                          aria-label={`Remove guest ${idx + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-[80px_1fr_1fr_120px] gap-2">
                      <FormField label="Title">
                        <Select
                          value={g.title}
                          onValueChange={(v) => updateGuest(idx, { title: v as GuestTitle })}
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
                          value={g.firstName}
                          onChange={(e) => updateGuest(idx, { firstName: e.target.value })}
                          placeholder="First"
                        />
                      </FormField>
                      <FormField label="Last name">
                        <Input
                          value={g.lastName}
                          onChange={(e) => updateGuest(idx, { lastName: e.target.value })}
                          placeholder="Last"
                        />
                      </FormField>
                      <FormField label="Type">
                        <Select
                          value={g.paxType}
                          onValueChange={(v) => updateGuest(idx, { paxType: v as PaxType })}
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
                            value={g.email ?? ''}
                            onChange={(e) => updateGuest(idx, { email: e.target.value })}
                            placeholder="guest@example.com"
                          />
                        </FormField>
                        <FormField label="Lead mobile">
                          <Input
                            type="tel"
                            inputMode="numeric"
                            value={g.phone ?? ''}
                            onChange={(e) =>
                              updateGuest(idx, { phone: e.target.value.replace(/\D/g, '') })
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

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addGuest}
                className="w-fit"
              >
                <Plus className="h-3.5 w-3.5" /> Add guest
              </Button>

              <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
                Mock supplier path — confirms instantly and debits the agency wallet.
                Real TBO bookings go through PreBook + Book + supplier confirmation
                callbacks once Hotel API credentials are provisioned.
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
                Book &amp; pay {formatPaiseAsINR(totalPaise)}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
