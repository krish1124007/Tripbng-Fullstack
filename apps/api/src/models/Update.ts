// "What's new" updates — admin-authored operational announcements that
// surface on the agency dashboard's UpdatesFeed.
//
// Per-tenant. Filtering by (tenantId, active, publishedAt, expiresAt) is
// the hot read path so we keep a compound index on those four columns.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import { UPDATE_ICON, UPDATE_TONE } from '@tripbng/shared';

const UpdateSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    tag: { type: String, default: 'New', trim: true },
    tone: { type: String, enum: UPDATE_TONE, default: 'accent' },
    icon: { type: String, enum: UPDATE_ICON, default: 'Sparkles' },

    /** Optional click-through URL — opens when the row is tapped. */
    href: { type: String, default: null },

    /** Lower priority floats to the top. Defaults to 100 so manual
     *  high-priority items can sit at 10 and oldest auto-archive at 1000. */
    priority: { type: Number, default: 100, index: true },

    /** When the row becomes visible to non-admins. */
    publishedAt: { type: Date, default: () => new Date(), index: true },

    /** When the row should auto-hide. Null = never. */
    expiresAt: { type: Date, default: null, index: true },

    /** Soft visibility toggle — admins can hide without deleting. */
    active: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Hot read path — dashboard fetch filters (tenantId, active=true, now in window).
UpdateSchema.index({ tenantId: 1, active: 1, publishedAt: -1 });

export type UpdateDoc = HydratedDocument<InferSchemaType<typeof UpdateSchema>> & {
  _id: Types.ObjectId;
};
export const UpdateModel: Model<UpdateDoc> =
  (mongoose.models.Update as Model<UpdateDoc> | undefined) ??
  model<UpdateDoc>('Update', UpdateSchema);
