'use client';

// /admin/branding/[subjectKind]/[subjectId] — admin override page.
//
// Identical UX to /settings/branding (self-service) but targets a
// specific agency or distributor via the path params and writes
// audit entries as action='branding.admin_override'. Includes a
// collapsed audit-log strip at the bottom so reviewers can see
// who changed what + when.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  History,
  RotateCcw,
  Save,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  BRANDING_PRIMARY_PRESETS,
  BRANDING_SECONDARY_PRESETS,
  type BrandingSubjectKind,
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

interface AuditEntry {
  _id: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  ip: string | null;
  createdAt: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

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

export default function AdminBrandingPage() {
  const params = useParams<{ subjectKind: string; subjectId: string }>();
  const subjectKindRaw = (params.subjectKind ?? '').toUpperCase();
  const subjectKind: BrandingSubjectKind =
    subjectKindRaw === 'AGENCY' || subjectKindRaw === 'DISTRIBUTOR'
      ? (subjectKindRaw as BrandingSubjectKind)
      : 'AGENCY';
  const subjectId = params.subjectId ?? '';
  const basePath = `/api/v1/admin/branding/${subjectKind}/${subjectId}`;

  const query = useApiQuery<PublicBranding>(['admin-branding', subjectKind, subjectId], basePath);
  const auditQuery = useApiQuery<AuditEntry[]>(
    ['admin-branding', 'audit', subjectKind, subjectId],
    `${basePath}/audit`,
  );
  const saved = query.data;

  const [companyName, setCompanyName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#0f62fe');
  const [secondaryColor, setSecondaryColor] = useState('#10b981');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [pendingLogoDataUrl, setPendingLogoDataUrl] = useState<string | null>(null);

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

  const invalidate = useInvalidateOnSuccess([['admin-branding']]);

  const saveColors = useApiMutation<UpdateBrandingRequest, PublicBranding>(basePath, 'PUT', {
    onSuccess: () => {
      toast.success('Branding override saved');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const uploadLogo = useApiMutation<{ dataUrl: string }, PublicBranding>(
    `${basePath}/logo`,
    'POST',
    {
      onSuccess: () => invalidate(),
      onError: (err) => toast.error(err.message),
    },
  );
  const removeLogo = useApiMutation<undefined, PublicBranding>(`${basePath}/logo`, 'DELETE', {
    onSuccess: () => {
      toast.success('Logo removed');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const resetAll = useApiMutation<undefined, PublicBranding>(`${basePath}/reset`, 'POST', {
    onSuccess: () => {
      toast.success('Reset to TripBng defaults');
      setPendingLogoDataUrl(null);
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const [resetOpen, setResetOpen] = useState(false);

  const submit = async () => {
    if (pendingLogoDataUrl) {
      await uploadLogo.mutateAsync({ dataUrl: pendingLogoDataUrl });
      setPendingLogoDataUrl(null);
    }
    await saveColors.mutateAsync({
      companyName,
      primaryColor,
      secondaryColor,
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
  const listHref = subjectKind === 'AGENCY' ? '/agencies' : '/distributors';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Branding override"
        title={`${subjectKind === 'AGENCY' ? 'Agency' : 'Distributor'} branding`}
        description="Override the tenant's logo + colours on their behalf. Every change is recorded in the audit log."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href={listHref}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Link>
            </Button>
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
              <Save className="h-4 w-4" /> Save override
            </Button>
          </div>
        }
      />

      {/* Admin-action notice — surfaces consequence + audit trail. */}
      <Card className="border-warning/40 bg-warning-soft/40">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            strokeWidth={1.75}
          />
          <div className="text-xs text-ink-2">
            <p className="font-semibold text-ink-1">Admin override</p>
            <p className="mt-0.5 text-ink-3">
              The tenant can re-edit their branding at any time from{' '}
              <code className="font-mono text-[11px]">/settings/branding</code>. This
              change is logged with{' '}
              <code className="font-mono text-[11px]">action=branding.admin_override</code>{' '}
              against your user.
            </p>
          </div>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* Left — form */}
          <div className="space-y-5">
            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="eyebrow text-ink-3 flex items-center gap-1.5">
                      <ShieldCheck className="h-3 w-3" /> Identity
                    </p>
                    <h2 className="mt-1 text-lg font-bold text-ink-1">
                      Logo &amp; company name
                    </h2>
                    <p className="mt-1 font-mono text-[10px] text-ink-4">
                      {subjectKind} · {subjectId}
                    </p>
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
                  />
                </FormField>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-5 p-6">
                <div>
                  <p className="eyebrow text-ink-3">Colour palette</p>
                  <h2 className="mt-1 text-lg font-bold text-ink-1">Primary &amp; Secondary</h2>
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

            {/* Audit log */}
            <Card>
              <CardContent className="p-6">
                <div className="mb-3 flex items-center justify-between">
                  <p className="eyebrow text-ink-3 flex items-center gap-1.5">
                    <History className="h-3 w-3" /> Audit log
                  </p>
                  <Badge variant="outline" className="text-[10px]">
                    {auditQuery.data?.length ?? 0} entries
                  </Badge>
                </div>
                {auditQuery.isLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : (auditQuery.data ?? []).length === 0 ? (
                  <p className="text-xs text-ink-3">No audit entries yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {(auditQuery.data ?? []).slice(0, 12).map((row) => (
                      <li
                        key={row._id}
                        className="flex items-center justify-between gap-3 rounded-md border bg-surface-1 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
                              row.action.includes('admin_override')
                                ? 'bg-warning-soft text-warning'
                                : row.action.includes('reset')
                                  ? 'bg-danger-soft text-danger'
                                  : 'bg-brand-50 text-brand-700'
                            }`}
                          >
                            {row.action}
                          </span>
                          <span className="ml-2 text-ink-2">
                            by{' '}
                            <span className="font-mono">{row.actorRole ?? '—'}</span>{' '}
                            <span className="text-ink-4">{row.actorId?.slice(-6) ?? ''}</span>
                          </span>
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-ink-4 tabular-nums">
                          {new Date(row.createdAt).toLocaleString('en-IN', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right — sticky live preview */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            <Card>
              <CardContent className="space-y-3 p-4">
                <p className="eyebrow text-ink-3">Live preview</p>
                <BrandingPreview
                  companyName={companyName || 'Company'}
                  logoUrl={previewLogoUrl}
                  primaryColor={primaryColor}
                  primaryHoverColor={previewPrimaryHover}
                  primaryForegroundColor={previewPrimaryFg}
                  secondaryColor={secondaryColor}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset this tenant's branding to defaults?"
        description="The logo will be deleted and colours reset to TripBng defaults. The tenant can configure new branding any time. This action is logged."
        confirmLabel="Reset"
        destructive
        onConfirm={async () => {
          await resetAll.mutateAsync(undefined);
        }}
      />
    </div>
  );
}
