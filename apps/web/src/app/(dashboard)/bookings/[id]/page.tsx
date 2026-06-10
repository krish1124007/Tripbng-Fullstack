'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Clock, Plane, Receipt, ShieldCheck, X, Bus as BusIcon, Building2 as HotelIcon, FileText as VisaIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicBooking } from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  KeyValue,
  PageHeader,
  Separator,
  Skeleton,
  StatusBadge,
} from '@/components/ui';
import { AirlineLogo } from '@/components/airline-logo';
import { WebCheckInButton } from '@/components/web-check-in-button';
import { useApiMutation, useApiQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { downloadAuthenticatedFile } from '@/lib/download';
import { formatPaiseAsINR } from '@/lib/money';
import { ApiCallError } from '@/lib/api';

export default function BookingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const accessToken = useAuthStore((s) => s.accessToken);
  const booking = useApiQuery<PublicBooking>(['booking', id], `/api/v1/bookings/${id}`);
  const invalidate = useInvalidateOnSuccess([['bookings'], ['booking', id]]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const cancel = useApiMutation<{ reason: string }, PublicBooking>(
    `/api/v1/bookings/${id}/cancel`,
    'POST',
    {
      onSuccess: () => {
        toast.success('Booking cancelled');
        invalidate();
        setCancelOpen(false);
        setCancelReason('');
      },
      onError: (err) => toast.error(err.message),
    },
  );

  // Manual refund — admin-only path, hidden from regular agency users
  // by the auth-store permission check below.
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const refund = useApiMutation<
    { amountPaise: number; reason: string },
    { bookingId: string; amountPaise: number; walletTxnId: string }
  >(`/api/v1/bookings/${id}/refund`, 'POST', {
    onSuccess: (res) => {
      toast.success(
        `Refunded ₹${(res.amountPaise / 100).toFixed(2)} to agency wallet (txn ${res.walletTxnId})`,
      );
      invalidate();
      setRefundOpen(false);
      setRefundAmount('');
      setRefundReason('');
    },
    onError: (err) => toast.error(err.message),
  });
  const userPerms = useAuthStore((s) => s.user?.permissions ?? []);
  const canManualRefund = userPerms.includes('booking:refund:manual');

  const downloadPdf = async (kind: 'ticket' | 'invoice') => {
    try {
      await downloadAuthenticatedFile(
        `/api/v1/bookings/${id}/${kind}`,
        `${kind}-${booking.data?.bookingCode}.pdf`,
        accessToken,
      );
    } catch (err) {
      toast.error(err instanceof ApiCallError ? err.message : 'Download failed');
    }
  };

  if (booking.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const b = booking.data;
  if (!b) return <p className="text-sm text-ink-3">Booking not found.</p>;

  const canCancel = ['HOLD', 'TICKETED', 'CONFIRMED'].includes(b.status);
  // Server adds productType='HOTEL' or 'HOLIDAY' for non-flight rows.
  // flowSubType backups the discriminator for older clients.
  const productType =
    (b as unknown as { productType?: string }).productType ?? 'FLIGHT';
  const isHotel = productType === 'HOTEL' || (b.flowSubType as unknown as string) === 'HOTEL';
  const isHoliday =
    productType === 'HOLIDAY' || (b.flowSubType as unknown as string) === 'HOLIDAY';
  const isVisa = productType === 'VISA' || (b.flowSubType as unknown as string) === 'VISA';
  const isBus = productType === 'BUS' || (b.flowSubType as unknown as string) === 'BUS';
  const isInsurance =
    productType === 'INSURANCE' || (b.flowSubType as unknown as string) === 'INSURANCE';
  const checkOutStr = b.returnDate
    ? new Date(b.returnDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          isInsurance
            ? 'INSURANCE'
            : isBus
              ? 'BUS'
              : isVisa
                ? 'VISA'
                : isHoliday
                  ? 'HOLIDAY'
                  : isHotel
                    ? 'HOTEL'
                    : b.flowSubType
        }
        title={b.bookingCode}
        description={
          isInsurance
            ? `Policy ${b.pnr ?? '—'} · ${b.sector} · Coverage from ${new Date(b.travelDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}${checkOutStr ? ` → ${checkOutStr}` : ''}`
            : isBus
              ? `TIN ${b.pnr ?? '—'} · ${b.sector} · ${new Date(b.travelDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}`
              : isVisa
                ? `Application ${b.pnr ?? '—'} · ${b.sector.replace(/^VISA · /, '')} · Expected travel ${new Date(b.travelDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}`
                : isHoliday
                  ? `Confirmation ${b.pnr ?? '—'} · ${b.sector.replace(/^HOLIDAY · /, '')} · ${new Date(b.travelDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}${checkOutStr ? ` → ${checkOutStr}` : ''}`
                  : isHotel
                    ? `Confirmation ${b.pnr ?? '—'} · ${b.sector.replace(/^HOTEL · /, '')} · ${new Date(b.travelDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}${checkOutStr ? ` → ${checkOutStr}` : ''}`
                    : `PNR ${b.pnr ?? '—'} · ${b.sector} · ${new Date(b.travelDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}`
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/bookings">
                <ArrowLeft className="h-4 w-4" /> All bookings
              </Link>
            </Button>
            {b.status === 'TICKETED' &&
            !isHotel &&
            !isHoliday &&
            !isVisa &&
            !isBus &&
            !isInsurance ? (
              <>
                <Button variant="secondary" onClick={() => downloadPdf('ticket')}>
                  <Plane className="h-4 w-4" /> e-Ticket
                </Button>
                <WebCheckInButton
                  booking={{
                    status: b.status,
                    airlinePnr: b.airlinePnr,
                    pnr: b.pnr,
                    segments: b.segments,
                    passengers: b.passengers,
                  }}
                />
              </>
            ) : null}
            <Button variant="secondary" onClick={() => downloadPdf('invoice')}>
              <Receipt className="h-4 w-4" /> Invoice
            </Button>
            {canCancel ? (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                <X className="h-4 w-4" /> Cancel
              </Button>
            ) : null}
            {canManualRefund && b.status === 'TICKETED' ? (
              <Button variant="ghost" onClick={() => setRefundOpen(true)}>
                <Receipt className="h-4 w-4" /> Manual refund
              </Button>
            ) : null}
          </div>
        }
      />

      {/* Free-void banner — only visible when the booking is
          TICKETED and we're still inside the airline's free-void
          window (default 4h after ticketing). Cancelling here costs
          ₹0 in fare-rule fees instead of the usual penalty. */}
      <VoidWindowBanner voidWindowEndsAt={b.voidWindowEndsAt ?? null} />

      <div className="grid gap-2 md:grid-cols-3 md:gap-4">
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs uppercase tracking-wider text-ink-3">Status</p>
            <StatusBadge status={b.status} />
            <p className="mt-2 text-xs text-ink-3">Payment: {b.paymentStatus}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-ink-3">Total paid</p>
            <p className="font-mono text-2xl tabular-nums">
              {formatPaiseAsINR(b.pricing.agencyPayablePaise, { compact: true })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-ink-3">Booked</p>
            <p className="text-sm">{new Date(b.createdAt).toLocaleString('en-IN')}</p>
            {b.ticketedAt ? (
              <p className="mt-1 text-xs text-ink-3">Ticketed {new Date(b.ticketedAt).toLocaleString('en-IN')}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {isInsurance ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-xs uppercase tracking-wider text-ink-3">Insurance policy</p>
            <div className="mt-3 rounded-md border bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                    <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-ink-1">
                      {b.agencyName || 'Insurance'}
                    </p>
                    <p className="text-xs text-ink-3">
                      Policy{' '}
                      <span className="font-mono font-semibold text-ink-1">
                        {b.pnr ?? '—'}
                      </span>{' '}
                      · {b.sector}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="font-mono text-[10px]">
                  ASEGO
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">
                    Coverage starts
                  </p>
                  <p className="font-mono text-base font-semibold text-ink-1">
                    {new Date(b.travelDate).toLocaleDateString('en-IN', {
                      dateStyle: 'medium',
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">
                    Coverage ends
                  </p>
                  <p className="font-mono text-base font-semibold text-ink-1">
                    {checkOutStr ?? '—'}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wider text-ink-3">
                  Traveller{b.passengers.length === 1 ? '' : 's'}
                </p>
                <p className="text-sm font-medium text-ink-1">
                  {b.passengers
                    .map((p) =>
                      [p.title, p.firstName, p.lastName].filter(Boolean).join(' '),
                    )
                    .filter((s) => s.trim().length > 0)
                    .join(', ') || '—'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : isBus ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-xs uppercase tracking-wider text-ink-3">Bus journey</p>
            <div className="mt-3 rounded-md border bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                    <BusIcon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-ink-1">{b.sector}</p>
                    <p className="text-xs text-ink-3">
                      Operator: {b.agencyName || '—'} · TIN {b.pnr ?? '—'}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="font-mono text-[10px]">
                  SEATSELLER
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">Travel date</p>
                  <p className="font-mono text-base font-semibold text-ink-1">
                    {new Date(b.travelDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">Seats</p>
                  <p className="font-mono text-base font-semibold text-ink-1">
                    {b.passengers
                      .map((p) => p.ticketNumber)
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : isVisa ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-xs uppercase tracking-wider text-ink-3">Visa application</p>
            <div className="mt-3 rounded-md border bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                    <VisaIcon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-ink-1">
                      {b.sector.replace(/^VISA · /, '')}
                    </p>
                    <p className="text-xs text-ink-3">Application {b.pnr ?? '—'}</p>
                  </div>
                </div>
                <Badge variant="outline" className="font-mono text-[10px]">MOCK SUPPLIER</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">Expected travel</p>
                  <p className="font-mono text-base font-semibold text-ink-1">
                    {new Date(b.travelDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">Applicants</p>
                  <p className="font-mono text-base font-semibold text-ink-1">
                    {b.passengers.length}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : isHoliday ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-xs uppercase tracking-wider text-ink-3">Holiday itinerary</p>
            <div className="mt-3 rounded-md border bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                    <HotelIcon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-ink-1">
                      {b.sector.replace(/^HOLIDAY · /, '')}
                    </p>
                    <p className="text-xs text-ink-3">Confirmation {b.pnr ?? '—'}</p>
                  </div>
                </div>
                <Badge variant="outline" className="font-mono text-[10px]">MOCK SUPPLIER</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">Departure</p>
                  <p className="font-mono text-base font-semibold text-ink-1">
                    {new Date(b.travelDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">Return</p>
                  <p className="font-mono text-base font-semibold text-ink-1">
                    {checkOutStr ?? '—'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : isHotel ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-xs uppercase tracking-wider text-ink-3">Hotel stay</p>
            <div className="mt-3 rounded-md border bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                    <HotelIcon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-ink-1">
                      {/* Server sets sector to "HOTEL · {city}" — strip the prefix. */}
                      {b.sector.replace(/^HOTEL · /, '')}
                    </p>
                    <p className="text-xs text-ink-3">Confirmation {b.pnr ?? '—'}</p>
                  </div>
                </div>
                <Badge variant="outline" className="font-mono text-[10px]">MOCK SUPPLIER</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">Check-in</p>
                  <p className="font-mono text-base font-semibold text-ink-1">
                    {new Date(b.travelDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wider text-ink-3">Check-out</p>
                  <p className="font-mono text-base font-semibold text-ink-1">
                    {checkOutStr ?? '—'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <p className="text-xs uppercase tracking-wider text-ink-3">Itinerary</p>
            <div className="mt-3 space-y-3">
              {b.segments.map((s, i) => (
                <div key={i} className="rounded-md border bg-surface-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <AirlineLogo code={s.airline.code} name={s.airline.name} size={28} className="rounded-md" />
                      <span className="font-mono text-sm">{s.airline.code} {s.flightNumber}</span>
                      <span className="text-xs text-ink-3">{s.airline.name ?? ''}</span>
                    </div>
                    <Badge variant="outline" className="font-mono text-[10px]">{s.duration}m</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-3 items-center gap-2 text-sm">
                    <div>
                      <p className="font-mono text-lg">{s.origin.code}</p>
                      <p className="text-xs text-ink-3">
                        {new Date(s.departure).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    </div>
                    <div className="text-center text-xs text-ink-3">
                      {s.stopOver ? `${s.stopOver}m layover` : 'non-stop'}
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-lg">{s.destination.code}</p>
                      <p className="text-xs text-ink-3">
                        {new Date(s.arrival).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6">
          <p className="text-xs uppercase tracking-wider text-ink-3">Passengers</p>
          <div className="mt-3 space-y-2">
            {b.passengers.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border bg-surface-2 p-3 text-sm">
                <div>
                  <span>{p.title} {p.firstName} {p.lastName}</span>
                  <Badge variant="outline" className="ml-2 font-mono text-[10px]">{p.type}</Badge>
                </div>
                {p.ticketNumber ? (
                  <span className="font-mono text-xs text-ink-3">#{p.ticketNumber}</span>
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <p className="text-xs uppercase tracking-wider text-ink-3">Pricing breakdown</p>
          <Separator className="my-3" />
          <div className="grid grid-cols-2 gap-2 text-sm">
            <KeyValue label="Base fare" value={formatPaiseAsINR(b.pricing.baseFarePaise)} mono />
            <KeyValue label="Taxes" value={formatPaiseAsINR(b.pricing.taxesPaise)} mono />
            <KeyValue label="Platform markup" value={formatPaiseAsINR(b.pricing.platformMarkupPaise)} mono />
            <KeyValue label="Distributor markup" value={formatPaiseAsINR(b.pricing.distributorMarkupPaise)} mono />
            <KeyValue label="Agency markup" value={formatPaiseAsINR(b.pricing.agencyMarkupPaise)} mono />
            <KeyValue label="Discount" value={`− ${formatPaiseAsINR(b.pricing.discountPaise)}`} mono />
            <KeyValue label="GST" value={formatPaiseAsINR(b.pricing.gstPaise)} mono />
            <KeyValue label="Gross" value={formatPaiseAsINR(b.pricing.grossAmountPaise)} mono />
            <KeyValue label="Agency pays" value={formatPaiseAsINR(b.pricing.agencyPayablePaise)} mono />
          </div>
        </CardContent>
      </Card>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {b.bookingCode}?</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <p className="text-sm text-ink-3">
              Cancellation fees apply per the supplier's fare rule. Refund will be credited to your wallet.
            </p>
            <Input
              placeholder="Reason for cancellation"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep booking</Button>
            <Button
              variant="danger"
              disabled={cancelReason.trim().length < 3 || cancel.isPending}
              onClick={() => cancel.mutate({ reason: cancelReason.trim() })}
            >
              {cancel.isPending ? 'Cancelling…' : 'Cancel & refund'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual refund dialog — admin-only override outside the
          auto-refund path. Caps at booking total server-side. */}
      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual refund</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <p className="text-sm text-ink-3">
              Credit the agency wallet outside the normal cancellation flow.
              Use for goodwill credits, support escalations, or compensation
              after the auto-refund window. Maximum:{' '}
              <span className="font-mono font-bold text-ink-1">
                {formatPaiseAsINR(b.pricing.agencyPayablePaise)}
              </span>
              .
            </p>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Amount (₹)
              </label>
              <Input
                type="number"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                placeholder="e.g. 500"
                min={1}
                max={b.pricing.agencyPayablePaise / 100}
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Reason (≥10 chars, mandatory)
              </label>
              <Input
                placeholder="Goodwill credit — flight delayed 4h on customer's first leg"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRefundOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !refundAmount ||
                Number.parseFloat(refundAmount) <= 0 ||
                refundReason.trim().length < 10 ||
                refund.isPending
              }
              onClick={() =>
                refund.mutate({
                  amountPaise: Math.round(Number.parseFloat(refundAmount) * 100),
                  reason: refundReason.trim(),
                })
              }
            >
              {refund.isPending ? 'Refunding…' : 'Credit wallet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * VoidWindowBanner — sticky emerald banner shown when the booking is
 * still within the airline's free-void window (default 4h after
 * ticketing). Ticks every second and self-hides once expired.
 *
 * Backed by `booking.voidWindowEndsAt` which the API computes from
 * `ticketedAt + TRIPBNG_FLIGHT_VOID_WINDOW_HOURS`. Server-side enforcement
 * lives in `cancelBooking()` — the banner is purely a UX cue that
 * matches the actual fee-waiver behaviour.
 */
function VoidWindowBanner({ voidWindowEndsAt }: { voidWindowEndsAt: string | null }) {
  const [remaining, setRemaining] = useState<number>(() => {
    if (!voidWindowEndsAt) return 0;
    return Math.max(0, new Date(voidWindowEndsAt).getTime() - Date.now());
  });

  useEffect(() => {
    if (!voidWindowEndsAt) return;
    const tick = () => {
      setRemaining(Math.max(0, new Date(voidWindowEndsAt).getTime() - Date.now()));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [voidWindowEndsAt]);

  if (!voidWindowEndsAt || remaining <= 0) return null;

  const totalSec = Math.floor(remaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const display = h > 0 ? `${h}h ${m}m ${String(s).padStart(2, '0')}s` : `${m}m ${String(s).padStart(2, '0')}s`;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-gradient-to-r from-emerald-50 to-surface-1 px-4 py-2.5 dark:border-emerald-500/40 dark:from-emerald-500/15">
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
          <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-[13px] font-bold text-emerald-800 dark:text-emerald-200">
            Free cancellation available
          </p>
          <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
            Cancel within the window to skip the airline's fare-rule penalty entirely.
          </p>
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-2.5 py-1 font-mono text-[12px] font-bold tabular-nums text-emerald-800 shadow-sm dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
        <Clock className="h-3 w-3" strokeWidth={2} />
        {display}
      </span>
    </div>
  );
}
