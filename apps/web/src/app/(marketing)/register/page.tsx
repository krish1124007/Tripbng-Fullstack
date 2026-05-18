'use client';

// /register — multi-section sign-up flow.
//
// UX guarantees (everything works without a page reload):
//   - Auto-save on every field change (debounced PATCH)
//   - Each verification (mobile/email/WhatsApp OTP, PAN, Aadhar, GST)
//     updates the local registration object inline from the verify
//     response — the badge flips from "Verify" → "Verified" smoothly
//   - Right-rail checklist tracks progress in real time + tells the
//     user exactly what's left before they can submit
//   - Live distributor referral-code lookup (debounced) — the form
//     shows the linked distributor's name as the applicant types
//   - 6-digit OTP entry as separate boxes with auto-advance + paste
//
// Dev OTP: any non-prod build accepts "000000" so QA can exercise the
// flow without real SMS/email providers wired.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  AtSign,
  Building2,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  Loader2,
  MapPin,
  Network,
  Phone,
  Receipt,
  Save,
  ShieldCheck,
  Sparkles,
  Square,
  Upload,
  User as UserIcon,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@/components/ui';
import { Logo } from '@/components/logo';
import { apiFetch, ApiCallError } from '@/lib/api';
import { cn } from '@/lib/utils';

// ────────── Types ──────────

interface Registration {
  id: string;
  applicationCode: string;
  status: string;
  agentType: 'RETAILER' | 'CORPORATE' | 'TMC' | 'OTHER';
  companyName: string;
  companyType: 'PROPRIETOR' | 'PARTNER' | 'COMPANY_LLP';
  mobileCountryCode: string;
  mobile: string;
  mobileVerified: boolean;
  whatsappCountryCode: string;
  whatsapp: string;
  whatsappVerified: boolean;
  whatsappSameAsMobile: boolean;
  email: string;
  emailVerified: boolean;
  ownerTitle: 'MR' | 'MRS' | 'MS' | 'DR';
  ownerFirstName: string;
  ownerLastName: string;
  ownerDob: string | null;
  panNumber: string;
  panVerified: boolean;
  panNameOnRecord: string;
  panDocUrl: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  country: string;
  state: string;
  city: string;
  pincode: string;
  aadharNumber: string;
  aadharVerified: boolean;
  aadharNameOnRecord: string;
  gstNumber: string;
  gstVerified: boolean;
  gstLegalName: string;
  distributorCode: string;
  distributorId: string | null;
  salesRepCode: string;
  relationshipManagerCode: string;
  termsAccepted: boolean;
}

const COMPANY_TYPES: { value: Registration['companyType']; label: string }[] = [
  { value: 'PROPRIETOR', label: 'Proprietor' },
  { value: 'PARTNER', label: 'Partner' },
  { value: 'COMPANY_LLP', label: 'Company / LLP' },
];

const AGENT_TYPES: { value: Registration['agentType']; label: string; desc: string }[] = [
  { value: 'RETAILER', label: 'Retailer', desc: 'Storefront / counter agency' },
  { value: 'CORPORATE', label: 'Corporate TA', desc: 'In-house corporate travel' },
  { value: 'TMC', label: 'TMC', desc: 'Travel management company' },
  { value: 'OTHER', label: 'Other', desc: 'Tour operator, charter, etc.' },
];

// ────────── Page ──────────

export default function RegisterPage() {
  const [reg, setReg] = useState<Registration | null>(null);
  const [draftCompany, setDraftCompany] = useState({
    agentType: 'RETAILER' as Registration['agentType'],
    companyName: '',
    companyType: 'PROPRIETOR' as Registration['companyType'],
    mobile: '',
    email: '',
  });
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // ── Auto-save queue ─────────────────────────────────────────────
  // Coalesce keystrokes — one PATCH in flight at a time, queue the
  // most recent batch behind it. After it lands we flash "Saved" then
  // settle back to "idle" so the user gets passive feedback that their
  // edits persisted.
  const patchQueue = useRef<Partial<Registration> | null>(null);
  const patchInFlight = useRef(false);
  const savedFadeTimer = useRef<NodeJS.Timeout | null>(null);

  const flushPatch = useCallback(async (regId: string) => {
    if (!patchQueue.current || patchInFlight.current) return;
    patchInFlight.current = true;
    setSaveState('saving');
    const batch = patchQueue.current;
    patchQueue.current = null;
    try {
      const updated = await apiFetch<Registration>(`/api/v1/registrations/${regId}`, {
        method: 'PATCH',
        body: batch,
      });
      setReg((prev) => (prev ? { ...prev, ...updated } : updated));
      setSaveState('saved');
      if (savedFadeTimer.current) clearTimeout(savedFadeTimer.current);
      savedFadeTimer.current = setTimeout(() => setSaveState('idle'), 1600);
    } catch (err) {
      setSaveState('idle');
      if (err instanceof ApiCallError) toast.error(err.message);
    } finally {
      patchInFlight.current = false;
      if (patchQueue.current) flushPatch(regId);
    }
  }, []);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  function update<K extends keyof Registration>(field: K, value: Registration[K]) {
    if (!reg) return;
    setReg((prev) => (prev ? { ...prev, [field]: value } : prev));
    patchQueue.current = { ...(patchQueue.current ?? {}), [field]: value };
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => flushPatch(reg.id), 350);
  }

  // Called from each Verify component when the backend returns the
  // refreshed registration — keeps local state in lockstep so the
  // checklist flips immediately.
  function applyRegistrationUpdate(updated: Registration) {
    setReg(updated);
  }

  async function createDraft() {
    if (!draftCompany.companyName || !draftCompany.mobile || !draftCompany.email) {
      toast.error('Company name, mobile, and email are required to start.');
      return;
    }
    setCreatingDraft(true);
    try {
      const r = await apiFetch<Registration>('/api/v1/registrations', {
        method: 'POST',
        body: {
          agentType: draftCompany.agentType,
          companyName: draftCompany.companyName,
          companyType: draftCompany.companyType,
          mobile: draftCompany.mobile,
          email: draftCompany.email,
          mobileCountryCode: '+91',
        },
      });
      setReg(r);
      toast.success(`Application started · ${r.applicationCode}`);
    } catch (err) {
      if (err instanceof ApiCallError) toast.error(err.message);
      else toast.error('Could not start the application.');
    } finally {
      setCreatingDraft(false);
    }
  }

  async function onSubmit() {
    if (!reg) return;
    if (!reg.termsAccepted) {
      toast.error('Please accept the Terms & Privacy Policy.');
      return;
    }
    setSubmitting(true);
    try {
      const r = await apiFetch<Registration>(`/api/v1/registrations/${reg.id}/submit`, {
        method: 'POST',
      });
      setReg(r);
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiCallError) toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted && reg) {
    return <SubmittedScreen reg={reg} />;
  }

  return (
    <div data-theme="light" className="min-h-screen bg-surface-1">
      <Header reg={reg} saveState={saveState} />

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
        {!reg ? (
          <StartCard
            draft={draftCompany}
            setDraft={setDraftCompany}
            onStart={createDraft}
            busy={creatingDraft}
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:gap-8">
            <div className="space-y-6">
              <AgentTypeSection reg={reg} update={update} />
              <CompanySection reg={reg} update={update} />
              <ContactsSection reg={reg} update={update} onRefresh={applyRegistrationUpdate} />
              <OwnerSection reg={reg} update={update} onRefresh={applyRegistrationUpdate} />
              <AddressSection reg={reg} update={update} />
              <KycSection reg={reg} update={update} onRefresh={applyRegistrationUpdate} />
              <DistributorSection reg={reg} update={update} />
              <TermsAndSubmit
                reg={reg}
                update={update}
                busy={submitting}
                onSubmit={onSubmit}
              />
            </div>
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <ProgressRail reg={reg} />
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

// ────────── Header ──────────

function Header({ reg, saveState }: { reg: Registration | null; saveState: 'idle' | 'saving' | 'saved' }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center transition-opacity hover:opacity-80">
          <Logo variant="full" className="h-7 w-auto" />
        </Link>
        <div className="hidden h-6 w-px bg-strong/40 sm:block" />
        <p className="hidden text-sm font-semibold text-ink-1 sm:block">
          Sign Up
          <span className="mx-2 text-ink-4">·</span>
          <span className="text-brand-700">Agency Registration</span>
        </p>

        <div className="ml-auto flex items-center gap-3 text-sm">
          {reg ? (
            <>
              <span className="hidden items-center gap-1.5 font-mono text-xs text-ink-3 md:inline-flex">
                <span className="grid h-1.5 w-1.5 place-items-center rounded-full bg-success" />
                {reg.applicationCode}
              </span>
              <SaveIndicator state={saveState} />
            </>
          ) : null}
          <Link href="/login" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  return (
    <span
      className={cn(
        'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-opacity sm:inline-flex',
        state === 'idle' && 'opacity-0',
        state === 'saving' && 'bg-brand-50 text-brand-700',
        state === 'saved' && 'bg-success/15 text-success',
      )}
    >
      {state === 'saving' ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" /> Saving
        </>
      ) : state === 'saved' ? (
        <>
          <CheckCircle2 className="h-3 w-3" /> Saved
        </>
      ) : null}
    </span>
  );
}

// ────────── Start card ──────────

function StartCard({
  draft,
  setDraft,
  onStart,
  busy,
}: {
  draft: { agentType: Registration['agentType']; companyName: string; companyType: Registration['companyType']; mobile: string; email: string };
  setDraft: (d: { agentType: Registration['agentType']; companyName: string; companyType: Registration['companyType']; mobile: string; email: string }) => void;
  onStart: () => void;
  busy: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <Card className="overflow-hidden p-0">
        <div className="relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-500 to-accent-500 px-6 py-10 text-white sm:px-10">
          <div
            aria-hidden
            className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl animate-float-orb"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 bottom-0 h-56 w-56 rounded-full bg-accent-300/30 blur-3xl animate-float-orb-slow"
          />
          <div className="relative">
            <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-white/80">
              Sign up · Agency registration
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              Join 12,400+ travel agencies on TripBng
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
              Tell us a bit about your business. We&apos;ll verify your details and your
              distributor will approve — usually within 24 hours.
            </p>
          </div>
        </div>

        <div className="space-y-5 p-6 sm:p-10">
          <Field label="Agent type">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {AGENT_TYPES.map((t) => (
                <PillButton
                  key={t.value}
                  selected={draft.agentType === t.value}
                  onClick={() => setDraft({ ...draft, agentType: t.value })}
                  primary={t.label}
                  secondary={t.desc}
                />
              ))}
            </div>
          </Field>
          <Field label="Company name" required>
            <Input
              value={draft.companyName}
              onChange={(e) => setDraft({ ...draft, companyName: e.target.value })}
              placeholder="Sharma Travels"
            />
          </Field>
          <Field label="Organisation type">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {COMPANY_TYPES.map((t) => (
                <PillButton
                  key={t.value}
                  selected={draft.companyType === t.value}
                  onClick={() => setDraft({ ...draft, companyType: t.value })}
                  primary={t.label}
                />
              ))}
            </div>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Mobile" required>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-md border border-r-0 bg-surface-2 px-3 text-sm font-medium text-ink-2">
                  +91
                </span>
                <Input
                  className="rounded-l-none"
                  value={draft.mobile}
                  onChange={(e) =>
                    setDraft({ ...draft, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })
                  }
                  placeholder="98765 43210"
                  type="tel"
                  inputMode="numeric"
                />
              </div>
            </Field>
            <Field label="Email" required>
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="you@agency.in"
              />
            </Field>
          </div>
          <Button
            onClick={onStart}
            size="lg"
            className="group relative w-full overflow-hidden sm:w-auto"
            disabled={busy}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500 opacity-0 transition-opacity group-hover:opacity-100"
            />
            <span className="relative inline-flex items-center gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? 'Starting…' : 'Start application'}
              <ArrowRight className="h-4 w-4" />
            </span>
          </Button>
          <p className="text-xs text-ink-3">
            We auto-save as you type. Already started?{' '}
            <Link href="/login" className="font-semibold text-brand-700 hover:underline">
              Sign in
            </Link>{' '}
            with your credentials.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ────────── Sections ──────────

function AgentTypeSection({
  reg,
  update,
}: {
  reg: Registration;
  update: <K extends keyof Registration>(k: K, v: Registration[K]) => void;
}) {
  return (
    <Section title="Agency type" icon={Building2} stepNumber={1}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {AGENT_TYPES.map((t) => (
          <PillButton
            key={t.value}
            selected={reg.agentType === t.value}
            onClick={() => update('agentType', t.value)}
            primary={t.label}
            secondary={t.desc}
          />
        ))}
      </div>
    </Section>
  );
}

function CompanySection({
  reg,
  update,
}: {
  reg: Registration;
  update: <K extends keyof Registration>(k: K, v: Registration[K]) => void;
}) {
  return (
    <Section title="Company information" icon={Building2} stepNumber={2}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Company name" required>
          <Input value={reg.companyName} onChange={(e) => update('companyName', e.target.value)} />
        </Field>
        <Field label="Organisation type">
          <div className="grid grid-cols-3 gap-2">
            {COMPANY_TYPES.map((t) => (
              <PillButton
                key={t.value}
                selected={reg.companyType === t.value}
                onClick={() => update('companyType', t.value)}
                primary={t.label}
                compact
              />
            ))}
          </div>
        </Field>
      </div>
    </Section>
  );
}

function ContactsSection({
  reg,
  update,
  onRefresh,
}: {
  reg: Registration;
  update: <K extends keyof Registration>(k: K, v: Registration[K]) => void;
  onRefresh: (r: Registration) => void;
}) {
  return (
    <Section title="Company contacts" icon={Phone} stepNumber={3} required>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Mobile" required>
          <OtpVerifiable
            channel="mobile"
            registrationId={reg.id}
            countryCode={reg.mobileCountryCode}
            value={reg.mobile}
            verified={reg.mobileVerified}
            onValueChange={(v) => update('mobile', v.replace(/\D/g, '').slice(0, 10))}
            onVerified={onRefresh}
            placeholder="98765 43210"
            withCountryCode
          />
        </Field>
        <Field
          label="WhatsApp"
          hint={
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-normal text-ink-3 hover:text-ink-1">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 cursor-pointer"
                checked={reg.whatsappSameAsMobile}
                onChange={(e) => {
                  update('whatsappSameAsMobile', e.target.checked);
                  if (e.target.checked) update('whatsapp', reg.mobile);
                }}
              />
              Same as mobile
            </label>
          }
        >
          <OtpVerifiable
            channel="whatsapp"
            registrationId={reg.id}
            countryCode={reg.whatsappCountryCode}
            value={reg.whatsapp}
            verified={reg.whatsappVerified}
            disabled={reg.whatsappSameAsMobile}
            onValueChange={(v) => update('whatsapp', v.replace(/\D/g, '').slice(0, 10))}
            onVerified={onRefresh}
            placeholder="98765 43210"
            withCountryCode
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Email" required>
            <OtpVerifiable
              channel="email"
              registrationId={reg.id}
              value={reg.email}
              verified={reg.emailVerified}
              onValueChange={(v) => update('email', v)}
              onVerified={onRefresh}
              placeholder="you@agency.in"
              leadingIcon={AtSign}
            />
          </Field>
        </div>
      </div>
    </Section>
  );
}

function OwnerSection({
  reg,
  update,
  onRefresh,
}: {
  reg: Registration;
  update: <K extends keyof Registration>(k: K, v: Registration[K]) => void;
  onRefresh: (r: Registration) => void;
}) {
  return (
    <Section title="Owner's PAN information (as per PAN)" icon={UserIcon} stepNumber={4}>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Title">
          <Select
            value={reg.ownerTitle}
            onChange={(v) => update('ownerTitle', v as Registration['ownerTitle'])}
          >
            <option value="MR">Mr</option>
            <option value="MRS">Mrs</option>
            <option value="MS">Ms</option>
            <option value="DR">Dr</option>
          </Select>
        </Field>
        <Field label="First name">
          <Input value={reg.ownerFirstName} onChange={(e) => update('ownerFirstName', e.target.value)} />
        </Field>
        <Field label="Last name">
          <Input value={reg.ownerLastName} onChange={(e) => update('ownerLastName', e.target.value)} />
        </Field>
        <Field label="Date of birth">
          <Input
            type="date"
            value={reg.ownerDob ? reg.ownerDob.slice(0, 10) : ''}
            onChange={(e) => update('ownerDob', e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_220px]">
        <Field
          label="PAN number"
          hint={
            reg.panVerified && reg.panNameOnRecord
              ? `Name on PAN · ${reg.panNameOnRecord}`
              : undefined
          }
        >
          <InstantVerifiable
            registrationId={reg.id}
            value={reg.panNumber}
            verified={reg.panVerified}
            onValueChange={(v) => update('panNumber', v.toUpperCase().slice(0, 10))}
            onVerified={onRefresh}
            endpoint="pan"
            placeholder="AAAPL1234C"
          />
        </Field>
        <Field label="Upload PAN (optional)">
          <PanUpload value={reg.panDocUrl} onChange={(v) => update('panDocUrl', v)} />
        </Field>
      </div>
    </Section>
  );
}

function AddressSection({
  reg,
  update,
}: {
  reg: Registration;
  update: <K extends keyof Registration>(k: K, v: Registration[K]) => void;
}) {
  return (
    <Section title="Company address" icon={MapPin} stepNumber={5}>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Address line 1">
          <Input value={reg.addressLine1} onChange={(e) => update('addressLine1', e.target.value)} />
        </Field>
        <Field label="Address line 2">
          <Input value={reg.addressLine2} onChange={(e) => update('addressLine2', e.target.value)} />
        </Field>
        <Field label="Address line 3">
          <Input value={reg.addressLine3} onChange={(e) => update('addressLine3', e.target.value)} />
        </Field>
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-4">
        <Field label="Country">
          <Input value={reg.country} onChange={(e) => update('country', e.target.value)} />
        </Field>
        <Field label="State">
          <Input
            value={reg.state}
            onChange={(e) => update('state', e.target.value)}
            placeholder="Maharashtra"
          />
        </Field>
        <Field label="City">
          <Input
            value={reg.city}
            onChange={(e) => update('city', e.target.value)}
            placeholder="Mumbai"
          />
        </Field>
        <Field label="Pincode">
          <Input
            value={reg.pincode}
            onChange={(e) => update('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="400051"
            inputMode="numeric"
          />
        </Field>
      </div>
    </Section>
  );
}

function KycSection({
  reg,
  update,
  onRefresh,
}: {
  reg: Registration;
  update: <K extends keyof Registration>(k: K, v: Registration[K]) => void;
  onRefresh: (r: Registration) => void;
}) {
  return (
    <Section title="Aadhar verification & GST" icon={ShieldCheck} stepNumber={6}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Aadhar number"
          hint={
            reg.aadharVerified && reg.aadharNameOnRecord
              ? `Name · ${reg.aadharNameOnRecord}`
              : undefined
          }
        >
          <InstantVerifiable
            registrationId={reg.id}
            value={reg.aadharNumber}
            verified={reg.aadharVerified}
            onValueChange={(v) => update('aadharNumber', v.replace(/\D/g, '').slice(0, 12))}
            onVerified={onRefresh}
            endpoint="aadhar"
            placeholder="1234 5678 9012"
            inputMode="numeric"
          />
        </Field>
        <Field
          label="GST number (optional)"
          hint={
            reg.gstVerified && reg.gstLegalName
              ? `Legal name · ${reg.gstLegalName}`
              : undefined
          }
        >
          <InstantVerifiable
            registrationId={reg.id}
            value={reg.gstNumber}
            verified={reg.gstVerified}
            onValueChange={(v) => update('gstNumber', v.toUpperCase().slice(0, 15))}
            onVerified={onRefresh}
            endpoint="gst"
            placeholder="27ABCTI1234R1ZX"
          />
        </Field>
      </div>
    </Section>
  );
}

function DistributorSection({
  reg,
  update,
}: {
  reg: Registration;
  update: <K extends keyof Registration>(k: K, v: Registration[K]) => void;
}) {
  type Lookup =
    | { state: 'idle' }
    | { state: 'busy' }
    | { state: 'found'; name: string; city: string; stateName: string }
    | { state: 'notfound' };
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });

  // Auto-check after the user pauses typing (300ms) — so the linked
  // distributor surfaces without an extra button click. The dedicated
  // Verify button still exists for users who'd rather click than wait.
  useEffect(() => {
    const code = reg.distributorCode.trim();
    if (!code) {
      setLookup({ state: 'idle' });
      return;
    }
    setLookup({ state: 'busy' });
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch<{
          found: boolean;
          distributor?: { companyName: string; city: string; state: string };
        }>(`/api/v1/distributors/public/by-code/${encodeURIComponent(code)}`);
        if (res.found && res.distributor) {
          setLookup({
            state: 'found',
            name: res.distributor.companyName,
            city: res.distributor.city,
            stateName: res.distributor.state,
          });
        } else {
          setLookup({ state: 'notfound' });
        }
      } catch {
        setLookup({ state: 'notfound' });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [reg.distributorCode]);

  return (
    <Section title="Distributor & channel" icon={Network} stepNumber={7}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Distributor code (optional)"
          hint={
            lookup.state === 'found' ? (
              <span className="inline-flex items-center gap-1 text-success">
                <CheckCircle2 className="h-3 w-3" /> {lookup.name} · {lookup.city}, {lookup.stateName}
              </span>
            ) : lookup.state === 'notfound' ? (
              <span className="text-danger">No distributor with that code</span>
            ) : undefined
          }
        >
          <div className="relative">
            <Input
              value={reg.distributorCode}
              onChange={(e) => update('distributorCode', e.target.value.toUpperCase())}
              placeholder="DST-XXXX"
              className="pr-10"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              {lookup.state === 'busy' ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" /> : null}
              {lookup.state === 'found' ? <CheckCircle2 className="h-4 w-4 text-success" /> : null}
            </span>
          </div>
        </Field>
        <Field label="Sales representative (optional)">
          <Input value={reg.salesRepCode} onChange={(e) => update('salesRepCode', e.target.value)} />
        </Field>
        <Field label="Relationship manager (optional)">
          <Input
            value={reg.relationshipManagerCode}
            onChange={(e) => update('relationshipManagerCode', e.target.value)}
          />
        </Field>
      </div>
    </Section>
  );
}

function TermsAndSubmit({
  reg,
  update,
  busy,
  onSubmit,
}: {
  reg: Registration;
  update: <K extends keyof Registration>(k: K, v: Registration[K]) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  const ready = reg.termsAccepted;
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b bg-gradient-to-br from-surface-1 to-brand-50/30 p-5 sm:p-7">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={reg.termsAccepted}
            onChange={(e) => update('termsAccepted', e.target.checked)}
            className="mt-1 h-4 w-4 cursor-pointer"
          />
          <span className="text-sm leading-relaxed text-ink-2">
            I agree to receive RCS, WhatsApp, Email or SMS from Tripbng India Private Limited. I
            have reviewed and agreed to the{' '}
            <Link
              href="/terms"
              className="font-semibold text-brand-700 hover:underline"
              target="_blank"
            >
              Terms &amp; Conditions
            </Link>{' '}
            and{' '}
            <Link
              href="/privacy"
              className="font-semibold text-brand-700 hover:underline"
              target="_blank"
            >
              Privacy Policy
            </Link>
            .
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 p-5 sm:p-7">
        <Button asChild variant="ghost" size="lg">
          <Link href="/">Cancel</Link>
        </Button>
        <Button
          size="lg"
          onClick={onSubmit}
          disabled={busy || !ready}
          className="group relative overflow-hidden"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-600 via-brand-500 to-accent-500 opacity-0 transition-opacity group-hover:opacity-100"
          />
          <span className="relative inline-flex items-center gap-1.5">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
              </>
            ) : (
              <>
                Submit application <ArrowRight className="h-4 w-4" />
              </>
            )}
          </span>
        </Button>
      </div>
    </Card>
  );
}

// ────────── Progress rail (sticky sidebar) ──────────

function ProgressRail({ reg }: { reg: Registration }) {
  const items: { label: string; done: boolean; required: boolean }[] = [
    { label: 'Company name', done: reg.companyName.length >= 2, required: true },
    { label: 'Mobile verified', done: reg.mobileVerified, required: true },
    { label: 'Email verified', done: reg.emailVerified, required: true },
    { label: 'WhatsApp verified', done: reg.whatsappSameAsMobile || reg.whatsappVerified, required: false },
    { label: 'Owner name', done: Boolean(reg.ownerFirstName && reg.ownerLastName), required: true },
    { label: 'Date of birth', done: Boolean(reg.ownerDob), required: false },
    { label: 'PAN verified', done: reg.panVerified, required: true },
    { label: 'Address', done: Boolean(reg.addressLine1 && reg.city && reg.state && reg.pincode), required: true },
    { label: 'Aadhar verified', done: reg.aadharVerified, required: true },
    { label: 'GST verified', done: reg.gstVerified, required: false },
    { label: 'Terms accepted', done: reg.termsAccepted, required: true },
  ];
  const requiredCount = items.filter((i) => i.required).length;
  const requiredDone = items.filter((i) => i.required && i.done).length;
  const pct = Math.round((requiredDone / requiredCount) * 100);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-0">
        <div className="bg-gradient-to-br from-brand-600 to-accent-500 p-5 text-white">
          <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-white/80">
            Your progress
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{pct}%</span>
            <span className="text-xs text-white/80">complete</span>
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-white transition-[width] duration-normal"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-white/85">
            {pct === 100
              ? "You're all set — accept terms and submit."
              : `${requiredCount - requiredDone} required step${requiredCount - requiredDone === 1 ? '' : 's'} left.`}
          </p>
        </div>
        <ul className="space-y-1 p-3">
          {items.map((it) => (
            <li
              key={it.label}
              className={cn(
                'flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors',
                it.done ? 'text-ink-2' : 'text-ink-3',
              )}
            >
              <span className="inline-flex items-center gap-2">
                {it.done ? (
                  <CheckSquare className="h-4 w-4 text-success" strokeWidth={2} />
                ) : (
                  <Square className="h-4 w-4 text-ink-4" strokeWidth={1.75} />
                )}
                {it.label}
              </span>
              {!it.required ? (
                <span className="text-[10px] font-mono text-ink-4">optional</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4">
        <p className="text-xs font-semibold text-ink-1">Why we verify</p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
          PAN, Aadhar, and GST checks keep TripBng compliant under the DPDP Act and IATA / TAFI
          accreditation rules. We never share these with third parties.
        </p>
      </Card>
    </div>
  );
}

// ────────── Submitted screen ──────────

function SubmittedScreen({ reg }: { reg: Registration }) {
  return (
    <div data-theme="light" className="grid min-h-screen place-items-center bg-surface-1 p-6">
      <Card className="w-full max-w-xl overflow-hidden p-0">
        <div className="relative overflow-hidden bg-gradient-to-br from-success/85 to-success px-8 py-10 text-white">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-56 w-56 rounded-full bg-white/15 blur-3xl" />
          <span className="grid h-14 w-14 place-items-center rounded-full bg-white/20 backdrop-blur">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <h1 className="mt-5 text-2xl font-bold">Application submitted</h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-white/90">
            Our partnerships team is reviewing your details. You&apos;ll receive an email with
            login credentials once you&apos;re approved — usually within 24 working hours.
          </p>
        </div>
        <div className="space-y-4 p-8">
          <div className="flex items-center justify-between rounded-md border bg-surface-1 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wider text-ink-3">Application code</p>
            <p className="font-mono text-lg font-bold text-ink-1">{reg.applicationCode}</p>
          </div>
          <p className="text-sm text-ink-3">
            Save this code — we&apos;ll reference it in any follow-up email. Questions? Email{' '}
            <a href="mailto:partner@tripbng.com" className="font-semibold text-brand-700 hover:underline">
              partner@tripbng.com
            </a>{' '}
            or call{' '}
            <a href="tel:+912261964040" className="font-semibold text-brand-700 hover:underline">
              +91 22 6196 4040
            </a>
            .
          </p>
          <Button asChild size="lg" className="w-full">
            <Link href="/">
              Back to home <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ────────── Section shell ──────────

function Section({
  title,
  icon: Icon,
  stepNumber,
  required,
  children,
}: {
  title: string;
  icon: typeof Building2;
  stepNumber?: number;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-7">
      <div className="mb-5 flex items-center gap-3 border-b pb-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-sm">
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <h2 className="text-base font-bold tracking-tight text-ink-1">
            {title} {required ? <span className="text-danger">*</span> : null}
          </h2>
          {stepNumber ? (
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Step {stepNumber}</p>
          ) : null}
        </div>
      </div>
      {children}
    </Card>
  );
}

// ────────── Primitives ──────────

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium text-ink-2">
        <span>
          {label} {required ? <span className="text-danger">*</span> : null}
        </span>
        {hint ? <span className="text-xs font-normal text-ink-3 text-right">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-md border bg-surface-1 px-3 py-2.5 text-sm text-ink-1 placeholder:text-ink-4 transition-colors focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-4',
        props.className,
      )}
    />
  );
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-md border bg-surface-1 px-3 py-2.5 pr-9 text-sm text-ink-1 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
    </div>
  );
}

function PillButton({
  selected,
  onClick,
  primary,
  secondary,
  compact,
}: {
  selected: boolean;
  onClick: () => void;
  primary: string;
  secondary?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group rounded-lg border text-left transition-all',
        compact ? 'px-3 py-2.5 text-center text-sm' : 'p-3',
        selected
          ? 'border-brand-500 bg-brand-50/80 ring-2 ring-brand-200/60'
          : 'hover:border-brand-300 hover:bg-surface-2',
      )}
    >
      <div className={cn('flex items-center gap-2', compact && 'justify-center')}>
        <span
          className={cn(
            'grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 transition-colors',
            selected ? 'border-brand-600' : 'border-strong/40',
          )}
        >
          {selected ? <span className="h-2 w-2 rounded-full bg-brand-600" /> : null}
        </span>
        <span className={cn('font-semibold', selected ? 'text-brand-700' : 'text-ink-1')}>{primary}</span>
      </div>
      {secondary ? <p className={cn('mt-1 text-[11px] text-ink-3', compact && 'hidden')}>{secondary}</p> : null}
    </button>
  );
}

// ────────── OTP verifiable input (mobile / email / whatsapp) ──────────

function OtpVerifiable({
  channel,
  registrationId,
  countryCode,
  value,
  verified,
  onValueChange,
  onVerified,
  placeholder,
  disabled,
  withCountryCode,
  leadingIcon: LeadingIcon,
}: {
  channel: 'mobile' | 'email' | 'whatsapp';
  registrationId: string;
  countryCode?: string;
  value: string;
  verified: boolean;
  onValueChange: (v: string) => void;
  onVerified: (r: Registration) => void;
  placeholder?: string;
  disabled?: boolean;
  withCountryCode?: boolean;
  leadingIcon?: typeof Phone;
}) {
  const [stage, setStage] = useState<'idle' | 'sent'>('idle');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [otp, setOtp] = useState<string[]>(Array(6).fill(''));

  // Reset to idle if the underlying value changes after sending (user
  // edited their mobile/email — the OTP is no longer valid).
  useEffect(() => {
    if (stage === 'sent' && !verified) setStage('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function send() {
    if (!value || value.length < 5) return toast.error(`Enter ${channel} first.`);
    setSending(true);
    try {
      const r = await apiFetch<{ delivered: boolean; devHint?: string }>(
        `/api/v1/registrations/${registrationId}/otp/send`,
        { method: 'POST', body: { channel } },
      );
      setStage('sent');
      setOtp(Array(6).fill(''));
      toast.success(r.devHint ?? `OTP sent to your ${channel}`);
    } catch (err) {
      if (err instanceof ApiCallError) toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  async function confirm(code: string) {
    if (code.length !== 6) return;
    setConfirming(true);
    try {
      const r = await apiFetch<{ ok: boolean; message?: string; registration?: Registration }>(
        `/api/v1/registrations/${registrationId}/otp/verify`,
        { method: 'POST', body: { channel, otp: code } },
      );
      if (r.ok && r.registration) {
        toast.success(`${cap(channel)} verified`);
        onVerified(r.registration);
        setStage('idle');
        setOtp(Array(6).fill(''));
      } else {
        toast.error(r.message ?? 'Invalid code');
        setOtp(Array(6).fill(''));
      }
    } catch (err) {
      if (err instanceof ApiCallError) toast.error(err.message);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          {withCountryCode && countryCode ? (
            <div className="flex">
              <span className="inline-flex items-center rounded-l-md border border-r-0 bg-surface-2 px-3 text-sm font-medium text-ink-2">
                {countryCode}
              </span>
              <Input
                className={cn('rounded-l-none', verified && 'bg-success/5 text-success font-semibold')}
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled || verified}
                type="tel"
                inputMode="numeric"
              />
            </div>
          ) : (
            <div className="relative">
              {LeadingIcon ? (
                <LeadingIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
              ) : null}
              <Input
                className={cn(
                  LeadingIcon ? 'pl-9' : '',
                  verified && 'bg-success/5 text-success font-semibold',
                )}
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled || verified}
                type={channel === 'email' ? 'email' : 'text'}
              />
            </div>
          )}
        </div>
        {verified ? (
          <Button size="sm" variant="ghost" disabled className="text-success">
            <CheckCircle2 className="h-4 w-4" /> Verified
          </Button>
        ) : stage === 'idle' ? (
          <Button size="sm" variant="secondary" onClick={send} disabled={sending || disabled}>
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Verify
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={send} disabled={sending}>
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Resend
          </Button>
        )}
      </div>
      {stage === 'sent' && !verified ? (
        <div className="rounded-md border bg-surface-2/60 p-3 animate-fade-in-up">
          <p className="mb-2 text-xs text-ink-3">
            Enter the 6-digit code we sent. Dev OTP is{' '}
            <span className="font-mono font-semibold text-ink-1">000000</span>.
          </p>
          <OtpBoxes
            digits={otp}
            onChange={(next) => {
              setOtp(next);
              const joined = next.join('');
              if (joined.length === 6) confirm(joined);
            }}
            disabled={confirming}
          />
          <div className="mt-2 flex items-center justify-between text-xs text-ink-3">
            <span>{confirming ? 'Verifying…' : 'Auto-submits when all 6 digits are in'}</span>
            <button
              type="button"
              onClick={() => setStage('idle')}
              className="font-medium text-brand-700 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OtpBoxes({
  digits,
  onChange,
  disabled,
}: {
  digits: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function setDigit(i: number, v: string) {
    const clean = v.replace(/\D/g, '').slice(0, 1);
    const next = [...digits];
    next[i] = clean;
    onChange(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < 5) {
      refs.current[i + 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = Array(6).fill('').map((_, i) => text[i] ?? '');
    onChange(next);
    refs.current[Math.min(text.length, 5)]?.focus();
  }

  return (
    <div className="flex items-center gap-2" onPaste={onPaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          inputMode="numeric"
          pattern="\d"
          maxLength={1}
          disabled={disabled}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          className="h-11 w-10 rounded-md border bg-white text-center font-mono text-lg font-bold text-ink-1 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30 disabled:opacity-60"
        />
      ))}
    </div>
  );
}

// ────────── Instant verifiable (PAN / Aadhar / GST) ──────────

function InstantVerifiable({
  registrationId,
  value,
  verified,
  onValueChange,
  onVerified,
  endpoint,
  placeholder,
  inputMode,
}: {
  registrationId: string;
  value: string;
  verified: boolean;
  onValueChange: (v: string) => void;
  onVerified: (r: Registration) => void;
  endpoint: 'pan' | 'aadhar' | 'gst';
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const r = await apiFetch<{
        ok: boolean;
        message?: string;
        nameOnRecord?: string;
        legalName?: string;
        registration?: Registration;
      }>(`/api/v1/registrations/${registrationId}/verify/${endpoint}`, {
        method: 'POST',
        body: {},
      });
      if (r.ok && r.registration) {
        toast.success(`${endpoint.toUpperCase()} verified`);
        onVerified(r.registration);
      } else {
        toast.error(r.message ?? 'Verification failed');
      }
    } catch (err) {
      if (err instanceof ApiCallError) toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        disabled={verified}
        className={cn('flex-1', verified && 'bg-success/5 text-success font-semibold')}
      />
      {verified ? (
        <Button size="sm" variant="ghost" disabled className="text-success">
          <CheckCircle2 className="h-4 w-4" /> Verified
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={go} disabled={busy || !value}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Verify
        </Button>
      )}
    </div>
  );
}

// ────────── PAN upload ──────────

function PanUpload({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  function handle(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      toast.error('Upload an image or PDF.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File too large (max 2 MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  }

  if (value) {
    return (
      <div className="flex h-[42px] items-center justify-between gap-2 rounded-md border bg-gradient-to-br from-success/10 to-success/5 px-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Attached
        </span>
        <label className="cursor-pointer text-xs font-medium text-brand-700 hover:underline">
          Replace
          <input
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            onChange={(e) => handle(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-ink-3 hover:text-ink-1"
          aria-label="Remove"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  return (
    <label className="flex h-[42px] cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed bg-surface-2/40 px-3 text-xs font-semibold text-ink-2 transition-colors hover:border-brand-300 hover:bg-brand-50/40 hover:text-brand-700">
      <Upload className="h-4 w-4" />
      Upload PAN
      <input
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        onChange={(e) => handle(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

// ────────── Helpers ──────────

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
