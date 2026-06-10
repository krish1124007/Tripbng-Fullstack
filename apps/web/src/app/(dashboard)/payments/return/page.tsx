'use client';

// Payment return page — the destination payment gateways (PhonePe, etc.)
// redirect to after the customer completes payment.
//
// Flow:
//   1. We receive `?txnCode=...` in the URL
//   2. Poll /api/v1/payments/:txnCode/status until terminal (SUCCESS / FAILED)
//   3. On SUCCESS:
//        - If sessionStorage has a pending booking payment matching this
//          txnCode → call /bookings/confirm to ticket it, then navigate
//          to /bookings/:id
//        - Otherwise (plain wallet top-up flow) → navigate to /wallet
//   4. On FAILED: show the error and give the agent retry / back actions
//
// The page is intentionally robust to refreshes and back-button traffic
// from the gateway — polling resumes from wherever the txn state is and
// the session-stash key is cleared on terminal states.

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Loader2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ConfirmBookingRequest, PublicBooking } from '@tripbng/shared';
import { Button, Card, CardContent, Skeleton } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatPaiseAsINR } from '@/lib/money';

type TxnStatus =
  | 'INITIATED'
  | 'PENDING'
  | 'AT_GATEWAY'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

interface TxnStatusResponse {
  txnCode: string;
  status: TxnStatus;
  amount: number;
  providerCode: 'ICICI_ORANGE_PG' | 'PHONEPE';
  paymentInstrument?: string | null;
}

interface PendingBookingPayment {
  bookingId: string;
  txnCode: string;
  providerCode: string;
  amountPaise: number;
  createdAt: number;
}

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

export default function PaymentReturnPage() {
  return (
    <Suspense fallback={<ReturnSkeleton />}>
      <ReturnInner />
    </Suspense>
  );
}

function ReturnInner() {
  const router = useRouter();
  const params = useSearchParams();
  const accessToken = useAuthStore((s) => s.accessToken);
  const txnCode = params.get('txnCode') ?? '';

  const [status, setStatus] = useState<TxnStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [bookedId, setBookedId] = useState<string | null>(null);

  // Read the booking-payment stash on mount. It's only relevant when
  // the user kicked off this payment from the booking flow — wallet
  // top-ups from the wallet page won't have it set.
  const pendingPayment = useMemo<PendingBookingPayment | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem('pendingBookingPayment');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PendingBookingPayment;
      if (parsed.txnCode !== txnCode) return null;
      return parsed;
    } catch {
      return null;
    }
  }, [txnCode]);

  // Poll loop — exits on terminal state or timeout.
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollStartedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!txnCode) return;
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        const res = await apiFetch<TxnStatusResponse>(
          `/api/v1/payments/${encodeURIComponent(txnCode)}/status`,
          { accessToken },
        );
        if (cancelled) return;
        setStatus(res);
        setError(null);
        if (isTerminal(res.status)) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Could not check status';
        setError(msg);
      }
      if (Date.now() - pollStartedAtRef.current > POLL_TIMEOUT_MS) {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        setError('Payment is taking longer than expected. Check My bookings later.');
      }
    }

    void tick();
    pollIntervalRef.current = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [txnCode, accessToken]);

  // When the payment lands on SUCCESS and we have a stashed booking,
  // run /bookings/confirm exactly once to ticket the booking.
  const confirmFiredRef = useRef(false);
  useEffect(() => {
    if (!status || status.status !== 'SUCCESS') return;
    if (!pendingPayment) return;
    if (confirmFiredRef.current) return;
    confirmFiredRef.current = true;

    setConfirming(true);
    const body: ConfirmBookingRequest = {
      bookingId: pendingPayment.bookingId,
      paymentMode: 'WALLET',
      acceptTerms: true,
    };
    apiFetch<PublicBooking>('/api/v1/bookings/confirm', {
      method: 'POST',
      body,
      accessToken,
    })
      .then((b) => {
        setBookedId(b.id);
        sessionStorage.removeItem('pendingBookingPayment');
        toast.success(`Ticketed — PNR ${b.pnr ?? '—'}`);
        // Auto-redirect after a beat so the agent can see the success
        // state before being taken to the ticket page.
        setTimeout(() => router.push(`/bookings/${b.id}`), 1500);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Could not ticket the booking';
        setError(msg);
        confirmFiredRef.current = false; // allow a retry
      })
      .finally(() => setConfirming(false));
  }, [status, pendingPayment, accessToken, router]);

  // ────────── Render ──────────

  if (!txnCode) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-warning" />
          <p className="mt-3 text-sm text-ink-2">
            Missing payment reference. Open My bookings to check your transactions.
          </p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => router.push('/bookings')}>
            Go to My bookings
          </Button>
        </CardContent>
      </Card>
    );
  }

  const s = status?.status;
  const isPending = !s || ['INITIATED', 'PENDING', 'AT_GATEWAY'].includes(s);
  const isSuccess = s === 'SUCCESS';
  const isFailed = s && ['FAILED', 'CANCELLED', 'EXPIRED'].includes(s);

  return (
    <div className="mx-auto max-w-2xl py-10">
      <Card>
        <CardContent className="p-8">
          {/* Headline */}
          <div className="mb-6 flex items-start gap-4">
            <StatusIcon status={s ?? 'PENDING'} />
            <div>
              <h1 className="text-xl font-bold text-ink-1">{headline(s, confirming, bookedId)}</h1>
              <p className="mt-1 text-sm text-ink-3">{subline(s, status, pendingPayment)}</p>
            </div>
          </div>

          {/* Amount + provider */}
          {status ? (
            <div className="mb-6 grid grid-cols-1 gap-3 rounded-lg border bg-surface-2/30 p-4 sm:grid-cols-2 sm:gap-4">
              <Field label="Amount" value={formatPaiseAsINR(status.amount)} mono />
              <Field label="Provider" value={providerLabel(status.providerCode)} />
              {status.paymentInstrument ? (
                <Field label="Instrument" value={status.paymentInstrument} />
              ) : null}
              <Field label="Reference" value={txnCode} mono />
            </div>
          ) : null}

          {/* Error band */}
          {error ? (
            <div className="mb-6 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isFailed ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (pendingPayment) {
                      router.push(`/bookings/${pendingPayment.bookingId}`);
                    } else {
                      router.push('/wallet');
                    }
                  }}
                >
                  Back to {pendingPayment ? 'booking' : 'wallet'}
                </Button>
                <Button
                  onClick={() => router.push(pendingPayment ? `/bookings/${pendingPayment.bookingId}` : '/wallet')}
                >
                  Try again <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            ) : isSuccess ? (
              bookedId ? (
                <Button onClick={() => router.push(`/bookings/${bookedId}`)}>
                  Open ticket <ChevronRight className="h-4 w-4" />
                </Button>
              ) : pendingPayment ? (
                <Button disabled loading>
                  Issuing ticket…
                </Button>
              ) : (
                <Button onClick={() => router.push('/wallet')}>
                  Open wallet <ChevronRight className="h-4 w-4" />
                </Button>
              )
            ) : isPending ? (
              <Button variant="secondary" disabled loading>
                Waiting for confirmation…
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusIcon({ status }: { status: TxnStatus }) {
  if (status === 'SUCCESS') {
    return (
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
        <CheckCircle2 className="h-7 w-7" strokeWidth={1.75} />
      </span>
    );
  }
  if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(status)) {
    return (
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
        <XCircle className="h-7 w-7" strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
      <Loader2 className="h-7 w-7 animate-spin" strokeWidth={1.75} />
    </span>
  );
}

function headline(status: TxnStatus | undefined, confirming: boolean, bookedId: string | null): string {
  if (!status) return 'Checking payment status…';
  if (status === 'SUCCESS') {
    if (bookedId) return 'Booking confirmed — ticket issued';
    if (confirming) return 'Payment received — issuing ticket…';
    return 'Payment received';
  }
  if (status === 'FAILED') return 'Payment failed';
  if (status === 'CANCELLED') return 'Payment cancelled';
  if (status === 'EXPIRED') return 'Payment expired';
  return 'Waiting for the gateway…';
}

function subline(
  status: TxnStatus | undefined,
  res: TxnStatusResponse | null,
  pending: PendingBookingPayment | null,
): string {
  if (!status) return 'Hang on while we confirm with the bank.';
  if (status === 'SUCCESS') {
    if (pending) return `Funds added to your wallet — confirming the booking now.`;
    return `Funds added to your wallet.`;
  }
  if (status === 'FAILED') return 'The bank rejected this transaction. No money was debited.';
  if (status === 'CANCELLED') return 'You cancelled the transaction at the gateway.';
  if (status === 'EXPIRED') return 'The gateway session expired. Please retry.';
  return res?.providerCode === 'PHONEPE'
    ? 'Confirming with PhonePe — this usually takes a few seconds.'
    : 'Confirming with the bank — this usually takes a few seconds.';
}

function providerLabel(providerCode: string): string {
  if (providerCode === 'ICICI_ORANGE_PG') return 'ICICI Bank';
  if (providerCode === 'PHONEPE') return 'PhonePe';
  return providerCode;
}

function isTerminal(s: TxnStatus): boolean {
  return ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(s);
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{label}</p>
      <p className={mono ? 'mt-0.5 font-mono text-[13px] font-bold text-ink-1' : 'mt-0.5 text-[13px] font-bold text-ink-1'}>
        {value}
      </p>
    </div>
  );
}

function ReturnSkeleton() {
  return (
    <div className="mx-auto max-w-2xl py-10">
      <Card>
        <CardContent className="p-8 space-y-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
