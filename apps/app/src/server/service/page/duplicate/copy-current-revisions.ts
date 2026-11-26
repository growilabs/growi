import type { Prisma } from '~/generated/prisma/client';
import { toRawObjectId } from '~/server/util/prisma-raw-normalize';
import { prisma } from '~/utils/prisma';

// Sizes chosen in design.md 書き込みの規則.
export const REVISION_MERGE_CHUNK_SIZE = 10;
export const MERGE_MAX_TIME_MS = 60_000;

export interface RevisionCopyEntry {
  readonly sourceRevisionId: string;
  readonly newRevisionId: string;
  readonly newPageId: string;
}

/** Pure: builds the aggregation pipeline that copies one chunk. */
function buildCopyCurrentRevisionsPipeline(
  entries: readonly RevisionCopyEntry[],
  authorId: string,
): readonly Prisma.InputJsonObject[] {
  // Same order as $match, so the index is never -1 (see research.md, $merge).
  const sourceRevisionIds = entries.map((e) =>
    toRawObjectId(e.sourceRevisionId),
  );
  const newRevisionIds = entries.map((e) => toRawObjectId(e.newRevisionId));
  const newPageIds = entries.map((e) => toRawObjectId(e.newPageId));
  const entryIndex = { $indexOfArray: [sourceRevisionIds, '$_id'] };

  return [
    { $match: { _id: { $in: sourceRevisionIds } } },
    {
      $project: {
        _id: { $arrayElemAt: [newRevisionIds, entryIndex] },
        pageId: { $arrayElemAt: [newPageIds, entryIndex] },
        body: '$body',
        format: { $ifNull: ['$format', 'markdown'] },
        author: { $literal: toRawObjectId(authorId) },
        createdAt: '$$NOW',
        __v: { $toLong: 0 },
      },
    },
    {
      $merge: {
        into: 'revisions',
        on: '_id',
        whenMatched: 'fail',
        whenNotMatched: 'insert',
      },
    },
  ];
}

/**
 * Copies the given revisions inside MongoDB so their bodies never reach this
 * process. Must run outside a transaction ($merge is not allowed in one).
 */
export async function copyCurrentRevisions(
  entries: readonly RevisionCopyEntry[],
  authorId: string,
  recordProgress: () => Promise<void>,
): Promise<{ readonly copiedRevisionIds: ReadonlySet<string> }> {
  for (let i = 0; i < entries.length; i += REVISION_MERGE_CHUNK_SIZE) {
    const chunk = entries.slice(i, i + REVISION_MERGE_CHUNK_SIZE);
    // biome-ignore lint/performance/noAwaitInLoops: each $merge must be preceded by its own progress record (design.md 書き込みの規則)
    await recordProgress();
    await prisma.revisions.aggregateRaw({
      pipeline: [...buildCopyCurrentRevisionsPipeline(chunk, authorId)],
      options: { maxTimeMS: MERGE_MAX_TIME_MS },
    });
  }

  const copied = await prisma.revisions.findMany({
    where: { id: { in: entries.map((e) => e.newRevisionId) } },
    select: { id: true },
  });
  return { copiedRevisionIds: new Set(copied.map((r) => r.id)) };
}
