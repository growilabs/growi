import { ConfigSource } from '@growi/core/dist/interfaces';

import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';
import { parseModelKey } from '~/features/mastra/interfaces/model-key';
import {
  findCatalogEntry,
  resolveEffectiveCatalog,
} from '~/features/mastra/server/services/ai-sdk-modules/effective-model-catalog';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:features:ai-usage:services:usage-base-model',
);

export type UsageBaseModel = {
  readonly provider: AiProvider;
  readonly modelId: string;
};
/** Raw env value, so callers can tell unset from malformed. */
const readRawUsageBaseModel = (): unknown =>
  configManager.getConfig('ai:usageBaseModel', ConfigSource.env);

/** Reads ai:usageBaseModel from env only. null when unset or malformed. */
export const readUsageBaseModel = (): UsageBaseModel | null => {
  const value = readRawUsageBaseModel();
  return typeof value === 'string' ? parseModelKey(value) : null;
};

/**
 * Logs a warning when ai:usageBaseModel is malformed or names a model absent
 * from the effective catalog. Never throws and never affects recording.
 */
export const warnIfUsageBaseModelInvalid = async (): Promise<void> => {
  try {
    const raw = readRawUsageBaseModel();
    if (raw == null || raw === '') return;

    const parsed = typeof raw === 'string' ? parseModelKey(raw) : null;
    if (parsed == null) {
      logger.warn(
        `ai:usageBaseModel is not a valid "provider/modelId" key (${String(raw)}); the base model is treated as unset`,
      );
      return;
    }

    const catalog = await resolveEffectiveCatalog();
    if (findCatalogEntry(catalog, parsed.provider, parsed.modelId) == null) {
      logger.warn(
        `ai:usageBaseModel (${raw}) is not in the adopted model catalog; weighted usage is recorded as unknown`,
      );
    }
  } catch (err) {
    logger.debug('Skipped validating ai:usageBaseModel', err);
  }
};
