'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  CreateInventoryRequestSchema,
  TRAVEL_CLASS,
  TRAVEL_TYPE,
  type CreateInventoryRequest,
  type PublicInventory,
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
  Textarea,
} from '@/components/ui';
import { useApiMutation, useInvalidateOnSuccess } from '@/lib/api-client';
import { rupeesStringToPaise } from '@/lib/money';
import { cn } from '@/lib/utils';

const STEPS = ['Journey & Schedule', 'Capacity & Class', 'Fare & Rules'] as const;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CreateInventoryWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState(0);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<CreateInventoryRequest>({
    resolver: zodResolver(CreateInventoryRequestSchema),
    defaultValues: {
      travelType: 'DOMESTIC',
      travelClass: 'ECONOMY',
      daysOfOperation: [1, 2, 3, 4, 5],
      isRealTimeBooking: false,
      bucketPricing: [],
      segments: [
        {
          flightNumber: '',
          airline: { code: '' },
          origin: { code: '' },
          destination: { code: '' },
          departureTime: '00:00',
          arrivalTime: '00:00',
          duration: 60,
          stopOver: 0,
        },
      ],
      fare: {
        adultFare: 0,
        childFare: 0,
        infantFare: 0,
        discount: 0,
        b2bMarkup: 0,
        gstOnMarkup: false,
        refundable: false,
        fareName: 'SkySaver',
        fareNameDescription: '',
      },
    },
  });

  const days = watch('daysOfOperation') ?? [];
  const segments = watch('segments') ?? [];
  const travelType = watch('travelType');
  const travelClass = watch('travelClass');
  const isRealTimeBooking = watch('isRealTimeBooking');
  const refundable = watch('fare.refundable');
  const gstOnMarkup = watch('fare.gstOnMarkup');

  useEffect(() => {
    if (!open) {
      reset();
      setStep(0);
    }
  }, [open, reset]);

  const invalidate = useInvalidateOnSuccess([['inventories']]);
  const create = useApiMutation<CreateInventoryRequest, PublicInventory>(
    '/api/v1/inventories',
    'POST',
    {
      onSuccess: () => {
        toast.success('Inventory created');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const goNext = async () => {
    const fieldsByStep: (keyof CreateInventoryRequest)[][] = [
      ['inventoryName', 'origin', 'destination', 'seriesStartDate', 'seriesEndDate', 'daysOfOperation', 'segments'],
      ['totalSeats', 'seatsPerDay'],
      ['fare'],
    ];
    const ok = await trigger(fieldsByStep[step] as never);
    if (!ok) return;
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  const toggleDay = (day: number) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
    setValue('daysOfOperation', next.sort(), { shouldValidate: true });
  };

  const addSegment = () => {
    setValue('segments', [
      ...segments,
      {
        flightNumber: '',
        airline: { code: '' },
        origin: { code: '' },
        destination: { code: '' },
        departureTime: '00:00',
        arrivalTime: '00:00',
        duration: 60,
        stopOver: 0,
        nextDayArrival: false,
        dayChange: false,
      },
    ]);
  };

  const removeSegment = (idx: number) => {
    if (segments.length <= 1) return;
    setValue(
      'segments',
      segments.filter((_, i) => i !== idx),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[680px]">
        <DialogHeader>
          <DialogTitle>New inventory</DialogTitle>
          <ol className="mt-3 flex items-center gap-2 text-xs">
            {STEPS.map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px]',
                    i === step
                      ? 'border-accent bg-accent text-white'
                      : i < step
                        ? 'border-success bg-success/10 text-success'
                        : 'border-border bg-surface-2 text-ink-3',
                  )}
                >
                  {i + 1}
                </span>
                <span className={cn(i === step ? 'text-ink-1' : 'text-ink-3')}>{label}</span>
                {i < STEPS.length - 1 ? <span className="text-ink-3">·</span> : null}
              </li>
            ))}
          </ol>
        </DialogHeader>

        <form onSubmit={handleSubmit((v) => create.mutate(v))} className="flex flex-1 flex-col">
          <DialogBody className="space-y-5">
            {step === 0 ? (
              <>
                <FormField
                  id="inventoryName"
                  label="Inventory name"
                  required
                  error={errors.inventoryName?.message}
                >
                  <Input
                    id="inventoryName"
                    placeholder="BOM-DEL morning Q4 series"
                    {...register('inventoryName')}
                  />
                </FormField>

                <div className="grid grid-cols-2 gap-3">
                  <FormField id="origin" label="Origin (IATA)" required error={errors.origin?.code?.message}>
                    <Input
                      id="origin"
                      placeholder="BOM"
                      maxLength={3}
                      className="font-mono uppercase"
                      {...register('origin.code', {
                        setValueAs: (v) => (v ? String(v).toUpperCase() : ''),
                      })}
                    />
                  </FormField>
                  <FormField
                    id="destination"
                    label="Destination (IATA)"
                    required
                    error={errors.destination?.code?.message}
                  >
                    <Input
                      id="destination"
                      placeholder="DEL"
                      maxLength={3}
                      className="font-mono uppercase"
                      {...register('destination.code', {
                        setValueAs: (v) => (v ? String(v).toUpperCase() : ''),
                      })}
                    />
                  </FormField>
                  <FormField id="travelType" label="Travel type">
                    <Select
                      value={travelType}
                      onValueChange={(v) => setValue('travelType', v as CreateInventoryRequest['travelType'])}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRAVEL_TYPE.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField id="travelClass" label="Class">
                    <Select
                      value={travelClass}
                      onValueChange={(v) =>
                        setValue('travelClass', v as CreateInventoryRequest['travelClass'])
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRAVEL_CLASS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField
                    id="seriesStartDate"
                    label="Series starts"
                    required
                    error={errors.seriesStartDate?.message}
                  >
                    <Input id="seriesStartDate" type="date" {...register('seriesStartDate')} />
                  </FormField>
                  <FormField
                    id="seriesEndDate"
                    label="Series ends"
                    required
                    error={errors.seriesEndDate?.message}
                  >
                    <Input id="seriesEndDate" type="date" {...register('seriesEndDate')} />
                  </FormField>
                </div>

                <FormField label="Days of operation" required error={errors.daysOfOperation?.message}>
                  <div className="flex flex-wrap gap-2">
                    {DAY_LABELS.map((label, i) => {
                      const active = days.includes(i);
                      return (
                        <button
                          type="button"
                          key={label}
                          onClick={() => toggleDay(i)}
                          className={cn(
                            'rounded-md border px-3 py-1.5 text-xs font-medium font-mono transition',
                            active
                              ? 'border-accent bg-accent-soft text-accent'
                              : 'border-border bg-surface-2 text-ink-2 hover:bg-surface-1',
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </FormField>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-ink-2">Segments</h3>
                    <Button type="button" size="sm" variant="ghost" onClick={addSegment}>
                      <Plus className="h-3.5 w-3.5" /> Add leg
                    </Button>
                  </div>
                  {segments.map((_, idx) => (
                    <div key={idx} className="rounded-md border bg-surface-2 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-ink-3">Leg {idx + 1}</p>
                        {segments.length > 1 ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => removeSegment(idx)}
                            aria-label="Remove leg"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <FormField label="Flight #" id={`fn-${idx}`}>
                          <Input
                            id={`fn-${idx}`}
                            placeholder="6E 5023"
                            {...register(`segments.${idx}.flightNumber` as const)}
                          />
                        </FormField>
                        <FormField label="Airline (IATA)" id={`al-${idx}`}>
                          <Input
                            id={`al-${idx}`}
                            placeholder="6E"
                            maxLength={3}
                            className="font-mono uppercase"
                            {...register(`segments.${idx}.airline.code` as const, {
                              setValueAs: (v) => (v ? String(v).toUpperCase() : ''),
                            })}
                          />
                        </FormField>
                        <FormField label="From" id={`from-${idx}`}>
                          <Input
                            id={`from-${idx}`}
                            placeholder="BOM"
                            maxLength={3}
                            className="font-mono uppercase"
                            {...register(`segments.${idx}.origin.code` as const, {
                              setValueAs: (v) => (v ? String(v).toUpperCase() : ''),
                            })}
                          />
                        </FormField>
                        <FormField label="To" id={`to-${idx}`}>
                          <Input
                            id={`to-${idx}`}
                            placeholder="DEL"
                            maxLength={3}
                            className="font-mono uppercase"
                            {...register(`segments.${idx}.destination.code` as const, {
                              setValueAs: (v) => (v ? String(v).toUpperCase() : ''),
                            })}
                          />
                        </FormField>
                        <FormField label="Departure" id={`dep-${idx}`}>
                          <Input
                            id={`dep-${idx}`}
                            type="time"
                            {...register(`segments.${idx}.departureTime` as const)}
                          />
                        </FormField>
                        <FormField label="Arrival" id={`arr-${idx}`}>
                          <Input
                            id={`arr-${idx}`}
                            type="time"
                            {...register(`segments.${idx}.arrivalTime` as const)}
                          />
                        </FormField>
                        <FormField label="Duration (min)" id={`dur-${idx}`}>
                          <Input
                            id={`dur-${idx}`}
                            type="number"
                            min="1"
                            {...register(`segments.${idx}.duration` as const, { valueAsNumber: true })}
                          />
                        </FormField>
                        <FormField label="Layover after (min)" id={`stop-${idx}`}>
                          <Input
                            id={`stop-${idx}`}
                            type="number"
                            min="0"
                            {...register(`segments.${idx}.stopOver` as const, {
                              valueAsNumber: true,
                            })}
                          />
                        </FormField>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <FormField id="totalSeats" label="Total seats" required error={errors.totalSeats?.message}>
                    <Input
                      id="totalSeats"
                      type="number"
                      min="1"
                      {...register('totalSeats', { valueAsNumber: true })}
                    />
                  </FormField>
                  <FormField id="seatsPerDay" label="Seats per day" required error={errors.seatsPerDay?.message}>
                    <Input
                      id="seatsPerDay"
                      type="number"
                      min="1"
                      {...register('seatsPerDay', { valueAsNumber: true })}
                    />
                  </FormField>
                  <FormField id="closeBeforeDays" label="Close before (days)">
                    <Input
                      id="closeBeforeDays"
                      type="number"
                      min="0"
                      {...register('closeBeforeDays', { valueAsNumber: true })}
                    />
                  </FormField>
                  <FormField id="classCode" label="Class code">
                    <Input id="classCode" placeholder="Y" {...register('classCode')} />
                  </FormField>
                </div>

                <Separator />
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm text-ink-1">Real-time booking</span>
                    <span className="block text-xs text-ink-3">
                      Enable if seats are auto-confirmed via supplier API instead of manual ticketing.
                    </span>
                  </span>
                  <Switch
                    checked={isRealTimeBooking}
                    onCheckedChange={(v) => setValue('isRealTimeBooking', v)}
                  />
                </label>
                {isRealTimeBooking ? (
                  <FormField id="airlinePnr" label="Airline PNR">
                    <Input id="airlinePnr" {...register('airlinePnr')} />
                  </FormField>
                ) : null}
              </>
            ) : null}

            {step === 2 ? (
              <>
                <h3 className="text-sm font-medium text-ink-2">Fare (paise)</h3>
                <p className="text-xs text-ink-3">
                  Money is stored as paise — for ₹4,500 enter 450000.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    id="adultFare"
                    label="Adult fare (paise)"
                    required
                    error={errors.fare?.adultFare?.message}
                  >
                    <Input
                      id="adultFare"
                      type="number"
                      min="0"
                      {...register('fare.adultFare', { valueAsNumber: true })}
                    />
                  </FormField>
                  <FormField
                    id="childFare"
                    label="Child fare (paise)"
                    required
                    error={errors.fare?.childFare?.message}
                  >
                    <Input
                      id="childFare"
                      type="number"
                      min="0"
                      {...register('fare.childFare', { valueAsNumber: true })}
                    />
                  </FormField>
                  <FormField id="infantFare" label="Infant fare (paise)">
                    <Input
                      id="infantFare"
                      type="number"
                      min="0"
                      {...register('fare.infantFare', { valueAsNumber: true })}
                    />
                  </FormField>
                  <FormField id="b2bMarkup" label="B2B markup (paise)">
                    <Input
                      id="b2bMarkup"
                      type="number"
                      min="0"
                      {...register('fare.b2bMarkup', { valueAsNumber: true })}
                    />
                  </FormField>
                  <FormField id="discount" label="Discount (paise)">
                    <Input
                      id="discount"
                      type="number"
                      min="0"
                      {...register('fare.discount', { valueAsNumber: true })}
                    />
                  </FormField>
                </div>

                <Separator />

                {/* Fare branding — printed on the e-ticket. Snapshotted onto each
                    booking at booking time so re-prints stay consistent even if
                    the inventory's fare name changes later. */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-ink-2">Fare branding</h3>
                  <p className="text-xs text-ink-3">
                    Shown on the e-ticket. Industry shorthand: SkySaver (cheapest), SkyFlex
                    (refundable), SkyPrime (premium), GroupSpecial, Promo.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      id="fareName"
                      label="Fare name"
                      required
                      error={errors.fare?.fareName?.message}
                    >
                      <Input
                        id="fareName"
                        list="fareNamePresets"
                        placeholder="SkySaver"
                        maxLength={30}
                        {...register('fare.fareName')}
                      />
                      <datalist id="fareNamePresets">
                        <option value="SkySaver" />
                        <option value="SkyFlex" />
                        <option value="SkyPrime" />
                        <option value="GroupSpecial" />
                        <option value="Promo" />
                      </datalist>
                    </FormField>
                    <FormField
                      id="fareNameDescription"
                      label="One-line description (optional)"
                      error={errors.fare?.fareNameDescription?.message}
                    >
                      <Input
                        id="fareNameDescription"
                        placeholder="Refundable up to 24h before departure"
                        maxLength={80}
                        {...register('fare.fareNameDescription')}
                      />
                    </FormField>
                  </div>
                </div>

                <Separator />
                <div className="space-y-3">
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-sm text-ink-1">Refundable</span>
                    <Switch checked={refundable} onCheckedChange={(v) => setValue('fare.refundable', v)} />
                  </label>
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-sm text-ink-1">GST on markup only</span>
                    <Switch checked={gstOnMarkup} onCheckedChange={(v) => setValue('fare.gstOnMarkup', v)} />
                  </label>
                </div>

                <FormField id="fareRuleDescription" label="Fare rule description">
                  <Textarea id="fareRuleDescription" rows={3} {...register('fare.fareRuleDescription')} />
                </FormField>
              </>
            ) : null}
          </DialogBody>

          <DialogFooter>
            {step > 0 ? (
              <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={goNext}>
                Continue
              </Button>
            ) : (
              <Button type="submit" disabled={isSubmitting || create.isPending}>
                {isSubmitting || create.isPending ? 'Creating…' : 'Create inventory'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}

// rupeesStringToPaise re-exported in case any callers want this in-line; kept here so the
// helper is colocated with where it's most likely needed.
export { rupeesStringToPaise };
