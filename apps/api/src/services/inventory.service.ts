import {
  AppError,
  CODE_PREFIX,
  type CreateInventoryRequest,
  type UpdateInventoryRequest,
} from '@tripbng/shared';
import { Inventory, type InventoryDoc } from '../models/Inventory.js';
import { nextCode } from '../utils/codes.js';

export async function createInventory(
  tenantId: string,
  input: CreateInventoryRequest,
  createdBy?: string,
): Promise<InventoryDoc> {
  const inventoryCode = await nextCode(CODE_PREFIX.INVENTORY);

  // Fare branding lives under `input.fare.*` in the request shape (Zod
  // grouping), but the Inventory model stores it as top-level fields so the
  // booking service can pluck it cheaply via `.select('fareName ...')`.
  // Flatten here at the create boundary; subdoc keeps the rest of the
  // money fields nested.
  const { fareName, fareNameDescription, ...fareRest } = input.fare;

  return Inventory.create({
    tenantId,
    inventoryCode,
    inventoryName: input.inventoryName,
    fareName,
    fareNameDescription: fareNameDescription ?? '',
    status: input.status,
    travelType: input.travelType,
    travelClass: input.travelClass,
    origin: {
      code: input.origin.code,
      name: input.origin.name ?? null,
      country: input.origin.country ?? null,
    },
    destination: {
      code: input.destination.code,
      name: input.destination.name ?? null,
      country: input.destination.country ?? null,
    },
    seriesStartDate: input.seriesStartDate,
    seriesEndDate: input.seriesEndDate,
    scheduleFrom: input.scheduleFrom ?? null,
    scheduleTo: input.scheduleTo ?? null,
    daysOfOperation: input.daysOfOperation,
    totalSeats: input.totalSeats,
    seatsPerDay: input.seatsPerDay,
    seatsRemaining: input.totalSeats,
    closeBeforeDays: input.closeBeforeDays,
    classCode: input.classCode ?? null,
    isRealTimeBooking: input.isRealTimeBooking,
    airlinePnr: input.airlinePnr ?? null,
    classDescription: input.classDescription ?? null,
    segments: input.segments,
    fare: fareRest,
    baggage: input.baggage ?? undefined,
    bucketPricing: input.bucketPricing ?? [],
    supplierId: input.supplierId ?? null,
    policyId: input.policyId ?? null,
    fareRuleId: input.fareRuleId ?? null,
    createdBy: createdBy ?? null,
  });
}

export async function updateInventory(
  inventoryId: string,
  input: UpdateInventoryRequest,
  updatedBy?: string,
): Promise<InventoryDoc> {
  const inv = await Inventory.findById(inventoryId);
  if (!inv) throw new AppError('NOT_FOUND');

  if (input.inventoryName !== undefined) inv.inventoryName = input.inventoryName;
  if (input.status !== undefined) inv.status = input.status;
  if (input.closeBeforeDays !== undefined) inv.closeBeforeDays = input.closeBeforeDays;
  if (input.policyId !== undefined) inv.policyId = input.policyId as unknown as typeof inv.policyId;
  if (input.fareRuleId !== undefined)
    inv.fareRuleId = input.fareRuleId as unknown as typeof inv.fareRuleId;
  if (input.supplierId !== undefined)
    inv.supplierId = input.supplierId as unknown as typeof inv.supplierId;
  if (input.bucketPricing !== undefined) inv.set('bucketPricing', input.bucketPricing);
  if (input.fare && inv.fare) {
    // Same flatten dance as create — fareName / fareNameDescription live at
    // the top of the Inventory doc; everything else stays in the `fare` subdoc.
    const { fareName, fareNameDescription, ...fareRest } = input.fare;
    if (fareName !== undefined) inv.fareName = fareName;
    if (fareNameDescription !== undefined) inv.fareNameDescription = fareNameDescription;
    Object.assign(inv.fare, fareRest);
    inv.markModified('fare');
  }

  if (input.totalSeats !== undefined) {
    const consumed = inv.totalSeats - inv.seatsRemaining;
    if (input.totalSeats < consumed) {
      throw new AppError('VALIDATION_ERROR', {
        reason: 'totalSeats cannot be less than already-consumed seats',
        consumed,
      });
    }
    inv.totalSeats = input.totalSeats;
    inv.seatsRemaining = input.totalSeats - consumed;
  }
  if (input.seatsPerDay !== undefined) inv.seatsPerDay = input.seatsPerDay;

  inv.updatedBy = updatedBy ? (updatedBy as unknown as typeof inv.updatedBy) : inv.updatedBy;
  await inv.save();
  return inv;
}

// cloneInventory — duplicates an inventory with a new code and DRAFT status. Useful for
// admins prepping next month's series.
export async function cloneInventory(
  tenantId: string,
  inventoryId: string,
  createdBy?: string,
): Promise<InventoryDoc> {
  const src = await Inventory.findOne({ _id: inventoryId, tenantId }).lean();
  if (!src) throw new AppError('NOT_FOUND');

  const inventoryCode = await nextCode(CODE_PREFIX.INVENTORY);
  const { _id, createdAt, updatedAt, inventoryCode: _origCode, ...rest } = src;
  void _id;
  void createdAt;
  void updatedAt;
  void _origCode;

  return Inventory.create({
    ...rest,
    tenantId,
    inventoryCode,
    inventoryName: `${src.inventoryName} (copy)`,
    status: 'DRAFT',
    seatsRemaining: src.totalSeats,
    createdBy: createdBy ?? null,
    updatedBy: null,
  });
}

export function serializeInventory(i: InventoryDoc) {
  // Mongoose required-but-nested fields aren't narrowed by inferred types — assert the
  // shape we know is true at runtime (origin/destination/fare are all `required: true`).
  const origin = i.origin!;
  const destination = i.destination!;
  return {
    id: String(i._id),
    inventoryCode: i.inventoryCode,
    inventoryName: i.inventoryName,
    status: i.status,
    travelType: i.travelType,
    travelClass: i.travelClass,
    origin: {
      code: origin.code,
      name: origin.name ?? null,
      country: origin.country ?? null,
    },
    destination: {
      code: destination.code,
      name: destination.name ?? null,
      country: destination.country ?? null,
    },
    seriesStartDate: i.seriesStartDate.toISOString(),
    seriesEndDate: i.seriesEndDate.toISOString(),
    daysOfOperation: i.daysOfOperation ?? [],
    totalSeats: i.totalSeats,
    seatsPerDay: i.seatsPerDay,
    seatsRemaining: i.seatsRemaining,
    closeBeforeDays: i.closeBeforeDays ?? 0,
    isRealTimeBooking: i.isRealTimeBooking,
    segments: i.segments ?? [],
    // Re-merge top-level fareName / fareNameDescription back under `fare` so
    // the response matches the request shape (Zod parity for round-tripping).
    fare: {
      ...(i.fare ?? {}),
      fareName: i.fareName,
      fareNameDescription: i.fareNameDescription ?? '',
    },
    baggage: i.baggage ?? null,
    bucketPricing: i.bucketPricing ?? [],
    supplierId: i.supplierId ? String(i.supplierId) : null,
    policyId: i.policyId ? String(i.policyId) : null,
    fareRuleId: i.fareRuleId ? String(i.fareRuleId) : null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}
