'use client';

// Map Source create/edit drawer — mirrors screenshot 2 of the admin panel
// spec PDF. Sections (top-down):
//   1. Identity   — name, source (supplier), supplier group, status
//   2. Airlines   — IATA codes (comma-separated for v1; file upload deferred)
//   3. Agency Groups — checkbox grid (empty = applies to all groups)
//   4. Mask Booking Class Code — repeater of { original, masked }
//   5. Mask Fare Type          — same shape
//   6. Hide Fare Type          — repeater of strings
//   7. Restrict Travel Date & Time
//   8. Manual Issuance — pendingBooking switch + criteria
//   9. Travel Criteria — deferred (renders a "coming soon" stub)
//
// All sections live in a single scrollable drawer (no accordions in v1; the
// section headers make the form skim-readable). Submit goes to either POST
// /sources or PATCH /sources/:id depending on `target`.

import { useEffect, useMemo } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicSupplier, PublicSupplierSource } from '@tripbng/shared';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DrawerContent,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Textarea,
} from '@/components/ui';
import {
  useApiMutation,
  useApiPaginatedQuery,
  useApiQuery,
  useInvalidateOnSuccess,
} from '@/lib/api-client';

// Agency group shape — same envelope the agency-groups list returns.
interface PublicAgencyGroup {
  id: string;
  name: string;
}

// Form values — kept local rather than pulled from @tripbng/shared because
// we mediate string<->array conversion (e.g. airline codes are entered as
// comma-separated text, sent as string[]).
interface FormValues {
  name: string;
  supplierId: string;
  supplierGroup: string;
  status: 'ACTIVE' | 'INACTIVE';
  productType: 'FLIGHT' | 'HOTEL' | 'BUS' | 'VISA';
  travelType: 'DOMESTIC' | 'INTERNATIONAL' | 'BOTH';
  airlineCodesText: string;
  agencyGroupIds: string[];
  maskBookingClassCodes: Array<{ original: string; masked: string }>;
  maskFareTypes: Array<{ original: string; masked: string }>;
  hideFareTypes: Array<{ value: string }>;
  restrictTravel: {
    dateFrom: string;
    dateTo: string;
    timeStart: string; // "HH:MM"
    timeEnd: string;
  };
  manualIssuance: {
    pendingBooking: boolean;
    maximumPax: string;
    minAmountRupees: string;
    maxAmountRupees: string;
    tripType: '' | 'ONEWAY' | 'ROUND_TRIP' | 'MULTI_CITY';
    bookingClass: string;
    fareBasis: string;
    fromDate: string;
    toDate: string;
    bookingDateFrom: string;
    bookingDateTo: string;
    applyForNonStopFlight: boolean;
    applyForStopFlight: boolean;
    sector: string;
  };
}

function emptyDefaults(): FormValues {
  return {
    name: '',
    supplierId: '',
    supplierGroup: '',
    status: 'ACTIVE',
    productType: 'FLIGHT',
    travelType: 'INTERNATIONAL',
    airlineCodesText: '',
    agencyGroupIds: [],
    maskBookingClassCodes: [],
    maskFareTypes: [],
    hideFareTypes: [],
    restrictTravel: { dateFrom: '', dateTo: '', timeStart: '', timeEnd: '' },
    manualIssuance: {
      pendingBooking: false,
      maximumPax: '',
      minAmountRupees: '',
      maxAmountRupees: '',
      tripType: '',
      bookingClass: '',
      fareBasis: '',
      fromDate: '',
      toDate: '',
      bookingDateFrom: '',
      bookingDateTo: '',
      applyForNonStopFlight: false,
      applyForStopFlight: false,
      sector: '',
    },
  };
}

/** Convert a "HH:MM" string to minutes-since-midnight, or null. */
function timeToMinutes(s: string): number | null {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
function minutesToTime(m: number | null | undefined): string {
  if (m == null) return '';
  const h = Math.floor(m / 60);
  const mi = m % 60;
  return `${h.toString().padStart(2, '0')}:${mi.toString().padStart(2, '0')}`;
}
function dateToInput(d: string | null | undefined): string {
  if (!d) return '';
  return d.slice(0, 10); // YYYY-MM-DD
}
function rupeesToPaise(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
function paiseToRupeesInput(p: number | null | undefined): string {
  if (p == null) return '';
  return (p / 100).toString();
}

export function MapSourceFormDrawer({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: PublicSupplierSource | null;
}) {
  const editing = target !== null;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: emptyDefaults() });

  // Supplier dropdown — paginated list of suppliers for the current tenant.
  const suppliers = useApiPaginatedQuery<PublicSupplier>(['suppliers-options'], '/api/v1/suppliers', {
    query: { page: 1, limit: 100 },
  });

  // Agency-group checkboxes — light list endpoint already exists.
  const agencyGroups = useApiQuery<PublicAgencyGroup[]>(
    ['agency-groups-options'],
    '/api/v1/agency-groups',
  );

  // Field arrays — masks + hides.
  const maskBookingClasses = useFieldArray({ control, name: 'maskBookingClassCodes' });
  const maskFareTypes = useFieldArray({ control, name: 'maskFareTypes' });
  const hideFareTypes = useFieldArray({ control, name: 'hideFareTypes' });

  // Hydrate the form when opening for edit or reset when closing.
  useEffect(() => {
    if (!open) {
      reset(emptyDefaults());
      return;
    }
    if (target) {
      reset({
        name: target.name ?? '',
        supplierId: target.supplierId,
        supplierGroup: target.supplierGroup ?? '',
        status: target.status,
        productType: target.productType,
        travelType: target.travelType,
        airlineCodesText: target.airlineCodes.join(', '),
        agencyGroupIds: target.agencyGroupIds,
        maskBookingClassCodes: target.maskBookingClassCodes,
        maskFareTypes: target.maskFareTypes,
        hideFareTypes: target.hideFareTypes.map((v) => ({ value: v })),
        restrictTravel: {
          dateFrom: dateToInput(target.restrictTravel?.dateFrom as string | undefined),
          dateTo: dateToInput(target.restrictTravel?.dateTo as string | undefined),
          timeStart: minutesToTime(target.restrictTravel?.timeStartMinutes),
          timeEnd: minutesToTime(target.restrictTravel?.timeEndMinutes),
        },
        manualIssuance: {
          pendingBooking: target.manualIssuance?.pendingBooking ?? false,
          maximumPax:
            target.manualIssuance?.maximumPax != null
              ? String(target.manualIssuance.maximumPax)
              : '',
          minAmountRupees: paiseToRupeesInput(target.manualIssuance?.minAmountPaisePerPax),
          maxAmountRupees: paiseToRupeesInput(target.manualIssuance?.maxAmountPaisePerPax),
          tripType: (target.manualIssuance?.tripType as FormValues['manualIssuance']['tripType']) ?? '',
          bookingClass: target.manualIssuance?.bookingClass ?? '',
          fareBasis: target.manualIssuance?.fareBasis ?? '',
          fromDate: dateToInput(target.manualIssuance?.fromDate as string | undefined),
          toDate: dateToInput(target.manualIssuance?.toDate as string | undefined),
          bookingDateFrom: dateToInput(target.manualIssuance?.bookingDateFrom as string | undefined),
          bookingDateTo: dateToInput(target.manualIssuance?.bookingDateTo as string | undefined),
          applyForNonStopFlight: target.manualIssuance?.applyForNonStopFlight ?? false,
          applyForStopFlight: target.manualIssuance?.applyForStopFlight ?? false,
          sector: target.manualIssuance?.sector ?? '',
        },
      });
    }
  }, [open, target, reset]);

  const invalidate = useInvalidateOnSuccess([['map-sources']]);

  const createMutation = useApiMutation<Record<string, unknown>, { id: string }>(
    '/api/v1/suppliers/sources',
    'POST',
    {
      onSuccess: () => {
        toast.success('Map Source created');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const updateMutation = useApiMutation<Record<string, unknown>, { id: string }>(
    () => `/api/v1/suppliers/sources/${target?.id ?? ''}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Map Source updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const supplierList = suppliers.data?.data ?? [];
  const agencyGroupList = useMemo(() => agencyGroups.data ?? [], [agencyGroups.data]);

  function onSubmit(values: FormValues) {
    // Translate the form shape into the API shape.
    const airlineCodes = values.airlineCodesText
      .split(/[\s,]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);

    const hideFareTypesArr = values.hideFareTypes
      .map((r) => r.value.trim())
      .filter(Boolean);

    const restrictTravel = {
      dateFrom: values.restrictTravel.dateFrom
        ? new Date(values.restrictTravel.dateFrom).toISOString()
        : null,
      dateTo: values.restrictTravel.dateTo
        ? new Date(values.restrictTravel.dateTo).toISOString()
        : null,
      timeStartMinutes: timeToMinutes(values.restrictTravel.timeStart),
      timeEndMinutes: timeToMinutes(values.restrictTravel.timeEnd),
    };

    const mi = values.manualIssuance;
    const manualIssuance = {
      pendingBooking: mi.pendingBooking,
      maximumPax: mi.maximumPax ? Number(mi.maximumPax) : null,
      minAmountPaisePerPax: rupeesToPaise(mi.minAmountRupees),
      maxAmountPaisePerPax: rupeesToPaise(mi.maxAmountRupees),
      tripType: mi.tripType || null,
      bookingClass: mi.bookingClass || null,
      fareBasis: mi.fareBasis || null,
      fromDate: mi.fromDate ? new Date(mi.fromDate).toISOString() : null,
      toDate: mi.toDate ? new Date(mi.toDate).toISOString() : null,
      bookingDateFrom: mi.bookingDateFrom ? new Date(mi.bookingDateFrom).toISOString() : null,
      bookingDateTo: mi.bookingDateTo ? new Date(mi.bookingDateTo).toISOString() : null,
      applyForNonStopFlight: mi.applyForNonStopFlight,
      applyForStopFlight: mi.applyForStopFlight,
      sector: mi.sector || null,
    };

    const payload: Record<string, unknown> = {
      name: values.name || undefined,
      supplierGroup: values.supplierGroup || null,
      supplierId: values.supplierId,
      productType: values.productType,
      travelType: values.travelType,
      airlineCodes,
      agencyGroupIds: values.agencyGroupIds,
      maskBookingClassCodes: values.maskBookingClassCodes.filter(
        (r) => r.original.trim() && r.masked.trim(),
      ),
      maskFareTypes: values.maskFareTypes.filter(
        (r) => r.original.trim() && r.masked.trim(),
      ),
      hideFareTypes: hideFareTypesArr,
      restrictTravel,
      manualIssuance,
      status: values.status,
    };

    if (editing && target) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  }

  const watchAgencyGroupIds = watch('agencyGroupIds');
  const watchSupplierId = watch('supplierId');
  const watchStatus = watch('status');
  const watchPending = watch('manualIssuance.pendingBooking');

  function toggleAgencyGroup(id: string) {
    const cur = watchAgencyGroupIds ?? [];
    setValue(
      'agencyGroupIds',
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
      { shouldDirty: true },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[720px]">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Map Source' : 'New Map Source'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col">
          <DialogBody className="space-y-6">
            {/* ── 1. Identity ───────────────────────────────────────────── */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-ink-1">Identity</h3>
              <div className="grid grid-cols-2 gap-3">
                <FormField id="ms-name" label="Source name" required>
                  <Input
                    id="ms-name"
                    placeholder="e.g. Kafila International"
                    {...register('name', { required: true })}
                  />
                </FormField>
                <FormField id="ms-status" label="Status">
                  <div className="flex items-center gap-2 pt-1">
                    <Switch
                      checked={watchStatus === 'ACTIVE'}
                      onCheckedChange={(c) =>
                        setValue('status', c ? 'ACTIVE' : 'INACTIVE', { shouldDirty: true })
                      }
                    />
                    <span className="text-sm">{watchStatus}</span>
                  </div>
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField id="ms-supplier" label="Supplier" required>
                  <Select
                    value={watchSupplierId}
                    onValueChange={(v) => setValue('supplierId', v, { shouldDirty: true })}
                  >
                    <SelectTrigger id="ms-supplier">
                      <SelectValue placeholder="Pick a supplier…" />
                    </SelectTrigger>
                    <SelectContent>
                      {supplierList.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} ({s.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField id="ms-group" label="Supplier group">
                  <Input
                    id="ms-group"
                    placeholder="e.g. tripbng group1"
                    {...register('supplierGroup')}
                  />
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField id="ms-product" label="Product type" required>
                  <Controller
                    control={control}
                    name="productType"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="ms-product">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FLIGHT">FLIGHT</SelectItem>
                          <SelectItem value="HOTEL">HOTEL</SelectItem>
                          <SelectItem value="BUS">BUS</SelectItem>
                          <SelectItem value="VISA">VISA</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
                <FormField id="ms-travel" label="Travel type" required>
                  <Controller
                    control={control}
                    name="travelType"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="ms-travel">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="DOMESTIC">Domestic</SelectItem>
                          <SelectItem value="INTERNATIONAL">International</SelectItem>
                          <SelectItem value="BOTH">Both</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
              </div>
            </section>

            <Separator />

            {/* ── 2. Airlines ──────────────────────────────────────────── */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-ink-1">Airlines</h3>
              <p className="text-xs text-ink-3">
                Only flights from these IATA codes will reach the agent. Leave empty to block
                all airlines from this source.
              </p>
              <FormField id="ms-airlines" label="Airline codes" error={errors.airlineCodesText?.message}>
                <Textarea
                  id="ms-airlines"
                  rows={2}
                  placeholder="e.g. AI, 6E, QP, IX"
                  {...register('airlineCodesText')}
                />
              </FormField>
            </section>

            <Separator />

            {/* ── 3. Agency Groups ────────────────────────────────────── */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-ink-1">Agency groups</h3>
              <p className="text-xs text-ink-3">
                Empty = applies to all agency groups. Pick specific groups to limit which
                agents see this source.
              </p>
              {agencyGroupList.length === 0 ? (
                <p className="text-xs text-ink-3">No agency groups configured yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {agencyGroupList.map((g) => {
                    const active = watchAgencyGroupIds?.includes(g.id);
                    return (
                      <label
                        key={g.id}
                        className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                          active
                            ? 'border-accent bg-accent-soft text-accent'
                            : 'border-border bg-surface-2'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(active)}
                          onChange={() => toggleAgencyGroup(g.id)}
                        />
                        <span>{g.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>

            <Separator />

            {/* ── 4. Mask Booking Class Code ──────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-1">Mask booking-class codes</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => maskBookingClasses.append({ original: '', masked: '' })}
                >
                  <Plus className="size-3" /> Add
                </Button>
              </div>
              {maskBookingClasses.fields.length === 0 ? (
                <p className="text-xs text-ink-3">No masks. Supplier codes will pass through unchanged.</p>
              ) : (
                <div className="space-y-2">
                  {maskBookingClasses.fields.map((f, i) => (
                    <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <Input
                        placeholder="Original (e.g. YA)"
                        {...register(`maskBookingClassCodes.${i}.original` as const)}
                      />
                      <Input
                        placeholder="Masked (e.g. Y)"
                        {...register(`maskBookingClassCodes.${i}.masked` as const)}
                      />
                      <button
                        type="button"
                        className="text-danger"
                        onClick={() => maskBookingClasses.remove(i)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── 5. Mask Fare Type ───────────────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-1">Mask fare types</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => maskFareTypes.append({ original: '', masked: '' })}
                >
                  <Plus className="size-3" /> Add
                </Button>
              </div>
              {maskFareTypes.fields.length === 0 ? (
                <p className="text-xs text-ink-3">No masks. Supplier fare types will pass through unchanged.</p>
              ) : (
                <div className="space-y-2">
                  {maskFareTypes.fields.map((f, i) => (
                    <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <Input
                        placeholder="Original (e.g. INSTANT_OFFER)"
                        {...register(`maskFareTypes.${i}.original` as const)}
                      />
                      <Input
                        placeholder="Masked (e.g. Promo)"
                        {...register(`maskFareTypes.${i}.masked` as const)}
                      />
                      <button
                        type="button"
                        className="text-danger"
                        onClick={() => maskFareTypes.remove(i)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── 6. Hide Fare Type ───────────────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-1">Hide fare types</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => hideFareTypes.append({ value: '' })}
                >
                  <Plus className="size-3" /> Add
                </Button>
              </div>
              {hideFareTypes.fields.length === 0 ? (
                <p className="text-xs text-ink-3">No hides. All supplier fare types reach the agent.</p>
              ) : (
                <div className="space-y-2">
                  {hideFareTypes.fields.map((f, i) => (
                    <div key={f.id} className="grid grid-cols-[1fr_auto] gap-2">
                      <Input
                        placeholder="Fare type to hide (e.g. SME)"
                        {...register(`hideFareTypes.${i}.value` as const)}
                      />
                      <button
                        type="button"
                        className="text-danger"
                        onClick={() => hideFareTypes.remove(i)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <Separator />

            {/* ── 7. Restrict Travel Date and Time ────────────────────── */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-ink-1">Restrict travel date & time</h3>
              <p className="text-xs text-ink-3">
                Only show fares whose travel falls in this window. Leave blank for no restriction.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <FormField id="ms-rt-from" label="Date from">
                  <Input id="ms-rt-from" type="date" {...register('restrictTravel.dateFrom')} />
                </FormField>
                <FormField id="ms-rt-to" label="Date to">
                  <Input id="ms-rt-to" type="date" {...register('restrictTravel.dateTo')} />
                </FormField>
                <FormField id="ms-rt-ts" label="Time start (IST)">
                  <Input id="ms-rt-ts" type="time" {...register('restrictTravel.timeStart')} />
                </FormField>
                <FormField id="ms-rt-te" label="Time end (IST)">
                  <Input id="ms-rt-te" type="time" {...register('restrictTravel.timeEnd')} />
                </FormField>
              </div>
            </section>

            <Separator />

            {/* ── 8. Manual Issuance ──────────────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-1">Manual issuance</h3>
                <div className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={watchPending}
                    onCheckedChange={(c) =>
                      setValue('manualIssuance.pendingBooking', c, { shouldDirty: true })
                    }
                  />
                  <span>Pending booking</span>
                </div>
              </div>
              <p className="text-xs text-ink-3">
                When pending booking is on, matching bookings skip the supplier API and land
                in PENDING_MANUAL state. Ops issues a PNR + reference from the back office.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <FormField id="ms-mi-pax" label="Maximum pax">
                  <Input
                    id="ms-mi-pax"
                    type="number"
                    min={1}
                    {...register('manualIssuance.maximumPax')}
                  />
                </FormField>
                <FormField id="ms-mi-trip" label="Trip type">
                  <Controller
                    control={control}
                    name="manualIssuance.tripType"
                    render={({ field }) => (
                      <Select value={field.value || 'ANY'} onValueChange={(v) => field.onChange(v === 'ANY' ? '' : v)}>
                        <SelectTrigger id="ms-mi-trip">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ANY">Any</SelectItem>
                          <SelectItem value="ONEWAY">One-way</SelectItem>
                          <SelectItem value="ROUND_TRIP">Round-trip</SelectItem>
                          <SelectItem value="MULTI_CITY">Multi-city</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
                <FormField id="ms-mi-min" label="Min amount per pax (₹)">
                  <Input
                    id="ms-mi-min"
                    type="number"
                    min={0}
                    step="0.01"
                    {...register('manualIssuance.minAmountRupees')}
                  />
                </FormField>
                <FormField id="ms-mi-max" label="Max amount per pax (₹)">
                  <Input
                    id="ms-mi-max"
                    type="number"
                    min={0}
                    step="0.01"
                    {...register('manualIssuance.maxAmountRupees')}
                  />
                </FormField>
                <FormField id="ms-mi-bc" label="Booking class">
                  <Input
                    id="ms-mi-bc"
                    placeholder="e.g. K,T,YJ"
                    {...register('manualIssuance.bookingClass')}
                  />
                </FormField>
                <FormField id="ms-mi-fb" label="Fare basis">
                  <Input
                    id="ms-mi-fb"
                    placeholder="e.g. 1R,USAVLMIF"
                    {...register('manualIssuance.fareBasis')}
                  />
                </FormField>
                <FormField id="ms-mi-tf" label="Travel from">
                  <Input
                    id="ms-mi-tf"
                    type="date"
                    {...register('manualIssuance.fromDate')}
                  />
                </FormField>
                <FormField id="ms-mi-tt" label="Travel to">
                  <Input
                    id="ms-mi-tt"
                    type="date"
                    {...register('manualIssuance.toDate')}
                  />
                </FormField>
                <FormField id="ms-mi-bf" label="Booking from">
                  <Input
                    id="ms-mi-bf"
                    type="date"
                    {...register('manualIssuance.bookingDateFrom')}
                  />
                </FormField>
                <FormField id="ms-mi-bt" label="Booking to">
                  <Input
                    id="ms-mi-bt"
                    type="date"
                    {...register('manualIssuance.bookingDateTo')}
                  />
                </FormField>
              </div>
              <FormField id="ms-mi-sector" label="Sector">
                <Input
                  id="ms-mi-sector"
                  placeholder="e.g. DEL-BOM,DEL-DXB"
                  {...register('manualIssuance.sector')}
                />
              </FormField>
              <div className="flex gap-6 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    {...register('manualIssuance.applyForNonStopFlight')}
                  />
                  Apply for non-stop flights
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    {...register('manualIssuance.applyForStopFlight')}
                  />
                  Apply for stop flights
                </label>
              </div>
            </section>

            <Separator />

            {/* ── 9. Travel Criteria — placeholder for v1 ─────────────── */}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-ink-1">Travel criteria</h3>
              <p className="text-xs text-ink-3">
                Additional travel-side criteria — sectors, cabin classes, advance-purchase
                windows. UI lands in a follow-up; the row is preserved on save.
              </p>
            </section>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Back
            </Button>
            <Button
              type="submit"
              disabled={
                isSubmitting || createMutation.isPending || updateMutation.isPending
              }
            >
              {isSubmitting || createMutation.isPending || updateMutation.isPending
                ? 'Saving…'
                : editing
                  ? 'Update'
                  : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
