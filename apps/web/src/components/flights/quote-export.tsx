'use client';

// Quote export — one-click "Send fare to customer".
//
// Renders a clean, brand-consistent quote card into a hidden offscreen
// DOM node, then captures it via `html-to-image` (PNG) or wraps the
// PNG into a single-page PDF via `jsPDF`. Both formats stay 100%
// client-side: no extra round-trip to the server, no extra auth, no
// surprise latency.
//
// The agent's quote is **customer-facing** — we hide commission
// (INC/NET) and only show the Gross fare. Internal supplier codes are
// also omitted; the customer doesn't need to see "via ETRAV".
//
// Actions provided:
//   • Download as PNG  → straight image, perfect for WhatsApp
//   • Download as PDF  → A4-portrait single page, perfect for email
//   • Share to WhatsApp → wa.me link prefilled with route + price
//   • Copy image       → clipboard PNG for fast paste into chats

import { forwardRef, useEffect, useRef, useState } from 'react';
import {
  Copy,
  Download,
  FileImage,
  FileText,
  Loader2,
  MessageCircle,
  Send,
  X,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import { toast } from 'sonner';
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';
import { AirlineLogo } from '@/components/airline-logo';
import { useAuthStore } from '@/lib/auth-store';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';
import { formatDuration, formatTime, type FlightResult } from './utils';

// ────────── Public component ──────────

interface QuoteExportProps {
  r: FlightResult;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ActionState = { kind: 'idle' } | { kind: 'busy'; what: string } | { kind: 'done'; what: string };

export function QuoteExportDialog({ r, open, onOpenChange }: QuoteExportProps) {
  const user = useAuthStore((s) => s.user);
  const quoteRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<ActionState>({ kind: 'idle' });
  const [customerName, setCustomerName] = useState('');

  // Reset transient state every time the dialog reopens.
  useEffect(() => {
    if (open) {
      setState({ kind: 'idle' });
    }
  }, [open]);

  // Quote ref/no is a short timestamp+id slug so the agent can match
  // the quote against their CRM / chat thread.
  const quoteNo = useRef<string>(
    `Q${Date.now().toString(36).slice(-4).toUpperCase()}-${r.id.slice(-4).toUpperCase()}`,
  ).current;

  async function capturePng(): Promise<string> {
    if (!quoteRef.current) throw new Error('Quote card not mounted');
    const dataUrl = await toPng(quoteRef.current, {
      pixelRatio: 2, // Retina-quality so WhatsApp doesn't compress it to mush
      backgroundColor: '#ffffff',
      cacheBust: true,
    });
    return dataUrl;
  }

  async function handleDownloadPng() {
    setState({ kind: 'busy', what: 'png' });
    try {
      const dataUrl = await capturePng();
      triggerDownload(dataUrl, `${quoteFileBase(r, quoteNo)}.png`);
      setState({ kind: 'done', what: 'png' });
    } catch (e) {
      console.error('PNG export failed', e);
      setState({ kind: 'idle' });
      toast.error('Could not generate the image. Please try again.');
    }
  }

  async function handleDownloadPdf() {
    setState({ kind: 'busy', what: 'pdf' });
    try {
      const dataUrl = await capturePng();
      // Build an A4-portrait PDF and embed the image, scaled to fit
      // the page width with a small margin.
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const margin = 24;
      // Read intrinsic image dimensions to preserve aspect ratio.
      const img = new Image();
      img.src = dataUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image decode failed'));
      });
      const targetW = pageW - margin * 2;
      const targetH = (img.height / img.width) * targetW;
      pdf.addImage(dataUrl, 'PNG', margin, margin, targetW, targetH, undefined, 'FAST');
      pdf.save(`${quoteFileBase(r, quoteNo)}.pdf`);
      setState({ kind: 'done', what: 'pdf' });
    } catch (e) {
      console.error('PDF export failed', e);
      setState({ kind: 'idle' });
      toast.error('Could not generate the PDF. Please try again.');
    }
  }

  async function handleCopyImage() {
    setState({ kind: 'busy', what: 'copy' });
    try {
      const dataUrl = await capturePng();
      const blob = await (await fetch(dataUrl)).blob();
      // ClipboardItem is supported on Chrome/Edge/Safari. Firefox is
      // still partial — we surface a fallback message if it throws.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ClipboardItemCtor: any = (window as any).ClipboardItem;
      if (!ClipboardItemCtor) throw new Error('Clipboard image not supported');
      await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
      setState({ kind: 'done', what: 'copy' });
    } catch (e) {
      console.error('Copy image failed', e);
      setState({ kind: 'idle' });
      toast.error(
        'Your browser doesn\'t allow copying images directly. Try the "Download image" option instead.',
      );
    }
  }

  function handleWhatsappShare() {
    const seg0 = r.segments[0]!;
    const segLast = r.segments[r.segments.length - 1]!;
    const date = new Date(seg0.departure).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const summary = [
      `*Flight quote · ${quoteNo}*`,
      ...(customerName ? [`For: ${customerName}`] : []),
      '',
      `${seg0.airline.name ?? seg0.airline.code} ${seg0.flightNumber}`,
      `${seg0.origin.code} (${formatTime(seg0.departure)}) → ${segLast.destination.code} (${formatTime(
        segLast.arrival,
      )})`,
      `${date} · ${formatDuration(r.totalDuration)} · ${r.stops === 0 ? 'Non-stop' : `${r.stops} stop${r.stops > 1 ? 's' : ''}`}`,
      `${cabinLabel(r.travelClass)} · ${r.refundable ? 'Refundable' : 'Non-refundable'}`,
      '',
      `*Total: ${formatPaiseAsINR(r.totalGrossPaise)}*`,
      '',
      'Send the attached image for the full quote.',
      ...(user?.fullName ? [`— ${user.fullName}`] : []),
    ].join('\n');
    const url = `https://wa.me/?text=${encodeURIComponent(summary)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <Send className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <DialogTitle>Share fare quote</DialogTitle>
              <DialogDescription>
                Customer-facing copy of this fare — INC/NET and supplier codes are hidden.
              </DialogDescription>
            </div>
          </div>
          <DialogClose />
        </DialogHeader>

        <DialogBody>
          {/* Optional customer name — used in WhatsApp greeting + quote header */}
          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Customer name (optional)
            </span>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value.slice(0, 60))}
              placeholder="e.g. Mr. Rakesh Sharma"
              className="w-full rounded-md border border-stroke-1 bg-surface-1 px-3 py-2 text-sm text-ink-1 placeholder:text-ink-4 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </label>

          {/* Live preview — this is also what gets captured. Scaled
              down visually but rendered at full size in the DOM. The
              outer wrapper caps the visible footprint so the preview
              never dominates the dialog; users can scroll inside it
              to see longer quotes. The CSS-scaled inner div doesn't
              affect layout size (transform: scale doesn't), so we
              wrap it in a fixed-aspect container with overflow. */}
          <div className="rounded-lg border border-stroke-1 bg-surface-2/40">
            <div className="flex items-center justify-between border-b border-stroke-1 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                Preview
              </p>
              <p className="font-mono text-[10px] text-ink-4">scaled</p>
            </div>
            <div className="max-h-[420px] overflow-auto p-3">
              <div
                className="origin-top-left scale-[0.55] sm:scale-[0.7] md:scale-[0.82]"
                style={{ width: 720 }}
              >
                <QuoteCard
                  ref={quoteRef}
                  r={r}
                  quoteNo={quoteNo}
                  customerName={customerName.trim() || null}
                  agentName={user?.fullName ?? null}
                  agentEmail={user?.email ?? null}
                />
              </div>
            </div>
          </div>

          {/* Action grid */}
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <ActionButton
              onClick={handleDownloadPng}
              busy={state.kind === 'busy' && state.what === 'png'}
              done={state.kind === 'done' && state.what === 'png'}
              icon={FileImage}
              label="Download PNG"
              hint="Best for WhatsApp"
            />
            <ActionButton
              onClick={handleDownloadPdf}
              busy={state.kind === 'busy' && state.what === 'pdf'}
              done={state.kind === 'done' && state.what === 'pdf'}
              icon={FileText}
              label="Download PDF"
              hint="Best for email"
            />
            <ActionButton
              onClick={handleCopyImage}
              busy={state.kind === 'busy' && state.what === 'copy'}
              done={state.kind === 'done' && state.what === 'copy'}
              icon={Copy}
              label="Copy image"
              hint="Paste into chat"
            />
            <ActionButton
              onClick={handleWhatsappShare}
              busy={false}
              done={false}
              icon={MessageCircle}
              label="Share via WhatsApp"
              hint="Opens wa.me"
              tone="success"
            />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" /> Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionButton({
  onClick,
  busy,
  done,
  icon: Icon,
  label,
  hint,
  tone,
}: {
  onClick: () => void;
  busy: boolean;
  done: boolean;
  icon: typeof Download;
  label: string;
  hint: string;
  tone?: 'success';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        'group flex flex-col items-start gap-1 rounded-lg border bg-surface-1 px-3 py-2.5 text-left transition-all',
        'hover:shadow-md disabled:cursor-wait disabled:opacity-70',
        tone === 'success'
          ? 'border-emerald-200 hover:border-emerald-400 dark:border-emerald-500/30'
          : 'border-stroke-1 hover:border-brand-300',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 text-[12px] font-semibold',
          tone === 'success'
            ? 'text-emerald-700 dark:text-emerald-300'
            : 'text-ink-1 group-hover:text-brand-700',
        )}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {done ? 'Done ✓' : label}
      </div>
      <span className="text-[10px] text-ink-3">{hint}</span>
    </button>
  );
}

// ────────── Quote card (the captured DOM) ──────────
//
// All inline styles intentional — html-to-image inlines computed styles
// only for the rendered subtree, but we keep things simple by using
// concrete pixel values and hex colours. This avoids issues with CSS
// custom-property resolution at capture time on some browsers.

interface QuoteCardProps {
  r: FlightResult;
  quoteNo: string;
  customerName: string | null;
  agentName: string | null;
  agentEmail: string | null;
}

const QuoteCard = forwardRef<HTMLDivElement, QuoteCardProps>(function QuoteCard(props, ref) {
  const { r, quoteNo, customerName, agentName, agentEmail } = props;
  const seg0 = r.segments[0]!;
  const segLast = r.segments[r.segments.length - 1]!;
  const issuedAt = new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const departDate = new Date(seg0.departure).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // Brand colour from /styles/tokens.css — inlined to dodge custom-property
  // resolution issues during capture.
  const BRAND = '#175ca1';
  const BRAND_50 = '#eef5fc';
  const INK_1 = '#0c1a2c';
  const INK_3 = '#5b6b80';
  const STROKE = '#e6e8ec';

  return (
    <div
      ref={ref}
      style={{
        width: 720,
        background: '#ffffff',
        color: INK_1,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 1px 0 rgba(0,0,0,0.03)',
      }}
    >
      {/* Brand header bar */}
      <div
        style={{
          background: `linear-gradient(135deg, ${BRAND} 0%, #0e4985 100%)`,
          color: '#ffffff',
          padding: '20px 28px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              fontWeight: 700,
              opacity: 0.85,
              textTransform: 'uppercase',
            }}
          >
            Tripbng India Private Limited
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>Flight Reservation Quote</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>Issued · {issuedAt}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              fontWeight: 700,
              opacity: 0.85,
              textTransform: 'uppercase',
            }}
          >
            Quote No.
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', marginTop: 2 }}>
            {quoteNo}
          </div>
        </div>
      </div>

      {/* Customer line */}
      {customerName ? (
        <div
          style={{
            padding: '14px 28px',
            background: BRAND_50,
            color: BRAND,
            fontSize: 13,
            fontWeight: 600,
            borderBottom: `1px solid ${STROKE}`,
          }}
        >
          Prepared for: <span style={{ fontWeight: 700 }}>{customerName}</span>
        </div>
      ) : null}

      {/* Route header */}
      <div style={{ padding: '20px 28px', borderBottom: `1px solid ${STROKE}` }}>
        <div
          style={{
            fontSize: 11,
            color: INK_3,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
          }}
        >
          Travel date
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{departDate}</div>
        <div style={{ fontSize: 13, color: INK_3, marginTop: 4 }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: INK_1 }}>
            {seg0.origin.code}
          </span>
          {' → '}
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: INK_1 }}>
            {segLast.destination.code}
          </span>
          {'   ·   '}
          {formatDuration(r.totalDuration)}
          {'   ·   '}
          {r.stops === 0 ? 'Non-stop' : `${r.stops} stop${r.stops > 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Segments */}
      <div style={{ padding: '20px 28px' }}>
        {r.segments.map((seg, idx) => (
          <div key={`${seg.flightNumber}-${idx}`}>
            <QuoteSegment seg={seg} brand={BRAND} ink1={INK_1} ink3={INK_3} stroke={STROKE} />
            {idx < r.segments.length - 1 ? (
              <div
                style={{
                  margin: '12px 0',
                  padding: '8px 12px',
                  background: '#fff7ed',
                  border: '1px dashed #fb923c',
                  borderRadius: 8,
                  fontSize: 11,
                  color: '#9a3412',
                  fontWeight: 600,
                }}
              >
                Layover at <span style={{ fontFamily: 'monospace' }}>{seg.destination.code}</span>
                {'   ·   '}
                {formatDuration(seg.stopOver)}
                {'   ·   '}
                Change of flight required
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* Baggage */}
      <div
        style={{
          padding: '14px 28px',
          background: BRAND_50,
          borderTop: `1px solid ${STROKE}`,
          borderBottom: `1px solid ${STROKE}`,
          display: 'flex',
          gap: 32,
          flexWrap: 'wrap',
        }}
      >
        <BaggageStat label="Check-in baggage" value={r.baggageCheckin ?? 'As per airline'} ink1={INK_1} ink3={INK_3} />
        <BaggageStat label="Cabin baggage" value={r.baggageCabin ?? 'As per airline'} ink1={INK_1} ink3={INK_3} />
        <BaggageStat label="Cabin class" value={cabinLabel(r.travelClass)} ink1={INK_1} ink3={INK_3} />
        <BaggageStat
          label="Refundability"
          value={r.refundable ? 'Refundable' : 'Non-refundable'}
          ink1={r.refundable ? '#047857' : '#b91c1c'}
          ink3={INK_3}
        />
      </div>

      {/* Total */}
      <div style={{ padding: '22px 28px', background: '#ffffff' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                color: INK_3,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
              }}
            >
              Total fare (all-inclusive)
            </div>
            <div style={{ fontSize: 12, color: INK_3, marginTop: 2 }}>
              Includes base fare, taxes & service fees
            </div>
          </div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 800,
              fontFamily: 'monospace',
              color: BRAND,
              letterSpacing: '-0.01em',
            }}
          >
            {formatPaiseAsINR(r.totalGrossPaise)}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '14px 28px',
          background: '#f8fafc',
          borderTop: `1px solid ${STROKE}`,
          fontSize: 11,
          color: INK_3,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          {agentName ? (
            <span>
              Quoted by: <span style={{ color: INK_1, fontWeight: 600 }}>{agentName}</span>
              {agentEmail ? <span> · {agentEmail}</span> : null}
            </span>
          ) : (
            <span>Quoted via Tripbng B2B portal</span>
          )}
        </div>
        <div>
          Quote valid for 30 minutes · Subject to availability · Fare may change at booking
        </div>
      </div>
    </div>
  );
});

function QuoteSegment({
  seg,
  brand,
  ink1,
  ink3,
  stroke,
}: {
  seg: FlightResult['segments'][number];
  brand: string;
  ink1: string;
  ink3: string;
  stroke: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr 1fr 1fr',
        gap: 16,
        alignItems: 'center',
        border: `1px solid ${stroke}`,
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <AirlineLogo code={seg.airline.code} name={seg.airline.name} size={32} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: ink1, lineHeight: 1.1 }}>
            {seg.airline.name ?? seg.airline.code}
          </div>
          <div
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              color: ink3,
              marginTop: 4,
            }}
          >
            {seg.airline.code} {seg.flightNumber}
          </div>
        </div>
      </div>

      <div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            fontFamily: 'monospace',
            color: ink1,
            lineHeight: 1,
            letterSpacing: '-0.01em',
          }}
        >
          {formatTime(seg.departure)}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: ink1,
            fontWeight: 700,
            fontFamily: 'monospace',
          }}
        >
          {seg.origin.code}
        </div>
        <div style={{ fontSize: 11, color: ink3 }}>{seg.origin.name ?? ''}</div>
        {seg.origin.terminal ? (
          <div style={{ fontSize: 10, color: ink3, marginTop: 2 }}>Terminal {seg.origin.terminal}</div>
        ) : null}
      </div>

      <div style={{ textAlign: 'center', color: ink3, fontSize: 11 }}>
        <div style={{ fontFamily: 'monospace', fontWeight: 600, color: ink1 }}>
          {formatDuration(seg.duration)}
        </div>
        <div
          style={{
            margin: '8px auto',
            height: 1,
            width: '70%',
            background: stroke,
          }}
        />
        <div style={{ color: brand, fontWeight: 600 }}>Non-stop</div>
      </div>

      <div style={{ textAlign: 'right' }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            fontFamily: 'monospace',
            color: ink1,
            lineHeight: 1,
            letterSpacing: '-0.01em',
          }}
        >
          {formatTime(seg.arrival)}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: ink1,
            fontWeight: 700,
            fontFamily: 'monospace',
          }}
        >
          {seg.destination.code}
        </div>
        <div style={{ fontSize: 11, color: ink3 }}>{seg.destination.name ?? ''}</div>
        {seg.destination.terminal ? (
          <div style={{ fontSize: 10, color: ink3, marginTop: 2 }}>
            Terminal {seg.destination.terminal}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BaggageStat({
  label,
  value,
  ink1,
  ink3,
}: {
  label: string;
  value: string;
  ink1: string;
  ink3: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: ink3,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: ink1, marginTop: 3 }}>{value}</div>
    </div>
  );
}

// ────────── Utility helpers ──────────

function cabinLabel(t: string): string {
  switch (t) {
    case 'ECONOMY':
      return 'Economy';
    case 'PREMIUM_ECONOMY':
      return 'Premium Economy';
    case 'BUSINESS':
      return 'Business';
    case 'FIRST':
      return 'First';
    default:
      return t;
  }
}

function quoteFileBase(r: FlightResult, quoteNo: string): string {
  const seg0 = r.segments[0]!;
  const segLast = r.segments[r.segments.length - 1]!;
  const date = new Date(seg0.departure).toISOString().slice(0, 10);
  return `Quote-${quoteNo}-${seg0.origin.code}-${segLast.destination.code}-${date}`;
}

function triggerDownload(dataUrl: string, filename: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
