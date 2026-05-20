'use client';

// Map Policy create/edit drawer — mirrors screenshots 4 + 5 of the admin
// panel spec PDF. Sections (top-down):
//   1. General — Policy Name, Product Type, Status
//   2. Components — four checkbox toggles + per-component inline editors:
//        Commission   { name, payoutPercent, morePayout }
//        PLB          { name, payoutPercent, morePayout }
//        B2B Markup   { name, valueType, value, morePayout, setCondition }
//        Mgmt Fee     { name, valueType, value, hideFromAgent, morePayout, setCondition }
//   3. Set Criteria — Supplier Group, Map Sources (multi-select),
//      Airline codes (free-form), Fare types (free-form), Agency Groups
//      (checkbox grid)
//
// We render every component editor at once (no nested accordions in v1) but
// gate writes on the `enabled` flag — toggling a component off blanks its
// values when the form submits, which is what the spec implies.

import { useEffect, useMemo } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type {
  PublicMapPolicy,
  PublicSupplier,
  PublicSupplierSource,
} from '@tripbng/shared';
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
} from '@/components/ui';
import {
  useApiMutation,
  useApiPaginatedQuery,
  useApiQuery,
  useInvalidateOnSuccess,
} from '@/lib/api-client';

interface PublicAgencyGroup {
  id: string;
  name: string;
}

interface FormValues {
  name: string;
  productType: 'FLIGHT' | 'HOTEL' | 'BUS' | 'VISA';
  status: 'ACTIVE' | 'INACTIVE';

  // Component editors are rendered inline regardless of `enabled`; the
  // submit handler reads `enabled` to decide whether to send the values.
  commission: {
    enabled: boolean;
    name: string;
    payoutPercent: string;
    morePayout: boolean;
  };
  plb: {
    enabled: boolean;
    name: string;
    payoutPercent: string;
    morePayout: boolean;
  };
  b2bMarkup: {
    enabled: boolean;
    name: string;
    valueType: 'ABSOLUTE' | 'PERCENT';
    // Rupees when valueType is ABSOLUTE; integer percent otherwise.
    value: string;
    morePayout: boolean;
    setCondition: boolean;
  };
  managementFee: {
    enabled: boolean;
    name: string;
    valueType: 'ABSOLUTE' | 'PERCENT';
    value: string;
    hideFromAgent: boolean;
    morePayout: boolean;
    setCondition: boolean;
  };

  criteria: {
    supplierGroup: string;
    mapSourceIds: string[];
    airlineCodesText: string;
    fareTypes: Array<{ value: string }>;
    agencyGroupIds: string[];
  };
}

function emptyDefaults(): FormValues {
  return {
    name: '',
    productType: 'FLIGHT',
    status: 'ACTIVE',
    commission: { enabled: false, name: '', payoutPercent: '', morePayout: false },
    plb: { enabled: false, name: '', payoutPercent: '', morePayout: false },
    b2bMarkup: {
      enabled: false,
      name: '',
      valueType: 'ABSOLUTE',
      value: '',
      morePayout: false,
      setCondition: false,
    },
    managementFee: {
      enabled: false,
      name: '',
      valueType: 'ABSOLUTE',
      value: '',
      hideFromAgent: false,
      morePayout: false,
      setCondition: false,
    },
    criteria: {
      supplierGroup: '',
      mapSourceIds: [],
      airlineCodesText: '',
      fareTypes: [],
      agencyGroupIds: [],
    },
  };
}

/** ABSOLUTE: rupees → paise. PERCENT: integer percent → integer. */
function rupeesOrPercentToValue(s: string, valueType: 'ABSOLUTE' | 'PERCENT'): number {
  if (s.trim() === '') return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return valueType === 'ABSOLUTE' ? Math.round(n * 100) : Math.round(n);
}
function valueToInput(v: number | null | undefined, valueType: 'ABSOLUTE' | 'PERCENT'): string {
  if (v == null) return '';
  return valueType === 'ABSOLUTE' ? (v / 100).toString() : String(v);
}

export function MapPolicyFormDrawer({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: PublicMapPolicy | null;
}) {
  const editing = target !== null;

  const { register, handleSubmit, reset, setValue, control, watch, formState } =
    useForm<FormValues>({ defaultValues: emptyDefaults() });

  // Map Source picker — list across all product types so the same drawer
  // works for FLIGHT/HOTEL/etc. The list endpoint is small (per-tenant);
  // filtering by selected productType client-side keeps the picker honest.
  const mapSources = useApiQuery<PublicSupplierSource[]>(
    ['map-sources-options'],
    '/api/v1/suppliers/sources',
  );

  const agencyGroups = useApiQuery<PublicAgencyGroup[]>(
    ['agency-groups-options'],
    '/api/v1/agency-groups',
  );

  // Suppliers list — only needed for the supplier-group hint below the
  // picker. Pulled lazily; OK if it 401s for non-admins (the drawer is
  // admin-gated anyway).
  useApiPaginatedQuery<PublicSupplier>(['suppliers-options'], '/api/v1/suppliers', {
    query: { page: 1, limit: 100 },
  });

  const fareTypes = useFieldArray({ control, name: 'criteria.fareTypes' });

  useEffect(() => {
    if (!open) {
      reset(emptyDefaults());
      return;
    }
    if (target) {
      reset({
        name: target.name,
        productType: target.productType,
        status: target.status,
        commission: {
          enabled: target.commission.enabled,
          name: target.commission.name ?? '',
          payoutPercent: String(target.commission.payoutPercent ?? 0),
          morePayout: target.commission.morePayout,
        },
        plb: {
          enabled: target.plb.enabled,
          name: target.plb.name ?? '',
          payoutPercent: String(target.plb.payoutPercent ?? 0),
          morePayout: target.plb.morePayout,
        },
        b2bMarkup: {
          enabled: target.b2bMarkup.enabled,
          name: target.b2bMarkup.name ?? '',
          valueType: target.b2bMarkup.valueType,
          value: valueToInput(target.b2bMarkup.value, target.b2bMarkup.valueType),
          morePayout: target.b2bMarkup.morePayout,
          setCondition: target.b2bMarkup.setCondition,
        },
        managementFee: {
          enabled: target.managementFee.enabled,
          name: target.managementFee.name ?? '',
          valueType: target.managementFee.valueType,
          value: valueToInput(target.managementFee.value, target.managementFee.valueType),
          hideFromAgent: target.managementFee.hideFromAgent,
          morePayout: target.managementFee.morePayout,
          setCondition: target.managementFee.setCondition,
        },
        criteria: {
          supplierGroup: target.criteria.supplierGroup ?? '',
          mapSourceIds: target.criteria.mapSourceIds,
          airlineCodesText: target.criteria.airlineCodes.join(', '),
          fareTypes: target.criteria.fareTypes.map((v) => ({ value: v })),
          agencyGroupIds: target.criteria.agencyGroupIds,
        },
      });
    }
  }, [open, target, reset]);

  const invalidate = useInvalidateOnSuccess([['map-policies']]);

  const createMutation = useApiMutation<Record<string, unknown>, { id: string }>(
    '/api/v1/map-policies',
    'POST',
    {
      onSuccess: () => {
        toast.success('Map Policy created');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const updateMutation = useApiMutation<Record<string, unknown>, { id: string }>(
    () => `/api/v1/map-policies/${target?.id ?? ''}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Map Policy updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const watchCommissionEnabled = watch('commission.enabled');
  const watchPlbEnabled = watch('plb.enabled');
  const watchB2bEnabled = watch('b2bMarkup.enabled');
  const watchFeeEnabled = watch('managementFee.enabled');
  const watchAgencyGroupIds = watch('criteria.agencyGroupIds');
  const watchMapSourceIds = watch('criteria.mapSourceIds');
  const watchStatus = watch('status');
  const watchProduct = watch('productType');

  const mapSourceList = useMemo(() => {
    const all = mapSources.data ?? [];
    return all.filter((s) => s.productType === watchProduct);
  }, [mapSources.data, watchProduct]);
  const agencyGroupList = useMemo(() => agencyGroups.data ?? [], [agencyGroups.data]);

  function toggleArrayValue(field: 'criteria.agencyGroupIds' | 'criteria.mapSourceIds', id: string) {
    const cur = (watch(field) ?? []) as string[];
    setValue(
      field,
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
      { shouldDirty: true },
    );
  }

  function onSubmit(values: FormValues) {
    const airlineCodes = values.criteria.airlineCodesText
      .split(/[\s,]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const fareTypesArr = values.criteria.fareTypes
      .map((r) => r.value.trim())
      .filter(Boolean);

    const payload: Record<string, unknown> = {
      name: values.name,
      productType: values.productType,
      status: values.status,
      commission: {
        enabled: values.commission.enabled,
        name: values.commission.name || null,
        payoutPercent: values.commission.enabled
          ? Number(values.commission.payoutPercent) || 0
          : 0,
        morePayout: values.commission.morePayout,
      },
      plb: {
        enabled: values.plb.enabled,
        name: values.plb.name || null,
        payoutPercent: values.plb.enabled ? Number(values.plb.payoutPercent) || 0 : 0,
        morePayout: values.plb.morePayout,
      },
      b2bMarkup: {
        enabled: values.b2bMarkup.enabled,
        name: values.b2bMarkup.name || null,
        valueType: values.b2bMarkup.valueType,
        value: values.b2bMarkup.enabled
          ? rupeesOrPercentToValue(values.b2bMarkup.value, values.b2bMarkup.valueType)
          : 0,
        morePayout: values.b2bMarkup.morePayout,
        setCondition: values.b2bMarkup.setCondition,
      },
      managementFee: {
        enabled: values.managementFee.enabled,
        name: values.managementFee.name || null,
        valueType: values.managementFee.valueType,
        value: values.managementFee.enabled
          ? rupeesOrPercentToValue(
              values.managementFee.value,
              values.managementFee.valueType,
            )
          : 0,
        hideFromAgent: values.managementFee.hideFromAgent,
        morePayout: values.managementFee.morePayout,
        setCondition: values.managementFee.setCondition,
      },
      criteria: {
        supplierGroup: values.criteria.supplierGroup || null,
        mapSourceIds: values.criteria.mapSourceIds,
        airlineCodes,
        fareTypes: fareTypesArr,
        agencyGroupIds: values.criteria.agencyGroupIds,
      },
    };

    if (editing && target) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[760px]">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Map Policy' : 'New Map Policy'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col">
          <DialogBody className="space-y-6">
            {/* ── 1. General ────────────────────────────────────────────── */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-ink-1">General info</h3>
              <div className="grid grid-cols-2 gap-3">
                <FormField id="mp-name" label="Policy name" required>
                  <Input id="mp-name" {...register('name', { required: true })} />
                </FormField>
                <FormField id="mp-status" label="Status">
                  <div className="flex items-center gap-2 pt-1">
                    <Switch
                      checked={watchStatus === 'ACTIVE'}
                      onCheckedChange={(c) =>
                        setValue('status', c ? 'ACTIVE' : 'INACTIVE', {
                          shouldDirty: true,
                        })
                      }
                    />
                    <span className="text-sm">{watchStatus}</span>
                  </div>
                </FormField>
              </div>
              <FormField id="mp-product" label="Product type" required>
                <Controller
                  control={control}
                  name="productType"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="mp-product">
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
            </section>

            <Separator />

            {/* ── 2. Components ────────────────────────────────────────── */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-ink-1">Components</h3>
              <p className="text-xs text-ink-3">
                Toggle the components this policy applies. Each enabled component contributes
                to the agent-facing price.
              </p>

              {/* Commission */}
              <div className="rounded border border-border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" {...register('commission.enabled')} />
                  Commission
                </label>
                {watchCommissionEnabled ? (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <FormField id="mp-c-name" label="Commission name">
                      <Input
                        id="mp-c-name"
                        placeholder="e.g. 70% PASS"
                        {...register('commission.name')}
                      />
                    </FormField>
                    <FormField id="mp-c-pct" label="Payout %">
                      <Input
                        id="mp-c-pct"
                        type="number"
                        min={0}
                        max={100}
                        {...register('commission.payoutPercent')}
                      />
                    </FormField>
                    <FormField id="mp-c-more" label="More payout">
                      <label className="flex items-center gap-2 pt-1 text-xs">
                        <input type="checkbox" {...register('commission.morePayout')} />
                        Mark as "More payout"
                      </label>
                    </FormField>
                  </div>
                ) : null}
              </div>

              {/* PLB */}
              <div className="rounded border border-border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" {...register('plb.enabled')} />
                  PLB
                </label>
                {watchPlbEnabled ? (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <FormField id="mp-p-name" label="PLB name">
                      <Input id="mp-p-name" {...register('plb.name')} />
                    </FormField>
                    <FormField id="mp-p-pct" label="Payout %">
                      <Input
                        id="mp-p-pct"
                        type="number"
                        min={0}
                        max={100}
                        {...register('plb.payoutPercent')}
                      />
                    </FormField>
                    <FormField id="mp-p-more" label="More payout">
                      <label className="flex items-center gap-2 pt-1 text-xs">
                        <input type="checkbox" {...register('plb.morePayout')} />
                        Mark as "More payout"
                      </label>
                    </FormField>
                  </div>
                ) : null}
              </div>

              {/* B2B Markup */}
              <div className="rounded border border-border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" {...register('b2bMarkup.enabled')} />
                  B2B Markup
                </label>
                {watchB2bEnabled ? (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <FormField id="mp-b-name" label="Markup name">
                      <Input id="mp-b-name" {...register('b2bMarkup.name')} />
                    </FormField>
                    <FormField id="mp-b-type" label="Value type">
                      <Controller
                        control={control}
                        name="b2bMarkup.valueType"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="mp-b-type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ABSOLUTE">Absolute (₹)</SelectItem>
                              <SelectItem value="PERCENT">Percent (%)</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </FormField>
                    <FormField id="mp-b-value" label="Value">
                      <Input
                        id="mp-b-value"
                        type="number"
                        min={0}
                        step="0.01"
                        {...register('b2bMarkup.value')}
                      />
                    </FormField>
                    <div className="col-span-3 flex gap-6 text-xs">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" {...register('b2bMarkup.morePayout')} />
                        More payout
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" {...register('b2bMarkup.setCondition')} />
                        Set condition (apply only when criteria match)
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Management Fee */}
              <div className="rounded border border-border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" {...register('managementFee.enabled')} />
                  Management Fee
                </label>
                {watchFeeEnabled ? (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <FormField id="mp-f-name" label="Fee name">
                      <Input
                        id="mp-f-name"
                        placeholder="e.g. IDRS"
                        {...register('managementFee.name')}
                      />
                    </FormField>
                    <FormField id="mp-f-type" label="Value type">
                      <Controller
                        control={control}
                        name="managementFee.valueType"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="mp-f-type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ABSOLUTE">Absolute (₹)</SelectItem>
                              <SelectItem value="PERCENT">Percent (%)</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </FormField>
                    <FormField id="mp-f-value" label="Value">
                      <Input
                        id="mp-f-value"
                        type="number"
                        min={0}
                        step="0.01"
                        {...register('managementFee.value')}
                      />
                    </FormField>
                    <div className="col-span-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          {...register('managementFee.hideFromAgent')}
                        />
                        Hide from agent
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" {...register('managementFee.morePayout')} />
                        More payout
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" {...register('managementFee.setCondition')} />
                        Set condition
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <Separator />

            {/* ── 3. Set Criteria ──────────────────────────────────────── */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-ink-1">Set criteria</h3>
              <p className="text-xs text-ink-3">
                Empty arrays = no restriction on that axis. A policy with empty criteria
                matches every booking.
              </p>

              <FormField id="mp-criteria-group" label="Supplier group">
                <Input
                  id="mp-criteria-group"
                  placeholder="e.g. tripbng group1"
                  {...register('criteria.supplierGroup')}
                />
              </FormField>

              <div>
                <label className="text-xs text-ink-3">Select source(s)</label>
                {mapSourceList.length === 0 ? (
                  <p className="mt-1 text-xs text-ink-3">
                    No Map Sources for product type {watchProduct}. Create one under
                    Suppliers › Map sources first.
                  </p>
                ) : (
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {mapSourceList.map((s) => {
                      const active = watchMapSourceIds?.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                            active
                              ? 'border-accent bg-accent-soft text-accent'
                              : 'border-border bg-surface-2'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(active)}
                            onChange={() => toggleArrayValue('criteria.mapSourceIds', s.id)}
                          />
                          <span>
                            {s.name ?? `${s.supplierName ?? s.supplierCode} ${s.travelType}`}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <FormField id="mp-criteria-airlines" label="Airline codes">
                <Input
                  id="mp-criteria-airlines"
                  placeholder="e.g. AI, 6E, QP"
                  {...register('criteria.airlineCodesText')}
                />
              </FormField>

              {/* Fare types — repeater */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-ink-3">Fare types</label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => fareTypes.append({ value: '' })}
                  >
                    <Plus className="size-3" /> Add
                  </Button>
                </div>
                {fareTypes.fields.length === 0 ? (
                  <p className="text-xs text-ink-3">No fare types added.</p>
                ) : (
                  <div className="mt-1 space-y-2">
                    {fareTypes.fields.map((f, i) => (
                      <div key={f.id} className="grid grid-cols-[1fr_auto] gap-2">
                        <Input
                          placeholder="e.g. Regular"
                          {...register(`criteria.fareTypes.${i}.value` as const)}
                        />
                        <button
                          type="button"
                          className="text-danger"
                          onClick={() => fareTypes.remove(i)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Agency groups */}
              <div>
                <label className="text-xs text-ink-3">Agency groups</label>
                {agencyGroupList.length === 0 ? (
                  <p className="mt-1 text-xs text-ink-3">No agency groups configured yet.</p>
                ) : (
                  <div className="mt-1 grid grid-cols-3 gap-2">
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
                            onChange={() => toggleArrayValue('criteria.agencyGroupIds', g.id)}
                          />
                          <span>{g.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                formState.isSubmitting ||
                createMutation.isPending ||
                updateMutation.isPending
              }
            >
              {formState.isSubmitting ||
              createMutation.isPending ||
              updateMutation.isPending
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
