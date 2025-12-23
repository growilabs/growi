import type { IPage, Ref } from '@growi/core';
import { getIdForRef } from '@growi/core';
import { isUsersHomepage } from '@growi/core/dist/utils/page-path-utils';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import { Writable } from 'stream';
import { pipeline } from 'stream/promises';

import type { PageDocument, PageModel } from '~/server/models/page';
import { createBatchStream } from '~/server/util/batch-stream';
import loggerFactory from '~/utils/logger';

import { BULK_REINDEX_SIZE } from './consts';
import type { IPageService } from './page-service';
import { shouldUseV4Process } from './should-use-v4-process';

const logger = loggerFactory('growi:services:page');

type IPageUnderV5 = Omit<IPage, 'parent'> & { parent: Ref<IPage> };

const _shouldUseV5Process = (page: IPage): page is IPageUnderV5 => {
  return !shouldUseV4Process(page);
};

/**
 * @description This function is intended to be used exclusively for forcibly deleting the user homepage by the system.
 * It should only be called from within the appropriate context and with caution as it performs a system-level operation.
 *
 * @param {string} userHomepagePath - The path of the user's homepage.
 * @returns {Promise<void>} - A Promise that resolves when the deletion is complete.
 * @throws {Error} - If an error occurs during the deletion process.
 */
export const deleteCompletelyUserHomeBySystem = async (
  userHomepagePath: string,
  pageService: IPageService,
): Promise<void> => {
  if (!isUsersHomepage(userHomepagePath)) {
    const msg = 'input value is not user homepage path.';
    logger.error(msg);
    throw new Error(msg);
  }

  const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
    'Page',
  );
  const userHomepage = await Page.findByPath(userHomepagePath, true);

  if (userHomepage == null) {
    const msg = 'user homepage is not found.';
    logger.error(msg);
    throw new Error(msg);
  }

  const shouldUseV5Process = _shouldUseV5Process(userHomepage);

  const ids = [userHomepage._id];
  const paths = [userHomepage.path];

  try {
    if (shouldUseV5Process) {
      // Ensure consistency of ancestors
      const inc = userHomepage.isEmpty
        ? -userHomepage.descendantCount
        : -(userHomepage.descendantCount + 1);
      await pageService.updateDescendantCountOfAncestors(
        getIdForRef(userHomepage.parent),
        inc,
        true,
      );
    }

    // Delete the user's homepage
    await pageService.deleteCompletelyOperation(ids, paths);

    if (shouldUseV5Process) {
      // Remove leaf empty pages
      await Page.removeLeafEmptyPagesRecursively(
        getIdForRef(userHomepage.parent),
      );
    }

    if (!userHomepage.isEmpty) {
      // Emit an event for the search service
      pageService.getEventEmitter().emit('deleteCompletely', userHomepage);
    }

    const { PageQueryBuilder } = Page;

    // Find descendant pages with system deletion condition
    const builder = new PageQueryBuilder(Page.find(), true)
      .addConditionForSystemDeletion()
      .addConditionToListOnlyDescendants(userHomepage.path);

    // Stream processing to delete descendant pages
    // ────────┤ start │─────────
    const readStream = await builder.query
      .lean()
      .cursor({ batchSize: BULK_REINDEX_SIZE });

    const batchStream = createBatchStream(BULK_REINDEX_SIZE);

    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          // Delete multiple pages completely
          await pageService.deleteMultipleCompletely(batch, undefined);
          logger.debug(`Adding pages progressing: (count=${count})`);
        } catch (err) {
          logger.error('addAllPages error on add anyway: ', err);
        }
        callback();
      },
      final(callback) {
        logger.debug(`Adding pages has completed: (totalCount=${count})`);
        callback();
      },
    });

    await pipeline(readStream, batchStream, writeStream);
    // ────────┤ end │─────────
  } catch (err) {
    logger.error(
      'Error occurred while deleting user homepage and subpages.',
      err,
    );
    throw err;
  }
};
