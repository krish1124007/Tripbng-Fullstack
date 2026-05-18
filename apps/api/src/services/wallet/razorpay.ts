import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

// Razorpay basic-auth credentials (key id + secret) hit the REST API directly.
// Full SDK isn't required — these endpoints are simple and a focused wrapper keeps Phase 3
// dependency-light. Webhook verification uses HMAC over the raw body.
const RAZORPAY_BASE = 'https://api.razorpay.com/v1';

interface CreateOrderInput {
  amountPaise: number;
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
}

interface CreateOrderResponse {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string | null;
}

function authHeader(): string {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay not configured: missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET');
  }
  const token = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  return `Basic ${token}`;
}

export async function createRazorpayOrder(input: CreateOrderInput): Promise<CreateOrderResponse> {
  const res = await fetch(`${RAZORPAY_BASE}/orders`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: input.currency ?? 'INR',
      receipt: input.receipt,
      notes: input.notes,
    }),
  });
  const json = (await res.json()) as CreateOrderResponse | { error: { description: string } };
  if (!res.ok) {
    const msg = 'error' in json ? json.error.description : 'razorpay order create failed';
    logger.error({ status: res.status, json }, 'razorpay order failed');
    throw new Error(msg);
  }
  return json as CreateOrderResponse;
}

// Verify the payment-success signature returned to the client by Razorpay checkout.
// Signature = HMAC-SHA256(orderId + '|' + paymentId, key_secret).
export function verifyRazorpayPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  if (!env.RAZORPAY_KEY_SECRET) {
    throw new Error('RAZORPAY_KEY_SECRET not configured');
  }
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  // Constant-time compare to dodge timing oracles.
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Verify a webhook body using the configured webhook secret.
// Use against the raw request body, not the parsed JSON.
export function verifyRazorpayWebhookSignature(rawBody: string, signature: string): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export const razorpayConfigured = (): boolean =>
  Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
