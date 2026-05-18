'use client';

// 11-tab editor body for the Holiday-package admin form. Each tab is a small
// self-contained sub-form bound to a slice of the AdminHolidayPackage state
// passed in by PackageEditor. Tabs call `update(key, value)` to write back.
//
// Kept in one file because the tabs are tightly coupled to the same DTO shape
// and there's nothing else in the app that imports them individually.

import { useMemo, useState } from 'react';
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
  HOLIDAY_DAY_INCLUSION_TAGS,
  HOLIDAY_MEAL_PLANS,
  HOLIDAY_PRICE_TYPES,
  type HolidayCityStop,
  type HolidayDayInclusionTag,
  type HolidayDayPlan,
  type HolidayFlightEntry,
  type HolidayHotel,
  type HolidayMealPlan,
  type HolidayPriceRow,
  type HolidaySightseeing,
} from '@tripbng/shared';
import {
  ChipMultiSelect,
  HtmlField,
  NumberInput,
  RowCard,
  Section,
  StringList,
} from './parts';
import { tempId, type TabProps } from './types';

const THEME_PRESETS = [
  'cultural',
  'beach',
  'honeymoon',
  'adventure',
  'family',
  'pilgrimage',
  'luxury',
  'wildlife',
];

const COMMON_DEPARTURE_IATAS = ['BOM', 'DEL', 'BLR', 'MAA', 'HYD', 'AMD', 'CCU', 'COK'];

const COMMON_VISA_HINTS = ['AE', 'TH', 'SG', 'JP', 'GB', 'US', 'AU', 'TR', 'VN', 'ID'];

// Quick lookup map of city.key → city for hotels/sightseeing per-city tabs.
function cityLabelByKey(pkg: TabProps['pkg']): Record<string, string> {
  return Object.fromEntries(pkg.cities.map((c) => [c.key, c.city]));
}

// ────────── 1. Basic details ──────────

export function BasicDetailsTab({ pkg, update }: TabProps) {
  return (
    <div className="space-y-5">
      <Section title="Identity" description="Title + slug + the main customer-facing destination.">
        <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
          <Field label="Product name *">
            <Input
              value={pkg.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="Vietnam Cultural & Scenic 5N"
            />
          </Field>
          <Field label="URL slug" hint="Auto-derived if blank. Letters, digits, hyphens only.">
            <Input
              value={pkg.id ?? ''}
              onChange={(e) => update('id', e.target.value || undefined)}
              placeholder="vietnam-cultural-5n"
            />
          </Field>
          <Field label="Destination *">
            <Input
              value={pkg.destination}
              onChange={(e) => update('destination', e.target.value)}
              placeholder="Vietnam"
            />
          </Field>
          <Field label="Theme label *" hint="Display string surfaced on result cards.">
            <Input
              value={pkg.themeLabel}
              onChange={(e) => update('themeLabel', e.target.value)}
              placeholder="Cultural & Scenic"
            />
          </Field>
          <Field label="Nights *">
            <NumberInput
              value={pkg.nights}
              onChange={(n) => update('nights', n)}
              min={1}
              max={60}
            />
          </Field>
          <Field label="Cover + carousel images" hint="One URL per line. First is the cover.">
            <textarea
              value={pkg.heroImages.join('\n')}
              onChange={(e) =>
                update(
                  'heroImages',
                  e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
              rows={3}
              className="w-full rounded-md border bg-surface-1 px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={`https://cdn.example.com/vietnam-cover.jpg\nhttps://cdn.example.com/vietnam-2.jpg`}
            />
          </Field>
        </div>
      </Section>

      <Section title="Themes & departures">
        <ChipMultiSelect
          label="Themes (select any that apply)"
          presets={THEME_PRESETS}
          value={pkg.themes}
          onChange={(v) => update('themes', v)}
          freeForm
          freeFormPlaceholder="Custom theme tag…"
        />
        <ChipMultiSelect
          label="Departure cities (IATA codes)"
          presets={COMMON_DEPARTURE_IATAS}
          value={pkg.departureCities}
          onChange={(v) => update('departureCities', v)}
          freeForm
          freeFormPlaceholder="3-letter IATA"
          uppercase
        />
        <ChipMultiSelect
          label="Visa hint countries (ISO-2)"
          presets={COMMON_VISA_HINTS}
          value={pkg.visaCountriesHinted}
          onChange={(v) => update('visaCountriesHinted', v)}
          freeForm
          freeFormPlaceholder="2-letter ISO"
          uppercase
        />
      </Section>

      <Section title="Flags">
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            label="Insurance bundled"
            description="Travel insurance is included in the package fare."
            value={pkg.insuranceBundled}
            onChange={(v) => update('insuranceBundled', v)}
          />
          <Toggle
            label="Flights included"
            description="International flights are part of the price."
            value={pkg.flightIncluded}
            onChange={(v) => update('flightIncluded', v)}
          />
        </div>
      </Section>
    </div>
  );
}

// ────────── 2. Cities ──────────

export function CitiesTab({ pkg, update }: TabProps) {
  const add = () => {
    const order = pkg.cities.length + 1;
    update('cities', [
      ...pkg.cities,
      { order, city: '', key: tempId(`city-${order}`), nights: 1, days: 1 },
    ]);
  };
  const updateAt = (i: number, patch: Partial<HolidayCityStop>) => {
    update(
      'cities',
      pkg.cities.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
  };
  const removeAt = (i: number) => {
    const removed = pkg.cities[i];
    if (!removed) return;
    update(
      'cities',
      pkg.cities.filter((_, idx) => idx !== i).map((c, idx) => ({ ...c, order: idx + 1 })),
    );
    // Drop hotels/sightseeing keyed to this removed city to avoid orphans.
    const hpc = { ...pkg.hotelsPerCity };
    const spc = { ...pkg.sightseeingPerCity };
    delete hpc[removed.key];
    delete spc[removed.key];
    update('hotelsPerCity', hpc);
    update('sightseeingPerCity', spc);
  };

  return (
    <Section
      title="Cities visited"
      description="Order matters — first row is day 1's arrival city."
      action={
        <Button type="button" onClick={add} variant="secondary" size="sm">
          <Plus className="h-3.5 w-3.5" /> Add city
        </Button>
      }
    >
      {pkg.cities.length === 0 ? (
        <EmptyHint>Add the first city to start building the itinerary.</EmptyHint>
      ) : (
        <div className="space-y-3">
          {pkg.cities.map((c, i) => (
            <RowCard key={`${c.key}-${i}`} index={i} onRemove={() => removeAt(i)}>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_0.6fr_0.6fr]">
                <Field label="City *">
                  <Input
                    value={c.city}
                    onChange={(e) => updateAt(i, { city: e.target.value })}
                  />
                </Field>
                <Field label="Slug key *" hint="lowercase, hyphens only">
                  <Input
                    value={c.key}
                    onChange={(e) =>
                      updateAt(i, {
                        key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                      })
                    }
                  />
                </Field>
                <Field label="Nights">
                  <NumberInput
                    value={c.nights}
                    onChange={(n) => updateAt(i, { nights: n })}
                    min={0}
                  />
                </Field>
                <Field label="Days">
                  <NumberInput
                    value={c.days}
                    onChange={(n) => updateAt(i, { days: n })}
                    min={1}
                  />
                </Field>
              </div>
            </RowCard>
          ))}
        </div>
      )}
    </Section>
  );
}

// ────────── 3. Hotels (per-city) ──────────

export function HotelsTab({ pkg, update }: TabProps) {
  const [activeCity, setActiveCity] = useState<string>(pkg.cities[0]?.key ?? '');
  const labels = cityLabelByKey(pkg);

  if (pkg.cities.length === 0) {
    return (
      <Section title="Hotels per city">
        <EmptyHint>Add cities first (Cities tab) — hotels group under each.</EmptyHint>
      </Section>
    );
  }

  const list = pkg.hotelsPerCity[activeCity] ?? [];

  const setListForActive = (next: HolidayHotel[]) => {
    update('hotelsPerCity', { ...pkg.hotelsPerCity, [activeCity]: next });
  };

  const add = () => {
    setListForActive([
      ...list,
      {
        id: tempId('hotel'),
        cityKey: activeCity,
        name: '',
        nights: 1,
        starRating: 3,
        mealPlan: 'EP',
        roomCategory: 'Standard',
        descriptionHtml: '',
        imageUrl: undefined,
      },
    ]);
  };

  const updateAt = (i: number, patch: Partial<HolidayHotel>) =>
    setListForActive(list.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));

  const removeAt = (i: number) => setListForActive(list.filter((_, idx) => idx !== i));

  return (
    <Section
      title="Hotels"
      description="Each row is one hotel within a city. Pick a city tab to add/edit its stays."
      action={
        <Button type="button" onClick={add} variant="secondary" size="sm">
          <Plus className="h-3.5 w-3.5" /> Add hotel
        </Button>
      }
    >
      <CityTabs cities={pkg.cities} active={activeCity} onChange={setActiveCity} />

      {list.length === 0 ? (
        <EmptyHint>No hotels for {labels[activeCity] ?? activeCity} yet.</EmptyHint>
      ) : (
        <div className="space-y-3">
          {list.map((h, i) => (
            <RowCard key={h.id} index={i} onRemove={() => removeAt(i)}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Hotel name *">
                  <Input
                    value={h.name}
                    onChange={(e) => updateAt(i, { name: e.target.value })}
                  />
                </Field>
                <Field label="Image URL">
                  <Input
                    value={h.imageUrl ?? ''}
                    onChange={(e) => updateAt(i, { imageUrl: e.target.value || undefined })}
                    placeholder="https://cdn…"
                  />
                </Field>
                <Field label="Nights">
                  <NumberInput
                    value={h.nights}
                    onChange={(n) => updateAt(i, { nights: n })}
                    min={0}
                  />
                </Field>
                <Field label="Stars">
                  <Select
                    value={String(h.starRating)}
                    onValueChange={(v) =>
                      updateAt(i, { starRating: Number(v) as HolidayHotel['starRating'] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <SelectItem key={s} value={String(s)}>
                          {s} ★
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Meal plan">
                  <Select
                    value={h.mealPlan}
                    onValueChange={(v) => updateAt(i, { mealPlan: v as HolidayMealPlan })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOLIDAY_MEAL_PLANS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                          {' — '}
                          {mealPlanLabel(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Room category">
                  <Input
                    value={h.roomCategory}
                    onChange={(e) => updateAt(i, { roomCategory: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Description (HTML)">
                <HtmlField
                  value={h.descriptionHtml ?? ''}
                  onChange={(s) => updateAt(i, { descriptionHtml: s })}
                />
              </Field>
            </RowCard>
          ))}
        </div>
      )}
    </Section>
  );
}

// ────────── 4. Sightseeing (per-city) ──────────

export function SightseeingTab({ pkg, update }: TabProps) {
  const [activeCity, setActiveCity] = useState<string>(pkg.cities[0]?.key ?? '');
  const labels = cityLabelByKey(pkg);

  if (pkg.cities.length === 0) {
    return (
      <Section title="Sightseeing">
        <EmptyHint>Add cities first (Cities tab) — sightseeing groups under each.</EmptyHint>
      </Section>
    );
  }

  const list = pkg.sightseeingPerCity[activeCity] ?? [];

  const setListForActive = (next: HolidaySightseeing[]) => {
    update('sightseeingPerCity', { ...pkg.sightseeingPerCity, [activeCity]: next });
  };

  const add = () => {
    setListForActive([
      ...list,
      {
        id: tempId('sight'),
        cityKey: activeCity,
        name: '',
        descriptionHtml: '',
        imageUrl: undefined,
      },
    ]);
  };

  const updateAt = (i: number, patch: Partial<HolidaySightseeing>) =>
    setListForActive(list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const removeAt = (i: number) => setListForActive(list.filter((_, idx) => idx !== i));

  return (
    <Section
      title="Sightseeing & activities"
      action={
        <Button type="button" onClick={add} variant="secondary" size="sm">
          <Plus className="h-3.5 w-3.5" /> Add activity
        </Button>
      }
    >
      <CityTabs cities={pkg.cities} active={activeCity} onChange={setActiveCity} />

      {list.length === 0 ? (
        <EmptyHint>No activities for {labels[activeCity] ?? activeCity} yet.</EmptyHint>
      ) : (
        <div className="space-y-3">
          {list.map((s, i) => (
            <RowCard key={s.id} index={i} onRemove={() => removeAt(i)}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Name *">
                  <Input
                    value={s.name}
                    onChange={(e) => updateAt(i, { name: e.target.value })}
                  />
                </Field>
                <Field label="Image URL">
                  <Input
                    value={s.imageUrl ?? ''}
                    onChange={(e) => updateAt(i, { imageUrl: e.target.value || undefined })}
                  />
                </Field>
              </div>
              <Field label="Description (HTML)">
                <HtmlField
                  value={s.descriptionHtml ?? ''}
                  onChange={(html) => updateAt(i, { descriptionHtml: html })}
                />
              </Field>
            </RowCard>
          ))}
        </div>
      )}
    </Section>
  );
}

// ────────── 5–6, 9. Flat string lists (Inclusions / Exclusions / Special Notes) ──────────

export function InclusionsTab({ pkg, update }: TabProps) {
  return (
    <Section title="Inclusions" description="HTML allowed — one entry per line item.">
      <StringList
        value={pkg.inclusions}
        onChange={(v) => update('inclusions', v)}
        placeholder="e.g. 3-star hotels with breakfast"
      />
    </Section>
  );
}

export function ExclusionsTab({ pkg, update }: TabProps) {
  return (
    <Section title="Exclusions" description="HTML allowed — what's deliberately not included.">
      <StringList
        value={pkg.exclusions}
        onChange={(v) => update('exclusions', v)}
        placeholder="e.g. International flights"
      />
    </Section>
  );
}

export function SpecialNotesTab({ pkg, update }: TabProps) {
  return (
    <Section title="Special notes" description="Surfaced as a warning callout on the customer page.">
      <StringList
        value={pkg.specialNotes}
        onChange={(v) => update('specialNotes', v)}
        placeholder="e.g. Requires yellow-fever certificate for transit through Doha."
      />
    </Section>
  );
}

// ────────── 7. Day-by-day itinerary ──────────

export function ItineraryTab({ pkg, update }: TabProps) {
  const add = () => {
    const day = pkg.dayWise.length + 1;
    update('dayWise', [...pkg.dayWise, { day, title: '', description: '', inclusions: [] }]);
  };
  const updateAt = (i: number, patch: Partial<HolidayDayPlan>) =>
    update(
      'dayWise',
      pkg.dayWise.map((d, idx) => (idx === i ? { ...d, ...patch } : d)),
    );
  const removeAt = (i: number) =>
    update(
      'dayWise',
      pkg.dayWise.filter((_, idx) => idx !== i).map((d, idx) => ({ ...d, day: idx + 1 })),
    );

  const toggleInclusion = (i: number, tag: HolidayDayInclusionTag) => {
    const d = pkg.dayWise[i];
    if (!d) return;
    const has = d.inclusions.includes(tag);
    updateAt(i, {
      inclusions: has ? d.inclusions.filter((t) => t !== tag) : [...d.inclusions, tag],
    });
  };

  return (
    <Section
      title="Day-by-day plan"
      description="One row per day. Day numbers re-sequence on add/remove."
      action={
        <Button type="button" onClick={add} variant="secondary" size="sm">
          <Plus className="h-3.5 w-3.5" /> Add day
        </Button>
      }
    >
      {pkg.dayWise.length === 0 ? (
        <EmptyHint>Add the first day to start the itinerary.</EmptyHint>
      ) : (
        <div className="space-y-3">
          {pkg.dayWise.map((d, i) => (
            <RowCard key={i} index={i} onRemove={() => removeAt(i)}>
              <Field label="Day title *">
                <Input
                  value={d.title}
                  onChange={(e) => updateAt(i, { title: e.target.value })}
                  placeholder="Arrive Hanoi"
                />
              </Field>
              <Field label="Day itinerary (HTML)">
                <HtmlField
                  value={d.description}
                  onChange={(html) => updateAt(i, { description: html })}
                  rows={3}
                />
              </Field>
              <Field label="Inclusion tags">
                <div className="flex flex-wrap gap-1.5">
                  {HOLIDAY_DAY_INCLUSION_TAGS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleInclusion(i, t)}
                      className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium capitalize transition-colors ${
                        d.inclusions.includes(t)
                          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                          : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Field>
            </RowCard>
          ))}
        </div>
      )}
    </Section>
  );
}

// ────────── 8. Flights ──────────

export function FlightsTab({ pkg, update }: TabProps) {
  const add = () =>
    update('flights', [...pkg.flights, { id: tempId('flight'), sector: '', descriptionHtml: '' }]);
  const updateAt = (i: number, patch: Partial<HolidayFlightEntry>) =>
    update(
      'flights',
      pkg.flights.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
    );
  const removeAt = (i: number) =>
    update(
      'flights',
      pkg.flights.filter((_, idx) => idx !== i),
    );

  return (
    <Section
      title="Flights"
      description="Sector strings + optional notes. Use the Inclusions toggle for the day flag."
      action={
        <Button type="button" onClick={add} variant="secondary" size="sm">
          <Plus className="h-3.5 w-3.5" /> Add flight
        </Button>
      }
    >
      {pkg.flights.length === 0 ? (
        <EmptyHint>No flights wired into this package.</EmptyHint>
      ) : (
        <div className="space-y-3">
          {pkg.flights.map((f, i) => (
            <RowCard key={f.id} index={i} onRemove={() => removeAt(i)}>
              <Field label="Sector *">
                <Input
                  value={f.sector}
                  onChange={(e) => updateAt(i, { sector: e.target.value })}
                  placeholder="BOM-DXB-BOM"
                />
              </Field>
              <Field label="Description (HTML)">
                <HtmlField
                  value={f.descriptionHtml ?? ''}
                  onChange={(html) => updateAt(i, { descriptionHtml: html })}
                  rows={3}
                />
              </Field>
            </RowCard>
          ))}
        </div>
      )}
    </Section>
  );
}

// ────────── 10. Cancellation ──────────

export function CancellationTab({ pkg, update }: TabProps) {
  const addRow = () =>
    update('cancellationSchedule', [
      ...pkg.cancellationSchedule,
      { hoursBeforeDeparture: 168, chargePercent: 25 },
    ]);
  const updateRow = (i: number, patch: Partial<{ hoursBeforeDeparture: number; chargePercent: number }>) =>
    update(
      'cancellationSchedule',
      pkg.cancellationSchedule.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );
  const removeRow = (i: number) =>
    update(
      'cancellationSchedule',
      pkg.cancellationSchedule.filter((_, idx) => idx !== i),
    );

  return (
    <div className="space-y-5">
      <Section
        title="Time-based cancellation slabs"
        description="Sorted descending by hoursBeforeDeparture (largest window first)."
        action={
          <Button type="button" onClick={addRow} variant="secondary" size="sm">
            <Plus className="h-3.5 w-3.5" /> Add slab
          </Button>
        }
      >
        {pkg.cancellationSchedule.length === 0 ? (
          <EmptyHint>No slabs yet — add one for each cancellation window.</EmptyHint>
        ) : (
          <div className="space-y-3">
            {pkg.cancellationSchedule.map((s, i) => (
              <RowCard key={i} index={i} onRemove={() => removeRow(i)}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Hours before departure">
                    <NumberInput
                      value={s.hoursBeforeDeparture}
                      onChange={(n) => updateRow(i, { hoursBeforeDeparture: n })}
                      min={0}
                    />
                  </Field>
                  <Field label="Charge (%)">
                    <NumberInput
                      value={s.chargePercent}
                      onChange={(n) => updateRow(i, { chargePercent: n })}
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
          value={pkg.cancellationPolicyText}
          onChange={(v) => update('cancellationPolicyText', v)}
          placeholder="e.g. <strong>No-shows</strong> are charged at 100% of the package value."
        />
      </Section>
    </div>
  );
}

// ────────── 11. Pricing ──────────

export function PricingTab({ pkg, update }: TabProps) {
  const cheapest = useMemo(() => deriveCheapest(pkg.priceMatrix), [pkg.priceMatrix]);

  const add = () => {
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    update('priceMatrix', [
      ...pkg.priceMatrix,
      {
        id: tempId('price'),
        fromDate: new Date(today),
        toDate: new Date(future),
        priceType: 'Normal',
        fromPax: 2,
        toPax: 6,
        rateVolume: undefined,
        singleSharingInr: 0,
        doubleSharingInr: 0,
        tripleSharingInr: 0,
        childWithBedInr: 0,
        childWithoutBedInr: 0,
      },
    ]);
  };
  const updateAt = (i: number, patch: Partial<HolidayPriceRow>) =>
    update(
      'priceMatrix',
      pkg.priceMatrix.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
  const removeAt = (i: number) =>
    update(
      'priceMatrix',
      pkg.priceMatrix.filter((_, idx) => idx !== i),
    );

  return (
    <Section
      title="Pricing matrix"
      description={
        cheapest
          ? `From ₹${cheapest.toLocaleString('en-IN')} per adult — auto-derived from the cheapest row.`
          : 'Add a row to define when, for how many pax, and at what rate.'
      }
      action={
        <Button type="button" onClick={add} variant="secondary" size="sm">
          <Plus className="h-3.5 w-3.5" /> Add row
        </Button>
      }
    >
      {pkg.priceMatrix.length === 0 ? (
        <EmptyHint>No price rows yet — agents can't book until at least one is added.</EmptyHint>
      ) : (
        <div className="space-y-3">
          {pkg.priceMatrix.map((r, i) => (
            <RowCard key={r.id} index={i} onRemove={() => removeAt(i)}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="From date">
                  <Input
                    type="date"
                    value={dateInputValue(r.fromDate)}
                    onChange={(e) => updateAt(i, { fromDate: new Date(e.target.value) })}
                  />
                </Field>
                <Field label="To date">
                  <Input
                    type="date"
                    value={dateInputValue(r.toDate)}
                    onChange={(e) => updateAt(i, { toDate: new Date(e.target.value) })}
                  />
                </Field>
                <Field label="Price type">
                  <Select
                    value={r.priceType}
                    onValueChange={(v) =>
                      updateAt(i, { priceType: v as HolidayPriceRow['priceType'] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOLIDAY_PRICE_TYPES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
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
                <Field label="Rate volume label" hint="Optional — e.g. ‘20–35 pax bulk’.">
                  <Input
                    value={r.rateVolume ?? ''}
                    onChange={(e) => updateAt(i, { rateVolume: e.target.value || undefined })}
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Single sharing (INR)">
                  <NumberInput
                    value={r.singleSharingInr}
                    onChange={(n) => updateAt(i, { singleSharingInr: n })}
                    min={0}
                  />
                </Field>
                <Field label="Double sharing (INR)">
                  <NumberInput
                    value={r.doubleSharingInr}
                    onChange={(n) => updateAt(i, { doubleSharingInr: n })}
                    min={0}
                  />
                </Field>
                <Field label="Triple sharing (INR)">
                  <NumberInput
                    value={r.tripleSharingInr}
                    onChange={(n) => updateAt(i, { tripleSharingInr: n })}
                    min={0}
                  />
                </Field>
                <Field label="Child with bed (INR)">
                  <NumberInput
                    value={r.childWithBedInr}
                    onChange={(n) => updateAt(i, { childWithBedInr: n })}
                    min={0}
                  />
                </Field>
                <Field label="Child without bed (INR)">
                  <NumberInput
                    value={r.childWithoutBedInr}
                    onChange={(n) => updateAt(i, { childWithoutBedInr: n })}
                    min={0}
                  />
                </Field>
              </div>
            </RowCard>
          ))}
        </div>
      )}
    </Section>
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

function CityTabs({
  cities,
  active,
  onChange,
}: {
  cities: HolidayCityStop[];
  active: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-md border bg-surface-2/30 p-1.5">
      {cities.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onChange(c.key)}
          className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
            active === c.key
              ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
              : 'border-transparent text-ink-2 hover:bg-surface-2'
          }`}
        >
          {c.city || c.key}
        </button>
      ))}
    </div>
  );
}

function dateInputValue(d: Date | string | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function deriveCheapest(matrix: HolidayPriceRow[]): number | null {
  let cheapest = Number.POSITIVE_INFINITY;
  for (const r of matrix) {
    for (const v of [r.singleSharingInr, r.doubleSharingInr, r.tripleSharingInr]) {
      if (v > 0 && v < cheapest) cheapest = v;
    }
  }
  return Number.isFinite(cheapest) ? cheapest : null;
}

function mealPlanLabel(m: HolidayMealPlan): string {
  if (m === 'EP') return 'European (room only)';
  if (m === 'CP') return 'Continental (room + breakfast)';
  if (m === 'MAP') return 'Modified American (B + 1 meal)';
  return 'American (all meals)';
}
