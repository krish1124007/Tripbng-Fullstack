import mongoose, { Schema, model, type InferSchemaType, type Model } from 'mongoose';

const CounterSchema = new Schema(
  {
    prefix: { type: String, required: true, unique: true, index: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type CounterDoc = InferSchemaType<typeof CounterSchema>;
export const Counter: Model<CounterDoc> =
  (mongoose.models.Counter as Model<CounterDoc> | undefined) ?? model('Counter', CounterSchema);
