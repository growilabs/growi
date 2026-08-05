import { CONFIG_DEFINITIONS } from '~/server/service/config-manager/config-definition';
import loggerFactory from '~/utils/logger';

import type { PageLinkUpsertQueuePacing } from './page-link-upsert-queue';

const logger = loggerFactory('growi:features:backlinks:upsert-queue-pacing');

const positiveIntOrDefault = (
  value: number,
  configKey: 'backlinks:drainIntervalMs' | 'backlinks:maxPagesPerDrain',
): number => {
  if (Number.isInteger(value) && value > 0) return value;

  const { defaultValue } = CONFIG_DEFINITIONS[configKey];
  logger.warn(
    { configKey, value, defaultValue },
    'Ignoring an unusable backlinks pacing value; falling back to the default',
  );
  return defaultValue;
};

/**
 * Validate the configured pacing budget, falling back per value to the default declared in
 * CONFIG_DEFINITIONS (read from there rather than restated, so the defaults stay single-sourced).
 *
 * Numeric env vars are parsed with a bare `parseInt` and never validated, so a malformed
 * BACKLINKS_* value reaches the queue as `NaN` — and NaN must not disable the pacing silently:
 * `batch.length >= NaN` is never true, so the drain loop would never break and one tick would
 * parse the whole queue, which is the blocking spree the queue exists to prevent. A zero or
 * negative budget is equally unusable (the queue would never drain).
 */
export const resolveUpsertQueuePacing = (configured: {
  drainIntervalMs: number;
  maxPagesPerDrain: number;
}): PageLinkUpsertQueuePacing => ({
  drainIntervalMs: positiveIntOrDefault(
    configured.drainIntervalMs,
    'backlinks:drainIntervalMs',
  ),
  maxPagesPerDrain: positiveIntOrDefault(
    configured.maxPagesPerDrain,
    'backlinks:maxPagesPerDrain',
  ),
});
