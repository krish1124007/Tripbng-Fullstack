'use client';

// 11-tab admin editor for a VisaProduct. Wraps the AdminVisaProduct state and
// dispatches save/cancel. Mirrors holidays-admin/PackageEditor — same shell
// shape, different tabs and flag toggles (Published / Urgent available /
// Biometric required).

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminVisaProduct } from '@tripbng/shared';
import { Button } from '@/components/ui';
import { ApiCallError } from '@/lib/api';
import { useApiMutation } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  BasicDetailsTab,
  CancellationTab,
  DocumentsTab,
  EligibilityTab,
  ExclusionsTab,
  FaqsTab,
  InclusionsTab,
  PricingTab,
  ProcessStepsTab,
  SpecialNotesTab,
  ValidityTab,
} from './tabs';
import { TABS, type TabId, type UpdateFn } from './types';

interface ProductEditorProps {
  initial: AdminVisaProduct;
  /** "new" → POST to /products; otherwise PUT to /products/:id with this slug. */
  mode: 'new' | 'edit';
}

export function ProductEditor({ initial, mode }: ProductEditorProps) {
  const router = useRouter();
  const [product, setProduct] = useState<AdminVisaProduct>(initial);
  const [activeTab, setActiveTab] = useState<TabId>('basic');
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const update: UpdateFn = useCallback((key, value) => {
    setProduct((prev) => ({ ...prev, [key]: value }));
  }, []);

  const createMut = useApiMutation<AdminVisaProduct, AdminVisaProduct>(
    '/api/v1/admin/visa/products',
    'POST',
    {
      onSuccess: (saved) => {
        toast.success(`Created “${saved.name}”`);
        router.replace(`/admin/visa/products/${saved.id}`);
      },
      onError: (err) => setError(err instanceof ApiCallError ? err.message : 'Create failed'),
    },
  );

  const updateMut = useApiMutation<AdminVisaProduct, AdminVisaProduct>(
    (input) => `/api/v1/admin/visa/products/${input.id ?? initial.id}`,
    'PUT',
    {
      onSuccess: (saved) => {
        setProduct(saved);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2500);
        toast.success(`Saved “${saved.name}”`);
      },
      onError: (err) => setError(err instanceof ApiCallError ? err.message : 'Save failed'),
    },
  );

  const saving = createMut.isPending || updateMut.isPending;

  const onSave = () => {
    setError(null);
    if (!product.name.trim()) {
      setError('Visa name is required (Basic Details tab).');
      setActiveTab('basic');
      return;
    }
    if (!product.countryId.trim() || !product.countryName.trim()) {
      setError('Country slug + name are required (Basic Details tab).');
      setActiveTab('basic');
      return;
    }
    if (product.countryIso2.length !== 2) {
      setError('ISO-2 country code is required (Basic Details tab).');
      setActiveTab('basic');
      return;
    }
    if (mode === 'new') createMut.mutate(product);
    else updateMut.mutate({ ...product, id: product.id ?? initial.id });
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'basic':
        return <BasicDetailsTab product={product} update={update} />;
      case 'validity':
        return <ValidityTab product={product} update={update} />;
      case 'eligibility':
        return <EligibilityTab product={product} update={update} />;
      case 'documents':
        return <DocumentsTab product={product} update={update} />;
      case 'process-steps':
        return <ProcessStepsTab product={product} update={update} />;
      case 'pricing':
        return <PricingTab product={product} update={update} />;
      case 'inclusions':
        return <InclusionsTab product={product} update={update} />;
      case 'exclusions':
        return <ExclusionsTab product={product} update={update} />;
      case 'faqs':
        return <FaqsTab product={product} update={update} />;
      case 'special-notes':
        return <SpecialNotesTab product={product} update={update} />;
      case 'cancellation':
        return <CancellationTab product={product} update={update} />;
    }
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/admin/visa/products')}
          className="-ml-2 text-ink-3 hover:text-ink-1"
        >
          <ArrowLeft className="h-4 w-4" /> All visa products
        </Button>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            {mode === 'new' ? 'New visa product' : 'Editing'}
          </p>
          <h1 className="text-xl font-bold text-ink-1">
            {product.name || 'Untitled visa product'}
          </h1>
        </div>
        <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-surface-2/60 px-3 py-1 text-xs">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              product.published ? 'bg-success' : 'bg-warning',
            )}
            aria-hidden
          />
          {product.published ? 'Published' : 'Draft'}
        </span>
      </div>

      {/* Body — left rail + tab pane */}
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <ul className="space-y-0.5 rounded-lg border bg-surface-1 p-2">
            {TABS.map((t, i) => {
              const active = t.id === activeTab;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      active
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                        : 'text-ink-2 hover:bg-surface-2',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[9px] font-bold',
                        active ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-3',
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1">
                      <span className={cn('block text-sm font-semibold', !active && 'text-ink-1')}>
                        {t.label}
                      </span>
                      {t.hint ? (
                        <span className="block text-[10px] text-ink-3">{t.hint}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 space-y-2 rounded-lg border bg-surface-1 p-3">
            <p className="eyebrow text-ink-3">Flags</p>
            <FlagToggle
              label="Published"
              value={product.published}
              onChange={(v) => update('published', v)}
            />
            <FlagToggle
              label="Urgent available"
              value={product.urgentAvailable}
              onChange={(v) => {
                update('urgentAvailable', v);
                // Bounce to validity tab so the user sees the urgent fields appear.
                if (v) setActiveTab('validity');
              }}
            />
            <FlagToggle
              label="Biometric required"
              value={product.biometricRequired}
              onChange={(v) => update('biometricRequired', v)}
            />
          </div>
        </aside>

        <div>{renderTab()}</div>
      </div>

      {/* Footer save bar */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t bg-surface-1/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-lg md:border md:px-5">
        <div className="flex flex-wrap items-center gap-3">
          {error ? (
            <p className="text-xs text-danger">{error}</p>
          ) : savedFlash ? (
            <p className="inline-flex items-center gap-1 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </p>
          ) : (
            <p className="text-xs text-ink-3">
              {mode === 'new'
                ? 'Save creates this visa product and redirects to the edit screen.'
                : 'Changes are persisted to the visa-products collection.'}
            </p>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              variant="ghost"
              onClick={() => router.push('/admin/visa/products')}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={onSave} loading={saving}>
              <Save className="h-4 w-4" /> {mode === 'new' ? 'Create product' : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FlagToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 text-xs hover:bg-surface-2">
      <span className="font-medium text-ink-1">{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-brand-600"
      />
    </label>
  );
}
