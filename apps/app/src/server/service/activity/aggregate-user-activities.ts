import type { Prisma } from '~/generated/prisma/client';
import {
  ActivityLogActions,
  type IActivity,
  type IUserActivityTargetPage,
  type SupportedActivityActionType,
} from '~/interfaces/activity';
import {
  assertIsArray,
  normalizeAggregateRaw,
  type RawPageFilter,
} from '~/server/util/prisma-raw-normalize';
import type { PrismaClient } from '~/utils/prisma';

import {
  buildTargetPageIdsPipeline,
  buildVisibleActivitiesPipeline,
  buildVisiblePagesQuery,
} from './build-user-activity-queries';

export type UserActivityRow = {
  _id: string;
  action: SupportedActivityActionType;
  createdAt: Date;
  target: IUserActivityTargetPage;
};

export type UserActivitiesQuery = {
  targetUserId: string;
  pageFilter: RawPageFilter;
  limit: number;
  offset: number;
};

type UserActivitiesResult = { docs: UserActivityRow[]; totalCount: number };

const emptyResult = (): UserActivitiesResult => ({ docs: [], totalCount: 0 });

function assertIsRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error(
      `aggregateUserActivities: expected an object (${context}), got ${JSON.stringify(value)}`,
    );
  }
}

function readString(doc: Record<string, unknown>, key: string): string {
  const value = doc[key];
  if (typeof value !== 'string') {
    throw new Error(
      `aggregateUserActivities: "${key}" is not a string, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

const activityLogActions: readonly string[] = Object.values(ActivityLogActions);

const isActivityLogAction = (
  value: string,
): value is SupportedActivityActionType => activityLogActions.includes(value);

const findTargetPageIds = async (
  prisma: PrismaClient,
  targetUserId: string,
): Promise<string[]> => {
  const raw = await prisma.activities.aggregateRaw({
    pipeline: buildTargetPageIdsPipeline(
      targetUserId,
    ) as Prisma.InputJsonValue[],
  });
  const groups = normalizeAggregateRaw(raw);
  assertIsArray(groups, 'user-activities target page ids');

  // An activity without a target yields a group whose _id is null.
  return groups.flatMap((group) => {
    assertIsRecord(group, 'target page id group');
    return typeof group._id === 'string' ? [group._id] : [];
  });
};

const findVisiblePages = async (
  prisma: PrismaClient,
  pageIds: string[],
  pageFilter: RawPageFilter,
): Promise<Map<string, IUserActivityTargetPage>> => {
  const { filter, projection } = buildVisiblePagesQuery(pageIds, pageFilter);
  const raw = await prisma.pages.findRaw({
    filter: filter as Prisma.InputJsonObject,
    options: { projection },
  });
  const pages = normalizeAggregateRaw(raw);
  assertIsArray(pages, 'user-activities visible pages');

  return new Map(
    pages.map((page) => {
      assertIsRecord(page, 'visible page');
      const _id = readString(page, '_id');
      return [_id, { _id, path: readString(page, 'path') }];
    }),
  );
};

const toUserActivityRow = (
  doc: unknown,
  visiblePages: ReadonlyMap<string, IUserActivityTargetPage>,
): UserActivityRow => {
  assertIsRecord(doc, 'activity row');
  const { createdAt } = doc;
  const action = readString(doc, 'action');
  const target = visiblePages.get(readString(doc, 'target'));
  if (!(createdAt instanceof Date) || !isActivityLogAction(action)) {
    throw new Error(
      `aggregateUserActivities: unexpected activity row ${JSON.stringify(doc)}`,
    );
  }
  if (target == null) {
    throw new Error(
      'aggregateUserActivities: an activity row targets a page outside the visible pages',
    );
  }
  return { _id: readString(doc, '_id'), action, createdAt, target };
};

export const aggregateUserActivities = async (
  prisma: PrismaClient,
  { targetUserId, pageFilter, limit, offset }: UserActivitiesQuery,
): Promise<UserActivitiesResult> => {
  const targetPageIds = await findTargetPageIds(prisma, targetUserId);
  if (targetPageIds.length === 0) {
    return emptyResult();
  }

  const visiblePages = await findVisiblePages(
    prisma,
    targetPageIds,
    pageFilter,
  );
  if (visiblePages.size === 0) {
    return emptyResult();
  }

  const raw = await prisma.activities.aggregateRaw({
    pipeline: buildVisibleActivitiesPipeline({
      targetUserId,
      visiblePageIds: [...visiblePages.keys()],
      limit,
      offset,
    }) as Prisma.InputJsonValue[],
  });
  const normalized = normalizeAggregateRaw(raw);
  assertIsArray(normalized, 'user-activities visible activities');

  const facetDoc = normalized[0];
  assertIsRecord(facetDoc, '$facet document');
  const { docs, totalCount } = facetDoc;
  assertIsArray(docs, 'user-activities $facet.docs');
  assertIsArray(totalCount, 'user-activities $facet.totalCount');

  // $count emits no document at all when nothing matches.
  const countDoc = totalCount[0];
  if (countDoc == null) {
    return emptyResult();
  }
  assertIsRecord(countDoc, '$facet.totalCount[0]');
  if (typeof countDoc.count !== 'number') {
    throw new Error(
      `aggregateUserActivities: $facet.totalCount[0].count is not a number, got ${JSON.stringify(countDoc.count)}`,
    );
  }

  return {
    docs: docs.map((doc) => toUserActivityRow(doc, visiblePages)),
    totalCount: countDoc.count,
  };
};

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
export const aggregateUserActivitiesLegacy = async (
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
      `aggregateUserActivitiesLegacy: expected a $facet document as the aggregateRaw result, got ${JSON.stringify(facetDoc)}`,
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
      `aggregateUserActivitiesLegacy: $facet.totalCount[0] is not an object, got ${JSON.stringify(entry)}`,
    );
  }
  const { count } = entry as Record<string, unknown>;
  if (typeof count !== 'number') {
    throw new Error(
      `aggregateUserActivitiesLegacy: $facet.totalCount[0].count is not a number, got ${JSON.stringify(count)}`,
    );
  }
  return count;
}
