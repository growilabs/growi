import type { Prisma } from '~/generated/prisma/client';
import type { PrismaClient } from '~/utils/prisma';

/**
 * The subset of `activitiesWhereInput` carried by the cursor executor.
 *
 * The caller provides the base filter (action / createdAt / userId); the
 * executor merges the `id.gt` resume field internally on every iteration.
 * This type intentionally omits `id` so callers cannot accidentally pass it
 * as part of `where` — the resume is controlled via `startAfterId`.
 */
export type ActivityCursorWhere = Omit<Prisma.activitiesWhereInput, 'id'>;

/**
 * Async generator that streams all `activities` documents matching `where` in
 * ascending `id` order, one batch at a time.
 *
 * Design (確定3):
 *   - Each iteration calls `prisma.activities.findMany({ where: { ...where,
 *     id: { gt: lastId } }, orderBy: { id: 'asc' }, take: batchSize })`.
 *   - `lastId` is initialised to `startAfterId` (i.e. `job.lastExportedId`)
 *     and advances to the `id` of the last doc in each batch.
 *   - Terminates when a batch is empty (no more documents).
 *   - Constant memory: one batch is held at a time.
 *
 * Resume semantics (`lastExportedId`):
 *   Pass the saved `job.lastExportedId` as `startAfterId`.  The first query
 *   will include `id: { gt: startAfterId }`, which exactly replicates the
 *   Mongoose `_id: { $gt: lastExportedId }` resume filter that the original
 *   `exportAuditLogsToFsAsync` used (ObjectId hex string comparison → same
 *   ascending order as before, requirement 3.3).
 *
 * @param prisma      - Prisma client instance (injected; executor owns no singleton).
 * @param where       - Base filter (action/createdAt/userId). Must not include `id`.
 * @param batchSize   - Number of docs to fetch per findMany call.
 * @param startAfterId - Optional resume point (= job.lastExportedId).  When
 *                      provided, the first batch starts after this id.
 */
export async function* exportActivityCursor(
  prisma: PrismaClient,
  where: ActivityCursorWhere,
  batchSize: number,
  startAfterId?: string,
): AsyncIterable<
  Awaited<ReturnType<PrismaClient['activities']['findMany']>>[number]
> {
  let lastId: string | undefined = startAfterId;

  while (true) {
    // Merge the resume constraint: id > lastId (omit when not yet set)
    const resolvedWhere: Prisma.activitiesWhereInput =
      lastId != null ? { ...where, id: { gt: lastId } } : { ...where };

    const batch = await prisma.activities.findMany({
      where: resolvedWhere,
      orderBy: { id: 'asc' },
      take: batchSize,
    });

    if (batch.length === 0) {
      break;
    }

    for (const doc of batch) {
      yield doc;
    }

    // Advance the cursor to the last document's id
    lastId = batch[batch.length - 1].id;
  }
}
