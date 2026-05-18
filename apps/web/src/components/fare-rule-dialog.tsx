'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, FileText, Loader2 } from 'lucide-react';
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
import { apiFetch, ApiCallError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface FareRule {
  segmentId: string;
  name: string;
  /** Full HTML document (with embedded CSS) — render inside a sandboxed iframe. */
  html: string;
}

interface FareRuleResponse {
  rules: FareRule[];
}

/**
 * FareRuleDialog — fetches and renders the supplier's HTML fare-rule blob in
 * a sandboxed iframe. The HTML comes from eTrav as a complete `<!DOCTYPE>` doc
 * with inline styles, so iframe `srcDoc` + `sandbox` is the right primitive
 * (no `dangerouslySetInnerHTML`, no DOMPurify gymnastics — straight isolation).
 *
 * Only eTrav supplies fare rules today; for other suppliers (Series, Mock) the
 * caller should not render the dialog at all.
 */
export function FareRuleDialog({
  open,
  onOpenChange,
  supplierCode,
  fareToken,
  flightLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  supplierCode: string;
  fareToken: string;
  /** "BOM → DEL · 6E 2143" — shown in the header so users know which fare's rules. */
  flightLabel?: string;
}) {
  const [rules, setRules] = useState<FareRule[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch on open. Re-fetches if supplierCode/fareToken change while open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRules(null);
    setActiveIndex(0);
    apiFetch<FareRuleResponse>('/api/v1/search/flights/farerule', {
      method: 'POST',
      body: { supplierCode, fareToken },
    })
      .then((res) => {
        if (cancelled) return;
        setRules(res.rules);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiCallError) setError(err.message);
        else setError('Could not load fare rules. Please retry.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, supplierCode, fareToken]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <FileText className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <DialogTitle>Fare rules</DialogTitle>
              <DialogDescription>
                {flightLabel ? (
                  <span className="font-mono">{flightLabel}</span>
                ) : (
                  <>Cancellation, change, refund, and other terms for this fare.</>
                )}
              </DialogDescription>
            </div>
          </div>
          <DialogClose />
        </DialogHeader>

        <DialogBody className="px-0">
          {/* Segment tab strip — only shown when there's more than one rule */}
          {rules && rules.length > 1 ? (
            <div className="mb-3 flex items-center gap-1 overflow-x-auto border-b px-6 pb-px">
              {rules.map((r, i) => (
                <button
                  key={`${r.segmentId}-${i}`}
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  className={cn(
                    'shrink-0 border-b-2 px-3 py-2 text-xs font-semibold transition-colors duration-fast',
                    i === activeIndex
                      ? 'border-brand-600 text-brand-700 dark:text-brand-300'
                      : 'border-transparent text-ink-3 hover:text-ink-1',
                  )}
                >
                  Segment {r.segmentId} · {r.name}
                </button>
              ))}
            </div>
          ) : null}

          <div className="px-6">
            {loading ? (
              <div className="grid h-72 place-items-center text-ink-3">
                <div className="flex flex-col items-center gap-2 text-sm">
                  <Loader2 className="h-5 w-5 animate-spin text-brand-500" strokeWidth={2} />
                  Loading rules from supplier…
                </div>
              </div>
            ) : error ? (
              <div className="grid h-72 place-items-center">
                <div className="max-w-sm text-center">
                  <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-warning-soft text-warning">
                    <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <p className="text-sm font-semibold text-ink-1">{error}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    The supplier may have lost the search session — close this and re-search to refresh.
                  </p>
                </div>
              </div>
            ) : rules && rules.length > 0 ? (
              <iframe
                key={activeIndex}
                title={`Fare rules — ${rules[activeIndex]?.name ?? 'rule'}`}
                srcDoc={rules[activeIndex]?.html ?? ''}
                sandbox=""
                className="h-[60vh] w-full rounded-md border bg-white"
              />
            ) : (
              <div className="grid h-72 place-items-center text-sm text-ink-3">
                No fare rules returned.
              </div>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
