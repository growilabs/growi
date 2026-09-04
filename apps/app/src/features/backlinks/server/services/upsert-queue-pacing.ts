import { CONFIG_DEFINITIONS } from '~/server/service/config-manager/config-definition';
import loggerFactory from '~/utils/logger';

import type { PageLinkUpsertQueuePacing } from './page-link-upsert-queue';

const logger = loggerFactory('growi:features:backlinks:upsert-queue-pacing');

type PacingConfigKey =
  | 'backlinks:drainIntervalMs'
  | 'backlinks:dutyCyclePercent';

const fallbackToDefault = (
  value: number,
  configKey: PacingConfigKey,
): number => {
  const { defaultValue } = CONFIG_DEFINITIONS[configKey];
  logger.warn(
    { configKey, value, defaultValue },
    'Ignoring an unusable backlinks pacing value; falling back to the default',
  );
  return defaultValue;
};

const positiveIntOrDefault = (
  value: number,
  configKey: PacingConfigKey,
): number =>
  Number.isInteger(value) && value > 0
    ? value
    : fallbackToDefault(value, configKey);

/** A duty cycle over 100% is not expressible — 100 already means "never rest". */
const percentOrDefault = (value: number, configKey: PacingConfigKey): number =>
  Number.isInteger(value) && value > 0 && value <= 100
    ? value
    : fallbackToDefault(value, configKey);

/**
 * Validate the configured pacing budget, falling back per value to the default declared in
 * CONFIG_DEFINITIONS (read from there rather than restated, so the defaults stay single-sourced).
 *
 * Numeric env vars go through a bare `parseInt`, so a malformed BACKLINKS_* value arrives as
 * `NaN` — and it must not disable pacing silently: a NaN rest is coerced to 0 by `setTimeout`, so
 * the queue would never rest at all. Zero and negative are equally unusable.
 */
export const resolveUpsertQueuePacing = (configured: {
  drainIntervalMs: number;
  dutyCyclePercent: number;
}): PageLinkUpsertQueuePacing => ({
  drainIntervalMs: positiveIntOrDefault(
    configured.drainIntervalMs,
    'backlinks:drainIntervalMs',
  ),
  dutyCyclePercent: percentOrDefault(
    configured.dutyCyclePercent,
    'backlinks:dutyCyclePercent',
  ),
});
