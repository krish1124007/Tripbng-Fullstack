'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Bus,
  Calendar as CalendarIcon,
  FileText,
  Hotel,
  PlaneTakeoff,
  Sparkles,
  StickyNote,
  Trash2,
  TreePalm,
  ShieldCheck,
  ShoppingCart,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui';
import {
  useCart,
  useCartCount,
  useCartTotal,
  type CartItem,
  type CartItemKind,
} from '@/lib/cart';
import { formatRupees } from '@/lib/mock-search';
import { cn } from '@/lib/utils';

interface KindMeta {
  label: string;
  icon: LucideIcon;
  iconBg: string;
  iconFg: string;
}

const KIND_META: Record<CartItemKind, KindMeta> = {
  flight: {
    label: 'Flights',
    icon: PlaneTakeoff,
    iconBg: 'bg-brand-50 dark:bg-brand-500/15',
    iconFg: 'text-brand-700 dark:text-brand-300',
  },
  hotel: {
    label: 'Hotels',
    icon: Hotel,
    iconBg: 'bg-emerald-50 dark:bg-emerald-500/15',
    iconFg: 'text-emerald-700 dark:text-emerald-300',
  },
  bus: {
    label: 'Bus',
    icon: Bus,
    iconBg: 'bg-cyan-50 dark:bg-cyan-500/15',
    iconFg: 'text-cyan-700 dark:text-cyan-300',
  },
  holiday: {
    label: 'Holidays',
    icon: TreePalm,
    iconBg: 'bg-rose-50 dark:bg-rose-500/15',
    iconFg: 'text-rose-700 dark:text-rose-300',
  },
  visa: {
    label: 'Visa',
    icon: StickyNote,
    iconBg: 'bg-amber-50 dark:bg-amber-500/15',
    iconFg: 'text-amber-700 dark:text-amber-300',
  },
  insurance: {
    label: 'Insurance',
    icon: ShieldCheck,
    iconBg: 'bg-violet-50 dark:bg-violet-500/15',
    iconFg: 'text-violet-700 dark:text-violet-300',
  },
};

const KIND_ORDER: CartItemKind[] = ['flight', 'hotel', 'bus', 'holiday', 'visa', 'insurance'];

/**
 * CartButton — sticky topbar trigger. Shows item count badge, opens the drawer.
 */
export function CartButton() {
  const [open, setOpen] = useState(false);
  const count = useCartCount();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Itinerary cart (${count} ${count === 1 ? 'item' : 'items'})`}
        className="relative grid h-9 w-9 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-brand-600"
      >
        <ShoppingCart className="h-4 w-4" strokeWidth={1.75} />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 font-mono text-[9px] font-bold text-white ring-2 ring-surface-1">
            {count}
          </span>
        ) : null}
      </button>
      <CartDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * CartDrawer — slide-over rendered via portal to document.body so it can't be
 * affected by parent layout / z-index / overflow rules. Uses a CSS grid with
 * `auto 1fr auto` rows so header + footer get their natural height and the
 * body fills the rest with its own scrollbar — no min-h-0 / shrink-0 dance.
 */
function CartDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const items = useCart((s) => s.items);
  const total = useCartTotal();
  const removeItem = useCart((s) => s.removeItem);
  const clear = useCart((s) => s.clear);

  // Lock background scroll while open (prevents iOS bounce + mobile keyboard issues).
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // SSR guard — createPortal needs a DOM target.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!open || !mounted) return null;

  const grouped = items.reduce<Record<CartItemKind, CartItem[]>>(
    (acc, i) => {
      acc[i.kind] = acc[i.kind] ?? [];
      acc[i.kind]!.push(i);
      return acc;
    },
    {} as Record<CartItemKind, CartItem[]>,
  );
  const orderedKinds = KIND_ORDER.filter((k) => grouped[k]?.length);

  const onQuote = () => {
    onOpenChange(false);
    router.push('/quote');
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Itinerary cart"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink-1/40 backdrop-blur-[2px]"
        onClick={() => onOpenChange(false)}
      />
      {/* Drawer — fixed full-viewport-height, grid 3-row layout */}
      <aside
        className="absolute right-0 top-0 grid w-full max-w-lg animate-slide-in-right grid-rows-[auto_1fr_auto] border-l bg-surface-1 shadow-xl"
        style={{ height: '100dvh' }}
      >
        {/* ── Row 1: Header (auto height) ── */}
        <header className="flex items-start justify-between gap-3 border-b px-6 py-5">
          <div className="min-w-0">
            <p className="eyebrow text-brand-600">Itinerary cart</p>
            <h2 className="mt-0.5 text-h3 text-ink-1">
              {items.length === 0
                ? 'Empty'
                : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
              {orderedKinds.length > 1 ? (
                <span className="ml-2 text-sm font-normal text-ink-3">
                  · {orderedKinds.length} product lines
                </span>
              ) : null}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close cart"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* ── Row 2: Body (1fr — fills remaining space, scrolls internally) ── */}
        <div className="overflow-y-auto bg-surface-0">
          {items.length === 0 ? (
            <EmptyCart onClose={() => onOpenChange(false)} />
          ) : (
            <div className="space-y-6 p-6">
              {orderedKinds.map((kind) => {
                const list = grouped[kind]!;
                const meta = KIND_META[kind];
                const Icon = meta.icon;
                const subtotal = list.reduce((s, i) => s + i.priceRupees, 0);
                return (
                  <section key={kind} className="space-y-2">
                    <header className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'grid h-7 w-7 place-items-center rounded-md',
                            meta.iconBg,
                            meta.iconFg,
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                        </span>
                        <p className="text-xs font-bold uppercase tracking-wider text-ink-2">
                          {meta.label}
                          <span className="ml-1.5 text-ink-4">·</span>{' '}
                          <span className="text-ink-3">
                            {list.length} {list.length === 1 ? 'item' : 'items'}
                          </span>
                        </p>
                      </div>
                      <p className="font-mono text-xs font-semibold tabular-nums text-ink-3">
                        {formatRupees(subtotal, { compact: true })}
                      </p>
                    </header>
                    <ul className="space-y-2">
                      {list.map((i) => (
                        <CartLine key={i.id} item={i} onRemove={() => removeItem(i.id)} />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Row 3: Footer (auto height — only when cart has items) ── */}
        {items.length > 0 ? (
          <footer className="space-y-3 border-t bg-surface-1 px-6 py-5">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink-1">Total</p>
                <p className="text-[11px] text-ink-3">
                  Excludes service fee + GST · final on quote
                </p>
              </div>
              <p className="font-mono text-3xl font-bold tabular-nums text-ink-1">
                {formatRupees(total)}
              </p>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Button variant="secondary" onClick={clear} aria-label="Clear all items">
                <Trash2 className="h-4 w-4" />
                Clear
              </Button>
              <Button onClick={onQuote} size="md" className="shadow-sm">
                <FileText className="h-4 w-4" /> Generate quote
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <p className="flex items-center justify-center gap-1 pt-1 text-[10px] text-ink-3">
              <Sparkles className="h-3 w-3" /> Quote opens in a printable view
            </p>
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}

// ────────── Sub-components ──────────

function EmptyCart({ onClose }: { onClose: () => void }) {
  return (
    <div className="grid h-full place-items-center px-6 py-12 text-center">
      <div className="max-w-xs">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-50 text-brand-600 ring-8 ring-brand-50/40 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/5">
          <ShoppingCart className="h-7 w-7" strokeWidth={1.5} />
        </span>
        <h3 className="mt-5 text-base font-bold text-ink-1">Your itinerary is empty</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-3">
          Add flights, hotels, buses, holidays, visa, or insurance from any product page. Build a
          multi-leg itinerary, then quote it as one.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button asChild variant="soft" size="sm" onClick={onClose}>
            <a href="/flights">
              <PlaneTakeoff className="h-4 w-4" /> Flights
            </a>
          </Button>
          <Button asChild variant="soft" size="sm" onClick={onClose}>
            <a href="/hotels">
              <Hotel className="h-4 w-4" /> Hotels
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

function CartLine({ item, onRemove }: { item: CartItem; onRemove: () => void }) {
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
  const dateLine = [item.datePrimary, item.dateSecondary].filter(Boolean).join(' → ');

  return (
    <li className="group relative overflow-hidden rounded-lg border bg-surface-1 px-3.5 py-3 transition-all duration-fast hover:border-brand-300 hover:shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md',
            meta.iconBg,
            meta.iconFg,
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-1">{item.title}</p>
          {item.subtitle ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-3">
              {item.subtitle}
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] tabular-nums text-ink-3">
            {dateLine ? (
              <span className="inline-flex items-center gap-1">
                <CalendarIcon className="h-3 w-3" strokeWidth={1.75} />
                {dateLine}
              </span>
            ) : null}
            {item.qty && item.qty > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" strokeWidth={1.75} />
                {item.qty} pax
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="font-mono text-sm font-bold tabular-nums text-ink-1">
            {formatRupees(item.priceRupees, { compact: true })}
          </p>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${item.title}`}
            className="inline-flex items-center gap-1 rounded text-[10px] text-ink-3 opacity-60 transition-all hover:bg-danger-soft hover:px-1.5 hover:opacity-100 hover:text-danger"
          >
            <Trash2 className="h-3 w-3" strokeWidth={2} />
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}
