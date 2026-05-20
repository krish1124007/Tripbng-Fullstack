'use client';

// Hotel book-and-pay dialog. Posts to /api/v1/hotels/quick-book — the mock
// shortcut that bypasses the TBO PreBook/Book pipeline (which needs real
// supplier data the local env doesn't have) and creates a VOUCHERED
// HotelBooking + debits the agency wallet in one round-trip.
//
// One lead-guest entry is collected up front; the API accepts up to 20.
// Multi-guest editing is a follow-up — for now the bulk of B2B hotel
// bookings on the mock data set are single-traveller anyway.

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

interface QuickBookBody {
  hotel: Hotel;
  checkIn: string;
  checkOut: string;
  rooms: number;
  guests: {
    title: 'Mr' | 'Mrs' | 'Miss' | 'Ms';
    firstName: string;
    lastName: string;
    paxType: 'Adult';
    isLeadPassenger: true;
    email: string;
    phone: string;
  }[];
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
  const [title, setTitle] = useState<'Mr' | 'Mrs' | 'Miss' | 'Ms'>('Mr');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmation, setConfirmation] = useState<QuickBookResponse | null>(null);

  const totalPaise = hotel.perNightPaise * nights * rooms;

  const book = useApiMutation<QuickBookBody, QuickBookResponse>(
    '/api/v1/hotels/quick-book',
    'POST',
    {
      onSuccess: (data) => {
        setConfirmation(data);
        toast.success(`Booked ${data.bookingCode} · ${formatPaiseAsINR(data.pricing.totalSellingPaise)} debited`);
      },
      onError: (err) => toast.error(formatApiError(err)),
    },
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (firstName.trim().length < 1 || lastName.trim().length < 1) {
      toast.error('Lead guest name required');
      return;
    }
    if (!/^[0-9]{10,15}$/.test(phone)) {
      toast.error('Valid mobile number required (10 digits)');
      return;
    }
    book.mutate({
      hotel,
      checkIn,
      checkOut,
      rooms,
      guests: [
        {
          title,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          paxType: 'Adult',
          isLeadPassenger: true,
          email: email.trim(),
          phone: phone.trim(),
        },
      ],
    });
  };

  const reset = () => {
    setConfirmation(null);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
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
                <span className="font-semibold">{formatPaiseAsINR(confirmation.pricing.totalSellingPaise)}</span>{' '}
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
                {rooms === 1 ? '' : 's'} · {formatPaiseAsINR(totalPaise)} debited from wallet on confirm
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-4">
              <div className="grid grid-cols-[100px_1fr_1fr] gap-2">
                <FormField label="Title">
                  <Select value={title} onValueChange={(v) => setTitle(v as typeof title)}>
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
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Parth"
                  />
                </FormField>
                <FormField label="Last name">
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Savajadiya"
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <FormField label="Email">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="guest@example.com"
                  />
                </FormField>
                <FormField label="Mobile">
                  <Input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="9876543210"
                    maxLength={15}
                  />
                </FormField>
              </div>

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
                Book & pay {formatPaiseAsINR(totalPaise)}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
