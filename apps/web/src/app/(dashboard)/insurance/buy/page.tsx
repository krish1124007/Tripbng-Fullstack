'use client';

// Insurance buy wizard — the live ASEGO purchase flow.
//
// 4 steps in a single page, driven by local state:
//   1. Trip — start/end dates, ASEGO category (from /api/v1/insurance/categories), traveler count
//   2. Plan — render ASEGO quote results, user picks a plan
//   3. Travelers — per-pax form with every field ASEGO's createPolicy needs
//   4. Issue — POST /validate then POST /issue, redirect to /insurance/policy/:n
//
// Defers PNR autofill, comparison modal, and per-plan detail page to a later
// pass (those exist in the legacy mock UI and can be migrated piecemeal).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  type InsuranceIssueRequest,
  type InsuranceIssueResponse,
  type InsuranceTraveler,
} from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@/components/ui';
import { ApiCallError } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/api-client';
import { cn } from '@/lib/utils';

// ────────── Types from ASEGO masters ──────────

interface AsegoCategory {
  id: string;
  name: string;
  description?: string;
}

interface QuotePlanCoverage {
  id?: string;
  name?: string;
  maxAmount?: string;
  currency?: string;
}

interface QuotePlan {
  id?: string;
  name?: string;
  displayName?: string;
  shortName?: string;
  sumInsured?: string;
  asegoRecomended?: boolean;
  bestSellingPlan?: boolean;
  agePremiums?: { age: number; premium: number }[];
  coverages?: QuotePlanCoverage[];
}

interface QuoteRoot {
  insurerId: string;
  insurerName?: string;
  insurerLogoPath?: string;
  termsAndConditions?: string;
  plans?: QuotePlan[];
}

// ────────── Helpers ──────────

const todayPlus = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (a: string, b: string) =>
  Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000) + 1);

const formatINR = (rupees: number) =>
  `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// Default ages used to compute the per-pax age premium. The wizard fans out
// one InsuranceTraveler per slot — each can edit their DOB later, the price
// shown here is the age-band estimate.
const DEFAULT_AGE = 30;

// ────────── Step 1 inputs ──────────

interface TripInputs {
  startDate: string;
  endDate: string;
  categoryId: string;
  destination: string;
  travelerCount: number;
}

// ────────── Page ──────────

export default function InsuranceBuyPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [trip, setTrip] = useState<TripInputs>({
    startDate: todayPlus(7),
    endDate: todayPlus(14),
    categoryId: '',
    destination: '',
    travelerCount: 1,
  });
  const [selectedPlan, setSelectedPlan] = useState<{
    insurerId: string;
    insurerName: string;
    planId: string;
    planName: string;
    sellingPlanId: string;
    premiumRupees: number;
  } | null>(null);
  const [travelers, setTravelers] = useState<InsuranceTraveler[]>([]);

  const days = daysBetween(trip.startDate, trip.endDate);

  // ────────── Master: categories ──────────

  const categories = useApiQuery<AsegoCategory[]>(
    ['insurance-categories'],
    '/api/v1/insurance/categories',
    { staleTime: 24 * 60 * 60 * 1000 },
  );
  useEffect(() => {
    if (!trip.categoryId && categories.data && categories.data.length > 0) {
      const domestic =
        categories.data.find((c) => c.name.toLowerCase().includes('domestic')) ?? categories.data[0]!;
      setTrip((t) => ({ ...t, categoryId: domestic.id }));
    }
  }, [categories.data, trip.categoryId]);

  // ────────── Quote (lazily fired when entering step 2) ──────────

  const quote = useApiMutation<
    { duration: number; age: number; category: string; destination?: string },
    QuoteRoot[] | QuoteRoot
  >('/api/v1/insurance/quote', 'POST', {
    onError: (err) =>
      toast.error(err instanceof ApiCallError ? err.message : 'Quote failed'),
  });

  const flatPlans = useMemo(() => {
    if (!quote.data) return [];
    const roots = Array.isArray(quote.data) ? quote.data : [quote.data];
    return roots.flatMap((root) =>
      (root.plans ?? []).map((p) => ({
        insurerId: root.insurerId,
        insurerName: root.insurerName ?? 'Insurer',
        insurerLogoPath: root.insurerLogoPath,
        plan: p,
      })),
    );
  }, [quote.data]);

  // ────────── Validate + Issue (step 4) ──────────

  const issue = useApiMutation<InsuranceIssueRequest, InsuranceIssueResponse>(
    '/api/v1/insurance/issue',
    'POST',
    {
      onSuccess: (data) => {
        toast.success(`Policy issued: ${data.policyNumbers[0]}`);
        router.push(`/insurance/policy/${data.policyNumbers[0]}`);
      },
      onError: (err) =>
        toast.error(err instanceof ApiCallError ? err.message : 'Issue failed'),
    },
  );

  const validate = useApiMutation<
    {
      quotation: {
        startDate: string;
        endDate: string;
        category: string;
        destination?: string;
      };
      selectedPlan: {
        insurerId: string;
        planId: string;
        sellingPlanId: string;
        totalPremiumPaise: number;
        riders: never[];
      };
      travelers: InsuranceTraveler[];
    },
    { valid: boolean; warnings: string[] }
  >('/api/v1/insurance/validate', 'POST', {
    onSuccess: (data) => {
      if (data.warnings.length > 0) {
        toast.warning(data.warnings.join(' · '));
      }
      // Validate passed — chain to issue.
      issue.mutate(buildIssueRequest());
    },
    onError: (err) =>
      toast.error(err instanceof ApiCallError ? err.message : 'Validation failed'),
  });

  // ────────── Transitions ──────────

  const goStep2 = () => {
    if (!trip.startDate || !trip.endDate || !trip.categoryId) {
      toast.error('Pick dates and a category');
      return;
    }
    if (new Date(trip.endDate) < new Date(trip.startDate)) {
      toast.error('Return must be on or after start');
      return;
    }
    quote.mutate({
      duration: days,
      age: DEFAULT_AGE,
      category: trip.categoryId,
      destination: trip.destination || undefined,
    });
    setStep(2);
  };

  const goStep3 = (root: { insurerId: string; insurerName: string }, plan: QuotePlan) => {
    if (!plan.id) {
      toast.error('Plan id missing');
      return;
    }
    const premium = plan.agePremiums?.find((a) => a.age === DEFAULT_AGE)?.premium
      ?? plan.agePremiums?.[0]?.premium
      ?? 500;
    setSelectedPlan({
      insurerId: root.insurerId,
      insurerName: root.insurerName,
      planId: plan.id,
      planName: plan.displayName ?? plan.name ?? plan.shortName ?? 'Plan',
      sellingPlanId: plan.id, // master `planId` IS the createPolicy `sellingPlanId` per the OpenAPI
      premiumRupees: premium,
    });
    // Seed the traveler list with the selected count.
    setTravelers((existing) =>
      Array.from({ length: trip.travelerCount }, (_, i) => existing[i] ?? blankTraveler()),
    );
    setStep(3);
  };

  const goStep4 = () => {
    for (let i = 0; i < travelers.length; i++) {
      const t = travelers[i]!;
      const errs = travelerErrors(t);
      if (errs.length > 0) {
        toast.error(`Traveler ${i + 1}: ${errs[0]}`);
        return;
      }
    }
    setStep(4);
    validate.mutate({
      quotation: {
        startDate: trip.startDate,
        endDate: trip.endDate,
        category: trip.categoryId,
        destination: trip.destination || undefined,
      },
      selectedPlan: {
        insurerId: selectedPlan!.insurerId,
        planId: selectedPlan!.planId,
        sellingPlanId: selectedPlan!.sellingPlanId,
        totalPremiumPaise: Math.round(selectedPlan!.premiumRupees * 100),
        riders: [],
      },
      travelers,
    });
  };

  const buildIssueRequest = (): InsuranceIssueRequest => ({
    quotation: {
      startDate: trip.startDate,
      endDate: trip.endDate,
      category: trip.categoryId,
      destination: trip.destination || undefined,
    },
    selectedPlan: {
      insurerId: selectedPlan!.insurerId,
      insurerName: selectedPlan!.insurerName,
      planId: selectedPlan!.planId,
      planName: selectedPlan!.planName,
      sellingPlanId: selectedPlan!.sellingPlanId,
      totalPremiumPaise: Math.round(selectedPlan!.premiumRupees * trip.travelerCount * 100),
      riders: [],
    },
    travelers,
  });

  // ────────── Render ──────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/insurance')}>
          <ArrowLeft className="h-4 w-4" /> Insurance
        </Button>
        <h1 className="text-h2 text-ink-1">Buy travel insurance</h1>
        <Badge variant="brand" dot className="ml-auto">
          <ShieldCheck className="h-3 w-3" /> Step {step} of 4
        </Badge>
      </div>

      <Stepper step={step} />

      {step === 1 && (
        <Step1Trip
          trip={trip}
          onChange={setTrip}
          categories={categories.data ?? []}
          loadingCategories={categories.isPending}
          onNext={goStep2}
        />
      )}

      {step === 2 && (
        <Step2Plans
          loading={quote.isPending}
          plans={flatPlans}
          travelerCount={trip.travelerCount}
          onPick={goStep3}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && selectedPlan && (
        <Step3Travelers
          travelers={travelers}
          onChange={setTravelers}
          plan={selectedPlan}
          onBack={() => setStep(2)}
          onNext={goStep4}
        />
      )}

      {step === 4 && selectedPlan && (
        <Step4Issue
          validating={validate.isPending}
          issuing={issue.isPending}
          plan={selectedPlan}
          travelerCount={trip.travelerCount}
          onBack={() => setStep(3)}
        />
      )}
    </div>
  );
}

// ────────── Stepper ──────────

function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  const labels = ['Trip', 'Plan', 'Travelers', 'Confirm'];
  return (
    <div className="flex items-center gap-2">
      {labels.map((label, i) => {
        const idx = (i + 1) as 1 | 2 | 3 | 4;
        const done = idx < step;
        const active = idx === step;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition-colors',
                done && 'border-brand-500 bg-brand-500 text-white',
                active && 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
                !done && !active && 'border-border bg-surface-1 text-ink-3',
              )}
            >
              {done ? <Check className="h-3 w-3" /> : idx}
            </span>
            <span
              className={cn(
                'text-xs font-semibold',
                active ? 'text-ink-1' : done ? 'text-ink-2' : 'text-ink-3',
              )}
            >
              {label}
            </span>
            {i < labels.length - 1 ? (
              <span
                className={cn(
                  'mx-1 h-px flex-1',
                  done ? 'bg-brand-500' : 'bg-border',
                )}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ────────── Step 1: Trip ──────────

function Step1Trip({
  trip,
  onChange,
  categories,
  loadingCategories,
  onNext,
}: {
  trip: TripInputs;
  onChange: (t: TripInputs) => void;
  categories: AsegoCategory[];
  loadingCategories: boolean;
  onNext: () => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <p className="eyebrow text-brand-600">Step 1 · Trip</p>
        <h2 className="text-h3 text-ink-1">When and where are you travelling?</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="start-date">Start date</Label>
            <Input
              id="start-date"
              type="date"
              value={trip.startDate}
              min={todayPlus(0)}
              onChange={(e) => onChange({ ...trip, startDate: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="end-date">Return date</Label>
            <Input
              id="end-date"
              type="date"
              value={trip.endDate}
              min={trip.startDate}
              onChange={(e) => onChange({ ...trip, endDate: e.target.value })}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Region</Label>
            {loadingCategories ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select
                value={trip.categoryId}
                onValueChange={(v) => onChange({ ...trip, categoryId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a region" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="destination">Destination (optional)</Label>
            <Input
              id="destination"
              placeholder="Goa, Bangkok, …"
              value={trip.destination}
              onChange={(e) => onChange({ ...trip, destination: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="travelers">Travellers</Label>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                onChange({ ...trip, travelerCount: Math.max(1, trip.travelerCount - 1) })
              }
              disabled={trip.travelerCount <= 1}
            >
              −
            </Button>
            <div className="flex h-10 w-16 items-center justify-center rounded-md border bg-surface-1 font-mono text-sm font-semibold">
              {trip.travelerCount}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                onChange({ ...trip, travelerCount: Math.min(10, trip.travelerCount + 1) })
              }
              disabled={trip.travelerCount >= 10}
            >
              +
            </Button>
            <span className="text-xs text-ink-3">
              <Users className="mr-1 inline h-3 w-3" />
              ASEGO supports up to 10 in a single policy
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button onClick={onNext}>
            Find plans <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ────────── Step 2: Plans ──────────

interface FlatPlan {
  insurerId: string;
  insurerName: string;
  insurerLogoPath?: string;
  plan: QuotePlan;
}

function Step2Plans({
  loading,
  plans,
  travelerCount,
  onPick,
  onBack,
}: {
  loading: boolean;
  plans: FlatPlan[];
  travelerCount: number;
  onPick: (root: { insurerId: string; insurerName: string }, plan: QuotePlan) => void;
  onBack: () => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No plans available"
        description="No plans for this combination — try a different region or duration."
        action={
          <Button variant="secondary" size="sm" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-3">
          {plans.length} plan{plans.length === 1 ? '' : 's'} available
        </p>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> Change trip
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => (
          <PlanCard key={`${p.insurerId}-${p.plan.id}`} plan={p} travelerCount={travelerCount} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  travelerCount,
  onPick,
}: {
  plan: FlatPlan;
  travelerCount: number;
  onPick: (root: { insurerId: string; insurerName: string }, plan: QuotePlan) => void;
}) {
  const premium = plan.plan.agePremiums?.find((a) => a.age === DEFAULT_AGE)?.premium
    ?? plan.plan.agePremiums?.[0]?.premium
    ?? 0;
  const total = premium * travelerCount;
  const top3 = (plan.plan.coverages ?? []).slice(0, 3);

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold text-ink-3">{plan.insurerName}</p>
            <p className="text-sm font-bold text-ink-1">
              {plan.plan.displayName ?? plan.plan.name ?? plan.plan.shortName ?? 'Plan'}
            </p>
          </div>
          {plan.plan.asegoRecomended ? (
            <Badge variant="brand" dot>
              <Sparkles className="h-3 w-3" /> Recommended
            </Badge>
          ) : null}
        </div>

        {plan.plan.sumInsured ? (
          <p className="text-xs text-ink-3">
            Sum insured: <span className="font-mono text-ink-1">{plan.plan.sumInsured}</span>
          </p>
        ) : null}

        {top3.length > 0 ? (
          <ul className="space-y-1.5 text-xs text-ink-2">
            {top3.map((c, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <Check className="h-3 w-3 shrink-0 text-brand-600" />
                <span className="truncate">
                  {c.name ?? 'Coverage'}
                  {c.maxAmount ? ` · ${c.maxAmount}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-2 border-t pt-3">
          <div>
            <p className="font-mono text-lg font-bold text-ink-1">{formatINR(premium)}</p>
            <p className="text-[10px] text-ink-3">per traveller</p>
          </div>
          {travelerCount > 1 ? (
            <p className="text-[10px] text-ink-3">
              total <span className="font-mono font-semibold text-ink-1">{formatINR(total)}</span>
            </p>
          ) : null}
          <Button size="sm" onClick={() => onPick({ insurerId: plan.insurerId, insurerName: plan.insurerName }, plan.plan)}>
            Pick
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ────────── Step 3: Travelers ──────────

function blankTraveler(): InsuranceTraveler {
  return {
    type: 'ADULT',
    title: 'MR',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    gender: 'M',
    email: '',
    mobileNo: '',
    pincode: '',
    address: '',
    district: '',
    state: '',
    country: 'India',
    nominee: { firstName: '', lastName: '', relation: 'Self' },
  };
}

function travelerErrors(t: InsuranceTraveler): string[] {
  const errs: string[] = [];
  if (!t.firstName) errs.push('first name required');
  if (!t.lastName) errs.push('last name required');
  if (!t.dateOfBirth) errs.push('DOB required');
  if (!t.email) errs.push('email required');
  if (!/^\d{10,12}$/.test(t.mobileNo)) errs.push('mobile must be 10–12 digits');
  if (!/^\d{6}$/.test(t.pincode)) errs.push('pincode must be 6 digits');
  if (!t.address) errs.push('address required');
  if (!t.district) errs.push('district required');
  if (!t.state) errs.push('state required');
  if (!t.country) errs.push('country required');
  if (t.passport && !/^[A-Z]\d{7}$/.test(t.passport)) errs.push('passport format invalid');
  return errs;
}

function Step3Travelers({
  travelers,
  onChange,
  plan,
  onBack,
  onNext,
}: {
  travelers: InsuranceTraveler[];
  onChange: (t: InsuranceTraveler[]) => void;
  plan: { planName: string; insurerName: string; premiumRupees: number };
  onBack: () => void;
  onNext: () => void;
}) {
  const updateAt = (i: number, patch: Partial<InsuranceTraveler>) => {
    onChange(travelers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  };
  const updateNomineeAt = (i: number, patch: Partial<InsuranceTraveler['nominee']>) => {
    onChange(
      travelers.map((t, idx) =>
        idx === i ? { ...t, nominee: { ...(t.nominee ?? blankTraveler().nominee!), ...patch } } : t,
      ),
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-semibold text-ink-3">Picked plan</p>
            <p className="text-sm font-bold text-ink-1">
              {plan.insurerName} · {plan.planName}
            </p>
          </div>
          <p className="font-mono text-sm font-semibold text-ink-1">
            {formatINR(plan.premiumRupees * travelers.length)}
          </p>
        </CardContent>
      </Card>

      {travelers.map((t, i) => (
        <Card key={i}>
          <CardContent className="space-y-3 p-4">
            <p className="eyebrow text-brand-600">Traveller {i + 1}</p>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Title</Label>
                <Select value={t.title} onValueChange={(v) => updateAt(i, { title: v as InsuranceTraveler['title'] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['MR', 'MRS', 'MS', 'MSTR', 'MISS'] as const).map((x) => (
                      <SelectItem key={x} value={x}>
                        {x}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>First name</Label>
                <Input value={t.firstName} onChange={(e) => updateAt(i, { firstName: e.target.value })} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Last name</Label>
                <Input value={t.lastName} onChange={(e) => updateAt(i, { lastName: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Date of birth</Label>
                <Input
                  type="date"
                  value={t.dateOfBirth}
                  max={todayPlus(0)}
                  onChange={(e) => updateAt(i, { dateOfBirth: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Gender</Label>
                <Select value={t.gender} onValueChange={(v) => updateAt(i, { gender: v as 'M' | 'F' | 'O' })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="M">Male</SelectItem>
                    <SelectItem value="F">Female</SelectItem>
                    <SelectItem value="O">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Mobile</Label>
                <Input
                  inputMode="numeric"
                  placeholder="9999999999"
                  value={t.mobileNo}
                  onChange={(e) => updateAt(i, { mobileNo: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={t.email} onChange={(e) => updateAt(i, { email: e.target.value })} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Passport (optional for domestic)</Label>
                <Input
                  placeholder="M1234567"
                  value={t.passport ?? ''}
                  onChange={(e) => updateAt(i, { passport: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="space-y-1">
                <Label>Pincode</Label>
                <Input
                  inputMode="numeric"
                  placeholder="110001"
                  value={t.pincode}
                  onChange={(e) => updateAt(i, { pincode: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Address</Label>
              <Input value={t.address} onChange={(e) => updateAt(i, { address: e.target.value })} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>District</Label>
                <Input value={t.district} onChange={(e) => updateAt(i, { district: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>State</Label>
                <Input value={t.state} onChange={(e) => updateAt(i, { state: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Country</Label>
                <Input value={t.country} onChange={(e) => updateAt(i, { country: e.target.value })} />
              </div>
            </div>

            <div className="rounded-md border bg-surface-2/40 p-3">
              <p className="mb-2 text-xs font-semibold text-ink-2">Nominee</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>First name</Label>
                  <Input
                    value={t.nominee?.firstName ?? ''}
                    onChange={(e) => updateNomineeAt(i, { firstName: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Last name</Label>
                  <Input
                    value={t.nominee?.lastName ?? ''}
                    onChange={(e) => updateNomineeAt(i, { lastName: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Relation</Label>
                  <Input
                    value={t.nominee?.relation ?? 'Self'}
                    onChange={(e) => updateNomineeAt(i, { relation: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-2 border-t bg-surface-1/95 px-4 py-3 backdrop-blur-sm md:-mx-6 md:px-6">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> Back to plans
        </Button>
        <Button onClick={onNext}>
          Continue to confirm <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ────────── Step 4: Issue ──────────

function Step4Issue({
  validating,
  issuing,
  plan,
  travelerCount,
  onBack,
}: {
  validating: boolean;
  issuing: boolean;
  plan: { planName: string; insurerName: string; premiumRupees: number };
  travelerCount: number;
  onBack: () => void;
}) {
  const total = plan.premiumRupees * travelerCount;
  return (
    <Card>
      <CardContent className="space-y-4 p-5 text-center">
        <p className="eyebrow text-brand-600">Step 4 · Confirm</p>
        <h2 className="text-h3 text-ink-1">Issuing your policy…</h2>

        <div className="mx-auto max-w-sm space-y-2 rounded-lg border bg-surface-2/40 p-4 text-left">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-3">Plan</span>
            <span className="text-sm font-semibold text-ink-1">
              {plan.insurerName} · {plan.planName}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-3">Travellers</span>
            <span className="text-sm font-semibold text-ink-1">{travelerCount}</span>
          </div>
          <div className="flex items-center justify-between border-t pt-2">
            <span className="text-xs text-ink-3">Total premium</span>
            <span className="font-mono text-base font-bold text-ink-1">{formatINR(total)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-ink-2">
            {validating
              ? 'Validating with ASEGO…'
              : issuing
                ? 'Issuing your policy…'
                : 'Almost done.'}
          </p>
          <div className="mx-auto h-1.5 w-48 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn(
                'h-full bg-brand-500 transition-all duration-1000',
                validating || issuing ? 'w-2/3 animate-pulse' : 'w-full',
              )}
            />
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={onBack} disabled={validating || issuing}>
          <ChevronLeft className="h-4 w-4" /> Edit travellers
        </Button>
      </CardContent>
    </Card>
  );
}
