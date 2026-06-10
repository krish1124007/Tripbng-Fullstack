'use client';

// Sticky right rail on /visa/products/[id]. Holds the customer's selection
// (pax counts + urgent toggle), runs the live quote off the product's
// priceMatrix via lib/visa-quote.ts, and adds the application to the topbar
// cart on CTA click. The whole calculation runs client-side — no extra
// network round-trip on every input change.

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Info,
  Minus,
  Plus,
  Sparkles,
  Users as UsersIcon,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AdminVisaProduct } from '@tripbng/shared';
import { Badge, Button, Card, CardContent } from '@/components/ui';
import { quoteVisaProduct } from '@/lib/visa-quote';
import { useCart } from '@/lib/cart';
import { BookAndPayDialog } from '@/app/(dashboard)/visa/products/[id]/_book-and-pay-dialog';

interface Selection {
  adults: number;
  children: number;
  infants: number;
  urgent: boolean;
}

export function BookingRail({ product }: { product: AdminVisaProduct }) {
  const addToCart = useCart((s) => s.addItem);
  const [bookOpen, setBookOpen] = useState(false);

  const [sel, setSel] = useState<Selection>({
    adults: 1,
    children: 0,
    infants: 0,
    urgent: false,
  });

  const totalPax = sel.adults + sel.children + sel.infants;

  const breakdown = useMemo(
    () =>
      quoteVisaProduct(product, {
        totalPax,
        urgent: sel.urgent && product.urgentAvailable,
      }),
    [product, totalPax, sel.urgent],
  );

  const onAdd = () => {
    if (sel.adults < 1) {
      toast.error('At least one adult applicant is required.');
      return;
    }
    addToCart({
      id: `visa:${product.id ?? product.name}`,
      kind: 'visa',
      title: `${product.countryName} · ${product.name}`,
      subtitle: `${product.purpose} visa · ${totalPax} applicant${totalPax === 1 ? '' : 's'}${sel.urgent && product.urgentAvailable ? ' · Urgent' : ''}`,
      datePrimary: new Date().toISOString().slice(0, 10),
      priceRupees: breakdown.totalInr,
      qty: totalPax || 1,
      meta: {
        countryIso2: product.countryIso2,
        purpose: product.purpose,
        urgent: sel.urgent && product.urgentAvailable,
        adults: sel.adults,
        children: sel.children,
        infants: sel.infants,
        breakdown,
      },
    });
    toast.success(`${product.name} added to your itinerary`, {
      description: 'Open the cart in the topbar to review or generate a quote.',
    });
  };

  return (
    <Card className="md:sticky md:top-4">
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="eyebrow text-ink-3">Live total</p>
          <p className="font-mono text-3xl font-bold tabular-nums text-ink-1">
            ₹{breakdown.totalInr.toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-ink-3">
            {totalPax} applicant{totalPax === 1 ? '' : 's'} · all-in
          </p>
          {breakdown.matchedLabel ? (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <Sparkles className="h-2.5 w-2.5" /> {breakdown.matchedLabel}
            </p>
          ) : null}
        </div>

        {/* Pax counters */}
        <Field label="Adults">
          <Counter
            value={sel.adults}
            onChange={(n) => setSel({ ...sel, adults: n })}
            min={1}
            max={20}
          />
        </Field>
        <Field label="Children" hint="2–11 years">
          <Counter
            value={sel.children}
            onChange={(n) => setSel({ ...sel, children: n })}
            min={0}
            max={10}
          />
        </Field>
        <Field label="Infants" hint="under 2">
          <Counter
            value={sel.infants}
            onChange={(n) => setSel({ ...sel, infants: n })}
            min={0}
            max={5}
          />
        </Field>

        {/* Urgent toggle (only when available) */}
        {product.urgentAvailable ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-surface-2/30 p-3">
            <input
              type="checkbox"
              checked={sel.urgent}
              onChange={(e) => setSel({ ...sel, urgent: e.target.checked })}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-600"
            />
            <div>
              <p className="inline-flex items-center gap-1 text-sm font-semibold text-ink-1">
                <Zap className="h-3.5 w-3.5 text-warning" /> Urgent processing
              </p>
              <p className="text-[11px] text-ink-3">
                {product.urgentProcessingDays} day
                {product.urgentProcessingDays === 1 ? '' : 's'} instead of {product.processingDays} ·
                ₹{(product.urgentSurchargeInr ?? 0).toLocaleString('en-IN')}/applicant surcharge
              </p>
            </div>
          </label>
        ) : null}

        {/* Live breakdown */}
        <div className="rounded-md border bg-surface-2/40 p-3 text-xs">
          <Row label={`Consulate × ${totalPax}`}>
            ₹{breakdown.consulateSubtotalInr.toLocaleString('en-IN')}
          </Row>
          <Row label={`Service × ${totalPax}`}>
            ₹{breakdown.serviceSubtotalInr.toLocaleString('en-IN')}
          </Row>
          {breakdown.urgentSubtotalInr > 0 ? (
            <Row label={`Urgent surcharge × ${totalPax}`}>
              ₹{breakdown.urgentSubtotalInr.toLocaleString('en-IN')}
            </Row>
          ) : null}
          <Row label="GST 18% on service">₹{breakdown.gstInr.toLocaleString('en-IN')}</Row>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
            <span className="font-semibold text-ink-1">Total</span>
            <span className="font-mono font-bold tabular-nums text-ink-1">
              ₹{breakdown.totalInr.toLocaleString('en-IN')}
            </span>
          </div>
        </div>

        {!breakdown.matrixHit ? (
          <p className="flex items-start gap-1.5 text-[10px] text-ink-3">
            <Info className="mt-0.5 h-3 w-3 shrink-0" /> No matrix row matched this pax band — base
            fees applied.
          </p>
        ) : null}

        <Button
          onClick={() => {
            if (sel.adults < 1) {
              toast.error('At least one adult applicant is required.');
              return;
            }
            setBookOpen(true);
          }}
          size="lg"
          className="w-full"
        >
          Book &amp; pay ₹{breakdown.totalInr.toLocaleString('en-IN')}{' '}
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button onClick={onAdd} variant="secondary" size="md" className="w-full">
          Add to itinerary
        </Button>
        <p className="flex items-center justify-center gap-1 text-[10px] text-ink-3">
          <CheckCircle2 className="h-3 w-3 text-success" /> Wallet debit on confirm.
        </p>

        {product.biometricRequired ? (
          <Badge variant="accent" className="w-full justify-center text-[9px]">
            Biometric appointment required after submission
          </Badge>
        ) : null}
      </CardContent>

      <BookAndPayDialog
        open={bookOpen}
        onOpenChange={setBookOpen}
        product={product}
        selection={{
          urgent: sel.urgent && product.urgentAvailable,
          totalInr: breakdown.totalInr,
        }}
      />
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
        {hint ? <span className="ml-1 normal-case text-ink-3/80"> · {hint}</span> : null}
      </p>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-ink-3">{label}</span>
      <span className="font-mono tabular-nums text-ink-1">{children}</span>
    </div>
  );
}

function Counter({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="grid h-9 w-9 place-items-center rounded-md border text-ink-3 transition-colors hover:border-ink-5 hover:text-ink-1 disabled:opacity-40"
        aria-label="Decrement"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="flex-1 text-center font-mono text-sm font-semibold tabular-nums">
        <UsersIcon className="mr-1 inline h-3 w-3 text-ink-3" />
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="grid h-9 w-9 place-items-center rounded-md border text-ink-3 transition-colors hover:border-ink-5 hover:text-ink-1 disabled:opacity-40"
        aria-label="Increment"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
