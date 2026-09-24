/**
 * AI summarize usage metrics.
 *
 * Unlike every other file in this directory (all Observable Gauges polled by
 * the OTel SDK), this is the only event-driven Counter: it is incremented
 * once per successfully generated summary.
 *
 * The Counter is intentionally NOT created at module top level. OpenTelemetry
 * may not be initialized yet when this module is first imported, and calling
 * metrics.getMeter() at that point would bind this module permanently to a
 * no-op meter (OTel API behavior), silently losing all measurements even
 * after the real SDK initializes later. Creating it inside
 * addAiSummarizeMetrics() — called from setupCustomMetrics() after SDK init —
 * avoids that trap.
 */
import { type Counter, metrics } from '@opentelemetry/api';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:opentelemetry:custom-metrics:ai-summarize-metrics',
);

let generatedCounter: Counter | undefined;

export function addAiSummarizeMetrics(): void {
  logger.info('Starting AI summarize metrics collection');

  const meter = metrics.getMeter('growi-ai-summarize-metrics', '1.0.0');

  generatedCounter = meter.createCounter('growi.ai.summarize.generated', {
    description: 'Number of AI-generated page summaries',
    unit: '1',
  });

  logger.info('AI summarize metrics collection started successfully');
}

/**
 * Increments the summary-generated counter by 1.
 *
 * Safe to call even when addAiSummarizeMetrics() has never run (i.e. OpenTelemetry
 * is disabled): the counter stays undefined and this becomes a no-op. A missing
 * metric must never cause the summarize feature itself to fail.
 *
 * Attributes are intentionally minimal: no user identifiers and no page content.
 */
export function incrementAiSummarizeGeneratedCount(): void {
  generatedCounter?.add(1, {});
}
