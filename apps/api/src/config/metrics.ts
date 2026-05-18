import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

// One registry per process. Default node metrics (event loop lag, GC, heap, fd count) come
// for free; we layer business-specific counters/histograms on top so SREs can build alerts
// directly off the data plane without trawling logs.
export const registry = new Registry();
registry.setDefaultLabels({ app: 'tripbng-api' });
collectDefaultMetrics({ register: registry });

export const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests served',
  labelNames: ['method', 'route', 'status_class'],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_class'],
  // Bucket spread tuned for typical Express + Mongo workloads.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const bookingEvents = new Counter({
  name: 'booking_events_total',
  help: 'Booking lifecycle transitions (HOLD/TICKETED/CANCELLED/EXPIRED)',
  labelNames: ['status', 'flow_sub_type'],
  registers: [registry],
});

export const walletEvents = new Counter({
  name: 'wallet_events_total',
  help: 'Ledger entries posted (CREDIT/DEBIT × type)',
  labelNames: ['direction', 'type'],
  registers: [registry],
});

export const searchLatency = new Histogram({
  name: 'search_latency_seconds',
  help: 'End-to-end /search/flights latency',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8],
  labelNames: ['cache'],
  registers: [registry],
});

export const supplierAdapterLatency = new Histogram({
  name: 'supplier_adapter_latency_seconds',
  help: 'Per-adapter per-action latency for diagnostics',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8],
  labelNames: ['supplier', 'action', 'outcome'],
  registers: [registry],
});

export function statusClass(code: number): string {
  if (code < 200) return '1xx';
  if (code < 300) return '2xx';
  if (code < 400) return '3xx';
  if (code < 500) return '4xx';
  return '5xx';
}
