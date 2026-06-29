import type { IContributionDay } from '~/features/contribution-graph/interfaces/contribution';
import type { Prisma } from '~/generated/prisma/client';
import { normalizeAggregateRaw } from '~/server/util/prisma-raw-normalize';
import type { PrismaClient } from '~/utils/prisma';

/**
 * Pure executor for the contribution-graph daily aggregation.
 *
 * Receives the fully-built aggregation pipeline from the caller (the caller owns
 * the $match / $group / $project / $sort composition — the executor owns only
 * the mechanism of running it and normalizing the result).
 *
 * The pipeline is expected to produce an array of day-bucket documents:
 *   [{ date: "YYYY-MM-DD", count: <number> }, ...]
 *
 * Returns the normalized IContributionDay[] in the exact shape the
 * activity-aggregation-service consumes.
 *
 * Design constraint (coding-style: executors take their work-set as input):
 *   The pipeline is NOT constructed here. It must be assembled by the caller
 *   and passed in as-is.
 */
export const aggregateContributions = async (
  prisma: PrismaClient,
  pipeline: Record<string, unknown>[],
): Promise<IContributionDay[]> => {
  const rawResult = await prisma.activities.aggregateRaw({
    pipeline: pipeline as Prisma.InputJsonValue[],
  });

  const normalized = normalizeAggregateRaw(rawResult) as IContributionDay[];
  return normalized;
};
