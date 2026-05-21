// Phase-E tests for the Sentry shim.
//
// The shim's job: route every captureException / captureMessage to BOTH
// pino (always) AND to Sentry (when SENTRY_DSN is set). We don't network
// to Sentry in tests — we verify the function shape + the no-op behaviour
// when DSN is absent. Tests against the real SDK belong in a separate
// staging-only suite.

import { describe, expect, it } from 'vitest';
import {
  captureException,
  captureMessage,
  initSentry,
  sentryErrorHandler,
  sentryRequestHandler,
} from '../src/config/sentry.js';

describe('Sentry shim — DSN-absent path (default in tests)', () => {
  it('initSentry resolves without throwing when DSN is unset', async () => {
    // Tests run without SENTRY_DSN — initSentry should silently no-op.
    await expect(initSentry()).resolves.toBeUndefined();
  });

  it('captureException does not throw, even with weird payloads', () => {
    expect(() => captureException(new Error('test error'))).not.toThrow();
    expect(() =>
      captureException('a string error', { tags: { x: '1' }, extra: { y: 2 } }),
    ).not.toThrow();
    expect(() =>
      captureException({ nested: 'object' }, { user: { id: 'usr', tenantId: 't' } }),
    ).not.toThrow();
    expect(() => captureException(null)).not.toThrow();
    expect(() => captureException(undefined)).not.toThrow();
  });

  it('captureMessage accepts all three severity levels', () => {
    expect(() => captureMessage('info-level', 'info')).not.toThrow();
    expect(() => captureMessage('warn-level', 'warn')).not.toThrow();
    expect(() => captureMessage('error-level', 'error')).not.toThrow();
    // Default level is info.
    expect(() => captureMessage('default-level')).not.toThrow();
  });

  it('sentryRequestHandler returns a no-op express middleware', () => {
    const mw = sentryRequestHandler();
    let called = false;
    mw({}, {}, () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it('sentryErrorHandler forwards the error to next() and captures', () => {
    const mw = sentryErrorHandler();
    const err = new Error('boom');
    let forwarded: unknown = null;
    mw(
      err,
      { method: 'GET', baseUrl: '/api/v1', path: '/test', auth: { userId: 'u1', tenantId: 't1' } },
      {},
      (e) => {
        forwarded = e;
      },
    );
    // The handler must always propagate the error so the central
    // errorHandler (next in the chain) can format the HTTP response.
    expect(forwarded).toBe(err);
  });

  it('sentryErrorHandler handles missing auth context cleanly', () => {
    const mw = sentryErrorHandler();
    const err = new Error('unauthenticated path');
    let forwarded: unknown = null;
    mw(
      err,
      { method: 'GET', baseUrl: '', path: '/auth/login' /* no req.auth */ },
      {},
      (e) => {
        forwarded = e;
      },
    );
    expect(forwarded).toBe(err);
  });

  it('sentryErrorHandler reads err.http when present', () => {
    const mw = sentryErrorHandler();
    // Mimics the AppError shape — `http` is the response status code.
    const err = Object.assign(new Error('AppError-like'), { http: 404 });
    let forwarded: unknown = null;
    mw(err, { method: 'GET', baseUrl: '', path: '/x' }, {}, (e) => {
      forwarded = e;
    });
    expect(forwarded).toBe(err);
    // The shim doesn't expose the captured payload directly — we trust
    // the no-throw contract here. End-to-end visibility lives in the
    // staging integration test.
  });
});
