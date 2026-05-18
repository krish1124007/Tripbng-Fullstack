import mongoose, { Schema, model, type InferSchemaType, type Model } from 'mongoose';

const AuditLogSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorRole: { type: String, default: null },
    impersonatorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    action: { type: String, required: true, index: true },
    resource: { type: String, required: true, index: true },
    resourceId: { type: String, default: null },

    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },

    success: { type: Boolean, default: true },
    error: { type: String, default: null },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } },
);

AuditLogSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('AuditLog records are immutable'));
  next();
});

AuditLogSchema.index({ tenantId: 1, action: 1, createdAt: -1 });
AuditLogSchema.index({ tenantId: 1, actorId: 1, createdAt: -1 });

export type AuditLogDoc = InferSchemaType<typeof AuditLogSchema>;
export const AuditLog: Model<AuditLogDoc> =
  (mongoose.models.AuditLog as Model<AuditLogDoc> | undefined) ?? model('AuditLog', AuditLogSchema);
