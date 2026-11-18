import { resolveEffectiveCatalog } from '~/features/mastra/server/services/ai-sdk-modules/effective-model-catalog';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { AiUsageReport } from '../../interfaces/ai-usage-report';

export const buildAiUsageReport = async (
  sinces: readonly Date[],
): Promise<AiUsageReport> => {
  const [sums, catalog] = await Promise.all([
    prisma.aiusagelogs.sumUsageSince(sinces),
    resolveEffectiveCatalog(),
  ]);
  const growiAppIdForCloud = configManager.getConfig('app:growiAppIdForCloud');

  // Fields are picked one by one so nothing else carried by the sources can leak into the public response.
  return {
    ...(growiAppIdForCloud != null ? { growiAppIdForCloud } : {}),
    windows: sums.map((sum) => ({
      since: sum.since.toISOString(),
      weightedUnits: sum.weightedUnits,
      unweightedTokens: sum.unweightedTokens,
    })),
    catalog: {
      source: catalog.source,
      contentFetchedAt: catalog.contentFetchedAt.toISOString(),
    },
  };
};
