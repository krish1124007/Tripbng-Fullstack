import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { PRODUCT_TYPE, SUPPLIER_MAP_STATUS, SUPPLIER_MAP_TRAVEL_TYPE } from '@tripbng/shared';

// SupplierMap — Module 3's rules-engine config. One row grants a set of
// suppliers visibility to a set of agency groups for a product type + travel
// type, optionally narrowed by airline and a travel-date window. The
// flight-search resolver (services/supplier-access) reads these as the
// "Mapping Allowed" + "Agency Authorized" layers of the 4-layer access check.
//
// Empty arrays = "no restriction on that dimension" (see the shared schema doc).
const SupplierMapSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    name: { type: String, required: true, trim: true },
    productType: { type: String, enum: PRODUCT_TYPE, default: 'FLIGHT', index: true },
    travelType: { type: String, enum: SUPPLIER_MAP_TRAVEL_TYPE, default: 'BOTH', index: true },

    // [] → applies to every supplier. Otherwise an allow-list of supplier _ids.
    supplierIds: [{ type: Schema.Types.ObjectId, ref: 'Supplier' }],
    // [] → visible to every agency group. Otherwise an allow-list.
    agencyGroupIds: [{ type: Schema.Types.ObjectId, ref: 'AgencyGroup' }],
    // [] → all airlines allowed. Otherwise an allow-list of IATA codes.
    airlineCodes: [{ type: String, uppercase: true }],

    // Inclusive travel-date window; null bounds are open-ended.
    dateStart: { type: Date, default: null },
    dateEnd: { type: Date, default: null },

    allowPendingBooking: { type: Boolean, default: false },

    priority: { type: Number, default: 100, index: true },
    status: { type: String, enum: SUPPLIER_MAP_STATUS, default: 'ACTIVE', index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// The resolver's hot query: ACTIVE rows for a tenant + product type, ordered by
// priority. travelType / agencyGroup / date are matched in-memory per request.
SupplierMapSchema.index({ tenantId: 1, productType: 1, status: 1, priority: 1 });

export type SupplierMapDoc = HydratedDocument<InferSchemaType<typeof SupplierMapSchema>> & {
  _id: Types.ObjectId;
};
export const SupplierMap: Model<SupplierMapDoc> =
  (mongoose.models.SupplierMap as Model<SupplierMapDoc> | undefined) ??
  model<SupplierMapDoc>('SupplierMap', SupplierMapSchema);
