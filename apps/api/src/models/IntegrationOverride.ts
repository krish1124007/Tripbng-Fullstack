// IntegrationOverride — admin-driven enable/disable for code-registered
// supplier adapters (KAFILA, AIRIQ, ETRAV, TBO, SEATSELLER, ASEGO, ...).
//
// Why this exists: the adapters are otherwise gated solely by env flags
// (`KAFILA_ENABLED=true`, etc.) which require a process restart to change.
// Ops needs the ability to *temporarily* disable an integration when a
// vendor is misbehaving — without paging an engineer or editing .env.
//
// Effective state computation:
//   env-enabled  override-disabled  →  effective
//   true         false              →  ON
//   true         true               →  OFF  (override wins)
//   false        any                →  OFF  (env wins; nothing to override on)
//
// The override is a soft signal — adapters check it from a process-local
// cache that refreshes every 30s, so toggling takes effect within ~30s
// across all API instances. No hot-path Mongo reads.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const IntegrationOverrideSchema = new Schema(
  {
    /** Adapter code — MUST match the `code` returned by SupplierAdapter
     *  (KAFILA, AIRIQ, ETRAV, TBO, SEATSELLER, ASEGO, MOCK, SERIES). */
    code: { type: String, required: true, unique: true, uppercase: true, index: true },
    /** Admin's intent — disabled=true means "force off even if env is on". */
    disabled: { type: Boolean, default: false },
    /** Free-text reason captured at toggle time, surfaced in the admin UI
     *  so the next on-call knows why the switch is flipped. */
    note: { type: String, default: '' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export type IntegrationOverrideDoc = HydratedDocument<
  InferSchemaType<typeof IntegrationOverrideSchema>
> & { _id: Types.ObjectId };

export const IntegrationOverride: Model<IntegrationOverrideDoc> =
  (mongoose.models.IntegrationOverride as Model<IntegrationOverrideDoc> | undefined) ??
  model<IntegrationOverrideDoc>('IntegrationOverride', IntegrationOverrideSchema);
