import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';

import type { Prisma } from '~/generated/prisma/client';
import {
  normalizeAggregateRaw,
  toRawObjectId,
} from '~/server/util/prisma-raw-normalize';
import type { prisma } from '~/utils/prisma';

import type { ViewerIdentity } from '../domain';
import { summarySelect } from './change-proposal-query-parts';
import {
  type ChangeProposalSummary,
  toChangeProposalSummary,
} from './to-change-proposal-document';

type Context = Pick<typeof prisma.changeproposals, 'aggregateRaw' | 'findMany'>;

/**
 * Prisma turns a filter on a composite list into an `$expr`, which no index
 * serves, so the ids are matched raw to use `lifecycle_1_reviewers.id_1__id_1`.
 * The ids are not told apart by kind: the caller decides the viewer's role on
 * each row it reads.
 */
const reviewQueuePipeline = (
  viewer: ViewerIdentity,
  afterId: string | null,
  take: number,
): Prisma.InputJsonValue[] => {
  const ids = [
    viewer.userId,
    ...viewer.userGroupIds,
    ...viewer.externalUserGroupIds,
  ].filter((id) => isValidObjectId(id));
  return [
    {
      $match: {
        lifecycle: 'open',
        // null also matches an entry that has no removedAt
        reviewers: {
          $elemMatch: { id: { $in: ids.map(toRawObjectId) }, removedAt: null },
        },
        ...(afterId == null ? {} : { _id: { $gt: toRawObjectId(afterId) } }),
      },
    },
    { $sort: { _id: 1 } },
    { $limit: take },
    { $project: { _id: 1 } },
  ];
};

const readIds = (raw: unknown): string[] => {
  const rows = normalizeAggregateRaw(raw);
  if (!Array.isArray(rows)) {
    throw new Error('review queue aggregateRaw did not return an array');
  }
  return rows.map((row: unknown) => {
    const id =
      typeof row === 'object' && row != null && '_id' in row ? row._id : null;
    if (typeof id !== 'string') {
      throw new Error('review queue aggregateRaw returned a row without an id');
    }
    return id;
  });
};

export const listReviewQueueAfter = async (
  context: Context,
  viewer: ViewerIdentity,
  afterId: string | null,
  take: number,
): Promise<ChangeProposalSummary[]> => {
  if (afterId != null && !isValidObjectId(afterId)) {
    return [];
  }
  const ids = readIds(
    await context.aggregateRaw({
      pipeline: reviewQueuePipeline(viewer, afterId, take),
    }),
  );
  if (ids.length === 0) {
    return [];
  }
  const rows = await context.findMany({
    where: { id: { in: ids } },
    select: summarySelect,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row == null ? [] : [toChangeProposalSummary(row)];
  });
};
