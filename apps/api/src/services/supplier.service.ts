import { AppError, type CreateSupplierRequest, type UpdateSupplierRequest } from '@tripbng/shared';
import { Supplier, type SupplierDoc } from '../models/Supplier.js';

export async function createSupplier(
  tenantId: string,
  input: CreateSupplierRequest,
  createdBy?: string,
): Promise<SupplierDoc> {
  const conflict = await Supplier.findOne({ tenantId, code: input.code }).lean();
  if (conflict) throw new AppError('IDEMPOTENCY_CONFLICT', { reason: 'duplicate supplier code' });

  return Supplier.create({
    tenantId,
    code: input.code,
    name: input.name,
    type: input.type,
    productTypes: input.productTypes,
    config: input.config,
    capabilities: input.capabilities ?? undefined,
    supportedAirlines: input.supportedAirlines ?? [],
    status: input.status,
    notes: input.notes ?? null,
    createdBy: createdBy ?? null,
  });
}

export async function updateSupplier(
  supplierId: string,
  input: UpdateSupplierRequest,
  updatedBy?: string,
): Promise<SupplierDoc> {
  const supplier = await Supplier.findById(supplierId).select(
    '+config.username +config.password +config.apiKey +config.agentId +config.extra',
  );
  if (!supplier) throw new AppError('NOT_FOUND');

  if (input.code !== undefined) supplier.code = input.code;
  if (input.name !== undefined) supplier.name = input.name;
  if (input.type !== undefined) supplier.type = input.type;
  if (input.productTypes !== undefined) supplier.productTypes = input.productTypes;
  if (input.capabilities !== undefined) {
    supplier.capabilities = { ...supplier.capabilities, ...input.capabilities };
  }
  if (input.supportedAirlines !== undefined) supplier.supportedAirlines = input.supportedAirlines;
  if (input.status !== undefined) supplier.status = input.status;
  if (input.notes !== undefined) supplier.notes = input.notes;
  if (input.config) {
    supplier.set('config', { ...(supplier.toObject().config ?? {}), ...input.config });
    supplier.markModified('config');
  }
  supplier.updatedBy = updatedBy
    ? (updatedBy as unknown as typeof supplier.updatedBy)
    : supplier.updatedBy;
  await supplier.save();
  return supplier;
}

export function serializeSupplier(s: SupplierDoc) {
  return {
    id: String(s._id),
    code: s.code,
    name: s.name,
    type: s.type,
    productTypes: s.productTypes ?? [],
    capabilities: s.capabilities,
    supportedAirlines: s.supportedAirlines ?? [],
    status: s.status,
    configEndpoint: s.config?.endpoint ?? '',
    notes: s.notes,
    lastHealthCheckAt: s.lastHealthCheckAt ? s.lastHealthCheckAt.toISOString() : null,
    lastHealthCheckOk: s.lastHealthCheckOk,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// Stub — Phase 4 wires real adapter test calls. Records the attempt either way.
export async function testSupplierConnection(supplierId: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) throw new AppError('NOT_FOUND');
  // Real implementation will dispatch to the matching adapter's healthCheck().
  const ok = supplier.status === 'ACTIVE' && Boolean(supplier.config?.endpoint);
  supplier.lastHealthCheckAt = new Date();
  supplier.lastHealthCheckOk = ok;
  supplier.lastHealthCheckError = ok ? null : 'no endpoint configured';
  await supplier.save();
  return {
    ok,
    message: ok ? 'Connection check passed (stub)' : 'Connection check failed: missing endpoint',
  };
}
