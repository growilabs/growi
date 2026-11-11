import type { Prisma } from '~/generated/prisma/client';
import {
  ActivityLogActions,
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
