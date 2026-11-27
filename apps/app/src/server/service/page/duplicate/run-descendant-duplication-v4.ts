import type { IPage, IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import { BULK_REINDEX_SIZE } from '../consts';
import { copyDescendantBatch } from './copy-descendant-batch';
import type { DuplicateDeps } from './duplicate-page-port';

const logger = loggerFactory(
  'growi:services:page:duplicate:run-descendant-duplication-v4',
);

export interface DescendantDuplicationV4Input {
  readonly sourcePath: string;
  readonly newPagePath: string;
  readonly user: IUserHasId;
}

type DescendantCursor = AsyncIterable<PageDocument> & {
  close(): Promise<void>;
};

const noProgress = async (): Promise<void> => {};

/** Descendants that are outside the page tree and editable by the user. */
async function openDescendantCursor(
  sourcePath: string,
  user: IUserHasId,
): Promise<DescendantCursor> {
  const Page = mongoose.model<IPage, PageModel>('Page');
  const builder = new Page.PageQueryBuilder(Page.find(), true)
    .addConditionAsRootOrNotOnTree() // to avoid affecting v5 pages
    .addConditionToListOnlyDescendants(sourcePath);

  await Page.addConditionToFilteringByViewerToEdit(builder, user);
  // WHY cast: the builder's query is untyped; the lean cursor yields Page documents.
  return builder.query
    .lean()
    .cursor({ batchSize: BULK_REINDEX_SIZE }) as DescendantCursor;
}

/**
 * Duplicates the descendants of a v4 page, batch by batch (design.md runDescendantDuplicationV4).
 * Never rejects: the caller starts this without awaiting it, and a v4 copy has
 * no PageOperation to recover from.
 */
export async function runDescendantDuplicationV4(
  deps: Pick<DuplicateDeps, 'pageGrantService' | 'pageEvent'>,
  input: DescendantDuplicationV4Input,
): Promise<void> {
  const { sourcePath, newPagePath, user } = input;
  let cursor: DescendantCursor | undefined;
  try {
    cursor = await openDescendantCursor(sourcePath, user);
    // in-process only (never sent to MongoDB), so RegExp.escape is safe here
    const oldPathPrefix = new RegExp(`^${RegExp.escape(sourcePath)}`, 'i');

    const copyBatch = async (pages: PageDocument[]): Promise<number> => {
      const { insertedPageCount } = await copyDescendantBatch(deps, {
        pages,
        oldPathPrefix,
        newPathPrefix: newPagePath,
        user,
        // A v4 duplicate copies every editable descendant regardless of this option (Req 6.3).
        onlyDuplicateUserRelatedResources: false,
        recordProgress: noProgress,
      });
      return insertedPageCount;
    };

    let batch: PageDocument[] = [];
    let insertedPageCount = 0;
    for await (const page of cursor) {
      batch.push(page);
      if (batch.length >= BULK_REINDEX_SIZE) {
        insertedPageCount += await copyBatch(batch);
        batch = [];
      }
    }
    if (batch.length > 0) {
      insertedPageCount += await copyBatch(batch);
    }

    logger.info(
      { insertedPageCount },
      `Duplicated the descendants of "${sourcePath}" to "${newPagePath}"`,
    );
  } catch (err) {
    logger.error(
      { err, sourcePath, newPagePath },
      'Duplicating the descendants of a v4 page failed',
    );
  } finally {
    // Leaving the for-await by an exception does not close a QueryCursor.
    try {
      await cursor?.close();
    } catch (err) {
      logger.warn({ err }, 'Failed to close the descendant cursor');
    }
    // Emitted even after a failure: the copies written so far must be indexed too.
    try {
      deps.pageEvent.emit('syncDescendantsUpdate', { path: newPagePath }, user);
    } catch (err) {
      logger.error(
        { err, newPagePath },
        'Failed to emit syncDescendantsUpdate',
      );
    }
  }
}
