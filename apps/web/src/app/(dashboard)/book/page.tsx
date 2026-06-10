'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Baby,
  Building2,
  CreditCard,
  Check,
  Clock,
  Loader2,
  Mail,
  Phone,
  PlaneTakeoff,
  ShieldCheck,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  HoldRequestSchema,
  type ConfirmBookingRequest,
  type HoldRequest,
  type PublicBooking,
  type PublicSavedPassenger,
  type SavedPassengerCreate,
  type SearchResponse,
  type SsrSelections,
  type WalletSummary,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
} from '@/components/ui';
import { AirlineLogo } from '@/components/airline-logo';
import { BaggageDetailsPicker } from '@/components/flights/baggage-details-picker';
import { PaymentMethodDialog } from '@/components/flights/payment-method-dialog';
import {
  SavedPassengerSearch,
  SavePassengerCheckbox,
} from '@/components/flights/saved-passenger-search';
import { SeatSelectionPicker } from '@/components/flights/seat-selection-picker';
import { SsrCatalogProvider } from '@/components/flights/ssr-catalog-context';
import { SsrPicker } from '@/components/flights/ssr-picker';
import { apiFetch, formatApiError } from '@/lib/api';
import { useApiMutation, useApiQuery } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import {
  advanceChain,
  captureLegFormState,
  clearChain,
  getChain,
  type MultiLegChain,
} from '@/lib/multi-leg-chain';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';

const STEPS = [
  { label: 'Passengers', icon: Users },
  { label: 'Contact & GST', icon: Mail },
  { label: 'Review & pay', icon: ShieldCheck },
] as const;

export default function BookPage() {
  return (
    <Suspense fallback={<BookSkeleton />}>
      <BookFlow />
    </Suspense>
  );
}

function BookSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-12 w-1/2" />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}

function BookFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const searchId = params.get('searchId') ?? '';
  const fareToken = params.get('fareToken') ?? '';

  const search = useApiQuery<SearchResponse>(
    ['search', searchId],
    `/api/v1/search/flights/${searchId}`,
    { enabled: !!searchId },
  );
  const result = useMemo(
    () => search.data?.results.find((r) => r.fareToken === fareToken),
    [search.data, fareToken],
  );

  const wallet = useApiQuery<WalletSummary>(['wallet', 'me', 'book'], '/api/v1/wallet/me', {
    staleTime: 15_000,
  });

  const [step, setStep] = useState(0);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState(false);

  // Multi-leg chain — round-trip / multi-city. Read once on mount and
  // kept in a stateful copy so we can render the progress strip even
  // when the underlying sessionStorage stash is later cleared (e.g.
  // after the last leg tickets). The setter is intentionally unused —
  // the chain is mutated via `advanceChain()` / `captureLegFormState()`
  // which write directly to sessionStorage; we re-read it on the next
  // /book mount.
  const [chain] = useState<MultiLegChain | null>(() => getChain());

  // Hold expiry — ticks every second, used to gate Pay buttons. The
  // visual countdown is rendered by HoldTimerBanner; this flag drives
  // disabled state across the action row + payment dialog.
  const [holdExpired, setHoldExpired] = useState(false);
  useEffect(() => {
    if (!holdExpiresAt) return;
    const tick = () => setHoldExpired(new Date(holdExpiresAt).getTime() <= Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [holdExpiresAt]);

  // Optional SSR add-ons captured by the picker on step 1. Stays undefined
  // when the agent picks nothing — the API treats undefined and {} the same,
  // but undefined keeps the wire payload clean.
  //
  // Baggage lives in its own state slice because a dedicated
  // BaggageDetailsPicker handles it (better UX than burying it in the
  // generic SsrPicker). We merge both before posting /bookings/hold.
  const [ssrSelections, setSsrSelections] = useState<SsrSelections | undefined>(
    undefined,
  );
  const [baggageSelections, setBaggageSelections] = useState<
    SsrSelections['baggage'] | undefined
  >(undefined);
  const [seatSelections, setSeatSelections] = useState<
    SsrSelections['seats'] | undefined
  >(undefined);

  const mergedSsrSelections: SsrSelections | undefined = useMemo(() => {
    const out: SsrSelections = { ...(ssrSelections ?? {}) };
    if (baggageSelections && baggageSelections.length > 0) {
      out.baggage = baggageSelections;
    }
    if (seatSelections && seatSelections.length > 0) {
      out.seats = seatSelections;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }, [ssrSelections, baggageSelections, seatSelections]);

  // Per-segment maps for the SSR / baggage / seat pickers. MEMOIZED so their
  // object identity is stable across renders — the pickers' bubble-up effects
  // depend on `segmentRouting`, so passing a fresh object every render caused an
  // infinite update loop (select seat → re-render → new object → effect → setState → …).
  const segmentRouting = useMemo(
    () =>
      Object.fromEntries(
        (result?.segments ?? []).map((s) => [
          `${s.origin.code}-${s.destination.code}`,
          {
            airlineCode: s.flightNumber?.slice(0, 2),
            flightNumber: s.flightNumber,
            wayType: 1 as const,
            origin: s.origin.code,
            destination: s.destination.code,
          },
        ]),
      ),
    [result],
  );
  const segmentSchedule = useMemo(
    () =>
      Object.fromEntries(
        (result?.segments ?? []).map((s) => {
          const dep = new Date(s.departure);
          const pretty = dep.toLocaleString('en-IN', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
          return [`${s.origin.code}-${s.destination.code}`, pretty.replace(',', '')];
        }),
      ),
    [result],
  );
  const segmentCities = useMemo(
    () =>
      Object.fromEntries(
        (result?.segments ?? []).map((s) => [
          `${s.origin.code}-${s.destination.code}`,
          { origin: s.origin.name, destination: s.destination.name },
        ]),
      ),
    [result],
  );

  // Reprice — for eTrav fares we re-validate price + availability before booking.
  // For other suppliers the backend route returns a synthetic "no change" response
  // so the rest of the flow can call this uniformly.
  const [repriceData, setRepriceData] = useState<{
    priceChanged: boolean;
    newTotalPaise: number | null;
    requiredPaxDetails: {
      paxType: 'ADULT' | 'CHILD' | 'INFANT';
      required: string[];
      optional: string[];
      mandatorySsrs: string[] | null;
    }[];
    frequentFlyerAccepted: boolean;
  } | null>(null);
  const [priceChangeAck, setPriceChangeAck] = useState(false);

  const reprice = useApiMutation<
    {
      supplierCode: string;
      fareToken: string;
      originalTotalPaise: number;
      customerMobile: string;
    },
    NonNullable<typeof repriceData>
  >('/api/v1/search/flights/reprice', 'POST', {
    onSuccess: (data) => {
      setRepriceData(data);
      if (!data.priceChanged) setPriceChangeAck(true);
    },
    onError: (err) => toast.error(`Reprice failed: ${err.message}`),
  });

  // Trigger Reprice once we have the fare. Use a ref-like guard so it runs once
  // per (searchId, fareToken) combination — re-mount or fast back-button hits
  // shouldn't refire it.
  // De-dupe the Reprice call across re-renders. We key on (searchId, fareToken)
  // so re-mounts and back-button hits don't refire the supplier call.
  const repriceTriggeredRef = useState({ key: '' })[0];
  const resultFareToken = result?.fareToken;
  const resultSupplier = result?.supplierCode;
  const resultGross = result?.totalGrossPaise;
  useEffect(() => {
    if (!resultFareToken || !resultSupplier || resultGross == null) return;
    const key = `${searchId}|${resultFareToken}`;
    if (repriceTriggeredRef.key === key) return;
    repriceTriggeredRef.key = key;
    reprice.mutate({
      supplierCode: resultSupplier,
      fareToken: resultFareToken,
      originalTotalPaise: resultGross,
      // Use agency mobile from auth if available; fall back to a sensible default.
      // Agents can always edit this on the form below before final submission.
      customerMobile: '9999999999',
    });
  }, [searchId, resultFareToken, resultSupplier, resultGross, reprice, repriceTriggeredRef]);

  const {
    register,
    control,
    formState: { errors },
    watch,
    setValue,
    getValues,
    trigger,
  } = useForm<HoldRequest>({
    resolver: zodResolver(HoldRequestSchema),
    defaultValues: {
      searchId,
      fareToken,
      passengers: [{ type: 'ADULT', title: 'MR', firstName: '', lastName: '', fareCategory: 'REGULAR' }],
      contact: { email: '', mobile: '', countryCode: '+91' },
    },
  });

  const passengers = useFieldArray({ control, name: 'passengers' });
  const requested = useMemo(() => {
    const req = search.data?.request;
    return req?.pax ?? { adults: 1, children: 0, infants: 0 };
  }, [search.data]);

  // ────────── Saved-passenger autofill + persist ──────────
  //
  // For each passenger row we track:
  //   • savePassenger[idx]  — checkbox state; when true the row gets
  //                            POSTed to /saved-passengers on submit
  //   • applySavedPassenger — autofills the form when a saved entry
  //                            is picked from the search dropdown
  const [savePassengerFlags, setSavePassengerFlags] = useState<boolean[]>([]);
  const accessToken = useAuthStore((s) => s.accessToken);

  function setSavePassenger(idx: number, val: boolean) {
    setSavePassengerFlags((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  }

  function applySavedPassenger(idx: number, p: PublicSavedPassenger) {
    setValue(`passengers.${idx}.title`, p.title);
    setValue(`passengers.${idx}.firstName`, p.firstName);
    setValue(`passengers.${idx}.lastName`, p.lastName);
    if (p.dateOfBirth) {
      setValue(`passengers.${idx}.dateOfBirth`, new Date(p.dateOfBirth));
    }
    if (p.gender) {
      setValue(`passengers.${idx}.gender`, p.gender);
    }
    if (p.nationality) {
      setValue(`passengers.${idx}.nationality`, p.nationality);
    }
    if (p.passport) {
      setValue(`passengers.${idx}.passport`, {
        number: p.passport.number,
        expiry: new Date(p.passport.expiry),
        issuingCountry: p.passport.issuingCountry,
      });
    }
    // Picking an existing entry implicitly means "this is the canonical
    // record" — clear the save flag so we don't re-POST a duplicate.
    setSavePassenger(idx, false);
    toast.success(`Autofilled ${p.firstName} ${p.lastName}`);
  }

  /** Fire-and-forget POST to persist a row to the directory. */
  async function persistSavedPassenger(p: HoldRequest['passengers'][number]) {
    if (!p.firstName?.trim() || !p.lastName?.trim()) return;
    const body: SavedPassengerCreate = {
      type: p.type,
      title: p.title,
      firstName: p.firstName.trim(),
      lastName: p.lastName.trim(),
      dateOfBirth: p.dateOfBirth
        ? new Date(p.dateOfBirth).toISOString().slice(0, 10)
        : undefined,
      gender: p.gender,
      nationality: p.nationality,
      passport: p.passport
        ? {
            number: p.passport.number,
            expiry: new Date(p.passport.expiry).toISOString().slice(0, 10),
            issuingCountry: p.passport.issuingCountry,
          }
        : undefined,
    };
    try {
      await apiFetch('/api/v1/saved-passengers', {
        method: 'POST',
        body,
        accessToken,
      });
    } catch {
      // Non-fatal — the booking has already been submitted. Just toast.
      toast.error(`Could not save ${body.firstName} ${body.lastName} to directory`);
    }
  }

  // Initialize passenger rows to match the searched pax mix.
  // For chained bookings (round-trip / multi-city leg ≥ 2), pre-fill
  // every row from the chain's captured form state — same group is
  // flying every leg, so re-typing names / contact / GST per leg is
  // an obvious anti-pattern.
  useEffect(() => {
    const current = getValues('passengers');
    const expected = requested.adults + requested.children + requested.infants;
    if (current.length === expected) return;

    const chainData = chain && chain.passengers ? chain : null;

    const next: HoldRequest['passengers'] = [];
    for (let i = 0; i < requested.adults; i++) {
      const seed = chainData?.passengers?.find(
        (p, idx) => p.type === 'ADULT' && idx === i,
      );
      next.push({
        type: 'ADULT',
        title: (seed?.title as 'MR' | 'MRS' | 'MS' | 'MSTR' | 'MISS') ?? 'MR',
        firstName: seed?.firstName ?? '',
        lastName: seed?.lastName ?? '',
        dateOfBirth: seed?.dateOfBirth ? new Date(seed.dateOfBirth) : undefined,
        gender: seed?.gender,
        nationality: seed?.nationality,
        passport: seed?.passport
          ? {
              number: seed.passport.number,
              expiry: new Date(seed.passport.expiry),
              issuingCountry: seed.passport.issuingCountry,
            }
          : undefined,
        fareCategory: (seed?.fareCategory as HoldRequest['passengers'][number]['fareCategory']) ?? 'REGULAR',
      });
    }
    for (let i = 0; i < requested.children; i++) {
      const childIdx = requested.adults + i;
      const seed = chainData?.passengers?.find(
        (p, idx) => p.type === 'CHILD' && idx === childIdx,
      );
      next.push({
        type: 'CHILD',
        title: (seed?.title as 'MR' | 'MRS' | 'MS' | 'MSTR' | 'MISS') ?? 'MSTR',
        firstName: seed?.firstName ?? '',
        lastName: seed?.lastName ?? '',
        dateOfBirth: seed?.dateOfBirth ? new Date(seed.dateOfBirth) : undefined,
        gender: seed?.gender,
        fareCategory: (seed?.fareCategory as HoldRequest['passengers'][number]['fareCategory']) ?? 'REGULAR',
      });
    }
    for (let i = 0; i < requested.infants; i++) {
      const infIdx = requested.adults + requested.children + i;
      const seed = chainData?.passengers?.find(
        (p, idx) => p.type === 'INFANT' && idx === infIdx,
      );
      next.push({
        type: 'INFANT',
        title: (seed?.title as 'MR' | 'MRS' | 'MS' | 'MSTR' | 'MISS') ?? 'MSTR',
        firstName: seed?.firstName ?? '',
        lastName: seed?.lastName ?? '',
        dateOfBirth: seed?.dateOfBirth ? new Date(seed.dateOfBirth) : undefined,
        gender: seed?.gender,
        fareCategory: (seed?.fareCategory as HoldRequest['passengers'][number]['fareCategory']) ?? 'REGULAR',
      });
    }
    setValue('passengers', next);

    // Pre-fill contact + GST from the chain too.
    if (chainData?.contact) {
      setValue('contact', {
        email: chainData.contact.email,
        mobile: chainData.contact.mobile,
        countryCode: chainData.contact.countryCode,
      });
    }
    if (chainData?.gst) {
      setValue('gst', {
        number: chainData.gst.number,
        companyName: chainData.gst.companyName,
        address: chainData.gst.address,
      });
    }
  }, [requested, getValues, setValue, chain]);

  // `payNowMode` toggles the post-hold action:
  //   false → advance to step 2 (Review & pay) — the classic flow
  //   true  → skip step 2 and open the PaymentMethodDialog directly
  // Set right before calling hold.mutate so the onSuccess can branch.
  const [payNowMode, setPayNowMode] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  // Idempotency keys — one per user-initiated action. A rapid double-
  // click on Hold or Pay re-fires the mutation with the SAME key, the
  // backend middleware replays the original response instead of
  // minting a duplicate PNR. We regenerate the key only when the user
  // actually starts a fresh attempt (e.g. clicks Back → Hold again).
  const holdIdempotencyKeyRef = useRef<string>('');
  const confirmIdempotencyKeyRef = useRef<string>('');

  const hold = useApiMutation<HoldRequest, PublicBooking>('/api/v1/bookings/hold', 'POST', {
    headers: (): Record<string, string> => {
      // Generated once per holdSeats() call; the ref is set there.
      // Empty fallback is harmless — the middleware skips when the
      // header is missing (advisory mode).
      const out: Record<string, string> = {};
      if (holdIdempotencyKeyRef.current) {
        out['Idempotency-Key'] = holdIdempotencyKeyRef.current;
      }
      return out;
    },
    onSuccess: (b) => {
      setBookingId(b.id);
      setHoldExpiresAt(
        b.expiresAt
          ? typeof b.expiresAt === 'string'
            ? b.expiresAt
            : (b.expiresAt as Date).toISOString()
          : null,
      );
      if (payNowMode) {
        // Pay Now flow — skip the Review step, open the payment
        // dialog right away. The dialog will call /bookings/confirm
        // for wallet payments or initiate a gateway redirect.
        setPaymentDialogOpen(true);
        setPayNowMode(false);
        toast.success('Seats held — choose how to pay');
      } else {
        setStep(2);
        toast.success('Seats held — confirm to ticket');
      }
    },
    onError: (err) => {
      setPayNowMode(false);
      toast.error(formatApiError(err));
    },
  });

  const confirmMutation = useApiMutation<ConfirmBookingRequest, PublicBooking>(
    '/api/v1/bookings/confirm',
    'POST',
    {
      headers: (): Record<string, string> => {
        const out: Record<string, string> = {};
        if (confirmIdempotencyKeyRef.current) {
          out['Idempotency-Key'] = confirmIdempotencyKeyRef.current;
        }
        return out;
      },
      onSuccess: (b) => handleTicketSuccess(b),
      onError: (err) => {
        // The API surfaces HOLD_EXPIRED as a structured 422 — convert
        // it into a friendlier banner so the agent knows exactly what
        // to do (re-search). The generic err.message is "Hold has
        // expired" which is already user-readable but we add context.
        if (err.message.toLowerCase().includes('expired')) {
          toast.error('Hold expired — re-search to get fresh availability and pricing');
          setHoldExpired(true); // ensure UI gates lock even if our client timer drifted
          return;
        }
        toast.error(formatApiError(err));
      },
    },
  );

  /**
   * Single handler invoked whenever a leg's ticket is issued — both
   * from the wallet-payment path (via PaymentMethodDialog) and the
   * gateway return-flow (via the standalone /payments/return page).
   *
   * Branches:
   *   • Chain has more legs → capture form state, advance the chain,
   *     navigate to /book?searchId=<next>&fareToken=<next>. The next
   *     page's mount effect picks up the chain and pre-fills the form
   *     so the agent doesn't re-type passenger / contact / GST.
   *   • Chain is exhausted (or there was no chain) → clear any stash
   *     and navigate to the booking detail page.
   *
   * Capturing form state from the current leg before advancing means
   * the agent's edits on this leg carry forward — useful when they
   * tweak a passenger's DOB or add a passport on leg 1.
   */
  function handleTicketSuccess(booking: PublicBooking) {
    const route = `${seg0.origin.code} → ${segLast.destination.code}`;
    const formValues = getValues();
    const activeChain = getChain();

    if (activeChain && activeChain.remainingLegs.length > 0) {
      // Stash the current leg's form state so the next leg pre-fills.
      captureLegFormState({
        passengers: formValues.passengers.map((p) => ({
          type: p.type,
          title: p.title,
          firstName: p.firstName,
          lastName: p.lastName,
          dateOfBirth: p.dateOfBirth
            ? new Date(p.dateOfBirth).toISOString().slice(0, 10)
            : undefined,
          gender: p.gender,
          nationality: p.nationality,
          passport: p.passport
            ? {
                number: p.passport.number,
                expiry: new Date(p.passport.expiry).toISOString().slice(0, 10),
                issuingCountry: p.passport.issuingCountry,
              }
            : undefined,
          fareCategory: p.fareCategory,
        })),
        contact: {
          email: formValues.contact.email,
          mobile: formValues.contact.mobile,
          countryCode: formValues.contact.countryCode,
        },
        gst: formValues.gst
          ? {
              number: formValues.gst.number,
              companyName: formValues.gst.companyName,
              address: formValues.gst.address,
            }
          : undefined,
      });

      const nextLeg = advanceChain({
        completed: { pnr: booking.pnr ?? null, bookingId: booking.id, route },
      });

      if (nextLeg) {
        toast.success(
          `Leg ${activeChain.currentLegIndex + 1} ticketed — PNR ${booking.pnr ?? '—'}. Continuing to leg ${activeChain.currentLegIndex + 2}…`,
        );
        // Navigate to the next leg. The mount effect on the new page
        // reads the chain from sessionStorage and pre-fills the form.
        router.push(
          `/book?searchId=${nextLeg.searchId}&fareToken=${encodeURIComponent(nextLeg.fareToken)}`,
        );
        return;
      }
    }

    // No chain, or final leg → done. Clear any stale stash and land
    // on the booking detail page.
    clearChain();
    toast.success(`Ticketed — PNR ${booking.pnr ?? '—'}`);
    router.push(`/bookings/${booking.id}`);
  }

  if (search.isLoading) return <BookSkeleton />;
  if (!searchId || !fareToken) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-warning" />
          <p className="mt-3 text-sm text-ink-2">
            Missing search context — go back and pick a fare to book.
          </p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => router.push('/search')}>
            <ArrowLeft className="h-4 w-4" /> Back to search
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!result) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-danger" />
          <p className="mt-3 text-sm text-ink-2">
            This fare is no longer in the search cache. Search again to refresh prices.
          </p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => router.push('/search')}>
            <ArrowLeft className="h-4 w-4" /> Back to search
          </Button>
        </CardContent>
      </Card>
    );
  }

  /**
   * Step 0 → Step 1 transition.
   *
   * IMPORTANT: We can't use `handleSubmit` here because it validates the
   * *whole* HoldRequestSchema — including contact.email + contact.mobile
   * which are empty until step 1. Full-form validation would silently
   * fail and the agent would see no feedback.
   *
   * Instead, call `trigger('passengers')` to validate ONLY the passenger
   * field array. If valid, advance. If invalid, RHF shows the errors
   * inline on the passenger rows.
   */
  async function onContinueFromPassengers(e: React.FormEvent) {
    e.preventDefault();
    const ok = await trigger('passengers');
    if (!ok) {
      toast.error('Fix the highlighted passenger fields before continuing');
      return;
    }
    const values = getValues();

    // Fire-and-forget persist for any row whose "Save passenger"
    // checkbox is ticked. Backend upserts on (name, dob) so re-saves
    // are idempotent.
    const toSave = values.passengers.filter((_, idx) => savePassengerFlags[idx]);
    if (toSave.length > 0) {
      await Promise.allSettled(toSave.map((p) => persistSavedPassenger(p)));
      toast.success(
        `Saved ${toSave.length} passenger${toSave.length === 1 ? '' : 's'} to directory`,
      );
    }
    setStep(1);
  }
  /**
   * Step 1 → Step 2 transition.
   *
   * Same caveat as the step-0 handler: we use `trigger()` so the
   * partial-form scope is explicit. We validate ONLY `passengers` +
   * `contact` (plus `gst` conditionally — only if the agent actually
   * typed something into the GST fields).
   *
   * If GST is completely empty, we drop the entire `gst` key so the
   * schema's `.optional()` clause kicks in. Without this dance, RHF
   * would send `{ number: '', companyName: '', address: '' }` which
   * fails the inner GstinSchema validation.
   */
  async function onSubmitHold(e: React.FormEvent) {
    e.preventDefault();
    await holdSeats(/* payNow */ false);
  }

  /**
   * Shared hold-seat logic — used by both the "Hold for 30 min" form
   * submit and the "Pay Now" button. Validates the contact + GST
   * sections, strips empty GST, and triggers /bookings/hold. The
   * `wantPayNow` flag flips the post-success behaviour (see the
   * hold mutation's onSuccess: it advances to step 2 by default,
   * or opens the payment dialog when payNowMode is true).
   */
  async function holdSeats(wantPayNow: boolean) {
    // Double-click guard — if a hold is already in flight, ignore the
    // second click. The idempotency-key header replays the original
    // response server-side anyway, but bailing here avoids the second
    // round-trip entirely.
    if (hold.isPending) return;

    const values = getValues();
    const gst = values.gst;
    const gstIsEmpty =
      !gst || (!gst.number?.trim() && !gst.companyName?.trim() && !gst.address?.trim());
    if (gstIsEmpty) {
      // Strip the empty gst object so Zod's `.optional()` is happy.
      setValue('gst', undefined);
    }

    // Validate just the fields visible on this step.
    const fieldsToValidate: Array<'passengers' | 'contact' | 'gst'> = [
      'passengers',
      'contact',
    ];
    if (!gstIsEmpty) fieldsToValidate.push('gst');
    const ok = await trigger(fieldsToValidate);
    if (!ok) {
      toast.error('Fix the highlighted contact or GST fields');
      return;
    }

    // Already held in this session? Either reuse the hold or warn
    // that it's expired — the agent must re-search to get a fresh
    // fare token.
    if (bookingId && wantPayNow) {
      if (holdExpired) {
        toast.error('Hold expired — re-search for fresh availability before paying');
        return;
      }
      setPaymentDialogOpen(true);
      return;
    }

    // Re-read values AFTER the gst strip so the mutation payload is clean.
    const finalValues = getValues();

    // Generate a fresh idempotency key for this hold attempt. A
    // double-click reuses the same ref (no regen) so the backend
    // replays the same response. A back-then-retry generates a new
    // key (this code runs again).
    holdIdempotencyKeyRef.current = generateIdempotencyKey();

    setPayNowMode(wantPayNow);
    hold.mutate({ ...finalValues, ssrSelections: mergedSsrSelections });
  }

  function onPayNow() {
    void holdSeats(/* payNow */ true);
  }

  const seg0 = result.segments[0]!;
  const segLast = result.segments[result.segments.length - 1]!;

  const walletBalance = wallet.data?.walletBalancePaise ?? 0;
  const totalToPay = result.totalAgencyPayablePaise;
  const balanceAfter = walletBalance - totalToPay;
  const insufficient = balanceAfter < 0 && (wallet.data?.creditLimitPaise ?? 0) < Math.abs(balanceAfter);

  // Price-change modal — blocks the form until the agent acknowledges the new total.
  const showPriceChangeModal =
    repriceData?.priceChanged === true &&
    !priceChangeAck &&
    repriceData.newTotalPaise != null;

  return (
    <div className="space-y-6">
      {/* ─────────── Multi-leg chain progress strip ─────────── */}
      {chain && chain.totalLegs > 1 ? <ChainProgressStrip chain={chain} /> : null}

      {/* ─────────── Hold timer banner (sticky, only when holding) ─────────── */}
      {holdExpiresAt ? <HoldTimerBanner expiresAt={holdExpiresAt} /> : null}

      <PageHeader
        eyebrow="Operate · Book"
        title={
          chain && chain.totalLegs > 1
            ? `Leg ${chain.currentLegIndex + 1} of ${chain.totalLegs} — ${chain.kind === 'ROUNDTRIP' ? 'Round-trip' : 'Multi-city'}`
            : 'New booking'
        }
        description={
          chain && chain.totalLegs > 1
            ? `Same passengers across all legs. After this ticket is issued you'll auto-advance to ${chain.remainingLegs[0]?.route ?? 'the next leg'}.`
            : 'Three steps — passengers, contact, review.'
        }
        actions={
          <Button variant="ghost" size="sm" onClick={() => router.push('/search')}>
            <ArrowLeft className="h-4 w-4" /> Back to results
          </Button>
        }
      />

      {/* ─────────── Reprice loading + price-changed banners ─────────── */}
      {reprice.isPending ? (
        <div className="flex items-center gap-2 rounded-md border bg-brand-50/50 px-4 py-2.5 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Re-validating fare with supplier — locking the price before booking.
        </div>
      ) : null}

      {repriceData?.priceChanged && priceChangeAck ? (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
          Fare updated to{' '}
          <span className="font-mono font-semibold">
            {repriceData.newTotalPaise != null
              ? formatPaiseAsINR(repriceData.newTotalPaise)
              : '—'}
          </span>{' '}
          from search-time price{' '}
          <span className="font-mono">{formatPaiseAsINR(result.totalGrossPaise)}</span>.
        </div>
      ) : null}

      {/* Price-change modal — blocks the form until acknowledged */}
      {showPriceChangeModal ? (
        <ConfirmDialog
          open
          onOpenChange={() => {
            /* dismiss is handled by buttons below — clicking outside is unsafe here */
          }}
          title="Fare price changed"
          description={
            <div className="space-y-2">
              <p>
                The supplier has updated this fare since you searched. Please confirm before
                continuing — the booking will lock at the new price.
              </p>
              <div className="rounded-md border bg-surface-2/50 p-3 font-mono text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-ink-3">Search-time total</span>
                  <span className="line-through text-ink-3">
                    {formatPaiseAsINR(result.totalGrossPaise)}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="font-semibold text-ink-1">New total</span>
                  <span className="font-bold text-ink-1">
                    {formatPaiseAsINR(repriceData!.newTotalPaise!)}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-ink-3">Difference</span>
                  <span
                    className={
                      repriceData!.newTotalPaise! > result.totalGrossPaise
                        ? 'font-semibold text-warning'
                        : 'font-semibold text-success'
                    }
                  >
                    {repriceData!.newTotalPaise! > result.totalGrossPaise ? '+' : '−'}
                    {formatPaiseAsINR(
                      Math.abs(repriceData!.newTotalPaise! - result.totalGrossPaise),
                    )}
                  </span>
                </div>
              </div>
            </div>
          }
          confirmLabel="Continue at new price"
          cancelLabel="Back to results"
          onConfirm={() => setPriceChangeAck(true)}
        />
      ) : null}

      {/* Stepper */}
      <Stepper step={step} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card elevation="raised">
          <CardContent className="p-6 lg:p-8">
            {step === 0 ? (
              <form onSubmit={onContinueFromPassengers} className="space-y-6 animate-fade-in">
                <div>
                  <h2 className="text-h2 text-ink-1">Who's flying?</h2>
                  <p className="mt-1 text-sm text-ink-3">
                    Names must match passport / government ID exactly. Mistakes cost ₹2,000+ to amend.
                  </p>
                </div>

                {/* Required-fields banner — surfaces what the supplier wants per
                    pax type. For eTrav fares this is real per-fare data; for
                    Mock/Series it's the synthetic default. */}
                {repriceData?.requiredPaxDetails ? (
                  <div className="rounded-md border border-brand-200/60 bg-brand-50/40 p-4 text-xs dark:border-brand-500/20 dark:bg-brand-500/10">
                    <div className="flex items-start gap-2">
                      <ShieldCheck
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-300"
                        strokeWidth={2}
                      />
                      <div className="flex-1 space-y-1.5">
                        <p className="font-semibold text-ink-1">
                          Per fare rules · supplier requires the following per traveller
                        </p>
                        <ul className="space-y-0.5 text-ink-2">
                          {repriceData.requiredPaxDetails.map((d) => (
                            <li key={d.paxType} className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase">
                                {d.paxType}
                              </span>
                              {d.required.length > 0 ? (
                                <span>
                                  <span className="text-ink-3">required:</span>{' '}
                                  <span className="font-medium">{d.required.join(', ')}</span>
                                </span>
                              ) : null}
                              {d.optional.length > 0 ? (
                                <span className="text-ink-4">
                                  · optional: {d.optional.join(', ')}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="space-y-3">
                  {passengers.fields.map((f, idx) => {
                    const type = watch(`passengers.${idx}.type`);
                    const Icon = type === 'INFANT' ? Baby : type === 'CHILD' ? UserIcon : UserIcon;
                    return (
                      <div
                        key={f.id}
                        className="rounded-lg border bg-surface-1 p-4 transition-colors hover:border-brand-300"
                      >
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </span>
                            <p className="text-sm font-semibold text-ink-1">
                              {type === 'INFANT' ? 'Infant' : type === 'CHILD' ? 'Child' : 'Adult'}{' '}
                              <span className="font-mono text-ink-3">#{idx + 1}</span>
                            </p>
                          </div>
                          <Badge variant="neutral" className="text-[10px]">
                            {type === 'INFANT' ? 'Under 2' : type === 'CHILD' ? '2–11' : '12+'}
                          </Badge>
                        </div>

                        {/* Saved-passenger autofill row — search on the
                            left, save-toggle on the right. Lives above
                            the form fields so the agent can autofill
                            before touching the inputs. */}
                        <div className="mb-3 flex flex-wrap items-center gap-3">
                          <div className="min-w-[200px] flex-1">
                            <SavedPassengerSearch
                              paxType={type as 'ADULT' | 'CHILD' | 'INFANT'}
                              onPick={(p) => applySavedPassenger(idx, p)}
                            />
                          </div>
                          <SavePassengerCheckbox
                            checked={savePassengerFlags[idx] ?? false}
                            onChange={(v) => setSavePassenger(idx, v)}
                          />
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[100px_1fr_1fr]">
                          <FormField label="Title" error={errors.passengers?.[idx]?.title?.message}>
                            <Select
                              value={watch(`passengers.${idx}.title`)}
                              onValueChange={(v) =>
                                setValue(
                                  `passengers.${idx}.title`,
                                  v as 'MR' | 'MRS' | 'MS' | 'MSTR' | 'MISS',
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {['MR', 'MRS', 'MS', 'MSTR', 'MISS'].map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormField>
                          <FormField
                            label="First name"
                            required
                            error={errors.passengers?.[idx]?.firstName?.message}
                          >
                            <Input placeholder="As on ID" {...register(`passengers.${idx}.firstName`)} />
                          </FormField>
                          <FormField
                            label="Last name"
                            required
                            error={errors.passengers?.[idx]?.lastName?.message}
                          >
                            <Input placeholder="As on ID" {...register(`passengers.${idx}.lastName`)} />
                          </FormField>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between border-t pt-4">
                  <p className="text-xs text-ink-3">
                    {passengers.fields.length} passenger{passengers.fields.length > 1 ? 's' : ''}
                  </p>
                  <Button type="submit">
                    Continue <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            ) : null}

            {step === 1 ? (
              <form onSubmit={onSubmitHold} className="space-y-6 animate-fade-in">
                <div>
                  <h2 className="text-h2 text-ink-1">Contact & invoicing</h2>
                  <p className="mt-1 text-sm text-ink-3">
                    Tickets and invoices go to this contact. GST is optional but recommended.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField id="email" label="Email" required error={errors.contact?.email?.message}>
                    <Input
                      id="email"
                      type="email"
                      placeholder="contact@agency.com"
                      leading={<Mail className="h-4 w-4" strokeWidth={1.75} />}
                      {...register('contact.email')}
                    />
                  </FormField>
                  <FormField id="mobile" label="Mobile" required error={errors.contact?.mobile?.message}>
                    <Input
                      id="mobile"
                      placeholder="9876543210"
                      leading={<Phone className="h-4 w-4" strokeWidth={1.75} />}
                      {...register('contact.mobile')}
                    />
                  </FormField>
                </div>

                {/* ── SSR catalog provider ──
                    One fetch shared across BaggageDetailsPicker,
                    SeatSelectionPicker, and SsrPicker. Avoids the
                    triple-fetch race that caused the seat picker to
                    hang in "Loading…" while the meals picker
                    rendered. */}
                <SsrCatalogProvider
                  supplierCode={result.supplierCode}
                  fareToken={result.fareToken}
                  segments={result.segments.map((s) => ({
                    origin: s.origin.code,
                    destination: s.destination.code,
                  }))}
                >

                {/* ── Baggage Details section ──
                    Dedicated dropdown-driven picker for excess baggage
                    add-ons. Self-hides when no baggage options are
                    available or the supplier doesn't ship them. */}
                <BaggageDetailsPicker
                  passengers={passengers.fields.map((_, i) => {
                    const t = watch(`passengers.${i}.type`);
                    const first = watch(`passengers.${i}.firstName`);
                    const last = watch(`passengers.${i}.lastName`);
                    const namePart = [first, last].filter(Boolean).join(' ');
                    return {
                      type: t,
                      label: namePart || `${t === 'INFANT' ? 'Infant' : t === 'CHILD' ? 'Child' : 'Adult'} #${i + 1}`,
                    };
                  })}
                  segmentRouting={segmentRouting}
                  segmentSchedule={segmentSchedule}
                  segmentCities={segmentCities}
                  onChange={setBaggageSelections}
                />

                {/* ── Seat Selection ──
                    Dedicated dialog-driven picker for the seat map.
                    Self-hides when no seat data is available or the
                    supplier doesn't ship seat maps. */}
                <SeatSelectionPicker
                  passengers={passengers.fields.map((_, i) => {
                    const t = watch(`passengers.${i}.type`);
                    const first = watch(`passengers.${i}.firstName`);
                    const last = watch(`passengers.${i}.lastName`);
                    const namePart = [first, last].filter(Boolean).join(' ');
                    return {
                      type: t,
                      label: namePart || `${t === 'INFANT' ? 'Infant' : t === 'CHILD' ? 'Child' : 'Adult'} #${i + 1}`,
                    };
                  })}
                  segmentRouting={segmentRouting}
                  segmentCities={segmentCities}
                  segmentSchedule={segmentSchedule}
                  onChange={setSeatSelections}
                />

                {/* Optional SSR picker — meals only. Baggage + seats are
                    handled above by their dedicated pickers. */}
                <SsrPicker
                  supplierCode={result.supplierCode}
                  fareToken={result.fareToken}
                  hideBaggage
                  hideSeats
                  passengers={passengers.fields.map((_, i) => {
                    const t = watch(`passengers.${i}.type`);
                    const first = watch(`passengers.${i}.firstName`);
                    const last = watch(`passengers.${i}.lastName`);
                    const namePart = [first, last].filter(Boolean).join(' ');
                    return {
                      type: t,
                      label: namePart || `${t === 'INFANT' ? 'Infant' : t === 'CHILD' ? 'Child' : 'Adult'} #${i + 1}`,
                    };
                  })}
                  segmentRouting={segmentRouting}
                  onChange={setSsrSelections}
                />

                </SsrCatalogProvider>

                <div className="rounded-lg border bg-surface-2/50 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
                    <h3 className="text-sm font-semibold text-ink-1">GST details</h3>
                    <Badge variant="neutral" className="text-[10px]">Optional</Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField id="gstin" label="GSTIN" error={errors.gst?.number?.message}>
                      <Input id="gstin" placeholder="22AAAAA0000A1Z5" {...register('gst.number')} />
                    </FormField>
                    <FormField id="gstName" label="Company name" error={errors.gst?.companyName?.message}>
                      <Input id="gstName" placeholder="Acme Travels" {...register('gst.companyName')} />
                    </FormField>
                    <FormField
                      id="gstAddr"
                      label="Address"
                      className="sm:col-span-2"
                      error={errors.gst?.address?.message}
                    >
                      <Input id="gstAddr" placeholder="Street, City, State, PIN" {...register('gst.address')} />
                    </FormField>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <Button type="button" variant="ghost" onClick={() => setStep(0)}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Hold PNR — classic 30-min review-then-pay path. */}
                    <Button
                      type="submit"
                      variant="secondary"
                      loading={hold.isPending && !payNowMode}
                    >
                      {!hold.isPending || payNowMode ? (
                        <>
                          <Clock className="h-4 w-4" /> Hold PNR · 30 min
                        </>
                      ) : (
                        <>Holding seats…</>
                      )}
                    </Button>
                    {/* Pay Now — opens the PaymentMethodDialog so the
                        agent can settle from wallet or via gateway in
                        one step. */}
                    <Button
                      type="button"
                      onClick={onPayNow}
                      loading={hold.isPending && payNowMode}
                    >
                      {!hold.isPending || !payNowMode ? (
                        <>
                          <CreditCard className="h-4 w-4" /> Pay Now ·{' '}
                          {formatPaiseAsINR(totalToPay)}
                        </>
                      ) : (
                        <>Preparing payment…</>
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            ) : null}

            {step === 2 ? (
              <div className="space-y-5 animate-fade-in">
                <div>
                  <h2 className="text-h2 text-ink-1">Review & pay</h2>
                  <p className="mt-1 text-sm text-ink-3">
                    One last look — confirm to debit your wallet and issue tickets.
                  </p>
                </div>

                {/* ── Passengers ── */}
                <ReviewSection
                  title="Passengers"
                  icon={Users}
                  onEdit={() => setStep(0)}
                >
                  <ul className="divide-y divide-stroke-1">
                    {watch('passengers')?.map((p, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                            {p.type === 'INFANT' ? (
                              <Baby className="h-3.5 w-3.5" strokeWidth={1.75} />
                            ) : (
                              <UserIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
                            )}
                          </span>
                          <div>
                            <p className="font-semibold text-ink-1">
                              {p.title}. {p.firstName} {p.lastName}
                            </p>
                            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                              {p.type === 'INFANT' ? 'Infant · Under 2' : p.type === 'CHILD' ? 'Child · 2–11' : 'Adult · 12+'}
                              {p.dateOfBirth ? (
                                <span className="ml-1 text-ink-4">
                                  · DOB {new Date(p.dateOfBirth).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </span>
                              ) : null}
                              {p.passport?.number ? (
                                <span className="ml-1 text-ink-4">· Passport {p.passport.number}</span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </ReviewSection>

                {/* ── Itinerary (segment-by-segment) ── */}
                <ReviewSection title="Itinerary" icon={PlaneTakeoff}>
                  <ol className="space-y-3">
                    {result.segments.map((s, idx) => (
                      <li key={`${s.flightNumber}-${idx}`} className="rounded-md border border-stroke-1 bg-surface-2/40 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                          <span className="font-mono font-bold text-ink-1">
                            {s.airline.code} {s.flightNumber}
                            {s.airline.name ? <span className="ml-2 font-sans font-normal text-ink-3">{s.airline.name}</span> : null}
                          </span>
                          <span className="text-[11px] text-ink-3">
                            {new Date(s.departure).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-[12px]">
                          <div>
                            <p className="font-mono text-[16px] font-bold tabular-nums text-ink-1">
                              {new Date(s.departure).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                            </p>
                            <p className="font-mono text-[10px] text-ink-2">{s.origin.code}</p>
                            {s.origin.terminal ? <p className="text-[10px] text-ink-4">Terminal {s.origin.terminal}</p> : null}
                          </div>
                          <span className="text-[10px] text-ink-4">→</span>
                          <div className="text-right">
                            <p className="font-mono text-[16px] font-bold tabular-nums text-ink-1">
                              {new Date(s.arrival).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                            </p>
                            <p className="font-mono text-[10px] text-ink-2">{s.destination.code}</p>
                            {s.destination.terminal ? <p className="text-[10px] text-ink-4">Terminal {s.destination.terminal}</p> : null}
                          </div>
                        </div>
                        {idx < result.segments.length - 1 && s.stopOver > 0 ? (
                          <p className="mt-2 rounded bg-warning-soft px-2 py-1 text-[10px] text-warning">
                            Layover at {s.destination.code} · {Math.floor(s.stopOver / 60)}h {s.stopOver % 60}m
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </ReviewSection>

                {/* ── Add-ons (baggage + seats + meals) ── */}
                {mergedSsrSelections &&
                ((mergedSsrSelections.baggage?.length ?? 0) > 0 ||
                  (mergedSsrSelections.seats?.length ?? 0) > 0 ||
                  (mergedSsrSelections.meals?.length ?? 0) > 0) ? (
                  <ReviewSection title="Add-ons" icon={ShieldCheck} onEdit={() => setStep(1)}>
                    <div className="space-y-2 text-[12px]">
                      {(mergedSsrSelections.baggage?.length ?? 0) > 0 ? (
                        <ReviewKv
                          label="Baggage"
                          value={`${mergedSsrSelections.baggage!.length} pick${mergedSsrSelections.baggage!.length === 1 ? '' : 's'}`}
                          detail={mergedSsrSelections
                            .baggage!.map((b) => `${b.weightKg}kg @ ${formatPaiseAsINR(b.pricePaise)}`)
                            .join(', ')}
                        />
                      ) : null}
                      {(mergedSsrSelections.seats?.length ?? 0) > 0 ? (
                        <ReviewKv
                          label="Seats"
                          value={`${mergedSsrSelections.seats!.length} seat${mergedSsrSelections.seats!.length === 1 ? '' : 's'}`}
                          detail={mergedSsrSelections.seats!.map((s) => s.code).join(', ')}
                        />
                      ) : null}
                      {(mergedSsrSelections.meals?.length ?? 0) > 0 ? (
                        <ReviewKv
                          label="Meals"
                          value={`${mergedSsrSelections.meals!.length} meal${mergedSsrSelections.meals!.length === 1 ? '' : 's'}`}
                          detail={mergedSsrSelections.meals!.map((m) => m.description).join(', ')}
                        />
                      ) : null}
                    </div>
                  </ReviewSection>
                ) : null}

                {/* ── Contact + GST ── */}
                <ReviewSection title="Contact & invoicing" icon={Mail} onEdit={() => setStep(1)}>
                  <div className="space-y-2 text-[12px]">
                    <ReviewKv label="Email" value={watch('contact.email') || '—'} mono />
                    <ReviewKv
                      label="Mobile"
                      value={
                        watch('contact.mobile')
                          ? `${watch('contact.countryCode') ?? '+91'} ${watch('contact.mobile')}`
                          : '—'
                      }
                      mono
                    />
                    {watch('gst.number') ? (
                      <>
                        <ReviewKv label="GSTIN" value={watch('gst.number') ?? '—'} mono />
                        <ReviewKv label="Company" value={watch('gst.companyName') ?? '—'} />
                      </>
                    ) : (
                      <p className="text-[11px] italic text-ink-4">No GST invoice will be issued.</p>
                    )}
                  </div>
                </ReviewSection>

                {/* ── Fare breakup ── */}
                <ReviewSection title="Fare breakup" icon={Building2}>
                  <div className="space-y-1.5 text-[12px]">
                    <FareLine
                      label={`Adult × ${requested.adults}`}
                      value={
                        result.perPax.adult.grossAmountPaise * requested.adults
                      }
                    />
                    {requested.children > 0 ? (
                      <FareLine
                        label={`Child × ${requested.children}`}
                        value={result.perPax.child.grossAmountPaise * requested.children}
                      />
                    ) : null}
                    {requested.infants > 0 ? (
                      <FareLine
                        label={`Infant × ${requested.infants}`}
                        value={result.perPax.infant.grossAmountPaise * requested.infants}
                      />
                    ) : null}
                    <div className="my-2 border-t border-stroke-1" />
                    <FareLine
                      label="Total payable"
                      value={totalToPay}
                      bold
                    />
                  </div>
                </ReviewSection>

                {/* ── Wallet impact ── */}
                <ReviewSection title="Wallet impact" icon={ShieldCheck}>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                        Current balance
                      </p>
                      <p className="mt-0.5 font-mono font-semibold tabular-nums">
                        {formatPaiseAsINR(walletBalance, { compact: true })}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                        Debit
                      </p>
                      <p className="mt-0.5 font-mono font-semibold tabular-nums text-danger">
                        − {formatPaiseAsINR(totalToPay, { compact: true })}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                        After
                      </p>
                      <p
                        className={cn(
                          'mt-0.5 font-mono font-semibold tabular-nums',
                          insufficient ? 'text-danger' : 'text-ink-1',
                        )}
                      >
                        {formatPaiseAsINR(balanceAfter, { compact: true })}
                      </p>
                    </div>
                  </div>
                  {insufficient ? (
                    <div className="mt-3 flex items-start gap-2 rounded-md bg-danger-soft p-3 text-xs text-danger">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        Insufficient balance + credit. Top up or use Pay Now to settle via the gateway.
                      </span>
                    </div>
                  ) : null}
                </ReviewSection>

                <div className="flex items-center justify-between border-t pt-4">
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                  <Button
                    onClick={() => setConfirmDialog(true)}
                    disabled={!bookingId || insufficient || holdExpired || confirmMutation.isPending}
                    size="lg"
                  >
                    <ShieldCheck className="h-4 w-4" />{' '}
                    {confirmMutation.isPending ? 'Ticketing…' : `Confirm & ticket · ${formatPaiseAsINR(totalToPay)}`}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* ─────────── Sidebar: itinerary + price summary ─────────── */}
        <aside className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-3 text-ink-3">Itinerary</p>
              <div className="space-y-3">
                {result.segments.map((s, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <AirlineLogo code={s.airline.code} name={s.airline.name} size={28} className="rounded-md" />
                      <div>
                        <p className="text-xs font-semibold text-ink-1">{s.airline.name ?? s.airline.code}</p>
                        <p className="font-mono text-[10px] text-ink-3">{s.flightNumber}</p>
                      </div>
                    </div>
                    <div className="rounded-md border bg-surface-2/40 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-mono text-base font-bold tabular-nums">
                            {new Date(s.departure).toLocaleTimeString('en-IN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })}
                          </p>
                          <p className="font-mono text-xs text-ink-2">{s.origin.code}</p>
                        </div>
                        <div className="flex flex-col items-center text-[10px] text-ink-3">
                          <PlaneTakeoff className="h-3 w-3 rotate-90 text-brand-500 dark:text-brand-400" />
                          <span className="mt-0.5 font-mono">{s.duration}m</span>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-base font-bold tabular-nums">
                            {new Date(s.arrival).toLocaleTimeString('en-IN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })}
                          </p>
                          <p className="font-mono text-xs text-ink-2">{s.destination.code}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2 border-t pt-3 text-xs">
                <Badge variant={result.source === 'SERIES' ? 'accent' : 'outline'} className="text-[10px]">
                  {result.source}
                </Badge>
                <Badge variant={result.refundable ? 'success' : 'neutral'} className="text-[10px]">
                  {result.refundable ? 'Refundable' : 'Non-refundable'}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <p className="eyebrow mb-3 text-ink-3">Price breakdown</p>
              <div className="space-y-2">
                <Row label="Base fare" v={result.perPax.adult.baseFarePaise} />
                <Row label="Taxes" v={result.perPax.adult.taxesPaise} />
                {result.perPax.adult.platformMarkupPaise ||
                result.perPax.adult.distributorMarkupPaise ||
                result.perPax.adult.agencyMarkupPaise ? (
                  <Row
                    label="Markup"
                    v={
                      result.perPax.adult.platformMarkupPaise +
                      result.perPax.adult.distributorMarkupPaise +
                      result.perPax.adult.agencyMarkupPaise
                    }
                  />
                ) : null}
                {result.perPax.adult.gstPaise ? <Row label="GST" v={result.perPax.adult.gstPaise} /> : null}
              </div>
              <Separator className="my-3" />
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-ink-1">Total</span>
                <span className="font-mono text-xl font-bold tabular-nums text-ink-1">
                  {formatPaiseAsINR(result.totalGrossPaise)}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-ink-3">
                Per passenger × {requested.adults + requested.children + requested.infants}
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDialog}
        onOpenChange={setConfirmDialog}
        title="Confirm and pay"
        description={`This will debit ${formatPaiseAsINR(totalToPay)} from your wallet and issue tickets immediately. Refunds, if eligible, follow the fare rules.`}
        confirmLabel="Pay & ticket"
        onConfirm={async () => {
          if (!bookingId) return;
          if (confirmMutation.isPending) return; // double-click guard
          // Fresh key for this confirm attempt. Replays on duplicate.
          confirmIdempotencyKeyRef.current = generateIdempotencyKey();
          await confirmMutation.mutateAsync({
            bookingId,
            paymentMode: 'WALLET',
            acceptTerms: true,
          });
        }}
      />

      {/* Payment-method picker — opened by the Pay Now button. */}
      {bookingId ? (
        <PaymentMethodDialog
          open={paymentDialogOpen}
          onClose={() => setPaymentDialogOpen(false)}
          bookingId={bookingId}
          amountPaise={totalToPay}
          wallet={wallet.data ?? null}
          onWalletSuccess={(booking) => {
            setPaymentDialogOpen(false);
            handleTicketSuccess(booking);
          }}
        />
      ) : null}
    </div>
  );
}

// ────────── Sub-components ──────────

/**
 * ChainProgressStrip — sticks above the booking stepper when the agent
 * is in the middle of a multi-leg flow (round-trip or multi-city).
 * Renders one chip per leg with three states:
 *   • Done (✓ green)        — already ticketed, shows PNR
 *   • Current (brand-blue)  — the leg the agent is filling out now
 *   • Pending (muted)       — upcoming legs
 *
 * The strip is the agent's primary "where am I in the chain" signal —
 * the page header below uses the same chain info to set the title
 * (e.g. "Leg 2 of 3 — Multi-city").
 */
function ChainProgressStrip({ chain }: { chain: MultiLegChain }) {
  const totalLegs = chain.totalLegs;
  return (
    <div className="overflow-hidden rounded-xl border border-brand-200 bg-gradient-to-r from-brand-50 to-emerald-50/40 px-4 py-3 dark:border-brand-500/30 dark:from-brand-500/15 dark:to-emerald-500/10">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="rounded-full bg-brand-600 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-white">
            {chain.kind === 'ROUNDTRIP' ? 'Round-trip' : 'Multi-city'}
          </span>
          <span className="font-semibold text-brand-700 dark:text-brand-300">
            Leg {chain.currentLegIndex + 1} of {totalLegs}
          </span>
        </div>
        <span className="text-[11px] text-ink-3">
          Passenger details auto-fill across legs.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {Array.from({ length: totalLegs }).map((_, idx) => {
          const isDone = idx < chain.currentLegIndex;
          const isCurrent = idx === chain.currentLegIndex;
          const completed = chain.completedLegs[idx];
          const upcoming = chain.remainingLegs[idx - chain.currentLegIndex - 1];
          const route = completed?.route ?? upcoming?.route ?? null;
          return (
            <div
              key={idx}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                isDone &&
                  'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300',
                isCurrent &&
                  'border-brand-500 bg-brand-100 text-brand-800 shadow-sm dark:border-brand-400 dark:bg-brand-500/20 dark:text-brand-200',
                !isDone && !isCurrent && 'border-stroke-1 bg-surface-2 text-ink-3',
              )}
            >
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider">
                {isDone ? '✓' : `L${idx + 1}`}
              </span>
              <span className="font-semibold">
                {route ?? 'Leg ' + (idx + 1)}
              </span>
              {isDone && completed?.pnr ? (
                <span className="font-mono text-[10px] opacity-80">
                  PNR {completed.pnr}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-3 overflow-x-auto rounded-lg border bg-surface-1 p-3">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < step;
        const active = i === step;
        return (
          <li key={s.label} className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-8 items-center gap-2 rounded-full px-3 text-xs font-semibold transition-colors duration-fast',
                active && 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
                done && 'bg-success-soft text-success dark:bg-success/10',
                !active && !done && 'text-ink-3',
              )}
            >
              <span
                className={cn(
                  'grid h-5 w-5 place-items-center rounded-full',
                  active && 'bg-brand-600 text-white dark:bg-brand-500',
                  done && 'bg-success text-white',
                  !active && !done && 'border bg-surface-2',
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : <Icon className="h-3 w-3" strokeWidth={2} />}
              </span>
              <span className="whitespace-nowrap">{s.label}</span>
            </div>
            {i < STEPS.length - 1 ? (
              <span className="hidden h-px w-6 bg-ink-5 sm:inline-block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function HoldTimerBanner({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(diff / 1000)));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  const urgent = remaining > 0 && remaining < 120; // < 2 min
  const expired = remaining === 0;

  return (
    <div
      className={cn(
        'sticky top-16 z-20 -mx-6 -mt-8 mb-2 flex items-center gap-3 border-b px-6 py-3 lg:-mx-8 lg:px-8',
        expired
          ? 'bg-danger-soft text-danger dark:bg-danger/15'
          : urgent
            ? 'bg-warning-soft text-warning dark:bg-warning/15'
            : 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
      )}
    >
      <span className={cn('grid h-7 w-7 place-items-center rounded-full', urgent || expired ? 'bg-current/15' : 'bg-brand-100/60 dark:bg-brand-500/20')}>
        {expired ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold">
          {expired
            ? 'Hold expired'
            : urgent
              ? 'Hold expiring — confirm now'
              : 'Seats are held for you'}
        </p>
        <p className="text-xs opacity-80">
          {expired ? 'Search again for fresh availability.' : 'Confirm before the timer runs out to lock the fare.'}
        </p>
      </div>
      <div
        className={cn(
          'flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-base font-bold tabular-nums',
          expired ? 'border-danger/30' : urgent ? 'border-warning/30' : 'border-brand-300/40',
        )}
      >
        {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
      </div>
    </div>
  );
}

function Row({ label, v }: { label: string; v: number }) {
  if (!v) return null;
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-ink-3">{label}</span>
      <span className="font-mono tabular-nums text-ink-2">{formatPaiseAsINR(v, { compact: true })}</span>
    </div>
  );
}

/**
 * ReviewSection — a card-shaped block on the Review & pay step. Each
 * one carries an icon + title and an optional Edit link that jumps the
 * agent back to the step where that data was captured.
 *
 * The pattern mirrors the "Confirmation summary" page on competitor
 * portals (MMT, etrav, akbar) — every meaningful piece of data the
 * agent will be charged for is shown above the fold with a clear
 * "go back and change this" affordance, removing the trust-gap that
 * "did I really set the right title?" creates right before payment.
 */
function ReviewSection({
  title,
  icon: Icon,
  onEdit,
  children,
}: {
  title: string;
  // Lucide icons are forwardRef components — using the icon
  // export type directly (mirrors how we typed the same prop in
  // best-of-tile / details-panel) instead of a hand-rolled
  // ComponentType.
  icon: typeof Users;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-surface-1 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-stroke-1 bg-surface-2/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <p className="text-[13px] font-bold text-ink-1">{title}</p>
        </div>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="text-[11px] font-semibold text-brand-700 hover:underline dark:text-brand-300"
          >
            Edit
          </button>
        ) : null}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

/** Key-value row used inside ReviewSection — left label, right value. */
function ReviewKv({
  label,
  value,
  detail,
  mono,
}: {
  label: string;
  value: string;
  detail?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
      </span>
      <div className="text-right">
        <p className={cn('text-[12px] font-semibold text-ink-1', mono && 'font-mono')}>{value}</p>
        {detail ? <p className="text-[10px] text-ink-3">{detail}</p> : null}
      </div>
    </div>
  );
}

/** Fare-breakup line — label on the left, paise-formatted amount on the right. */
function FareLine({
  label,
  value,
  bold,
}: {
  label: string;
  value: number;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn('text-[12px] text-ink-2', bold && 'font-bold text-ink-1')}>
        {label}
      </span>
      <span
        className={cn(
          'font-mono tabular-nums text-ink-1',
          bold ? 'text-[14px] font-bold' : 'text-[12px] font-semibold',
        )}
      >
        {formatPaiseAsINR(value)}
      </span>
    </div>
  );
}

/**
 * Generate a fresh client-side idempotency key. Uses `crypto.randomUUID`
 * when available (all modern browsers + Node 19+), falls back to a
 * timestamp + random suffix on the rare browser that hasn't shipped it.
 * The middleware accepts 8–200 chars; UUIDs are 36, well within range.
 */
function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

