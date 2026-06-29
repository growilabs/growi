import type { Prisma } from '~/generated/prisma/client';
import type { IActivity } from '~/interfaces/activity';
import { normalizeAggregateRaw } from '~/server/util/prisma-raw-normalize';
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

  // aggregateRaw returns an array; the $facet stage yields exactly one document
  // as its single result element.
  const normalized = normalizeAggregateRaw(rawResult) as Array<
    Record<string, unknown>
  >;

  const facetDoc = normalized[0] ?? {};

  const rawDocs = (facetDoc.docs as unknown[]) ?? [];
  const rawTotalCount =
    (facetDoc.totalCount as Array<Record<string, unknown>>) ?? [];

  // Mirror the extraction the current Mongoose route performs:
  //   activityResults.totalCount.length > 0
  //     ? activityResults.totalCount[0].count
  //     : 0
  const totalCount =
    rawTotalCount.length > 0 ? (rawTotalCount[0].count as number) : 0;

  return {
    docs: rawDocs as IActivity[],
    totalCount,
  };
};
