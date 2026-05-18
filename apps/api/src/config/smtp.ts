// SMTP transport singleton — pooled, lazy-initialised.
//
// We instantiate the nodemailer transporter once per process and reuse the
// connection pool across every alert send. Without pooling, every email opens
// + closes a TCP+TLS connection — fine for the dozens-per-day case, painful
// once we're booking-confirming hundreds per hour.
//
// Lazy init (vs. module-load) means an environment without SMTP_HOST never
// instantiates the transport — no warnings on dev boot, no broken health
// checks.

import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env.js';
import { logger } from './logger.js';

let transporter: Transporter | null = null;

/**
 * Get the shared nodemailer transporter, building it on first use.
 * Returns null when SMTP isn't configured — callers should treat that as
 * "channel disabled, no-op cleanly".
 */
export function getSmtpTransport(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE, // true for 465, false for 587 with STARTTLS
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    // Connection-level timeouts — keep these tight so a flaky SMTP server
    // can't hang the worker queue indefinitely.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  logger.info(
    { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE },
    'smtp transport initialized',
  );
  return transporter;
}

/**
 * Verify the SMTP transport is reachable. Used by the /healthz endpoint and
 * by ops scripts. Returns true when SMTP isn't configured (nothing to verify),
 * so a dev environment without SMTP doesn't trip readiness checks.
 */
export async function verifySmtp(): Promise<boolean> {
  const t = getSmtpTransport();
  if (!t) return true;
  try {
    await t.verify();
    return true;
  } catch (err) {
    logger.warn({ err }, 'smtp verify failed');
    return false;
  }
}

/** For graceful shutdown — close the pool so the process can exit cleanly. */
export async function closeSmtp(): Promise<void> {
  if (transporter) {
    transporter.close();
    transporter = null;
  }
}
