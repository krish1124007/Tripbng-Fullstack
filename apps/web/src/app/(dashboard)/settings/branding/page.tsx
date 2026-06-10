'use client';

// /settings/branding — agency / distributor self-service branding.
//
// Two-column layout (left = form, right = sticky live preview):
//   - Logo uploader (data URL into POST /settings/branding/logo)
//   - Company name (text)
//   - Primary colour (8 presets + custom hex + native picker)
//   - Secondary colour (8 presets + custom hex + native picker)
//   - Live preview repaints on every change (no debounce needed; the
//     preview is a tiny vDOM, paint is essentially free).
//   - Save / Discard / Reset to defaults — each with a confirm step
//     where the action is destructive.

import { useEffect, useMemo, useState } from 'react';
import { Paintbrush, RotateCcw, Save, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  BRANDING_PRIMARY_PRESETS,
  BRANDING_SECONDARY_PRESETS,
  type PublicBranding,
  type UpdateBrandingRequest,
} from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  FormField,
  Input,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import { useApiMutation, useApiQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { LogoUploader } from '@/components/branding/logo-uploader';
import { ColorPicker } from '@/components/branding/color-picker';
import { BrandingPreview } from '@/components/branding/branding-preview';
import { useBranding } from '@/components/branding/branding-theme-provider';

// Client-side mirror of the API's darken() + WCAG luminance helper.
// We compute these live so the preview stays in sync while the user
// types — the server recomputes on save anyway, so being a hair off
// is harmless.
function darken(hex: string, amount: number): string {
  const m = /^#([0-9a-fA-F]{6})/.exec(hex);
  if (!m) return hex;
  const parse = (i: number) => parseInt(m[1]!.slice(i, i + 2), 16);
  const k = 1 - Math.max(0, Math.min(1, amount));
  const pad = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${pad(parse(0) * k)}${pad(parse(2) * k)}${pad(parse(4) * k)}`;
}
function pickFg(hex: string): '#ffffff' | '#0b1220' {
  const m = /^#([0-9a-fA-F]{6})/.exec(hex);
  if (!m) return '#ffffff';
  const parse = (i: number) => parseInt(m[1]!.slice(i, i + 2), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L =
    0.2126 * lin(parse(0)) + 0.7152 * lin(parse(2)) + 0.0722 * lin(parse(4));
  return L > 0.5 ? '#0b1220' : '#ffffff';
}

export default function BrandingSettingsPage() {
  const { refresh } = useBranding();
  const query = useApiQuery<PublicBranding>(['branding', 'me'], '/api/v1/settings/branding');
  const saved = query.data;

  // Form state — initialised from the server data once it's loaded.
  const [companyName, setCompanyName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#0f62fe');
  const [secondaryColor, setSecondaryColor] = useState('#10b981');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  /** When the user picks a NEW logo it lives here until Save. */
  const [pendingLogoDataUrl, setPendingLogoDataUrl] = useState<string | null>(null);

  // Hydrate state from server.
  useEffect(() => {
    if (!saved) return;
    setCompanyName(saved.companyName);
    setPrimaryColor(saved.primaryColor);
    setSecondaryColor(saved.secondaryColor);
    setLogoUrl(saved.logoPublicUrl);
    setPendingLogoDataUrl(null);
  }, [saved]);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  const previewLogoUrl = useMemo(() => {
    if (pendingLogoDataUrl) return pendingLogoDataUrl;
    if (!logoUrl) return null;
    // logoPublicUrl is like /static/branding/AGENCY/<id>/logo-...png —
    // we prefix the API base for the preview.
    return logoUrl.startsWith('http') ? logoUrl : `${apiBase}${logoUrl}`;
  }, [pendingLogoDataUrl, logoUrl, apiBase]);

  const isDirty = useMemo(() => {
    if (!saved) return false;
    return (
      saved.companyName !== companyName ||
      saved.primaryColor !== primaryColor.toLowerCase() ||
      saved.secondaryColor !== secondaryColor.toLowerCase() ||
      !!pendingLogoDataUrl
    );
  }, [saved, companyName, primaryColor, secondaryColor, pendingLogoDataUrl]);

  const invalidate = useInvalidateOnSuccess([['branding']]);

  const saveColors = useApiMutation<UpdateBrandingRequest, PublicBranding>(
    '/api/v1/settings/branding',
    'PUT',
    {
      onSuccess: (data) => {
        toast.success('Branding saved');
        invalidate();
        // Repaint the live portal immediately.
        window.dispatchEvent(new CustomEvent('branding-updated', { detail: data }));
        void refresh();
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const uploadLogo = useApiMutation<{ dataUrl: string }, PublicBranding>(
    '/api/v1/settings/branding/logo',
    'POST',
    {
      onSuccess: (data) => {
        invalidate();
        window.dispatchEvent(new CustomEvent('branding-updated', { detail: data }));
        void refresh();
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const removeLogo = useApiMutation<undefined, PublicBranding>(
    '/api/v1/settings/branding/logo',
    'DELETE',
    {
      onSuccess: (data) => {
        toast.success('Logo removed');
        setPendingLogoDataUrl(null);
        invalidate();
        window.dispatchEvent(new CustomEvent('branding-updated', { detail: data }));
        void refresh();
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const resetAll = useApiMutation<undefined, PublicBranding>(
    '/api/v1/settings/branding/reset',
    'POST',
    {
      onSuccess: (data) => {
        toast.success('Reset to TripBng defaults');
        setPendingLogoDataUrl(null);
        invalidate();
        window.dispatchEvent(new CustomEvent('branding-updated', { detail: data }));
        void refresh();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const [resetOpen, setResetOpen] = useState(false);

  const submit = async () => {
    // Upload logo first (if any), THEN persist colours so a logo
    // failure doesn't rewind the colour change.
    if (pendingLogoDataUrl) {
      await uploadLogo.mutateAsync({ dataUrl: pendingLogoDataUrl });
      setPendingLogoDataUrl(null);
    }
    await saveColors.mutateAsync({
      companyName,
      primaryColor,
      secondaryColor,
      // Pass nulls so the server recomputes hover + foreground from
      // the new primary. Users get those manually via the API if
      // they need to override.
      primaryHoverColor: null,
      primaryForegroundColor: null,
      isActive: true,
    });
  };

  const discard = () => {
    if (!saved) return;
    setCompanyName(saved.companyName);
    setPrimaryColor(saved.primaryColor);
    setSecondaryColor(saved.secondaryColor);
    setPendingLogoDataUrl(null);
  };

  const previewPrimaryHover = darken(primaryColor, 0.1);
  const previewPrimaryFg = pickFg(primaryColor);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings · Brand"
        title="Branding"
        description="Your logo + colour palette apply to the portal and every document your customers receive."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={discard} disabled={!isDirty}>
              <Undo2 className="h-4 w-4" /> Discard
            </Button>
            <Button
              variant="secondary"
              onClick={() => setResetOpen(true)}
              disabled={!saved}
            >
              <RotateCcw className="h-4 w-4" /> Reset to defaults
            </Button>
            <Button
              onClick={submit}
              disabled={!isDirty}
              loading={saveColors.isPending || uploadLogo.isPending}
            >
              <Save className="h-4 w-4" /> Save changes
            </Button>
          </div>
        }
      />

      {query.isLoading ? (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* ─────────── Left column: form ─────────── */}
          <div className="space-y-5">
            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="eyebrow text-ink-3 flex items-center gap-1.5">
                      <Paintbrush className="h-3 w-3" /> Identity
                    </p>
                    <h2 className="mt-1 text-lg font-bold text-ink-1">
                      Logo &amp; company name
                    </h2>
                  </div>
                  {saved && saved.isActive ? (
                    <Badge variant="success" dot>
                      Live
                    </Badge>
                  ) : (
                    <Badge variant="neutral">Default theme</Badge>
                  )}
                </div>
                <LogoUploader
                  currentUrl={previewLogoUrl}
                  onPicked={(dataUrl) => setPendingLogoDataUrl(dataUrl)}
                  onRemove={() => removeLogo.mutate(undefined)}
                  busy={uploadLogo.isPending || removeLogo.isPending}
                />
                <FormField id="companyName" label="Company name" required>
                  <Input
                    id="companyName"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value.slice(0, 80))}
                    placeholder="Acme Travel Agency"
                  />
                </FormField>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-5 p-6">
                <div>
                  <p className="eyebrow text-ink-3">Colour palette</p>
                  <h2 className="mt-1 text-lg font-bold text-ink-1">
                    Primary &amp; Secondary
                  </h2>
                  <p className="mt-1 text-xs text-ink-3">
                    Primary drives CTAs, active nav, and document headers. Secondary is
                    reserved for status pills and accents. Hover + readable text on
                    Primary auto-derive — no need to pick them yourself.
                  </p>
                </div>
                <ColorPicker
                  label="Primary"
                  value={primaryColor}
                  presets={BRANDING_PRIMARY_PRESETS}
                  onChange={setPrimaryColor}
                  hint="CTAs, active nav, PDF header"
                />
                <ColorPicker
                  label="Secondary"
                  value={secondaryColor}
                  presets={BRANDING_SECONDARY_PRESETS}
                  onChange={setSecondaryColor}
                  hint="Status pills, accents"
                />
              </CardContent>
            </Card>
          </div>

          {/* ─────────── Right column: sticky live preview ─────────── */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <p className="eyebrow text-ink-3">Live preview</p>
                  <Badge variant="brand" dot pulse>
                    Updates as you type
                  </Badge>
                </div>
                <BrandingPreview
                  companyName={companyName || 'Your Company'}
                  logoUrl={previewLogoUrl}
                  primaryColor={primaryColor}
                  primaryHoverColor={previewPrimaryHover}
                  primaryForegroundColor={previewPrimaryFg}
                  secondaryColor={secondaryColor}
                />
                <p className="text-[11px] text-ink-3">
                  This is exactly how the portal chrome + a primary CTA will look once
                  you save. Documents (invoice / voucher / receipt) pick up the same
                  primary colour and your uploaded logo.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset branding to TripBng defaults?"
        description="Your logo will be deleted from our servers and your colour theme reset to the platform defaults. This is immediate and cannot be undone — you can always set up branding again later."
        confirmLabel="Reset"
        destructive
        onConfirm={async () => {
          await resetAll.mutateAsync(undefined);
        }}
      />
    </div>
  );
}
