import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_PRIORITY,
} from '@tripbng/shared';

const NotificationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Optional fanout context — populated when the notification is for an entire agency.
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', default: null, index: true },
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', default: null, index: true },

    category: { type: String, enum: NOTIFICATION_CATEGORY, required: true, index: true },
    channel: { type: String, enum: NOTIFICATION_CHANNEL, default: 'IN_APP' },
    priority: { type: String, enum: NOTIFICATION_PRIORITY, default: 'NORMAL' },

    title: { type: String, required: true },
    body: { type: String, required: true },
    href: { type: String, default: null },

    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },

    // Delivery bookkeeping for non-in-app channels.
    deliveredAt: { type: Date, default: null },
    deliveryError: { type: String, default: null },
    providerRef: { type: String, default: null },

    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } },
);

NotificationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
NotificationSchema.index({ tenantId: 1, userId: 1, read: 1, createdAt: -1 });

export type NotificationDoc = HydratedDocument<InferSchemaType<typeof NotificationSchema>> & {
  _id: Types.ObjectId;
};
export const Notification: Model<NotificationDoc> =
  (mongoose.models.Notification as Model<NotificationDoc> | undefined) ??
  model<NotificationDoc>('Notification', NotificationSchema);
