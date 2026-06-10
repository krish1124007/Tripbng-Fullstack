// Vitest setup file — runs once per test file before any test executes.
//
// Two concerns:
//   1. Pull in `@testing-library/jest-dom` so DOM-flavoured matchers
//      (`toBeInTheDocument`, `toHaveTextContent`, …) are available on
//      every `expect()`.
//   2. Patch JSDOM gaps that React 18 components routinely hit:
//      - `window.matchMedia` (used by Tailwind's media queries + Radix UI).
//      - `IntersectionObserver` (used by sticky toolbars + lazy-load).
//      Tests that exercise either of these patch in their own behaviour;
//      this baseline just stops the references from crashing.

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount + clear DOM between tests so leaks don't bleed between cases.
afterEach(() => {
  cleanup();
});

// matchMedia — JSDOM doesn't implement it. Tailwind queries call it on
// mount; Radix UI's Tooltip + Dialog also touch it. Returning a quiet
// "always-false" matcher is safe for unit tests where we don't care
// about responsive behaviour.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// IntersectionObserver — same story. JSDOM doesn't ship it.
if (
  typeof globalThis !== 'undefined' &&
  !(globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
) {
  class StubIntersectionObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): never[] {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: typeof StubIntersectionObserver }).IntersectionObserver =
    StubIntersectionObserver;
}

// ResizeObserver — recharts + a few Radix primitives call it on mount.
if (
  typeof globalThis !== 'undefined' &&
  !(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver
) {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver =
    StubResizeObserver;
}
