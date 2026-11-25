import {
  Counter,
  collectDefaultMetrics,
  Gauge,
  Histogram,
  Registry,
} from '@prometheus-io/client';

import type { ConcurrencySlots } from './concurrency-slots';
import { EXTRACT_RESULTS, type ExtractResult } from './error-table';
import type { Endpoint } from './request-target';

export interface ServiceMetrics {
  countResponse(endpoint: Endpoint, status: number): void;
  recordExtract(result: ExtractResult, durationSeconds: number): void;
  /** The text exposition of every metric, read now. */
  render(): Promise<{ readonly body: string; readonly contentType: string }>;
}

const DURATION_BUCKETS_S = [
  0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 40, 60, 80,
];

// The default collectors start timers and observers that are never stopped,
// and they describe the process, not an app: one set per process, shared by
// every app's exposition.
let processRegistry: Registry | undefined;
const processMetrics = (): Registry => {
  if (processRegistry === undefined) {
    processRegistry = new Registry();
    collectDefaultMetrics({ register: processRegistry });
  }
  return processRegistry;
};

export const createServiceMetrics = (
  slots: ConcurrencySlots,
): ServiceMetrics => {
  const registry = new Registry();
  const registers = [registry];
  new Gauge({
    name: 'attachment_extractor_slots_in_use',
    help: 'Concurrency slots POST /extract holds now.',
    registers,
    collect() {
      this.set(slots.inUse());
    },
  });
  new Gauge({
    name: 'attachment_extractor_slots_max',
    help: 'MAX_CONCURRENCY as configured.',
    registers,
  }).set(slots.capacity);
  const responses = new Counter({
    name: 'attachment_extractor_http_responses_total',
    help: 'Answers the HTTP layer produced, by endpoint and status.',
    labelNames: ['endpoint', 'status'] as const,
    registers,
  });
  const results = new Counter({
    name: 'attachment_extractor_extract_results_total',
    help: 'POST /extract requests, by the result of their log line.',
    labelNames: ['result'] as const,
    registers,
  });
  const durations = new Histogram({
    name: 'attachment_extractor_extract_duration_seconds',
    help: 'POST /extract duration as on its log line, by result.',
    labelNames: ['result'] as const,
    buckets: DURATION_BUCKETS_S,
    registers,
  });
  for (const result of EXTRACT_RESULTS) {
    results.inc({ result }, 0);
    durations.zero({ result });
  }
  const exposed = Registry.merge([processMetrics(), registry]);
  return {
    countResponse: (endpoint, status) =>
      responses.inc({ endpoint, status: String(status) }),
    recordExtract: (result, durationSeconds) => {
      results.inc({ result });
      durations.observe({ result }, durationSeconds);
    },
    render: async () => ({
      body: await exposed.metrics(),
      contentType: exposed.contentType,
    }),
  };
};
