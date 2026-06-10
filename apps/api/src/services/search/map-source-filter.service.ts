// Map Source search filter — Phase 4 of the admin panel spec.
//
// Sits between the supplier fan-out and the pricing engine. Given the raw
// FanoutFareOptions a supplier returned, this service consults the active
// Map Source rows for the agent's tenant + agency groups and:
//
//   1. drops options whose supplier × travelType has an active Map Source
//      but the option's airline isn't in that Map Source's whitelist
//   2. rewrites `fareClass` per the maskBookingClassCodes table
//   3. drops options whose (post-mask) fareClass is in hideFareTypes
//   4. drops options whose departure falls outside restrictTravel.dateFrom/
//      dateTo or outside the intra-day [timeStartMinutes, timeEndMinutes]
//      window (Asia/Kolkata)
//
// Pass-through policy when no Map Source matches: keep the option. The intent
// is additive — admins curate which suppliers get gated by creating Map Source
// rows; unmapped suppliers are unrestricted. Flipping that default to
// fail-closed (everything blocked unless a Map Source exists) is a single
// boolean swap below but would surprise existing tenants on first deploy.

import type { FanoutFareOption } from '../../adapters/registry.js';
import { Supplier } from '../../models/Supplier.js';
import { SupplierSource, type SupplierSourceDoc } from '../../models/SupplierSource.js';
import { logger } from '../../config/logger.js';

export interface FilterContext {
  tenantId: string;
  /** The agent's agency-group ids (empty array = agency belongs to no group;
   *  in that case only Map Sources with empty agencyGroupIds match). */
  agencyGroupIds: string[];
  productType: 'FLIGHT' | 'HOTEL' | 'BUS' | 'VISA';
  /** Pulled from the request — DOMESTIC / INTERNATIONAL. A Map Source with
   *  travelType=BOTH matches either. */
  travelType: 'DOMESTIC' | 'INTERNATIONAL';
}

export interface FilterResult {
  /** The surviving options, with masks already applied. */
  options: FanoutFareOption[];
  /** Per-supplier filter-effect counters — useful for diagnostics + the
   *  search-performed analytics event. Keys are supplier codes. */
  dropped: Record<string, number>;
  /** Number of options that received a fareClass rewrite. */
  masked: number;
  /** True when at least one Map Source matched the request — i.e. filtering
   *  was actually performed. False = pass-through (legacy behaviour). */
  applied: boolean;
}

const IST_OFFSET_MIN = 330; // UTC+05:30 — codebase convention.

/**
 * Apply Map Source filters to a list of FanoutFareOptions.
 *
 * @param options — raw options from `fanoutSearch`
 * @param ctx — tenant + agency-groups + product/travel type
 */
export async function applyMapSourceFilter(
  options: FanoutFareOption[],
  ctx: FilterContext,
): Promise<FilterResult> {
  if (options.length === 0) {
    return { options: [], dropped: {}, masked: 0, applied: false };
  }

  // Resolve the supplier-code → supplier-id map up-front so per-option
  // dispatch stays in-memory. The supplier list per tenant is small (tens of
  // rows) — one query, one map.
  const supplierCodes = Array.from(new Set(options.map((o) => o.supplierCode)));
  const suppliers = await Supplier.find({
    tenantId: ctx.tenantId,
    code: { $in: supplierCodes },
  })
    .select({ _id: 1, code: 1 })
    .lean();
  const codeToSupplierId = new Map(suppliers.map((s) => [s.code, s._id.toString()]));

  // One query for all active Map Sources that could apply to this request.
  // Filter further per-option below — we need rows in JS to handle the
  // agency-group join + travelType=BOTH wildcard cleanly.
  const sources = (await SupplierSource.find({
    tenantId: ctx.tenantId,
    status: 'ACTIVE',
    productType: ctx.productType,
    supplierId: { $in: Array.from(codeToSupplierId.values()) },
    // travelType match: row is DOMESTIC|INTERNATIONAL|BOTH and the request is
    // one of the two concrete values. The "BOTH" rows always match.
    $or: [{ travelType: ctx.travelType }, { travelType: 'BOTH' }],
  }).lean()) as unknown as SupplierSourceDoc[];

  if (sources.length === 0) {
    // No Map Source for any of these suppliers — pass-through.
    return { options, dropped: {}, masked: 0, applied: false };
  }

  // Index sources by supplierId for O(1) per-option lookup.
  const sourcesBySupplier: Map<string, SupplierSourceDoc[]> = new Map();
  for (const s of sources) {
    const k = (s as unknown as { supplierId: { toString(): string } }).supplierId.toString();
    const arr = sourcesBySupplier.get(k) ?? [];
    arr.push(s);
    sourcesBySupplier.set(k, arr);
  }

  const agencyGroupSet = new Set(ctx.agencyGroupIds);
  const dropped: Record<string, number> = {};
  let masked = 0;
  let applied = false;

  const survivors: FanoutFareOption[] = [];
  for (const opt of options) {
    const supplierId = codeToSupplierId.get(opt.supplierCode);
    if (!supplierId) {
      // No supplier row for this code → unmapped → pass-through. Defensive;
      // every adapter is supposed to register its supplier first.
      survivors.push(opt);
      continue;
    }
    const candidates = sourcesBySupplier.get(supplierId) ?? [];
    // Filter to rows that match this agency's groups. An empty agencyGroupIds
    // array on the Map Source = "applies to all agencies".
    const matching = candidates.filter((s) => {
      const groups = ((s as unknown as { agencyGroupIds?: Array<{ toString(): string }> })
        .agencyGroupIds ?? []
      ).map((g) => g.toString());
      if (groups.length === 0) return true; // applies to all
      return groups.some((g) => agencyGroupSet.has(g));
    });

    if (matching.length === 0) {
      // Map Source rows exist for this supplier × productType but none cover
      // this agency. Pass-through — the same "no rule = no restriction"
      // policy. Admins who want a default-deny posture should configure an
      // explicit Map Source.
      survivors.push(opt);
      continue;
    }

    // A supplier may have multiple matching rows (e.g. Kafila Domestic +
    // Kafila International — only one will match the travelType filter; or
    // an explicit agency-group row alongside an "all groups" row). We take
    // the UNION of allowed airlines and intersect the masks/hides. The
    // intuitive admin model: "any matching rule lets the airline through";
    // for masks/hides, all matching rules apply.
    applied = true;
    const allowedAirlines = new Set<string>();
    for (const s of matching) {
      for (const c of (s as unknown as { airlineCodes?: string[] }).airlineCodes ?? []) {
        allowedAirlines.add(c.toUpperCase());
      }
    }

    const segAirline = opt.segments[0]?.airline.code?.toUpperCase();
    if (!segAirline || !allowedAirlines.has(segAirline)) {
      dropped[opt.supplierCode] = (dropped[opt.supplierCode] ?? 0) + 1;
      continue;
    }

    // Mask + hide + restrict-travel — apply UNIONed across matching rows.
    //
    // Two separate tracks now that adapters surface a real fareType:
    //   - fareClass goes through `maskBookingClassCodes` (supplier code rewrites)
    //   - fareType goes through `maskFareTypes` (agent-facing label rewrites)
    //   - hideFareTypes drops by the post-mask fareType, falling back to the
    //     post-mask fareClass when the adapter didn't surface a fareType
    //     (e.g. TBO, Series). This keeps existing configs that hid by
    //     fareBasis working unchanged.
    let workingFareClass = opt.fareClass ?? null;
    let workingFareType = opt.fareType ?? null;

    // 1a) Mask booking-class codes — rewrites fareClass. First matching rule
    //     wins (deterministic).
    for (const s of matching) {
      const masks =
        ((s as unknown as { maskBookingClassCodes?: Array<{ original: string; masked: string }> })
          .maskBookingClassCodes ?? []);
      const hit = masks.find((m) => m.original.toUpperCase() === (workingFareClass ?? '').toUpperCase());
      if (hit) {
        if (workingFareClass !== hit.masked) {
          workingFareClass = hit.masked;
          masked++;
        }
        break;
      }
    }

    // 1b) Mask fare types — rewrites fareType. First matching rule wins.
    //     Falls back to fareClass if the adapter didn't surface a fareType,
    //     keeping pre-Item-2 configs functional (admins who pasted booking
    //     classes into the fareType mask table still see their masks fire).
    if (workingFareType || workingFareClass) {
      const target = (workingFareType ?? workingFareClass ?? '').toUpperCase();
      for (const s of matching) {
        const masks =
          ((s as unknown as { maskFareTypes?: Array<{ original: string; masked: string }> })
            .maskFareTypes ?? []);
        const hit = masks.find((m) => m.original.toUpperCase() === target);
        if (hit) {
          if (workingFareType) {
            if (workingFareType !== hit.masked) {
              workingFareType = hit.masked;
              masked++;
            }
          } else {
            // Adapter didn't supply fareType — rewrite the fareClass we
            // matched against.
            if (workingFareClass !== hit.masked) {
              workingFareClass = hit.masked;
              masked++;
            }
          }
          break;
        }
      }
    }

    // 2) Hide fare types — drop when the post-mask fareType matches any
    //    hide entry across matching rows. Falls back to fareClass for
    //    adapters that don't surface a fareType. Case-insensitive.
    const hideTarget = (workingFareType ?? workingFareClass ?? '').toLowerCase();
    if (hideTarget) {
      const hides = matching.flatMap(
        (s) => (s as unknown as { hideFareTypes?: string[] }).hideFareTypes ?? [],
      );
      if (hides.some((h) => h.toLowerCase() === hideTarget)) {
        dropped[opt.supplierCode] = (dropped[opt.supplierCode] ?? 0) + 1;
        continue;
      }
    }

    // 3) Restrict travel — keep the option only if the departure falls inside
    //    ALL matching rows' windows (intersection). A row with all four
    //    restrictTravel fields null is "no restriction" and never excludes.
    const departureIso = opt.segments[0]?.departure;
    if (departureIso) {
      const departureUtc = new Date(departureIso);
      const departureIstMinutes =
        (departureUtc.getUTCHours() * 60 + departureUtc.getUTCMinutes() + IST_OFFSET_MIN) % 1440;

      let restrictDrop = false;
      for (const s of matching) {
        const rt = (s as unknown as {
          restrictTravel?: {
            dateFrom?: Date | null;
            dateTo?: Date | null;
            timeStartMinutes?: number | null;
            timeEndMinutes?: number | null;
          };
        }).restrictTravel;
        if (!rt) continue;
        if (rt.dateFrom && departureUtc < new Date(rt.dateFrom)) {
          restrictDrop = true;
          break;
        }
        if (rt.dateTo && departureUtc > new Date(rt.dateTo)) {
          restrictDrop = true;
          break;
        }
        if (
          rt.timeStartMinutes != null &&
          rt.timeEndMinutes != null &&
          // Inclusive-exclusive on start, inclusive on end — matches the
          // operator intuition "from 06:00 to 22:00 means 22:00 is the last
          // allowed slot".
          (departureIstMinutes < rt.timeStartMinutes || departureIstMinutes > rt.timeEndMinutes)
        ) {
          restrictDrop = true;
          break;
        }
      }
      if (restrictDrop) {
        dropped[opt.supplierCode] = (dropped[opt.supplierCode] ?? 0) + 1;
        continue;
      }
    }

    survivors.push({
      ...opt,
      fareClass: workingFareClass ?? undefined,
      fareType: workingFareType ?? undefined,
    });
  }

  if (applied && (Object.keys(dropped).length > 0 || masked > 0)) {
    logger.debug(
      {
        tenantId: ctx.tenantId,
        productType: ctx.productType,
        travelType: ctx.travelType,
        dropped,
        masked,
      },
      'map-source-filter applied',
    );
  }

  return { options: survivors, dropped, masked, applied };
}
