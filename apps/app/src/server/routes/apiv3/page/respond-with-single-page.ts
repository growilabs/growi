import type {
  IDataWithMeta,
  IPageInfoExt,
  IPageNotFoundInfo,
} from '@growi/core';
import { isIPageNotFoundInfo } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import {
  isUserPage,
  isUsersTopPage,
} from '@growi/core/dist/utils/page-path-utils';
import type { HydratedDocument } from 'mongoose';

import type { PageDocument } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory(
  'growi:routes:apiv3:page:respond-with-single-page',
);

export interface RespondWithSinglePageOptions {
  revisionId?: string;
  disableUserPages?: boolean;
}

/**
 * Generate and send a single page response via Express.
 *
 * Handles success (200), not found (404), forbidden (403), and error (500) responses.
 * Optionally initializes revision field and checks disableUserPages setting.
 *
 * @param res - Express response object
 * @param pageWithMeta - Page data with metadata (success or not-found states)
 * @param options - Optional revisionId and disableUserPages settings
 */
export async function respondWithSinglePage(
  res: ApiV3Response,
  pageWithMeta:
    | IDataWithMeta<HydratedDocument<PageDocument>, IPageInfoExt>
    | IDataWithMeta<null, IPageNotFoundInfo>,
  options: RespondWithSinglePageOptions = {},
): Promise<void> {
  const { revisionId, disableUserPages = false } = options;
  let { data: page } = pageWithMeta;
  const { meta } = pageWithMeta;

  // Handle not found or forbidden cases
  if (isIPageNotFoundInfo(meta)) {
    if (meta.isForbidden) {
      return res.apiv3Err(
        new ErrorV3('Page is forbidden', 'page-is-forbidden', undefined, meta),
        403,
      );
    }
    return res.apiv3Err(
      new ErrorV3('Page is not found', 'page-not-found', undefined, meta),
      404,
    );
  }

  // Check disableUserPages setting
  if (disableUserPages && page != null) {
    const isTargetUserPage = isUserPage(page.path) || isUsersTopPage(page.path);

    if (isTargetUserPage) {
      return res.apiv3Err(
        new ErrorV3('Page is forbidden', 'page-is-forbidden'),
        403,
      );
    }
  }

  // Populate page data with revision information
  if (page != null) {
    try {
      page.initLatestRevisionField(revisionId);

      // populate
      page = await page.populateDataToShowRevision();
    } catch (err) {
      logger.error('populate-page-failed', err);
      return res.apiv3Err(
        new ErrorV3(
          'Failed to populate page',
          'populate-page-failed',
          undefined,
          { err, meta },
        ),
        500,
      );
    }
  }

  return res.apiv3({ page, pages: undefined, meta });
}
