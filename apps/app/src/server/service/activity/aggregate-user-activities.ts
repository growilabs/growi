import type { Prisma } from '~/generated/prisma/client';
import type { IActivity } from '~/interfaces/activity';
import {
  assertIsArray,
  normalizeAggregateRaw,
} from '~/server/util/prisma-raw-normalize';
import type { PrismaClient } from '~/utils/prisma';

/**
 * Pure executor for the user-activities per-user aggregation.
 *
 * Receives the fully-built aggregation pipeline from the caller (the caller owns
 * the $match / $facet / $lookup / $project composition — the executor owns only
 * the mechanism of running it and normalizing the result).
 *
 * The pipeline is expected to produce a single $facet document with two facets:
 *   - docs:       array of activity documents (with $lookup-populated user)
 *   - totalCount: [{ count: <number> }]  (from $count stage)
 *
 * Returns the normalized { docs, totalCount } in the exact shape the
 * user-activities route consumes to build its PaginateResult response.
 *
 * Design constraint (coding-style: executors take their work-set as input):
 *   The pipeline is NOT constructed here. It must be assembled by the caller
 *   and passed in as-is.
 */
export const aggregateUserActivities = async (
  prisma: PrismaClient,
  pipeline: Record<string, unknown>[],
): Promise<{ docs: IActivity[]; totalCount: number }> => {
  const rawResult = await prisma.activities.aggregateRaw({
    pipeline: pipeline as Prisma.InputJsonValue[],
  });

  // aggregateRaw returns an array; the $facet stage yields exactly one
  // document as its single result element, even when zero activities match
  // ({ docs: [], totalCount: [] }) -- a missing/wrong-shaped facet document
  // means the pipeline itself is broken, not that there is no data.
  const normalized = normalizeAggregateRaw(rawResult);
  assertIsArray(normalized, 'user-activities aggregateRaw result');

  const facetDoc = normalized[0];
  if (typeof facetDoc !== 'object' || facetDoc == null) {
    throw new Error(
      `aggregateUserActivities: expected a $facet document as the aggregateRaw result, got ${JSON.stringify(facetDoc)}`,
    );
  }

  const { docs, totalCount } = facetDoc as Record<string, unknown>;
  assertIsArray(docs, 'user-activities $facet.docs');
  assertIsArray(totalCount, 'user-activities $facet.totalCount');

  // Mirror the extraction the current Mongoose route performs:
  //   activityResults.totalCount.length > 0
  //     ? activityResults.totalCount[0].count
  //     : 0
  return {
    docs: docs as IActivity[],
    totalCount: totalCount.length > 0 ? extractCount(totalCount[0]) : 0,
  };
};

function extractCount(entry: unknown): number {
  if (typeof entry !== 'object' || entry == null) {
    throw new Error(
      `aggregateUserActivities: $facet.totalCount[0] is not an object, got ${JSON.stringify(entry)}`,
    );
  }
  const { count } = entry as Record<string, unknown>;
  if (typeof count !== 'number') {
    throw new Error(
      `aggregateUserActivities: $facet.totalCount[0].count is not a number, got ${JSON.stringify(count)}`,
    );
  }
  return count;
}
