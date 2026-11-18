import { CONFIG_DEFINITIONS } from '~/server/service/config-manager/config-definition';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:features:backlinks:pacing-config');

export type PacingConfigKey =
  | 'backlinks:drainIntervalMs'
  | 'backlinks:dutyCyclePercent'
  | 'backlinks:backfillDutyCyclePercent'
  | 'backlinks:backfillMaxPagesPerSecond'
  | 'backlinks:backfillMaxBodyKiB';

// Numeric env vars go through a bare `parseInt`, so a malformed BACKLINKS_* value arrives as
// `NaN` — and it must not disable pacing silently: a NaN rest is coerced to 0 by `setTimeout`, so
// the loop would never rest at all. Zero and negative are equally unusable. The fallback is read
// from CONFIG_DEFINITIONS rather than restated, so the defaults stay single-sourced.
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

export const positiveIntOrDefault = (
  value: number,
  configKey: PacingConfigKey,
): number =>
  Number.isInteger(value) && value > 0
    ? value
    : fallbackToDefault(value, configKey);

/** A duty cycle over 100% is not expressible — 100 already means "never rest". */
export const percentOrDefault = (
  value: number,
  configKey: PacingConfigKey,
): number =>
  Number.isInteger(value) && value > 0 && value <= 100
    ? value
    : fallbackToDefault(value, configKey);
