import { type CodePrefix, formatCode } from '@tripbng/shared';
import { Counter } from '../models/Counter.js';

// Atomic, monotonically increasing per-prefix sequence using Mongo findOneAndUpdate.
// Safe under concurrent writes — guaranteed unique sequences without race conditions.
export async function nextCode(prefix: CodePrefix): Promise<string> {
  const doc = await Counter.findOneAndUpdate(
    { prefix },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  ).lean();
  return formatCode(prefix, doc.seq);
}
