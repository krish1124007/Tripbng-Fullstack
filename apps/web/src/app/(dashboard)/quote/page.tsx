'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Bus,
  CheckCircle2,
  FileText,
  Hotel,
  Mail,
  Phone,
  PlaneTakeoff,
  Printer,
  Send,
  ShieldCheck,
  StickyNote,
  TreePalm,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Separator,
} from '@/components/ui';
import { Logo } from '@/components/logo';
import { useCart, type CartItemKind } from '@/lib/cart';
import { useAuthStore } from '@/lib/auth-store';
import { formatRupees } from '@/lib/mock-search';

const KIND_META: Record<CartItemKind, { label: string; icon: LucideIcon }> = {
  flight: { label: 'Flight', icon: PlaneTakeoff },
  hotel: { label: 'Hotel', icon: Hotel },
  bus: { label: 'Bus', icon: Bus },
  holiday: { label: 'Holiday', icon: TreePalm },
  visa: { label: 'Visa', icon: StickyNote },
  insurance: { label: 'Insurance', icon: ShieldCheck },
};

const TERMS = [
  'All fares are subject to availability at the time of confirmation. Prices may change if the supplier revises rates before issuance.',
  'Hotel rates and visa fees include applicable government taxes. Service charges and GST levied separately on commission earnings.',
  'Refunds are governed by the supplier\'s fare and cancellation policy. TripBng acts as a facilitator only.',
  'Travellers must hold passports valid for at least six months beyond the date of return travel.',
  'Visa is the prerogative of the consulate or embassy. We do not guarantee approval; consulate fees are non-refundable on rejection.',
];

export default function QuotePage() {
  const items = useCart((s) => s.items);
  const user = useAuthStore((s) => s.user);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [discountPct, setDiscountPct] = useState('0');
  const [validityDays, setValidityDays] = useState('7');

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.priceRupees, 0),
    [items],
  );
  const discountAmount = Math.round((subtotal * (parseFloat(discountPct) || 0)) / 100);
  const afterDiscount = subtotal - discountAmount;
  // Service fee + GST (illustrative — replace with real engine when wired)
  const serviceFee = Math.round(afterDiscount * 0.015);
  const gst = Math.round(serviceFee * 0.18);
  const grandTotal = afterDiscount + serviceFee + gst;

  const validUntil = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + (parseInt(validityDays, 10) || 7));
    return d.toISOString().slice(0, 10);
  }, [validityDays]);

  const quoteNumber = useMemo(() => {
    // Stable mock id derived from current minute — same quote within a minute.
    const ts = new Date();
    return `QT-${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}-${String(ts.getHours() * 60 + ts.getMinutes()).padStart(4, '0')}`;
  }, []);

  const onPrint = () => {
    window.print();
  };

  const onSend = () => {
    if (!customerEmail.trim()) {
      toast.error('Add a customer email to send the quote');
      return;
    }
    toast.success(`Quote ${quoteNumber} prepared for ${customerEmail}`, {
      description: 'Email delivery activates with your distributor partnership. PDF available via Print.',
    });
  };

  if (items.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Operate · Quote"
          title="Quote builder"
          description="Compose a multi-product quote from your cart and send it to the traveller."
        />
        <EmptyState
          icon={FileText}
          title="No itinerary to quote yet"
          description="Add items from any product page first — flights, hotels, buses, holidays, visa, insurance — then come back to compose the quote."
          action={
            <Button asChild>
              <Link href="/flights">
                <PlaneTakeoff className="h-4 w-4" /> Search flights
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Action bar — hidden in print */}
      <div data-print="hide" className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" asChild size="sm">
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={onPrint}>
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </Button>
          <Button onClick={onSend}>
            <Send className="h-4 w-4" /> Email to traveller
          </Button>
        </div>
      </div>

      {/* Editable controls — hidden in print */}
      <Card data-print="hide" tone="brand">
        <CardContent className="grid gap-4 p-5 lg:grid-cols-[1.3fr_1fr_1fr_0.7fr]">
          <div className="space-y-1.5">
            <Label htmlFor="customerName" className="eyebrow text-ink-3">Quote for</Label>
            <Input
              id="customerName"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer / company name"
              leading={<Users className="h-4 w-4" strokeWidth={1.75} />}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customerEmail" className="eyebrow text-ink-3">Email</Label>
            <Input
              id="customerEmail"
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="customer@email.com"
              leading={<Mail className="h-4 w-4" strokeWidth={1.75} />}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customerPhone" className="eyebrow text-ink-3">Phone</Label>
            <Input
              id="customerPhone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+91 9876 543210"
              leading={<Phone className="h-4 w-4" strokeWidth={1.75} />}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="validityDays" className="eyebrow text-ink-3">Valid for (days)</Label>
            <Input
              id="validityDays"
              type="number"
              value={validityDays}
              min="1"
              max="30"
              onChange={(e) => setValidityDays(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 lg:col-span-3">
            <Label htmlFor="notes" className="eyebrow text-ink-3">Notes for the traveller</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Includes airport transfers, vegetarian meals on request"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discount" className="eyebrow text-ink-3">Discount %</Label>
            <Input
              id="discount"
              type="number"
              value={discountPct}
              min="0"
              max="50"
              step="0.5"
              onChange={(e) => setDiscountPct(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* The printable quote */}
      <article className="quote-doc rounded-xl border bg-surface-1 p-8 shadow-sm lg:p-12">
        {/* Document header */}
        <header className="grid grid-cols-1 gap-8 border-b pb-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <Logo variant="full" className="h-8" />
            <p className="mt-3 text-xs leading-relaxed text-ink-3">
              {user?.fullName ? <span className="block font-semibold text-ink-1">{user.fullName}</span> : null}
              {user?.email ? <span className="block">{user.email}</span> : null}
              {user?.userCode ? <span className="block font-mono">Agency code: {user.userCode}</span> : null}
            </p>
          </div>
          <div className="text-right">
            <p className="eyebrow text-ink-3">Quote</p>
            <p className="font-mono text-2xl font-bold tabular-nums text-ink-1">{quoteNumber}</p>
            <p className="mt-1 text-xs text-ink-3">
              Issued {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
            <Badge variant="brand" dot className="mt-2">
              Valid until{' '}
              <span className="ml-0.5 font-mono">
                {new Date(validUntil).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </Badge>
          </div>
        </header>

        {/* Quote for */}
        <section className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="eyebrow text-ink-3">Quote for</p>
            <p className="mt-1 text-base font-semibold text-ink-1">
              {customerName.trim() || '—'}
            </p>
            <p className="text-xs text-ink-3">
              {[customerEmail, customerPhone].filter(Boolean).join(' · ') || ' '}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="eyebrow text-ink-3">Itinerary scope</p>
            <p className="mt-1 text-base font-semibold text-ink-1">
              {items.length} item{items.length === 1 ? '' : 's'} ·{' '}
              {Object.keys(
                items.reduce<Record<CartItemKind, true>>((acc, i) => ({ ...acc, [i.kind]: true }), {} as Record<CartItemKind, true>),
              ).length}{' '}
              product{' '}
              {Object.keys(
                items.reduce<Record<CartItemKind, true>>((acc, i) => ({ ...acc, [i.kind]: true }), {} as Record<CartItemKind, true>),
              ).length === 1
                ? 'line'
                : 'lines'}
            </p>
          </div>
        </section>

        {/* Itinerary table */}
        <section className="mt-8">
          <p className="eyebrow mb-3 text-ink-3">Itinerary</p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b bg-surface-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-4 py-2.5 text-left">#</th>
                  <th className="px-4 py-2.5 text-left">Product</th>
                  <th className="px-4 py-2.5 text-left">Description</th>
                  <th className="px-4 py-2.5 text-left">Dates</th>
                  <th className="px-4 py-2.5 text-right">Pax / Qty</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => {
                  const meta = KIND_META[i.kind];
                  const Icon = meta.icon;
                  return (
                    <tr key={i.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3 align-top font-mono text-xs text-ink-3">
                        {String(idx + 1).padStart(2, '0')}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-1">
                          <Icon className="h-3.5 w-3.5 text-brand-600" strokeWidth={1.75} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="text-sm font-semibold text-ink-1">{i.title}</p>
                        {i.subtitle ? <p className="mt-0.5 text-xs text-ink-3">{i.subtitle}</p> : null}
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-xs tabular-nums text-ink-2">
                        {i.datePrimary
                          ? new Date(i.datePrimary).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                            })
                          : '—'}
                        {i.dateSecondary
                          ? ' → ' +
                            new Date(i.dateSecondary).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                            })
                          : ''}
                      </td>
                      <td className="px-4 py-3 align-top text-right font-mono text-xs tabular-nums">
                        {i.qty ?? 1}
                      </td>
                      <td className="px-4 py-3 align-top text-right font-mono font-semibold tabular-nums text-ink-1">
                        {formatRupees(i.priceRupees)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Pricing summary */}
        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            {notes ? (
              <>
                <p className="eyebrow mb-2 text-ink-3">Notes</p>
                <p className="text-sm leading-relaxed text-ink-2">{notes}</p>
              </>
            ) : null}
            <p className="eyebrow mb-2 mt-6 text-ink-3">Inclusions</p>
            <ul className="grid grid-cols-1 gap-1.5 text-xs text-ink-2 sm:grid-cols-2">
              <Inclusion label="Travel-trade desk · Hindi/English/Marathi/Tamil" />
              <Inclusion label="GST-clean invoice + e-ticket" />
              <Inclusion label="Same-day reissue support" />
              <Inclusion label="DPDP Act 2023 compliant data handling" />
            </ul>
          </div>
          <div className="rounded-md border bg-surface-2/40 p-5">
            <p className="eyebrow text-ink-3">Pricing</p>
            <div className="mt-3 space-y-2 text-sm">
              <SummaryRow label="Subtotal" amount={subtotal} />
              {discountAmount > 0 ? (
                <SummaryRow
                  label={`Discount (${discountPct}%)`}
                  amount={-discountAmount}
                  tone="success"
                />
              ) : null}
              <SummaryRow label="Service fee" amount={serviceFee} />
              <SummaryRow label="GST 18%" amount={gst} sub="on service fee" />
              <Separator className="my-2" />
              <div className="flex items-baseline justify-between">
                <span className="text-base font-bold text-ink-1">Grand total</span>
                <span className="font-mono text-2xl font-bold tabular-nums text-ink-1">
                  {formatRupees(grandTotal)}
                </span>
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-ink-3">
              Wallet debit on confirmation. Refunds, if eligible, follow each supplier's fare rules.
            </p>
          </div>
        </section>

        {/* Terms */}
        <section className="mt-8 border-t pt-6">
          <p className="eyebrow mb-2 text-ink-3">Terms & conditions</p>
          <ol className="list-inside list-decimal space-y-1.5 text-[11px] leading-relaxed text-ink-3">
            {TERMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </section>

        {/* Footer */}
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-[10px] text-ink-4">
          <div className="font-mono">
            Quote {quoteNumber} · {items.length} {items.length === 1 ? 'item' : 'items'} · Page 1 of 1
          </div>
          <div className="flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" />
            <span>DPDP compliant · Trade desk: support@tripbng.com</span>
          </div>
        </footer>
      </article>
    </div>
  );
}

function Inclusion({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-1.5">
      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" strokeWidth={2} />
      <span>{label}</span>
    </li>
  );
}

function SummaryRow({
  label,
  amount,
  sub,
  tone,
}: {
  label: string;
  amount: number;
  sub?: string;
  tone?: 'success';
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-ink-2">
        {label}
        {sub ? <span className="ml-1 text-[10px] text-ink-3">· {sub}</span> : null}
      </span>
      <span
        className={`font-mono font-semibold tabular-nums ${tone === 'success' ? 'text-success' : 'text-ink-1'}`}
      >
        {amount < 0 ? '−' : ''}
        {formatRupees(Math.abs(amount))}
      </span>
    </div>
  );
}
