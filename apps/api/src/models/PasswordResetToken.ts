// PasswordResetToken — one row per outstanding password-reset request.
//
// Lifecycle:
//   1. /auth/forgot-password creates a row with a fresh tokenHash.
//   2. We email the *raw* token to the registered address.
//   3. /auth/reset-password matches the hash, updates the user's password,
//      and marks the row consumed.
//   4. TTL purges expired/consumed rows after 24 hours.
//
// Why store the hash, not the token? Same reason we hash passwords —
// our DB shouldn't be an attack surface. Even with full DB compromise,
// in-flight reset tokens stay safe (the attacker would still need the
// original email to learn the token).

import crypto from 'node:crypto';
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

export const PASSWORD_RESET_TTL_MIN = 30;

const PasswordResetTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** SHA-256 of the raw token. We never store the raw token itself. */
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    /** IP + user agent captured at request time — useful for the audit
     *  log entry and for users who want to confirm "is this me?". */
    requestIp: { type: String, default: null },
    requestUserAgent: { type: String, default: null },
  },
  { timestamps: true },
);

// TTL: prune rows 24h after they expire. The expiry check happens at
// reset time too, but TTL keeps the collection small without a cron job.
PasswordResetTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 },
);

export type PasswordResetTokenDoc = HydratedDocument<
  InferSchemaType<typeof PasswordResetTokenSchema>
> & { _id: Types.ObjectId };

export const PasswordResetToken: Model<PasswordResetTokenDoc> =
  (mongoose.models.PasswordResetToken as Model<PasswordResetTokenDoc> | undefined) ??
  model<PasswordResetTokenDoc>('PasswordResetToken', PasswordResetTokenSchema);

/** Generate a fresh raw token + its SHA-256 hash. The raw token is what
 *  ships in the email URL; the hash is what we persist. */
export function generatePasswordResetToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/** Hash a raw token for lookup. Same algorithm as generatePasswordResetToken. */
export function hashPasswordResetToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
