import { ActivityLogActions } from '~/interfaces/activity';
import {
  type RawPageFilter,
  toRawObjectId,
} from '~/server/util/prisma-raw-normalize';

// Shared by step 1 and step 3 so both always select the same activities.
const matchUserActivities = (
  targetUserId: string,
): Record<string, unknown> => ({
  user: toRawObjectId(targetUserId),
  action: { $in: Object.values(ActivityLogActions) },
});

export const buildTargetPageIdsPipeline = (
  targetUserId: string,
): Record<string, unknown>[] => [
  { $match: matchUserActivities(targetUserId) },
  { $group: { _id: '$target' } },
];

export const buildVisiblePagesQuery = (
  pageIds: string[],
  pageFilter: RawPageFilter,
): { filter: RawPageFilter; projection: Record<string, 1> } => ({
  filter: {
    $and: [{ _id: { $in: pageIds.map(toRawObjectId) } }, pageFilter],
  },
  projection: { _id: 1, path: 1 },
});

export const buildVisibleActivitiesPipeline = ({
  targetUserId,
  visiblePageIds,
  limit,
  offset,
}: {
  targetUserId: string;
  visiblePageIds: string[];
  limit: number;
  offset: number;
}): Record<string, unknown>[] => [
  {
    $match: {
      ...matchUserActivities(targetUserId),
      target: { $in: visiblePageIds.map(toRawObjectId) },
    },
  },
  {
    $facet: {
      totalCount: [{ $count: 'count' }],
      docs: [
        // _id breaks createdAt ties so that paging has no duplicates or gaps.
        { $sort: { createdAt: -1, _id: -1 } },
        { $skip: offset },
        { $limit: limit },
        { $project: { _id: 1, action: 1, createdAt: 1, target: 1 } },
      ],
    },
  },
];
