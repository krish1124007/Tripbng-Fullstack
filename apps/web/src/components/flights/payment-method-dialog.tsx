'use client';

// PaymentMethodDialog — the "Pay Now" interstitial.
//
// Opens after a successful /bookings/hold call. Lets the agent pick
// how to settle the ticket:
//
//   • Wallet         — instant if balance ≥ totalToPay → confirm → ticket
//   • ICICI Eazypay  — redirect to ICICI's PG, on return we top up the
//                       wallet and auto-confirm
//   • PhonePe        — same redirect pattern, different provider
//
// Gateway flow uses the existing /api/v1/payments/topups/initiate +
// /api/v1/bookings/confirm endpoints — no new backend needed. We
// stash { bookingId, paymentMode } in sessionStorage before the
// redirect so the /payments/return page can complete the booking.

import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Loader2,
  ShieldCheck,
  Smartphone,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  ConfirmBookingRequest,
  PublicBooking,
  WalletSummary,
} from '@tripbng/shared';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';

type ProviderCode = 'ICICI_EAZYPAY' | 'PHONEPE';

interface InitiateTopupResponse {
  paymentTxnId: string;
  txnCode: string;
  redirectUrl: string;
  method: 'GET' | 'POST';
  formFields?: Record<string, string>;
  expiresAt: string;
}

export interface PaymentMethodDialogProps {
  open: boolean;
  onClose: () => void;
  /** Booking id returned from /bookings/hold. Required — the dialog
   *  only opens after hold succeeds. */
  bookingId: string;
  /** Gross amount the agent needs to settle (in paise). */
  amountPaise: number;
  /** Wallet snapshot so we can show the balance and enable the wallet
   *  option only when it covers the booking. */
  wallet: WalletSummary | null;
  /** Called after a Wallet-mode payment completes successfully. The
   *  parent navigates to the ticket page. */
  onWalletSuccess: (booking: PublicBooking) => void;
}

export function PaymentMethodDialog({
  open,
  onClose,
  bookingId,
  amountPaise,
  wallet,
  onWalletSuccess,
}: PaymentMethodDialogProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [busy, setBusy] = useState<null | 'WALLET' | ProviderCode>(null);

  const walletBalance = wallet?.walletBalancePaise ?? 0;
  const creditLimit = wallet?.creditLimitPaise ?? 0;
  const walletCovers = walletBalance >= amountPaise;
  const creditCovers = walletBalance + creditLimit >= amountPaise;

  async function payFromWallet() {
    if (busy !== null) return; // double-click guard
    setBusy('WALLET');
    try {
      const body: ConfirmBookingRequest = {
        bookingId,
        paymentMode: walletCovers ? 'WALLET' : 'CREDIT',
        acceptTerms: true,
      };
      // Idempotency key — backend replays the original response if the
      // agent rapid-double-clicks "Pay & ticket". Prevents duplicate
      // wallet debits + duplicate PNRs.
      const idempotencyKey = generatePaymentIdempotencyKey();
      const booking = await apiFetch<PublicBooking>('/api/v1/bookings/confirm', {
        method: 'POST',
        body,
        accessToken,
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      toast.success(`Ticketed — PNR ${booking.pnr ?? '—'}`);
      onWalletSuccess(booking);
    } catch (err) {
      console.error('Wallet payment failed', err);
      const msg = err instanceof Error ? err.message : 'Wallet payment failed';
      toast.error(msg);
      setBusy(null);
    }
  }

  async function payViaGateway(providerCode: ProviderCode) {
    if (busy !== null) return; // double-click guard
    setBusy(providerCode);
    try {
      // Idempotency on the topup initiate call too — repeat clicks
      // return the same redirect URL instead of creating two PTs.
      const idempotencyKey = generatePaymentIdempotencyKey();
      const init = await apiFetch<InitiateTopupResponse>(
        '/api/v1/payments/topups/initiate',
        {
          method: 'POST',
          // bookingId tells the gateway-webhook worker which booking
          // to auto-confirm on SUCCESS. Without it the topup just
          // credits the wallet and the agent has to confirm manually.
          body: { amount: amountPaise, providerCode, bookingId },
          accessToken,
          headers: { 'Idempotency-Key': idempotencyKey },
        },
      );

      // Stash booking + payment context so /payments/return can
      // pick up where we left off after the gateway redirects back.
      sessionStorage.setItem(
        'pendingBookingPayment',
        JSON.stringify({
          bookingId,
          txnCode: init.txnCode,
          providerCode,
          amountPaise,
          createdAt: Date.now(),
        }),
      );

      if (init.method === 'GET') {
        window.location.href = init.redirectUrl;
        return;
      }

      // POST redirect — build a self-submitting form. ICICI Eazypay
      // expects encrypted fields posted to the bank URL.
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = init.redirectUrl;
      form.style.display = 'none';
      for (const [k, v] of Object.entries(init.formFields ?? {})) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = k;
        input.value = v;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      console.error('Gateway initiate failed', err);
      const msg = err instanceof Error ? err.message : 'Could not start payment';
      toast.error(msg);
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <CreditCard className="h-4 w-4" strokeWidth={2} />
            </span>
            <div>
              <DialogTitle>Choose payment method</DialogTitle>
              <p className="mt-0.5 text-[12px] text-ink-3">
                Total payable:{' '}
                <span className="font-mono font-bold text-ink-1">
                  {formatPaiseAsINR(amountPaise)}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            aria-label="Close"
            className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink-1 disabled:opacity-40"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {/* Wallet card */}
          <PaymentMethodCard
            icon={Wallet}
            tone="brand"
            title="Pay from Wallet"
            subtitle={
              wallet
                ? `Balance ${formatPaiseAsINR(walletBalance)}${
                    creditLimit > 0 ? ` + ₹${(creditLimit / 100).toLocaleString('en-IN')} credit` : ''
                  }`
                : 'Loading balance…'
            }
            disabled={!wallet || (!walletCovers && !creditCovers) || busy !== null}
            busy={busy === 'WALLET'}
            badge={
              walletCovers
                ? { label: 'Instant', tone: 'success' }
                : creditCovers
                  ? { label: 'Uses credit line', tone: 'warning' }
                  : { label: 'Insufficient', tone: 'danger' }
            }
            onClick={payFromWallet}
            cta={walletCovers ? 'Pay & ticket' : creditCovers ? 'Pay via credit' : 'Top up needed'}
          />

          {/* ICICI Eazypay card */}
          <PaymentMethodCard
            icon={CreditCard}
            tone="info"
            title="Pay via ICICI Eazypay"
            subtitle="Net banking · UPI · Card — settles to your wallet first"
            disabled={busy !== null}
            busy={busy === 'ICICI_EAZYPAY'}
            badge={{ label: 'Redirect to bank', tone: 'neutral' }}
            onClick={() => payViaGateway('ICICI_EAZYPAY')}
            cta="Continue to ICICI"
          />

          {/* PhonePe card */}
          <PaymentMethodCard
            icon={Smartphone}
            tone="accent"
            title="Pay via PhonePe"
            subtitle="UPI · Wallet · Cards — settles to your wallet first"
            disabled={busy !== null}
            busy={busy === 'PHONEPE'}
            badge={{ label: 'Redirect to PhonePe', tone: 'neutral' }}
            onClick={() => payViaGateway('PHONEPE')}
            cta="Continue to PhonePe"
          />

          <div className="mt-2 flex items-start gap-2 rounded-md border border-stroke-1 bg-surface-2/40 px-3 py-2 text-[11px] text-ink-3">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" strokeWidth={1.75} />
            <span>
              The booking stays held for 30 minutes. Gateway payments add funds to your
              wallet and auto-confirm the ticket. If a payment fails, the seats remain
              held until expiry — retry from <span className="font-mono">My bookings</span>.
            </span>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// ────────── Single payment-method card ──────────

interface PaymentMethodCardProps {
  icon: typeof Wallet;
  tone: 'brand' | 'info' | 'accent';
  title: string;
  subtitle: string;
  disabled: boolean;
  busy: boolean;
  badge?: { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' };
  onClick: () => void;
  cta: string;
}

function PaymentMethodCard({
  icon: Icon,
  tone,
  title,
  subtitle,
  disabled,
  busy,
  badge,
  onClick,
  cta,
}: PaymentMethodCardProps) {
  const toneIconClass = {
    brand: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
    info: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    accent: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  }[tone];
  const badgeToneClass = badge
    ? {
        success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
        warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
        danger: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
        neutral: 'bg-surface-2 text-ink-2',
      }[badge.tone]
    : '';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg border bg-surface-1 px-4 py-3 text-left transition-all',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer hover:border-brand-400 hover:shadow-md',
      )}
    >
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-md', toneIconClass)}>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-bold text-ink-1">{title}</p>
          {badge ? (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                badgeToneClass,
              )}
            >
              {badge.label}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-ink-3">{subtitle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-brand-700 dark:text-brand-300">
        {busy ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            Processing…
          </>
        ) : (
          <>
            {cta}
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </>
        )}
      </div>
    </button>
  );
}

/**
 * Generate a client-side idempotency key for a single payment action.
 * The backend middleware (apps/api/src/middleware/idempotency.ts)
 * stores the first response keyed on (caller, route, key) for 24h and
 * replays it on any duplicate request — so a rapid double-click on
 * Pay never mints two PNRs or two wallet debits.
 */
function generatePaymentIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Re-export for parent use (avoids needing two imports).
export { CheckCircle2 };
