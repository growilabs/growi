import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';
import {
  buildModelKey,
  type ModelKey,
  parseModelKey,
} from '~/features/mastra/interfaces/model-key';
import type { ModelPricing } from '~/features/mastra/server/services/ai-sdk-modules/build-model-catalog';
import {
  type EffectiveCatalog,
  findCatalogEntry,
  resolveEffectiveCatalog,
} from '~/features/mastra/server/services/ai-sdk-modules/effective-model-catalog';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { AiUsageFeature } from '../../interfaces/ai-usage-feature';
import {
  estimateCallCostUsd,
  TOKENS_PER_PRICE_UNIT,
} from './estimate-call-cost';
import { sumTokenUsage, type TokenUsage } from './token-usage';
import { readUsageBaseModel } from './usage-base-model';

const logger = loggerFactory(
  'growi:features:ai-usage:services:record-ai-usage',
);

export type AiUsageEntry = {
  readonly userId: string;
  readonly feature: AiUsageFeature;
  readonly modelKey: ModelKey;
  readonly calls: readonly TokenUsage[];
};

type ModelRef = { readonly provider: AiProvider; readonly modelId: string };

const lookUpPricing = (
  catalog: EffectiveCatalog | null,
  model: ModelRef,
): ModelPricing | undefined => {
  if (catalog == null) {
    return undefined;
  }
  try {
    return findCatalogEntry(catalog, model.provider, model.modelId)?.pricing;
  } catch (err) {
    logger.error(
      { model, err },
      'Failed to look up a model in the effective catalog',
    );
    return undefined;
  }
};

const readCatalog = async (): Promise<EffectiveCatalog | null> => {
  try {
    return await resolveEffectiveCatalog();
  } catch (err) {
    logger.error({ err }, 'Failed to read the effective model catalog');
    return null;
  }
};

// A partially priced total is never returned: one unknown call makes the whole sum unknown.
const estimateTotalCostUsd = (
  calls: readonly TokenUsage[],
  pricing: ModelPricing | undefined,
): number | null => {
  if (pricing == null) {
    return null;
  }
  let total = 0;
  for (const call of calls) {
    const cost = estimateCallCostUsd(call, pricing);
    if (cost == null) {
      return null;
    }
    total += cost;
  }
  return total;
};

const toWeightedUnits = (
  totalCostUsd: number | null,
  basePricing: ModelPricing | undefined,
): number | null => {
  const baseOutput = basePricing?.output;
  if (totalCostUsd == null || baseOutput == null || baseOutput <= 0) {
    return null;
  }
  return totalCostUsd / (baseOutput / TOKENS_PER_PRICE_UNIT);
};

// An unreadable base model must not lose the tokens: the record is kept with a null base model.
const readBaseModelOrNull = (entry: AiUsageEntry): ModelRef | null => {
  try {
    return readUsageBaseModel();
  } catch (err) {
    logger.error(
      {
        userId: entry.userId,
        feature: entry.feature,
        modelKey: entry.modelKey,
        err,
      },
      'Failed to read the usage base model',
    );
    return null;
  }
};

/** Never rejects. Writes nothing when `calls` is empty. */
export const recordAiUsage = async (entry: AiUsageEntry): Promise<void> => {
  if (entry.calls.length === 0) {
    return;
  }

  try {
    const model = parseModelKey(entry.modelKey);
    if (model == null) {
      logger.error(
        {
          userId: entry.userId,
          feature: entry.feature,
          modelKey: entry.modelKey,
        },
        'Cannot record AI usage for a malformed model key',
      );
      return;
    }

    const baseModel = readBaseModelOrNull(entry);
    const catalog = await readCatalog();

    const estimatedCostUsd = estimateTotalCostUsd(
      entry.calls,
      lookUpPricing(catalog, model),
    );
    const weightedUnits =
      baseModel == null
        ? null
        : toWeightedUnits(estimatedCostUsd, lookUpPricing(catalog, baseModel));

    await prisma.aiusagelogs.createLog({
      userId: entry.userId,
      feature: entry.feature,
      provider: model.provider,
      modelId: model.modelId,
      callCount: entry.calls.length,
      usage: sumTokenUsage(entry.calls),
      estimatedCostUsd,
      weightedUnits,
      baseModelKey:
        baseModel == null
          ? null
          : buildModelKey(baseModel.provider, baseModel.modelId),
    });
  } catch (err) {
    logger.error(
      {
        userId: entry.userId,
        feature: entry.feature,
        modelKey: entry.modelKey,
        err,
      },
      'Failed to record AI usage',
    );
  }
};
