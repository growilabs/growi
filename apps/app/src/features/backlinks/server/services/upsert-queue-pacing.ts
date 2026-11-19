import { percentOrDefault, positiveIntOrDefault } from './pacing-config';
import type { PageLinkUpsertQueuePacing } from './page-link-upsert-queue';

/** Validate the configured pacing budget, falling back per value to the declared default. */
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
