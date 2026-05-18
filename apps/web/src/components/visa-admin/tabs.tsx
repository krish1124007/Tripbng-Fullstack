'use client';

// 11-tab editor body for the Visa-product admin form. Each tab is a small
// self-contained sub-form bound to a slice of the AdminVisaProduct state
// passed in by ProductEditor. Tabs call `update(key, value)` to write back.
//
// Reuses the generic editor parts (StringList, ChipMultiSelect, NumberInput,
// HtmlField, Section, RowCard) from holidays-admin/parts since they're product-
// agnostic. Kept in one file because all tabs are tightly coupled to the same
// DTO shape.

import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import {
  VISA_APPLICANT_TYPES,
  VISA_APPLICATION_STATES,
  VISA_DOC_FORMATS,
  VISA_ENTRY_TYPES,
  VISA_PRICE_TYPES,
  VISA_PROCESSING_MODES,
  VISA_PURPOSES,
  type VisaApplicantType,
  type VisaApplicationState,
  type VisaCancellationSlab,
  type VisaDocFormat,
  type VisaEntryType,
  type VisaFaq,
  type VisaPriceRow,
  type VisaProcessStep,
  type VisaProcessingMode,
  type VisaProductDocument,
  type VisaPurpose,
} from '@tripbng/shared';
import {
  ChipMultiSelect,
  HtmlField,
  NumberInput,
  RowCard,
  Section,
  StringList,
} from '@/components/holidays-admin/parts';
import { tempId, type TabProps } from './types';

// ────────── Static option data ──────────

const REGION_PRESETS = [
  'Asia',
  'Europe',
  'Americas',
  'Middle East',
  'Africa',
  'Oceania',
  'Schengen',
];

const NATIONALITY_PRESETS = [
  'IN',
  'NP',
  'LK',
  'BD',
  'BT',
  'AE',
  'SG',
  'GB',
  'US',
  'CA',
];

const COMMON_DOC_PRESETS: { code: string; label: string; perApplicant: boolean }[] = [
  { code: 'passport_bio', label: 'Passport bio page', perApplicant: true },
  { code: 'photo', label: 'Recent passport photograph', perApplicant: true },
  { code: 'flight_itinerary', label: 'Confirmed return flight itinerary', perApplicant: false },
  { code: 'hotel_booking', label: 'Hotel booking confirmation', perApplicant: false },
  { code: 'bank_statement', label: 'Bank statement (last 3 months)', perApplicant: true },
  { code: 'cover_letter', label: 'Cover letter from applicant', perApplicant: true },
];

// ────────── 1. Basic details ──────────

export function BasicDetailsTab({ product, update }: TabProps) {
  return (
    <div className="space-y-5">
      <Section title="Country" description="Identity of the destination country.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Country slug *" hint="Lowercase letters, digits, hyphens.">
            <Input
              value={product.countryId}
              onChange={(e) =>
                update(
                  'countryId',
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                )
              }
              placeholder="thailand"
            />
          </Field>
          <Field label="Country display name *">
            <Input
              value={product.countryName}
              onChange={(e) => update('countryName', e.target.value)}
              placeholder="Thailand"
            />
          </Field>
          <Field label="ISO-2 code *">
            <Input
              value={product.countryIso2}
              maxLength={2}
              onChange={(e) =>
                update(
                  'countryIso2',
                  e.target.value.toUpperCase().replace(/[^A-Z]/g, ''),
                )
              }
              placeholder="TH"
            />
          </Field>
          <Field label="Region">
            <Select
              value={REGION_PRESETS.includes(product.region) ? product.region : '__custom'}
              onValueChange={(v) => update('region', v === '__custom' ? product.region : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a region" />
              </SelectTrigger>
              <SelectContent>
                {REGION_PRESETS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
                <SelectItem value="__custom">— custom —</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="mt-1"
              value={product.region}
              onChange={(e) => update('region', e.target.value)}
              placeholder="Custom region label"
            />
          </Field>
        </div>
      </Section>

      <Section title="Visa identity">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Visa name *" hint="Customer-facing title — e.g. ‘30-day Tourist eVisa’.">
            <Input
              value={product.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="30-day Tourist eVisa"
            />
          </Field>
          <Field label="URL slug" hint="Auto-derived if blank.">
            <Input
              value={product.id ?? ''}
              onChange={(e) => update('id', e.target.value || undefined)}
              placeholder="thailand-30-day-tourist"
            />
          </Field>
          <Field label="Purpose *">
            <Select
              value={product.purpose}
              onValueChange={(v) => update('purpose', v as VisaPurpose)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISA_PURPOSES.map((p) => (
                  <SelectItem key={p} value={p} className="capitalize">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Processing mode *">
            <Select
              value={product.processingMode}
              onValueChange={(v) => update('processingMode', v as VisaProcessingMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISA_PROCESSING_MODES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Entry type *">
            <Select
              value={product.entryType}
              onValueChange={(v) => update('entryType', v as VisaEntryType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISA_ENTRY_TYPES.map((e) => (
                  <SelectItem key={e} value={e} className="capitalize">
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Currency" hint="3-letter ISO-4217 code.">
            <Input
              value={product.currency}
              maxLength={3}
              onChange={(e) =>
                update('currency', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))
              }
              placeholder="INR"
            />
          </Field>
        </div>
      </Section>

      <Section title="Hero & summary">
        <Field label="Banner image URL">
          <Input
            value={product.bannerImage ?? ''}
            onChange={(e) => update('bannerImage', e.target.value || undefined)}
            placeholder="https://cdn…/banner.jpg"
          />
        </Field>
        <Field label="Gallery (one URL per line)">
          <textarea
            value={product.gallery.join('\n')}
            onChange={(e) =>
              update(
                'gallery',
                e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            rows={3}
            className="w-full rounded-md border bg-surface-1 px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Field>
        <Field label="Summary (HTML)">
          <HtmlField
            value={product.summary}
            onChange={(s) => update('summary', s)}
            rows={5}
            placeholder="<p>Single-entry eVisa for tourism stays of up to 30 days.</p>"
          />
        </Field>
      </Section>
    </div>
  );
}

// ────────── 2. Validity & Stay ──────────

export function ValidityTab({ product, update }: TabProps) {
  return (
    <div className="space-y-5">
      <Section
        title="Standard processing"
        description="Days from document submission to visa decision."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Processing days *">
            <NumberInput
              value={product.processingDays}
              onChange={(n) => update('processingDays', n)}
              min={0}
              max={365}
            />
          </Field>
          <Field label="Validity days *" hint="Days the visa remains valid for entry.">
            <NumberInput
              value={product.validityDays}
              onChange={(n) => update('validityDays', n)}
              min={1}
              max={3650}
            />
          </Field>
          <Field label="Stay days *" hint="Permitted length of each stay.">
            <NumberInput
              value={product.stayDays}
              onChange={(n) => update('stayDays', n)}
              min={1}
              max={3650}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Urgent option"
        description="Toggle on to surface a faster lane with a surcharge."
      >
        <Toggle
          label="Urgent processing available"
          description="Required + surcharge fields below activate when on."
          value={product.urgentAvailable}
          onChange={(v) => update('urgentAvailable', v)}
        />
        {product.urgentAvailable ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Urgent processing days">
              <NumberInput
                value={product.urgentProcessingDays ?? 0}
                onChange={(n) => update('urgentProcessingDays', n)}
                min={0}
                max={60}
              />
            </Field>
            <Field label="Urgent surcharge (INR)">
              <NumberInput
                value={product.urgentSurchargeInr ?? 0}
                onChange={(n) => update('urgentSurchargeInr', n)}
                min={0}
              />
            </Field>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

// ────────── 3. Eligibility ──────────

export function EligibilityTab({ product, update }: TabProps) {
  const elig = product.eligibility;
  return (
    <div className="space-y-5">
      <Section
        title="Eligible nationalities"
        description="Empty = open to all. Add ISO-2 codes for the only nationalities allowed."
      >
        <ChipMultiSelect
          presets={NATIONALITY_PRESETS}
          value={elig.eligibleNationalities}
          onChange={(v) =>
            update('eligibility', {
              ...elig,
              eligibleNationalities: v,
            })
          }
          freeForm
          freeFormPlaceholder="2-letter ISO"
          uppercase
        />
      </Section>

      <Section title="Age limits">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Min age (years)" hint="Leave 0 if no minimum.">
            <NumberInput
              value={elig.minAgeYears ?? 0}
              onChange={(n) =>
                update('eligibility', {
                  ...elig,
                  minAgeYears: n > 0 ? n : undefined,
                })
              }
              min={0}
              max={120}
            />
          </Field>
          <Field label="Max age (years)" hint="Leave 0 if no maximum.">
            <NumberInput
              value={elig.maxAgeYears ?? 0}
              onChange={(n) =>
                update('eligibility', {
                  ...elig,
                  maxAgeYears: n > 0 ? n : undefined,
                })
              }
              min={0}
              max={120}
            />
          </Field>
        </div>
      </Section>

      <Section title="Other requirements">
        <Toggle
          label="Requires prior visa history"
          description="E.g. Schengen, US, UK visa improves issuance odds."
          value={elig.requiresPriorVisa}
          onChange={(v) => update('eligibility', { ...elig, requiresPriorVisa: v })}
        />
        <Field label="Editorial success note (HTML)">
          <HtmlField
            value={elig.successNote ?? ''}
            onChange={(s) =>
              update('eligibility', {
                ...elig,
                successNote: s || undefined,
              })
            }
            rows={3}
            placeholder="<p>Indian passport holders with a valid Schengen / US visa see faster issuance.</p>"
          />
        </Field>
      </Section>
    </div>
  );
}

// ────────── 4. Documents ──────────

export function DocumentsTab({ product, update }: TabProps) {
  const list = product.documents;

  const setList = (next: VisaProductDocument[]) => update('documents', next);

  const addQuick = (preset: { code: string; label: string; perApplicant: boolean }) => {
    if (list.some((d) => d.code === preset.code)) return; // dedupe
    setList([
      ...list,
      {
        id: tempId('doc'),
        code: preset.code,
        label: preset.label,
        description: '',
        perApplicant: preset.perApplicant,
        formats: ['pdf', 'jpg'],
        maxSizeBytes: 5 * 1024 * 1024,
        required: true,
        applicantTypes: ['ADT', 'CHD', 'INF'],
      },
    ]);
  };

  const addCustom = () => {
    setList([
      ...list,
      {
        id: tempId('doc'),
        code: `custom_${list.length + 1}`,
        label: '',
        description: '',
        perApplicant: true,
        formats: ['pdf'],
        maxSizeBytes: 5 * 1024 * 1024,
        required: true,
        applicantTypes: ['ADT'],
      },
    ]);
  };

  const updateAt = (i: number, patch: Partial<VisaProductDocument>) =>
    setList(list.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const removeAt = (i: number) => setList(list.filter((_, idx) => idx !== i));

  return (
    <Section
      title="Document checklist"
      description="What the customer must upload per applicant."
      action={
        <Button type="button" onClick={addCustom} variant="secondary" size="sm">
          <Plus className="h-3.5 w-3.5" /> Custom row
        </Button>
      }
    >
      {/* Quick-add chips for the standard kit */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
          Quick add
        </p>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_DOC_PRESETS.map((p) => {
            const added = list.some((d) => d.code === p.code);
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => addQuick(p)}
                disabled={added}
                className={`inline-flex h-7 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  added
                    ? 'border-success/40 bg-success-soft text-success'
                    : 'border-strong text-ink-2 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700'
                }`}
              >
                <Plus className="h-3 w-3" />
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyHint>Click a quick-add chip above or "Custom row" to start.</EmptyHint>
      ) : (
        <div className="space-y-3">
          {list.map((d, i) => (
            <RowCard key={d.id ?? i} index={i} onRemove={() => removeAt(i)}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Code *" hint="Machine code, lowercase + underscores.">
                  <Input
                    value={d.code}
                    onChange={(e) =>
                      updateAt(i, {
                        code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                      })
                    }
                  />
                </Field>
                <Field label="Label *" hint="Customer-facing display.">
                  <Input
                    value={d.label}
                    onChange={(e) => updateAt(i, { label: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Description / instructions (optional)">
                <HtmlField
                  value={d.description ?? ''}
                  onChange={(s) => updateAt(i, { description: s || undefined })}
                  rows={2}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Toggle
                  label="Per applicant"
                  description="Each applicant uploads their own."
                  value={d.perApplicant}
                  onChange={(v) => updateAt(i, { perApplicant: v })}
                />
                <Toggle
                  label="Required"
                  description="Must be uploaded to submit."
                  value={d.required}
                  onChange={(v) => updateAt(i, { required: v })}
                />
                <Field label="Max size (MB)">
                  <NumberInput
                    value={Math.round(d.maxSizeBytes / (1024 * 1024))}
                    onChange={(n) => updateAt(i, { maxSizeBytes: Math.max(1, n) * 1024 * 1024 })}
                    min={1}
                    max={50}
                  />
                </Field>
              </div>
              <Field label="Allowed formats">
                <div className="flex flex-wrap gap-1.5">
                  {VISA_DOC_FORMATS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        const has = d.formats.includes(f);
                        const next = has
                          ? d.formats.filter((x) => x !== f)
                          : [...d.formats, f];
                        if (next.length > 0) updateAt(i, { formats: next as VisaDocFormat[] });
                      }}
                      className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium uppercase transition-colors ${
                        d.formats.includes(f)
                          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                          : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Applies to applicant types">
                <div className="flex flex-wrap gap-1.5">
                  {VISA_APPLICANT_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        const has = d.applicantTypes.includes(t);
                        const next = has
                          ? d.applicantTypes.filter((x) => x !== t)
                          : [...d.applicantTypes, t];
                        if (next.length > 0)
                          updateAt(i, { applicantTypes: next as VisaApplicantType[] });
                      }}
                      className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
                        d.applicantTypes.includes(t)
                          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                          : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2'
                      }`}
                    >
                      {applicantLabel(t)}
                    </button>
                  ))}
                </div>
              </Field>
              {d.code === 'photo' ? (
                <PhotoSpecBlock
                  value={d.photoSpec}
                  onChange={(spec) => updateAt(i, { photoSpec: spec })}
                />
              ) : null}
            </RowCard>
          ))}
        </div>
      )}
    </Section>
  );
}

function PhotoSpecBlock({
  value,
  onChange,
}: {
  value: VisaProductDocument['photoSpec'];
  onChange: (spec: VisaProductDocument['photoSpec']) => void;
}) {
  const v = value ?? {};
  return (
    <div className="rounded-md border bg-surface-2/50 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
        Photo spec
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Width (px)">
          <NumberInput
            value={v.widthPx ?? 0}
            onChange={(n) => onChange({ ...v, widthPx: n > 0 ? n : undefined })}
            min={0}
            max={2000}
          />
        </Field>
        <Field label="Height (px)">
          <NumberInput
            value={v.heightPx ?? 0}
            onChange={(n) => onChange({ ...v, heightPx: n > 0 ? n : undefined })}
            min={0}
            max={2000}
          />
        </Field>
        <Field label="Background">
          <Input
            value={v.background ?? ''}
            onChange={(e) =>
              onChange({ ...v, background: e.target.value || undefined })
            }
            placeholder="white"
          />
        </Field>
      </div>
      <Field label="Notes">
        <Input
          value={v.notes ?? ''}
          onChange={(e) => onChange({ ...v, notes: e.target.value || undefined })}
          placeholder="Clear face, no glasses, ears visible."
        />
      </Field>
    </div>
  );
}

// ────────── 5. Process steps ──────────

export function ProcessStepsTab({ product, update }: TabProps) {
  const list = product.processSteps;
  const add = () =>
    update('processSteps', [
      ...list,
      {
        id: tempId('step'),
        order: list.length + 1,
        title: '',
        descriptionHtml: '',
        estimatedDays: undefined,
      },
    ]);
  const updateAt = (i: number, patch: Partial<VisaProcessStep>) =>
    update(
      'processSteps',
      list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );
  const removeAt = (i: number) =>
    update(
      'processSteps',
      list.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, order: idx + 1 })),
    );

  return (
    <Section
      title="Process steps"
      description="Numbered timeline rendered on the customer page. Order auto-resequences."
      action={
        <Button type="button" onClick={add} variant="secondary" size="sm">
          <Plus className="h-3.5 w-3.5" /> Add step
        </Button>
      }
    >
      {list.length === 0 ? (
        <EmptyHint>Add the first step to start the timeline.</EmptyHint>
      ) : (
        <div className="space-y-3">
          {list.map((s, i) => (
            <RowCard key={s.id ?? i} index={i} onRemove={() => removeAt(i)}>
              <Field label="Title *">
                <Input
                  value={s.title}
                  onChange={(e) => updateAt(i, { title: e.target.value })}
                  placeholder="Submit documents"
                />
              </Field>
              <Field label="Description (HTML)">
                <HtmlField
                  value={s.descriptionHtml ?? ''}
                  onChange={(html) => updateAt(i, { descriptionHtml: html })}
                  rows={3}
                />
              </Field>
              <Field label="Estimated days" hint="Leave 0 if not applicable.">
                <NumberInput
                  value={s.estimatedDays ?? 0}
                  onChange={(n) => updateAt(i, { estimatedDays: n > 0 ? n : undefined })}
                  min={0}
                  max={365}
                />
              </Field>
            </RowCard>
          ))}
        </div>
      )}
    </Section>
  );
}

// ────────── 6. Pricing ──────────

export function PricingTab({ product, update }: TabProps) {
  const matrix = product.priceMatrix;
  const cheapest = useMemo(() => {
    if (matrix.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    for (const r of matrix) {
      const tot = r.consulateFeeInr + r.serviceFeeInr;
      if (tot > 0 && tot < min) min = tot;
    }
    return Number.isFinite(min) ? min : null;
  }, [matrix]);

  const add = () =>
    update('priceMatrix', [
      ...matrix,
      {
        id: tempId('price'),
        priceType: 'Normal',
        fromPax: 1,
        toPax: 4,
        consulateFeeInr: product.consulateFeeInr,
        serviceFeeInr: product.serviceFeeInr,
        urgentSurchargeInr: undefined,
      },
    ]);
  const updateAt = (i: number, patch: Partial<VisaPriceRow>) =>
    update(
      'priceMatrix',
      matrix.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  const removeAt = (i: number) =>
    update(
      'priceMatrix',
      matrix.filter((_, idx) => idx !== i),
    );

  return (
    <div className="space-y-5">
      <Section title="Base fees" description="Used when no matrix row matches the pax band.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Consulate fee (INR)">
            <NumberInput
              value={product.consulateFeeInr}
              onChange={(n) => update('consulateFeeInr', n)}
              min={0}
            />
          </Field>
          <Field label="Service fee (INR)">
            <NumberInput
              value={product.serviceFeeInr}
              onChange={(n) => update('serviceFeeInr', n)}
              min={0}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Pax-band override matrix"
        description={
          cheapest != null
            ? `Cheapest matrix combo so far: ₹${cheapest.toLocaleString('en-IN')} (consulate + service).`
            : 'Add rows to override the base fees by pax band or season.'
        }
        action={
          <Button type="button" onClick={add} variant="secondary" size="sm">
            <Plus className="h-3.5 w-3.5" /> Add row
          </Button>
        }
      >
        {matrix.length === 0 ? (
          <EmptyHint>No matrix rows — base fees apply for all pax bands.</EmptyHint>
        ) : (
          <div className="space-y-3">
            {matrix.map((r, i) => (
              <RowCard key={r.id ?? i} index={i} onRemove={() => removeAt(i)}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Type">
                    <Select
                      value={r.priceType}
                      onValueChange={(v) =>
                        updateAt(i, { priceType: v as VisaPriceRow['priceType'] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VISA_PRICE_TYPES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="From pax">
                    <NumberInput
                      value={r.fromPax}
                      onChange={(n) => updateAt(i, { fromPax: n })}
                      min={1}
                      max={40}
                    />
                  </Field>
                  <Field label="To pax">
                    <NumberInput
                      value={r.toPax}
                      onChange={(n) => updateAt(i, { toPax: n })}
                      min={1}
                      max={40}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Consulate fee (INR)">
                    <NumberInput
                      value={r.consulateFeeInr}
                      onChange={(n) => updateAt(i, { consulateFeeInr: n })}
                      min={0}
                    />
                  </Field>
                  <Field label="Service fee (INR)">
                    <NumberInput
                      value={r.serviceFeeInr}
                      onChange={(n) => updateAt(i, { serviceFeeInr: n })}
                      min={0}
                    />
                  </Field>
                  <Field label="Urgent surcharge (INR)" hint="Optional row override.">
                    <NumberInput
                      value={r.urgentSurchargeInr ?? 0}
                      onChange={(n) =>
                        updateAt(i, {
                          urgentSurchargeInr: n > 0 ? n : undefined,
                        })
                      }
                      min={0}
                    />
                  </Field>
                </div>
              </RowCard>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ────────── 7–8, 10. Flat string lists ──────────

export function InclusionsTab({ product, update }: TabProps) {
  return (
    <Section title="Inclusions" description="HTML allowed — one entry per line item.">
      <StringList
        value={product.inclusions}
        onChange={(v) => update('inclusions', v)}
        placeholder="e.g. Document review by our visa desk"
      />
    </Section>
  );
}

export function ExclusionsTab({ product, update }: TabProps) {
  return (
    <Section title="Exclusions" description="HTML allowed — what's deliberately not included.">
      <StringList
        value={product.exclusions}
        onChange={(v) => update('exclusions', v)}
        placeholder="e.g. Travel insurance"
      />
    </Section>
  );
}

export function SpecialNotesTab({ product, update }: TabProps) {
  return (
    <Section
      title="Special notes"
      description="Surfaced as a warning callout on the customer page."
    >
      <StringList
        value={product.specialNotes}
        onChange={(v) => update('specialNotes', v)}
        placeholder="e.g. Yellow-fever certificate required if transiting through endemic countries."
      />
    </Section>
  );
}

// ────────── 9. FAQs ──────────

export function FaqsTab({ product, update }: TabProps) {
  const list = product.faqs;
  const add = () =>
    update('faqs', [...list, { id: tempId('faq'), question: '', answer: '' }]);
  const updateAt = (i: number, patch: Partial<VisaFaq>) =>
    update(
      'faqs',
      list.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
    );
  const removeAt = (i: number) =>
    update(
      'faqs',
      list.filter((_, idx) => idx !== i),
    );

  return (
    <Section
      title="Frequently asked questions"
      description="Q + A pairs surfaced as an accordion on the customer page."
      action={
        <Button type="button" onClick={add} variant="secondary" size="sm">
          <Plus className="h-3.5 w-3.5" /> Add FAQ
        </Button>
      }
    >
      {list.length === 0 ? (
        <EmptyHint>No FAQs yet. Add one to start the accordion.</EmptyHint>
      ) : (
        <div className="space-y-3">
          {list.map((f, i) => (
            <RowCard key={f.id ?? i} index={i} onRemove={() => removeAt(i)}>
              <Field label="Question *">
                <Input
                  value={f.question}
                  onChange={(e) => updateAt(i, { question: e.target.value })}
                />
              </Field>
              <Field label="Answer *">
                <textarea
                  value={f.answer}
                  onChange={(e) => updateAt(i, { answer: e.target.value })}
                  rows={3}
                  className="w-full rounded-md border bg-surface-1 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </Field>
            </RowCard>
          ))}
        </div>
      )}
    </Section>
  );
}

// ────────── 11. Cancellation ──────────

export function CancellationTab({ product, update }: TabProps) {
  const list = product.cancellationSchedule;

  const usedStages = new Set(list.map((s) => s.stage));
  const availableStages = VISA_APPLICATION_STATES.filter((s) => !usedStages.has(s));

  const add = () => {
    const next = (availableStages[0] ?? 'created') as VisaApplicationState;
    update('cancellationSchedule', [...list, { stage: next, chargePercent: 0 }]);
  };
  const updateAt = (i: number, patch: Partial<VisaCancellationSlab>) =>
    update(
      'cancellationSchedule',
      list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );
  const removeAt = (i: number) =>
    update(
      'cancellationSchedule',
      list.filter((_, idx) => idx !== i),
    );

  return (
    <div className="space-y-5">
      <Section
        title="Stage-based cancellation slabs"
        description="Each row pairs a workflow stage with the % charged on cancellation."
        action={
          <Button
            type="button"
            onClick={add}
            variant="secondary"
            size="sm"
            disabled={availableStages.length === 0}
          >
            <Plus className="h-3.5 w-3.5" /> Add slab
          </Button>
        }
      >
        {list.length === 0 ? (
          <EmptyHint>No slabs yet — add one for each stage that should bill the customer.</EmptyHint>
        ) : (
          <div className="space-y-3">
            {list.map((s, i) => (
              <RowCard key={i} index={i} onRemove={() => removeAt(i)}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Stage">
                    <Select
                      value={s.stage}
                      onValueChange={(v) => updateAt(i, { stage: v as VisaApplicationState })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VISA_APPLICATION_STATES.map((st) => (
                          <SelectItem key={st} value={st}>
                            {stageLabel(st)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Charge (%)">
                    <NumberInput
                      value={s.chargePercent}
                      onChange={(n) => updateAt(i, { chargePercent: n })}
                      min={0}
                      max={100}
                    />
                  </Field>
                </div>
              </RowCard>
            ))}
          </div>
        )}
      </Section>

      <Section title="Free-form cancellation policy text">
        <StringList
          value={product.cancellationPolicyText}
          onChange={(v) => update('cancellationPolicyText', v)}
          placeholder="e.g. <strong>Lodged applications</strong> cannot be withdrawn — full charge applies."
        />
      </Section>
    </div>
  );
}

// ────────── Helpers ──────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold text-ink-2">{label}</Label>
      {children}
      {hint ? <p className="text-[10px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-surface-2/30 p-3">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-600"
      />
      <div>
        <p className="text-sm font-semibold text-ink-1">{label}</p>
        <p className="text-xs text-ink-3">{description}</p>
      </div>
    </label>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed bg-surface-2/30 p-4 text-center text-xs text-ink-3">
      {children}
    </p>
  );
}

function applicantLabel(t: VisaApplicantType): string {
  if (t === 'ADT') return 'Adult';
  if (t === 'CHD') return 'Child';
  return 'Infant';
}

function stageLabel(s: VisaApplicationState): string {
  return s.replace(/_/g, ' ');
}
